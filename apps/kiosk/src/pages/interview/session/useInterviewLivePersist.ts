import { useEffect } from 'react'
import { patchInterviewWorkbenchSession } from '../interviewWorkbenchSession'
import type { InterviewMessage } from './types'
import type { InterviewSessionRouteState } from './types'

export function useInterviewLivePersist(args: {
  state: InterviewSessionRouteState | null
  messages: InterviewMessage[]
  questionIndex: number
  remainingSec: number
  omitPrintAnswers: boolean
}): void {
  const { state, messages, questionIndex, remainingSec, omitPrintAnswers } = args
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
        omitPrintAnswers,
      },
    })
  }, [state, messages, questionIndex, remainingSec, omitPrintAnswers])
}
