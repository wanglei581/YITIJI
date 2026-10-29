import type { PartnerLicenseView } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export async function getPartnerLicense(): Promise<PartnerLicenseView> {
  if (API_MODE === 'mock') return { licenseMode: 'none', managed: false, state: 'ok', usable: true, daysLeft: null, current: null, upcoming: null, terminalsBound: 0 }
  const res = await fetch(`${API_BASE_URL}/partner/license`, { headers: { Accept: 'application/json', ...authHeader() }, credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(body.error?.code ?? `HTTP_${res.status}`, body.error?.message ?? '授权情况暂时没读到', res.status)
  }
  return ((await res.json()) as { data: PartnerLicenseView }).data
}
