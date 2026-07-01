// ============================================================
// AI Mock Adapter — Phase 7 AI Service Layer
//
// 返回与页面原有 mock 结果一致的数据结构。
// mock 模式下不调用任何真实 AI 服务。
// ============================================================

import type {
  GeneratedResume,
  ResumeGenerateExportResponse,
  ResumeGenerateInput,
  ResumeGenerateResponse,
  ResumeParseRequest,
  ResumeParseResponse,
  ResumeReport,
  ResumeOptimizeModule,
  ResumeOptimizeResponse,
  AssistantChatRequest,
  AssistantChatResponse,
} from '@ai-job-print/shared'
import type { ResumeReadAccess } from './ai'

// ──────────────────────────────────────────────────────────────
// Mock 数据（原 ResumeParsePage.mockReport / ResumeOptimizePage.OPTIMIZE_MODULES）
// ──────────────────────────────────────────────────────────────

const MOCK_REPORT: ResumeReport = {
  sections: [
    { key: 'basic',          label: '基础信息完整度', score: 8, maxScore: 10 },
    { key: 'objective',      label: '求职目标清晰度', score: 6, maxScore: 10 },
    { key: 'experience',     label: '经历表达清晰度', score: 6, maxScore: 10 },
    { key: 'quantification', label: '成果量化程度',   score: 5, maxScore: 10 },
    { key: 'keyword',        label: '岗位关键词覆盖', score: 5, maxScore: 10 },
    { key: 'readability',    label: '版式与可读性',   score: 7, maxScore: 10 },
  ],
  suggestions: [
    '项目描述建议使用"负责、主导、实现"等动词开头，尽量量化成果',
    '技能模块建议补充岗位相关技术栈关键词，提升简历匹配度',
    '个人简介建议精简至 2-3 句，突出核心优势',
    '工作经历建议每条控制在 3-5 点，避免流水账式描述',
  ],
}

const MOCK_OPTIMIZE_MODULES: ResumeOptimizeModule[] = [
  {
    title: '个人简介表达优化',
    before: '热爱工作，积极向上，有较强的学习能力和团队合作精神。',
    after: '建议改为具体可量化的表达，如：具有 X 年前端开发经验，熟练掌握 React、TypeScript，参与过中型商业项目全程开发，注重代码质量与用户体验。',
  },
  {
    title: '项目经历表达优化',
    before: '参与了公司内部系统的开发工作，完成了部分功能。',
    after: '建议改为具体职责+成果，如：主导前端模块开发（React + Vite），实现用户管理、权限控制等核心功能；优化页面加载流程，系统响应时间降低约 40%。',
  },
  {
    title: '技能关键词建议',
    before: '已有：React、JavaScript、CSS。',
    after: '建议补充：TypeScript、Vite、Git、RESTful API 等关键词，与目标岗位方向更好匹配（根据实际求职方向按需添加）。',
  },
  {
    title: '排版建议',
    before: '经历条目格式不统一，字体层级不清晰，段落间距偏小。',
    after: '建议统一使用"公司名 | 职位 | 时间段"格式；正文使用无衬线字体；段落间距建议 1.5 倍行距，整体视觉更清爽专业。',
  },
]

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async submitResumeParse(_req: ResumeParseRequest, _token?: string | null): Promise<ResumeParseResponse> {
    // 极短延迟，不干扰页面已有的步骤动画时序
    await delay(80)
    return {
      taskId: nextTaskId(),
      status: 'completed',
      providerName: 'mock',
      report: MOCK_REPORT,
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getResumeRecord(taskId: string, _access?: ResumeReadAccess): Promise<ResumeParseResponse> {
    await delay(80)
    return {
      taskId,
      status: 'completed',
      providerName: 'mock',
      report: MOCK_REPORT,
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getResumeOptimize(taskId: string, _access?: ResumeReadAccess): Promise<ResumeOptimizeResponse> {
    await delay(120)
    return {
      taskId,
      status: 'completed',
      providerName: 'mock',
      modules: MOCK_OPTIMIZE_MODULES,
      // 阶段2B:演示用结构化优化版简历(页面据 providerName 显示演示标记)
      optimizedResume: {
        basic: { name: '演示用户', city: '青岛' },
        intention: { position: '前端开发工程师', city: '青岛' },
        summary: '具有扎实前端基础的求职者,熟悉 React 与组件化开发,注重代码质量与用户体验。(演示内容)',
        education: [{ school: '演示大学', major: '计算机科学与技术', degree: '本科', period: '2021-2025', description: '主修核心课程,成绩优良。(演示内容)' }],
        experience: [{ company: '演示科技公司', role: '前端实习生', period: '2024.07-2024.12', description: '参与官网改版,负责组件库维护与页面性能优化。(演示内容)' }],
        projects: [],
        skills: ['JavaScript', 'React', 'CSS'],
        certificates: [],
      },
    }
  },

  async chatWithAssistant(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    await delay(500)
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async exportGeneratedResume(resume: GeneratedResume, _taskId?: string, _token?: string | null): Promise<ResumeGenerateExportResponse> {
    // mock 模式无后端,不构造假 PDF 文件;返回空 signedUrl,页面会诚实提示
    await delay(400)
    return {
      fileId: `mock-resume-${Date.now()}`,
      filename: `AI简历_${resume.basic.name || '求职者'}.pdf`,
      sizeBytes: 0,
      pageCount: 1,
      signedUrl: '',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }
  },
}
