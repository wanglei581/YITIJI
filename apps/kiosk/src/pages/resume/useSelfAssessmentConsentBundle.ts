import { useCallback, useEffect, useState } from 'react'
import { getSelfAssessmentQuestions } from '../../services/api/selfAssessment'
import { readConsentBundle, type SelfAssessmentConsentBundle } from './selfAssessmentConsent'

export type ConsentBundleState =
  | { status: 'loading' }
  | { status: 'ready'; bundle: SelfAssessmentConsentBundle }
  | { status: 'error' }

/**
 * 同意页每次打开都重新取一次说明（服务端可能刚升了版本）。
 * 取不到、缺字段、条款为空 → error：页面如实说「没有取到」并给重试，不放行作答。
 */
export function useSelfAssessmentConsentBundle(): { state: ConsentBundleState; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ConsentBundleState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    getSelfAssessmentQuestions()
      .then((json) => {
        if (!active) return
        const bundle = readConsentBundle(json)
        setState(bundle ? { status: 'ready', bundle } : { status: 'error' })
      })
      .catch(() => { if (active) setState({ status: 'error' }) })
    return () => { active = false }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  return { state, retry }
}
