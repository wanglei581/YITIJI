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
  questionShownAtRef: MutableRefObject<number>
  setMessages: Dispatch<SetStateAction<InterviewMessage[]>>
  setDraft: Dispatch<SetStateAction<string>>
  setMode: Dispatch<SetStateAction<'voice' | 'text'>>
  setVoice: Dispatch<SetStateAction<InterviewVoiceState>>
  setPhase: Dispatch<SetStateAction<InterviewSessionPhase>>
  setError: Dispatch<SetStateAction<string | null>>
  setMicError: Dispatch<SetStateAction<boolean>>
  setFinishRecovery: Dispatch<SetStateAction<InterviewFinishRecovery | null>>
  setAnswersRecorded: Dispatch<SetStateAction<boolean>>
  setQuestionIndex: Dispatch<SetStateAction<number>>
}): Promise<void> {
  const { args, state, access } = ctx
  if (ctx.voiceKind === 'requesting_permission' || ctx.voiceKind === 'transcribing') return
  const answer = args.text.trim()
  if (!args.skip && !answer) {
    ctx.setError('请输入回答内容，或选择跳过此题')
    return
  }
  const lengthBefore = ctx.messages.length
  const draftBefore = ctx.draft
  ctx.setError(null)
  ctx.setMicError(false)
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
    if (res.done) {
      ctx.setPhase('done_suggest')
      return
    }
    ctx.setMessages((prev) => [...prev, { role: 'interviewer', content: res.question ?? '' }])
    ctx.setQuestionIndex(res.questionIndex)
    ctx.setPhase('answering')
  } catch (err) {
    ctx.setMessages((prev) => dropAppendedTurn(prev, lengthBefore))
    const draftRestored = !args.skip
    if (args.skip) {
      ctx.setDraft(draftBefore)
    } else {
      ctx.setDraft(answer)
      if (args.voiceMeta) ctx.setMode('text')
    }
    const base = aiDeclarationDeclineMessage(err) ?? (isAiOutage(err) ? INTERVIEW_AI_DOWN_HINT : userMessageOf(err, '提交失败，请重试'))
    ctx.setError(submitFailureMessage(base, draftRestored))
    ctx.setPhase('answering')
  }
}

export async function finishInterview(ctx: {
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
}): Promise<void> {
  const {
    state, access, omitPrintAnswers, onGoStage, navigate, stopPlayback, resetVoiceState,
    setPhase, setError, setMicError, setFinishRecovery,
  } = ctx
  if (ctx.voiceKind === 'requesting_permission' || ctx.voiceKind === 'transcribing' || ctx.phase === 'finishing') return
  stopPlayback()
  resetVoiceState()
  setFinishRecovery(null)
  setPhase('finishing')
  setError(null)
  setMicError(false)
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
