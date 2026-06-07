// ============================================================
// AI HTTP Adapter — Phase 7 AI Service Layer
//
// 通过 fetch 调用真实后端 AI 服务接口。
// 实现与 aiMockAdapter 完全相同的 AiServiceInterface。
//
// 设计原则：
// - 非 2xx 响应直接抛出 ApiHttpError，不 fallback 到 mock
// - API Key 只在后端保存，前端不传递任何凭证
// - 合规：所有 AI 结果仅服务求职者本人
// ============================================================

import type {
  ResumeParseRequest,
  ResumeParseResponse,
  ResumeOptimizeResponse,
  AssistantChatRequest,
  AssistantChatResponse,
} from '@ai-job-print/shared'
import type { ResumeReadAccess } from './ai'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

const TIMEOUT_MS = 15_000

/**
 * 读取凭证 → 请求头（Phase C-2A）。
 * - token（会员 JWT）→ Authorization: Bearer
 * - accessToken（匿名一次性令牌）→ x-resume-access-token（绝不进 URL query）
 */
function accessHeaders(access?: ResumeReadAccess): Record<string, string> {
  const headers: Record<string, string> = {}
  if (access?.token) headers.Authorization = `Bearer ${access.token}`
  if (access?.accessToken) headers['x-resume-access-token'] = access.accessToken
  return headers
}

// ──────────────────────────────────────────────────────────────
// 核心 fetch 封装（带 15s AbortController 超时）
// ──────────────────────────────────────────────────────────────

async function get<T>(path: string, access?: ResumeReadAccess): Promise<T> {
  const ac = new AbortController()
  const timerId = setTimeout(() => ac.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...accessHeaders(access),
      },
      credentials: 'include',
      signal: ac.signal,
    })
  } catch (err) {
    clearTimeout(timerId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiHttpError('REQUEST_TIMEOUT', `请求超时（${TIMEOUT_MS / 1000}s）`, 408)
    }
    throw err
  }
  clearTimeout(timerId)
  if (!res.ok) {
    let code    = 'UNKNOWN_ERROR'
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code    = body.error?.code    ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const ac = new AbortController()
  const timerId = setTimeout(() => ac.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: ac.signal,
    })
  } catch (err) {
    clearTimeout(timerId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiHttpError('REQUEST_TIMEOUT', `请求超时（${TIMEOUT_MS / 1000}s）`, 408)
    }
    throw err
  }
  clearTimeout(timerId)
  if (!res.ok) {
    let code    = 'UNKNOWN_ERROR'
    let message = `HTTP ${res.status}`
    try {
      const body2 = (await res.json()) as { error?: { code?: string; message?: string } }
      code    = body2.error?.code    ?? code
      message = body2.error?.message ?? message
    } catch { /* keep defaults */ }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

// ──────────────────────────────────────────────────────────────
// HTTP Adapter 对象
// ──────────────────────────────────────────────────────────────

export const aiHttpAdapter = {
  async submitResumeParse(req: ResumeParseRequest, token?: string | null): Promise<ResumeParseResponse> {
    return post<ResumeParseResponse>('/resume/parse', req, token)
  },

  async getResumeRecord(taskId: string, access?: ResumeReadAccess): Promise<ResumeParseResponse> {
    return get<ResumeParseResponse>(`/resume/records/${taskId}`, access)
  },

  async getResumeOptimize(taskId: string, access?: ResumeReadAccess): Promise<ResumeOptimizeResponse> {
    return get<ResumeOptimizeResponse>(`/resume/records/${taskId}/optimize`, access)
  },

  async chatWithAssistant(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    return post<AssistantChatResponse>('/assistant/chat', req)
  },
}
