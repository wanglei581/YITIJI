// ============================================================
// HTTP Adapter — Phase 7.2
//
// 通过 fetch 调用真实后端 /api/v1 接口。
// 实现与 mockAdapter 完全相同的 JobFairServiceInterface，
// 切换时页面层零改动。
//
// 设计原则：
// - 非 2xx 响应不 fallback 到 mock，直接抛出 ApiHttpError
// - 不在响应中暴露 apiSecret / accessToken / 原始 fileUrl 等敏感字段
//   （这些字段由后端服务屏蔽，前端只消费 DTO）
// - 超时后同样抛出错误，不降级
// ============================================================

import type {
  ApiResponse,
  PaginatedResponse,
  ExternalJobFairDTO,
  FairCompanyDTO,
  FairZoneDTO,
  FairBoothDTO,
  FairMaterialDTO,
  FairLiveStatsDTO,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './client'

// ──────────────────────────────────────────────────────────────
// 错误类型
// ──────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────
// 核心 fetch 封装
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

export const httpJobFairAdapter = {
  async getJobFairs(
    params?: { status?: string },
  ): Promise<PaginatedResponse<ExternalJobFairDTO>> {
    const query: Record<string, string> = {}
    if (params?.status) query.status = params.status
    return get<PaginatedResponse<ExternalJobFairDTO>>('/job-fairs', query)
  },

  async getJobFairById(id: string): Promise<ApiResponse<ExternalJobFairDTO | null>> {
    return get<ApiResponse<ExternalJobFairDTO | null>>(`/job-fairs/${id}`)
  },

  async getFairCompanies(fairId: string): Promise<PaginatedResponse<FairCompanyDTO>> {
    return get<PaginatedResponse<FairCompanyDTO>>(`/job-fairs/${fairId}/companies`)
  },

  async getFairCompanyById(
    fairId: string,
    companyId: string,
  ): Promise<ApiResponse<FairCompanyDTO | null>> {
    return get<ApiResponse<FairCompanyDTO | null>>(
      `/job-fairs/${fairId}/companies/${companyId}`,
    )
  },

  async getFairZones(fairId: string): Promise<ApiResponse<FairZoneDTO[]>> {
    return get<ApiResponse<FairZoneDTO[]>>(`/job-fairs/${fairId}/zones`)
  },

  async getFairMap(
    fairId: string,
  ): Promise<ApiResponse<{ zones: FairZoneDTO[]; booths: FairBoothDTO[] }>> {
    return get<ApiResponse<{ zones: FairZoneDTO[]; booths: FairBoothDTO[] }>>(
      `/job-fairs/${fairId}/map`,
    )
  },

  async getFairMaterials(fairId: string): Promise<PaginatedResponse<FairMaterialDTO>> {
    return get<PaginatedResponse<FairMaterialDTO>>(`/job-fairs/${fairId}/materials`)
  },

  async getFairStats(fairId: string): Promise<ApiResponse<FairLiveStatsDTO | null>> {
    return get<ApiResponse<FairLiveStatsDTO | null>>(`/job-fairs/${fairId}/stats`)
  },
}
