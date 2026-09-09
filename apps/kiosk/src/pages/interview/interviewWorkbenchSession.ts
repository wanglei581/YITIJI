import type {
  InterviewDifficulty,
  InterviewDuration,
  InterviewExperience,
  InterviewerType,
} from '@ai-job-print/shared'
import type { InterviewMessage } from './session/types'
import {
  parseInterviewStage,
  type InterviewStage,
} from './interviewWorkbenchModel'

export const INTERVIEW_WORKBENCH_SESSION_KEY = 'ai-job-print:current-interview-workbench'

export interface InterviewSetupDraft {
  interviewerType: InterviewerType
  industry: string
  position: string
  experience: InterviewExperience
  difficulty: InterviewDifficulty
  duration: InterviewDuration
  resumeFile: { fileId: string; name: string } | null
  pendingSession: { sessionId: string; accessToken?: string } | null
  aiOutage: string | null
  startFailed: boolean
  probed: boolean
}

export interface InterviewLiveState {
  sessionId: string
  accessToken?: string
  questionTarget: number
  durationMin: number
  interviewerType: string
  position: string
  firstQuestion?: string
  messages: InterviewMessage[]
  questionIndex: number
  remainingSec: number
  omitPrintAnswers: boolean
}

export interface InterviewReportHandle {
  sessionId: string
  accessToken?: string
}

export interface InterviewWorkbenchSession {
  stage: InterviewStage
  setup?: InterviewSetupDraft
  live?: InterviewLiveState
  report?: InterviewReportHandle
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSetupDraft(raw: unknown): InterviewSetupDraft | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.interviewerType !== 'string') return undefined
  if (typeof raw.industry !== 'string') return undefined
  if (typeof raw.position !== 'string') return undefined
  if (typeof raw.experience !== 'string') return undefined
  if (typeof raw.difficulty !== 'string') return undefined
  if (typeof raw.duration !== 'number') return undefined
  const resumeFile = raw.resumeFile === null
    ? null
    : isRecord(raw.resumeFile) && typeof raw.resumeFile.fileId === 'string' && typeof raw.resumeFile.name === 'string'
      ? { fileId: raw.resumeFile.fileId, name: raw.resumeFile.name }
      : null
  const pendingSession = raw.pendingSession === null || raw.pendingSession === undefined
    ? null
    : isRecord(raw.pendingSession) && typeof raw.pendingSession.sessionId === 'string'
      ? {
          sessionId: raw.pendingSession.sessionId,
          accessToken: typeof raw.pendingSession.accessToken === 'string' ? raw.pendingSession.accessToken : undefined,
        }
      : null
  return {
    interviewerType: raw.interviewerType as InterviewerType,
    industry: raw.industry,
    position: raw.position,
    experience: raw.experience as InterviewExperience,
    difficulty: raw.difficulty as InterviewDifficulty,
    duration: raw.duration as InterviewDuration,
    resumeFile,
    pendingSession,
    aiOutage: typeof raw.aiOutage === 'string' ? raw.aiOutage : null,
    startFailed: raw.startFailed === true,
    probed: raw.probed === true,
  }
}

function parseLive(raw: unknown): InterviewLiveState | undefined {
  if (!isRecord(raw) || typeof raw.sessionId !== 'string' || !raw.sessionId) return undefined
  const messages: InterviewMessage[] = []
  if (Array.isArray(raw.messages)) {
    for (const item of raw.messages) {
      if (!isRecord(item)) continue
      if (item.role !== 'interviewer' && item.role !== 'candidate') continue
      if (typeof item.content !== 'string') continue
      messages.push({
        role: item.role,
        content: item.content,
        skipped: item.skipped === true,
      })
    }
  }
  return {
    sessionId: raw.sessionId,
    accessToken: typeof raw.accessToken === 'string' ? raw.accessToken : undefined,
    questionTarget: typeof raw.questionTarget === 'number' ? raw.questionTarget : 1,
    durationMin: typeof raw.durationMin === 'number' ? raw.durationMin : 5,
    interviewerType: typeof raw.interviewerType === 'string' ? raw.interviewerType : 'hr',
    position: typeof raw.position === 'string' ? raw.position : '',
    firstQuestion: typeof raw.firstQuestion === 'string' ? raw.firstQuestion : undefined,
    messages,
    questionIndex: typeof raw.questionIndex === 'number' ? raw.questionIndex : 1,
    remainingSec: typeof raw.remainingSec === 'number' ? raw.remainingSec : 0,
    omitPrintAnswers: raw.omitPrintAnswers === true,
  }
}

function parseReport(raw: unknown): InterviewReportHandle | undefined {
  if (!isRecord(raw) || typeof raw.sessionId !== 'string' || !raw.sessionId) return undefined
  return {
    sessionId: raw.sessionId,
    accessToken: typeof raw.accessToken === 'string' ? raw.accessToken : undefined,
  }
}

export function readInterviewWorkbenchSession(): InterviewWorkbenchSession | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null
    const raw = window.sessionStorage.getItem(INTERVIEW_WORKBENCH_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    const stage = parseInterviewStage(typeof parsed.stage === 'string' ? parsed.stage : null)
    if (!stage) return null
    return {
      stage,
      setup: parseSetupDraft(parsed.setup),
      live: parseLive(parsed.live),
      report: parseReport(parsed.report),
    }
  } catch {
    return null
  }
}

export function saveInterviewWorkbenchSession(session: InterviewWorkbenchSession): void {
  try {
    window.sessionStorage.setItem(INTERVIEW_WORKBENCH_SESSION_KEY, JSON.stringify(session))
  } catch {
    /* sessionStorage 不可用时不阻塞练习 */
  }
}

export function patchInterviewWorkbenchSession(
  patch: Partial<InterviewWorkbenchSession>,
): InterviewWorkbenchSession {
  const current = readInterviewWorkbenchSession() ?? { stage: 'setup' as const }
  const next: InterviewWorkbenchSession = {
    stage: patch.stage ?? current.stage,
    setup: patch.setup !== undefined ? patch.setup : current.setup,
    live: patch.live !== undefined ? patch.live : current.live,
    report: patch.report !== undefined ? patch.report : current.report,
  }
  saveInterviewWorkbenchSession(next)
  return next
}

export function clearInterviewWorkbenchSession(): void {
  try {
    window.sessionStorage.removeItem(INTERVIEW_WORKBENCH_SESSION_KEY)
  } catch {
    /* ignore */
  }
}
