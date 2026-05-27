import fs from 'fs'
import path from 'path'
import { PrintResult, PrintJobParams } from './types'
import { printWithPdfToPrinter } from './print-with-pdf-to-printer'
import { imageToPdf, cleanupTempPdf } from './image-to-pdf'
import { DEFAULT_PRINTER, SUPPORTED_EXTENSIONS } from '../config'
import { log } from '../logger'

/**
 * print.ts — Phase 8.1A 统一打印函数
 *
 * 这是 Phase 8.1A 的主要生产入口。所有文件类型均通过此函数路由，
 * 不再直接调用 Method A（PowerShell），原因：
 *   - Method A 图片打印在 Windows 11 上为假成功（exitCode=0 但不出纸）
 *   - Method A PDF 在无 PDF 阅读器时可能失败
 *   - Method B（pdf-to-printer/SumatraPDF）已验证真实出纸
 *
 * 路由规则：
 *   .pdf                          → Method B 直接打印
 *   .jpg / .jpeg / .png           → pdfkit 生成临时 PDF → Method B → 删除临时文件
 *   .bmp / .tiff / .tif           → UNSUPPORTED_FILE_TYPE（Phase 8.1B+ 实现，需 sharp）
 *   其他扩展名                     → UNSUPPORTED_FILE_TYPE
 *
 * params 字段（Phase 8.1A 预留接口）：
 *   copies / colorMode / duplex / orientation 等参数在 Phase 8.1B 接入
 *   SumatraPDF -print-settings 时启用，当前版本不传给打印机。
 */

const PDF_EXTENSIONS = new Set(['.pdf'])
const IMAGE_EXTENSIONS_SUPPORTED = new Set(['.jpg', '.jpeg', '.png'])
/** BMP/TIFF：扩展名已在 SUPPORTED_EXTENSIONS 中，但 Phase 8.1A 暂不支持 image-to-pdf 转换 */
const IMAGE_EXTENSIONS_PHASE_NEXT = new Set(['.bmp', '.tiff', '.tif'])

/**
 * 统一打印函数（Phase 8.1A）。
 *
 * @param filePath     待打印文件的绝对路径
 * @param printerName  打印机名称（默认从 config.ts DEFAULT_PRINTER 读取）
 * @param params       打印参数（Phase 8.1A 预留，未传给 SumatraPDF）
 */
export async function print(
  filePath: string,
  printerName: string = DEFAULT_PRINTER,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _params?: Partial<PrintJobParams>,
): Promise<PrintResult> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  // ── 文件存在性检查 ───────────────────────────────────────────────────────
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      method: 'pdf-to-printer',
      printer: printerName,
      file: filePath,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      errorCode: 'FILE_NOT_FOUND',
      errorMessage: `文件不存在：${filePath}`,
    }
  }

  const ext = path.extname(filePath).toLowerCase()

  // ── 扩展名支持检查 ───────────────────────────────────────────────────────
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      success: false,
      method: 'pdf-to-printer',
      printer: printerName,
      file: filePath,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      errorCode: 'UNSUPPORTED_FILE_TYPE',
      errorMessage: `不支持的文件类型：${ext}（支持：${[...SUPPORTED_EXTENSIONS].join(', ')}）`,
    }
  }

  // ── Phase 8.1B TODO：BMP/TIFF 需要 sharp 预处理 ──────────────────────────
  if (IMAGE_EXTENSIONS_PHASE_NEXT.has(ext)) {
    return {
      success: false,
      method: 'pdf-to-printer',
      printer: printerName,
      file: filePath,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      errorCode: 'UNSUPPORTED_FILE_TYPE',
      errorMessage:
        `${ext} 需要 sharp 预处理（Phase 8.1B+ 实现）。` +
        `Phase 8.1A 支持：.pdf / .jpg / .jpeg / .png`,
    }
  }

  // ── PDF 路径：Method B 直接打印 ──────────────────────────────────────────
  if (PDF_EXTENSIONS.has(ext)) {
    log(`print [auto]: PDF → Method B  file=${filePath}  printer=${printerName}`)
    return printWithPdfToPrinter(filePath, printerName)
  }

  // ── 图片路径（JPG/PNG）：pdfkit 转换 → Method B ──────────────────────────
  if (IMAGE_EXTENSIONS_SUPPORTED.has(ext)) {
    log(`print [auto]: ${ext} → pdfkit → Method B  file=${filePath}  printer=${printerName}`)

    let tempPdfPath: string | undefined
    try {
      tempPdfPath = await imageToPdf(filePath)
      return await printWithPdfToPrinter(tempPdfPath, printerName)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        success: false,
        method: 'pdf-to-printer',
        printer: printerName,
        file: filePath,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        errorCode: 'PRINT_COMMAND_FAILED',
        errorMessage: `图片转 PDF 失败：${msg}`,
      }
    } finally {
      if (tempPdfPath) {
        cleanupTempPdf(tempPdfPath)
      }
    }
  }

  // ── 兜底（不应到达此处，SUPPORTED_EXTENSIONS 已过滤）────────────────────
  return {
    success: false,
    method: 'pdf-to-printer',
    printer: printerName,
    file: filePath,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    errorCode: 'UNSUPPORTED_FILE_TYPE',
    errorMessage: `未处理的扩展名：${ext}`,
  }
}
