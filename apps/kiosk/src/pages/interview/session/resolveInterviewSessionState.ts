import { readInterviewWorkbenchSession } from '../interviewWorkbenchSession'
import type { InterviewSessionRouteState } from './types'

export function resolveInterviewSessionState(
  routeState: InterviewSessionRouteState | null,
): InterviewSessionRouteState | null {
  if (routeState?.sessionId) return routeState
  const storedLive = readInterviewWorkbenchSession()?.live
  if (!storedLive) return null
  return {
    sessionId: storedLive.sessionId,
    accessToken: storedLive.accessToken,
    questionTarget: storedLive.questionTarget,
    durationMin: storedLive.durationMin,
    interviewerType: storedLive.interviewerType,
    position: storedLive.position,
    firstQuestion: storedLive.firstQuestion,
  }
}
