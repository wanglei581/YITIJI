export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 后端返回的 previewUrl 是 /api/v1/... 相对签名地址，Admin dev server 需拼到 API 源。 */
export function resolvePreviewUrl(previewUrl: string): string {
  if (/^(https?:|data:|blob:)/.test(previewUrl)) return previewUrl
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return previewUrl.startsWith('/') ? `${origin}${previewUrl}` : previewUrl
}
import { API_BASE_URL } from '../../services/api/client'
