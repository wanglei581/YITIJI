import type { CreateLicenseInput, LicenseAttention, LicenseMutationResult, LicenseResumeInput, LicenseStatusChangeInput, OrgLicenseDetail, RenewLicenseInput, SetLicenseModeInput, UpdateLicenseInput } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import * as mock from './licensesAdminMock'

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { method, headers: { ...authHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (res.status === 401) redirectToLogin()
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string }; message?: unknown }
    throw new ApiHttpError(data.error?.code ?? 'LICENSE_REQUEST_ERROR', data.error?.message ?? (typeof data.message === 'string' ? data.message : '软件使用授权操作失败'), res.status)
  }
  return ((await res.json()) as { success: true; data: T }).data
}
function demo<T>(fn: () => T): T {
  try { return fn() } catch (error) {
    if (error instanceof mock.MockLicenseError) throw new ApiHttpError(error.code, error.message, error.status)
    throw error
  }
}
const orgPath = (id: string) => `/admin/orgs/${encodeURIComponent(id)}`
const licensePath = (id: string) => `/admin/licenses/${encodeURIComponent(id)}`
// 白名单避免额外字段进入后端的严格 DTO。
function createBody(x: CreateLicenseInput | RenewLicenseInput) {
  return { licenseeName: x.licenseeName, creditCode: x.creditCode, contractNo: x.contractNo, startsOn: x.startsOn, endsOn: x.endsOn, terminalQuota: x.terminalQuota, graceDays: x.graceDays, note: x.note }
}
export async function getLicenseAttention(): Promise<LicenseAttention> {
  return API_MODE === 'mock' ? demo(mock.mockAttention) : request('/admin/licenses/attention')
}
export async function getOrgLicenses(orgId: string): Promise<OrgLicenseDetail> {
  return API_MODE === 'mock' ? demo(() => mock.mockGetOrg(orgId)) : request(`${orgPath(orgId)}/licenses`)
}
export async function createLicense(orgId: string, input: CreateLicenseInput): Promise<LicenseMutationResult> {
  const body = createBody(input)
  return API_MODE === 'mock' ? demo(() => mock.mockCreate(orgId, input)) : request(`${orgPath(orgId)}/licenses`, 'POST', body)
}
export async function updateLicense(id: string, input: UpdateLicenseInput): Promise<LicenseMutationResult> {
  const { version, reason, licenseeName, creditCode, contractNo, startsOn, endsOn, terminalQuota, graceDays, note } = input
  const body = { version, reason, licenseeName, creditCode, contractNo, startsOn, endsOn, terminalQuota, graceDays, note }
  return API_MODE === 'mock' ? demo(() => mock.mockUpdate(id, body)) : request(licensePath(id), 'PATCH', body)
}
export async function renewLicense(id: string, input: RenewLicenseInput): Promise<LicenseMutationResult> {
  return API_MODE === 'mock' ? demo(() => mock.mockRenew(id, input)) : request(`${licensePath(id)}/renew`, 'POST', createBody(input))
}
export async function suspendLicense(id: string, input: LicenseStatusChangeInput): Promise<LicenseMutationResult> {
  const { version, reason, approvalTicketNo } = input
  return API_MODE === 'mock' ? demo(() => mock.mockStatus(id, { version, reason, approvalTicketNo }, 'suspended')) : request(`${licensePath(id)}/suspend`, 'POST', { version, reason, approvalTicketNo })
}
export async function resumeLicense(id: string, input: LicenseResumeInput): Promise<LicenseMutationResult> {
  const { version, reason } = input
  return API_MODE === 'mock' ? demo(() => mock.mockStatus(id, { version, reason }, 'active')) : request(`${licensePath(id)}/resume`, 'POST', { version, reason })
}
export async function revokeLicense(id: string, input: LicenseStatusChangeInput): Promise<LicenseMutationResult> {
  const { version, reason, approvalTicketNo } = input
  return API_MODE === 'mock' ? demo(() => mock.mockStatus(id, { version, reason, approvalTicketNo }, 'revoked')) : request(`${licensePath(id)}/revoke`, 'POST', { version, reason, approvalTicketNo })
}
export async function setLicenseMode(orgId: string, input: SetLicenseModeInput): Promise<OrgLicenseDetail> {
  const { licenseMode, reason, confirmLockout } = input
  return API_MODE === 'mock' ? demo(() => mock.mockSetMode(orgId, { licenseMode, reason, confirmLockout })) : request(`${orgPath(orgId)}/license-mode`, 'PUT', { licenseMode, reason, confirmLockout })
}
