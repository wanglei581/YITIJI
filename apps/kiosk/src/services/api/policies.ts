// ============================================================
// Kiosk 政策服务 Service(阶段1D)
//
// API_MODE=http → 真实后端 GET /policies(只读 approved+published)
// API_MODE=mock → 内存演示数据(明示为演示)
//
// 数据流:Partner 录入 → Admin 审核/发布 → 本服务只读展示。
// 合规:info-only;政策说明 + 官方入口,不承诺补贴到账、不代申请。
// ============================================================

import { API_BASE_URL, API_MODE } from './client'

export interface PolicyPostView {
  id: string
  kind: string // 'policy_guide' | 'notice'
  title: string
  summary?: string
  content?: string
  audience?: string
  category?: string
  externalUrl?: string
  publishedDate?: string
  sourceName: string
  syncTime: string
}

/**
 * 服务端已发布政策数(可能大于本次取回条数)。
 * /policies 单页上限 200,超过部分不会静默消失 —— 页面据此如实说明。
 */
export interface PublishedPoliciesResult {
  items: PolicyPostView[]
  /** 服务端 total;拿不到时回退为本次取回条数(不虚构)。 */
  total: number
}

export interface PolicyQueryParams {
  kind?: string
  audience?: string
  category?: string
}

async function fetchPolicies(params?: PolicyQueryParams): Promise<PublishedPoliciesResult> {
  const query = new URLSearchParams()
  if (params?.kind) query.set('kind', params.kind)
  if (params?.audience) query.set('audience', params.audience)
  if (params?.category) query.set('category', params.category)
  const qs = query.toString()
  const res = await fetch(`${API_BASE_URL}/policies${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`请求失败（${res.status}）`)
  const body = (await res.json()) as {
    data: PolicyPostView[]
    pagination?: { total?: number }
  }
  const items = body.data
  const total = typeof body.pagination?.total === 'number' ? body.pagination.total : items.length
  return { items, total }
}

const now = () => new Date().toISOString()

/** mock 演示数据(无后端时让页面可走通,内容明示为演示)。 */
const MOCK_POLICIES: PolicyPostView[] = [
  {
    id: 'kp-1', kind: 'policy_guide', title: '高校毕业生就业服务指引(演示数据)',
    summary: '演示数据:毕业年度内可在户籍地或常住地办理就业登记,享受就业指导服务。',
    audience: 'graduate', sourceName: '演示机构', syncTime: now(), publishedDate: '2026-06-01',
  },
  {
    id: 'kp-2', kind: 'policy_guide', title: '职业技能培训报名指引(演示数据)',
    summary: '演示数据:可关注当地人社部门发布的补贴性培训目录,按指引报名。',
    audience: 'migrant', sourceName: '演示机构', syncTime: now(), publishedDate: '2026-05-25',
  },
  {
    id: 'kp-3', kind: 'notice', title: '就业服务月活动安排(演示数据)',
    summary: '演示数据:接入真实后端后,此处展示合作机构发布、管理员审核通过的政策公告。',
    category: 'notice', sourceName: '演示机构', syncTime: now(), publishedDate: '2026-06-05',
  },
]

function filterMock(params?: PolicyQueryParams): PolicyPostView[] {
  return MOCK_POLICIES.filter((item) => {
    if (params?.kind && item.kind !== params.kind) return false
    if (params?.audience && item.audience !== params.audience) return false
    if (params?.category && item.category !== params.category) return false
    return true
  })
}

export async function getPublishedPolicies(params?: PolicyQueryParams): Promise<PublishedPoliciesResult> {
  if (API_MODE !== 'http') {
    const items = filterMock(params)
    return { items, total: items.length }
  }
  return fetchPolicies(params)
}
