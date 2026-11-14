import { useRef, useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'

/**
 * 技能沿用生成向导第 6 步的可改文字，和「删除该条」图标。
 * 证书只读：不提供增删，名称仍按填写页留下的那一项。
 * 外观仍是各编辑区原来的标签：优化页是色块，生成预览是行内「 · 」。
 */
export function ResumeTagList(props: {
  items: string[]
  field: 'skill' | 'certificate'
  appearance: 'chip' | 'inline'
  readOnly?: boolean
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const addRef = useRef<HTMLInputElement>(null)
  const addLabel = props.field === 'skill' ? '技能' : '证书 / 资质'
  const chip = props.appearance === 'chip'
  const commit = (fromPlus: boolean) => {
    const text = draft.trim()
    if (!text) {
      if (fromPlus) addRef.current?.focus()
      return
    }
    props.onChange([...props.items, text])
    setDraft('')
  }
  const rowClass = chip
    ? 'inline-flex w-full max-w-full items-start gap-1 rounded-lg bg-primary-50 px-2.5 py-1 text-sm text-primary-700'
    : 'flex w-full max-w-full items-start'
  return (
    <div className={chip ? 'flex flex-wrap items-center gap-2' : undefined}>
      {props.items.map((item, index) => (
        <span key={`${props.field}-${index}`} className={rowClass}>
          {!chip && index > 0 ? ' · ' : null}
          {props.readOnly ? (
            <input
              className={chip ? 'min-h-12 min-w-0 flex-1 bg-transparent text-sm text-primary-700 outline-none' : 'qx-rg-title min-h-12 min-w-0 flex-1'}
              aria-label={`${addLabel} ${index + 1}`}
              data-entry-field={`${props.field}-${index}`}
              value={item}
              readOnly
            />
          ) : (
            <textarea
              rows={1}
              className={chip
                ? 'min-h-12 min-w-0 flex-1 resize-none bg-transparent text-sm text-primary-700 outline-none'
                : 'qx-rg-title min-h-12 min-w-0 flex-1 resize-none'}
              style={{ width: '16em', maxWidth: 'calc(100% - 3.5rem)', overflowWrap: 'anywhere' }}
              aria-label={`${addLabel} ${index + 1}`}
              data-entry-field={`${props.field}-${index}`}
              value={item}
              onChange={(event) => props.onChange(props.items.map((row, i) => i === index ? event.target.value : row))}
            />
          )}
          {props.readOnly ? null : (
            <button type="button" className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center" aria-label="删除该条" onClick={() => props.onChange(props.items.filter((_, i) => i !== index))}>
              <Trash2Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {props.readOnly ? null : (
        <span className={chip ? 'inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2.5 py-1 text-sm text-primary-700' : 'inline-flex items-center'}>
          {!chip && props.items.length > 0 ? ' · ' : null}
          <input
            ref={addRef}
            className={chip ? 'min-h-12 bg-transparent text-sm text-primary-700 outline-none' : 'qx-rg-title min-h-12'}
            style={{ width: `${Math.max(draft.length, 2)}em`, minWidth: '48px' }}
            aria-label={addLabel}
            data-entry-add={props.field}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commit(false)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              commit(false)
            }}
          />
          <button
            type="button"
            className="inline-flex min-h-12 min-w-12 items-center justify-center"
            aria-label={props.field === 'skill' ? '添加一项技能' : '添加一项证书'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => commit(true)}
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      )}
    </div>
  )
}

/** 项目名称、角色只读。栏名用填写页已有的「项目名称」「担任角色」。要改得回填写页。 */
export function ProjectTitleFields(props: {
  index: number
  name: string
  role: string
  className: string
  captionClassName?: string
  onFocus?: () => void
}) {
  const captionClass = props.captionClassName ?? 'block text-sm text-gray-500'
  const field = (id: string, caption: string, value: string) => (
    <div className="mt-1.5">
      <span className={captionClass}>{caption}</span>
      <span
        tabIndex={0}
        className={`${props.className} block`}
        data-entry-field={id}
        onFocus={props.onFocus}
      >
        {value}
      </span>
    </div>
  )
  return (
    <div>
      {field(`projects-${props.index}-name`, '项目名称', props.name)}
      {field(`projects-${props.index}-role`, '担任角色', props.role)}
    </div>
  )
}
