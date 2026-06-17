export type PrintErrorCode =
  | 'PRINTER_NOT_FOUND'
  | 'PRINTER_OFFLINE'
  | 'PAPER_EMPTY'
  | 'PRINTER_ERROR'
  | 'PRINT_JOB_UNCONFIRMED'
  | 'FILE_NOT_FOUND'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'PRINT_COMMAND_FAILED'
  | 'PRINT_TIMEOUT'
  | 'UNKNOWN_PRINT_ERROR'

export type PrintMethod = 'powershell' | 'pdf-to-printer'

export interface PrintResult {
  success: boolean
  method: PrintMethod
  printer: string
  file: string
  startedAt: string
  finishedAt: string
  durationMs: number
  errorCode?: PrintErrorCode
  errorMessage?: string
  rawOutput?: string
}

export interface PrinterInfo {
  name: string
  /** Raw status string from Get-Printer: Normal | Offline | Error | etc. */
  status: string
}

/**
 * Print job parameters forwarded from Kiosk → Backend → Terminal Agent.
 * Mirrors PrintJobParams in packages/shared/src/types/print.ts — keep in sync.
 *
 * 机型适用范围：奔图 CM2800/CM2820 系列。
 * 打印机名称必须通过 Agent 配置项或 --printer 参数传入，禁止硬编码。
 *
 * colorMode 分层说明：
 *   LocalWindowsPrintExecutor（Phase 8.1 主方案）：
 *     black_white → 通过 SumatraPDF -print-settings grayscale 或 DEVMODE 控制（需真机验证）
 *     color       → 通过 SumatraPDF -print-settings color 或驱动默认彩色（需真机验证）
 *   PantumCloudDispatchProvider（未来预留）：
 *     black_white → mode:"bw" ✅（《开放打印能力.pdf》明确）
 *     color       → TODO: 待奔图厂家确认开放 API 彩色 mode 取值，禁止直接写 "color"
 *
 * ── 驱动支持状态（Phase 8.0/8.1 待 Windows 真机验证）───────────────────────────
 *
 * | 字段           | Method A (PowerShell) | Method B (pdf-to-printer/SumatraPDF) | 说明 |
 * |----------------|----------------------|--------------------------------------|------|
 * | copies         | ✅ -ArgumentList     | ✅ pdf-to-printer option              | |
 * | colorMode      | ⚠️ 驱动待验证         | ⚠️ SumatraPDF -print-settings grayscale（黑白）；彩色待验 | Start-Process -Verb PrintTo 无法直接控制色彩 |
 * | duplex         | ⚠️ 驱动待验证         | ⚠️ SumatraPDF -print-settings duplex-long/short | 需 DEVMODE 或 SumatraPDF -print-settings |
 * | paperSize      | ✅ A4（驱动默认）     | ✅ 同左                               | CM2800ADN/CM2820ADN 仅支持 A4 |
 * | pageRange      | ⚠️ 驱动待验证         | ✅ SumatraPDF -print-pages（undefined = all） | |
 * | orientation    | ⚠️ 驱动待验证         | ⚠️ SumatraPDF -print-settings portrait/landscape | auto 通常够用 |
 * | quality        | ⚠️ 驱动待验证         | ⚠️ 驱动待验证                         | 需 DEVMODE.dmPrintQuality |
 * | scale          | ⚠️ 驱动待验证         | ✅ SumatraPDF -print-settings fit/shrink/noscale | |
 * | pagesPerSheet  | ⚠️ 驱动待验证         | ✅ SumatraPDF -print-settings nup=2/4 | |
 * | collate        | ⚠️ 驱动待验证         | ⚠️ 驱动待验证                         | 可选字段，copies>1 时生效 |
 * | paperType      | ⚠️ 驱动待验证         | ⚠️ 驱动待验证                         | 可选字段，不同机型可用值不同 |
 * | feeder         | ⚠️ 驱动待验证         | ⚠️ 驱动待验证                         | 可选字段，是否多纸盒需确认 |
 *
 * Phase 8.1 实施建议：
 * 1. 优先验证 pdf-to-printer + SumatraPDF -print-settings 能覆盖哪些参数（已有真机）
 * 2. colorMode / duplex / orientation / quality 无法通过 SumatraPDF 控制时，
 *    改用 Windows WMI Win32_PrinterConfiguration 或 SetPrinter API + DEVMODE 结构
 * 3. 可选字段（collate/paperType/feeder）待 Phase 8.2 或真机确认后实现
 */
export interface PrintJobParams {
  copies: number
  /**
   * 本地驱动：black_white/color 均通过 SumatraPDF 或 DEVMODE 控制，需真机验证。
   * Pantum 开放 API：black_white → "bw"；color → TODO（待厂家确认）。
   */
  colorMode: 'black_white' | 'color'
  duplex: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
  /** 固定 'A4'。CM2800ADN/CM2820ADN 系列不支持 A3。 */
  paperSize: 'A4'
  /** undefined = all pages; custom range e.g. '1-3,5,7-9' */
  pageRange?: string
  orientation: 'auto' | 'portrait' | 'landscape'
  quality: 'draft' | 'standard' | 'high'
  scale: 'fit' | 'actual'
  pagesPerSheet: 1 | 2 | 4

  // ── 开放 API 预留可选字段（当前 CM2800ADN/CM2820ADN 可用值需厂家/真机确认）──────
  /** 逐份/逐页打印。copies>1 时生效。驱动支持：⚠️ 待验证。 */
  collate?: 'collate' | 'non_collate'
  /** 纸张类型。不同机型可用值不同。驱动支持：⚠️ 待验证。 */
  paperType?: 'plain' | 'thick' | 'thin' | 'envelope' | 'cardstock' | 'label'
  /** 进纸来源。CM2800ADN 是否多纸盒需确认。驱动支持：⚠️ 待验证。 */
  feeder?: 'auto' | 'manual_tray' | 'tray1' | 'tray2'
}

/** Phase 8.1: PrintJobParams will be forwarded here from the claim response */
export interface PrintTaskPayload {
  taskId: string
  filePath: string
  printer: string
  params: PrintJobParams
}
