import { formatCount, type LicensePhase, type OrgLicenseOverview } from '@ai-job-print/shared'
import { validCreditCode } from './licenseValidation'

export const phaseLabel: Record<LicensePhase, string> = { pending: '待生效', active: '生效中', grace: '宽限中', expired: '已过期', suspended: '已暂停', revoked: '已吊销' }
export function stateLabel(org: OrgLicenseOverview): string {
  const grace = org.daysLeft === null ? '宽限期（剩余天数这次没读到）' : `宽限期还剩 ${formatCount(org.daysLeft)} 天`
  return { ok: '正常', grace, expired: '已到期停用', suspended: '已暂停', unlicensed: '没有可用授权' }[org.state]
}
export function validCreditChecksum(value: string): boolean {
  const code = value.trim().toUpperCase()
  if (!validCreditCode(code)) return false
  const chars = '0123456789ABCDEFGHJKLMNPQRTUWXY'
  const weights = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
  const sum = weights.reduce((n, weight, i) => n + chars.indexOf(code[i]) * weight, 0)
  return chars[(31 - sum % 31) % 31] === code[17]
}
