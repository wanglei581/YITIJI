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

export const assistantReply = {
  sessionId: 'assistant-w3-browser-session',
  reply: '请基于真实经历，用背景、任务、行动、结果四步整理项目描述。',
  intent: 'general',
  actions: [
    { label: '去做简历诊断', route: '/resume/source' },
    { label: '禁止动作', route: '/admin' },
  ],
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
    interviewerType: 'hr', interviewerLabel: 'HR 初筛', durationMin: 5,
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
