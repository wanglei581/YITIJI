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

async function fetchPolicies(): Promise<PolicyPostView[]> {
  const res = await fetch(`${API_BASE_URL}/policies`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP_${res.status}`)
  const body = (await res.json()) as { data: PolicyPostView[] }
  return body.data
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

export async function getPublishedPolicies(): Promise<PolicyPostView[]> {
  if (API_MODE !== 'http') {
    return [...MOCK_POLICIES]
  }
  return fetchPolicies()
}
