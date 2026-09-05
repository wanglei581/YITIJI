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
  GeneratedResume,
  ResumeExportFormat,
  ResumeGenerateExportResponse,
  ResumeLayoutSettings,
  ResumeGenerateInput,
  ResumeGenerateResponse,
  ResumeVoiceTranscribeResponse,
  ResumeParseRequest,
  ResumeParseResponse,
  ResumeOptimizeResponse,
  AssistantChatRequest,
  AssistantChatResponse,
} from '@ai-job-print/shared'
import type { ResumeLayoutAdjustAction, ResumeLayoutAdjustResponse, ResumeReadAccess } from './ai'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL } from './client'
import { getTerminalId } from './screensaver'
import { ApiHttpError } from './httpAdapter'

/** 普通读写（查记录、导出 PDF） */
const DEFAULT_TIMEOUT_MS = 15_000
/**
 * 对齐后端 `LLM_LONG_TIMEOUT_MS` 默认 90s，略加余量，避免前端先 abort
 * 而后端仍在算（AI-01）。助手默认档 45s 也落在此上限内。
 */
const LLM_TIMEOUT_MS = 100_000

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
// 核心 fetch 封装（LLM 路由用长超时，普通读写用短超时）
// ──────────────────────────────────────────────────────────────

async function get<T>(path: string, access?: ResumeReadAccess, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const ac = new AbortController()
  const timerId = setTimeout(() => ac.abort(), timeoutMs)
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
      throw new ApiHttpError('REQUEST_TIMEOUT', `请求超时（${timeoutMs / 1000}s）`, 408)
    }
    throw err
  }
  clearTimeout(timerId)
  if (!res.ok) {
    let code    = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code    = body.error?.code    ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (isMemberSessionInvalidError(res.status, code, Boolean(access?.token))) notifyMemberSessionExpired(access?.token ?? undefined)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

/** 空对象表示本机没有已验证的终端身份（Agent 未就绪），此时不发这个头。 */
function terminalHeader(): Record<string, string> {
  const terminalId = getTerminalId()
  return terminalId ? { 'X-Terminal-Id': terminalId } : {}
}

async function post<T>(path: string, body: unknown, token?: string | null, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const ac = new AbortController()
  const timerId = setTimeout(() => ac.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // 限流与日配额的「终端」维度（后端 @TerminalScopedThrottle +
        // AiPublicQuotaService）。同一大厅多台机器共用 NAT 出口 IP，不带这个头
        // 就会共用一份 AI 额度。取不到本机终端身份时不发，后端退化回按 IP 计数。
        ...terminalHeader(),
      },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: ac.signal,
    })
  } catch (err) {
    clearTimeout(timerId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiHttpError('REQUEST_TIMEOUT', `请求超时（${timeoutMs / 1000}s）`, 408)
    }
    throw err
  }
  clearTimeout(timerId)
  if (!res.ok) {
    let code    = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body2 = (await res.json()) as { error?: { code?: string; message?: string } }
      code    = body2.error?.code    ?? code
      message = body2.error?.message ?? message
    } catch { /* keep defaults */ }
    if (isMemberSessionInvalidError(res.status, code, Boolean(token))) notifyMemberSessionExpired(token ?? undefined)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function postWithAccess<T>(path: string, body: unknown, access?: ResumeReadAccess, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const ac = new AbortController()
  const timerId = setTimeout(() => ac.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...accessHeaders(access),
      },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: ac.signal,
    })
  } catch (err) {
    clearTimeout(timerId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiHttpError('REQUEST_TIMEOUT', `请求超时（${timeoutMs / 1000}s）`, 408)
    }
    throw err
  }
  clearTimeout(timerId)
  if (!res.ok) {
    let code    = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body2 = (await res.json()) as { error?: { code?: string; message?: string } }
      code    = body2.error?.code    ?? code
      message = body2.error?.message ?? message
    } catch { /* keep defaults */ }
    if (isMemberSessionInvalidError(res.status, code, Boolean(access?.token))) notifyMemberSessionExpired(access?.token ?? undefined)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function postForm<T>(path: string, body: FormData, timeoutMs = LLM_TIMEOUT_MS): Promise<T> {
  const ac = new AbortController()
  const timerId = setTimeout(() => ac.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      body,
      signal: ac.signal,
    })
  } catch (err) {
    clearTimeout(timerId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiHttpError('REQUEST_TIMEOUT', `请求超时（${timeoutMs / 1000}s）`, 408)
    }
    throw err
  }
  clearTimeout(timerId)
  if (!res.ok) {
    let code    = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
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
    return post<ResumeParseResponse>('/resume/parse', req, token, LLM_TIMEOUT_MS)
  },

  async getResumeRecord(taskId: string, access?: ResumeReadAccess): Promise<ResumeParseResponse> {
    return get<ResumeParseResponse>(`/resume/records/${taskId}`, access)
  },

  async getResumeOptimize(taskId: string, access?: ResumeReadAccess): Promise<ResumeOptimizeResponse> {
    return get<ResumeOptimizeResponse>(`/resume/records/${taskId}/optimize`, access, LLM_TIMEOUT_MS)
  },

  async adjustResumeLayoutDraft(
    taskId: string,
    resume: GeneratedResume,
    action: ResumeLayoutAdjustAction,
    layout: ResumeLayoutSettings,
    access?: ResumeReadAccess,
  ): Promise<ResumeLayoutAdjustResponse> {
    return postWithAccess<ResumeLayoutAdjustResponse>(
      `/resume/records/${taskId}/layout-adjust`,
      { resume, action, layout },
      access,
      LLM_TIMEOUT_MS,
    )
  },

  async chatWithAssistant(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    return post<AssistantChatResponse>('/assistant/chat', req, undefined, LLM_TIMEOUT_MS)
  },

  // ── 阶段2A AI 简历生成 ──────────────────────────────────────

  async submitResumeGenerate(input: ResumeGenerateInput, token?: string | null): Promise<ResumeGenerateResponse> {
    return post<ResumeGenerateResponse>('/resume/generate', input, token, LLM_TIMEOUT_MS)
  },

  async getResumeGenerate(taskId: string, access?: ResumeReadAccess): Promise<ResumeGenerateResponse> {
    return get<ResumeGenerateResponse>(`/resume/generate/${taskId}`, access)
  },

  async transcribeResumeVoice(audio: Blob): Promise<ResumeVoiceTranscribeResponse> {
    const form = new FormData()
    form.append('audio', audio, 'resume-voice.wav')
    return postForm<ResumeVoiceTranscribeResponse>('/resume/voice/transcribe', form)
  },

  async exportGeneratedResume(
    resume: GeneratedResume,
    taskId?: string,
    token?: string | null,
    format?: ResumeExportFormat,
    layout?: ResumeLayoutSettings,
    templateId?: string,
    draft?: boolean,
  ): Promise<ResumeGenerateExportResponse> {
    return post<ResumeGenerateExportResponse>(
      '/resume/generate/export',
      { ...resume, ...(taskId ? { taskId } : {}), format: format ?? 'pdf', ...(layout ? { layout } : {}), ...(templateId ? { templateId } : {}), ...(draft ? { draft: true } : {}) },
      token,
    )
  },
}
