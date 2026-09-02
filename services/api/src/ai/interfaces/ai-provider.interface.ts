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
//
// ⚠️ AiProviderName 是**部署形态**标签，不是厂商标签：AI_PROVIDER=llm 时它恒为 'llm'，
// 不含 deepseek/qwen 等真实厂商名。成本定价按厂商名做子串匹配（ai-log.service.ts
// estimateCostCny），所以**绝不能拿 AiProviderName 当落账 provider 标签**——那样即使
// 补上 token 也永远匹配不到单价。真实厂商标识走下面的 AiUsageReport.providerLabel。
export type AiProviderName = 'openai' | 'claude' | 'qwen' | 'zhipu' | 'local' | 'mock' | 'llm'

// ─── 用量回报（AI-COST-TRUTH）────────────────────────────────

/** token 用量。字段缺失（整个对象为 undefined）= 未采集，**不等于 0**。 */
export interface AiTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * provider 对一次能力调用的真实用量回报。
 *
 * 为什么必须由 provider 上报、而不是让调用方猜：
 * 1. 只有 provider 层知道真实厂商与模型（AiProviderName 恒为 'llm'，定价表匹配不到）；
 * 2. 只有 provider 知道自己**有没有真的打到模型**——「没花钱」和「没采集到」是两回事，
 *    调用方在外面看到的都是一个失败，无从区分。
 *
 * 三态由 callCount + tokenUsage 组合表达，**禁止用 0 兼表「未采集」**：
 * - callCount === 0                → 一次都没打到模型，成本确定为 0（如未配置直接抛错）
 * - callCount > 0 且有 tokenUsage  → 成本可按 providerLabel 里的厂商名计算
 * - callCount > 0 且无 tokenUsage  → **未采集**，成本必须留空（落库 null），绝不写 0
 */
export interface AiUsageReport {
  /**
   * 真实厂商标识，形如 `llm:deepseek:deepseek-chat`。
   * 必须含厂商名，否则 estimateCostCny 匹配不到单价 → 永远算不出成本。
   * 只放厂商/模型名，**不得**包含 apiKey、baseURL 或任何凭证片段。
   */
  providerLabel: string
  /** 实际打到模型的次数（含失败重试）。0 = 未产生任何上游调用，即未花钱。 */
  callCount: number
  /** 累计 token；上游没回 usage 时为 undefined —— 表示未采集，不是 0。 */
  tokenUsage?: AiTokenUsage
}

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

export const RESUME_TARGET_EXPERIENCE_OPTIONS = ['无工作经验', '应届', '1年以内', '1-3年', '3-5年', '5年以上'] as const
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
  /** 专业方向（自由文本，可空；仅用于本人简历表达诊断/优化重点） */
  major?: string
  /** 学历层次（自由文本或枚举文案，如 大专/本科/硕士；可空） */
  degree?: string
  skipped?: boolean
}

/**
 * 简历内容块固定七块（key 为跨端协议，不随 UI 文案漂移）。
 *
 * 为什么不让模型自由切分：Kiosk 报告页 `/resume/report?blk=` 深链契约与相关门禁都
 * 建在这个枚举上（原型 docs/design/kiosk-redesign-2026-08/22-resume-report.html 的
 * BLK_KEYS 与此逐字一致）。模型每次自拟块名，深链与断言会同时失效。
 */
export const RESUME_CONTENT_BLOCKS = [
  { key: 'basic',      label: '基础信息' },
  { key: 'objective',  label: '求职目标' },
  { key: 'education',  label: '教育经历' },
  { key: 'experience', label: '工作经历' },
  { key: 'project',    label: '项目经历' },
  { key: 'skill',      label: '技能' },
  { key: 'selfintro',  label: '自我评价' },
] as const

export type ResumeContentBlockKey = typeof RESUME_CONTENT_BLOCKS[number]['key']

/**
 * 简历内容块：简历被切成固定七块，每块摆出实际片段。
 *
 * - `label` 由服务端按 RESUME_CONTENT_BLOCKS 的 canonical 值覆盖模型输出
 *   （与 ResumeSection.label 同一纪律：展示文案不随模型漂移）。
 * - `lines` 每行**逐字**摘自送模型的那份简历文本；服务端逐行回配校验，配不上即丢弃。
 *   每块最多 6 行、每行最多 80 字。
 * - 一行都没留下的块不会出现在数组里：服务端无法区分「简历里没有这块」「模型没摘出来」
 *   「被输入截断切掉了」三种情况，摆一个空块等于替用户下结论。
 *
 * 留存后果（新增面，改动前请先读）：报告要在刷新后仍能渲染，所以这些片段会随
 * AiResumeResult.payloadJson 落库到结果 TTL 到期为止 —— 这是本字段之前不存在的
 * 「简历文本入库」面。片段摘自**遮盖后**的文本，手机 / 邮箱 / 身份证等高置信 PII
 * 已被替换成 [手机号_1] 这类占位符，服务端不做还原（在公共终端上把真手机号显示
 * 回来并写进库，比留占位符更糟）。上限 7 块 × 6 行 × 80 字，不是整份简历。
 */
export interface ResumeContentBlock {
  key: ResumeContentBlockKey
  label: string
  lines: string[]
}

/**
 * 问题证据：一条问题引用的那一行原文。
 *
 * 为什么是「引文拷贝」而不是字符 offset：
 * 1. 模型数不准字符数，offset 几乎必然错位；
 * 2. offset 只在「遮盖后 + 截断后」那份文本里成立，客户端永远拿不到那份文本；
 * 3. 简历原文从不落库，结果过期前服务端自己也复原不出那份文本。
 * 所以模型只发 {blockKey, quote}，`lineIndex` 由服务端把 quote 回配到已校验的
 * lines 算出，回配不上就丢弃该证据 —— 悬空下标这一整类错误在设计上不存在。
 */
export interface ResumeIssueEvidence {
  blockKey: ResumeContentBlockKey
  /** 指向 contentBlocks 中同 key 块的 lines 下标；服务端计算，保证不悬空。 */
  lineIndex: number
  /** 逐字引文，恒等于对应块的 lines[lineIndex]（服务端覆盖模型输出）。 */
  quote: string
}

/**
 * 一条带原文证据的简历问题。
 *
 * 严重度**不进契约**：它由 sections[].score/maxScore 机械分档得出，分档规则常驻印在
 * 报告页上（原型 sevOf()）。能由已有字段算出来的，不问模型。
 *
 * 合规：`impact` 只描述读简历的人会看不到 / 看不懂什么，不得推断招聘方的决定。
 * 本终端是求职打印服务终端，不做企业匹配、录用预测或投递结论。
 */
export interface ResumeIssue {
  /** 服务端分配的稳定短 id（形如 I1）；供前端做 key / data-testid，不含用户文本。 */
  id: string
  /** 所属诊断维度，必须是 RESUME_SCORING_DIMENSIONS 六个 key 之一（不新增维度枚举）。 */
  dim: ResumeScoringDimensionKey
  title: string
  /** 1~3 处原文证据；一处都回配不上的问题整条丢弃。 */
  evidence: ResumeIssueEvidence[]
  impact: string
  fixIt: string
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
  /**
   * 内容结构：简历被切成固定七块的实际片段（S25 报告页主视觉之一）。
   *
   * additive 可选。校验失败**不拖垮整份报告**：清洗后为空就不附带该字段，
   * sections / suggestions / priorities 的严格度一字不改，最坏退回旧报告形态。
   */
  contentBlocks?: ResumeContentBlock[]
  /**
   * 问题与证据：每条问题带维度归属与逐字原文证据（S25 报告页主视觉之一）。
   * additive 可选，失败纪律同 contentBlocks。
   */
  issues?: ResumeIssue[]
  /**
   * 本次诊断只看了简历前若干字符（服务端有输入上限，超出部分从未送进模型）。
   *
   * true = 确实发生过截断，后面的内容块可能整块缺失；页面必须如实说明「没看完」，
   * 否则用户会把「没送进模型」误读成「简历里没有这几块」——CLAUDE.md §9 不伪造能力。
   * 缺省 = 未截断，或旧报告。
   */
  truncatedInput?: boolean
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
  /**
   * 目标方向上下文（Wave 1 Task 3，additive 可选）：随 parse 结果落库，供优化懒生成时读回
   * 透传给 optimizeResume 的第 4 参数。仅结构化字段（industry/targetJob/major/degree/
   * experience/scene/skipped），不含简历原文，不产生新的 PII 留存面。
   */
  targetContext?: ResumeTargetContext
  /**
   * 本次调用的真实用量回报（AI-COST-TRUTH，additive 可选）。
   * 缺省 = provider 未接用量管路 → 落账按「未采集」处理，绝不记 ¥0。
   */
  usage?: AiUsageReport
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
  /** 本次调用的真实用量回报（AI-COST-TRUTH，additive 可选）。语义同 ParseResumeOutput.usage。 */
  usage?: AiUsageReport
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

/**
 * Wave 2:优化版简历 PDF 受控排版参数。
 *
 * 本地类型副本须与 packages/shared/src/types/ai.ts 的 ResumeLayoutSettings 同步；
 * services/api 直接 import ESM-only shared 包存在 CJS 兼容风险,沿用本模块本地镜像约定。
 */
export type ResumeLayoutFontScale = 'compact' | 'standard' | 'large'
export type ResumeLayoutLineSpacing = 'compact' | 'standard' | 'relaxed'
export type ResumeLayoutMargin = 'narrow' | 'normal' | 'wide'
export type ResumeLayoutColumns = 1 | 2
export type ResumeLayoutAccent = 'blue' | 'green' | 'slate'

export interface ResumeLayoutSettings {
  fontScale?: ResumeLayoutFontScale
  lineSpacing?: ResumeLayoutLineSpacing
  margin?: ResumeLayoutMargin
  columns?: ResumeLayoutColumns
  accent?: ResumeLayoutAccent
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
  /** 本次调用的真实用量回报（AI-COST-TRUTH，additive 可选）。语义同 ParseResumeOutput.usage。 */
  usage?: AiUsageReport
}

// ─── AI 助手类型 ─────────────────────────────────────────────

/**
 * 意图分类：不包含招聘闭环意图（apply/candidate/hr）
 */
export type AssistantIntent =
  | 'resume'
  | 'print'
  | 'job'
  | 'fair'
  | 'policy'
  | 'general'

export type AssistantSkill =
  | 'offer_compare'
  | 'salary_negotiation'
  | 'hr_qa'
  | 'self_intro_gen'
  | 'material_checklist'
  | 'jd_analysis'
  | 'interview_questions'
  | 'career_explore'
  | 'cover_letter_gen'
  | 'resume_jd_match'
  | 'company_research'

export interface AssistantAction {
  label: string
  route: string
}

export interface ChatInput {
  message: string
  sessionId?: string
  skill?: AssistantSkill
  context?: Record<string, unknown>
}

export interface ChatOutput {
  sessionId: string
  reply: string
  intent?: AssistantIntent
  actions?: AssistantAction[]
  /**
   * 本次调用的真实用量回报（AI-COST-TRUTH，additive 可选）。
   *
   * ⚠️ 该字段只用于服务端落账，**不得**透传给前端 —— AssistantChatResult 由
   * AiService 显式重建，不会带上它。
   */
  usage?: AiUsageReport
}

/**
 * 助手对话对外响应（S0-1 / 风险 R1）。
 *
 * 背景：`AiService.chatWithAssistant` 是全站**唯一**在功能位未就绪时会回落到
 * `this.provider`（可能是 mock provider 的预置话术）的 AI 路径。回落发生时
 * 用户看到的仍然是一段像模像样的「回答」，无法分辨真假 —— 这是
 * CLAUDE.md §9「不伪造能力」的正面违反。
 *
 * 处置：把服务端本来就算出来的 provider 标签透出到响应里。
 * - `providerLabel === 'llm:<vendor>'` 才是真实大模型；
 * - 任何其它取值（mock / stub provider 名）都**不是** AI 回答，
 *   调用方（前端）不得把它呈现为 AI 生成内容。
 * - `aiGenerated` 是同一判定的布尔化，服务端算好，前端不必自己解析前缀。
 *
 * 该字段只描述「这段文本由谁产生」，不含任何密钥、baseURL、模型名细节。
 */
export interface AssistantChatResult extends ChatOutput {
  /** `llm:<vendor>` = 真实大模型；其它值 = 非模型回落，前端不得呈现为 AI 回答 */
  providerLabel: string
  /** 等价于 providerLabel.startsWith('llm:')；服务端唯一判定源 */
  aiGenerated: boolean
}

/** providerLabel → 是否真实大模型。唯一判定实现，禁止在别处重写前缀判断。 */
export function isLlmProviderLabel(providerLabel: string): boolean {
  return providerLabel.startsWith('llm:')
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
   * targetContext(Wave 1 Task 2,additive 可选):目标方向上下文,仅用于引导优化措辞重点
   * (专业/学历/目标岗位/经验/场景),不得据此新增或改写任何事实字段;事实仍必须来自原文。
   */
  optimizeResume(
    taskId: string,
    report: ResumeReport,
    extractedText?: string,
    targetContext?: ResumeTargetContext,
  ): Promise<OptimizeResumeOutput>
  chatAssistant(input: ChatInput): Promise<ChatOutput>
  classifyIntent(message: string): Promise<ClassifyIntentOutput>
  /**
   * 简历生成(阶段2A,可选能力)。未实现的 provider 由 AiService 统一返回
   * 明确失败(AI_GENERATE_NOT_SUPPORTED),不静默 fallback。
   */
  generateResume?(input: ResumeGenerateInput): Promise<GenerateResumeOutput>
}
