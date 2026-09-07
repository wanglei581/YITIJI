import { useEffect, useRef, useState } from 'react'
import type { GeneratedResume, ResumeDraftPayload, ResumeLayoutSettings } from '@ai-job-print/shared'
import { getResumeDraft, saveResumeDraft } from '../../../../services/api'
import type { ResumeDecisionMap } from './resumeDecisions'

const DEBOUNCE_MS = 2000

export type DraftSaveStatus = 'guest' | 'idle' | 'saving' | 'saved' | 'failed'

function snapshotOf(
  resume: GeneratedResume,
  layout: ResumeLayoutSettings,
  decisions: ResumeDecisionMap,
): string {
  return JSON.stringify({ resume, layout, decisions })
}

export function useResumeDraftAutosave(opts: {
  taskId?: string
  token: string | null
  resume: GeneratedResume | null
  layout: ResumeLayoutSettings
  decisions: ResumeDecisionMap
  enabled: boolean
  skipFetch: boolean
}) {
  const { taskId, token, resume, layout, decisions, enabled, skipFetch } = opts
  const shouldFetch = Boolean(token && taskId && !skipFetch)
  const [loading, setLoading] = useState(shouldFetch)
  const [remoteDraft, setRemoteDraft] = useState<ResumeDraftPayload | null>(null)
  const [status, setStatus] = useState<DraftSaveStatus>(token ? 'idle' : 'guest')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const baselineRef = useRef<string | null>(null)
  const lastPersistedRef = useRef<string | null>(null)
  const inflightRef = useRef(0)
  // 「从优化结果重新开始」后必须立刻用当前内容覆盖服务端旧草稿，否则下次进页还会再问一遍
  const overwriteOnAcceptRef = useRef(false)

  useEffect(() => {
    if (!token || !taskId || skipFetch) {
      setLoading(false)
      setRemoteDraft(null)
      setStatus(token ? 'idle' : 'guest')
      return
    }
    let cancelled = false
    setLoading(true)
    getResumeDraft(taskId, token)
      .then((res) => {
        if (cancelled) return
        setRemoteDraft(res.draft)
        setSavedAt(res.draft?.updatedAt ?? null)
        setStatus(res.draft ? 'saved' : 'idle')
      })
      .catch(() => {
        if (cancelled) return
        setRemoteDraft(null)
        setSavedAt(null)
        setStatus('idle')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, taskId, skipFetch])

  useEffect(() => {
    if (!enabled) {
      baselineRef.current = null
      return
    }
    if (!token || !taskId || !resume) return
    const snap = snapshotOf(resume, layout, decisions)
    if (baselineRef.current === null) {
      baselineRef.current = snap
      if (overwriteOnAcceptRef.current) {
        overwriteOnAcceptRef.current = false
        lastPersistedRef.current = ''
      } else {
        lastPersistedRef.current = snap
        setUnsaved(false)
        return
      }
    }
    if (snap === lastPersistedRef.current) {
      setUnsaved(false)
      return
    }
    setUnsaved(true)
    const seq = ++inflightRef.current
    const timer = window.setTimeout(() => {
      setStatus('saving')
      void saveResumeDraft(taskId, { resume, layout, decisions }, token)
        .then((res) => {
          if (seq !== inflightRef.current) return
          lastPersistedRef.current = snap
          setSavedAt(res.updatedAt)
          setUnsaved(false)
          setStatus('saved')
        })
        .catch(() => {
          if (seq !== inflightRef.current) return
          setStatus('failed')
        })
    }, DEBOUNCE_MS)
    return () => { window.clearTimeout(timer) }
  }, [enabled, token, taskId, resume, layout, decisions])

  return {
    /** 用户选择「从优化结果重新开始」时调用：接受后第一次快照直接 PUT 覆盖旧草稿 */
    requestOverwrite: () => { overwriteOnAcceptRef.current = true },
    loading,
    remoteDraft,
    hasDraft: Boolean(remoteDraft),
    status: token ? status : 'guest',
    savedAt,
    unsaved,
  }
}
