/**
 * 支持的文件扩展名（print.ts 路由覆盖范围）：
 *   .pdf                  → Method B 直接打印（已验证真实出纸）
 *   .jpg / .jpeg / .png   → pdfkit 临时 PDF → Method B（Phase 8.1A 支持）
 *   .bmp / .tiff / .tif   → Phase 8.1B+（需 sharp 预处理，当前返回 UNSUPPORTED_FILE_TYPE）
 */
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
