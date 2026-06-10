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
  /** 实际生成报告的 provider；用于前端诚实标记 mock / 真实 AI */
  providerName?: AiProviderName
  report?: ResumeReport
  failReason?: string
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
  optimizeResume(taskId: string, report: ResumeReport): Promise<OptimizeResumeOutput>
  chatAssistant(input: ChatInput): Promise<ChatOutput>
  classifyIntent(message: string): Promise<ClassifyIntentOutput>
}
