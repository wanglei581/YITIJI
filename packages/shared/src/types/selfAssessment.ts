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

/**
 * 知情同意版本号 —— **全项目唯一真源**。
 *
 * 为什么必须版本化（不是字段偏好，是合规要求）：
 * 只存一个布尔 `consented: true` 的系统，在同意书改版之后，会把用户对
 * **旧版本说明**的同意当成对**新版本说明**的同意 —— 用户从未看过新条款，
 * 系统却按「已同意」放行。版本号的唯一作用，就是让「用户当初同意的那份说明」
 * 与「现在这份说明」可比：**不一致就必须重新确认，而不是静默继承**。
 *
 * 改动 `SELF_ASSESSMENT_CONSENT_ITEMS` 任意一条**必须**同时提高本常量。
 *
 * 当前版本的真源是本常量。服务端 CJS 镜像
 * （`services/api/src/ai/resume/self-assessment.types.ts`）必须与它逐字相等
 * （services/api 走 commonjs，本包是 ESM-only，不能直接 import）。
 * 一体机页面过渡期可以仍声明清单里点名的那一个旧版本；页面由主执行窗口改，
 * 改到本常量之后，展示的条款必须与下面这份数组逐字相同。
 * 门禁：`verify:self-assessment-consent`。
 */
export const SELF_ASSESSMENT_CONSENT_VERSION = 'sa-consent-v1.2026-09-29'

/**
 * 与 `SELF_ASSESSMENT_CONSENT_VERSION` 配套的条款原文，按展示顺序。
 * 前 5 条是一体机现页原文；最后一条是年龄说明。一体机改为：
 * `import { SELF_ASSESSMENT_CONSENT_ITEMS } from '@ai-job-print/shared'`。
 */
export const SELF_ASSESSMENT_CONSENT_ITEMS = [
  '本工具基于本人作答提供倾向参考，不是临床 / 心理 / 人格诊断。',
  '结果对本人可见，不向企业、合作机构、第三方推送。',
  '作答后可在结果页一键撤回 / 物理删除；不留存本人答案原文。',
  '本工具不评估「适合 / 不适合」任何岗位或职业，亦不构成能力证明。',
  '5 段解读由 AI 生成（E3 · 仅供参考）；维度强度由固定权重算出，不经过 AI。',
  '本工具面向年满 14 周岁的用户；未满 14 周岁的，请在监护人同意并陪同下使用。',
] as const

/**
 * 题目接口下发的形状。`consentItems` 与 `consentVersion` 是同一份说明。
 */
export interface SelfAssessmentQuestionsResponse {
  version: 'v1'
  dimensions: SelfAssessmentDimensionV1[]
  consentVersion: string
  consentItems: string[]
}

/**
 * 同意颗粒度：nonSensitive 必须勾选；sensitive 可选。
 *
 * `consentVersion` 为可选：现网前端（S2-7）只发两个布尔、不发版本号。
 * 服务端不会把旧同意升级成新同意：
 *   - 版本号缺省 → 按「未版本化同意」如实记为 null，**不补写当前版本**；
 *   - 版本号 = 当前版 → 记录该版本 + 勾选时刻；
 *   - 版本号属于明确列出的旧版本清单 → 照样收下，落库存的是这份旧版本号，
 *     不算已同意当前说明；
 *   - 其它任何版本 → 直接拒绝（`SELF_ASSESSMENT_CONSENT_VERSION_STALE`），
 *     **不静默放行**。清单不是「任何更早的版本都收」。
 */
export interface SelfAssessmentConsent {
  nonSensitive: boolean
  sensitive: boolean
  /** 勾选时生效的同意版本号；缺省视为「未版本化同意」。 */
  consentVersion?: string
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
  /**
   * 模型调用抛错、这次提交没有完成时给出原因。
   * 模型整体合规拒答不走这里：那时 status=completed，打分照常，
   * aiUnavailableReason=COMPLIANCE_REJECT，不要求重新作答。
   */
  failReason?: string
  /** 5 维度结果。 */
  dimensions: SelfAssessmentDimensionResult[]
  summary: string | null
  providerName?: string
  /** 匿名结果一次性访问令牌（仅匿名提交响应返回一次）。 */
  accessToken?: string
  expiresAt: string | null
  /**
   * 本条记录实际存下来的同意版本；`null` = 未版本化同意（旧前端未上报）。
   * 服务端只回**存下来的事实**，不回「当前版本」冒充已同意。
   */
  consentVersion?: string | null
  /** 勾选时刻（ISO8601）；未版本化同意时为 null。 */
  consentedAt?: string | null
  /**
   * 存下来的同意版本是否仍等于当前版本。
   * `false` ⇒ 同意书已改版或本条未版本化 ⇒ 前端必须请用户重新确认，
   * **不得**因为记录里有一条同意就继续放行。
   */
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

/**
 * 「自我探索报告追加到简历 PDF」响应。
 *
 * 注意 `printFileUrl` 与 `signedUrl` 是**两条不同用途的链路**，不可互换：
 *   - `signedUrl`    = 对象存储签名 URL，给页内预览 / 扫码带走；
 *   - `printFileUrl` = 内部 HMAC 签名 URL（`signFileUrl`），`/print/jobs` **只认这一种**。
 * 缺 `printFileUrl` 时「去打印工作台核价」必然失败 —— 这正是 S2-7 未接本端点的原因。
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