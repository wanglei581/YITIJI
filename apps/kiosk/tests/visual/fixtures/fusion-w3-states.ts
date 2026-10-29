import type {
  AssistantChatResponse, CreateInterviewResponse, FileUploadResponse,
  InterviewQuestionResponse, InterviewReportResponse, ResumeParseResponse,
} from '@ai-job-print/shared'

export const uploadedResume = {
  success: true,
  data: {
    fileId: 'file-w3-public-fixture', filename: '求职简历.pdf',
    sizeBytes: 4096, mimeType: 'application/pdf', sha256: 'b'.repeat(64),
    signedUrl: '/w3-fixtures/resume.pdf',
    signedUrlExpiresAt: '2026-07-24T00:05:00.000Z', fileExpiresAt: null,
  } satisfies FileUploadResponse,
} satisfies { success: true; data: FileUploadResponse }

export const diagnosis = {
  taskId: 'resume-w3-public-fixture', accessToken: 'w3-browser-only-access',
  status: 'completed', providerName: 'llm',
  extractionNotice: {
    textSource: 'ocr', confidence: 'medium',
    warnings: ['部分图片文字需要本人复核'],
  },
  report: {
    sections: [
      { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
      { key: 'objective', label: '求职目标清晰度', score: 7, maxScore: 10 },
      { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
      { key: 'quantification', label: '成果量化程度', score: 5, maxScore: 10 },
      { key: 'keyword', label: '岗位关键词覆盖', score: 6, maxScore: 10 },
      { key: 'readability', label: '版式与可读性', score: 8, maxScore: 10 },
    ],
    suggestions: ['根据本人真实经历补充可核验的职责与结果。'],
  },
} satisfies ResumeParseResponse

/*
 * 真实模型回答。`providerLabel` / `aiGenerated` 是 #617（S0-1）之后后端**恒定**
 * 透出的两个字段（`ai.service.ts:763,778`），夹具必须带上它们才算镜像真后端 ——
 * 前端对缺字段是 fail-closed 的，不带就等于在测「非 AI」那条路径。
 */
export const assistantReply = {
  sessionId: 'assistant-w3-browser-session',
  reply: '请基于真实经历，用背景、任务、行动、结果四步整理项目描述。',
  intent: 'general',
  actions: [
    { label: '去做简历诊断', route: '/resume/source' },
    { label: '禁止动作', route: '/admin' },
  ],
  providerLabel: 'llm:deepseek',
  aiGenerated: true,
} satisfies AssistantChatResponse

/**
 * 风险 R1 的夹具：后端 `assistant_chat` 未就绪时回落到 mock provider。
 * `reply` 刻意写成一段**读起来完全像 AI 回答**的话 —— 这正是它危险的地方。
 * 前端必须一个字都不显示它。
 */
export const ASSISTANT_MOCK_FALLBACK_REPLY_TEXT =
  '根据你的情况，我建议你先梳理三段核心经历，再按岗位要求逐条对齐关键词。'

export const assistantMockFallbackReply = {
  sessionId: 'assistant-w3-mock-fallback-session',
  reply: ASSISTANT_MOCK_FALLBACK_REPLY_TEXT,
  intent: 'general',
  actions: [{ label: '去做简历诊断', route: '/resume/source' }],
  providerLabel: 'mock',
  aiGenerated: false,
} satisfies AssistantChatResponse

export const interviewCreated = {
  data: { sessionId: 'interview-w3-public-fixture', questionTarget: 2, accessToken: 'w3-interview-browser-only' } satisfies CreateInterviewResponse,
} satisfies { data: CreateInterviewResponse }
export const interviewStarted = {
  data: { done: false, question: '请用一分钟介绍与你目标岗位相关的真实经历。', qType: 'intro', questionIndex: 1, questionTarget: 2 } satisfies InterviewQuestionResponse,
} satisfies { data: InterviewQuestionResponse }
export const interviewAnswered = {
  data: { done: false, question: '请说明一次解决困难的真实经历。', qType: 'experience', questionIndex: 2, questionTarget: 2 } satisfies InterviewQuestionResponse,
} satisfies { data: InterviewQuestionResponse }
export const interviewReport = {
  data: {
    sessionId: 'interview-w3-public-fixture', position: '前端开发工程师', industry: '互联网/科技',
    interviewerType: 'hr', interviewerLabel: 'HR 面试', durationMin: 5,
    endedAt: '2026-07-24T00:05:00.000Z',
    report: {
      overall: { level: 'pass', summary: '表达结构基本完整，仍需用真实数据补充结果。' },
      expression: ['回答顺序清楚'], positionFit: ['能联系目标岗位'],
      credibility: ['只保留本人真实经历'], professional: ['术语使用基本准确'],
      adaptability: ['能回应追问'], risks: ['结果量化不足'],
      predictedQuestions: [{ question: '你的具体贡献是什么？', why: '核实个人职责', approach: '用真实行动回答' }],
      starAdvice: { s: '交代背景', t: '说明任务', a: '说明行动', r: '说明结果', reminder: '不要编造数据' },
      checklist: ['复核简历事实', '准备真实项目例子'],
    },
  } satisfies InterviewReportResponse,
} satisfies { data: InterviewReportResponse }
/**
 * 条目多的练习报告：每个维度三条、五道预测题、八条清单、三条摘录（其中一条跳过）。
 * 条数都在服务端报告的取值范围内（预测题 3–5、清单 5–8）。
 * 上面那份只有一条一条，装得进任何版式；这份主视图和「更多」都比一屏高，用来证明
 * 条目多时卡片不被压扁、最后一条滚得到、切到「更多」从顶开始读。
 */
export const interviewReportRich = {
  data: {
    ...interviewReport.data,
    report: {
      ...interviewReport.data.report,
      overall: { level: 'pass', summary: '整体回答顺序清楚，能说出自己负责的部分；结果部分还缺少能核实的数字，追问时略显犹豫。' },
      expression: ['回答顺序清楚，先讲背景再讲行动', '个别句子偏长，可以拆成两句说', '结尾能回到岗位要求，但略显仓促'],
      positionFit: ['能联系目标岗位的日常工作内容', '提到了与岗位相关的工具，但没有说明熟练程度', '对团队协作的描述与岗位要求一致'],
      credibility: ['只保留本人真实经历', '时间线前后一致', '数字来源没有说明，建议准备可核实的依据'],
      professional: ['术语使用基本准确', '能说出常见问题的排查思路', '对新工具的了解停留在名称层面'],
      adaptability: ['能回应追问', '被打断后能回到主线', '遇到不会的问题时没有说明打算怎么补'],
      risks: ['结果量化不足，容易被追问', '个人贡献与团队成果区分不够清楚', '回答时间偏长，超过一分钟'],
      predictedQuestions: [
        { question: '你的具体贡献是什么？', why: '核实个人职责', approach: '用真实行动回答，只说自己做的部分' },
        { question: '遇到过最难的问题是什么？怎么解决的？', why: '看解决问题的思路', approach: '按 STAR 讲一件真实经历' },
        { question: '为什么想做这个岗位？', why: '看动机与稳定性', approach: '结合自己的经历和岗位日常' },
        { question: '你怎么保证登记不漏项？', why: '看细节和流程意识', approach: '说清分栏登记和离开时间核对这两步' },
        { question: '遇到来访人员不配合怎么办？', why: '看沟通与应变', approach: '先说明用途，再说你怎么处理' },
      ],
      starAdvice: { s: '开学周来访集中，登记本只有一本。', t: '你负责当天的来访登记。', a: '你按院系把表格分开，人走时核对离开时间。', r: '当天有没有漏项，由你自己核对。', reminder: '数字和成果不用编造。' },
      checklist: ['复核简历事实', '准备真实项目例子', '练习 1 分钟自我介绍', '核对面试时间与路线', '准备两个想问面试官的问题', '带上身份证件和纸质简历', '提前十分钟到场', '想好薪资期待的区间'],
    },
    qaExcerpts: [
      { question: '请用一分钟介绍与你目标岗位相关的真实经历。', answerExcerpt: '我做过一个可访问性改造项目，负责把表单的读屏提示补全，并和测试同学一起回归。', skipped: false },
      { question: '请说明一次解决困难的真实经历。', answerExcerpt: null, skipped: true },
      { question: '你为什么想做这个岗位？', answerExcerpt: '我想把前端无障碍做成日常工作，而不是只在项目收尾时补。', skipped: false },
    ],
    includeAnswersInPrint: true,
  },
}
