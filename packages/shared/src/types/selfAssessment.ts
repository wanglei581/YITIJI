// ============================================================
// 自我探索 · 倾向参考 —— 共享类型（v1）
//
// 合规口径（与 docs/compliance/compliance-boundary.md §4.5 同档）：
// - 非临床 / 非诊断 / 本人自助参考；不复用 MBTI / 大五 / DISC / 霍兰德 / SCL /
//   PHQ / GAD / MMPI 等任何标签或量表。
// - 结果对本人可见，对企业 / 合作机构 / Partner / Admin 不可见；
//   不参与匹配 / 速配 / 排序 / 推荐 / 套餐 / 补贴。
// - 答案原文不入库：仅存 SHA-256(answers JSON) 与衍生维度分值。
// - 不参与 career_plan 校验 / 配额 / 签名门禁；基于本人作答作答，仅作
//   CareerPlanService.generate() 的可选 hint。
// ============================================================

/** 五大维度 key（与题目 seed 对齐；v1 固定）。 */
export type SelfAssessmentDimensionKey =
  | 'interest'      // 兴趣偏好
  | 'style'         // 工作风格
  | 'team'          // 团队偏好
  | 'value'         // 价值取向
  | 'motivation'    // 求职动机

export const SELF_ASSESSMENT_DIMENSIONS: Array<{ key: SelfAssessmentDimensionKey; label: string }> = [
  { key: 'interest',   label: '兴趣偏好' },
  { key: 'style',      label: '工作风格' },
  { key: 'team',       label: '团队偏好' },
  { key: 'value',      label: '价值取向' },
  { key: 'motivation', label: '求职动机' },
]

/** 单题结构：每题 per-dimension 固定 5 题；choices 长度 ≥ 2。 */
export interface SelfAssessmentQuestionV1 {
  idx: number                     // 0..4
  prompt: string                  // 题目文案（不含敏感标签字样）
  choices: Array<{ key: string; label: string; weight: number }>
  /** 题目是否触及敏感话题（健康/家庭/信仰等）。不强制回答但需单独勾选同意。 */
  sensitive?: boolean
}

/** 题目版本（v1）：5 维度 × 5 题 × 单选 = 25 题。 */
export interface SelfAssessmentDimensionV1 {
  key: SelfAssessmentDimensionKey
  label: string
  questions: SelfAssessmentQuestionV1[]
}

export interface SelfAssessmentQuestionsV1 {
  version: 'v1'
  dimensions: SelfAssessmentDimensionV1[]
}

/** 单题作答（前端 → 后端）。choice 仅是题目 choice.key。 */
export interface SelfAssessmentAnswerV1 {
  dim: SelfAssessmentDimensionKey
  idx: number
  choice: string
}

/** 同意颗粒度：nonSensitive 必须勾选；sensitive 可选。 */
export interface SelfAssessmentConsent {
  nonSensitive: boolean
  sensitive: boolean
}

/** 单维度结果：纯函数 strength + 自然语言解读。 */
export interface SelfAssessmentDimensionResult {
  key: SelfAssessmentDimensionKey
  label: string
  /** 0..5：5 题 weight 累加后归一化（每题 weight ∈ [0,1] → 总分 ∈ [0,5]）。 */
  strength: 0 | 1 | 2 | 3 | 4 | 5
  /** 自然语言解读（≤300 字）。命中合规词或服务端拒答时为 null。 */
  note: string | null
  /** 推导依据：被采用的题号（v1 内 idx，仅 key 不含答案）。 */
  evidenceQuestionIdx: number[]
}

/** 结果 payload（落库 / 返回）。 */
export interface SelfAssessmentPayload {
  version: 'v1'
  /** SHA-256(JSON.stringify(answers))，原文不入库。 */
  answersHash: string
  /** 5 维度结果。 */
  dimensions: SelfAssessmentDimensionResult[]
  /** 整体解读（≤300 字），命中断言时为 null。 */
  summary: string | null
  aiProvider?: string | null
  /** ISO8601。 */
  completedAt: string
}

/** 提交作答响应。 */
export interface SelfAssessmentSubmitResponse {
  taskId: string
  status: 'completed' | 'rejected'
  /** 命中合规词被整体拒绝时给出原因（前端引导用户重新作答）。 */
  failReason?: string
  /** 5 维度结果。 */
  dimensions: SelfAssessmentDimensionResult[]
  summary: string | null
  providerName?: string
  /** 匿名结果一次性访问令牌（仅匿名提交响应返回一次）。 */
  accessToken?: string
  expiresAt: string | null
}

/** 读回响应。 */
export interface SelfAssessmentResponse extends SelfAssessmentSubmitResponse {
  /** 服务端历史回看时不含 accessToken；新提交才有。 */
  accessToken?: never
}

/** 打印响应（与既有 PDF 链路一致）。 */
export interface SelfAssessmentPrintResponse {
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
  printFileUrl?: string
}