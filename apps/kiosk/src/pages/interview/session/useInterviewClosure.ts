import { useRef, useState, type MutableRefObject, type Dispatch, type SetStateAction } from 'react'
import { finishInterview, requestInterviewReport, type InterviewFinishContext } from './interviewTurnActions'
import type { InterviewSessionPhase } from './types'

/** 只等本次提交落定；超时也收尾，迟到回包由 sealedRef 拦住。 */
async function waitForAnswer(pending: Promise<void> | null): Promise<void> {
  if (!pending) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      pending.catch(() => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 12_000) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

type ClosureContext = Omit<InterviewFinishContext, 'setTimeUpVariant' | 'setPhase' | 'phase' | 'state'> & {
  state: InterviewFinishContext['state'] | null
  phase: InterviewSessionPhase
  onSealed: () => void
  setPhase: Dispatch<SetStateAction<InterviewSessionPhase>>
}

export function useInterviewClosure(ctx: ClosureContext) {
  const sealedRef: MutableRefObject<boolean> = ctx.sealedRef
  const [sealed, setSealed] = useState(false)
  const [timeUpVariant, setTimeUpVariant] = useState<'no-answers' | 'report-failed'>('report-failed')
  const pendingAnswerRef = useRef<Promise<void> | null>(null)
  const phaseRef = useRef(ctx.phase)
  phaseRef.current = ctx.phase
  const setPhase: Dispatch<SetStateAction<InterviewSessionPhase>> = (next) => {
    const phase = typeof next === 'function' ? next(phaseRef.current) : next
    phaseRef.current = phase
    ctx.setPhase(phase)
  }
  const reportContext = () => ctx.state ? { ...ctx, state: ctx.state, sealedRef, setTimeUpVariant, setPhase } : null

  const closeAndRequestReport = async () => {
    const context = reportContext()
    if (!context) return
    setPhase('finishing')
    ctx.setFinishRecovery(null)
    ctx.setError(null)
    ctx.setMicError(false)
    await waitForAnswer(pendingAnswerRef.current)
    await requestInterviewReport(context)
  }

  const sealAtDeadline = () => {
    if (sealedRef.current || !ctx.state) return
    sealedRef.current = true
    setSealed(true)
    ctx.onSealed()
    // 手动结束的请求已经在路上，只标记；它失败时也会停在 closed。
    if (phaseRef.current === 'finishing') return
    ctx.stopPlayback()
    ctx.resetVoiceState()
    void closeAndRequestReport()
  }

  const finish = () => {
    const context = reportContext()
    if (context) void finishInterview({ ...context, phase: phaseRef.current })
  }
  const retryReport = () => {
    if (!sealedRef.current || phaseRef.current !== 'closed') return
    void closeAndRequestReport()
  }
  return { sealedRef, sealed, timeUpVariant, pendingAnswerRef, setPhase, sealAtDeadline, finish, retryReport }
}
