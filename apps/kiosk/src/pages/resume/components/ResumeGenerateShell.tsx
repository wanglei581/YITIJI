import type { ReactNode } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { QxAiHelp } from '../../../components/qingxu/QxAiHelp'
import { helpNeededLine } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { STEPS } from './resumeGenerateModel'

export function GenerateProgress({ step }: { step: number }) {
  return (
    <ol className="qx-rg-prog" aria-label={`填写进度：第 ${step + 1} 步，共 4 步`}>
      {STEPS.map((item, index) => {
        const mark = index < step ? 'done' : index === step ? 'now' : undefined
        return (
          <li key={item.title} data-on={mark} aria-current={mark === 'now' ? 'step' : undefined}>
            <u aria-hidden="true" />
            {index + 1} {item.title}
          </li>
        )
      })}
    </ol>
  )
}

export function GenerateStepHeading({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="qx-rd-heading">
      <span className="qx-rg-step-ic" aria-hidden="true">{icon}</span>
      <b>{title}</b>
      {hint ? <span className="qx-rg-hint">{hint}</span> : null}
    </div>
  )
}

/** 帮助条上的求助句。号码和服务时间从公示联系方式来。 */
export function ResumeGenerateHelpLine() {
  return (
    <span className="qx-rg-helpline" data-testid="resume-generate-help-line">
      {helpNeededLine(useSupportContact())}
    </span>
  )
}

export function GenerateHelper({ text, draft }: { text: string; draft: string }) {
  return (
    <div className="qx-rg-helper">
      <span>
        {text}
        <ResumeGenerateHelpLine />
      </span>
      <QxAiHelp label="问小青" draft={draft} testId="resume-generate-step-help" />
    </div>
  )
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="qx-rd-label">
      <span>
        {label}
        {required ? <em className="qx-rg-req">必填</em> : null}
      </span>
      {children}
    </label>
  )
}

export function ChipRow(props: {
  title: string
  options: readonly string[]
  current: string
  multi?: boolean
  testId: string
  onToggle: (chip: string) => void
  onOther?: () => void
}) {
  const selected = props.multi
    ? new Set(props.current.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean))
    : null
  return (
    <div className="qx-rg-chipblock">
      <div className="qx-rg-chiphead">
        点一下就填进去 · <b>{props.title}</b>
        <span>{props.multi ? '可以多选，再点一次取消' : '点第二次取消'}</span>
      </div>
      <div className="qx-rg-chips" role="group" aria-label={`${props.title}候选`}>
        {props.options.map((option) => {
          const on = selected ? selected.has(option) : props.current.trim() === option
          return (
            <button
              key={option}
              type="button"
              className="qx-rg-chip"
              aria-pressed={on}
              data-testid={`${props.testId}-${option}`}
              aria-label={`${props.title}候选：${option}`}
              onClick={() => props.onToggle(option)}
            >
              {option}
            </button>
          )
        })}
        {props.onOther ? (
          <button
            type="button"
            className="qx-rg-chip"
            aria-pressed={false}
            data-testid={`${props.testId}-other`}
            aria-label={`${props.title}候选：其他`}
            onClick={props.onOther}
          >
            其他
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function EntryList<T>({
  items,
  onAdd,
  onRemove,
  addLabel,
  maxItems,
  empty,
  renderItem,
}: {
  items: T[]
  onAdd: () => void
  onRemove: (index: number) => void
  addLabel: string
  maxItems: number
  empty: ReactNode
  renderItem: (item: T, index: number) => ReactNode
}) {
  return (
    <div className="qx-rg-vlist">
      {items.length === 0 ? empty : null}
      {items.map((item, index) => (
        <div key={index} className="qx-card qx-rd-entry">
          <button type="button" onClick={() => onRemove(index)} className="qx-rd-remove" aria-label={`删除第 ${index + 1} 条`}>
            <Trash2Icon className="h-5 w-5" />
          </button>
          <div className="qx-rg-entry-body">{renderItem(item, index)}</div>
        </div>
      ))}
      {items.length < maxItems ? (
        <button type="button" onClick={onAdd} className="qx-rd-add">
          <PlusIcon className="h-5 w-5" />
          {addLabel}
        </button>
      ) : (
        <p className="qx-rd-empty">已经到上限，最多 {maxItems} 段。想加新的，先删掉一段旧的。</p>
      )}
    </div>
  )
}

export function MiniPair({ left, right }: { left: { title: string; body: ReactNode }; right: { title: string; body: ReactNode } }) {
  return (
    <div className="qx-rd-notes">
      <div className="qx-card"><b>{left.title}</b><p>{left.body}</p></div>
      <div className="qx-card"><b>{right.title}</b><p>{right.body}</p></div>
    </div>
  )
}
