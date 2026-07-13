export interface InterviewSessionRouteState {
  sessionId: string
  accessToken?: string
  questionTarget: number
  durationMin: number
  interviewerType: string
  position: string
  firstQuestion?: string
  firstQType?: string
}

export interface InterviewMessage {
  role: 'interviewer' | 'candidate'
  content: string
  skipped?: boolean
}

export type InterviewSessionPhase = 'answering' | 'thinking' | 'finishing' | 'done_suggest'

export type InterviewVoiceState =
  | { kind: 'idle' }
  | { kind: 'requesting_permission' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'transcribing' }
  | { kind: 'review'; transcript: string; edited: string; durationSec: number }

export function formatInterviewClock(seconds: number): string {
  const minutes = Math.floor(Math.max(seconds, 0) / 60)
  const remainder = Math.max(seconds, 0) % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}
