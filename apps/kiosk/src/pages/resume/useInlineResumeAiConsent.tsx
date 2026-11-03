import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { grantResumeAiConsent } from './resumeAiConsent'
import { resumeAiConsentPromptForMember } from './resumeAiConsentPrompt'

/**
 * 会员在一次简历 AI 请求上收到授权 403：弹出与诊断 / 优化 / 生成相同的授权，
 * 同意后记录 resume_ai 并走调用方留下的同一次重试。不同意只关弹层并交给页面自己的出路。
 * 挂载时不查授权状态。
 */
export function useInlineResumeAiConsent(onDecline: () => void) {
  const { getToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retryRef = useRef<(() => void) | null>(null)
  const declineRef = useRef(onDecline)
  declineRef.current = onDecline

  const dismiss = useCallback(() => {
    retryRef.current = null
    setError(null)
    setOpen(false)
  }, [])

  const promptIfNeeded = useCallback((failure: unknown, loggedIn: boolean, retry: () => void) => {
    if (!resumeAiConsentPromptForMember(failure, loggedIn)) return false
    retryRef.current = retry
    setError(null)
    setOpen(true)
    return true
  }, [])

  const confirm = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setError('授权未完成，请重试')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await grantResumeAiConsent(token)
      const retry = retryRef.current
      retryRef.current = null
      setOpen(false)
      retry?.()
    } catch (err) {
      setError(userMessageOf(err, '授权未完成，请重试'))
    } finally {
      setBusy(false)
    }
  }, [getToken])

  const cancel = useCallback(() => {
    retryRef.current = null
    setError(null)
    setOpen(false)
    declineRef.current()
  }, [])

  const dialog = open ? (
    <ResumeAiConsentDialog
      variant="touch"
      busy={busy}
      error={error}
      guest={false}
      onCancel={cancel}
      onConfirm={() => { void confirm() }}
    />
  ) : null

  return { promptIfNeeded, dialog, dismiss }
}
