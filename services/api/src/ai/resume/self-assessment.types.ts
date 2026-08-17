// ============================================================
// 自我探索 · 倾向参考 —— CJS 本地副本（服务端契约）
//
// 契约源:packages/shared/src/types/selfAssessment.ts(前端 SSOT)。
//
// services/api 走 commonjs 运行时 + node moduleResolution,而 packages/shared
// 是 ESM-only、exports 直指 .ts,互操作复杂 —— 与 files/file.types.ts 同样处理。
// 任何字段变更须同时改两处：packages/shared 与本文件。
// ============================================================

export type SelfAssessmentDimensionKey =
  | 'interest'
  | 'style'
  | 'team'
  | 'value'
  | 'motivation'

export const SELF_ASSESSMENT_DIMENSIONS: Array<{ key: SelfAssessmentDimensionKey; label: string }> = [
  { key: 'interest',   label: '兴趣偏好' },
  { key: 'style',      label: '工作风格' },
  { key: 'team',       label: '团队偏好' },
  { key: 'value',      label: '价值取向' },
  { key: 'motivation', label: '求职动机' },
]

export interface SelfAssessmentQuestionV1 {
  idx: number
  prompt: string
  choices: Array<{ key: string; label: string; weight: number }>
  sensitive?: boolean
}

export interface SelfAssessmentDimensionV1 {
  key: SelfAssessmentDimensionKey
  label: string
  questions: SelfAssessmentQuestionV1[]
}

export interface SelfAssessmentQuestionsV1 {
  version: 'v1'
  dimensions: SelfAssessmentDimensionV1[]
}

export interface SelfAssessmentAnswerV1 {
  dim: SelfAssessmentDimensionKey
  idx: number
  choice: string
}

/**
 * 知情同意版本号 —— 真源在 `packages/shared/src/types/selfAssessment.ts`，本行是 CJS 镜像。
 * 两处必须**逐字相等**，由 `verify:self-assessment-consent` 门禁锁死（连同 kiosk 那份）。
 */
export const SELF_ASSESSMENT_CONSENT_VERSION = 'sa-consent-v1.2026-08-16'

export interface SelfAssessmentConsent {
  nonSensitive: boolean
  sensitive: boolean
  /** 勾选时生效的同意版本号；缺省视为「未版本化同意」。 */
  consentVersion?: string
}

export interface SelfAssessmentDimensionResult {
  key: SelfAssessmentDimensionKey
  label: string
  strength: 0 | 1 | 2 | 3 | 4 | 5
  note: string | null
  evidenceQuestionIdx: number[]
}

export interface SelfAssessmentPayload {
  version: 'v1'
  answersHash: string
  dimensions: SelfAssessmentDimensionResult[]
  summary: string | null
  aiProvider?: string | null
  completedAt: string
}

export interface SelfAssessmentSubmitResponse {
  taskId: string
  status: 'completed' | 'rejected'
  failReason?: string
  dimensions: SelfAssessmentDimensionResult[]
  summary: string | null
  providerName?: string
  accessToken?: string
  expiresAt: string | null
  /** 本条记录实际存下的同意版本；null = 未版本化同意。 */
  consentVersion?: string | null
  /** 勾选时刻（ISO8601）；未版本化同意时为 null。 */
  consentedAt?: string | null
  /** 存下的版本是否仍等于当前版本；false ⇒ 必须重新确认。 */
  consentCurrent?: boolean
}

export interface SelfAssessmentResponse extends SelfAssessmentSubmitResponse {
  accessToken?: never
}

export interface SelfAssessmentPrintResponse {
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
  printFileUrl?: string
}

/**
 * 追加到简历 PDF 的响应。`printFileUrl` 是内部 HMAC URL（`/print/jobs` 只认这种），
 * 与仅供预览 / 扫码的 `signedUrl` 是两条链路，不可互换。
 */
export interface SelfAssessmentAppendResponse {
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
  printFileUrl: string
}
