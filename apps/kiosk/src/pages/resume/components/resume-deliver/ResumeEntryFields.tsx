import { useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'

/**
 * 技能、证书沿用两处现成做法，不另起文案：
 * - 生成向导第 6 步把一项写成可改的文字（`ResumeGeneratePage` 技能 / 证书文本框）；
 * - 教育、经历、项目的「删除该条」是图标按钮（同页 `EntryList`），加一项用加号，不写新句子。
 * 外观仍是各编辑区原来的标签：优化页是色块，生成预览是行内「 · 」。
 */
export function ResumeTagList(props: {
  items: string[]
  field: 'skill' | 'certificate'
  appearance: 'chip' | 'inline'
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const addLabel = props.field === 'skill' ? '技能' : '证书 / 资质'
  const commit = () => {
    const text = draft.trim()
    if (!text) return
    props.onChange([...props.items, text])
    setDraft('')
  }
  const chip = props.appearance === 'chip'
  return (
    <div className={chip ? 'flex flex-wrap items-center gap-2' : undefined}>
      {props.items.map((item, index) => (
        <span
          key={`${props.field}-${index}`}
          className={chip
            ? 'inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2.5 py-1 text-sm text-primary-700'
            : 'inline-flex items-center'}
        >
          {!chip && index > 0 ? ' · ' : null}
          <input
            className={chip
              ? 'min-h-12 bg-transparent text-sm text-primary-700 outline-none'
              : 'qx-rg-title min-h-12'}
            style={{ width: `${Math.max(item.length, 2)}em` }}
            aria-label={`${addLabel} ${index + 1}`}
            data-entry-field={`${props.field}-${index}`}
            value={item}
            onChange={(event) => props.onChange(props.items.map((row, i) => i === index ? event.target.value : row))}
          />
          <button type="button" className="inline-flex min-h-12 min-w-12 items-center justify-center" aria-label="删除该条" onClick={() => props.onChange(props.items.filter((_, i) => i !== index))}>
            <Trash2Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      ))}
      <span className={chip ? 'inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2.5 py-1 text-sm text-primary-700' : 'inline-flex items-center'}>
        {!chip && props.items.length > 0 ? ' · ' : null}
        <input
          className={chip ? 'min-h-12 bg-transparent text-sm text-primary-700 outline-none' : 'qx-rg-title min-h-12'}
          style={{ width: `${Math.max(draft.length, 2)}em` }}
          aria-label={addLabel}
          data-entry-add={props.field}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            commit()
          }}
        />
        <PlusIcon className="h-4 w-4" aria-hidden="true" />
      </span>
    </div>
  )
}

/** 项目名称、角色做成和学校、公司一样的输入，不另加屏上标题。 */
export function ProjectTitleFields(props: {
  index: number
  name: string
  role: string
  className: string
  onName: (value: string) => void
  onRole: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className={props.className}
        aria-label={`第 ${props.index + 1} 条项目名`}
        data-entry-field={`projects-${props.index}-name`}
        value={props.name}
        onChange={(event) => props.onName(event.target.value)}
      />
      <span aria-hidden="true">·</span>
      <input
        className={props.className}
        aria-label={`第 ${props.index + 1} 条项目角色`}
        data-entry-field={`projects-${props.index}-role`}
        value={props.role}
        onChange={(event) => props.onRole(event.target.value)}
      />
    </div>
  )
}
