/**
 * agent/scan-device/scan-pdf-compose.ts — 把一个任务目录里的扫描页合成一个 PDF
 *
 * 在 printer/image-to-pdf.ts 的 imagesToPdf 之上加屏上扫描的口径：A4 等比适配、页数上限 20、
 * 体积上限 18 MiB、输入只收任务目录下的 page-NNN.jpg。本批（A1）没有调用方。
 */

import path from 'path'
import { ImagesToPdfError, imagesToPdf } from '../../printer/image-to-pdf'
import { SCAN_MAX_PAGES_DEFAULT, type ScanDeviceErrorCode } from './wia-script'
import { SCAN_PAGE_FILE_PATTERN, assertScanTaskDir, getScanDeviceRoot, scanResultPdfPath } from './scan-temp-dir'

/** 后端 deliver 单文件上限 20 MiB，留出 multipart 开销，合成后超过 18 MiB 直接报 too_large。 */
export const SCAN_PDF_MAX_BYTES = 18 * 1024 * 1024

export type ComposeScanPdfResult =
  | { ok: true; path: string; pageCount: number; bytes: number }
  | { ok: false; errorCode: Extract<ScanDeviceErrorCode, 'too_large' | 'unknown'>; reason: string }

/**
 * 把一个任务目录里的扫描页合成 <taskDir>\scan.pdf：A4、等比适配、页序同输入。
 * 页数超过上限（默认 20）或合成后超过 18 MiB 都报 too_large，不做二次压缩，不留半成品。
 * 输入必须恰好是该任务目录下的 page-NNN.jpg，其它文件一律拒绝，免得把别处的文件塞进 PDF。
 */
export async function composeScanPdf(
  taskDir: string,
  pageFiles: readonly string[],
  options: { maxPages?: number; maxBytes?: number; root?: string } = {},
): Promise<ComposeScanPdfResult> {
  try {
    const dir = path.resolve(taskDir)
    assertScanTaskDir(dir, options.root ?? getScanDeviceRoot())
    for (const file of pageFiles) {
      const resolved = path.resolve(file)
      if (path.dirname(resolved) !== dir || !SCAN_PAGE_FILE_PATTERN.test(path.basename(resolved))) {
        return { ok: false, errorCode: 'unknown', reason: 'page_outside_task_dir' }
      }
    }
    const output = await imagesToPdf(pageFiles, {
      outputPath: scanResultPdfPath(dir),
      scale: 'fit',
      maxPages: options.maxPages ?? SCAN_MAX_PAGES_DEFAULT,
      maxBytes: options.maxBytes ?? SCAN_PDF_MAX_BYTES,
    })
    return { ok: true, ...output }
  } catch (error) {
    if (error instanceof ImagesToPdfError) {
      // 页数太多与体积太大，屏上都是同一句「页数太多，请分两次扫」。
      const tooLarge = error.code === 'too_large' || error.code === 'too_many_pages'
      return { ok: false, errorCode: tooLarge ? 'too_large' : 'unknown', reason: error.code }
    }
    return { ok: false, errorCode: 'unknown', reason: 'unexpected' }
  }
}
