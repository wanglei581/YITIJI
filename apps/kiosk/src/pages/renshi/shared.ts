import type { PolicyPostView } from '../../services/api/policies'
import { policyPublishedOn } from './policyFacts'
import {
  BriefcaseIcon,
  Building2Icon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  MapPinIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TabKey = 'policy' | 'eligibility' | 'social' | 'register' | 'notice'
const VALID_TABS = new Set<TabKey>(['policy', 'eligibility', 'social', 'register', 'notice'])

export function getInitialTab(searchParams: URLSearchParams): TabKey {
  const tab = searchParams.get('tab')
  return tab && VALID_TABS.has(tab as TabKey) ? (tab as TabKey) : 'policy'
}

/** 政策匹配筛选：身份分组，与后端 POLICY_AUDIENCES 对齐。'all' 显示全部；'general' 为通用事项（任何身份都展示）。 */
export type AudienceKey = 'all' | 'graduate' | 'flexible' | 'migrant' | 'startup' | 'hardship'

export const AUDIENCE_CHIPS: { key: AudienceKey; label: string; icon: LucideIcon }[] = [
  { key: 'all', label: '全部', icon: UsersIcon },
  { key: 'graduate', label: '高校毕业生', icon: GraduationCapIcon },
  { key: 'flexible', label: '灵活就业', icon: BriefcaseIcon },
  { key: 'migrant', label: '返乡务工', icon: MapPinIcon },
  { key: 'startup', label: '创业人员', icon: Building2Icon },
  { key: 'hardship', label: '困难群体', icon: HeartHandshakeIcon },
]

/** 统一政策事项模型：内置办事指引模板 + 后端发布政策（kind=policy_guide）合并后的展示形态。 */
export type TagTone = 'amber' | 'slate'
export interface PolicyItem {
  id: string
  /** 命中的身份分组；'general' = 通用（任何身份都展示）。 */
  audiences: string[]
  tagLabel: string
  tagTone: TagTone
  title: string
  summary: string
  /** 内置模板的结构化内容；后端发布项可能仅有 content。 */
  conditions?: string[]
  materials?: string[]
  steps?: string[]
  content?: string
  officialUrl?: string
  sourceName: string
  /** 接口原样。缺了页面写「—」，不用另一项顶上。 */
  syncTime?: string
  externalId?: string
  /** 优先 publishedDate，没有再用确认发布时间。同步时间不拿来填。 */
  publishedDate?: string
  updatedAt?: string
}

/** 后端发布政策 → 统一展示模型。审核发布内容为准，内置模板为补充。 */
export function fromPublished(p: PolicyPostView): PolicyItem {
  const known = ['graduate', 'flexible', 'migrant', 'startup', 'hardship']
  const audiences = p.audience && known.includes(p.audience) ? [p.audience] : ['general']
  return {
    id: p.id,
    audiences,
    tagLabel: '政策发布',
    tagTone: 'slate',
    title: p.title,
    summary: p.summary ?? '',
    content: p.content,
    officialUrl: p.externalUrl,
    sourceName: p.sourceName,
    syncTime: p.syncTime,
    externalId: p.externalId?.trim() || undefined,
    publishedDate: policyPublishedOn(p),
    updatedAt: p.publishedDate ?? p.syncTime?.slice(0, 10),
  }
}

export const matchAudience = (item: PolicyItem, sel: AudienceKey) =>
  sel === 'all' || item.audiences.includes(sel) || item.audiences.includes('general')

/** 公告标签展示元信息（数据本体来自后端 PolicyPost kind=notice）。 */
export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  policy: { label: '政策', color: 'bg-warning/20 text-warning-fg' },
  announcement: { label: '公告', color: 'bg-success-bg text-success-fg' },
  notice: { label: '通知', color: 'bg-primary-100 text-primary-700' },
  recruitment: { label: '招募', color: 'bg-warning-bg text-warning-fg' },
}


