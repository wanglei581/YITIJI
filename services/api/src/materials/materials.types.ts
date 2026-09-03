export type MaterialTaskKind =
  | 'inspection'
  | 'normalize_a4'
  | 'pii_scan'
  | 'pii_redact'
  | 'bundle_render'

export type MaterialTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type PiiFindingAction = 'pending' | 'keep' | 'redact'

export interface MaterialsRequester {
  kind: 'anonymous' | 'member'
  endUserId?: string
  accessToken?: string
}

/**
 * 命中片段在文字层 PDF 上的一个矩形（PDF 用户空间点 pt，原点左下角）。
 * pageWidth / pageHeight 一并给出，前端可按任意 DPI 换算预览叠加框。
 * 只有坐标，不含任何 PII 原文。
 */
export interface PiiFindingBoxView {
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  pageWidth: number
  pageHeight: number
}

export interface PiiFindingView {
  id: string
  taskId: string
  type: string
  label: string
  pageNumber: number | null
  snippet: string | null
  confidence: number | null
  action: PiiFindingAction
  /**
   * 该值在文档里**全部**出现位置的矩形。
   * 空数组 = 拿不到坐标（扫描件 / DOCX / 图片），该项不可遮挡（applied 会是 failed_no_position）。
   */
  boxes: PiiFindingBoxView[]
  createdAt: string
}

/** 逐项遮挡结果（决策文档 §3.4）。 */
export type PiiRedactionAppliedResult = 'redacted' | 'kept' | 'failed_no_position'

export interface PiiRedactionItemView {
  id: string
  type: string
  pageNumber: number | null
  requested: 'redact' | 'keep'
  applied: PiiRedactionAppliedResult
}

/**
 * 「能说什么」由后端在 API 边界上强制，前端按 claim 选文案，不做自己的判断（决策文档 §3.4）。
 *
 * 相对决策文档的两处**增补**（文档四值覆盖不到，硬塞会产生误导性文案，已在 PR 说明）：
 *   - 'nothing_to_redact'：用户一处都没选遮挡（或压根没检出）→ 不需要也不会生成派生件，
 *     这是成功状态，不是 not_supported。
 *   - notSupportedReason 增加 decisions_pending / decision_task_invalid / unsupported_format /
 *     source_unavailable / render_unverified / output_too_large / redaction_failed，
 *     前端必须按 notSupportedReason 选文案，不能一律套用"这份是扫描件"那句。
 */
export type PiiRedactionClaim =
  | 'redacted_verified'
  | 'redacted_unverified'
  | 'partial'
  | 'not_supported'
  | 'nothing_to_redact'

export type PiiRedactionNotSupportedReason =
  | 'scanned_no_position'
  | 'encrypted'
  | 'too_many_pages'
  | 'unsupported_format'
  | 'source_unavailable'
  | 'render_unverified'
  | 'output_too_large'
  | 'redaction_failed'
  | 'decisions_pending'
  | 'decision_task_invalid'

export interface PiiReverifyView {
  ran: boolean
  /** > 0 = 没盖干净。只统计用户要求遮挡的那些值是否仍能从派生件里提取出来。 */
  remainingCount: number
  method: 'text_layer' | 'ocr' | 'skipped'
}

export interface DocumentProcessTaskView {
  id: string
  kind: MaterialTaskKind
  status: MaterialTaskStatus
  requesterMode: 'anonymous' | 'member'
  accessToken?: string
  sourceFileId: string
  resultFileId: string | null
  endUserId: string | null
  params: Record<string, unknown>
  result: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  piiFindings?: PiiFindingView[]
}
