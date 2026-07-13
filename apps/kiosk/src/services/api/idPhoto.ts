// ============================================================
// 证件照前端 API 薄封装 — Task 10
//
// POST /print/id-photo/layout、DELETE /print/id-photo/file/:fileId。
// 错误处理对齐同目录 printConversion.ts：ApiHttpError 保留后端 error.code 与 HTTP status。
// ============================================================

import type { IdPhotoLayoutRequest, IdPhotoLayoutResponse } from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

async function request<T>(path: string, init: RequestInit, emptyCode: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init)
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  let payload: ResponseEnvelope<T> | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<T>
  } catch {
    payload = null
  }
  if (!res.ok) {
    throw new ApiHttpError(payload?.error?.code ?? 'UNKNOWN_ERROR', payload?.error?.message ?? `请求失败（${res.status}）`, res.status)
  }
  if (!payload?.data) throw new ApiHttpError(emptyCode, '返回数据为空', res.status)
  return payload.data
}

export async function generateIdPhotoLayout(
  requestBody: IdPhotoLayoutRequest,
  options: { token: string | null; idempotencyKey: string },
): Promise<IdPhotoLayoutResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': options.idempotencyKey,
  }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  return request<IdPhotoLayoutResponse>('/print/id-photo/layout', {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  }, 'IDPHOTO_FAILED')
}

/** 手动删除（会员凭 token；游客凭 deleteToken，走请求体不进 URL）。幂等：已删除也返回成功。 */
export async function deleteIdPhotoFile(
  fileId: string,
  options: { token: string | null; deleteToken?: string | null },
): Promise<{ deleted: true }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  return request<{ deleted: true }>(`/print/id-photo/file/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(options.deleteToken ? { deleteToken: options.deleteToken } : {}),
  }, 'IDPHOTO_FAILED')
}

/** 原图 fileUrl（/api/v1/files/:id/content?...）→ 可 fetch 的完整地址。 */
export function resolveFileContentUrl(fileUrl: string): string {
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return `${origin}${fileUrl}`
}
