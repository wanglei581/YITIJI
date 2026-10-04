import type { InterviewMessage } from './types'

/** 只在非跳过的回答真的放回输入框时接在原错误后面。 */
export const INTERVIEW_DRAFT_RESTORED_HINT = '你刚才的回答还在输入框里。'

export const INTERVIEW_NO_ANSWERS_COPY =
  '这一场还没有记下的回答，没法生成报告。可以回去答一题再结束，或直接离开。'

export const INTERVIEW_REPORT_OUTAGE_SAVED_COPY =
  'AI 暂时用不了，报告现在生成不了。你的回答已保存，AI 恢复后可以接着生成报告。'

export const INTERVIEW_REPORT_OUTAGE_UNSAVED_COPY = 'AI 暂时用不了，报告现在生成不了。'

export type InterviewFinishRecovery = 'no-answers' | 'outage'

/**
 * 撤回本次刚追加的那一条。用追加前的长度定位，不按内容比对：
 * 跳过句和用户原文可能重复，按字面删会撤错。
 * 长度没有变长说明这条还没写进列表，原样留下。
 */
export function dropAppendedTurn<T>(messages: T[], lengthBefore: number): T[] {
  if (messages.length > lengthBefore) return messages.slice(0, lengthBefore)
  return messages
}

export function submitFailureMessage(base: string, draftRestored: boolean): string {
  if (!draftRestored) return base
  return base.includes(INTERVIEW_DRAFT_RESTORED_HINT) ? base : `${base}${INTERVIEW_DRAFT_RESTORED_HINT}`
}

/**
 * 结束本场的失败怎么说。
 * 返回 null 表示沿用调用方原来的声明拒绝或「报告生成失败，请重试」。
 * 「已保存」只在本页亲眼见过非跳过的 answer 成功时才说。
 */
export function classifyInterviewFinishFailure(args: {
  code: string | undefined
  outage: boolean
  declined: string | null
  answersRecorded: boolean
}): { recovery: InterviewFinishRecovery; message: string } | null {
  if (args.declined) return null
  if (args.code === 'INTERVIEW_NO_ANSWERS') {
    return { recovery: 'no-answers', message: INTERVIEW_NO_ANSWERS_COPY }
  }
  if (args.outage) {
    return {
      recovery: 'outage',
      message: args.answersRecorded ? INTERVIEW_REPORT_OUTAGE_SAVED_COPY : INTERVIEW_REPORT_OUTAGE_UNSAVED_COPY,
    }
  }
  return null
}

export function hasNonSkippedCandidate(messages: InterviewMessage[]): boolean {
  return messages.some((message) => message.role === 'candidate' && !message.skipped)
}
