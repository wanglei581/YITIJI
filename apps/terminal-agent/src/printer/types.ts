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
 * 机型适用范围：奔图 CM2800ADN / CM2820ADN 系列（Windows 识别名称：Pantum CM2800ADN Series）
 * 打印机名称必须通过 Agent 配置或 --printer 参数显式传入，禁止依赖代码默认值。
 *
 * colorMode 分层说明（CLAUDE.md §3：硬件能力与开放 API 能力必须分开描述）：
 *   LocalWindowsPrintExecutor（Phase 8.1 主方案）：
 *     black_white → 通过 SumatraPDF -print-settings grayscale 或 DEVMODE 控制（需真机验证）
 *     color       → 通过 SumatraPDF -print-settings color 或驱动默认彩色（需真机验证）
 *   PantumCloudDispatchProvider（未来预留，当前无实现）：
 *     black_white → mode:"bw" ✅（《开放打印能力》V1.0 第 5 页明确）
 *     color       → ❌ 开放 API 文档**只定义了 "bw"**，彩色取值未公开 ——
 *                   走开放 API 时彩色不可用，禁止直接写 "color"。待厂家确认。
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
   *
   * Pantum 开放 API —— 事实与未知要分开读，别当成"填个值就行"：
   *   事实：《开放打印能力》V1.0 协议里**不存在彩色取值**。mode 只定义 "bw"，
   *         全文 color / 彩色 / cmyk 各 0 次；且文档在 duplex/collate/paperSize/
   *         paperType/feeder 五项下都写了"不同机型可选值集合不一样"，唯独 mode 没有——
   *         所以这不是"本机型子集"，是协议侧压根没给。
   *   未知：厂家是否另有未公开取值、后续版本会不会补。这是要去问的那件事。
   *   结论：拿到厂家答复之前，走开放 API 一律不能彩色。禁止自行写 "color" 试探。
   *   注意：硬件是彩色激光机、本地驱动可能能控彩色——那是另一条路，与本条无关。
   */
  colorMode: 'black_white' | 'color'
  /**
   * 官方《开放打印能力》V1.0 第 5 页另有 manual_duplex_short_edge / manual_duplex_long_edge
   * 两项手动双面，本项目不启用（需人工翻面重进纸，且会绕过按自动双面两值判定的
   * duplex_print 能力门禁）。保持与 shared PrintJobParams 一致。
   */
  duplex: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
  /**
   * 固定 'A4'。CM2800ADN/CM2820ADN 系列不支持 A3。
   * 开放 API 协议另支持 'A5' / 'Letter'（官方文档 V1.0 第 5–6 页），本项目未放开。
   */
  paperSize: 'A4'
  /**
   * undefined = all pages; custom range e.g. '1-3,5,7-9'。
   * 与开放 API `printSetting.range` 格式一致（官方文档 V1.0 第 6 页：
   * 范围以 '-' 间隔，多个范围之间以 ',' 隔开，示例 `1,3,5`）。
   */
  pageRange?: string
  orientation: 'auto' | 'portrait' | 'landscape'
  quality: 'draft' | 'standard' | 'high'
  scale: 'fit' | 'actual'
  pagesPerSheet: 1 | 2 | 4

  // ── 开放 API 预留可选字段（当前 CM2800ADN/CM2820ADN 可用值需厂家/真机确认）──────
  // 取值以官方《开放打印能力》V1.0 第 5–6 页为准，与 packages/shared/src/types/print.ts
  // 的 PANTUM_API_* 常量逐字一致；文档注明「不同机型，可选值集合不一样」。
  /**
   * 逐份/逐页打印。copies>1 时生效。官方文档 V1.0 第 5 页，默认 'collate'。
   * ⚠️ 是连字符 'non-collate'（服务端兼容 "nocollate"），下划线写法会被开放 API 拒绝。
   * 驱动支持：⚠️ 待验证。
   */
  collate?: 'collate' | 'non-collate'
  /**
   * 纸张类型。官方文档 V1.0 第 6 页，默认 'plain'。
   * ⚠️ 薄纸取值是 'tissue'（不是 'thin'）；另有胶片 'transparency'。
   * 不同机型可用值不同。驱动支持：⚠️ 待验证。
   */
  paperType?: 'plain' | 'thick' | 'tissue' | 'envelope' | 'transparency' | 'cardstock' | 'label'
  /**
   * 进纸来源。官方文档 V1.0 第 6 页，**默认 'auto_tray'**。
   * CM2800ADN/CM2820ADN 是否有选配纸盒需确认。驱动支持：⚠️ 待验证。
   */
  feeder?: 'auto' | 'manual_tray' | 'auto_tray' | 'tray1' | 'tray2'
}

/** Phase 8.1: PrintJobParams will be forwarded here from the claim response */
export interface PrintTaskPayload {
  taskId: string
  filePath: string
  printer: string
  params: PrintJobParams
}
