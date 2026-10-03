// ============================================================
// printHubContent — 打印域 Hub 的文案与状态轴
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/10-print-hub.html
// 状态机与两轴分治仍沿用已验证实现（探测轴 + MFP 轴），本文件只收文案。
// ============================================================

/** 原型能力卡 data-cap / key，迁移时逐字保留，便于和原型逐卡对照。 */
export type PrintHubCap = 'doc' | 'phone' | 'usb' | 'scan' | 'photo' | 'idphoto' | 'convert' | 'sign'

/**
 * 原型 STATES。Hub 页覆盖前五态；feature-* 在 /print-scan/feature/:key。
 * feature-copy 是 2.0 稿之外的运行页状态（R4，9/29 产品负责人拍板：复印走打印机面板自带功能；
 * 同日定合规新状态不画新稿，用 2.0 现有组件与字阶实现）。
 */
export type HubUiState =
  | 'capability-loading'
  | 'default'
  | 'capability-error'
  | 'locked'
  | 'device-off'
  | 'feature-id-photo'
  | 'feature-copy'
  | 'feature-not-found'

/** 说明页的三个状态；Hub 页本身不会进入这几个。 */
export type HubFeatureState = Extract<HubUiState, `feature-${string}`>

/** 能力探测轴（原型 data-probe）：本机连自己的能力配置都读不到时为 unknown。 */
export type ProbeStatus = 'loading' | 'ok' | 'error'

/**
 * 打印扫描一体机（MFP）轴。原型 data-when="device-off" 说的就是这一台机器。
 *
 * 与探测轴是两件事，原型 CSS 头注释专门裁定过：
 *   · unavailable（原型 device-off）= MFP 确定出不了纸 → 敢说哪几项停、哪几项照常；
 *   · unknown = 读不到打印机状态 → **不敢声称离线**，只如实说读不到。
 * 生产数据源 useTerminalDeviceStatus（GET /terminals/:id/printer-status），
 * fail-closed：null / 心跳过期 / 请求失败一律不算在线。
 */
export type MfpStatus = 'checking' | 'ready' | 'unavailable' | 'unknown'

// ── AI 带：三件事 ────────────────────────────────────────────
// 原型 39-print-hub.html:464-522 + 页内 USE 表。
// 四要素（动作 / 理由 / 代价 / 备选）缺一不发，见原型 README §三。

export interface PrintHubAiPick {
  id: 'route' | 'check' | 'privacy'
  title: string
  subtitle: string
  /** 选中后高亮哪几张卡；route 为空数组 —— 用户没说，本机不替他猜。 */
  caps: readonly PrintHubCap[]
  act: string
  why: string
  cost: string
  alt: string
}

export const PRINT_HUB_AI_PICKS: readonly PrintHubAiPick[] = [
  {
    id: 'route',
    title: '我不知道该用哪个',
    subtitle: '按你手上的东西挑入口，说不清可以问小青',
    caps: [],
    act: '你选了「不知道该用哪个」 → 按下面「备选」里的情况对号入座，或去问小青',
    why: '推荐入口要先知道你手上有什么、想拿到什么，没说之前本机不替你猜 —— 不会写死一句「多数人要办文档打印」硬推给你。',
    cost: '不需要登录。纸和耗材要钱，金额在打印工作台核价，本页只给指向、不结算。',
    alt: '文件在手机里 → 手机扫码上传；手上是纸 → 材料扫描；一堆图片要拼一份 → 格式转换；已经有 PDF → 文档打印。',
  },
  {
    id: 'check',
    title: '帮我检查这份文件能不能打',
    subtitle: '材料体检：页数、能不能按 A4 打、有没有隐私片段',
    caps: ['doc', 'photo'],
    act: '你选了「检查这份文件能不能打」 → 材料体检在「文档打印」第 2 步',
    why: '页数、能不能按 A4 打、有没有身份证号一类隐私片段，在设参数之前一次看完，比出到第 7 页才发现不对省一趟。照片打印走的是同一条流程、同一套体检。',
    cost: '要读一遍文件内容才能体检；结论是参考。打印参数本机不代你设，份数、颜色、双面都在下一步由你自己选。',
    alt: '不想让机器读：跳过体检直接设参数照样能打；先自己在预览里翻一遍也行。',
  },
  {
    id: 'privacy',
    title: '打印前隐私检查',
    subtitle: '提示文件里可能有身份证号等敏感信息',
    // 隐私检查只在 /print/material-check 这一步做，而该页只有 PrintUploadPage:332
    // 一个入口 —— 也就是「文档打印 / 照片打印」。材料扫描的结果页直接去 /print/confirm，
    // 不经过这一步；证件照还没开放。所以这两张卡不能被这条高亮进来。
    caps: ['doc', 'photo'],
    act: '你选了「打印前隐私检查」 → 在「文档打印」「照片打印」上传后的第 2 步里做',
    why: '身份证号、银行卡号这类信息一旦打在纸上就带出门了；先提示一遍，要不要遮由你决定。',
    cost: '要把文件内容读一遍；扫描件与图片会交第三方 OCR 服务识别文字。命中的片段逐条由你决定遮还是留，本机不自作主张。',
    alt: '不想让机器读：直接打，自己先翻一遍；或先存进「我的文档」，回头再处理。',
  },
]

// ── AI 说明浮层：七项逐条写三句 ───────────────────────────────
// 原型 39-print-hub.html:991-1032。卡面只留一行价值 + 一行状态，
// 「AI 怎么帮 / AI 挂了 / 一体机离线」整段收进这一层。

export interface PrintHubAiExplainerRow {
  cap: PrintHubCap
  name: string
  isAi: boolean
  help: string
  aiDown: string
  deviceOff: string
}

export const PRINT_HUB_AI_EXPLAINER: readonly PrintHubAiExplainerRow[] = [
  {
    cap: 'doc',
    name: '文档打印',
    isAi: true,
    help: '材料体检：读一遍文件，给出页数、能不能按 A4 打，以及有没有身份证号一类隐私片段。打印参数不代你设。',
    aiDown: '没有体检结论，也没有隐私提示。页数、纸张、份数、双面照旧由你自己设，照常出纸。',
    deviceOff: '停。出纸要这台机器；文件可以先传上来存着，换一台再打。',
  },
  {
    cap: 'phone',
    name: '手机扫码上传',
    isAi: false,
    help: '不帮。传文件这一步纯粹是搬运，用不到模型；体检与隐私检查在「文档打印」那一步做。',
    aiDown: '不受影响。',
    deviceOff: '照常可用。文件不经过打印机，先传上来存进「我的文档」，换机取回来打。',
  },
  {
    cap: 'scan',
    name: '材料扫描',
    isAi: true,
    help: '扫描这一步不做文字识别，也不做格式转换，按设备回传的原格式保存。要识别文字，去结果页选「AI 简历识别」，识别置信度会在那边的报告里如实写出来。',
    aiDown: '扫描不受影响，纸张照样按回传格式保存，存得下也打得出；受影响的是后面那一步简历识别。',
    deviceOff: '停。扫描仪就长在这台机器上，它离线，扫描一起没。',
  },
  {
    cap: 'photo',
    name: '照片打印',
    isAi: true,
    help: '和文档打印同一套体检 —— 走的本来就是同一条流程。彩色、纸张这些参数本机不给建议。',
    aiDown: '没有体检结论。彩色、纸张、份数照旧你自己定，照片照常打。',
    deviceOff: '停。走的是文档打印同一条出纸流程。',
  },
  {
    cap: 'idphoto',
    name: '证件照',
    isAi: true,
    help: '现在什么也不帮 —— 这个功能还没开放，进去只有一页常见规格说明。规格体检、换底都没有实现。',
    aiDown: '没有区别：功能本身还没开放，当前可先用「照片打印」。',
    deviceOff: '停。排好版也要这台机器出片。',
  },
  {
    cap: 'convert',
    name: '格式转换',
    isAi: false,
    help: '不帮。页序由你用「上移 / 下移」自己排，本机不识别方向、不自动排序，合并这一步纯粹是版式处理。',
    aiDown: '不受影响。',
    deviceOff: '照常可用。合并文件不需要打印机；合完先保存，需要出纸时换一台机器。',
  },
  {
    cap: 'sign',
    name: '签名',
    isAi: false,
    help: '不帮。本机只读出文件总页数供你选页；落款页码、九宫格方位、大小档全部由你自己选。',
    aiDown: '不受影响。',
    deviceOff: '照常可用。合成不经过打印机；这是版式合成，不是 CA 电子签。',
  },
]

// ── 顶部状态带的话术 ─────────────────────────────────────────
// 原型把「这一态还能做什么 / 代价 / 备选」写在 .tband 里，
// 位置与高度不动，只换话。

export interface PrintHubBandCopy {
  title: string
  chip: string
  act: string
  lines: readonly { k: string; v: string }[]
}

/** 原型 39-print-hub.html:542-554（data-when="device-off"）。 */
export const PRINT_HUB_DEVICE_OFF_BAND: PrintHubBandCopy = {
  title: '打印机暂不可用 · 出纸类暂停',
  chip: 'AI 不受影响',
  act: '停的是同一台机器上的打印与扫描：文档打印、照片打印、材料扫描、证件照出片',
  lines: [
    {
      k: '照常可办',
      v: '不依赖打印机的服务，请按卡片上显示的可用状态选择；我的文档、打印订单、异常反馈也照常。',
    },
    { k: '代价', v: '这一趟拿不到纸。文件传上来、拼好、签好之后要换一台机器才出得了纸。' },
    {
      k: '备选',
      v: '先把材料存进「我的文档」，或找现场工作人员。离线已自动上报运维，本机不替系统承诺恢复时间。',
    },
  ],
}

/** 原型 39-print-hub.html:557-583（data-probe-when="unknown"）。 */
export const PRINT_HUB_PROBE_UNKNOWN_BAND: PrintHubBandCopy = {
  title: '服务状态无法确认',
  chip: '暂不开放任务',
  act: '这次打印扫描都开不了 —— 请重新检测，或换一台机器',
  lines: [
    {
      k: '还能做什么',
      v: '「我的打印记录」三个入口不受影响；已存进「我的文档」的文件换机也能取回来打，或找现场工作人员。',
    },
  ],
}

/**
 * 原型把「为什么七项全停」这段收进 <details>，用户可见区只留一句 + 替代路径。
 * W-08（2026-09-29 走查）：原文是开发者口吻（「连能力都读不到」「无权声称任何一项正常」），
 * 改成用户能懂、有下一步的话。2.0 稿 10 的 capability-error 态没有这段，照稿里同态的
 * 「暂时无法确认这台机器开放了哪些服务」口径写。
 */
export const PRINT_HUB_PROBE_UNKNOWN_TECH_NOTE =
  '暂时查不到这台机器能用哪些功能，所以先都不开放，免得你点进去才发现办不了。请点「重新检测」，或找工作人员；已经下过单的，到机码照常能用。'

// ── 分组标题右侧的副文案（随两条轴切换） ─────────────────────

/**
 * W-08：2.0 稿 10 这两态的副文案是「正在读取本机能力配置」「能力配置读取失败」，属工程词。
 * 改用稿里同态状态块的用户口径（「正在检查本机能力」→ 正在确认可用服务；
 * 「服务状态无法确认」→ 查不到可用服务），并给出下一步（页底的「重新检测」）。
 */
export function capabilityGroupHint(probe: ProbeStatus, mfp: MfpStatus, locked = false): string {
  if (probe === 'loading') return '正在确认可用服务，请稍候'
  if (probe !== 'ok') return '查不到可用服务，请点页底「重新检测」'
  if (mfp === 'unavailable') return '打印机暂不可用'
  if (locked) return '部分能力被管理员关闭'
  return '选一项开始准备材料'
}

export function recordsGroupHint(): string {
  return '用已有文件继续'
}

/** 顶栏胶囊。Hub 页绝不用 tone=ok 把未证实的就绪写成结论（CLAUDE.md §9）。 */
export const HUB_PILL: Record<
  HubUiState,
  { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
> = {
  'capability-loading': { tone: 'unknown', label: '正在读取本机能力' },
  default: { tone: 'unknown', label: '能力与设备状态以办理时确认' },
  'capability-error': { tone: 'bad', label: '服务状态无法确认 · 任务暂不开放' },
  locked: { tone: 'warn', label: '部分能力已被管理员关闭' },
  'device-off': { tone: 'warn', label: '打印机暂不可用 · 出纸类暂停' },
  'feature-id-photo': { tone: 'warn', label: '证件照尚未开放' },
  'feature-copy': { tone: 'unknown', label: '复印在打印机面板上操作' },
  'feature-not-found': { tone: 'warn', label: '能力说明不存在' },
}

export const HUB_ASK: Record<HubUiState, { text: string; em: string }> = {
  'capability-loading': { text: '正在确认这台机器能做什么。', em: '这台机器' },
  default: { text: '你的文件，现在在哪？', em: '现在在哪' },
  'capability-error': { text: '本机能力没读到。', em: '没读到' },
  locked: { text: '有几项被关掉了。', em: '被关掉了' },
  'device-off': { text: '这台机器出不了纸。', em: '出不了纸' },
  'feature-id-photo': { text: '证件照还没开放。', em: '还没开放' },
  'feature-copy': { text: '复印，在打印机屏幕上点。', em: '打印机屏幕' },
  'feature-not-found': { text: '这个能力名我不认识。', em: '我不认识' },
}

export const HUB_TRUTH = [
  { k: '办理提醒', v: '按 A4 出纸；结束办理清除本机临时信息，文件按留存期限管理。' },
] as const

/**
 * 到机码分组标题右侧副文案。原型 39-print-hub.html:595-601。
 *
 * ⚠ 与原型的一处刻意偏离：原型在 probe=unknown / device-off 时把这张卡整个停用。
 * 生产保留它可点 —— 见 PrintScanHomePage.tsx 里 pickup-claim 的说明：
 * 核销的是订单而非新建本机任务，既有门禁契约要求它不被本机能力探测关闭。
 * 但「这台出不了纸」这件事必须写在卡面上，所以话术照原型迁过来。
 */
export function arrivalCodeHint(signedIn: boolean, probe: ProbeStatus, mfp: MfpStatus): string {
  if (probe !== 'ok') return '本机服务状态无法确认 · 核销前先确认这台能不能出纸'
  if (mfp === 'unavailable') return '这台出不了纸 · 核销前先换一台空闲机器'
  if (!signedIn) return '凭码办理 · 不登录也能核销'
  return '输到机码，直接认领这一单'
}

/** 到机码卡的状态行，随 MFP / 探测态换话。 */
export function arrivalCodeStateNote(probe: ProbeStatus, mfp: MfpStatus): string | undefined {
  if (probe === 'loading') return '正在确认这台机器能不能出纸；核销本身不受影响。'
  if (probe !== 'ok')
    return '本机连能不能出纸都读不到：核销能办，但这一趟可能拿不到纸。'
  if (mfp === 'unavailable')
    return '这台机器现在出不了纸。核销完也拿不到纸，建议换一台空闲机器再核销。'
  return undefined
}

export function deriveHubUiState(input: {
  probe: ProbeStatus
  mfp: MfpStatus
  locked: boolean
}): Exclude<HubUiState, HubFeatureState> {
  if (input.probe === 'loading') return 'capability-loading'
  if (input.probe === 'error') return 'capability-error'
  if (input.mfp === 'unavailable') return 'device-off'
  if (input.locked) return 'locked'
  return 'default'
}

/** 轴芯片「彩色 / 双面」：未在本机登记 available 就写未验证，不谎报。 */
export function colorDuplexChip(colorOn: boolean, duplexOn: boolean): string {
  if (!colorOn && !duplexOn) return '彩色 / 双面 · 本机暂未开通'
  const bits = [colorOn ? '彩色已开放' : null, duplexOn ? '双面已开放' : null].filter(
    (v): v is string => v !== null,
  )
  return bits.join(' · ')
}

// ── 复印说明（/print-scan/feature/copy） ─────────────────────
// R4（2026-09-29 产品负责人拍板）：复印、身份证复印改用打印机（奔图 CM2800 系列）面板自带功能，
// 不开发证件拼版；面板复印对用户开放，不经过本机下单，也不进「我的打印订单」。
// 内容来源：CM2800 系列中文用户指南 V1.4 第 3 节提取稿（p30–33、p45–50、p3）。
// 按钮名按面板屏幕实际字样写（主屏四个大按钮：复印 / 扫描 / 身份证复印 / 票据复印），
// 不照抄手册里前后不一的「按 OK 键」「复印开始键」。现场没核实过的，一律写「以打印机屏幕为准」。

/** 打印扫描首页「复印」卡与说明页共用的 key：/print-scan/feature/copy。 */
export const COPY_GUIDE_KEY = 'copy'
export const COPY_GUIDE_ROUTE = `/print-scan/feature/${COPY_GUIDE_KEY}`

export interface CopyGuideStep {
  title: string
  body: string
  /** 正文里要加粗的片段，便于用户扫一眼找到按钮名。 */
  emphasis?: readonly string[]
}

export const COPY_GUIDE_STEPS: readonly CopyGuideStep[] = [
  {
    title: '放原件',
    body: '多页普通纸：放进打印机上方的进纸口，字朝上。单页、证件、书本：掀开上盖，字朝下放在玻璃上，对齐左上角，再合上盖。',
    emphasis: ['字朝上', '字朝下'],
  },
  {
    title: '在打印机屏幕上选功能',
    body: '普通复印点「复印」；复印身份证点「身份证复印」；复印发票、收据点「票据复印」。',
    emphasis: ['「复印」', '「身份证复印」', '「票据复印」'],
  },
  {
    title: '需要时改设置',
    body: '可以改份数、黑白或彩色、单面或双面、放大缩小。每一项在哪里改，以打印机屏幕显示为准；上一位调过的设置可能还在，开始前看一眼。',
  },
  {
    title: '开始复印',
    body: '点打印机屏幕上的「复印」开始。原件放在玻璃上时，扫描过程中不要掀盖。',
    emphasis: ['「复印」'],
  },
  {
    title: '取走复印件和原件',
    body: '复印件从出纸口取。原件还在玻璃上或进纸口里，一起带走。',
  },
]

/**
 * 身份证放置位置与翻面步骤 —— 占位。
 * 手册只写了「点身份证复印 → 调好设置 → 点复印」，没写证件放在玻璃哪里、正反面怎么翻、
 * 屏幕会不会提示翻面。【待 Windows 窗口现场核实后填写】在那之前不编造位置，只给一句指路。
 */
export const COPY_ID_CARD_PLACEMENT_PENDING = '身份证怎么放、怎么翻面，请看打印机屏幕提示或找工作人员。'

export interface CopyGuideCase {
  key: 'id-card' | 'receipt' | 'duplex'
  title: string
  body: string
  /** 待现场核实的占位项：卡面标出来，免得被当成已确认的步骤。 */
  pending?: boolean
}

export const COPY_GUIDE_CASES: readonly CopyGuideCase[] = [
  {
    key: 'id-card',
    title: '身份证',
    body: `在打印机屏幕上点「身份证复印」。${COPY_ID_CARD_PLACEMENT_PENDING}`,
    pending: true,
  },
  {
    key: 'receipt',
    title: '发票、收据',
    body: '在打印机屏幕上点「票据复印」，原件字朝下放在玻璃上、合上盖；摆放位置以打印机屏幕提示为准。',
  },
  {
    key: 'duplex',
    title: '正反两面都有字',
    body: '第一面印完，原件会从上方出纸口出来。照原样放回进纸口，不翻面、不掉头，再点开始；等太久没放，就只印单面。',
  },
]

/** 与现场告示口径一致（pilot-onsite-notices：不得打印、复印、扫描伪造的证件、印章、票据）。 */
export const COPY_GUIDE_LEGAL = '不得复印伪造的证件、印章、票据。'
