import { ConflictException } from '@nestjs/common'

/** 回答接口的在路宽限（毫秒）。转写和题目播报没有这 3 秒。 */
export const INTERVIEW_ANSWER_GRACE_MS = 3000

export const INTERVIEW_DEADLINE_REACHED_CODE = 'INTERVIEW_DEADLINE_REACHED'

export const INTERVIEW_DEADLINE_REACHED_MESSAGE = '本场练习时间已到。已提交的回答都在，可以生成报告。'

/** 截止时刻 = 第一题写入时刻 + 所选分钟数。定下来后不再延长。 */
export function deadlineAtFromStart(writtenAt: Date, durationMin: number): Date {
  return new Date(writtenAt.getTime() + durationMin * 60_000)
}

/**
 * 没有截止时刻时永远不过点。
 * graceMs 默认 0；回答接口传入宽限后，只有 now >= deadlineAt + graceMs 才拒绝。
 */
export function isPastDeadline(deadlineAt: Date | null | undefined, now: Date, graceMs = 0): boolean {
  if (!deadlineAt) return false
  return now.getTime() >= deadlineAt.getTime() + graceMs
}

/** 开始、回答、读取会话成功时附带的三个字段。 */
export function interviewDeadlineFields(deadlineAt: Date | null | undefined, now: Date): {
  deadlineAt: string | null
  serverNow: string
  timeUp: boolean
} {
  const serverNow = now.toISOString()
  if (!deadlineAt) return { deadlineAt: null, serverNow, timeUp: false }
  return {
    deadlineAt: deadlineAt.toISOString(),
    serverNow,
    timeUp: now.getTime() >= deadlineAt.getTime(),
  }
}

/** 到点后回答、转写、播报共用的 409。文案和错误码只在本文件写一次。 */
export function interviewDeadlineReachedException(): ConflictException {
  return new ConflictException({
    error: { code: INTERVIEW_DEADLINE_REACHED_CODE, message: INTERVIEW_DEADLINE_REACHED_MESSAGE },
  })
}
