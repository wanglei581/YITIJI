// ============================================================
// 线下招聘机构 Service — G1 功能
//
// API 端点：
//   GET /api/v1/kiosk/offline-agencies  → 机构列表（支持分页 + 区域/服务筛选）
//   GET /api/v1/kiosk/offline-jobs/:id  → 线下岗位详情
//
// 合规约束（长期红线）：
//   - 只展示信息与到店指引，不代收简历，不代投递
//   - 按钮文案白名单：查看岗位 / 查看详情 / 到店咨询 / 获取指引 / 打印岗位信息带走
//   - mock 模式诚实失败（页面显示"需连接后端"提示），不提供假机构数据
// ============================================================

import { API_BASE_URL, API_MODE } from './client'

// ──────────────────────────────────────────────────────────────
// DTO 类型
// ──────────────────────────────────────────────────────────────

export interface OfflineAgencyDTO {
  id: string
  name: string
  type: string
  /** 'open' = 营业中；'rest' = 休息/临时关闭 */
  status: 'open' | 'rest'
  statusLabel: string
  address: string
  district: string
  distanceKm?: number
  hours: string
  services: string[]
  orgCode: string
  jobCount: number
  syncTime: string
}

export interface OfflineAgencyListResult {
  items: OfflineAgencyDTO[]
  total: number
  page: number
  pageSize: number
  stats: {
    totalAgencies: number
    openAgencies: number
    totalJobs: number
    districts: number
    lastSyncLabel: string
  }
}

export interface OfflineAgencyListParams {
  district?: string
  service?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export interface OfflineJobDTO {
  id: string
  title: string
  salary?: string
  jobType?: string
  industry?: string
  employer?: string
  location?: string
  completenessPercent?: number
  tags?: string[]
  responsibilities?: string[]
  requirements?: string[]
  agencyId: string
  agencyName: string
  agencyType: string
  agencyAddress: string
  agencyHours: string
  agencyPhone?: string
  agencyServices: string[]
  sourceName: string
  sourceType: string
  syncTime: string
  externalId: string
}

// ──────────────────────────────────────────────────────────────
// 内部工具
// ──────────────────────────────────────────────────────────────

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
    throw new Error('OFFLINE_AGENCIES_REQUIRES_BACKEND')
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP_${res.status}`)
  const body = (await res.json()) as { data: T }
  return body.data
}

// ──────────────────────────────────────────────────────────────
// 导出服务函数
// ──────────────────────────────────────────────────────────────

/** 线下招聘机构列表（带分页和筛选）。 */
export function getOfflineAgencies(params?: OfflineAgencyListParams): Promise<OfflineAgencyListResult> {
  return get(`/kiosk/offline-agencies${qs({ ...params })}`)
}

/** 线下岗位详情。 */
export function getOfflineJobById(id: string): Promise<OfflineJobDTO> {
  return get(`/kiosk/offline-jobs/${encodeURIComponent(id)}`)
}

// ──────────────────────────────────────────────────────────────
// 线下岗位详情 DTO（含机构信息）
// ──────────────────────────────────────────────────────────────
export interface OfflineJobDetailDTO extends OfflineJobDTO {
  agency: {
    id: string
    name: string
    orgType: string
    address: string
    phone?: string
    openHours?: string
    services: string
    status: 'open' | 'rest'
  }
}

/** 线下岗位详情（含机构信息）。 */
export function getOfflineJobDetail(id: string): Promise<OfflineJobDetailDTO> {
  return get(`/kiosk/offline-jobs/${encodeURIComponent(id)}`)
}
