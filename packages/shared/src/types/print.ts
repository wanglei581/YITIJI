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
 * All fields correspond to CM2820ADN capabilities.
 * paperSize is 'A4' only — CM2820ADN does NOT support A3.
 */
export interface PrintJobParams {
  /** 1–99 */
  copies: number
  colorMode: ColorMode
  duplex: DuplexMode
  /** Locked to 'A4'. CM2820ADN does not support A3 or larger. */
  paperSize: 'A4'
  /** omit = all pages; custom range e.g. '1-3,5,7-9' */
  pageRange?: string
  orientation: PrintOrientation
  quality: PrintQuality
  scale: PrintScale
  pagesPerSheet: PagesPerSheet
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
