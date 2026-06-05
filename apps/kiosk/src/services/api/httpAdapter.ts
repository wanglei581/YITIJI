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
  // API_BASE_URL 可能是相对路径（如 /api/v1，走 vite 代理）或绝对地址。
  // new URL() 处理相对路径必须带 base；绝对地址时 base 会被忽略，两种配置都正确。
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin)
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
// 后端 wire 形状 → 展示 DTO 的字段对齐
//
// 后端 FairCompany / FairZone 子端点返回的是"精简 Prisma 镜像"
// （name / industry:null / jobsCount / category ...），而 Kiosk 页面读取的是
// 富展示 DTO（companyName / industry:string / positions[] / checkinStatus /
// zoneName / boothCount ...）。早期子端点是空 stub，掩盖了这层差异；接真数据后
// 必须在适配层做字段对齐，否则页面读 c.companyName / c.industry.toLowerCase()
// 会拿到 undefined 或对 null 调用方法而崩页。
//
// 模型暂无的字段（现场签到 / 展位 / 岗位明细）按合规与诚实原则给安全占位，
// 不硬造数据：positions=[]、checkinStatus='pending'、boothCount/checkedInCount=0。
// ──────────────────────────────────────────────────────────────

interface WireFairCompany {
  id: string
  jobFairId: string
  name: string
  logoUrl?: string | null
  industry?: string | null
  scale?: string | null
  description?: string | null
  sourceUrl?: string | null
  hiringTags?: string[]
  jobsCount?: number
}

interface WireFairZone {
  id: string
  jobFairId: string
  name: string
  category?: string | null
  city?: string | null
  description?: string | null
  coverImageUrl?: string | null
  sortOrder?: number
}

const VALID_SCALES: ReadonlyArray<FairCompanyDTO['scale']> = [
  'startup',
  'small',
  'medium',
  'large',
  'enterprise',
]

function coerceScale(scale?: string | null): FairCompanyDTO['scale'] {
  return scale && (VALID_SCALES as readonly string[]).includes(scale)
    ? (scale as FairCompanyDTO['scale'])
    : 'medium'
}

function mapWireCompany(c: WireFairCompany): FairCompanyDTO {
  return {
    id:            c.id,
    fairId:        c.jobFairId,
    companyName:   c.name,
    industry:      c.industry ?? '',
    scale:         coerceScale(c.scale),
    description:   c.description ?? undefined,
    sourceUrl:     c.sourceUrl ?? undefined,
    coverImageUrl: c.logoUrl ?? undefined,
    // 模型无岗位明细 / 现场签到 → 安全占位，不硬造
    positions:     [],
    checkinStatus: 'pending',
    applyNote:     '如需了解更多，请扫码前往来源平台',
  }
}

function mapWireZone(z: WireFairZone, index: number): FairZoneDTO {
  return {
    id:             z.id,
    fairId:         z.jobFairId,
    zoneName:       z.name,
    description:    z.description ?? undefined,
    industry:       z.category ?? undefined,
    // 模型无展位 / 签到明细 → 0 占位
    boothCount:     0,
    checkedInCount: 0,
    sortOrder:      z.sortOrder ?? index,
  }
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
    const res = await get<PaginatedResponse<WireFairCompany>>(`/job-fairs/${fairId}/companies`)
    return { ...res, data: (res.data ?? []).map(mapWireCompany) }
  },

  async getFairCompanyById(
    fairId: string,
    companyId: string,
  ): Promise<ApiResponse<FairCompanyDTO | null>> {
    const res = await get<ApiResponse<WireFairCompany | null>>(
      `/job-fairs/${fairId}/companies/${companyId}`,
    )
    return { ...res, data: res.data ? mapWireCompany(res.data) : null }
  },

  async getFairZones(fairId: string): Promise<ApiResponse<FairZoneDTO[]>> {
    const res = await get<ApiResponse<WireFairZone[]>>(`/job-fairs/${fairId}/zones`)
    return { ...res, data: (res.data ?? []).map(mapWireZone) }
  },

  async getFairMap(
    fairId: string,
  ): Promise<ApiResponse<{ zones: FairZoneDTO[]; booths: FairBoothDTO[] }>> {
    const res = await get<
      ApiResponse<{ zones?: WireFairZone[]; booths?: FairBoothDTO[] } | null>
    >(`/job-fairs/${fairId}/map`)
    // 未发布 / 无数据时后端可能返回 data:null → 兜成空集合，页面落空态而非崩页
    return {
      ...res,
      data: {
        zones:  (res.data?.zones ?? []).map(mapWireZone),
        booths: res.data?.booths ?? [],
      },
    }
  },

  async getFairMaterials(fairId: string): Promise<PaginatedResponse<FairMaterialDTO>> {
    return get<PaginatedResponse<FairMaterialDTO>>(`/job-fairs/${fairId}/materials`)
  },

  async getFairStats(fairId: string): Promise<ApiResponse<FairLiveStatsDTO | null>> {
    return get<ApiResponse<FairLiveStatsDTO | null>>(`/job-fairs/${fairId}/stats`)
  },
}
