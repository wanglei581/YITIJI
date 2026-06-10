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
  | 'llm'       // 复用后台 AI 模型配置的真实简历诊断（OpenAI 兼容，Phase 1B）

// ─── 简历解析 ────────────────────────────────────────────────

/** 简历诊断分项得分 */
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
 * 简历诊断报告
 * 合规：分数为参考评估，不代表真实招聘结果
 *
 * Phase 1.1「8 项诊断结果」= 6 评分维度（sections）+ 风险表述提醒（riskNotes）
 * + 修改优先级建议（priorities）。riskNotes / priorities 为 additive 可选字段：
 * 旧报告（5 sections、无这两个字段）仍合法，前端缺失时优雅降级（隐藏风险卡 /
 * 优先项回退按低分 section 派生）。
 */
export interface ResumeReport {
  sections: ResumeSection[]
  suggestions: string[]
  /** 风险表述提醒（只针对简历文本表达；0~5 条）。旧报告可能缺失。 */
  riskNotes?: string[]
  /** 修改优先级建议（2~4 条）。旧报告缺失时前端回退按低分 section 派生。 */
  priorities?: ResumePriority[]
}

/**
 * 求职目标方向上下文（用户在 /resume/target 选择）
 *
 * 仅用于前端流程内的 location.state 传递与报告/优化页摘要展示，
 * 暂不随 ResumeParseRequest 发送到后端（避免破坏现有 DTO 校验）。
 * 后端支持后再接入。合规：仅用于求职准备方向，不做企业匹配/录用预测。
 */
export interface ResumeTargetContext {
  /** 行业方向（如 互联网/科技、制造业、通用） */
  industry?: string
  /** 目标岗位（自由文本，可空） */
  targetJob?: string
  /** 经验级别（应届/1-3年/3-5年/5年以上） */
  experience?: string
  /** 求职场景（校招/社招/转岗/招聘会现场） */
  scene?: string
  /** 是否为"暂不指定，通用诊断" */
  skipped?: boolean
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
  /** 上传文件 id(阶段2B):供后续优化按归属重新提取原文;不透明 id,无 PII */
  fileId?: string
  /** 实际生成报告的 provider；mock 时前端必须明确标记为演示报告 */
  providerName?: AiProviderName
  /** 解析成功时返回报告 */
  report?: ResumeReport
  /** 失败时返回原因 */
  failReason?: string
  /**
   * 匿名结果一次性访问令牌（Phase C-2A）。
   *
   * 仅匿名 parse（未登录会员）时返回，且只在本次响应中返回一次（DB 只存 SHA-256 hash）。
   * 后续读取同一 taskId 的 parse/optimize 须凭该 token 走 `x-resume-access-token` header。
   * 登录会员 parse 不返回此字段（结果仍按 endUserId 本人校验）。
   * 前端只在内存 / 最小 session 暂存，绝不写入长期本地存储。
   */
  accessToken?: string
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
  /** 实际生成结果的 provider;前端据此显示演示标记(阶段2B) */
  providerName?: string
  /**
   * 优化版简历(阶段2B,结构化、可编辑)。
   * 防编造:学校/公司/证书等事实串必须出现在简历原文中,服务端校验,缺失即拒绝输出。
   */
  optimizedResume?: GeneratedResume
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

// ─── AI 简历生成（阶段2A）──────────────────────────────────────
//
// 契约镜像:services/api/src/ai/interfaces/ai-provider.interface.ts(CJS 本地副本),
// 改动须两处同步。
//
// 防编造红线:AI 只润色用户提供的信息。学校/公司/学位/证书/时间段等事实字段
// 由服务端从用户输入逐字复制,缺失内容提示用户补充,AI 不代填。

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
  summary: string
  education: ResumeGenEducation[]
  experience: ResumeGenExperience[]
  projects: ResumeGenProject[]
  skills: string[]
  certificates: string[]
}

export interface ResumeGenerateResponse {
  taskId: string
  status: AiTaskStatus
  providerName?: string
  resume?: GeneratedResume
  /** 服务端确定性计算的缺失提示(提示用户补充,AI 不代填) */
  missingHints?: string[]
  failReason?: string
  /** 匿名结果一次性访问令牌(仅提交响应返回一次) */
  accessToken?: string
}

/** 导出 PDF 响应:真实 FileObject + 短时签名 URL,可直接进打印链路 */
export interface ResumeGenerateExportResponse {
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  /** 短时签名下载 URL(inline),用于预览/打印/扫码下载 */
  signedUrl: string
  /** 签名 URL 过期时间(ISO) */
  expiresAt: string
}
