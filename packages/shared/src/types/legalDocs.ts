/**
 * 法务文档版本约定（G6）。
 *
 * 当 Admin 尚未激活 LegalDocVersion 时，Kiosk 仍展示本地草拟文案；
 * 同意记录用此哨兵版本号落库，避免伪称「已发布版本」。
 */
export const LEGAL_DRAFT_FALLBACK_VERSION = 'draft-pending-legal-review'

export const LEGAL_CONSENT_DOC_TYPES = ['terms_of_service', 'privacy_policy'] as const
export type LegalConsentDocType = (typeof LEGAL_CONSENT_DOC_TYPES)[number]
