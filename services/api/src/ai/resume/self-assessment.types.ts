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

export interface SelfAssessmentConsent {
  nonSensitive: boolean
  sensitive: boolean
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
