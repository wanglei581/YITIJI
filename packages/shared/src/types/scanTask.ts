export type ScanType = 'resume' | 'id' | 'document' | 'contract'
export type ScanTaskStatus =
  | 'waiting'
  | 'matched'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'

// ── 屏上扫描（device 路线，2026-11-02）──────────────────────────────────────────
//
// 用户在一体机屏上点「开始扫描」，终端程序服务经 WIA 直接扫描、合成 PDF 后投递；
// 面板扫描（startMode = 'panel'，现有行为）一字不变。云端只记状态、管能力、管投递，
// 实时指令（开始 / 下一页 / 完成 / 中止）走一体机到终端程序的本机通道，不在这里。
//
// **契约源**：下面五个常量数组的后端副本在 services/api/src/scan-tasks/scan-device-protocol.ts
// （后端是 CommonJS，不直接 import 本包，沿用本仓库「共享契约 + 后端副本 + 门禁比对」的惯例）。
// 改任何一边都要同时改另一边：门禁 verify:scan-device-settings 把两边逐项比对，不一致就红。
//
// current-lease（终端程序取投递租约）对 device 任务的 device 段还会带 maxPages、maxBytes，
// 按扫描类型从后端常量取：证件 4 页 / 10 MiB，其余 20 页 / 18 MiB（18 MiB 与终端程序
// apps/terminal-agent/src/agent/scan-device/scan-pdf-compose.ts 的 SCAN_PDF_MAX_BYTES 一致）。
// 一体机不读这份租约，所以这里不另建响应类型。面板任务的租约响应没有 device 对象，也不多任何字段。

/** 会话怎么开始：panel = 用户在打印机面板扫描（现有行为）；device = 用户在屏上点「开始扫描」。 */
export const SCAN_START_MODES = ['panel', 'device'] as const
export type ScanStartMode = (typeof SCAN_START_MODES)[number]

/** 原件放哪：玻璃台一次一页；进纸器一叠（硬件只有单面进纸）。 */
export const SCAN_DEVICE_SOURCES = ['flatbed', 'feeder'] as const
export type ScanDeviceSource = (typeof SCAN_DEVICE_SOURCES)[number]

/** 屏上「黑白」= gray。 */
export const SCAN_DEVICE_COLOR_MODES = ['gray', 'color'] as const
export type ScanDeviceColorMode = (typeof SCAN_DEVICE_COLOR_MODES)[number]

/**
 * 屏上扫描进度（终端程序回报，后端落库）：ready 还没开始 / scanning 正在扫 / page_ready 玻璃台一页好了 /
 * composing 合成 PDF / delivering 投递中 / error 出错（带 deviceErrorCode）/ aborted 已中止。
 */
export const SCAN_DEVICE_STATES = [
  'ready',
  'scanning',
  'page_ready',
  'composing',
  'delivering',
  'error',
  'aborted',
] as const
export type ScanDeviceState = (typeof SCAN_DEVICE_STATES)[number]

/** 屏上扫描出错原因（deviceState = 'error' 时才有）。 */
export const SCAN_DEVICE_ERROR_CODES = [
  'feeder_empty',
  'paper_jam',
  'cover_open',
  'busy',
  'warming_up',
  'not_ready',
  'timeout',
  'too_large',
  'unknown',
] as const
export type ScanDeviceErrorCode = (typeof SCAN_DEVICE_ERROR_CODES)[number]

export interface ScanSessionCreateRequest {
  scanType: ScanType
  terminalId: string
  /**
   * 屏上扫描（2026-11-02）：以下三项**只在 startMode = 'device' 时带**；不带 startMode = 面板扫描（现有行为，
   * 一字不变）。panel 时带 source / colorMode 一律 400（SCAN_START_PARAMS_INVALID）；device 时 source 与
   * colorMode 必填；device 不支持 retryOfScanTaskId（400 SCAN_DEVICE_RETRY_UNSUPPORTED）。
   * 终端没有登记 `scan_device` 能力（逐台真机验证后才由管理员开通）→ 403
   * {@link SCAN_DEVICE_NOT_VERIFIED_ON_TERMINAL}，一体机据此只给面板方式。
   */
  startMode?: ScanStartMode
  /** 原件放哪（flatbed 玻璃台 / feeder 进纸器）。 */
  source?: ScanDeviceSource
  /** 颜色（gray 黑白 / color 彩色）。 */
  colorMode?: ScanDeviceColorMode
  /**
   * 安全重扫：上一场未成功任务的 id。**只有它进 body**，配对的凭证走
   * {@link SCAN_RETRY_CONTROL_HEADER} 头。
   *
   * 两者缺一不可，且服务端按缺的那一半分别拒：只有头 → 400
   * `SCAN_RETRY_TASK_ID_MISSING`；只有 id → 403 `SCAN_RETRY_NOT_AUTHORIZED`。
   * 所以前端不许各填各的，只能整份交
   * {@link ScanRescanAuthorization}（见 apps/kiosk/src/services/api/scanTasks.ts
   * 的 createScanSession：body 与 header 都从同一个对象派生，构造不出半对）。
   */
  retryOfScanTaskId?: string
}

/**
 * 一次性安全重扫授权 —— 让同一份纸能被再扫一次而不撞服务端的同字节去重。
 *
 * ## 为什么需要它
 *
 * 服务端对「曾经匹配过但没建档成功」的内容做 2 小时去重
 * （`SCAN_FILE_PREVIOUSLY_ATTEMPTED`，见 services/api/src/scan-tasks/scan-tasks.service.ts
 * 的 `SCAN_CONTENT_DEDUP_WINDOW_MS`）。这道防线本身是对的：它挡的是「同一份物理文件被
 * 重投到另一位用户的等待中任务上」。但代价是——上一场扫描在 matched 之后失败了，用户把
 * **同一张纸**再扫一遍，字节完全一样，会被这条去重原样拒掉，而且一拒就是两小时。
 *
 * 所以服务端在任务从 matched 落到 failed / cancelled / expired 时铸一枚一次性授权
 * （15 分钟、绑定用户 + 终端 + 扫描类型 + 内容 hash + 上一场的 controlToken，CAS 消费一次）。
 * 带着它创建的新任务，且仅当投递的内容与上一场那份 hash 相同时，才被允许绕过去重一次。
 *
 * ## 丢失响应的重放（一体机必须按这个接）
 *
 * `POST /scan/sessions` 一旦把 child waiting 任务提交成功，同一对
 * `retryOfScanTaskId` + `X-Scan-Retry-Control`（同一用户 / 终端 / scanType）再发一次
 * **必须拿回同一个 child**：`scanTaskId` 不变，`controlToken` 就是上一场那份明文
 * （服务端把 child.controlTokenHash 写成 prior 的 hash，不落明文、不新铸）。
 * 不会再消费一次授权，也不会再插第二条 child。waiting / matched 且未过期才恢复；
 * 过期 / cancelled / failed / completed 回 409 `SCAN_RETRY_CHILD_NOT_RECOVERABLE`，
 * 不许再开 grandchild。错 token / 用户 / 终端 / 类型一律 403
 * `SCAN_RETRY_NOT_AUTHORIZED`，不泄露 child 是否存在。
 *
 * 一体机对「无法确认是否创建成功」的正确动作是：**再发同一对请求**，把 2xx 当成
 * 同一场会话写进 live（`controlToken` 仍是 priorControlToken）。不要为此改发普通
 * 创建。把 `SCAN_RETRY_CHILD_NOT_RECOVERABLE` 加进拒绝码表，与 403 一样永久丢弃授权。
 *
 * ## 凭证的去向：只有 header，没有第二条路
 *
 * `priorControlToken` 是上一场任务的控制凭证明文。它**不得**进 body、不得进 query
 * string、不得写任何浏览器存储、不得进日志 —— 与 `X-Scan-Session-Control` 同一套惯例
 * （header 通常不进访问日志与浏览器历史，query string 通常会）。
 *
 * 这条约束管的是**这份授权自己**的去向，不要把它读成「这个明文在前端任何地方都不存在」：
 * 一体机那一侧，同一个明文本来就以 `live.controlToken` 的身份待在
 * `ai-job-print:current-scan-workbench`（sessionStorage）里，因为看门狗整页重载之后
 * 还要靠它继续轮询同一场扫描。两者的边界与清理时机见
 * apps/kiosk/src/pages/scan/scanWorkbenchSession.ts 里 `ScanRescanAuthority` 的注释：
 * 授权自己一个字节都不落存储，而那份 live 登记由清场（隐私空闲 / 屏保 / 退出 / 换人 /
 * 离开扫描流程）统一抹掉。
 */
export interface ScanRescanAuthorization {
  /** 上一场未成功任务的 id。进 body 的 `retryOfScanTaskId`。 */
  retryOfScanTaskId: string
  /** 上一场任务的 controlToken 明文。只进 {@link SCAN_RETRY_CONTROL_HEADER} 头。 */
  priorControlToken: string
}

/**
 * 安全重扫凭证的 header 名。服务端在 `POST /scan/sessions` 上按
 * `@Headers('x-scan-retry-control')` 读取（scan-tasks.controller.ts）。
 */
export const SCAN_RETRY_CONTROL_HEADER = 'X-Scan-Retry-Control'

/** 服务端拒绝终端在取消/过期后的隐私静默期内重新建会话。 */
export const SCAN_TERMINAL_QUIET_PERIOD = 'SCAN_TERMINAL_QUIET_PERIOD' as const

/** 409：配对重扫的 child 已不在 waiting/matched，不能恢复，也不能再开第二条。 */
export const SCAN_RETRY_CHILD_NOT_RECOVERABLE = 'SCAN_RETRY_CHILD_NOT_RECOVERABLE'

/** 409：任务不是未过期的 waiting/matched，不能 ACK 投递闸门。 */
export const SCAN_TASK_ACK_NOT_ALLOWED = 'SCAN_TASK_ACK_NOT_ALLOWED'

// 屏上扫描会话上的 409 / 403 原因码。字符串值就是后端 error.code，门禁
// verify:scan-device-settings 用这里的常量作为期望值去打后端：改了任何一边不同步，门禁就红。

/** 403：建 device 会话时本机没有开通 `scan_device` 能力（只给面板方式）。 */
export const SCAN_DEVICE_NOT_VERIFIED_ON_TERMINAL = 'SCAN_DEVICE_NOT_VERIFIED_ON_TERMINAL'
/** 409：正在扫或已经收到页（scanning / page_ready / composing / delivering，含 aborted），先停下再换来源 / 颜色。 */
export const SCAN_DEVICE_SETTINGS_LOCKED = 'SCAN_DEVICE_SETTINGS_LOCKED'
/** 409：本机的 `scan_device` 能力中途被关（改设置、回报都会拿到）；一体机据此改走面板方式。 */
export const SCAN_DEVICE_CAPABILITY_DISABLED = 'SCAN_DEVICE_CAPABILITY_DISABLED'
/** 409：文件已经交付（matched / completed），不能再改设置或改用面板扫描。 */
export const SCAN_DEVICE_ALREADY_DELIVERED = 'SCAN_DEVICE_ALREADY_DELIVERED'
/** 409：该会话不是屏上扫描（面板任务，或已「改用面板扫描」的任务）。 */
export const SCAN_TASK_NOT_DEVICE = 'SCAN_TASK_NOT_DEVICE'
/** 409：读与写之间会话状态又变了（重读重判 3 轮仍对不上），刷新后再试。 */
export const SCAN_DEVICE_STATE_CHANGED = 'SCAN_DEVICE_STATE_CHANGED'
/**
 * 409：终端程序回报的来源或颜色与会话上的设置不一致（用户在回报读到之后改了设置）。
 * 必须停扫，按新的来源和颜色重新开始。没带 source / colorMode 的旧终端程序不会拿到这个码。
 */
export const SCAN_DEVICE_SETTINGS_CHANGED = 'SCAN_DEVICE_SETTINGS_CHANGED'
/** 409：会话已取消 / 过期 / 结束，或已到续期上限，不能再改设置或改用面板扫描。 */
export const SCAN_TASK_NOT_ACTIVE = 'SCAN_TASK_NOT_ACTIVE'

export interface ScanSessionAckResponse {
  scanTaskId: string
  deliveryAckedAt: string
}

export interface ScanSessionCreateResponse {
  scanTaskId: string
  /** 明文只在本次创建响应里下发一次，后续 getStatus()/cancel() 必须带上它才能操作该会话（B1-4）。
   *  前端只应把它保存在内存态（React state/ref），不落 localStorage/sessionStorage。 */
  controlToken: string
  expiresAt: string
  /** 按 scanType 定制的操作指引（去打印机面板怎么操作），后端下发，前端不再硬编码。 */
  instructions: string[]
}

export interface ScanSessionFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  /** 本系统 HMAC 签名内容 URL，供后续打印/AI 识别流程使用。 */
  fileUrl: string
}

export interface ScanSessionStatusResponse {
  scanTaskId: string
  status: ScanTaskStatus
  scanType: ScanType
  file: ScanSessionFileView | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
  /**
   * 屏上扫描（2026-11-02）起后端才返回下面七项；**全部可选**：老服务端不带，一体机缺省按面板扫描
   * （startMode 缺省 = 'panel'）处理。面板任务（含已「改用面板扫描」的）后端给 startMode:'panel'、
   * devicePageCount:0、其余 null——哪怕库里还留着 device 时期的列值。
   */
  startMode?: ScanStartMode
  deviceState?: ScanDeviceState | null
  /** 只数整页收到的图（屏上「已收到 N 页」）。 */
  devicePageCount?: number
  deviceErrorCode?: ScanDeviceErrorCode | null
  /** 用户当前选的来源与颜色；改设置（device-settings）之后读到的就是新值。 */
  deviceSource?: ScanDeviceSource | null
  deviceColorMode?: ScanDeviceColorMode | null
  /** 最近一次状态变化（ISO 8601）：终端程序回报，或用户改设置 / 改用面板。 */
  deviceUpdatedAt?: string | null
}

export interface ScanSessionCancelResponse {
  scanTaskId: string
  status: 'cancelled'
  /**
   * 本终端静默期结束时间（ISO 8601）。服务端按与下一次建会话同一条规则算。
   * 静默期关着，或窗口内没有已结束的会话时，等于 serverNow。可选：老服务端不带。
   */
  quietPeriodEndsAt?: string
  /** 服务端当前时间（ISO 8601）。一体机用它和 quietPeriodEndsAt 算倒计时。可选：老服务端不带。 */
  serverNow?: string
}

/**
 * POST /scan/sessions/:id/switch-to-panel（「改用面板扫描」）的响应：同一个会话原地切回面板，
 * 会话、控制凭证、ACK 原样保留，不触发终端静默期；截止时间续到至少「现在 + 10 分钟」（不超过续期上限）。
 */
export interface ScanSwitchToPanelResponse {
  scanTaskId: string
  startMode: 'panel'
  expiresAt: string
  /** 面板扫描的操作步骤（与建会话时下发的同一份），一体机切换后直接显示。 */
  instructions: string[]
}

/**
 * POST /scan/sessions/:id/device-settings 的请求体（放纸与设置屏换来源 / 颜色，例如出错屏的「改用玻璃台」）。
 * 两个至少给一个（都没给 → 400），没给的保持原值；多余字段 400。
 */
export interface ScanDeviceSettingsRequest {
  source?: ScanDeviceSource
  colorMode?: ScanDeviceColorMode
}

/**
 * device-settings 的响应：同一个会话原地改，会话、控制凭证、ACK 原样保留，**不检查也不触发终端静默期**。
 * 只在 deviceState 为 ready / error 时允许（其余 409 {@link SCAN_DEVICE_SETTINGS_LOCKED}）。
 * 改完一定回到 ready、0 页、无错误码；截止时间续到至少「现在 + 10 分钟」（不超过续期上限）。
 * 之后终端程序下一次回报 scanning，走 ready → scanning。要改的值与现值相同且已是 ready 时幂等：原样返回。
 */
export interface ScanDeviceSettingsResponse {
  scanTaskId: string
  startMode: 'device'
  source: ScanDeviceSource
  colorMode: ScanDeviceColorMode
  deviceState: 'ready'
  devicePageCount: 0
  deviceErrorCode: null
  expiresAt: string
}
