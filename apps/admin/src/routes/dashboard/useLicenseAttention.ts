import { useCallback, useEffect, useState } from 'react'
import type { LicenseAttention } from '@ai-job-print/shared'
import type { QueueState } from '../../components/first-order/useServiceQueues'
import { getLicenseAttention } from '../../services/api/licensesAdmin'

export function useLicenseAttention(): { state: QueueState<LicenseAttention>; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<QueueState<LicenseAttention>>({ status: 'loading' })
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    getLicenseAttention().then((data) => { if (alive) setState({ status: 'ready', data }) })
      .catch(() => { if (alive) setState({ status: 'error' }) })
    return () => { alive = false }
  }, [attempt])
  return { state, retry }
}
