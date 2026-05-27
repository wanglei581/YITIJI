// ============================================================
// Job HTTP Adapter — Phase 7.3
//
// 通过 fetch 调用真实后端 /api/v1/jobs 接口。
// 实现与 jobMockAdapter 完全相同的 JobServiceInterface，
// 切换时页面层零改动。
//
// 设计原则（与 httpAdapter.ts 一致）：
// - 非 2xx 响应不 fallback 到 mock，直接抛出错误
// - 网络层错误直接传播，不捕获后降级
// ============================================================

import type { ApiResponse, PaginatedResponse, ExternalJobDTO } from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

// ──────────────────────────────────────────────────────────────
// 核心 fetch 封装（与 httpAdapter.ts 保持相同模式）
// ──────────────────────────────────────────────────────────────

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }

  const res = await fetch(url.toString(), {
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
    } catch {
      // response body is not JSON — keep defaults
    }
    throw new ApiHttpError(code, message, res.status)
  }

  return res.json() as Promise<T>
}

// ──────────────────────────────────────────────────────────────
// HTTP Adapter 对象
// ──────────────────────────────────────────────────────────────

export const jobHttpAdapter = {
  async getJobs(params?: { tag?: string }): Promise<PaginatedResponse<ExternalJobDTO>> {
    const query: Record<string, string> = {}
    if (params?.tag) query.tag = params.tag
    return get<PaginatedResponse<ExternalJobDTO>>('/jobs', query)
  },

  async getJobById(id: string): Promise<ApiResponse<ExternalJobDTO | null>> {
    return get<ApiResponse<ExternalJobDTO | null>>(`/jobs/${id}`)
  },
}
