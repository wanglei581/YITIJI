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
