import type { CreateLicenseInput, LicenseAttention, LicenseMode, LicenseMutationResult, LicenseResumeInput, LicenseStatusChangeInput, LicenseView, OrgLicenseDetail, RenewLicenseInput, SetLicenseModeInput, UpdateLicenseInput } from '@ai-job-print/shared'
import { LICENSE_PERIOD_TOO_LONG_MESSAGE, maxEndsOn } from '../../lib/licensePeriod'

const DAY = 86_400_000
export class MockLicenseError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message) }
}
function fail(code: string, message: string, status = 400): never { throw new MockLicenseError(code, message, status) }
export function addDays(day: string, n: number): string { return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10) }
export function todayBeijing(now = new Date()): string { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) }
const midnight = (day: string) => new Date(`${day}T00:00:00+08:00`).toISOString()
const diff = (a: string, b: string) => (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY
// eslint-disable-next-line no-control-regex -- 和后端一样拒绝控制及不可见字符
const unsafe = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u
function text(value: unknown, code: string, label: string, min: number, max: number): string {
  if (typeof value !== 'string') return fail(code, `${label}必填`)
  const s = value.trim(), len = Array.from(s).length
  if (len < min || len > max) return fail(code, `${label}需为 ${min}–${max} 个字`)
  if (unsafe.test(s)) return fail(code, `${label}含有不可见或控制字符`)
  return s
}
export function validateReason(value: unknown): string { return text(value, 'LICENSE_REASON_INVALID', '理由', 2, 200) }
export function validateTicket(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s || s.length > 64 || !/^[A-Za-z0-9_/-]+$/.test(s)) return fail('LICENSE_TICKET_INVALID', '审批工单号必填，1–64 位，只能含字母、数字、- _ /')
  return s
}
export function validateVersion(value: unknown, expected: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) fail('LICENSE_VERSION_INVALID', '请带上界面读到的授权版本号（正整数）')
  if (value !== expected) fail('LICENSE_VERSION_CONFLICT', `这条授权刚刚被别人改过（当前是第 ${expected} 版），你看到的已经过期。请刷新后核对最新内容，再重新提交。`, 409)
}
function credit(value: unknown): string {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : ''
  const chars = '0123456789ABCDEFGHJKLMNPQRTUWXY', weights = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(s) || chars[(31 - weights.reduce((sum, w, i) => sum + chars.indexOf(s[i]!) * w, 0) % 31) % 31] !== s[17]) return fail('LICENSE_CREDIT_CODE_INVALID', '统一社会信用代码需为 18 位（数字与大写字母，末位校验位正确）')
  return s
}
function day(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || +s.slice(0, 4) < 2000 || +s.slice(0, 4) > 2100 || !Number.isFinite(Date.parse(`${s}T12:00:00Z`)) || new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) !== s) return fail('LICENSE_PERIOD_INVALID', '日期需为 YYYY-MM-DD 格式的真实日期（北京时间）')
  return s
}
export function validatePeriod(start: unknown, end: unknown): [string, string] {
  const a = day(start), b = day(end)
  if (b < a) return fail('LICENSE_PERIOD_INVALID', '到期日不能早于生效日')
  if (b > (maxEndsOn(a) ?? '')) return fail('LICENSE_PERIOD_INVALID', LICENSE_PERIOD_TOO_LONG_MESSAGE)
  return [a, b]
}
function numberIn(value: unknown, max: number, code: string, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return fail(code, `${label}需为 ${min}–${max} 的整数`)
  return value
}
function note(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return fail('LICENSE_NOTE_INVALID', '备注需为文字')
  const s = value.trim()
  if (!s) return null
  return text(s, 'LICENSE_NOTE_INVALID', '备注', 1, 500)
}
type Fields = Pick<LicenseView, 'licenseeName' | 'creditCode' | 'contractNo' | 'startsOn' | 'endsOn' | 'terminalQuota' | 'graceDays' | 'note'>
function fields(input: CreateLicenseInput): Fields {
  const [startsOn, endsOn] = validatePeriod(input.startsOn, input.endsOn)
  return { startsOn, endsOn, licenseeName: text(input.licenseeName, 'LICENSE_LICENSEE_INVALID', '被授权企业名称', 2, 100), creditCode: credit(input.creditCode), contractNo: text(input.contractNo, 'LICENSE_CONTRACT_NO_INVALID', '合同编号', 1, 64), terminalQuota: numberIn(input.terminalQuota, 10000, 'LICENSE_QUOTA_INVALID', '终端台数', 1), graceDays: numberIn(input.graceDays ?? 7, 30, 'LICENSE_GRACE_INVALID', '宽限天数', 0), note: note(input.note) }
}
export function validateOverlap(items: LicenseView[], start: string, end: string, except?: string): void {
  if (items.some(x => x.id !== except && x.status !== 'revoked' && x.startsOn <= end && x.endsOn >= start)) fail('LICENSE_PERIOD_OVERLAP', '授权期限与本机构已有授权重叠', 409)
}
export function deriveLicense(row: LicenseView, today: string): LicenseView {
  const graceEndsOn = row.graceDays ? addDays(row.endsOn, row.graceDays) : null
  const phase = row.status === 'revoked' ? 'revoked' : row.status === 'suspended' ? 'suspended' : today < row.startsOn ? 'pending' : today <= row.endsOn ? 'active' : graceEndsOn && today <= graceEndsOn ? 'grace' : 'expired'
  return { ...row, phase, startsAt: midnight(row.startsOn), endsAt: midnight(addDays(row.endsOn, 1)), graceEndsOn, graceEndsAt: midnight(addDays(row.endsOn, row.graceDays + 1)), periodText: `${row.startsOn} 至 ${row.endsOn}（北京时间，含当天）` }
}
export interface MockOrg { orgId: string; orgName: string; licenseMode: LicenseMode; terminalsBound: number; items: LicenseView[] }
export function deriveOrg(org: MockOrg, today = todayBeijing()): OrgLicenseDetail {
  const items = org.items.map(x => deriveLicense(x, today)).sort((a, b) => b.startsOn.localeCompare(a.startsOn) || b.createdAt.localeCompare(a.createdAt))
  const started = items.filter(x => x.status !== 'revoked' && x.startsOn <= today)
  const latest = (xs: LicenseView[]) => xs.sort((a, b) => b.endsOn.localeCompare(a.endsOn) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null
  const active = latest(started.filter(x => x.status === 'active' && today <= x.endsOn))
  const suspended = latest(started.filter(x => x.status === 'suspended' && today < addDays(x.endsOn, x.graceDays + 1)))
  const grace = latest(started.filter(x => x.status === 'active' && x.phase === 'grace'))
  const current = active ?? suspended ?? grace ?? latest(started)
  const actual = active ? 'ok' : suspended ? 'suspended' : grace ? 'grace' : current ? 'expired' : 'unlicensed'
  const upcoming = items.filter(x => x.status === 'active' && x.startsOn > today).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.createdAt.localeCompare(b.createdAt))[0] ?? null
  let covered = active?.endsOn ?? null
  if (covered) {
    for (;;) {
      const next = items.filter(x => x.status === 'active' && x.startsOn <= addDays(covered!, 1) && x.endsOn > covered!).sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0]
      if (!next) break
      covered = next.endsOn
    }
  }
  const managed = org.licenseMode === 'required', quota = current?.terminalQuota ?? null
  return { orgId: org.orgId, orgName: org.orgName, licenseMode: org.licenseMode, managed, state: managed ? actual : 'ok', usable: !managed || actual === 'ok' || actual === 'grace', daysLeft: active ? diff(active.endsOn, today) + 1 : grace ? diff(grace.graceEndsOn!, today) + 1 : null, coveredUntil: covered ? midnight(addDays(covered, 1)) : null, coveredUntilOn: covered, current, upcoming, terminalQuota: quota, terminalsBound: org.terminalsBound, overQuota: managed && quota !== null && org.terminalsBound > quota, items }
}
function makeRow(orgId: string, id: string, data: Fields): LicenseView {
  const now = new Date().toISOString()
  return deriveLicense({ ...data, id, orgId, version: 1, startsAt: '', endsAt: '', periodText: '', graceEndsAt: '', graceEndsOn: null, status: 'active', phase: 'active', statusReason: null, statusTicketNo: null, statusChangedAt: null, statusChangedBy: null, createdBy: 'demo-admin', updatedBy: null, createdAt: now, updatedAt: now }, todayBeijing())
}
const today = todayBeijing()
const orgs: MockOrg[] = [
  { orgId: 'org-mock-2', orgName: '某大学就业指导中心(演示)', licenseMode: 'required', terminalsBound: 2, items: [makeRow('org-mock-2', 'license-demo-1', { licenseeName: '青岛蓝谷数字科技有限公司', creditCode: '91370212MA3T8K2P4T', contractNo: 'ZYD-SQ-2026-0315', startsOn: addDays(today, -354), endsOn: addDays(today, 11), terminalQuota: 3, graceDays: 7, note: null })] },
  { orgId: 'org-mock-1', orgName: '市人才交流中心(演示)', licenseMode: 'required', terminalsBound: 2, items: [makeRow('org-mock-1', 'license-demo-2', { licenseeName: '青岛海纳就业服务有限公司', creditCode: '91370203MA3RQ5WX71', contractNo: 'ZYD-SQ-2026-0316', startsOn: addDays(today, -370), endsOn: addDays(today, -5), terminalQuota: 3, graceDays: 7, note: null })] },
]
let serial = 2
function orgById(id: string): MockOrg { return orgs.find(x => x.orgId === id) ?? fail('ORG_NOT_FOUND', '机构不存在', 404) }
function rowById(id: string): { org: MockOrg; row: LicenseView } {
  for (const org of orgs) { const row = org.items.find(x => x.id === id); if (row) return { org, row } }
  return fail('LICENSE_NOT_FOUND', '授权不存在', 404)
}
function ensureLive(row: LicenseView): void { if (row.status === 'revoked') fail('LICENSE_REVOKED', '这条授权已吊销，不能再修改、续期或恢复', 409) }
function changed(row: LicenseView): void { row.version++; row.updatedAt = new Date().toISOString(); row.updatedBy = 'demo-admin' }
function result(org: MockOrg, id: string): LicenseMutationResult { return { licenseId: id, org: deriveOrg(org) } }
export function mockGetOrg(id: string): OrgLicenseDetail { return deriveOrg(orgById(id)) }
export function mockAttention(): LicenseAttention {
  const all = orgs.map(x => deriveOrg(x)).filter(x => x.managed).map(detail => { const { items, ...overview } = detail; void items; return overview })
  const expiringSoon = all.filter(x => x.state === 'ok' && x.coveredUntilOn !== null && diff(x.coveredUntilOn, todayBeijing()) + 1 <= 30).sort ( (a, b) => a.coveredUntil!.localeCompare(b.coveredUntil!))
  const grace = all.filter(x => x.state === 'grace').sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)), inactive = all.filter(x => ['expired', 'suspended', 'unlicensed'].includes(x.state))
  return { expiringSoon, grace, inactive, counts: { expiringSoon: expiringSoon.length, grace: grace.length, inactive: inactive.length } }
}
export function mockCreate(orgId: string, input: CreateLicenseInput): LicenseMutationResult {
  const data = fields(input), org = orgById(orgId)
  validateOverlap(org.items, data.startsOn, data.endsOn)
  const row = makeRow(orgId, `license-demo-${++serial}`, data); org.items.push(row)
  return result(org, row.id)
}
export function mockUpdate(id: string, input: UpdateLicenseInput): LicenseMutationResult {
  if (!Number.isInteger(input.version) || input.version < 1) fail('LICENSE_VERSION_INVALID', '请带上界面读到的授权版本号（正整数）')
  validateReason(input.reason)
  const { org, row } = rowById(id); ensureLive(row); validateVersion(input.version, row.version)
  // 只合并契约字段，不让调用方覆盖内部状态。
  const [startsOn, endsOn] = validatePeriod(input.startsOn === undefined ? row.startsOn : input.startsOn, input.endsOn === undefined ? row.endsOn : input.endsOn)
  const data: Fields = {
    startsOn, endsOn,
    licenseeName: input.licenseeName === undefined ? row.licenseeName : text(input.licenseeName, 'LICENSE_LICENSEE_INVALID', '被授权企业名称', 2, 100),
    creditCode: input.creditCode === undefined ? row.creditCode : credit(input.creditCode),
    contractNo: input.contractNo === undefined ? row.contractNo : text(input.contractNo, 'LICENSE_CONTRACT_NO_INVALID', '合同编号', 1, 64),
    terminalQuota: input.terminalQuota === undefined ? row.terminalQuota : numberIn(input.terminalQuota, 10000, 'LICENSE_QUOTA_INVALID', '终端台数', 1),
    graceDays: input.graceDays === undefined ? row.graceDays : numberIn(input.graceDays ?? 7, 30, 'LICENSE_GRACE_INVALID', '宽限天数', 0),
    note: input.note === undefined ? row.note : note(input.note),
  }
  if (data.startsOn !== row.startsOn || data.endsOn !== row.endsOn) validateOverlap(org.items, data.startsOn, data.endsOn, id)
  if (Object.entries(data).some(([k, v]) => row[k as keyof Fields] !== v)) { Object.assign(row, data); changed(row) }
  return result(org, id)
}
export function mockRenew(id: string, input: RenewLicenseInput): LicenseMutationResult {
  const { org, row } = rowById(id); ensureLive(row)
  return mockCreate(org.orgId, { ...input, startsOn: input.startsOn ?? addDays(row.endsOn, 1), terminalQuota: input.terminalQuota ?? row.terminalQuota, graceDays: input.graceDays ?? row.graceDays })
}
export function mockStatus(id: string, input: LicenseStatusChangeInput | LicenseResumeInput, target: 'active' | 'suspended' | 'revoked'): LicenseMutationResult {
  if (!Number.isInteger(input.version) || input.version < 1) fail('LICENSE_VERSION_INVALID', '请带上界面读到的授权版本号（正整数）')
  const reason = validateReason(input.reason), ticket = target === 'active' ? null : validateTicket((input as LicenseStatusChangeInput).approvalTicketNo)
  const { org, row } = rowById(id); ensureLive(row); validateVersion(input.version, row.version)
  if (target === 'suspended' && row.status !== 'active' || target === 'active' && row.status !== 'suspended') fail('LICENSE_STATUS_CONFLICT', '当前授权状态不允许此操作', 409)
  row.status = target; row.statusReason = target === 'active' ? null : reason; row.statusTicketNo = ticket; row.statusChangedAt = new Date().toISOString(); row.statusChangedBy = 'demo-admin'; changed(row)
  return result(org, id)
}
export function mockSetMode(id: string, input: SetLicenseModeInput): OrgLicenseDetail {
  if (input.licenseMode !== 'none' && input.licenseMode !== 'required') fail('LICENSE_MODE_INVALID', '授权方式只能是 none 或 required')
  validateReason(input.reason)
  const org = orgById(id)
  if (org.licenseMode !== input.licenseMode && input.licenseMode === 'required' && !deriveOrg({ ...org, licenseMode: 'required' }).usable && org.terminalsBound > 0 && input.confirmLockout !== true) fail('LICENSE_MODE_WOULD_LOCK_TERMINALS', `该机构目前没有可用的授权，切到「需要授权」后它名下 ${org.terminalsBound} 台终端将不能开始新会话。请先录入授权，或确认要立即停用。`, 409)
  org.licenseMode = input.licenseMode
  return deriveOrg(org)
}
