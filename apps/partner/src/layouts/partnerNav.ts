import type { NavItem } from '@ai-job-print/ui'
import {
  BarChart2Icon,
  BriefcaseIcon,
  Building2Icon,
  FileTextIcon,
  GaugeIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  MonitorIcon,
} from 'lucide-react'
import type { PartnerDataSourceCapabilities } from '../services/api'

/**
 * 侧栏按地址分组，不改路由。点菜单落到该组第一个地址；组内其余地址靠内容区标签切换。
 * 多地址对应同一个菜单时，KEY_TO_PATH 显式指定落地地址，不用反向表（反向表会落到组里最后一个地址）。
 */
export const PATH_TO_KEY: Record<string, string> = {
  '/':              'dashboard',
  '/profile':       'profile',
  '/account':       'profile',
  '/policy':        'policy',
  '/smart-campus':  'smart-campus',
  '/jobs':          'jobs',
  '/companies':     'jobs',
  '/fairs':         'jobs',
  '/sources':       'jobs',
  '/sync-logs':     'jobs',
  '/terminals':  'terminals',
  '/stats':         'stats',
  '/screen':        'screen',
}

export const KEY_TO_PATH: Record<string, string> = {
  dashboard: '/',
  profile: '/profile',
  policy: '/policy',
  'smart-campus': '/smart-campus',
  jobs: '/jobs',
  terminals: '/terminals',
  stats: '/stats',
  screen: '/screen',
}

export interface ConsoleTab {
  path: string
  label: string
}

/** 有标签组的菜单。数组第一项是点侧栏时的落地页，也是默认标签。 */
export const TAB_GROUPS: Record<string, readonly ConsoleTab[]> = {
  profile: [
    { path: '/profile', label: '机构资料' },
    { path: '/account', label: '账号' },
  ],
  jobs: [
    { path: '/jobs', label: '岗位信息管理' },
    { path: '/companies', label: '企业资料管理' },
    { path: '/fairs', label: '招聘会信息管理' },
    { path: '/sources', label: '数据源管理' },
    { path: '/sync-logs', label: '同步日志' },
  ],
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '工作台', icon: LayoutDashboardIcon, href: KEY_TO_PATH.dashboard },
  { key: 'profile', label: '机构与账号', icon: Building2Icon, group: '本机构', href: KEY_TO_PATH.profile },
  { key: 'policy', label: '政策公告管理', icon: FileTextIcon, group: '内容管理', href: KEY_TO_PATH.policy },
  { key: 'smart-campus', label: '智慧校园', icon: GraduationCapIcon, href: KEY_TO_PATH['smart-campus'] },
  { key: 'jobs', label: '招聘内容', icon: BriefcaseIcon, href: KEY_TO_PATH.jobs },
  { key: 'terminals', label: '终端数据', icon: MonitorIcon, group: '终端与数据', href: KEY_TO_PATH.terminals },
  { key: 'stats', label: '数据统计', icon: BarChart2Icon, href: KEY_TO_PATH.stats },
  { key: 'screen', label: '数据大屏', icon: GaugeIcon, href: KEY_TO_PATH.screen },
]

/**
 * 侧栏能力投影只隐藏「这类机构连打开都会被服务端拒绝」的入口。
 * 判定来源是服务端 partner-capabilities 的同一份矩阵（经能力接口下发），前端不另写机构类型规则。
 *
 * 只有智慧校园符合整页不可用：非学校机构读取也会被拒绝。
 * 岗位 / 招聘会在托管打开时收进「招聘内容」标签，不单独占侧栏。列表与下架不按机构类型拦截；
 * 新建和保存会按机构类型拒绝（jobs-partner.service.ts 的 assertPartnerDataTypeCapability）。
 * 政策整页始终保留：更新、下架、删除不校验机构类型。
 * 招聘内容只在 recruitmentHosting === true 时显示侧栏项和标签条；能力没读到时也不显示。
 * 直接打开组内地址仍由 RecruitmentHostingGate 说明。
 */
export const RECRUITMENT_HOSTED_NAV_KEYS = new Set(['jobs'])

function isNavItemVisible(key: string, caps: PartnerDataSourceCapabilities | null): boolean {
  if (RECRUITMENT_HOSTED_NAV_KEYS.has(key)) return caps?.recruitmentHosting === true
  if (!caps) return true
  if (key === 'smart-campus') return caps.canManageSmartCampus
  return true
}

/** 过滤后把被丢弃项的分组标题顺延给该组第一个幸存项，避免分组表头凭空消失。 */
export function projectNavItems(caps: PartnerDataSourceCapabilities | null): NavItem[] {
  const out: NavItem[] = []
  let pendingGroup: string | undefined
  for (const item of NAV_ITEMS) {
    if (item.group) pendingGroup = item.group
    if (!isNavItemVisible(item.key, caps)) continue
    out.push(pendingGroup ? { ...item, group: pendingGroup } : item)
    pendingGroup = undefined
  }
  return out
}

/** 招聘内容标签只在托管明确打开时出现；读取中、失败、关闭都不渲染。 */
export function consoleTabsFor(key: string, caps: PartnerDataSourceCapabilities | null): readonly ConsoleTab[] | null {
  const tabs = TAB_GROUPS[key]
  if (!tabs) return null
  if (key === 'jobs' && caps?.recruitmentHosting !== true) return null
  return tabs
}
