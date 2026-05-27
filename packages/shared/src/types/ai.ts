// ============================================================
// AI 服务类型 — Phase 7 AI Service Layer
//
// 合规约束（所有 AI 功能必须遵守）：
// - AI 结果仅服务求职者本人，不推送给企业
// - 不做候选人推荐、简历推送给企业、面试邀约、Offer 管理
// - 所有 AI 分析结果必须标注"仅供参考"
// - API Key 只允许保存在服务端，禁止出现在前端代码中
// ============================================================

// ─── 任务状态与服务商 ─────────────────────────────────────────

/** AI 任务异步状态 */
export type AiTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

/**
 * AI 服务提供商枚举
 * 切换提供商只需修改服务端配置；前端代码不感知具体提供商
 */
export type AiProviderName =
  | 'openai'    // OpenAI GPT 系列
  | 'claude'    // Anthropic Claude 系列
  | 'qwen'      // 阿里通义千问
  | 'zhipu'     // 智谱 GLM 系列
  | 'local'     // 本地部署模型（如 Ollama）
  | 'mock'      // 开发/测试 mock 模式

// ─── 简历解析 ────────────────────────────────────────────────

/** 简历诊断分项得分 */
export interface ResumeSection {
  key: string
  label: string
  score: number
  maxScore: number
}

/**
 * 简历诊断报告
 * 合规：分数为参考评估，不代表真实招聘结果
 */
export interface ResumeReport {
  sections: ResumeSection[]
  suggestions: string[]
}

/** 简历解析请求（前端 → 后端） */
export interface ResumeParseRequest {
  /** 文件上传后的 ID（由后端文件服务颁发） */
  fileId: string
  /** 原始文件名，用于日志记录 */
  fileName: string
  /** 文件格式：pdf/docx/jpg 等 */
  fileFormat: string
  /** 来源方式 */
  source: 'upload' | 'scan' | 'manual'
}

/** 简历解析响应（后端 → 前端） */
export interface ResumeParseResponse {
  taskId: string
  status: AiTaskStatus
  /** 解析成功时返回报告 */
  report?: ResumeReport
  /** 失败时返回原因 */
  failReason?: string
}

// ─── 简历优化 ────────────────────────────────────────────────

/** 单条优化建议模块（优化前 vs 建议参考） */
export interface ResumeOptimizeModule {
  title: string
  /** 原始表达（摘自简历） */
  before: string
  /** AI 优化建议（不生成虚假经历，只优化表达） */
  after: string
}

/** 简历优化请求 */
export interface ResumeOptimizeRequest {
  taskId: string
}

/** 简历优化响应 */
export interface ResumeOptimizeResponse {
  taskId: string
  status: AiTaskStatus
  modules?: ResumeOptimizeModule[]
  failReason?: string
}

// ─── AI 助手 ─────────────────────────────────────────────────

/**
 * 助手意图分类（用于 intent router 跳转）
 * 合规：不包含 apply/candidate/hr 等招聘闭环意图
 */
export type AssistantIntent =
  | 'resume'   // 简历相关引导
  | 'print'    // 打印扫描引导
  | 'job'      // 岗位信息引导
  | 'fair'     // 招聘会引导
  | 'policy'   // 政策服务引导
  | 'general'  // 通用问答

/** 助手建议操作（提供路由跳转按钮） */
export interface AssistantAction {
  label: string
  route: string
}

/** 用户向 AI 助手发送的消息 */
export interface AssistantChatRequest {
  message: string
  sessionId?: string
  /** 当前页面上下文（如当前模块、设备状态等） */
  context?: Record<string, unknown>
}

/** AI 助手回复 */
export interface AssistantChatResponse {
  sessionId: string
  /** 文字回复内容（仅供参考） */
  reply: string
  intent?: AssistantIntent
  /** 可选的快捷操作按钮 */
  actions?: AssistantAction[]
}
