import type { InterviewReportPayload } from './mock-interview-llm.service'

export const QA_ANSWER_EXCERPT_CHARS = 200

export interface InterviewQaExcerpt {
  question: string
  /** 用户回答转写前 200 字；跳过或未答为 null。 */
  answerExcerpt: string | null
  skipped: boolean
}

type TurnLike = {
  role: string
  content: string
  skipped: boolean
}

export function buildQaExcerpts(turns: TurnLike[]): InterviewQaExcerpt[] {
  const out: InterviewQaExcerpt[] = []
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i]
    if (turn.role !== 'interviewer') continue
    const next = turns[i + 1]
    const candidate = next && next.role === 'candidate' ? next : null
    const skipped = candidate?.skipped === true
    const raw = skipped ? '' : (candidate?.content ?? '').trim()
    out.push({
      question: turn.content,
      answerExcerpt: raw.length === 0 ? null : raw.slice(0, QA_ANSWER_EXCERPT_CHARS),
      skipped,
    })
  }
  return out
}

export function parseStoredInterviewReport(payloadJson: string): {
  report: InterviewReportPayload
  includeAnswersInPrint: boolean
} {
  const parsed = JSON.parse(payloadJson) as InterviewReportPayload & {
    includeAnswersInPrint?: unknown
  }
  const includeAnswersInPrint = parsed.includeAnswersInPrint !== false
  const rest = { ...parsed }
  delete rest.includeAnswersInPrint
  return { report: rest as InterviewReportPayload, includeAnswersInPrint }
}

export function serializeInterviewReport(
  report: InterviewReportPayload,
  includeAnswersInPrint: boolean,
): string {
  return JSON.stringify({ ...report, includeAnswersInPrint })
}
