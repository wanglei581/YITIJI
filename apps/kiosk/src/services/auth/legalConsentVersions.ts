import { LEGAL_DRAFT_FALLBACK_VERSION } from '@ai-job-print/shared'
import { API_BASE_URL } from '../api/client'

export interface LegalConsentVersions {
  termsVersion: string
  privacyVersion: string
}

interface Envelope<T> {
  success: boolean
  data: T
}

interface ActiveLegalDoc {
  version?: string | null
}

async function fetchDocVersion(docType: 'terms_of_service' | 'privacy_policy'): Promise<string> {
  try {
    const res = await fetch(`${API_BASE_URL}/kiosk/legal/${docType}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) return LEGAL_DRAFT_FALLBACK_VERSION
    const json = (await res.json()) as Envelope<ActiveLegalDoc | null>
    const version = json.data?.version
    return typeof version === 'string' && version.trim() ? version.trim() : LEGAL_DRAFT_FALLBACK_VERSION
  } catch {
    return LEGAL_DRAFT_FALLBACK_VERSION
  }
}

/** 读取当前有效协议版本；无激活版本时回落草拟哨兵，与服务端 resolve 口径一致。 */
export async function fetchLegalConsentVersions(): Promise<LegalConsentVersions> {
  const [termsVersion, privacyVersion] = await Promise.all([
    fetchDocVersion('terms_of_service'),
    fetchDocVersion('privacy_policy'),
  ])
  return { termsVersion, privacyVersion }
}
