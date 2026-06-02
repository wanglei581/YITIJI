// 管理员后台 — AI 大模型配置 API
import { API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type LlmVendor = 'deepseek' | 'qwen' | 'minimax'

export interface LlmPreset {
  vendor:       LlmVendor
  label:        string
  baseURL:      string
  defaultModel: string
  models:       string[]
  docsUrl:      string
}

export interface AiConfigView {
  vendor:           LlmVendor
  model:            string
  baseURL:          string
  systemPrompt:     string
  temperature:      number
  enabled:          boolean
  apiKeyConfigured: boolean
}

export interface AiConfigResponse {
  config:  AiConfigView
  presets: LlmPreset[]
}

export interface UpdateAiConfigBody {
  vendor?:       LlmVendor
  model?:        string
  baseURL?:      string
  systemPrompt?: string
  temperature?:  number
  enabled?:      boolean
  apiKey?:       string
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeader(),
    },
    credentials: 'include',
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const b = await res.json() as { error?: { code?: string; message?: string }; message?: string }
      if (b.error?.code)    code = b.error.code
      if (b.error?.message) message = b.error.message
      else if (b.message)   message = b.message
    } catch { /* keep defaults */ }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

export const aiConfigApi = {
  get:    (): Promise<AiConfigResponse> => request('/admin/ai-config', 'GET'),
  update: (body: UpdateAiConfigBody): Promise<AiConfigView> => request('/admin/ai-config', 'PUT', body),
  test:   (): Promise<{ ok: boolean; reply?: string; error?: string }> =>
            request('/admin/ai-config/test', 'POST', {}),
}
