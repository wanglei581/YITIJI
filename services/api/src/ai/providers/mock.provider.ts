import { Injectable } from '@nestjs/common'
import type {
  AiProvider,
  AiProviderName,
  GenerateResumeOutput,
  ParseResumeInput,
  ParseResumeOutput,
  ResumeGenerateInput,
  ResumeReport,
  OptimizeResumeOutput,
  ChatInput,
  ChatOutput,
  ClassifyIntentOutput,
  AssistantIntent,
} from '../interfaces/ai-provider.interface'
import { computeMissingHints } from '../resume/llm-resume-generate.service'

let taskCounter = 0
const nextTaskId = (): string => `mock-ai-${Date.now()}-${++taskCounter}`

@Injectable()
export class MockAiProvider implements AiProvider {
  readonly name: AiProviderName = 'mock'

  /**
   * 阶段2A 简历生成(演示):与真实 llm provider 同一防编造契约 —— 事实字段
   * 逐字复制用户输入,仅对描述做确定性的模板化"润色"。providerName='mock'
   * 由 AiService 注入,前端据此显示演示标记。
   */
  async generateResume(input: ResumeGenerateInput): Promise<GenerateResumeOutput> {
    const polishDesc = (text: string): string => {
      const t = text.trim()
      if (!t) return ''
      return /[。.!！]$/.test(t) ? t : `${t}。`
    }
    const summaryBase = input.selfIntro?.trim()
      || [
        input.education[0] ? `${input.education[0].school}${input.education[0].major ? ` ${input.education[0].major}` : ''}背景` : '',
        input.intention.position ? `目标岗位为${input.intention.position}` : '',
        input.skills.length > 0 ? `掌握 ${input.skills.slice(0, 3).join('、')} 等技能` : '',
      ].filter(Boolean).join('，')
    return {
      taskId: nextTaskId(),
      status: 'completed',
      resume: {
        basic: { ...input.basic },
        intention: { ...input.intention },
        summary: summaryBase ? `${summaryBase}。`.replace(/。。$/, '。') : '',
        education: input.education.map((e) => ({ ...e, description: e.description ? polishDesc(e.description) : undefined })),
        experience: input.experience.map((e) => ({ ...e, description: polishDesc(e.description) })),
        projects: input.projects.map((p) => ({ ...p, description: polishDesc(p.description) })),
        skills: input.skills.map((s) => s.trim()).filter(Boolean),
        certificates: [...input.certificates],
      },
      missingHints: computeMissingHints(input),
    }
  }

  async parseResume(_input: ParseResumeInput): Promise<ParseResumeOutput> {
    // Phase 1.1：6 评分维度 + 风险表述提醒 + 修改优先级建议（与真实 llm provider 结构一致）。
    return {
      taskId: nextTaskId(),
      status: 'completed',
      report: {
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
          '技能模块建议补充岗位相关技术栈关键词',
          '个人简介建议精简至 2-3 句，突出核心优势',
          '工作经历建议每条控制在 3-5 点，避免流水账式描述',
        ],
        riskNotes: [
          '部分经历缺少量化成果描述，建议补充具体数字',
          '求职目标表述偏笼统，建议明确意向岗位方向',
        ],
        priorities: [
          { focus: '补充成果量化', reason: '多处职责描述缺少可衡量结果，影响说服力' },
          { focus: '明确求职目标', reason: '求职意向不清晰，HR 难快速判断匹配方向' },
          { focus: '补齐岗位关键词', reason: '简历文本对常见岗位表达覆盖偏低' },
        ],
      },
    }
  }

  async optimizeResume(taskId: string, _report: ResumeReport): Promise<OptimizeResumeOutput> {
    return {
      taskId,
      status: 'completed',
      // 阶段2B:演示用结构化优化版简历(providerName='mock' 由 AiService 注入,前端显示演示标记)
      optimizedResume: {
        basic: { name: '演示用户', city: '青岛' },
        intention: { position: '前端开发工程师', city: '青岛' },
        summary: '具有扎实前端基础的求职者,熟悉 React 与组件化开发,注重代码质量与用户体验。(演示内容)',
        education: [{ school: '演示大学', major: '计算机科学与技术', degree: '本科', period: '2021-2025', description: '主修核心课程,成绩优良。(演示内容)' }],
        experience: [{ company: '演示科技公司', role: '前端实习生', period: '2024.07-2024.12', description: '参与官网改版,负责组件库维护与页面性能优化,首屏加载时间显著下降。(演示内容)' }],
        projects: [],
        skills: ['JavaScript', 'React', 'CSS'],
        certificates: [],
      },
      modules: [
        {
          title: '个人简介表达优化',
          before: '热爱工作，积极向上，有较强的学习能力和团队合作精神。',
          after: '建议改为具体可量化的表达，如：具有 X 年前端开发经验，熟练掌握 React、TypeScript，注重代码质量与用户体验。',
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
      ],
    }
  }

  async chatAssistant(input: ChatInput): Promise<ChatOutput> {
    return {
      sessionId: input.sessionId ?? `mock-session-${Date.now()}`,
      reply: '您好！我是 AI 就业服务助手，可以为您提供简历建议、求职指导和打印帮助。请问有什么需要帮忙的？',
      intent: 'general',
      actions: [
        { label: '查看简历服务', route: '/resume/source' },
        { label: '浏览岗位信息', route: '/jobs' },
      ],
    }
  }

  async classifyIntent(message: string): Promise<ClassifyIntentOutput> {
    const rules: [RegExp, AssistantIntent][] = [
      [/简历|resume/i,        'resume'],
      [/打印|print|扫描|scan/i, 'print'],
      [/政策|补贴|社保/i,      'policy'],
      [/岗位|工作|职位|job/i,  'job'],
      [/招聘会|fair/i,         'fair'],
    ]
    for (const [pattern, intent] of rules) {
      if (pattern.test(message)) return { intent, confidence: 0.9 }
    }
    return { intent: 'general', confidence: 0.7 }
  }
}
