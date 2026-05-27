export type PrintErrorCode =
  | 'PRINTER_NOT_FOUND'
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
 * Driver support status (Phase 8.0 Spike — to be verified on Windows):
 *
 * | Field          | Method A (PowerShell) | Method B (pdf-to-printer) | Notes |
 * |----------------|----------------------|--------------------------|-------|
 * | copies         | ✅ via -ArgumentList  | ✅ pdf-to-printer option  | |
 * | colorMode      | ⚠️ 前端已预留，驱动能力待验证 | ⚠️ 同左 | Start-Process -Verb PrintTo 无法直接控制色彩；SumatraPDF CLI 有 -print-settings 参数可尝试 grayscale |
 * | duplex         | ⚠️ 前端已预留，驱动能力待验证 | ⚠️ 同左 | 需通过 SetDefaultPrinter + DEVMODE 结构或 SumatraPDF -print-settings duplex-long 控制 |
 * | paperSize      | ✅ A4 — 驱动默认      | ✅ 同左                    | CM2820ADN 只支持 A4，不需额外参数 |
 * | pageRange      | ⚠️ 前端已预留，驱动能力待验证 | ✅ SumatraPDF -print-pages 支持范围格式；undefined = all pages | |
 * | orientation    | ⚠️ 前端已预留，驱动能力待验证 | ⚠️ 同左 | auto 通常够用，portrait/landscape 需 DEVMODE |
 * | quality        | ⚠️ 前端已预留，驱动能力待验证 | ⚠️ 同左 | 需通过打印机驱动 DEVMODE.dmPrintQuality 控制 |
 * | scale          | ⚠️ 前端已预留，驱动能力待验证 | ✅ SumatraPDF -print-settings fit/shrink/noscale | |
 * | pagesPerSheet  | ⚠️ 前端已预留，驱动能力待验证 | ✅ SumatraPDF -print-settings nup=2/4 | |
 *
 * Phase 8.1 实施建议：
 * - 先验证 pdf-to-printer + SumatraPDF -print-settings 能覆盖哪些参数
 * - colorMode / duplex / orientation / quality 如无法通过 SumatraPDF 控制，改用
 *   Windows WMI Win32_PrinterConfiguration 或 SetPrinter API 设置打印机属性
 */
export interface PrintJobParams {
  copies: number
  colorMode: 'black_white' | 'color'
  duplex: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
  /** Always 'A4' — CM2820ADN does not support A3 */
  paperSize: 'A4'
  /** undefined = all pages; custom range e.g. '1-3,5,7-9' */
  pageRange?: string
  orientation: 'auto' | 'portrait' | 'landscape'
  quality: 'draft' | 'standard' | 'high'
  scale: 'fit' | 'actual'
  pagesPerSheet: 1 | 2 | 4
}

/** Phase 8.1: PrintJobParams will be forwarded here from the claim response */
export interface PrintTaskPayload {
  taskId: string
  filePath: string
  printer: string
  params: PrintJobParams
}
