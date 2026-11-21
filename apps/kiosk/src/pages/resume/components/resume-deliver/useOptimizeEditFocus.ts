// 优化页编辑区原句定位与只读栏提示：从 ResumeOptimizePage 拆出，行为不变。
import { useEffect, useRef, useState } from 'react'
import type { GeneratedResume } from '@ai-job-print/shared'
import type { OptimizePane } from '../../touch/optimizeFrame'
import { locateLockedCopy } from './optimizeStateCopy'
import { findResumeOriginalField, focusResumeOriginalField } from './resumeEntryTitles'

interface Options {
  initialEditOriginal: string | null
  viewOnly: boolean
  draftAccepted: boolean
  editorOpen: boolean
  pane: OptimizePane
  resume: GeneratedResume | null
  onOpenEditor: () => void
}

export function useOptimizeEditFocus({
  initialEditOriginal,
  viewOnly,
  draftAccepted,
  editorOpen,
  pane,
  resume,
  onOpenEditor,
}: Options) {
  const editOriginalRef = useRef<string | null>(initialEditOriginal)
  const [editFocusNonce, setEditFocusNonce] = useState(0)
  const [lockedNote, setLockedNote] = useState<string | null>(null)

  const openEditorAtOriginal = (original: string) => {
    if (viewOnly) return
    editOriginalRef.current = original
    setEditFocusNonce((n) => n + 1)
    // 草稿还没选「继续上次」或「重新开始」时，编辑区还没挂上。只记下这一句，选完再定位。
    if (!draftAccepted) return
    onOpenEditor()
  }

  const hasPendingEditOriginal = () => editOriginalRef.current != null

  useEffect(() => {
    if (!editorOpen || pane !== 'editor' || !resume || editOriginalRef.current == null) return
    const text = editOriginalRef.current
    let frame = 0
    let handle = 0
    const tick = () => {
      if (editOriginalRef.current !== text) return
      if (focusResumeOriginalField(resume, text)) {
        const hit = findResumeOriginalField(resume, text)
        setLockedNote(hit ? locateLockedCopy(hit.fieldId) : null)
        editOriginalRef.current = null
        return
      }
      frame += 1
      if (frame < 60) handle = window.requestAnimationFrame(tick)
    }
    handle = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(handle)
  }, [editorOpen, pane, resume, editFocusNonce])

  useEffect(() => {
    if (pane !== 'editor') return
    const editor = document.querySelector('[data-resume-editor]')
    if (!(editor instanceof HTMLElement)) return
    const onFocus = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const field = target.closest('[data-entry-field]')
      setLockedNote(locateLockedCopy(field?.getAttribute('data-entry-field') ?? ''))
    }
    editor.addEventListener('focusin', onFocus)
    return () => editor.removeEventListener('focusin', onFocus)
  }, [pane, resume])

  return { lockedNote, openEditorAtOriginal, hasPendingEditOriginal }
}
