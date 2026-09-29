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
 * 知情同意当前版本 —— 真源在 `packages/shared/src/types/selfAssessment.ts`，本行是 CJS 镜像。
 * 两处必须逐字相等，由 `verify:self-assessment-consent` 锁死。
 * 条款原文 `SELF_ASSESSMENT_CONSENT_ITEMS` 同样是那份数组的镜像。
 */
export const SELF_ASSESSMENT_CONSENT_VERSION = 'sa-consent-v1.2026-09-29'

/** 与当前版本配套的条款原文。改任一条必须同时升 `SELF_ASSESSMENT_CONSENT_VERSION`。 */
export const SELF_ASSESSMENT_CONSENT_ITEMS = [
  '本工具基于本人作答提供倾向参考，不是临床 / 心理 / 人格诊断。',
  '结果对本人可见，不向企业、合作机构、第三方推送。',
  '作答后可在结果页一键撤回 / 物理删除；不留存本人答案原文。',
  '本工具不评估「适合 / 不适合」任何岗位或职业，亦不构成能力证明。',
  '5 段解读由 AI 生成（E3 · 仅供参考）；维度强度由固定权重算出，不经过 AI。',
  '本工具面向年满 14 周岁的用户；未满 14 周岁的，请在监护人同意并陪同下使用。',
] as const

/**
 * 过渡期仍接受的旧同意版本。必须逐个写出来。
 * 清空或删掉某一项之后，那个版本必须回到 400，不能改成「任何更早的版本都收」。
 * 小程序带上新条款并全量之后，由后端窗口去掉这份清单。
 */
export const SELF_ASSESSMENT_CONSENT_LEGACY_VERSIONS = [
  'sa-consent-v1.2026-08-16',
] as const

/** 当前版本，或清单里点名的旧版本。不是范围比较。 */
export function isAcceptedSelfAssessmentConsentVersion(version: string): boolean {
  if (version === SELF_ASSESSMENT_CONSENT_VERSION) return true
  return (SELF_ASSESSMENT_CONSENT_LEGACY_VERSIONS as readonly string[]).includes(version)
}

export interface SelfAssessmentQuestionsResponse {
  version: 'v1'
  dimensions: SelfAssessmentDimensionV1[]
  consentVersion: string
  consentItems: string[]
}

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
  /**
   * 本条结果里有没有 AI 写的解读（任一维 note 或 summary 非空）。
   * false ⇒ 打分照常、解读缺席：AI 被闸门拦下（暂停 / 额度用完 / 未开通 / 声明缺失 / 须登录）或模型调不通。
   * 旧服务端不回本字段，前端缺省时按 providerName === 'llm_unavailable' 兜底判断。
   */
  interpretationAvailable?: boolean
  /**
   * 解读缺席的原因码；interpretationAvailable=true 时为 null。
   * 闸门码：AI_PAUSED / AI_BUDGET_EXHAUSTED / AI_BUDGET_UNAVAILABLE / AI_PROVIDER_NOT_CONFIGURED /
   * AI_DECLARATION_REQUIRED / AI_LOGIN_REQUIRED / AI_ACCESS_CHECK_FAILED；
   * 模型码：AI_NOT_CONFIGURED / AI_BUSY / AI_SELF_ASSESSMENT_TIMEOUT / AI_PROVIDER_* / AI_EMPTY_RESPONSE /
   * AI_CONTENT_BLOCKED / AI_ENDPOINT_NOT_ALLOWED / AI_UNAVAILABLE / AI_INTERPRETATION_UNPARSEABLE；
   * 说不出原因时 AI_INTERPRETATION_UNAVAILABLE；
   * 模型整体合规拒答为 COMPLIANCE_REJECT（此时 status=completed，打分照常，不要求重新作答）。
   */
  aiUnavailableReason?: string | null
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
  /** 合并后 PDF 的真实总页数（简历页 + 附录页）。报价与展示必须用这个。 */
  pageCount: number
  /** 附录（自我探索报告）自身的页数；不是总页数。 */
  appendixPageCount: number
  signedUrl: string
  expiresAt: string
  printFileUrl: string
}
