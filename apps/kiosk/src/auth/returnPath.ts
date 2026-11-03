export function isLoginPath(path: string): boolean {
  return path === '/login' || path.startsWith('/login?') || path.startsWith('/login#') || path.startsWith('/login/')
}

export function isSafeInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') && !isLoginPath(path)
}

export function loginPathForCurrentLocation(): string {
  if (typeof window === 'undefined') return '/login'
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const from = isSafeInternalPath(current) ? current : '/'
  return `/login?from=${encodeURIComponent(from)}`
}

/**
 * 打印链上的「去登录」：回跳地址只放路由路径，不带当前查询串、文件编号、打印链接、交接编号或到机码。
 * 确认页回来之后由打印交接上下文决定是哪一份文件（归属、有效期当场核对）。
 * 到机码认领回来之后由 sessionStorage 里的那一串接着认领，不写进 from。
 */
export function loginPathForPrintStep(step: 'confirm' | 'preview' | 'pickup'): string {
  const from = step === 'confirm'
    ? '/print/confirm'
    : step === 'preview'
      ? '/print/desk?step=preview'
      : '/print/pickup-claim'
  return `/login?from=${encodeURIComponent(from)}`
}
