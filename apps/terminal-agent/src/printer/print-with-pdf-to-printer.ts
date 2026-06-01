import path from 'path'
import type { PrintOptions } from 'pdf-to-printer'
import { PrintResult, PrintErrorCode, PrintJobParams } from './types'
import { PRINT_TIMEOUT_MS } from '../config'

/**
 * Method B — pdf-to-printer (bundles SumatraPDF)
 *
 * W7: PrintJobParams are now mapped to SumatraPDF PrintOptions. Verified fields:
 *   copies       → PrintOptions.copies
 *   colorMode    → PrintOptions.monochrome (black_white → true)
 *   duplex       → PrintOptions.side (simplex/duplexlong/duplexshort)
 *   orientation  → PrintOptions.orientation (portrait/landscape; auto = omit)
 *   scale        → PrintOptions.scale (fit/noscale; actual → noscale)
 *   pageRange    → PrintOptions.pages
 * Pending Windows true-machine verification:
 *   pagesPerSheet — no direct SumatraPDF support via pdf-to-printer
 *   quality       — needs DEVMODE; no SumatraPDF equivalent
 */

function mapParams(params: Partial<PrintJobParams>): Partial<PrintOptions> {
  const opts: Partial<PrintOptions> = {}

  if (params.copies !== undefined && params.copies > 0) {
    opts.copies = params.copies
  }

  if (params.colorMode === 'black_white') {
    opts.monochrome = true
  }

  if (params.duplex === 'simplex') {
    opts.side = 'simplex'
  } else if (params.duplex === 'duplex_long_edge') {
    opts.side = 'duplexlong'
  } else if (params.duplex === 'duplex_short_edge') {
    opts.side = 'duplexshort'
  }

  if (params.orientation === 'portrait') {
    opts.orientation = 'portrait'
  } else if (params.orientation === 'landscape') {
    opts.orientation = 'landscape'
  }
  // 'auto' → omit (let driver decide)

  if (params.scale === 'fit') {
    opts.scale = 'fit'
  } else if (params.scale === 'actual') {
    opts.scale = 'noscale'
  }

  if (params.pageRange && params.pageRange !== 'all') {
    opts.pages = params.pageRange
  }

  return opts
}

export async function printWithPdfToPrinter(
  filePath: string,
  printerName: string,
  params?: Partial<PrintJobParams>,
): Promise<PrintResult> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const method = 'pdf-to-printer' as const

  const ext = path.extname(filePath).toLowerCase()

  const sumatraFormats = new Set(['.pdf', '.xps', '.cbz', '.cbr', '.djvu'])
  if (!sumatraFormats.has(ext)) {
    return {
      success: false, method, printer: printerName, file: filePath,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0,
      errorCode: 'UNSUPPORTED_FILE_TYPE',
      errorMessage: `pdf-to-printer does not support ${ext}; use Method A (powershell) for images`,
    }
  }

  const printOptions: PrintOptions = {
    printer: printerName,
    ...(params ? mapParams(params) : {}),
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ptp = require('pdf-to-printer') as {
      print: (file: string, options?: PrintOptions) => Promise<void>
    }

    // SumatraPDF exits after spooling (not after physical print). Guard against driver hangs.
    await Promise.race([
      ptp.print(filePath, printOptions),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PRINT_TIMEOUT')), PRINT_TIMEOUT_MS),
      ),
    ])

    return {
      success: true, method, printer: printerName, file: filePath,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0,
    }
  } catch (e: unknown) {
    const finishedAt = new Date().toISOString()
    const durationMs = Date.now() - t0
    const msg = e instanceof Error ? e.message : String(e)

    const isTimeout = msg === 'PRINT_TIMEOUT' || durationMs >= PRINT_TIMEOUT_MS
    const errorCode: PrintErrorCode = isTimeout ? 'PRINT_TIMEOUT' : 'PRINT_COMMAND_FAILED'

    return {
      success: false, method, printer: printerName, file: filePath,
      startedAt, finishedAt, durationMs,
      errorCode,
      errorMessage: isTimeout ? `打印超时（${PRINT_TIMEOUT_MS / 1000}s）` : msg,
    }
  }
}
