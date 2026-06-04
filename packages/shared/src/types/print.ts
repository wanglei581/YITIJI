export type PrintTaskStatus =
  | 'pending'    // 等待 Terminal Agent 认领
  | 'claimed'    // Terminal Agent 已认领，准备打印
  | 'printing'   // 正在打印
  | 'completed'  // 打印完成
  | 'failed'     // 打印失败
  | 'cancelled'  // 已取消（管理员操作或超时）

// ── Print job parameter types ─────────────────────────────────────────────────

export type ColorMode = 'black_white' | 'color'

/** simplex = one-sided; duplex_long_edge = flip on long side (portrait docs);
 *  duplex_short_edge = flip on short side (landscape docs) */
export type DuplexMode = 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'

export type PrintOrientation = 'auto' | 'portrait' | 'landscape'

export type PrintQuality = 'draft' | 'standard' | 'high'

export type PrintScale = 'fit' | 'actual'

export type PagesPerSheet = 1 | 2 | 4

/**
 * Parameters for a single print job.
 *
 * 机型适用范围：奔图 CM2800ADN / CM2820ADN 系列（Windows 识别名称：Pantum CM2800ADN Series）
 * paperSize 固定为 'A4' — CM2800ADN 系列不支持 A3。
 *
 * colorMode 说明：
 *   - 本地 Windows 驱动路径（Phase 8.1 主方案）：black_white / color 均通过驱动控制，需真机验证
 *   - Pantum 开放打印 API 路径（PantumCloudDispatchProvider，未来预留）：
 *     "black_white" → mode:"bw" ✅（API 文档明确）
 *     "color" → TODO: 待奔图厂家确认开放 API 的彩色 mode 取值，禁止直接假设为 "color"
 *
 * 带 ? 的可选字段为开放 API 预留扩展字段，当前 CM2800ADN/CM2820ADN 可用值需厂家或真机确认。
 * 驱动支持状态见 apps/terminal-agent/src/printer/types.ts 注释表格。
 */
export interface PrintJobParams {
  /** 1–99 */
  copies: number
  colorMode: ColorMode
  duplex: DuplexMode
  /** 固定 'A4'。CM2800ADN/CM2820ADN 系列不支持 A3 或更大幅面。 */
  paperSize: 'A4'
  /** omit = all pages; custom range e.g. '1-3,5,7-9' */
  pageRange?: string
  orientation: PrintOrientation
  quality: PrintQuality
  scale: PrintScale
  pagesPerSheet: PagesPerSheet

  // ── 开放 API 预留可选字段（当前 CM2800ADN/CM2820ADN 可用值需厂家/真机确认）────────
  /**
   * 逐份打印 vs 逐页打印（copies > 1 时生效）。
   * 'collate' = 完整份后再打下一份；'non_collate' = 每页打完 copies 份再翻页。
   * 驱动支持：⚠️ 待验证。
   */
  collate?: 'collate' | 'non_collate'
  /**
   * 纸张类型。普通纸 / 厚纸 / 薄纸 / 信封 / 卡纸 / 标签纸。
   * 驱动支持：⚠️ 待验证（不同机型可选值集合不同）。
   */
  paperType?: 'plain' | 'thick' | 'thin' | 'envelope' | 'cardstock' | 'label'
  /**
   * 进纸来源。auto = 打印机自动选择；manual_tray = 手送；tray1 / tray2 = 指定纸盒。
   * 驱动支持：⚠️ 待验证（CM2800ADN 是否有多纸盒需确认）。
   */
  feeder?: 'auto' | 'manual_tray' | 'tray1' | 'tray2'
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
