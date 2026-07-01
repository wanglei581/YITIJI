// ============================================================
// AiProvider 接口及所有相关类型
//
// 合规约束（所有实现必须遵守）：
// - AI 结果仅服务求职者本人，不推送给企业
// - 不做企业侧招聘闭环能力
// - API Key 只在服务端 env 中保存，不出现在任何前端代码
// ============================================================

// ─── 任务状态与提供商标识 ────────────────────────────────────

export type AiTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

// 'llm'：复用后台 LlmConfigService 加密凭证（OpenAI 兼容）的真实简历诊断 provider（Phase 1B）。
export type AiProviderName = 'openai' | 'claude' | 'qwen' | 'zhipu' | 'local' | 'mock' | 'llm'

// ─── 简历解析类型 ────────────────────────────────────────────

export interface ResumeSection {
  key: string
  label: string
  score: number
  maxScore: number
}

/** 修改优先级建议（Phase 1.1）：有序，告诉用户先改什么、为什么 */
export interface ResumePriority {
  focus: string
  reason: string
}

/** AI 简历诊断固定 6 个评分维度（key 为跨端协议，不随 UI 文案漂移）。 */
export const RESUME_SCORING_DIMENSIONS = [
  { key: 'basic',          label: '基础信息完整度' },
  { key: 'objective',      label: '求职目标清晰度' },
  { key: 'experience',     label: '经历表达清晰度' },
  { key: 'quantification', label: '成果量化程度' },
  { key: 'keyword',        label: '岗位关键词覆盖' },
  { key: 'readability',    label: '版式与可读性' },
] as const

export type ResumeScoringDimensionKey = typeof RESUME_SCORING_DIMENSIONS[number]['key']

export const RESUME_TARGET_EXPERIENCE_OPTIONS = ['应届', '1-3年', '3-5年', '5年以上'] as const
export type ResumeTargetExperience = typeof RESUME_TARGET_EXPERIENCE_OPTIONS[number]

export const RESUME_TARGET_SCENE_OPTIONS = ['校招', '社招', '转岗', '招聘会现场'] as const
export type ResumeTargetScene = typeof RESUME_TARGET_SCENE_OPTIONS[number]

/**
 * 求职目标方向上下文。
 *
 * 合规：仅用于求职者本人修改简历参考，不做企业匹配、录用预测或站内投递结论。
 */
export interface ResumeTargetContext {
  industry?: string
  targetJob?: string
  experience?: ResumeTargetExperience
  scene?: ResumeTargetScene
  skipped?: boolean
}

/**
 * 诊断报告：评分仅供参考，不代表真实招聘结果。
 *
 * Phase 1.1「8 项诊断结果」内部结构 = 6 评分维度（sections）+ 风险表述提醒（riskNotes）
 * + 修改优先级建议（priorities）。riskNotes / priorities 为 additive 可选字段：
 * 旧报告（5 sections、无这两个字段）仍合法，前端缺失时优雅降级。
 */
export interface ResumeReport {
  sections: ResumeSection[]
  suggestions: string[]
  /** 风险表述提醒（只针对简历文本表达；0~5 条）。旧报告可能缺失。 */
  riskNotes?: string[]
  /** 修改优先级建议（2~4 条）。旧报告缺失时前端回退按低分 section 派生。 */
  priorities?: ResumePriority[]
}

export interface ParseResumeInput {
  fileId: string
  fileName: string
  fileFormat: string
  source: 'upload' | 'scan' | 'manual'
  /** 用户选择的重点诊断维度。只影响建议重点，不裁剪后端固定 6 维输出结构。 */
  selectedDimensions?: ResumeScoringDimensionKey[]
  /** 目标方向上下文。仅用于本人简历表达诊断，不进入企业侧能力。 */
  targetContext?: ResumeTargetContext
  /**
   * 服务端提取的简历文本（Phase 1B）。由 AiService 在调 provider 前经
   * ResumeExtractionService 提取后注入；**不来自前端**（前端只发 fileId）。
   * mock/stub provider 忽略此字段；llm provider 据此调真实大模型。
   */
  extractedText?: string
  /** 提取到的 PDF 页数（可得时）。 */
  extractedPageCount?: number
}

export interface ParseResumeOutput {
  taskId: string
  status: AiTaskStatus
  /**
   * 上传文件 id(阶段2B):随 parse 结果落库,供后续优化按归属重新提取原文。
   * 仅为不透明 id,无 PII;文件本体仍按 FileObject TTL 自动清理。
   */
  fileId?: string
  /** 实际生成报告的 provider；用于前端诚实标记 mock / 真实 AI */
  providerName?: AiProviderName
  report?: ResumeReport
  failReason?: string
  /**
   * 提取层提示（Stage 3 OCR）：来源（pdf_ocr/image_ocr）+ 置信度 + 用户须知
   * （如「置信度有限请人工核对」「仅识别前 N 页」）。仅元数据，不含简历原文。
   */
  extractionNotice?: {
    textSource: string
    confidence: 'high' | 'medium' | 'low'
    warnings: string[]
  }
  /**
   * 匿名结果一次性访问令牌（Phase C-2A）。
   *
   * provider 不产生此字段；由 AiService.submitResumeParse 在匿名 parse 时铸造并注入到响应，
   * 只在 POST /resume/parse 响应中返回一次（DB 只存 accessTokenHash）。会员 parse 不返回。
   */
  accessToken?: string
}

// ─── 简历优化类型 ────────────────────────────────────────────

/** 优化只调整表达，不生成虚假经历 */
export interface ResumeOptimizeModule {
  title: string
  before: string
  after: string
}

export interface OptimizeResumeOutput {
  taskId: string
  status: AiTaskStatus
  modules?: ResumeOptimizeModule[]
  failReason?: string
  /** 实际生成结果的 provider;前端据此显示演示标记(阶段2B) */
  providerName?: AiProviderName
  /**
   * 优化版简历(阶段2B,结构化、可编辑)。
   * 防编造:学校/公司/证书等事实串必须出现在简历原文中,服务端校验,缺失即拒绝输出。
   */
  optimizedResume?: GeneratedResume
}

// ─── 简历生成类型（阶段2A）────────────────────────────────────
//
// 契约源:packages/shared/src/types/ai.ts(前端 SSOT),本文件为 CJS 本地副本,改动须两处同步。
//
// 防编造红线:AI **只润色用户提供的信息**。学校/公司/学位/证书/时间段等事实字段
// 由服务端从用户输入逐字复制,LLM 仅返回按 index 对齐的润色描述文本——
// 结构上不可能新增/虚构经历条目;数量不齐立即判非法重试。

export interface ResumeGenBasic {
  name: string
  phone?: string
  email?: string
  city?: string
}

export interface ResumeGenIntention {
  position: string
  city?: string
  jobType?: string
  salary?: string
}

export interface ResumeGenEducation {
  school: string
  major?: string
  degree?: string
  period?: string
  description?: string
}

export interface ResumeGenExperience {
  company: string
  role: string
  period?: string
  description: string
}

export interface ResumeGenProject {
  name: string
  role?: string
  description: string
}

export interface ResumeGenerateInput {
  basic: ResumeGenBasic
  intention: ResumeGenIntention
  education: ResumeGenEducation[]
  experience: ResumeGenExperience[]
  projects: ResumeGenProject[]
  skills: string[]
  certificates: string[]
  selfIntro?: string
}

/** 生成结果:事实字段与输入逐字一致,仅描述类文本为润色产物。 */
export interface GeneratedResume {
  basic: ResumeGenBasic
  intention: ResumeGenIntention
  /** 个人简介(基于用户输入整体润色;输入完全为空时为空串,提示用户补充) */
  summary: string
  education: ResumeGenEducation[]
  experience: ResumeGenExperience[]
  projects: ResumeGenProject[]
  skills: string[]
  certificates: string[]
}

export interface GenerateResumeOutput {
  taskId: string
  status: AiTaskStatus
  providerName?: AiProviderName
  resume?: GeneratedResume
  /** 服务端确定性计算的缺失提示(如"未填写教育经历"),提示用户补充,AI 不代填 */
  missingHints?: string[]
  failReason?: string
  /** 匿名结果一次性访问令牌,语义同 ParseResumeOutput.accessToken */
  accessToken?: string
}

// ─── AI 助手类型 ─────────────────────────────────────────────

/**
 * 意图分类：不包含招聘闭环意图（apply/candidate/hr）
 */
export type AssistantIntent = 'resume' | 'print' | 'job' | 'fair' | 'policy' | 'general'

export interface AssistantAction {
  label: string
  route: string
}

export interface ChatInput {
  message: string
  sessionId?: string
  context?: Record<string, unknown>
}

export interface ChatOutput {
  sessionId: string
  reply: string
  intent?: AssistantIntent
  actions?: AssistantAction[]
}

// ─── 意图分类类型 ────────────────────────────────────────────

export interface ClassifyIntentOutput {
  intent: AssistantIntent
  confidence: number
}

// ─── 提供商统一接口 ──────────────────────────────────────────

export interface AiProvider {
  /** 提供商标识，用于日志记录 */
  readonly name: AiProviderName

  parseResume(input: ParseResumeInput): Promise<ParseResumeOutput>
  /**
   * 简历优化。阶段2B 起 llm provider 需要简历原文(extractedText)做基于事实的优化;
   * 未传原文时 llm provider 诚实失败。mock / stub 实现可忽略该参数。
   */
  optimizeResume(taskId: string, report: ResumeReport, extractedText?: string): Promise<OptimizeResumeOutput>
  chatAssistant(input: ChatInput): Promise<ChatOutput>
  classifyIntent(message: string): Promise<ClassifyIntentOutput>
  /**
   * 简历生成(阶段2A,可选能力)。未实现的 provider 由 AiService 统一返回
   * 明确失败(AI_GENERATE_NOT_SUPPORTED),不静默 fallback。
   */
  generateResume?(input: ResumeGenerateInput): Promise<GenerateResumeOutput>
}
