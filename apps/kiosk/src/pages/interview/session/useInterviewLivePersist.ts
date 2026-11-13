import { useEffect } from 'react'
import { patchInterviewWorkbenchSession } from '../interviewWorkbenchSession'
import type { InterviewMessage } from './types'
import type { InterviewSessionRouteState } from './types'

export function useInterviewLivePersist(args: {
  state: InterviewSessionRouteState | null
  messages: InterviewMessage[]
  questionIndex: number
  remainingSec: number
  deadlineAtLocalMs: number
  deadlineSource: 'server' | 'local'
  omitPrintAnswers: boolean
  answersRecorded: boolean
}): void {
  const {
    state, messages, questionIndex, remainingSec, deadlineAtLocalMs, deadlineSource,
    omitPrintAnswers, answersRecorded,
  } = args
  useEffect(() => {
    if (!state?.sessionId) return
    patchInterviewWorkbenchSession({
      stage: 'session',
      live: {
        sessionId: state.sessionId,
        accessToken: state.accessToken,
        questionTarget: state.questionTarget,
        durationMin: state.durationMin,
        interviewerType: state.interviewerType,
        position: state.position,
        firstQuestion: state.firstQuestion,
        messages,
        questionIndex,
        remainingSec,
        deadlineAtLocalMs,
        deadlineSource,
        omitPrintAnswers,
        answersRecorded,
      },
    })
  }, [state, messages, questionIndex, remainingSec, deadlineAtLocalMs, deadlineSource, omitPrintAnswers, answersRecorded])
}
