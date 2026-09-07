import { ChevronLeftIcon } from 'lucide-react'
import type { ResumeCompareDecision } from './resumeCompareModel'
import { ResumeCompareCustomEditor } from './ResumeCompareCustomEditor'
import { wordDiff } from './wordDiff'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightedAfter({ text, additions }: { text: string; additions: string[] }) {
  if (additions.length === 0) return <>{text}</>
  const tokens = [...additions].sort((a, b) => b.length - a.length)
  const parts = text.split(new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'g'))
  const additionsSet = new Set(additions)
  return <>{parts.map((part, index) => additionsSet.has(part) ? <mark key={`${part}-${index}`}>{part}</mark> : part)}</>
}

export function ResumeCompareCard(props: {
  item: { title: string; before: string; after: string; additions: string[] }
  index: number
  total: number
  decision?: ResumeCompareDecision
  confirmed: string[]
  customText: string
  isDemoResult: boolean
  onExit: () => void
  onConfirm: (addition: string, checked: boolean) => void
  onSaveCustom: (text: string) => void
  onPrevious?: () => void
}) {
  const confirmed = new Set(props.confirmed)
  return (
    <>
      <div className="qxc-progress" aria-label={`第 ${props.index + 1} / ${props.total} 条`}>
        <div>
          <p>第 <b>{props.index + 1}</b> / {props.total} 条</p>
          <span>{props.item.title}</span>
        </div>
        <div className="qxc-progress-actions">
          {props.onPrevious ? <button type="button" className="qxc-previous" onClick={props.onPrevious}><ChevronLeftIcon size={24} aria-hidden />上一条</button> : null}
          <button type="button" className="qxc-previous" onClick={props.onExit}>返回优化页</button>
        </div>
      </div>

      <article className="qx-card qxc-card" data-live="true" data-decision={props.decision ?? 'undecided'}>
        <div className="qxc-columns">
          <section>
            <p className="qxc-column-label">原文</p>
            <p className="qxc-copy">{props.item.before}</p>
            <span className="qxc-evidence">{props.isDemoResult ? '合成样本，不是你的原文' : '摘自本次简历原文'}</span>
          </section>
          <section>
            <p className="qxc-column-label">AI 改写</p>
            <p className="qxc-copy"><HighlightedAfter text={props.item.after} additions={props.item.additions} /></p>
            <span className="qxc-evidence">AI 生成，仅供本人核对</span>
          </section>
        </div>

        <section className="qxc-diff" aria-label="逐字差异">
          <p>逐字差异：删除内容带删除线，新增内容带下划线加粗。</p>
          <div className="qxc-diff-body">
            <p className="qxc-diff-text">
              {wordDiff(props.item.before, props.item.after).map((segment, index) => {
                const key = `${segment.type}-${index}`
                if (segment.type === 'del') return <del key={key}>{segment.text}</del>
                if (segment.type === 'ins') return <ins key={key}>{segment.text}</ins>
                return <span key={key}>{segment.text}</span>
              })}
            </p>
          </div>
        </section>

        <section className="qxc-facts" data-has-additions={props.item.additions.length > 0 ? 'true' : 'false'}>
          <h2>新增事实核对</h2>
          {props.item.additions.length === 0 ? (
            <p>机械对照未发现改写中新增的数字或职责词。这不代表已校验，仍需你核对全文。</p>
          ) : (
            <>
              <p>下列内容在改写中出现、但原文没有。未逐项确认时不能选“用改写”。</p>
              <div className="qxc-fact-list">
                {props.item.additions.map((addition) => (
                  <label key={addition}>
                    <input type="checkbox" checked={confirmed.has(addition)} onChange={(event) => props.onConfirm(addition, event.target.checked)} />
                    <span><mark>{addition}</mark>是我的真实信息</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </section>

        <ResumeCompareCustomEditor
          decision={props.decision}
          value={props.customText}
          seed={props.item.before}
          onSave={props.onSaveCustom}
        />
      </article>
    </>
  )
}
