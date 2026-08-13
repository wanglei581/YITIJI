import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import { useCallback, useEffect, useState } from 'react'
import { getJobFairs } from '../../../services/api/jobFairs'
import { getTerminalId } from '../../../services/api/screensaver'

export type HomeJobFairHighlightState =
  | { status: 'loading'; fair: null }
  | { status: 'ready'; fair: ExternalJobFairDTO }
  | { status: 'empty'; fair: null }
  | { status: 'error'; fair: null }

function eligibleFair(fair: ExternalJobFairDTO, now: number): boolean {
  if (fair.reviewStatus !== 'approved' || fair.publishStatus !== 'published') return false
  if (fair.status !== 'ongoing' && fair.status !== 'upcoming') return false

  const endTime = Date.parse(fair.endTime)
  return Number.isFinite(endTime) && endTime > now
}

function fairOrder(a: ExternalJobFairDTO, b: ExternalJobFairDTO): number {
  if (a.status !== b.status) return a.status === 'ongoing' ? -1 : 1
  return Date.parse(a.startTime) - Date.parse(b.startTime)
}

export function useHomeJobFairHighlight(): HomeJobFairHighlightState & { retry: () => void } {
  const [state, setState] = useState<HomeJobFairHighlightState>({ status: 'loading', fair: null })
  const [requestVersion, setRequestVersion] = useState(0)

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', fair: null })

    const terminalId = getTerminalId()
    void getJobFairs(terminalId ? { terminalId } : undefined)
      .then((response) => {
        if (cancelled) return
        const now = Date.now()
        const fair = response.data.filter((item) => eligibleFair(item, now)).sort(fairOrder)[0]
        setState(fair ? { status: 'ready', fair } : { status: 'empty', fair: null })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', fair: null })
      })

    return () => {
      cancelled = true
    }
  }, [requestVersion])

  return { ...state, retry }
}
