/** 到点前多少秒开始提醒（下一步才用到）。 */
export const INTERVIEW_DEADLINE_WARN_SEC = 60

export interface InterviewServerTiming {
  startedAt: string | null
  deadlineAt: string | null
  serverNow: string | null
  /** 服务端说这一场已经过点（约定里的 timeUp）。 */
  timeUp: boolean
}

export function readInterviewTiming(raw: unknown): InterviewServerTiming {
  const fields = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return {
    startedAt: typeof fields.startedAt === 'string' ? fields.startedAt : null,
    deadlineAt: typeof fields.deadlineAt === 'string' ? fields.deadlineAt : null,
    serverNow: typeof fields.serverNow === 'string' ? fields.serverNow : null,
    timeUp: fields.timeUp === true,
  }
}

export function deadlineFromServerTiming(timing: InterviewServerTiming, localNowMs: number): number | null {
  if (!timing.deadlineAt || !timing.serverNow || !Number.isFinite(localNowMs)) return null
  const deadline = Date.parse(timing.deadlineAt)
  const now = Date.parse(timing.serverNow)
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return null
  if (timing.startedAt !== null) {
    const started = Date.parse(timing.startedAt)
    if (!Number.isFinite(started) || deadline < started || now < started) return null
  }
  // 只取服务端剩余时长，避免一体机时钟偏差改变练习时长。
  const localDeadline = localNowMs + (deadline - now)
  return Number.isFinite(localDeadline) && localDeadline > 0 ? localDeadline : null
}

export function deadlineFromLocalStart(durationMin: number, localNowMs: number): number {
  const duration = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 5
  return localNowMs + duration * 60_000
}

export function deadlineFromLegacyRemaining(remainingSec: number, localNowMs: number): number {
  return localNowMs + (Number.isFinite(remainingSec) ? Math.max(0, remainingSec) : 0) * 1000
}

export function remainingSecAt(deadlineAtLocalMs: number, localNowMs: number): number {
  return Math.max(0, Math.ceil((deadlineAtLocalMs - localNowMs) / 1000))
}
