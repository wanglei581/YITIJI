// ============================================================
// AI Mock Adapter — Phase 7 AI Service Layer
//
// 返回与页面原有 mock 结果一致的数据结构。
// mock 模式下不调用任何真实 AI 服务。
// ============================================================

import type {
  ResumeParseRequest,
  ResumeParseResponse,
  ResumeReport,
  ResumeOptimizeModule,
  ResumeOptimizeResponse,
  AssistantChatRequest,
  AssistantChatResponse,
} from '@ai-job-print/shared'

// ──────────────────────────────────────────────────────────────
// Mock 数据（原 ResumeParsePage.mockReport / ResumeOptimizePage.OPTIMIZE_MODULES）
// ──────────────────────────────────────────────────────────────

const MOCK_REPORT: ResumeReport = {
  sections: [
    { key: 'basic',      label: '基础信息完整度',     score: 8, maxScore: 10 },
    { key: 'education',  label: '教育经历完整度',     score: 9, maxScore: 10 },
    { key: 'experience', label: '实习/项目经历表达', score: 6, maxScore: 10 },
    { key: 'skills',     label: '技能关键词覆盖',     score: 5, maxScore: 10 },
    { key: 'layout',     label: '排版可读性',         score: 7, maxScore: 10 },
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
      report: MOCK_REPORT,
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getResumeRecord(taskId: string, _token?: string | null): Promise<ResumeParseResponse> {
    await delay(80)
    return {
      taskId,
      status: 'completed',
      report: MOCK_REPORT,
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getResumeOptimize(taskId: string, _token?: string | null): Promise<ResumeOptimizeResponse> {
    await delay(120)
    return {
      taskId,
      status: 'completed',
      modules: MOCK_OPTIMIZE_MODULES,
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
}
