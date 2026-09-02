export type PrintTaskStatus =
  | 'pending'    // 等待 Terminal Agent 认领
  | 'claimed'    // Terminal Agent 已认领，准备打印
  | 'printing'   // 正在打印
  | 'completed'  // 打印完成
  | 'failed'     // 打印失败
  | 'cancelled'  // 已取消（管理员操作或超时）

// ── 奔图开放打印 API v1.0 wire 取值（权威抄录，勿凭记忆改）────────────────────
//
// 出处：奔图《开放打印能力》V1.0，`POST {serverUrl}/print/createTask` 的 printSetting
// 参数表，**官方文档第 5–6 页**（该 PDF 的页脚页码与 PDF 页序一一对应）。
//
// ⚠️ CLAUDE.md §3「硬件能力 vs 开放打印 API 能力（必须分开描述）」：
//    **硬件支持彩色 ≠ 开放 API 支持彩色。** 本节只记录开放 API 的协议取值，
//    既不代表本地 Windows 驱动路径（Phase 8.1 主方案）做得到，也不代表反过来。
//
// ⚠️ 文档在 duplex / collate / paperSize / paperType / feeder 五项上都原文注明
//    「不同机型，可选值集合不一样」。下列是**协议全集**；CM2800ADN/CM2820ADN 实际
//    接受哪个子集仍待奔图厂家确认或真机验证，不得据此宣称本机已具备该能力。
//
// 目前仓库内**没有** internal → Pantum wire 的映射层（PantumCloudDispatchProvider
// 只存在于 docs 与注释，无实现）。真正对接开放 API 时，映射层必须以本节为唯一取值来源。

/**
 * 色彩模式（官方文档 V1.0 第 5 页）。
 *
 * 文档**只定义了 "bw"**（黑白，默认值；服务端兼容旧写法 "bg"），**全文没有给出任何彩色取值**。
 * 结论：走奔图开放打印 API 时**彩色不可用** —— 不是"尚未实现"，是协议侧根本没有公开取值。
 * 禁止自行假设 "color" / "colour" / "cmyk"。彩色只能走本地 Windows 驱动路径。
 * 待厂家确认后才可扩展本常量（同步 docs/device/pantum-api-design.md Q1）。
 */
export const PANTUM_API_MODES = ['bw'] as const

/**
 * 单双面（官方文档 V1.0 第 5 页）。协议全集 5 项，含两项**手动**双面。
 * 手动双面要求人工翻面重新进纸，无人值守一体机不适用，故本项目内部
 * DuplexMode 只收口到前 3 项；此处保留全集仅作协议记录。
 */
export const PANTUM_API_DUPLEX = [
  'simplex',
  'duplex_short_edge',
  'duplex_long_edge',
  'manual_duplex_short_edge',
  'manual_duplex_long_edge',
] as const

/** 逐份打印（官方文档 V1.0 第 5 页）。注意是**连字符** "non-collate"，服务端兼容旧写法 "nocollate"。 */
export const PANTUM_API_COLLATE = ['collate', 'non-collate'] as const

/**
 * 纸张尺寸（官方文档 V1.0 第 5–6 页）。协议支持 A4 / A5 / Letter。
 * 本项目 PrintJobParams.paperSize 仍收口为 'A4'（产品决策 + DTO @IsIn(['A4']) + 计价口径），
 * 放开 A5/Letter 需同时改 DTO、计价、Kiosk 控件与真机验证，不属于类型对齐范围。
 */
export const PANTUM_API_PAPER_SIZES = ['A4', 'A5', 'Letter'] as const

/** 纸张类型（官方文档 V1.0 第 6 页）。薄纸是 "tissue"（**不是** "thin"）。 */
export const PANTUM_API_PAPER_TYPES = [
  'plain',
  'thick',
  'tissue',
  'envelope',
  'transparency',
  'cardstock',
  'label',
] as const

/** 纸张来源（官方文档 V1.0 第 6 页）。默认是 "auto_tray"（自动进纸盒），**不是** "auto"。 */
export const PANTUM_API_FEEDERS = ['auto', 'manual_tray', 'auto_tray', 'tray1', 'tray2'] as const

export type PantumApiMode = (typeof PANTUM_API_MODES)[number]
export type PantumApiDuplex = (typeof PANTUM_API_DUPLEX)[number]
export type PantumApiCollate = (typeof PANTUM_API_COLLATE)[number]
export type PantumApiPaperSize = (typeof PANTUM_API_PAPER_SIZES)[number]
export type PantumApiPaperType = (typeof PANTUM_API_PAPER_TYPES)[number]
export type PantumApiFeeder = (typeof PANTUM_API_FEEDERS)[number]

/** printSetting 各项在文档中标注的默认值（官方文档 V1.0 第 5–6 页）。省略该项即取此值。 */
export const PANTUM_API_PRINT_SETTING_DEFAULTS = {
  numOfCopies: 1,
  mode: 'bw',
  duplex: 'simplex',
  collate: 'collate',
  paperSize: 'A4',
  paperType: 'plain',
  feeder: 'auto_tray',
} as const

/**
 * 打印范围 `printSetting.range` 的格式（官方文档 V1.0 第 6 页原文）：
 * 「打印范围，范围以"-"间隔，多个范围之间以","隔开」，文档示例 `1,3,5`，请求体示例 `"range": "1,2,3"`。
 * 即：单页写页号，连续页写 `起-止`，多段用 `,` 拼接 —— 如 `1,3,5` / `1-3,5` / `1-3,7-9`。
 * 省略该字段 = 全部页面（与本项目 pageRange 语义一致）。
 */
export const PANTUM_API_RANGE_FORMAT_HINT = '如 "1,3,5" 或 "1-3,5,7-9"；省略 = 全部页面'

// ── Print job parameter types（本项目内部取值，非 Pantum wire 取值）──────────────

/**
 * 本地驱动路径的内部色彩取值。**不要**改成 Pantum wire 取值。
 *
 * - 本地 Windows 驱动（Phase 8.1 主方案）：black_white / color 都由驱动控制，需真机验证。
 * - 奔图开放打印 API：`black_white` → `mode:"bw"`（官方文档第 5 页）；
 *   `color` **无对应 wire 取值** —— 文档只定义了 "bw"，彩色取值未公开，
 *   走开放 API 时彩色不可用，禁止假设为 "color"。见 PANTUM_API_MODES。
 */
export type ColorMode = 'black_white' | 'color'

/**
 * 本项目内部单双面取值 —— 是 PANTUM_API_DUPLEX（官方文档第 5 页，5 项）的**前 3 项子集**。
 *
 * simplex = 单面；duplex_long_edge = 长边翻页（竖排文档）；duplex_short_edge = 短边翻页（横排文档）。
 * 官方另有 manual_duplex_short_edge / manual_duplex_long_edge 两项**手动双面**，本项目
 * **不启用**：手动双面需人工翻面重新进纸，与无人值守一体机场景冲突；且能力门禁
 * （printScanCapability.ts / terminal-capabilities.types.ts）按自动双面两值判定 duplex_print，
 * 静默放宽本 union 会让手动双面绕过 fail-closed 门禁。要启用必须同步门禁 + DTO + 真机验证。
 */
export type DuplexMode = 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'

export type PrintOrientation = 'auto' | 'portrait' | 'landscape'

export type PrintQuality = 'draft' | 'standard' | 'high'

export type PrintScale = 'fit' | 'actual'

export type PagesPerSheet = 1 | 2 | 4

/**
 * Parameters for a single print job.
 *
 * 机型适用范围：奔图 CM2800ADN / CM2820ADN 系列（Windows 识别名称：Pantum CM2800ADN Series）
 * paperSize 固定为 'A4' — CM2800ADN 系列不支持 A3；开放 API 协议本身另支持 A5/Letter
 * （官方文档 V1.0 第 5–6 页，见 PANTUM_API_PAPER_SIZES），本项目按产品决策收口到 A4。
 *
 * colorMode 说明（CLAUDE.md §3：硬件能力与开放 API 能力必须分开描述）：
 *   - 本地 Windows 驱动路径（Phase 8.1 主方案）：black_white / color 均通过驱动控制，需真机验证
 *   - Pantum 开放打印 API 路径（PantumCloudDispatchProvider，未来预留，**当前无实现**）：
 *     "black_white" → mode:"bw" ✅（官方文档 V1.0 第 5 页明确）
 *     "color" → ❌ **开放 API 文档只定义了 "bw"，彩色取值未公开** ——
 *       走开放 API 时彩色**不可用**（不是"待实现"，是协议侧没有该取值）。
 *       禁止假设为 "color"。待厂家确认后再扩展 PANTUM_API_MODES。
 *
 * 带 ? 的可选字段为开放 API 预留扩展字段，取值集合直接引用上方 Pantum 协议常量。
 * 文档在这几项上均注明「不同机型，可选值集合不一样」：CM2800ADN/CM2820ADN 实际可用值
 * 需厂家或真机确认，本地驱动是否能控制同样待验证。
 * 驱动支持状态见 apps/terminal-agent/src/printer/types.ts 注释表格。
 */
export interface PrintJobParams {
  /** 1–99 */
  copies: number
  colorMode: ColorMode
  duplex: DuplexMode
  /**
   * 固定 'A4'。CM2800ADN/CM2820ADN 系列不支持 A3 或更大幅面。
   * 开放 API 协议另支持 'A5' / 'Letter'（官方文档 V1.0 第 5–6 页，见 PANTUM_API_PAPER_SIZES），
   * 本项目未放开：放开需同步 DTO @IsIn、计价口径、Kiosk 控件与真机验证。
   */
  paperSize: 'A4'
  /**
   * 省略(undefined) = 全部页面；自定义范围如 '1-3,5,7-9'。
   * 映射到开放 API 的 `printSetting.range`（官方文档 V1.0 第 6 页）：
   * 范围以 '-' 间隔，多个范围之间以 ',' 隔开（文档示例 `1,3,5`；请求体示例 `"range": "1,2,3"`）。
   * 与本字段格式一致，无需转换；见 PANTUM_API_RANGE_FORMAT_HINT。
   */
  pageRange?: string
  orientation: PrintOrientation
  quality: PrintQuality
  scale: PrintScale
  pagesPerSheet: PagesPerSheet

  // ── 开放 API 预留可选字段（当前 CM2800ADN/CM2820ADN 可用值需厂家/真机确认）────────
  // 取值集合直接复用上方 Pantum 协议常量，避免第二份手抄件走样。
  /**
   * 逐份打印 vs 逐页打印（copies > 1 时生效）。官方文档 V1.0 第 5 页。
   * 'collate' = 完整份后再打下一份（默认）；'non-collate' = 每页打完 copies 份再翻页。
   * ⚠️ 注意是**连字符** 'non-collate'（服务端兼容旧写法 "nocollate"）；
   *    历史上曾误写为下划线 'non_collate'，该值会被开放 API 拒绝。
   * 文档注明「不同机型，可选值集合不一样」；驱动支持：⚠️ 待验证。
   */
  collate?: PantumApiCollate
  /**
   * 纸张类型。官方文档 V1.0 第 6 页，默认 'plain'。
   * 普通纸 / 厚纸 / **薄纸 'tissue'** / 信封 / **胶片 'transparency'** / 卡片纸 / 标签纸。
   * ⚠️ 薄纸的官方取值是 'tissue'；历史上曾误写为 'thin'，该值会被开放 API 拒绝。
   * 文档注明「不同机型，可选值集合不一样」；驱动支持：⚠️ 待验证。
   */
  paperType?: PantumApiPaperType
  /**
   * 进纸来源。官方文档 V1.0 第 6 页，**默认 'auto_tray'（自动进纸盒）**。
   * auto = 打印机自动选择；manual_tray = 手动进纸盒；tray1 / tray2 = 选配纸盒。
   * ⚠️ 历史上缺失默认值 'auto_tray'。
   * 文档注明「不同机型，可选值集合不一样」；驱动支持：⚠️ 待验证
   * （CM2800ADN/CM2820ADN 是否有选配纸盒需确认）。
   */
  feeder?: PantumApiFeeder
}

// ── Print param normalization helper ──────────────────────────────────────────

/** 默认打印参数：黑白、单面、A4、1 份、标准质量。 */
export const DEFAULT_PRINT_JOB_PARAMS: PrintJobParams = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  pageRange: 'all',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
}

/**
 * 当前已完成端到端验证的打印参数组合。
 *
 * wire 类型仍保留彩色、双面与 N-up，供历史数据读取和未来能力开放使用；在厂家确认
 * 与 Windows 真机验收完成前，生产交互与服务端建单必须收口到本 profile。
 */
export const VERIFIED_PRINT_PARAMETER_PROFILE = {
  colorMode: 'black_white',
  duplex: 'simplex',
  pagesPerSheet: 1,
} as const satisfies Pick<PrintJobParams, 'colorMode' | 'duplex' | 'pagesPerSheet'>

type CapabilitySensitivePrintParams = Pick<
  PrintJobParams,
  'colorMode' | 'duplex' | 'pagesPerSheet'
>

export function hasUnverifiedPrintParams(params: CapabilitySensitivePrintParams): boolean {
  return params.colorMode !== VERIFIED_PRINT_PARAMETER_PROFILE.colorMode ||
    params.duplex !== VERIFIED_PRINT_PARAMETER_PROFILE.duplex ||
    params.pagesPerSheet !== VERIFIED_PRINT_PARAMETER_PROFILE.pagesPerSheet
}

// ── 按终端能力收口（2026-08-18 彩色/双面开放后的口径） ─────────────────────────
//
// VERIFIED_PRINT_PARAMETER_PROFILE 是**全局最保守基线**，能力未知时用它。
// 一旦拿到该终端的能力登记，收口就不该再无条件砍掉彩色/双面 ——
// 那会把管理员已经验收过的能力又静默降级回黑白，用户选了彩色却按黑白出纸。

/** 该终端放行了哪些 fail-closed 打印能力。 */
export interface PrintCapabilityAllows {
  color: boolean
  duplex: boolean
}

/** 参数里是否含有**该终端未获放行**的项（N-up 恒不放行）。 */
export function hasParamsBeyondCapability(
  params: CapabilitySensitivePrintParams,
  allows: PrintCapabilityAllows,
): boolean {
  if (params.pagesPerSheet !== VERIFIED_PRINT_PARAMETER_PROFILE.pagesPerSheet) return true
  if (!allows.color && params.colorMode !== 'black_white') return true
  if (!allows.duplex && params.duplex !== 'simplex') return true
  return false
}

/**
 * 按该终端能力收口：只砍掉**未获放行**的项，已验收的彩色/双面原样保留。
 * 调用方必须在收口发生时向用户说明参数变了（不能静默降级）。
 */
export function restrictToAllowedPrintParams(
  params: PrintJobParams,
  allows: PrintCapabilityAllows,
): PrintJobParams {
  return {
    ...params,
    colorMode: allows.color ? params.colorMode : 'black_white',
    duplex: allows.duplex ? params.duplex : 'simplex',
    // N-up 是全局产品边界，与终端能力无关，恒收口到 1。
    pagesPerSheet: VERIFIED_PRINT_PARAMETER_PROFILE.pagesPerSheet,
  }
}

/**
 * 旧扁平字段输入（历史遗留 / 简化调用方）。
 * 允许使用旧字段名 color / 旧 duplex 取值 'single' / 'double'，
 * 由 makePrintParams 归一化为合法 PrintJobParams。
 */
export interface PrintParamsInput extends Partial<Omit<PrintJobParams, 'colorMode' | 'duplex'>> {
  colorMode?: ColorMode
  duplex?: DuplexMode | 'single' | 'double'
  /** 旧字段名：'bw' → black_white，'color' → color。优先级低于 colorMode。 */
  color?: 'bw' | 'color' | ColorMode
}

function normalizeColorMode(input: PrintParamsInput): ColorMode {
  if (input.colorMode === 'color' || input.colorMode === 'black_white') return input.colorMode
  if (input.color === 'color') return 'color'
  if (input.color === 'black_white') return 'black_white'
  if (input.color === 'bw') return 'black_white'
  return DEFAULT_PRINT_JOB_PARAMS.colorMode
}

function normalizeDuplex(input: PrintParamsInput): DuplexMode {
  const d = input.duplex
  if (d === 'simplex' || d === 'duplex_long_edge' || d === 'duplex_short_edge') return d
  if (d === 'single') return 'simplex'
  if (d === 'double') return 'duplex_long_edge'
  return DEFAULT_PRINT_JOB_PARAMS.duplex
}

function clampCopies(copies: number | undefined): number {
  if (typeof copies !== 'number' || !Number.isFinite(copies)) return DEFAULT_PRINT_JOB_PARAMS.copies
  return Math.min(99, Math.max(1, Math.round(copies)))
}

/**
 * 归一化页码范围以匹配后端 DTO 约束（仅数字/逗号/连字符/空格，如 "1-3,5"）。
 * 后端语义：pageRange 省略(undefined) = 全部页面。因此 'all' / 空串 一律归一为 undefined，
 * 否则提交真实打印任务时会被后端 @Matches 校验拒绝(400)。
 */
function normalizePageRange(pageRange: string | undefined): string | undefined {
  if (!pageRange) return undefined
  const trimmed = pageRange.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'all') return undefined
  return trimmed
}

/**
 * 构造合法的 PrintJobParams：合并默认值 + 入参，并把旧字段名/旧取值归一化。
 * 调用方应统一通过本 helper 生成 params，避免扁平字段（copies/duplex:'single'/color:'bw'）
 * 在 PrintConfirmPage 被静默丢弃回落黑白单面。
 */
export function makePrintParams(input: PrintParamsInput = {}): PrintJobParams {
  return {
    ...DEFAULT_PRINT_JOB_PARAMS,
    copies: clampCopies(input.copies),
    colorMode: normalizeColorMode(input),
    duplex: normalizeDuplex(input),
    paperSize: 'A4',
    pageRange: normalizePageRange(input.pageRange ?? DEFAULT_PRINT_JOB_PARAMS.pageRange),
    orientation: input.orientation ?? DEFAULT_PRINT_JOB_PARAMS.orientation,
    quality: input.quality ?? DEFAULT_PRINT_JOB_PARAMS.quality,
    scale: input.scale ?? DEFAULT_PRINT_JOB_PARAMS.scale,
    pagesPerSheet: input.pagesPerSheet ?? DEFAULT_PRINT_JOB_PARAMS.pagesPerSheet,
    ...(input.collate !== undefined ? { collate: input.collate } : {}),
    ...(input.paperType !== undefined ? { paperType: input.paperType } : {}),
    ...(input.feeder !== undefined ? { feeder: input.feeder } : {}),
  }
}

// ── Print task ────────────────────────────────────────────────────────────────

export interface PrintTask {
  id: string
  status: PrintTaskStatus
  fileName: string
  pageCount: number
  params: PrintJobParams
  createdAt: string
  completedAt?: string
  errorMessage?: string
}
