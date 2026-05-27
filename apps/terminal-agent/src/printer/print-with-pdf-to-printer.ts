import path from 'path'
import { PrintResult, PrintErrorCode } from './types'
import { PRINT_TIMEOUT_MS } from '../config'

/**
 * Method B — pdf-to-printer (bundles SumatraPDF)
 *
 * Uses the `pdf-to-printer` npm package which ships SumatraPDF.exe as a
 * bundled binary. SumatraPDF accepts the target printer name via -print-to,
 * giving us reliable per-printer routing without needing a system PDF reader.
 *
 * Supported file types: PDF, XPS, CBZ, CBR, DjVu (SumatraPDF native formats).
 * Images (JPG/PNG) are NOT supported by this method — use Method A for those.
 *
 * Advantages over Method A:
 *  - Printer name is passed directly to SumatraPDF, not through shell verbs
 *  - Works even if no PDF reader is registered in Windows
 *  - Reproducible across machines (no dependency on installed apps)
 *
 * Limitations:
 *  - Images (.jpg, .png) are not supported; only PDF and SumatraPDF formats
 *  - The pdf-to-printer package must be installed (bundled SumatraPDF ~6 MB)
 *  - SumatraPDF exits after submitting to spooler, not after physical print
 */
export async function printWithPdfToPrinter(
  filePath: string,
  printerName: string,
): Promise<PrintResult> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const method = 'pdf-to-printer' as const

  const ext = path.extname(filePath).toLowerCase()

  // pdf-to-printer only handles PDF (and other SumatraPDF formats)
  const sumatraFormats = new Set(['.pdf', '.xps', '.cbz', '.cbr', '.djvu'])
  if (!sumatraFormats.has(ext)) {
    return {
      success: false, method, printer: printerName, file: filePath,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0,
      errorCode: 'UNSUPPORTED_FILE_TYPE',
      errorMessage: `pdf-to-printer does not support ${ext}; use Method A (powershell) for images`,
    }
  }

  try {
    // Dynamic import so the module is optional — if not installed, we fall back gracefully
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ptp = require('pdf-to-printer') as {
      print: (file: string, options?: { printer?: string; timeout?: number }) => Promise<void>
    }

    await ptp.print(filePath, {
      printer: printerName,
      timeout: PRINT_TIMEOUT_MS,
    })

    return {
      success: true, method, printer: printerName, file: filePath,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0,
    }
  } catch (e: unknown) {
    const finishedAt = new Date().toISOString()
    const durationMs = Date.now() - t0
    const msg = e instanceof Error ? e.message : String(e)

    let errorCode: PrintErrorCode = 'PRINT_COMMAND_FAILED'
    if (msg.includes('Cannot find module')) {
      errorCode = 'PRINT_COMMAND_FAILED'
    } else if (durationMs >= PRINT_TIMEOUT_MS) {
      errorCode = 'PRINT_TIMEOUT'
    }

    return {
      success: false, method, printer: printerName, file: filePath,
      startedAt, finishedAt, durationMs,
      errorCode,
      errorMessage: msg,
    }
  }
}
