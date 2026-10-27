import { useEffect, useState } from 'react'
import type { ResumeCompareDecision } from './resumeCompareModel'

export function ResumeCompareCustomEditor(props: {
  decision?: ResumeCompareDecision
  value: string
  seed: string
  onSave: (text: string) => void
  /** 由本屏分段按钮接管「自己写」时传入。不传则仍由组件内按钮打开。 */
  open?: boolean
  hideTrigger?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const controlled = props.open !== undefined
  const [localEditing, setLocalEditing] = useState(false)
  const editing = controlled ? Boolean(props.open) : localEditing
  const [draft, setDraft] = useState(props.value || props.seed)
  const setEditing = (next: boolean) => {
    if (!controlled) setLocalEditing(next)
    props.onOpenChange?.(next)
  }

  useEffect(() => {
    setDraft(props.value || props.seed)
    if (!controlled) setLocalEditing(false)
  }, [props.value, props.seed, controlled])

  if (!editing) {
    if (props.hideTrigger && !(props.decision === 'custom' && props.value)) return null
    return (
      <section className="qxc-custom">
        {props.hideTrigger ? null : (
          <button
            type="button"
            className="qx-btn"
            data-variant="ghost"
            aria-pressed={props.decision === 'custom'}
            onClick={() => setEditing(true)}
          >
            自己写
            <small>用你的话改</small>
          </button>
        )}
        {props.decision === 'custom' && props.value ? (
          <>
            <p>本页自己写的版本只进阅读草稿与统计，刷新即丢，不会被应用到编辑区。</p>
            <p className="qxc-copy">{props.value}</p>
          </>
        ) : null}
      </section>
    )
  }

  return (
    <section className="qxc-custom" data-editing="true">
      <label>
        自己写这一条
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="自己改写这一条"
        />
      </label>
      <p>这段只留在本页，刷新后不保留。要放进新简历，请回编辑区填写。</p>
      <div className="qxc-custom-actions">
        <button
          type="button"
          className="qx-btn"
          data-variant="teal"
          onClick={() => {
            const text = draft.trim()
            if (!text) return
            props.onSave(text)
            setEditing(false)
          }}
        >
          用这段
        </button>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setEditing(false)}>
          取消
        </button>
      </div>
    </section>
  )
}
