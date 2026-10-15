import { LEGAL_DRAFT_FALLBACK_VERSION } from '@ai-job-print/shared'
import { API_BASE_URL } from '../api/client'

const ALLOW_DRAFT_FALLBACK = import.meta.env.DEV || import.meta.env.MODE === 'e2e' || import.meta.env.MODE === 'test'

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

async function fetchDocVersion(docType: 'terms_of_service' | 'privacy_policy'): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/kiosk/legal/${docType}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) return ALLOW_DRAFT_FALLBACK ? LEGAL_DRAFT_FALLBACK_VERSION : null
    const json = (await res.json()) as Envelope<ActiveLegalDoc | null>
    const version = json.data?.version
    return typeof version === 'string' && version.trim()
      ? version.trim()
      : (ALLOW_DRAFT_FALLBACK ? LEGAL_DRAFT_FALLBACK_VERSION : null)
  } catch {
    return ALLOW_DRAFT_FALLBACK ? LEGAL_DRAFT_FALLBACK_VERSION : null
  }
}

/** 读取当前有效协议版本；无激活版本时回落草拟哨兵，与服务端 resolve 口径一致。 */
export async function fetchLegalConsentVersions(): Promise<LegalConsentVersions> {
  const [termsVersion, privacyVersion] = await Promise.all([
    fetchDocVersion('terms_of_service'),
    fetchDocVersion('privacy_policy'),
  ])
  return {
    termsVersion: termsVersion ?? '',
    privacyVersion: privacyVersion ?? '',
  }
}
