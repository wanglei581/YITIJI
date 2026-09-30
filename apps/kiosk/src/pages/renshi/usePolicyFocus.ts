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

export const POLICY_WITHDRAWN_COPY = '这条政策已经撤下，不再提供来源入口'
export const POLICY_UNCONFIRMED_COPY = '这次没有确认这条还在，先不打开来源入口。'
export const POLICY_CHECKING_COPY = '正在确认这条还在'

export type PolicyActionPhase = 'idle' | 'checking' | 'withdrawn' | 'unconfirmed'

export type PolicyConfirmResult =
  | { kind: 'local' }
  | { kind: 'ready'; policy: PolicyPostView }
  | { kind: 'blocked' }

/**
 * 用户点来源码或上传自备材料之前按条读一次。不轮询。
 * 404 把这一条从列表里拿掉并收起，不改打开下一条。
 */
export function usePolicyActionGuard({
  focusId,
  setGuides,
  setNotices,
  setSearchParams,
  reloadQuiet,
  withdrawnIds,
}: {
  focusId: string | null
  setGuides: Dispatch<SetStateAction<PolicyPostView[]>>
  setNotices: Dispatch<SetStateAction<PolicyPostView[]>>
  setSearchParams: SearchSetter
  reloadQuiet: () => void
  withdrawnIds: { current: Set<string> }
}): {
  confirm: (id: string | null) => Promise<PolicyConfirmResult>
  message: string | null
  phase: PolicyActionPhase
  subjectId: string | null
  suppressAutoOpen: boolean
  release: () => void
} {
  const [phase, setPhase] = useState<PolicyActionPhase>('idle')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [suppressAutoOpen, setSuppressAutoOpen] = useState(false)
  const inflight = useRef(false)

  const message = phase === 'checking'
    ? POLICY_CHECKING_COPY
    : phase === 'withdrawn'
      ? POLICY_WITHDRAWN_COPY
      : phase === 'unconfirmed'
        ? POLICY_UNCONFIRMED_COPY
        : null

  const release = useCallback(() => {
    setPhase('idle')
    setSubjectId(null)
    setSuppressAutoOpen(false)
  }, [])

  const confirm = useCallback(async (id: string | null): Promise<PolicyConfirmResult> => {
    if (inflight.current) return { kind: 'blocked' }
    if (!id || id.startsWith('builtin-')) return { kind: 'local' }
    inflight.current = true
    setPhase('checking')
    setSubjectId(id)
    try {
      const result = await getPublishedPolicy(id)
      if (result.status === 'found') {
        const policy = result.policy
        const replace = (prev: PolicyPostView[]) => prev.map((item) => (item.id === policy.id ? policy : item))
        if (policy.kind === 'notice') setNotices(replace)
        else setGuides(replace)
        setPhase('idle')
        setSubjectId(null)
        return { kind: 'ready', policy }
      }
      if (result.status === 'missing') {
        withdrawnIds.current.add(id)
        setGuides((prev) => prev.filter((item) => item.id !== id))
        setNotices((prev) => prev.filter((item) => item.id !== id))
        setSuppressAutoOpen(true)
        setPhase('withdrawn')
        setSubjectId(id)
        if (focusId === id) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            if (next.get('policy') !== id) return prev
            next.delete('policy')
            return next
          }, { replace: true })
        }
        reloadQuiet()
        return { kind: 'blocked' }
      }
      setPhase('unconfirmed')
      setSubjectId(id)
      return { kind: 'blocked' }
    } finally {
      inflight.current = false
    }
  }, [focusId, reloadQuiet, setGuides, setNotices, setSearchParams, withdrawnIds])

  return { confirm, message, phase, subjectId, suppressAutoOpen, release }
}
