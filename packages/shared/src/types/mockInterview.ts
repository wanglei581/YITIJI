// ============================================================
// 2C 模拟面试 — 前后端契约（求职者本人面试练习工具）。
//
// 合规边界：仅供本人面试练习与准备参考；不代表任何招聘结果承诺；
// 不参与企业筛选、面试邀约或录用决策；报告不向企业展示或转交。
// ============================================================

export type InterviewerType = 'hr' | 'manager' | 'tech' | 'campus' | 'final'
export type InterviewExperience = 'fresh' | 'lt1' | 'y1_3' | 'y3_5' | 'gt5' | 'switch'
export type InterviewDifficulty = 'easy' | 'standard' | 'pressure'
export type InterviewDuration = 3 | 5 | 8
export type InterviewSessionStatus = 'configured' | 'in_progress' | 'completed' | 'aborted'

export interface CreateInterviewInput {
  interviewerType: InterviewerType
  industry: string
  position: string
  experience: InterviewExperience
  difficulty: InterviewDifficulty
  durationMin: InterviewDuration
  /** 可选：上传简历的 fileId（服务端真实提取；不传 = 不使用简历） */
  resumeFileId?: string
}

export interface CreateInterviewResponse {
  sessionId: string
  questionTarget: number
  /** 仅匿名创建时返回一次；后续请求走 x-interview-access-token header */
  accessToken?: string
}

export interface InterviewQuestionResponse {
  done: boolean
  question?: string
  qType?: string
  questionIndex: number
  questionTarget: number
}

export interface InterviewTurn {
  idx: number
  role: 'interviewer' | 'candidate'
  qType: string | null
  content: string
  skipped: boolean
}

export interface InterviewSessionDetail {
  sessionId: string
  status: InterviewSessionStatus
  interviewerType: InterviewerType
  industry: string
  position: string
  experience: InterviewExperience
  difficulty: InterviewDifficulty
  durationMin: number
  questionTarget: number
  turns: InterviewTurn[]
}

/** 练习表现等级（不是通过率、不是录用概率）。 */
export type InterviewOverallLevel = 'needs_work' | 'pass' | 'good' | 'excellent'

export interface InterviewReportPayload {
  overall: { level: InterviewOverallLevel; summary: string }
  expression: string[]
  positionFit: string[]
  credibility: string[]
  professional: string[]
  adaptability: string[]
  risks: string[]
  predictedQuestions: Array<{ question: string; why: string; approach: string }>
  starAdvice: { s: string; t: string; a: string; r: string; reminder: string }
  checklist: string[]
}

export interface InterviewReportResponse {
  sessionId: string
  position: string
  industry: string
  interviewerType: InterviewerType
  interviewerLabel: string
  durationMin: number
  endedAt: string | null
  report: InterviewReportPayload
}

export interface InterviewPrintResponse {
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
}

export interface MemberInterviewItem {
  sessionId: string
  interviewerType: InterviewerType
  interviewerLabel: string
  industry: string
  position: string
  durationMin: number
  createdAt: string
  endedAt: string | null
  hasReport: boolean
}
