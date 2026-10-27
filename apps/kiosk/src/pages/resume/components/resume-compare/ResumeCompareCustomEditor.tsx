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
      <section className="qxt-custom">
        {props.hideTrigger ? null : (
          <button
            type="button"
            className="qxt-use"
            aria-pressed={props.decision === 'custom'}
            onClick={() => setEditing(true)}
          >
            自己写
          </button>
        )}
        {props.decision === 'custom' && props.value ? (
          <>
            <b className="qxt-cl">已用你写的这段</b>
            <p className="qxt-cn">本页自己写的版本只进阅读草稿与统计，刷新即丢，不会被应用到编辑区。</p>
            <p className="qxt-cv">{props.value}</p>
          </>
        ) : null}
      </section>
    )
  }

  return (
    <section className="qxt-custom" data-editing="true">
      <label>
        <b className="qxt-cl">自己写这一条</b>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="在这里写你自己的这一句"
          aria-label="自己改写这一条"
        />
      </label>
      <p className="qxt-cn">这段只留在本页，刷新后不保留。要放进新简历，请回编辑区填写。</p>
      <div className="qxt-ca">
        <button
          type="button"
          className="qxt-use qxt-use-pri"
          onClick={() => {
            const text = draft.trim()
            if (!text) return
            props.onSave(text)
            setEditing(false)
          }}
        >
          用这段
        </button>
        <button type="button" className="qxt-use" onClick={() => setEditing(false)}>
          取消
        </button>
      </div>
    </section>
  )
}
