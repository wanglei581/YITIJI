export const DEFAULT_PRINTER = 'Pantum CM2820ADN'

export const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.tiff',
  '.tif',
])

/** ms before we treat a print job as timed out */
export const PRINT_TIMEOUT_MS = 60_000
