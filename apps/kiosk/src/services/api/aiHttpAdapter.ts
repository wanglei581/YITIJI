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
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

// ──────────────────────────────────────────────────────────────
// 核心 fetch 封装
// ──────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
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
  async submitResumeParse(req: ResumeParseRequest): Promise<ResumeParseResponse> {
    return post<ResumeParseResponse>('/resume/parse', req)
  },

  async getResumeRecord(taskId: string): Promise<ResumeParseResponse> {
    return get<ResumeParseResponse>(`/resume/records/${taskId}`)
  },

  async getResumeOptimize(taskId: string): Promise<ResumeOptimizeResponse> {
    return get<ResumeOptimizeResponse>(`/resume/records/${taskId}/optimize`)
  },

  async chatWithAssistant(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    return post<AssistantChatResponse>('/assistant/chat', req)
  },
}
