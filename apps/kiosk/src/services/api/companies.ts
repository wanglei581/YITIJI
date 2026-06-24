// ============================================================
// Kiosk 企业展示 Service（找企业 / 企业详情 / 企业在招岗位）。
//
// 合规定位（长期红线）：企业展示 = 来源企业与岗位导览，不是招聘平台。
// 只读「已审核 + 已发布」数据；列表/统计来自后端真实聚合。
// /companies/filters 仅保留为兼容/诊断接口；Kiosk 完整筛选字典来自 shared 行政区划/类型字典。
// 本文件没有也不允许出现任何写死的企业、岗位数量、城市统计。
// mock 模式诚实失败（页面显示连接后端提示），不提供假企业数据。
// ============================================================

import type {
  CompanyCardDTO,
  CompanyDetailDTO,
  CompanyFiltersDTO,
  CompanyJobItemDTO,
  CompanyStatsDTO,
  MemberAssetPage,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'

export interface CompanyQuery {
  keyword?: string
  province?: string
  city?: string
  district?: string
  companyType?: string
  industry?: string
  recruitType?: string
  sourceKind?: string
  cursor?: string | null
  pageSize?: number
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}

async function get<T>(path: string): Promise<T> {
  if (API_MODE !== 'http') {
    // 不提供假企业数据：mock 模式诚实失败，由页面展示「需连接后端」错误态
    throw new Error('COMPANIES_REQUIRES_BACKEND')
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP_${res.status}`)
  const body = (await res.json()) as { data: T }
  return body.data
}

/** 找企业列表（游标分页）。 */
export function getCompanies(q: CompanyQuery): Promise<MemberAssetPage<CompanyCardDTO>> {
  return get(`/companies${qs({ ...q })}`)
}

/** 统计条（真实聚合，跟随当前筛选）。 */
export function getCompanyStats(q: Omit<CompanyQuery, 'cursor' | 'pageSize'>): Promise<CompanyStatsDTO> {
  return get(`/companies/stats${qs({ ...q })}`)
}

/** 兼容/诊断接口：真实已发布数据聚合；当前 Kiosk 页面不再用它生成完整筛选项。 */
export function getCompanyFilters(): Promise<CompanyFiltersDTO> {
  return get('/companies/filters')
}

/** 企业详情（指标已按后台开关过滤）。 */
export function getCompanyById(id: string): Promise<CompanyDetailDTO> {
  return get(`/companies/${encodeURIComponent(id)}`)
}

/** 企业在招岗位（已发布）。 */
export function getCompanyJobs(
  id: string,
  opts?: { cursor?: string | null; pageSize?: number },
): Promise<MemberAssetPage<CompanyJobItemDTO>> {
  return get(`/companies/${encodeURIComponent(id)}/jobs${qs({ cursor: opts?.cursor, pageSize: opts?.pageSize })}`)
}
