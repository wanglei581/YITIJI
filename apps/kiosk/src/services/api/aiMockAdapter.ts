// ============================================================
// AI Mock Adapter — Phase 7 AI Service Layer
//
// mock 模式下不调用任何真实 AI 服务。
//
// ⚠️ 简历诊断链（parse / report / optimize / compare）在本适配器里**一律拒绝**，
//    不返回任何结果 —— 见下方 `rejectMockMode` 处的事故说明。
//    只有「AI 简历生成」还会返回结构化结果，因为它逐字复制用户自己填的内容，
//    不对用户的材料做任何判断，不存在「假装读过你的简历」这回事。
// ============================================================

import type {
  GeneratedResume,
  ResumeExportFormat,
  ResumeGenerateExportResponse,
  ResumeLayoutSettings,
  ResumeGenerateInput,
  ResumeGenerateResponse,
  ResumeVoiceTranscribeResponse,
  ResumeParseRequest,
  ResumeParseResponse,
  ResumeOptimizeResponse,
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantSkill,
} from '@ai-job-print/shared'
import type { ResumeLayoutAdjustAction, ResumeLayoutAdjustResponse, ResumeReadAccess } from './ai'

/**
 * 演示模式拒绝错误。
 *
 * `code` 必须正好是 `'MOCK_MODE'`：`ai/aiOutage.ts` 的 `AI_OUTAGE_CODES` 只认这个值，
 * 别的码点不亮既有降级 UI。与 jobFit / careerPlan / selfAssessment 三个 service
 * 各自定义 `*ApiError` 的写法一致；刻意不复用 `httpAdapter.ApiHttpError`，
 * 那会把 `client.ts`（读 `import.meta.env`）拖进本模块的运行时依赖。
 */
export class AiMockModeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'AiMockModeError'
  }
}

/**
 * 简历诊断链在演示模式下的唯一出路：如实拒绝。
 *
 * 事故原样（2026-08-18 走查）：本适配器过去对 parse / getResumeRecord /
 * getResumeOptimize 直接 `return` 一份写死的成功结果。于是 8 份完全不同的文件
 * —— 包括一份打印机说明书和一份加密 PDF —— 全部拿到同一份 37/60、同样六个分项
 * 8,6,6,5,5,7、同样四条建议；两张报告像素比对只差页眉时钟和雷达图动画一帧。
 * 说明书那次给出的建议是「项目描述建议使用『负责、主导、实现』等动词开头」。
 *
 * 最伤的一处在 `/resume/optimize/compare`：一句写死的演示文案
 * 「热爱工作，积极向上……」被挂上 `E1 你的材料` 证据标、写成「你写的（原件不会被改）」。
 * 用户从来没写过那句话 —— 前面所有诚实的免责声明，在这一句面前一起失效。
 *
 * 自我探索 / 岗位匹配 / 职业规划 / 模拟面试在非 http 模式都是这么拒绝的，
 * 对应的降级 UI（`AiTaskRegion` 的 blocked / result-unavailable）早已写好并验证过。
 * 简历链接上它即可，不需要新页面。
 */
const rejectMockMode = <T>(what: string): Promise<T> =>
  Promise.reject(
    new AiMockModeError('MOCK_MODE', `演示模式不提供${what}，请连接真实 AI 服务`, 0),
  )

// ──────────────────────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let taskCounter = 0
const nextTaskId = () => `mock-ai-${Date.now()}-${++taskCounter}`

// ──────────────────────────────────────────────────────────────
// Mock Adapter 对象
// ──────────────────────────────────────────────────────────────

export const aiMockAdapter = {
  // ── 简历诊断链：演示模式一律拒绝，不返回任何「读过你的简历」的结论 ──────
  // 见文件顶部 `rejectMockMode` 的事故说明。这三个方法是整条链
  // （解析 → 报告 → 优化 → 逐条对照）的全部数据来源，堵住它们就够了。

  submitResumeParse(req: ResumeParseRequest, token?: string | null): Promise<ResumeParseResponse> {
    void req
    void token
    return rejectMockMode('简历解析与诊断')
  },

  getResumeRecord(taskId: string, access?: ResumeReadAccess): Promise<ResumeParseResponse> {
    void taskId
    void access
    return rejectMockMode('简历诊断报告')
  },

  getResumeOptimize(taskId: string, access?: ResumeReadAccess): Promise<ResumeOptimizeResponse> {
    void taskId
    void access
    return rejectMockMode('简历优化建议与逐条改写候选')
  },

  async adjustResumeLayoutDraft(
    _taskId: string,
    resume: GeneratedResume,
    action: ResumeLayoutAdjustAction,
    _layout: ResumeLayoutSettings,
    _access?: ResumeReadAccess,
  ): Promise<ResumeLayoutAdjustResponse> {
    void _layout
    void _access
    await delay(300)
    const trimSentence = (value: string | undefined, max = 72) => {
      const text = (value ?? '').trim()
      return text.length > max ? `${text.slice(0, max).replace(/[，,。.\s]+$/, '')}。` : text
    }
    const adjusted: GeneratedResume = {
      ...resume,
      summary: action === 'condense' ? trimSentence(resume.summary, 64) : resume.summary,
      education: resume.education.map((item) => ({
        ...item,
        description: action === 'condense' ? trimSentence(item.description, 60) : item.description,
      })),
      experience: resume.experience.map((item) => ({
        ...item,
        description: action === 'condense' ? trimSentence(item.description, 76) : item.description,
      })),
      projects: resume.projects.map((item) => ({
        ...item,
        description: action === 'condense' ? trimSentence(item.description, 68) : item.description,
      })),
      skills: [...resume.skills],
      certificates: [...resume.certificates],
    }
    return {
      resume: adjusted,
      warnings: [action === 'condense' ? '已按演示规则压缩描述长度。' : '已按演示规则保留事实并调整表达密度。'],
    }
  },

  async chatWithAssistant(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    await delay(500)
    const sceneReplies: Record<AssistantSkill, Pick<AssistantChatResponse, 'reply' | 'actions'>> = {
      offer_compare: {
        reply: '您可以把两个 Offer 的薪资结构、试用期、地点、福利、加班情况和发展机会分别发给我。我会按维度做个人参考对比；请先打码姓名、手机号、公司敏感编号等隐私信息。结果仅供个人参考，不构成录用、入职或法律意见。',
        actions: [{ label: '查看岗位信息', route: '/jobs' }, { label: '优化简历材料', route: '/resume/source' }],
      },
      salary_negotiation: {
        reply: '请告诉我岗位、当前薪资范围、目标薪资、已有优势和顾虑。我可以帮您准备温和版、直接版和补充材料版话术；内容仅供沟通准备参考，不承诺涨薪或录用结果。',
        actions: [{ label: '查看岗位信息', route: '/jobs' }, { label: '优化简历材料', route: '/resume/source' }],
      },
      hr_qa: {
        reply: '您可以咨询入职、试用期、社保、公积金、离职、请假等常见 HR 流程问题。我会按常识解释；涉及劳动争议、赔偿、仲裁或合同解除时，请以官方人社窗口、法律援助或专业律师意见为准。',
        actions: [{ label: '人社专区', route: '/renshi' }],
      },
      self_intro_gen: {
        reply: '请告诉我您的目标岗位、主要经历（学习/实习/项目各1-2条）和想突出的优势，我会生成1分钟和3分钟两版自我介绍文稿，您可以在本机打印准备。',
        actions: [{ label: '打印文件', route: '/print/upload' }, { label: 'AI 简历服务', route: '/resume-service' }],
      },
      material_checklist: {
        reply: '请告诉我您要参加的是面试、招聘会还是入职，以及岗位和公司类型，我会生成一份个性化材料清单，可直接在本机打印带走。',
        actions: [{ label: '打印清单', route: '/print/upload' }, { label: '查看招聘会', route: '/job-fairs' }],
      },
      jd_analysis: {
        reply: '请粘贴或描述招聘要求，我会拆解每条要求的实际含义、区分硬性门槛与加分项，并提示面试时可能被重点考查的方向。',
        actions: [{ label: '查看岗位信息', route: '/jobs' }, { label: '去做模拟面试', route: '/interview/setup' }],
      },
      interview_questions: {
        reply: '请告诉我目标岗位、公司类型和您的背景，我会整理8-10道该岗位高频面试题及参考回答思路，可直接打印带走练习。',
        actions: [{ label: '打印题目', route: '/print/upload' }, { label: 'AI 模拟面试', route: '/interview/setup' }],
      },
      career_explore: {
        reply: '请告诉我您的专业背景、感兴趣的领域，或者您目前的困惑，我们一起通过对话梳理可匹配的岗位方向和下一步行动路径。',
        actions: [{ label: '查看岗位信息', route: '/jobs' }, { label: '自我探索', route: '/resume/self-assessment/intro' }],
      },
      cover_letter_gen: {
        reply: '请告诉我目标公司名称、岗位、您的核心经历和想打动对方的一两个点，我会生成一封300-500字的求职信，可直接在本机打印带走。',
        actions: [{ label: '打印求职信', route: '/print/upload' }, { label: '优化简历', route: '/resume-service' }],
      },
      resume_jd_match: {
        reply: '请先粘贴或描述招聘要求，再告诉我您的核心经历和技能，我会给出匹配项、差距项，以及面试时如何弥补差距的建议。',
        actions: [{ label: '查看岗位信息', route: '/jobs' }, { label: '去做简历诊断', route: '/resume/source' }],
      },
      company_research: {
        reply: '告诉我您要面试的公司名称和岗位，我会整理该企业/行业的面试常见风格、可能的考察方向和建议提前了解的5个问题，帮您在5分钟内做好基础准备。',
        actions: [{ label: '查看岗位信息', route: '/jobs' }, { label: 'AI 模拟面试', route: '/interview/setup' }],
      },
    }
    const sceneReply = req.skill ? sceneReplies[req.skill] : undefined
    if (sceneReply) {
      return {
        sessionId: req.sessionId ?? `mock-session-${Date.now()}`,
        reply: sceneReply.reply,
        intent: 'general',
        actions: sceneReply.actions,
      }
    }
    return {
      sessionId: req.sessionId ?? `mock-session-${Date.now()}`,
      reply: '您好！我是 AI 就业服务助手，可以为您提供简历建议、求职指导和打印帮助。请问有什么需要帮忙的？',
      intent: 'general',
      actions: [
        { label: '查看简历服务', route: '/resume/source' },
        { label: '浏览岗位信息', route: '/jobs' },
      ],
    }
  },

  // ── 阶段2A AI 简历生成(mock:与后端 mock provider 同一防编造契约)──────────
  // 事实字段逐字复制用户输入,仅对描述做确定性模板润色;providerName='mock'
  // 供页面显示演示标记。

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async submitResumeGenerate(input: ResumeGenerateInput, _token?: string | null): Promise<ResumeGenerateResponse> {
    await delay(600)
    const polish = (t: string) => {
      const v = t.trim()
      return v ? (/[。.!！]$/.test(v) ? v : `${v}。`) : ''
    }
    const hints: string[] = []
    if (!input.basic.phone && !input.basic.email) hints.push('未填写联系方式(电话/邮箱),招聘方将无法联系你')
    if (input.education.length === 0) hints.push('未填写教育经历,建议补充学校与专业')
    if (input.experience.length === 0 && input.projects.length === 0) hints.push('未填写实习/工作或项目经历,简历说服力会偏弱')
    if (input.skills.length === 0) hints.push('未填写技能,建议补充与目标岗位相关的技能')
    const summaryBase = input.selfIntro?.trim()
      || [
        input.education[0] ? `${input.education[0].school}${input.education[0].major ? ` ${input.education[0].major}` : ''}背景` : '',
        input.intention.position ? `目标岗位为${input.intention.position}` : '',
        input.skills.length > 0 ? `掌握 ${input.skills.slice(0, 3).join('、')} 等技能` : '',
      ].filter(Boolean).join('，')
    return {
      taskId: nextTaskId(),
      status: 'completed',
      providerName: 'mock',
      resume: {
        basic: { ...input.basic },
        intention: { ...input.intention },
        summary: summaryBase ? `${summaryBase}。`.replace(/。。$/, '。') : '',
        education: input.education.map((e) => ({ ...e, description: e.description ? polish(e.description) : undefined })),
        experience: input.experience.map((e) => ({ ...e, description: polish(e.description) })),
        projects: input.projects.map((pj) => ({ ...pj, description: polish(pj.description) })),
        skills: input.skills.map((sk) => sk.trim()).filter(Boolean),
        certificates: [...input.certificates],
      },
      missingHints: hints,
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getResumeGenerate(_taskId: string, _access?: ResumeReadAccess): Promise<ResumeGenerateResponse> {
    // mock 模式不落库,刷新后无历史结果(诚实)
    await delay(80)
    return { taskId: _taskId, status: 'failed', providerName: 'mock', failReason: 'mock 模式不保存生成记录,请重新生成' }
  },

  async transcribeResumeVoice(_audio: Blob): Promise<ResumeVoiceTranscribeResponse> {
    void _audio
    await delay(80)
    throw new Error('演示模式不支持语音识别，请使用文字输入')
  },

  async exportGeneratedResume(
    resume: GeneratedResume,
    _taskId?: string,
    _token?: string | null,
    format?: ResumeExportFormat,
    _layout?: ResumeLayoutSettings,
    _templateId?: string,
    _draft?: boolean,
  ): Promise<ResumeGenerateExportResponse> {
    void _layout
    void _templateId
    void _draft
    // mock 模式无后端,不构造假文件;返回空 signedUrl,页面会诚实提示
    await delay(400)
    const ext = format ?? 'pdf'
    return {
      fileId: `mock-resume-${Date.now()}`,
      filename: `AI简历_${resume.basic.name || '求职者'}.${ext}`,
      sizeBytes: 0,
      pageCount: ext === 'pdf' ? 1 : 0,
      signedUrl: '',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }
  },
}
