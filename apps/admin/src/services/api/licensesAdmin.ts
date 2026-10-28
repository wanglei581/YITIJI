import type { LicenseAttention, LicenseView, OrgLicenseOverview } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// 演示数据用合作机构管理页现有的两家演示机构（id 与名称一致，点「去处理」能打开对应机构）；
// 已停用一类不放演示数据，由 http 包用例喂快照覆盖。时间按现在推算，过几天状态不会变。
const MOCK_LICENSES = [
  { orgId: 'org-mock-2', orgName: '某大学就业指导中心(演示)', state: 'ok', endsInDays: 12, licenseeName: '青岛蓝谷数字科技有限公司', creditCode: '91370212MA3T8K2P4T', contractNo: 'ZYD-SQ-2026-0315' },
  { orgId: 'org-mock-1', orgName: '市人才交流中心(演示)', state: 'grace', endsInDays: -4, licenseeName: '青岛海纳就业服务有限公司', creditCode: '91370203MA3RQ5WX71', contractNo: 'ZYD-SQ-2026-0316' },
] as const

function mockAttention(): LicenseAttention {
  const now = Date.now()
  const day = 86_400_000
  const iso = (offset: number) => new Date(now + offset * day).toISOString()
  const overview = (item: (typeof MOCK_LICENSES)[number], index: number): OrgLicenseOverview => {
    const current: LicenseView = {
      id: `license-demo-${index + 1}`, orgId: item.orgId, licenseeName: item.licenseeName, creditCode: item.creditCode,
      contractNo: item.contractNo, startsAt: iso(item.endsInDays - 365), endsAt: iso(item.endsInDays),
      graceDays: 7, graceEndsAt: iso(item.endsInDays + 7), terminalQuota: 3, status: 'active',
      phase: item.state === 'ok' ? 'active' : 'grace', note: null, statusReason: null, statusTicketNo: null,
      statusChangedAt: null, statusChangedBy: null, createdBy: 'demo-admin', updatedBy: null,
      createdAt: iso(item.endsInDays - 372 - index), updatedAt: iso(-20 - index),
    }
    return { orgId: item.orgId, orgName: item.orgName, licenseMode: 'required', managed: true, state: item.state, usable: true,
      daysLeft: item.state === 'ok' ? item.endsInDays : item.endsInDays + 7, coveredUntil: item.state === 'ok' ? current.endsAt : null,
      current, upcoming: null, terminalQuota: 3, terminalsBound: 2, overQuota: false }
  }
  const all = MOCK_LICENSES.map(overview)
  const expiringSoon = all.filter((item) => item.state === 'ok')
  const grace = all.filter((item) => item.state === 'grace')
  return { expiringSoon, grace, inactive: [], counts: { expiringSoon: expiringSoon.length, grace: grace.length, inactive: 0 } }
}

export async function getLicenseAttention(): Promise<LicenseAttention> {
  if (API_MODE === 'mock') return mockAttention()
  const res = await fetch(`${API_BASE_URL}/admin/licenses/attention`, { headers: authHeader() })
  if (res.status === 401 || res.status === 403) redirectToLogin()
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string }; message?: unknown }
    const message = body.error?.message ?? (typeof body.message === 'string' ? body.message : undefined)
    throw new ApiHttpError(body.error?.code ?? 'LICENSE_ATTENTION_ERROR', message ?? '软件使用授权情况这次没读到', res.status)
  }
  return ((await res.json()) as { data: LicenseAttention }).data
}
