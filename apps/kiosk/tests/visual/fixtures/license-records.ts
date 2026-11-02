import { interviewReport } from './fusion-w3-states'

/**
 * 收尾中「从记录里打开旧结果」的走查数据（kiosk-license-wind-down.spec.ts）：一份已完成的简历诊断记录和它的报告、
 * 一场已完成的模拟面试记录和它的报告。形状照服务端真会返回的写（shared 的 MemberResumeItem / MemberInterviewItem /
 * ResumeParseResponse / InterviewReportResponse），到期时间放在很远的将来，免得页面时钟推进之后记录变成「已超过保存期限」。
 */
export const RESUME_TASK_ID = 'license-wind-down-resume-task'
export const RESUME_ROW = {
  id: 'license-wind-down-resume-row',
  taskId: RESUME_TASK_ID,
  kind: 'parse',
  status: 'completed',
  provider: 'llm',
  optimized: false,
  hasDraft: false,
  latestVersion: null,
  createdAt: '2026-10-20T08:30:00.000Z',
  updatedAt: '2026-10-20T08:31:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
} as const

const SECTIONS = [
  { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
  { key: 'objective', label: '求职目标清晰度', score: 4, maxScore: 10 },
  { key: 'experience', label: '经历表达清晰度', score: 7, maxScore: 10 },
  { key: 'quantification', label: '成果量化程度', score: 4, maxScore: 10 },
  { key: 'keyword', label: '岗位关键词覆盖', score: 6, maxScore: 10 },
  { key: 'readability', label: '版式与可读性', score: 6, maxScore: 10 },
]

/** GET /api/v1/resume/records/:taskId 的响应：已完成、带两条问题的诊断报告。 */
export const RESUME_REPORT_RECORD = {
  taskId: RESUME_TASK_ID,
  status: 'completed',
  providerName: 'llm',
  report: {
    sections: SECTIONS,
    suggestions: ['把目标岗位写在简历第一行。', '每段经历后面补一个可核实的结果。', '技能栏只留你真用过的工具。', '联系方式放在第一屏。'],
    riskNotes: ['「熟悉」「了解」这类词没有事例支撑，读的人容易当作空话。'],
    contentBlocks: [
      { key: 'basic', label: '基本信息', lines: ['希望找一份稳定的工作。'] },
      { key: 'experience', label: '工作经历', lines: ['现居青岛市，本文件为虚构示例。'] },
      { key: 'project', label: '项目经历', lines: ['参与迎新志愿服务。'] },
    ],
    issues: [
      {
        id: 'I1', dim: 'quantification', title: '这段经历没有写出规模或结果',
        evidence: [{ blockKey: 'experience', lineIndex: 0, quote: '现居青岛市，本文件为虚构示例。' }],
        impact: '读简历的人只看到做了什么，看不到做到什么程度。',
        fixIt: '在这一行后面补上你实际负责的人数、数量或周期；没有准确数字就写清具体做了哪些环节。',
      },
      {
        id: 'I2', dim: 'objective', title: '求职目标没有写成具体岗位',
        evidence: [{ blockKey: 'basic', lineIndex: 0, quote: '希望找一份稳定的工作。' }],
        impact: '全篇没有岗位名，后面的经历对不上具体职位。',
        fixIt: '写成目标岗位，并让经历围着它写。',
      },
    ],
  },
}

export const INTERVIEW_SESSION_ID = 'license-wind-down-interview'
/** GET /api/v1/me/mock-interviews 里的一场已完成、带报告的练习。 */
export const INTERVIEW_ROW = {
  sessionId: INTERVIEW_SESSION_ID,
  interviewerType: 'hr',
  interviewerLabel: 'HR 面试',
  industry: '互联网/科技',
  position: '前端开发工程师',
  durationMin: 5,
  createdAt: '2026-10-20T08:00:00.000Z',
  endedAt: '2026-10-20T08:05:00.000Z',
  hasReport: true,
} as const

/** GET /api/v1/mock-interviews/:sessionId/report 的响应（沿用既有的练习报告夹具，换成这场的编号）。 */
export const INTERVIEW_REPORT = { data: { ...interviewReport.data, sessionId: INTERVIEW_SESSION_ID } }

/** 历史列表里的第二场练习（另一个岗位、另一份总评），用来看「从历史列表打开另一份旧报告」。 */
export const INTERVIEW_SESSION_ID_2 = 'license-wind-down-interview-2'
export const INTERVIEW_ROW_2 = {
  ...INTERVIEW_ROW,
  sessionId: INTERVIEW_SESSION_ID_2,
  position: '产品运营',
  createdAt: '2026-10-21T09:00:00.000Z',
  endedAt: '2026-10-21T09:05:00.000Z',
} as const
export const INTERVIEW_REPORT_2 = {
  data: {
    ...interviewReport.data,
    sessionId: INTERVIEW_SESSION_ID_2,
    position: '产品运营',
    report: { ...interviewReport.data.report, overall: { level: 'pass', summary: '第二场的总评：思路清楚，数据意识还要加强。' } },
  },
}
