// ============================================================
// AiProvider 接口及所有相关类型
//
// 合规约束（所有实现必须遵守）：
// - AI 结果仅服务求职者本人，不推送给企业
// - 不做候选人推荐、简历推送企业、面试邀约、Offer 管理
// - API Key 只在服务端 env 中保存，不出现在任何前端代码
// ============================================================

// ─── 任务状态与提供商标识 ────────────────────────────────────

export type AiTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type AiProviderName = 'openai' | 'claude' | 'qwen' | 'zhipu' | 'local' | 'mock'

// ─── 简历解析类型 ────────────────────────────────────────────

export interface ResumeSection {
  key: string
  label: string
  score: number
  maxScore: number
}

/** 诊断报告：评分仅供参考，不代表真实招聘结果 */
export interface ResumeReport {
  sections: ResumeSection[]
  suggestions: string[]
}

export interface ParseResumeInput {
  fileId: string
  fileName: string
  fileFormat: string
  source: 'upload' | 'scan' | 'manual'
}

export interface ParseResumeOutput {
  taskId: string
  status: AiTaskStatus
  report?: ResumeReport
  failReason?: string
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
