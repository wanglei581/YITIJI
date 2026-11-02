import { useCallback, useRef, useState } from 'react'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { resumeAiConsentPromptForMember } from './resumeAiConsentPrompt'
import { useResumeAiConsent } from './resumeAiConsent'

/**
 * 会员在一次简历 AI 请求上收到授权 403：弹出与诊断 / 优化 / 生成相同的授权，
 * 同意后走调用方留下的同一次重试。不同意只关弹层并交给页面自己的出路。
 */
export function useInlineResumeAiConsent(onDecline: () => void) {
  const consent = useResumeAiConsent()
  const [open, setOpen] = useState(false)
  const retryRef = useRef<(() => void) | null>(null)
  const declineRef = useRef(onDecline)
  declineRef.current = onDecline

  const dismiss = useCallback(() => {
    retryRef.current = null
    setOpen(false)
  }, [])

  const promptIfNeeded = useCallback((error: unknown, loggedIn: boolean, retry: () => void) => {
    if (!resumeAiConsentPromptForMember(error, loggedIn)) return false
    retryRef.current = retry
    setOpen(true)
    return true
  }, [])

  const confirm = useCallback(async () => {
    const ok = await consent.confirm()
    if (!ok) return
    const retry = retryRef.current
    retryRef.current = null
    setOpen(false)
    retry?.()
  }, [consent.confirm])

  const cancel = useCallback(() => {
    retryRef.current = null
    setOpen(false)
    declineRef.current()
  }, [])

  const dialog = open ? (
    <ResumeAiConsentDialog
      variant="touch"
      busy={consent.busy}
      error={consent.error}
      guest={false}
      onCancel={cancel}
      onConfirm={() => { void confirm() }}
    />
  ) : null

  return { consent, promptIfNeeded, dialog, dismiss }
}
