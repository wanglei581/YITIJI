export type ApiMode = 'mock' | 'http'

export const API_MODE: ApiMode =
  (import.meta.env.VITE_API_MODE as ApiMode | undefined) === 'http' ? 'http' : 'mock'

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

// 生产构建禁止落到 mock：少传 / 写错 VITE_API_MODE 时，构建会**静默**打包 mock 适配器，
// 后台照样渲染出一整套假数据（假机构、假岗位、假价目、假法务文本），
// 运营人员会照着它决策。宁可当场炸，也不能发布一个说假话的后台。
// 口径与 apps/kiosk/src/services/api/client.ts 同源（那边 2026 年就装了这条，
// admin / partner 一直没有 —— 2026-09-09 实测两边各 0 处 PROD 断言）。
if (import.meta.env.PROD && API_MODE !== 'http') {
  throw new Error('[Partner API Client] 生产构建必须设置 VITE_API_MODE=http，禁止使用 mock API 模式')
}

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
