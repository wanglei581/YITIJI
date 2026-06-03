// ============================================================
// URL 校验工具
// ============================================================

/** 仅允许 http/https 的来源链接，防止 javascript: 等非法 scheme 进入二维码/跳转 */
export function isValidSourceUrl(url: string | undefined | null): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
