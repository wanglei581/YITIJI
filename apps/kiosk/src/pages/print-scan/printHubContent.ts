// ============================================================
// printHubContent — P39 打印域首屏的文案真值表
//
// 设计源：docs/design/kiosk-ai-os-v3-2026-08/39-print-hub.html
// 迁移方向是单向的：原型 → 生产。本文件把原型里散在 DOM 上的
// data-when / data-probe-when 分支文案收成结构化数据，
// 视图只做渲染，不再在 JSX 里堆条件文案。
//
// 为什么把文案单独成文件：
//   · 原型每张卡在「四态 × 探测态」下各有一句话，塞进 JSX 会让视图
//     直接破 500 行（.ccg 工程规模口径），而且 diff 时读不出改了哪一态；
//   · 后续 47 页照同一套做法搬迁时，这一层是唯一需要逐字校对原型的地方。
// ============================================================

/** 原型 .hcard 上的 data-cap，迁移时逐字保留，便于和原型逐卡对照。 */
export type PrintHubCap = 'doc' | 'phone' | 'scan' | 'photo' | 'idphoto' | 'convert' | 'sign'

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
    subtitle: '材料体检：页数、清晰度、边距、黑白彩色取舍',
    caps: ['doc', 'photo'],
    act: '你选了「检查这份文件能不能打」 → 材料体检在「文档打印」第 2 步',
    why: '页数、清晰度、边距、该黑白还是彩色，在设参数之前一次看完，比出到第 7 页才发现糊了省一趟。照片打印走的是同一套体检。',
    cost: '要读一遍文件内容才能体检；结论是参考，参数最终由你按，不满意可以全部改回去。',
    alt: '不想让机器读：跳过体检直接设参数照样能打；先自己在预览里翻一遍也行。',
  },
  {
    id: 'privacy',
    title: '打印前隐私检查',
    subtitle: '提示文件里可能有身份证号等敏感信息',
    caps: ['doc', 'scan', 'idphoto'],
    act: '你选了「打印前隐私检查」 → 在「文档打印」「材料扫描」进入后的检查步骤里做',
    why: '身份证号、银行卡号这类信息一旦打在纸上就带出门了；先提示一遍，要不要遮由你决定。',
    cost: '要把文件内容读一遍；扫描件与图片会交第三方 OCR 服务识别文字。结论只是提示，本机不替你改文件。',
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
    help: '材料体检与参数建议：页数、清晰度、边距，以及该黑白还是彩色。给的是预设，参数最终由你按。',
    aiDown: '没有体检结论。页数、纸张、份数、双面由本机自己算，照常出纸。',
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
    help: 'OCR 识别与置信度：置信度低会标「需人工复核」，不拿低置信文本往下出结论。',
    aiDown: '不出文字识别结果，纸张照样扫成 PDF，存得下也打得出。',
    deviceOff: '停。扫描仪就长在这台机器上，它离线，扫描一起没。',
  },
  {
    cap: 'photo',
    name: '照片打印',
    isAi: true,
    help: '和文档打印同一套体检，另给彩色与纸张的取舍理由。',
    aiDown: '没有体检结论，彩色、纸张、份数你自己定，照片照常打。',
    deviceOff: '停。走的是文档打印同一条出纸链路。',
  },
  {
    cap: 'idphoto',
    name: '证件照',
    isAi: true,
    help: '规格体检与换底：尺寸、人脸位置、底色是否合规；换底是重绘背景，不修改你的脸。',
    aiDown: '这两项都要模型，给不了 —— 不过功能本身也还没开放，当前可先用「照片打印」。',
    deviceOff: '停。排好版也要这台机器出片。',
  },
  {
    cap: 'convert',
    name: '格式转换',
    isAi: true,
    help: '页序与方向识别：提示哪张像是倒的、顺序像是错的；调不调由你按。',
    aiDown: '没有页序提示，顺序你自己排，合并成 PDF 照常能办。',
    deviceOff: '照常可用。合并在服务端做，不经过打印机；合完先存着，出纸换机。',
  },
  {
    cap: 'sign',
    name: '签名盖章',
    isAi: true,
    help: '落款位参考：放第几页、哪个方位、多大；位置与大小最终由你按。',
    aiDown: '没有落款位参考，页码、九宫格方位、大小档你自己选，合成照常。',
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
  title: '打印扫描一体机离线 —— 要出纸的停了，其余照常',
  chip: 'AI 不受影响',
  act: '停的是同一台机器上的打印与扫描：文档打印、照片打印、材料扫描、证件照出片',
  lines: [
    {
      k: '照常可办',
      v: '手机扫码上传、格式转换、签名盖章不经过这台打印机，现在就能用；我的文档、打印订单、异常反馈也照常。',
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
 * 原型把「为什么七项全停」这段运维口径收进 <details>，
 * 用户可见区只留一句 + 替代路径。迁移保留这个折叠。
 */
export const PRINT_HUB_PROBE_UNKNOWN_TECH_NOTE =
  '未取得本机打印扫描能力配置 —— 这和「一体机离线」不是一回事：那次知道坏在哪，这次连能力都读不到。读不到能力配置，本机就无权声称任何一项正常，连上传、格式转换、签名盖章也不敢开 —— 传上来接不接得住、合成完存不存得下，现在都答不上来。重新检测一次不花钱。'

// ── 分组标题右侧的副文案（随两条轴切换） ─────────────────────

export function capabilityGroupHint(probe: ProbeStatus, mfp: MfpStatus): string {
  if (probe !== 'ok') return '七项现在都开不了 · 状态确认后自动恢复'
  if (mfp === 'unavailable') return '要出纸的四项停了 · 上传、转换、签章照常'
  return '右上角标了是不是 AI'
}

export function recordsGroupHint(signedIn: boolean, mfp: MfpStatus): string {
  if (!signedIn) return '现在没登录，进去只会看到空的'
  if (mfp === 'unavailable') return '记录在你账号里 · 一体机离线也照常查'
  return '登录后可查看历史记录与凭证'
}

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
  if (probe !== 'ok')
    return '本机连能不能出纸都读不到。核销本身能办，但这一趟可能拿不到纸 —— 建议先用上面的「重新检测」。'
  if (mfp === 'unavailable')
    return '这台机器现在出不了纸。核销完也拿不到纸，建议换一台空闲机器再核销。'
  return undefined
}

/**
 * 底部常驻声明的第三句。前两句复用 packages/shared 的 COMPLIANCE_COPY
 * （受 verify:compliance-copy 门禁保护，不在本页另抄一份）。
 * 价格这句只给指向、不含任何数字，与 verify:price-single-source 一致。
 */
export const PRINT_HUB_PRICE_NOTICE =
  '本页不核价、不结算，价格以打印工作台核价与现场公示价为准。'
