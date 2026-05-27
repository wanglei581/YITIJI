export type PrintTaskStatus =
  | 'pending'
  | 'queued'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'cancelled'

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
