import { formatCount, type LicenseAttention, type OrgLicenseOverview } from '@ai-job-print/shared'
import type { QueueState } from '../../components/first-order/useServiceQueues'
import type { TodayRow } from './todayServiceRows'

function lastDate(value: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(new Date(value).getTime() - 1))
}

function describe(item: OrgLicenseOverview): string {
  if (item.state === 'suspended') return '已停用（已暂停）'
  if (item.state === 'expired') return '已停用（已到期）'
  if (item.state === 'unlicensed') return '已停用（没有可用授权）'
  if (item.state === 'grace') return item.daysLeft === null ? '宽限期（剩余天数未读到）' : `宽限期还剩 ${formatCount(item.daysLeft)} 天`
  const end = item.coveredUntil ? `，最后有效日 ${lastDate(item.coveredUntil)} 到期` : '，最后有效日未读到'
  return `${item.daysLeft === null ? '剩余天数未读到' : `还剩 ${formatCount(item.daysLeft)} 天`}${end}`
}

export function licenseTodayRows(state: QueueState<LicenseAttention>, retry: () => void): TodayRow[] {
  if (state.status === 'loading') return [{ key: 'license-loading', title: '软件使用授权', detail: '正在读取', action: '' }]
  if (state.status === 'error' || state.status === 'preview') return [{ key: 'license-error', title: '软件使用授权情况这次没读到', detail: '', action: '重试', onRetry: retry }]
  const { data } = state
  const categories = [
    { key: 'inactive', items: data.inactive, count: data.counts.inactive, title: '机构的软件使用授权已停用', detail: '名下一体机不能开始新的服务，机构后台不能发布或修改内容' },
    { key: 'grace', items: data.grace, count: data.counts.grace, title: '机构处于授权宽限期', detail: '宽限期内照常服务，结束后自动停用' },
    { key: 'expiring', items: data.expiringSoon, count: data.counts.expiringSoon, title: '机构的授权 30 天内到期', detail: '' },
  ]
  return categories.filter(({ count }) => count > 0).map(({ key, items, count, title, detail }) => ({
    key: `license-${key}`, title: `${formatCount(count)} 家${title}`, detail, action: '',
    lines: items.slice(0, 5).map((item) => ({ key: item.orgId, text: `${item.orgName} · ${describe(item)}`, href: `/partners?org=${encodeURIComponent(item.orgId)}`, action: '去处理' })),
    note: count > 5 ? `另有 ${formatCount(count - Math.min(items.length, 5))} 家` : undefined,
  }))
}
