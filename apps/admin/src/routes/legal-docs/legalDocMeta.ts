// 法务文档页的类型名称、上线就绪判定与版本号校验（纯函数，页面与新增抽屉共用）。
import { LEGAL_DRAFT_FALLBACK_VERSION } from '@ai-job-print/shared'
import type { LegalDocVersionView } from '../../services/api/legalDocs'

/** 后台统一叫法。ai_disclaimer 统一叫「AI 服务说明」，不再混用「免责声明」。 */
export const DOC_TYPE_LABELS: Record<string, string> = {
  terms_of_service: '用户服务协议',
  privacy_policy: '隐私政策',
  ai_disclaimer: 'AI 服务说明',
  contract_review_disclaimer: '合同审查免责声明',
  operator_info: '经营者信息',
}

export const DOC_TYPE_ORDER = [
  'terms_of_service',
  'privacy_policy',
  'ai_disclaimer',
  'contract_review_disclaimer',
  'operator_info',
] as const

/** 会员登录前必须勾选同意的两份（与服务端 C4 登录闸门同一口径）。 */
export const LOGIN_CONSENT_DOC_TYPES = ['terms_of_service', 'privacy_policy'] as const

export function docTypeLabel(docType: string): string {
  return DOC_TYPE_LABELS[docType] ?? docType
}

export function activeVersionOf(rows: LegalDocVersionView[], docType: string): LegalDocVersionView | null {
  return rows.find((row) => row.docType === docType && row.isActive) ?? null
}

/**
 * 与服务端 assertLegalDocsPublished 同一判据：已激活、有发布时间、版本号不是草拟哨兵。
 * 返回缺哪几份（为空即就绪）。
 */
export function missingLoginConsentDocs(rows: LegalDocVersionView[]): string[] {
  return LOGIN_CONSENT_DOC_TYPES.filter((docType) => {
    const active = activeVersionOf(rows, docType)
    return !active || !active.publishedAt || active.version.trim() === LEGAL_DRAFT_FALLBACK_VERSION
  }).map(docTypeLabel)
}

export const VERSION_MAX_LENGTH = 50

/** 新增版本时的版本号校验；返回错误说明，合法返回 null。 */
export function versionProblem(rows: LegalDocVersionView[], docType: string, version: string): string | null {
  const value = version.trim()
  if (!value) return null
  if (value === LEGAL_DRAFT_FALLBACK_VERSION) {
    return `「${LEGAL_DRAFT_FALLBACK_VERSION}」是系统保留的「未正式发布」标记，不能用作版本号`
  }
  if (value.length > VERSION_MAX_LENGTH) return `版本号最多 ${VERSION_MAX_LENGTH} 个字`
  if (rows.some((row) => row.docType === docType && row.version.trim() === value)) {
    return `${docTypeLabel(docType)}已经有版本号「${value}」，请换一个`
  }
  return null
}

/** 激活确认文案：协议与隐私政策影响会员登录；AI 服务说明、经营者信息等不涉及登录同意。 */
export function activateConfirmText(row: LegalDocVersionView): string {
  const label = `${docTypeLabel(row.docType)}（${row.version}）`
  const head = `确认激活 ${label} 为当前有效版本？同类型其它版本将同时失活。`
  if ((LOGIN_CONSENT_DOC_TYPES as readonly string[]).includes(row.docType)) {
    return (
      `${head}\n\n` +
      '· 会员登录时勾选同意的就是这一版，登录同意记录会关联这个版本号；\n' +
      '· 已同意过旧版的会员，下次登录需要重新阅读并勾选；\n' +
      '· 生产环境要求《用户服务协议》《隐私政策》两份都已发布，会员才能登录。'
    )
  }
  return `${head}\n\n这类文档不涉及会员登录同意，激活不会要求会员重新勾选。`
}
