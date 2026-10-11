import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { answerInterview, endInterview, type InterviewAccess } from '../../../services/api/interview'
import { errorCodeOf, userMessageOf } from '../../../services/api/userErrorMessage'
import { isAiOutage } from '../../../ai/aiOutage'
import { aiDeclarationDeclineMessage } from '../../../ai/aiDeclarationErrors'
import { INTERVIEW_AI_DOWN_HINT, type InterviewStage } from '../interviewWorkbenchModel'
import { patchInterviewWorkbenchSession } from '../interviewWorkbenchSession'
import type { InterviewMessage, InterviewSessionPhase, InterviewSessionRouteState, InterviewVoiceState } from './types'
import {
  classifyInterviewFinishFailure,
  dropAppendedTurn,
  hasNonSkippedCandidate,
  submitFailureMessage,
  type InterviewFinishRecovery,
} from './interviewAnswerRecovery'

type SubmitArgs = {
  text: string
  skip: boolean
  voiceMeta?: { transcript: string; edited: boolean; durationSec: number }
}

export async function submitInterviewAnswer(ctx: {
  args: SubmitArgs
  state: InterviewSessionRouteState
  access: InterviewAccess
  messages: InterviewMessage[]
  draft: string
  voiceKind: InterviewVoiceState['kind']
  sealedRef: MutableRefObject<boolean>
  sealAtDeadline: () => void
  questionShownAtRef: MutableRefObject<number>
  setMessages: Dispatch<SetStateAction<InterviewMessage[]>>
  setDraft: Dispatch<SetStateAction<string>>
  setMode: Dispatch<SetStateAction<'voice' | 'text'>>
  setVoice: Dispatch<SetStateAction<InterviewVoiceState>>
  setPhase: Dispatch<SetStateAction<InterviewSessionPhase>>
  setError: Dispatch<SetStateAction<string | null>>
  setMicError: Dispatch<SetStateAction<boolean>>
  setNetworkFailure: Dispatch<SetStateAction<boolean>>
  setFinishRecovery: Dispatch<SetStateAction<InterviewFinishRecovery | null>>
  setAnswersRecorded: Dispatch<SetStateAction<boolean>>
  setQuestionIndex: Dispatch<SetStateAction<number>>
}): Promise<void> {
  const { args, state, access } = ctx
  if (ctx.sealedRef.current) return
  if (ctx.voiceKind === 'requesting_permission' || ctx.voiceKind === 'transcribing') return
  const answer = args.text.trim()
  if (!args.skip && !answer) {
    ctx.setNetworkFailure(false)
    ctx.setError('请输入回答内容，或选择跳过此题')
    return
  }
  const lengthBefore = ctx.messages.length
  const draftBefore = ctx.draft
  ctx.setError(null)
  ctx.setMicError(false)
  ctx.setNetworkFailure(false)
  ctx.setFinishRecovery(null)
  ctx.setMessages((prev) => [...prev, { role: 'candidate', content: args.skip ? '跳过了这个问题' : answer, skipped: args.skip }])
  ctx.setDraft('')
  ctx.setVoice({ kind: 'idle' })
  ctx.setPhase('thinking')
  try {
    const textDuration = Math.min(600, Math.round((Date.now() - ctx.questionShownAtRef.current) / 1000))
    const res = await answerInterview(
        state.sessionId,
      args.skip
        ? { skip: true }
        : {
            answer,
            inputMode: args.voiceMeta ? 'voice' : 'text',
            ...(args.voiceMeta
              ? { transcriptText: args.voiceMeta.transcript, transcriptEdited: args.voiceMeta.edited, answerDurationSec: args.voiceMeta.durationSec }
              : { answerDurationSec: textDuration }),
          },
      access,
    )
    if (!args.skip) ctx.setAnswersRecorded(true)
    if (res.timeUp === true) ctx.sealAtDeadline()
    if (ctx.sealedRef.current) return
    if (res.done) {
      ctx.setPhase('done_suggest')
      return
    }
    ctx.setMessages((prev) => [...prev, { role: 'interviewer', content: res.question ?? '' }])
    ctx.setQuestionIndex(res.questionIndex)
    ctx.setPhase('answering')
  } catch (err) {
    ctx.setMessages((prev) => dropAppendedTurn(prev, lengthBefore))
    if (errorCodeOf(err) === 'INTERVIEW_DEADLINE_REACHED') ctx.sealAtDeadline()
    if (ctx.sealedRef.current) return
    const draftRestored = !args.skip
    if (args.skip) {
      ctx.setDraft(draftBefore)
    } else {
      ctx.setDraft(answer)
      if (args.voiceMeta) ctx.setMode('text')
    }
    const declined = aiDeclarationDeclineMessage(err)
    const outage = isAiOutage(err)
    const base = aiDeclarationDeclineMessage(err) ?? (isAiOutage(err) ? INTERVIEW_AI_DOWN_HINT : userMessageOf(err, '提交失败，请重试'))
    ctx.setNetworkFailure(!declined && !outage && (errorCodeOf(err) === 'NETWORK_ERROR' || err instanceof TypeError))
    ctx.setError(submitFailureMessage(base, draftRestored))
    ctx.setPhase('answering')
  }
}

export interface InterviewFinishContext {
  sealedRef: MutableRefObject<boolean>
  setTimeUpVariant: Dispatch<SetStateAction<'no-answers' | 'report-failed'>>
  state: InterviewSessionRouteState
  access: InterviewAccess
  phase: InterviewSessionPhase
  voiceKind: InterviewVoiceState['kind']
  messages: InterviewMessage[]
  answersRecorded: boolean
  omitPrintAnswers: boolean
  onGoStage?: (stage: InterviewStage) => void
  navigate: NavigateFunction
  stopPlayback: () => void
  resetVoiceState: () => void
  setPhase: Dispatch<SetStateAction<InterviewSessionPhase>>
  setError: Dispatch<SetStateAction<string | null>>
  setMicError: Dispatch<SetStateAction<boolean>>
  setFinishRecovery: Dispatch<SetStateAction<InterviewFinishRecovery | null>>
}

/** 手动结束保留原来的语音守卫；到点直接调用请求函数。 */
export async function finishInterview(ctx: InterviewFinishContext): Promise<void> {
  if (ctx.sealedRef.current || ctx.voiceKind === 'requesting_permission' || ctx.voiceKind === 'transcribing' || ctx.phase === 'finishing') return
  ctx.stopPlayback()
  ctx.resetVoiceState()
  ctx.setFinishRecovery(null)
  ctx.setPhase('finishing')
  ctx.setError(null)
  ctx.setMicError(false)
  await requestInterviewReport(ctx)
}

export async function requestInterviewReport(ctx: InterviewFinishContext): Promise<void> {
  const { state, access, omitPrintAnswers, onGoStage, navigate } = ctx
  try {
    const report = await endInterview(state.sessionId, access, {
      includeAnswersInPrint: !omitPrintAnswers,
    })
    patchInterviewWorkbenchSession({
      stage: 'report',
      report: { sessionId: state.sessionId, accessToken: state.accessToken },
    })
    if (onGoStage) onGoStage('report')
    else navigate('/interview/report', { state: { sessionId: state.sessionId, accessToken: state.accessToken, report } })
  } catch (err) {
    // 手动结束的请求若跨过截止时刻，也不能恢复作答。
    if (ctx.sealedRef.current) {
      ctx.setTimeUpVariant(errorCodeOf(err) === 'INTERVIEW_NO_ANSWERS' ? 'no-answers' : 'report-failed')
      ctx.setPhase('closed')
      return
    }
    const declined = aiDeclarationDeclineMessage(err)
    const classified = classifyInterviewFinishFailure({
      code: errorCodeOf(err),
      outage: isAiOutage(err),
      declined,
      answersRecorded: ctx.answersRecorded,
    })
    if (classified) {
      ctx.setFinishRecovery(classified.recovery)
      ctx.setError(classified.message)
      ctx.setPhase('answering')
      return
    }
    ctx.setError(declined ?? userMessageOf(err, '报告生成失败，请重试'))
    ctx.setPhase(hasNonSkippedCandidate(ctx.messages) ? 'done_suggest' : 'answering')
  }
}
