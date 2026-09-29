import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getPublishedPolicy, type PolicyPostView } from '../../services/api/policies'

export type PolicyFocusPhase = 'idle' | 'checking' | 'missing' | 'failed'

type SearchSetter = (
  next: (prev: URLSearchParams) => URLSearchParams,
  opts?: { replace?: boolean },
) => void

export function usePolicyFocus({
  focusId,
  ready,
  guides,
  notices,
  setGuides,
  setNotices,
  setSearchParams,
}: {
  focusId: string | null
  ready: boolean
  guides: PolicyPostView[]
  notices: PolicyPostView[]
  setGuides: Dispatch<SetStateAction<PolicyPostView[]>>
  setNotices: Dispatch<SetStateAction<PolicyPostView[]>>
  setSearchParams: SearchSetter
}): { phase: PolicyFocusPhase; retry: () => void } {
  const [settled, setSettled] = useState<'missing' | 'failed' | null>(null)
  const [settledFor, setSettledFor] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const switchedFor = useRef<string | null>(null)

  const inGuides = Boolean(focusId && guides.some((item) => item.id === focusId))
  const inNotices = Boolean(focusId && notices.some((item) => item.id === focusId))
  const located = !focusId || focusId.startsWith('builtin-') || !ready || inGuides || inNotices
  const phase: PolicyFocusPhase = located
    ? 'idle'
    : focusId === settledFor && (settled === 'missing' || settled === 'failed')
      ? settled
      : 'checking'

  const openNoticeTab = useCallback((id: string) => {
    if (switchedFor.current === id) return
    switchedFor.current = id
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (next.get('tab') === 'notice') return prev
      next.set('tab', 'notice')
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    if (!focusId || !ready || !inNotices || inGuides) return
    openNoticeTab(focusId)
  }, [focusId, inGuides, inNotices, openNoticeTab, ready])

  useEffect(() => {
    if (!focusId || !ready || focusId.startsWith('builtin-') || inGuides || inNotices) return
    let cancelled = false
    const requested = focusId
    void getPublishedPolicy(requested).then((result) => {
      if (cancelled) return
      if (result.status === 'found') {
        const policy = result.policy
        if (policy.kind === 'notice') {
          setNotices((prev) => (prev.some((item) => item.id === policy.id) ? prev : [...prev, policy]))
          openNoticeTab(requested)
        } else {
          setGuides((prev) => (prev.some((item) => item.id === policy.id) ? prev : [...prev, policy]))
        }
        return
      }
      setSettledFor(requested)
      setSettled(result.status === 'missing' ? 'missing' : 'failed')
    })
    return () => { cancelled = true }
  }, [attempt, focusId, inGuides, inNotices, openNoticeTab, ready, setGuides, setNotices])

  const retry = () => {
    setSettled(null)
    setSettledFor(null)
    setAttempt((n) => n + 1)
  }

  return { phase, retry }
}
