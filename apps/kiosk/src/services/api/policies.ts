// ============================================================
// Kiosk 政策服务 Service(阶段1D)
//
// API_MODE=http → 真实后端 GET /policies(只读 approved+published)
// API_MODE=mock → 内存演示数据(明示为演示)
//
// 数据流:Partner 录入 → Admin 审核/发布 → 本服务只读展示。
// 合规:info-only;政策说明 + 官方入口,不承诺补贴到账、不代申请。
// ============================================================

import { terminalAttributedFetch } from '../terminalAuth'
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
  /** 发布方给的外部编号。没有就是空，页面写「—」，不编。 */
  externalId?: string | null
  publishedDate?: string
  /** 确认发布的时间。publishedDate 为空时，发布日期用它的日期部分。 */
  publishConfirmedAt?: string | null
  /**
   * 办事三栏（2026-11-05 政策最小闭环）：谁可以申请 / 要准备的材料 / 去哪办。
   * 机构发布时分开填，纯文本、每行一项。没给就是没提供，页面照实写「发布机构没有提供」，不从正文猜。
   */
  whoCanApply?: string
  requiredMaterials?: string
  whereToApply?: string
  /**
   * 原文链接是否落在发布机构登记的官方网站内（服务端按当前登记名单算）。
   * 只有 true 才给扫码；false 且有链接时写「不在发布机构登记的官方网站内」，没有链接写「没有提供原文链接」。
   */
  externalUrlVerified?: boolean
  /** 内容版本。办事清单按版本生成，版本变了旧清单作废。 */
  contentVersion?: number
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
  /** 服务端分页（2026-11-05 起列表按类别、一页 4 条翻页）。拿不到时按本次请求推算。 */
  page: number
  pageSize: number
  totalPages: number
}

export interface PolicyQueryParams {
  kind?: string
  audience?: string
  category?: string
  /** 第几页（从 1 起）。不传 = 服务端默认第 1 页。 */
  page?: number
  /** 每页条数（服务端上限 200）。不传 = 服务端默认 200。 */
  pageSize?: number
}

async function fetchPolicies(params?: PolicyQueryParams): Promise<PublishedPoliciesResult> {
  const query = new URLSearchParams()
  if (params?.kind) query.set('kind', params.kind)
  if (params?.audience) query.set('audience', params.audience)
  if (params?.category) query.set('category', params.category)
  if (params?.page) query.set('page', String(params.page))
  if (params?.pageSize) query.set('pageSize', String(params.pageSize))
  const qs = query.toString()
  const res = await terminalAttributedFetch(`${API_BASE_URL}/policies${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`请求失败（${res.status}）`)
  const body = (await res.json()) as {
    data: PolicyPostView[]
    pagination?: { total?: number; page?: number; pageSize?: number; totalPages?: number }
  }
  const items = body.data
  const total = typeof body.pagination?.total === 'number' ? body.pagination.total : items.length
  const page = typeof body.pagination?.page === 'number' ? body.pagination.page : (params?.page ?? 1)
  const pageSize = typeof body.pagination?.pageSize === 'number' ? body.pagination.pageSize : (params?.pageSize ?? Math.max(1, items.length))
  const totalPages = typeof body.pagination?.totalPages === 'number' ? body.pagination.totalPages : Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  return { items, total, page, pageSize, totalPages }
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
    summary: '演示数据：接上系统后，这里展示合作机构发布、审核通过的政策公告。',
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
    const all = filterMock(params)
    const pageSize = params?.pageSize ?? Math.max(1, all.length)
    const page = params?.page ?? 1
    const items = all.slice((page - 1) * pageSize, page * pageSize)
    return { items, total: all.length, page, pageSize, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) }
  }
  return fetchPolicies(params)
}

/** 按条打开一条已发布政策。404 是找不到或已不在可查看范围；其它失败不冒充「没有这条」。 */
export type PublishedPolicyLookup =
  | { status: 'found'; policy: PolicyPostView }
  | { status: 'missing' }
  | { status: 'failed' }

export async function getPublishedPolicy(id: string): Promise<PublishedPolicyLookup> {
  const trimmed = id.trim()
  if (!trimmed) return { status: 'missing' }
  if (API_MODE !== 'http') {
    const found = MOCK_POLICIES.find((item) => item.id === trimmed)
    return found ? { status: 'found', policy: found } : { status: 'missing' }
  }
  try {
    const res = await terminalAttributedFetch(`${API_BASE_URL}/policies/${encodeURIComponent(trimmed)}`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return { status: 'missing' }
    if (!res.ok) return { status: 'failed' }
    const body = (await res.json()) as { data?: PolicyPostView }
    if (!body.data?.id) return { status: 'failed' }
    return { status: 'found', policy: body.data }
  } catch {
    return { status: 'failed' }
  }
}
