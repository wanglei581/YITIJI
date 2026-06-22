// ============================================================
// 2C 模拟面试 service（Kiosk）。
//
// http 模式走真实 /api/v1/mock-interviews；mock 模式提供本地演示流程
// （固定问题脚本 + 演示报告，页面会按 providerless 演示标注），便于无后端调试。
// 凭证：登录会员传 token（Bearer）；匿名传创建时一次性下发的 accessToken
// （x-interview-access-token header）。两者由调用方显式传入，不读任何存储。
// ============================================================

import type {
  CreateInterviewInput,
  CreateInterviewResponse,
  InterviewQuestionResponse,
  InterviewReportResponse,
  InterviewPrintResponse,
  MemberInterviewItem,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export interface InterviewAccess {
  token?: string | null
  accessToken?: string | null
}

export class InterviewApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'InterviewApiError'
  }
}

async function call<T>(path: string, access: InterviewAccess, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
        ...(!access.token && access.accessToken ? { 'x-interview-access-token': access.accessToken } : {}),
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'include',
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    throw new InterviewApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (isMemberSessionInvalidError(res.status, code, Boolean(access.token))) notifyMemberSessionExpired(access.token ?? undefined)
    throw new InterviewApiError(code, message, res.status)
  }
  const json = (await res.json()) as { data: T }
  return json.data
}

// ── mock 模式演示脚本（仅本地无后端调试；不冒充真实 AI）──────────────────────

const MOCK_QUESTIONS = [
  '您好，我是本场练习的面试官（演示模式）。请先用 1-2 分钟做个自我介绍。',
  '请讲一段你最有代表性的经历：当时的背景、你的职责和最终结果。',
  '你为什么想应聘这个岗位？你对它的理解是什么？',
  '最后一个问题：你有什么想问我们的吗？',
]
let mockIdx = 0

const MOCK_REPORT: InterviewReportResponse = {
  sessionId: 'mock-session',
  position: '演示岗位',
  industry: '通用',
  interviewerType: 'hr',
  interviewerLabel: 'HR 初筛',
  durationMin: 3,
  endedAt: null,
  report: {
    overall: { level: 'pass', summary: '演示模式报告：当前未接入真实 AI 模型，本内容仅用于体验页面流程。' },
    expression: ['（演示）回答结构基本完整', '（演示）重点表达可以更突出'],
    positionFit: ['（演示）回答与目标岗位有一定关联'],
    credibility: ['（演示）经历描述需要补充量化结果'],
    professional: ['（演示）专业能力表现未充分覆盖'],
    adaptability: ['（演示）追问应对未充分覆盖'],
    risks: ['（演示）建议补充项目量化数据', '（演示）建议明确个人职责'],
    predictedQuestions: [{ question: '（演示）请介绍一个解决困难的经历', why: '考察问题解决', approach: '用 STAR 结构回答' }],
    starAdvice: { s: '简述背景', t: '明确目标', a: '说明行动', r: '量化结果', reminder: '尽量用数据说明成果' },
    checklist: ['公司与岗位调研', '准备自我介绍', '准备 3 个代表性经历', '准备 2-3 个反问问题', '检查材料与路线'],
  },
}

// ── 导出函数 ──────────────────────────────────────────────────────────────────

export function createInterview(input: CreateInterviewInput, access: InterviewAccess): Promise<CreateInterviewResponse> {
  if (API_MODE !== 'http') {
    mockIdx = 0
    return Promise.resolve({ sessionId: 'mock-session', questionTarget: MOCK_QUESTIONS.length, accessToken: 'mock-token' })
  }
  return call<CreateInterviewResponse>('/mock-interviews', access, { method: 'POST', body: input })
}

export function startInterview(sessionId: string, access: InterviewAccess): Promise<InterviewQuestionResponse> {
  if (API_MODE !== 'http') {
    mockIdx = 1
    return Promise.resolve({ done: false, question: MOCK_QUESTIONS[0], qType: 'intro', questionIndex: 1, questionTarget: MOCK_QUESTIONS.length })
  }
  return call<InterviewQuestionResponse>(`/mock-interviews/${encodeURIComponent(sessionId)}/start`, access, { method: 'POST', body: {} })
}

export function answerInterview(
  sessionId: string,
  input: { answer?: string; skip?: boolean; inputMode?: 'text' | 'voice'; transcriptText?: string; transcriptEdited?: boolean; answerDurationSec?: number },
  access: InterviewAccess,
): Promise<InterviewQuestionResponse> {
  if (API_MODE !== 'http') {
    if (mockIdx >= MOCK_QUESTIONS.length) {
      return Promise.resolve({ done: true, questionIndex: MOCK_QUESTIONS.length, questionTarget: MOCK_QUESTIONS.length })
    }
    const q = MOCK_QUESTIONS[mockIdx]
    mockIdx += 1
    return Promise.resolve({ done: false, question: q, qType: 'experience', questionIndex: mockIdx, questionTarget: MOCK_QUESTIONS.length })
  }
  return call<InterviewQuestionResponse>(`/mock-interviews/${encodeURIComponent(sessionId)}/answer`, access, { method: 'POST', body: input })
}

export function endInterview(sessionId: string, access: InterviewAccess): Promise<InterviewReportResponse> {
  if (API_MODE !== 'http') return Promise.resolve(MOCK_REPORT)
  return call<InterviewReportResponse>(`/mock-interviews/${encodeURIComponent(sessionId)}/end`, access, { method: 'POST', body: {} })
}

export function getInterviewReport(sessionId: string, access: InterviewAccess): Promise<InterviewReportResponse> {
  if (API_MODE !== 'http') return Promise.resolve(MOCK_REPORT)
  return call<InterviewReportResponse>(`/mock-interviews/${encodeURIComponent(sessionId)}/report`, access)
}

export function printInterviewReport(sessionId: string, access: InterviewAccess): Promise<InterviewPrintResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new InterviewApiError('MOCK_MODE', '演示模式不生成真实打印文件', 0))
  }
  return call<InterviewPrintResponse>(`/mock-interviews/${encodeURIComponent(sessionId)}/report/print`, access, { method: 'POST', body: {} })
}

/** 语音能力探测：ASR 未启用时前端自动回退文字输入；TTS 不可用时降级浏览器本地播报。 */
export function getVoiceCapability(): Promise<{ asrEnabled: boolean; ttsEnabled?: boolean }> {
  if (API_MODE !== 'http') return Promise.resolve({ asrEnabled: false, ttsEnabled: false })
  return call<{ asrEnabled: boolean; ttsEnabled?: boolean }>('/mock-interviews/capabilities/voice', {})
}

/** 面试官问题官方语音(腾讯 TTS,小青同音色)。失败由调用方降级浏览器本地 TTS。 */
export function fetchQuestionAudio(sessionId: string, turnIdx: number, access: InterviewAccess): Promise<{ audio: string; format: string }> {
  if (API_MODE !== 'http') return Promise.reject(new InterviewApiError('MOCK_MODE', '演示模式无官方语音', 0))
  return call<{ audio: string; format: string }>(
    `/mock-interviews/${encodeURIComponent(sessionId)}/turns/${turnIdx}/audio`,
    access,
    { method: 'POST', body: {} },
  )
}

/** 上传一段回答音频（16k 单声道 WAV）→ 转写文本（音频不持久化）。 */
export async function transcribeAnswer(sessionId: string, wav: Blob, access: InterviewAccess): Promise<{ text: string }> {
  if (API_MODE !== 'http') {
    return Promise.reject(new InterviewApiError('MOCK_MODE', '演示模式不支持语音转写，请使用文字输入', 0))
  }
  const form = new FormData()
  form.append('audio', wav, 'answer.wav')
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/mock-interviews/${encodeURIComponent(sessionId)}/transcribe`, {
      method: 'POST',
      headers: {
        ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
        ...(!access.token && access.accessToken ? { 'x-interview-access-token': access.accessToken } : {}),
      },
      credentials: 'include',
      body: form,
    })
  } catch {
    throw new InterviewApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  if (!res.ok) {
    let code = 'ASR_FAILED'
    let message = '语音转写失败'
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (isMemberSessionInvalidError(res.status, code, Boolean(access.token))) notifyMemberSessionExpired(access.token ?? undefined)
    throw new InterviewApiError(code, message, res.status)
  }
  const json = (await res.json()) as { data: { text: string } }
  return json.data
}

export function getMyInterviews(token: string | null | undefined): Promise<{ items: MemberInterviewItem[]; nextCursor: string | null }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ items: [], nextCursor: null })
  return call<{ items: MemberInterviewItem[]; nextCursor: string | null }>('/me/mock-interviews', { token })
}

export function deleteMyInterview(token: string, sessionId: string): Promise<{ deleted: boolean }> {
  return call<{ deleted: boolean }>(`/me/mock-interviews/${encodeURIComponent(sessionId)}`, { token }, { method: 'DELETE' })
}
