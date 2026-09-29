import { LEGAL_DRAFT_FALLBACK_VERSION } from '@ai-job-print/shared'
import { API_BASE_URL } from '../api/client'
import { IS_E2E_BUILD } from '../../utils/buildMode'
import { LEGAL_DOCS_NOT_PUBLISHED_COPY, MemberApiError } from './memberAuthApi'

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

type DocVersionResult =
  | { kind: 'active'; version: string }
  | { kind: 'unpublished' }
  | { kind: 'unreachable' }

// C4（2026-09-29 口径）：正式生产构建取不到已发布版本时不回落草拟哨兵，如实拦住登录；
// 开发、单测与 E2E 构建保留回落，测试行为不变。服务端应急口 LEGAL_DOCS_REQUIRE_PUBLISHED=false
// 对一体机正式构建不再生效是有意的 —— 发布前 preflight 会硬检查三份法务文档都已激活。
const FORMAL_PRODUCTION_BUILD = import.meta.env.PROD && !IS_E2E_BUILD

async function fetchDocVersion(docType: 'terms_of_service' | 'privacy_policy'): Promise<DocVersionResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/kiosk/legal/${docType}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) return { kind: 'unreachable' }
    const json = (await res.json()) as Envelope<ActiveLegalDoc | null>
    const version = json.data?.version
    return typeof version === 'string' && version.trim()
      ? { kind: 'active', version: version.trim() }
      : { kind: 'unpublished' }
  } catch {
    return { kind: 'unreachable' }
  }
}

/**
 * 读取当前有效协议版本。
 * 正式生产构建：任一份没有已发布版本就抛 LEGAL_DOCS_NOT_PUBLISHED（登录页据此显示「暂时无法登录」）；
 * 取不到（网络或接口失败）抛 NETWORK_ERROR，不冒充「未发布」。
 * 开发 / 单测 / E2E 构建：缺哪份就用草拟哨兵补哪份，与服务端非生产口径一致。
 */
export async function fetchLegalConsentVersions(): Promise<LegalConsentVersions> {
  const [terms, privacy] = await Promise.all([
    fetchDocVersion('terms_of_service'),
    fetchDocVersion('privacy_policy'),
  ])
  if (terms.kind === 'active' && privacy.kind === 'active') {
    return { termsVersion: terms.version, privacyVersion: privacy.version }
  }
  if (FORMAL_PRODUCTION_BUILD) {
    if (terms.kind === 'unpublished' || privacy.kind === 'unpublished') {
      throw new MemberApiError('LEGAL_DOCS_NOT_PUBLISHED', LEGAL_DOCS_NOT_PUBLISHED_COPY, 403)
    }
    throw new MemberApiError('NETWORK_ERROR', '', 0)
  }
  return {
    termsVersion: terms.kind === 'active' ? terms.version : LEGAL_DRAFT_FALLBACK_VERSION,
    privacyVersion: privacy.kind === 'active' ? privacy.version : LEGAL_DRAFT_FALLBACK_VERSION,
  }
}
