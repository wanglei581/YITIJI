export type ApiMode = 'mock' | 'http'

export const API_MODE: ApiMode =
  (import.meta.env.VITE_API_MODE as ApiMode | undefined) === 'http' ? 'http' : 'mock'

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

if (import.meta.env.DEV && API_MODE === 'http' && !import.meta.env.VITE_API_BASE_URL) {
  console.warn('[Partner API Client] VITE_API_MODE=http 要求同时配置 VITE_API_BASE_URL，否则请求将发往 /api/v1')
}

/**
 * 服务端 origin（用于把后端返回的相对路径(如 webhookUrl)拼成绝对 URL）。
 * - VITE_API_BASE_URL 绝对(如 http://localhost:3010/api/v1) → http://localhost:3010
 * - VITE_API_BASE_URL 相对(默认 /api/v1) → 当前页面 origin（同源部署 / mock 模式）
 */
export const API_ORIGIN: string = (() => {
  const fallback = typeof window !== 'undefined' ? window.location.origin : ''
  try {
    return new URL(API_BASE_URL, fallback || 'http://localhost').origin
  } catch {
    return fallback
  }
})()

/**
 * 把 API 路径解析成可交给 `fetch` / `URL` 的绝对地址。
 * - 相对 `VITE_API_BASE_URL`（如 `/api/v1`）→ 相对当前页面 origin（同源 nginx 部署）
 * - 绝对 base → 保留该 host，不误用页面 origin
 * 禁止单参数 `new URL('/api/v1/...')`：相对 URL 会抛 Invalid URL。
 */
export function resolveApiUrl(path: string, searchParams?: Record<string, string>): string {
  const fallback = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const url = new URL(`${API_BASE_URL}${path}`, fallback)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

export class ApiHttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiHttpError'
  }
}
