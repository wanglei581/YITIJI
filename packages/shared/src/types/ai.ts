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
 * 求职目标方向上下文（用户在 /resume/source 同页设置）
 *
 * 合规：仅用于求职准备方向和简历表达诊断，不做企业匹配、录用预测或站内投递结论。
 */
export interface ResumeTargetContext {
  /** 行业方向（如 互联网/科技、制造业、通用） */
  industry?: string
  /** 目标岗位（自由文本，可空） */
  targetJob?: string
  /** 经验级别（应届/1-3年/3-5年/5年以上） */
  experience?: ResumeTargetExperience
  /** 求职场景（校招/社招/转岗/招聘会现场） */
  scene?: ResumeTargetScene
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
  /** 用户选择的重点诊断维度。只影响建议重点，不裁剪后端固定 6 维输出结构。 */
  selectedDimensions?: ResumeScoringDimensionKey[]
  /** 目标方向上下文。仅用于本人简历表达诊断，不进入企业侧能力。 */
  targetContext?: ResumeTargetContext
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
   * 提取层提示（Stage 3 OCR）：textSource=pdf_ocr/image_ocr 时附带置信度与用户须知
   * （低置信度须提示人工核对、扫描件仅识别前 N 页等）。仅元数据，不含简历原文。
   */
  extractionNotice?: {
    textSource: string
    confidence: 'high' | 'medium' | 'low'
    warnings: string[]
  }
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

/** 百宝箱首方 AI 技能场景；与助手消息分类 intent 保持正交 */
export type AssistantSkill =
  | 'offer_compare'       // 百宝箱：Offer 对比
  | 'salary_negotiation'  // 百宝箱：薪资谈判话术
  | 'hr_qa'               // 百宝箱：HR 知识问答

/** 助手建议操作（提供路由跳转按钮） */
export interface AssistantAction {
  label: string
  route: string
}

/** 用户向 AI 助手发送的消息 */
export interface AssistantChatRequest {
  message: string
  sessionId?: string
  /** 百宝箱 / 助手入口传入的受控首方技能；为空时后端按消息兜底分类 */
  skill?: AssistantSkill
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

// ── 2D 目标岗位定向优化 + 岗位匹配度参考 ─────────────────────────────────────
// 合规:fitLevel 为参考等级(高/中/低),绝无百分比/匹配率/录用概率;投递引导
// 「去来源平台投递」。matchPoints.evidence 经服务端防编造校验(必须出自简历原文)。

export interface JobFitRequest {
  /** 简历解析任务 id(凭会员 token 或匿名 accessToken 读回原文) */
  taskId: string
  /** 二选一:系统内已发布岗位 id */
  jobId?: string
  /** 二选一:手填目标岗位 */
  manualJob?: { title: string; requirements?: string }
}

export interface JobFitJobInfo {
  title: string
  company: string | null
  /** 仅 jobId 模式:来源信息(用于「去来源平台投递」引导) */
  sourceName: string | null
  sourceUrl: string | null
  externalId: string | null
}

export interface JobFitResponse {
  taskId: string
  status: 'completed' | 'failed'
  failReason?: string
  job?: JobFitJobInfo
  fitLevel?: 'reference_high' | 'reference_medium' | 'reference_low'
  summary?: string
  matchPoints?: Array<{ point: string; evidence: string }>
  gapPoints?: Array<{ gap: string; suggestion: string }>
  targetedSuggestions?: string[]
  providerName?: string
}

// ── 岗位信息 AI 推荐 / 解读（商用闭环 Task 2）───────────────────────────────
// 合规：所有推荐和解读均为「仅供参考」，只服务求职者本人；不包含投递结果、
// 企业候选人筛选、面试邀约、Offer 或任何招聘闭环状态。

export type JobAiFitLevel = 'reference_high' | 'reference_medium' | 'reference_low'

export interface TargetJobContext {
  jobId: string
  title: string
  company: string
  sourceName: string
  sourceUrl: string
  externalId: string
  description?: string
  requirements?: string
  skills: string[]
  city: string
  category?: string
}

export interface JobRecommendationFilters {
  city?: string
  category?: string
  skills?: string[]
  sourceOrgId?: string
}

export interface JobRecommendationRequest {
  resumeTaskId: string
  /** 匿名简历结果一次性 accessToken；会员模式下由 Bearer token 鉴权。 */
  accessToken?: string
  intent?: {
    targetTitle?: string
    city?: string
    industry?: string
    keywords?: string[]
  }
  filters?: JobRecommendationFilters
  limit?: number
}

export interface JobAiSessionDTO {
  id: string
  resumeTaskId?: string | null
  operation: 'recommend' | 'explain' | 'match'
  status: AiTaskStatus
  provider?: string | null
  terminalId?: string | null
  createdAt: string
  expiresAt?: string | null
}

export interface JobAiRecommendationDTO {
  job: TargetJobContext
  rank: number
  fitLevel: JobAiFitLevel
  summary: string
  matchPoints: string[]
  gapPoints: string[]
  actionChecklist: string[]
  createdAt: string
}

export interface JobAiSessionListItem {
  session: JobAiSessionDTO
  job?: TargetJobContext
  recommendationCount: number
}

export interface JobRecommendationResponse {
  session: JobAiSessionDTO
  recommendations: JobAiRecommendationDTO[]
  disclaimer: '仅供参考'
}

export interface JobExplainResponse {
  session: JobAiSessionDTO
  job: TargetJobContext
  responsibilities: string[]
  mustHaveRequirements: string[]
  niceToHaveRequirements: string[]
  preparationTips: string[]
  dataQualityWarning?: string
  disclaimer: '仅供参考'
}

// ── 2E 职业规划建议 ──────────────────────────────────────────────────────────
// 合规:仅供本人参考;无薪资/录用/Offer/通过率承诺;现状画像 evidence 经服务端
// 防编造校验(必须出自简历原文)。

export interface CareerPlanResponse {
  taskId: string
  status: 'completed' | 'failed'
  failReason?: string
  /** 生成依据(如实展示):简历必有;岗位匹配/面试摘要可选 */
  basedOn?: { resume: true; jobFit: string | null; interview: string | null }
  summary?: string
  currentSnapshot?: Array<{ point: string; evidence: string }>
  directions?: Array<{ title: string; why: string; firstStep: string }>
  skillPlan?: Array<{ skill: string; action: string; timeframe: string }>
  actionChecklist?: string[]
  providerName?: string
}

export interface CareerPlanPrintResponse {
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
}

// ── 招聘会 AI 参会准备单 ───────────────────────────────────────────────────
// 合规:仅供本人参会准备参考;不含平台内办理结果、不含企业端筛选或邀约状态。

export interface FairVisitPlanFairSnapshot {
  id: string
  title: string
  sourceName: string
  sourceUrl: string
  startAt: string
  endAt: string
  venue: string
  city: string
}

export interface FairVisitPlanResponse {
  taskId: string
  status: 'completed' | 'failed'
  failReason?: string
  basedOn?: {
    resume: true
    fairId: string
    fairName: string
    companyCount: number
    positionCount: number
  }
  fair?: FairVisitPlanFairSnapshot
  summary?: string
  fairHighlights?: string[]
  priorityCompanies?: Array<{ companyName: string; reason: string; sourceUrl: string | null }>
  preparationChecklist?: string[]
  questionsToAsk?: string[]
  onsiteTips?: string[]
  providerName?: string
}

export interface FairVisitPlanPrintResponse {
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
}
