import { useEffect, useLayoutEffect, useRef } from 'react'
import { scrollInterviewToTop } from './interviewScroll'
import { patchInterviewWorkbenchSession, type InterviewSetupDraft } from './interviewWorkbenchSession'

export function useInterviewSetupPersist(draft: InterviewSetupDraft): void {
  const {
    directionSelectionVersion,
    interviewerType,
    industry,
    position,
    experience,
    difficulty,
    duration,
    resumeFile,
    pendingSession,
    aiOutage,
    startFailed,
    probed,
  } = draft

  useEffect(() => {
    patchInterviewWorkbenchSession({
      setup: {
        directionSelectionVersion,
        interviewerType,
        industry,
        position,
        experience,
        difficulty,
        duration,
        resumeFile,
        pendingSession,
        aiOutage,
        startFailed,
        probed,
      },
    })
  }, [
    directionSelectionVersion,
    interviewerType,
    industry,
    position,
    experience,
    difficulty,
    duration,
    resumeFile,
    pendingSession,
    aiOutage,
    startFailed,
    probed,
  ])
}

/** 换步后点下去的按钮被卸载，焦点会掉回 body。把焦点放到意图带的标题上，并回到顶。第一次进来不抢焦点。 */
export function useInterviewStepFocus(step: 1 | 2 | 3): void {
  const seenStep = useRef<number | null>(null)
  useLayoutEffect(() => {
    const changed = seenStep.current !== null && seenStep.current !== step
    seenStep.current = step
    if (!changed) return
    const heading = document.querySelector<HTMLElement>('.qxt-band h1')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
    scrollInterviewToTop()
  }, [step])
}
