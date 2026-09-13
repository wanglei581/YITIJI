export type ScanType = 'resume' | 'id' | 'document' | 'contract'
export type ScanTaskStatus =
  | 'waiting'
  | 'matched'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'

export interface ScanSessionCreateRequest {
  scanType: ScanType
  terminalId: string
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

/** 409：配对重扫的 child 已不在 waiting/matched，不能恢复，也不能再开第二条。 */
export const SCAN_RETRY_CHILD_NOT_RECOVERABLE = 'SCAN_RETRY_CHILD_NOT_RECOVERABLE'

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
}

export interface ScanSessionCancelResponse {
  scanTaskId: string
  status: 'cancelled'
}
