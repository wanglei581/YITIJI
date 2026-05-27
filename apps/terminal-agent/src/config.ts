/**
 * 打印机名称配置项（Phase 8.1A）。
 * 必须通过此配置项传入，禁止在代码中硬编码具体型号字符串。
 * Phase 8.1B 起将从 Agent 注册信息或配置文件动态读取。
 */
export const DEFAULT_PRINTER = 'Pantum CM2800ADN Series'

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
