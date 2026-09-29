import { ChevronLeftIcon } from 'lucide-react'
import { AI_LABEL_COPY } from '@ai-job-print/shared'
import type { ResumeCompareDecision } from './resumeCompareModel'
import { ResumeCompareCustomEditor } from './ResumeCompareCustomEditor'
import { detectUnconfirmedTextAdditions } from '../resume-deliver/facts'
import { wordDiff } from './wordDiff'

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
  const shown = props.decision === 'custom' && props.customText ? props.customText : props.item.after
  const diff = wordDiff(props.item.before, shown)
  const additions = [...new Set([...props.item.additions, ...detectUnconfirmedTextAdditions(shown, props.item.before)])]
  const renderSide = (side: 'before' | 'after') => diff.map((part, index) => {
    if (side === 'before' && part.type === 'ins') return null
    if (side === 'after' && part.type === 'del') return null
    const replacement = (part.type === 'del' && diff[index + 1]?.type === 'ins') || (part.type === 'ins' && diff[index - 1]?.type === 'del')
    if (part.type === 'del') return <del key={index} data-replacement={replacement || undefined}>{part.text}</del>
    if (part.type === 'ins') return <ins key={index} data-replacement={replacement || undefined}>{part.text}</ins>
    return <span key={index}>{part.text}</span>
  })
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
        <div className="qxc-columns qxc-diff" aria-label="逐字差异">
          <section>
            <p className="qxc-column-label">优化前 · 原文</p>
            <p className="qxc-copy qxc-diff-text">{renderSide('before')}</p>
            <span className="qxc-evidence">{props.isDemoResult ? '合成样本，不是你的原文' : '摘自本次简历原文'}</span>
          </section>
          <section>
            <p className="qxc-column-label">{props.decision === 'custom' ? '优化后 · 你写的这版' : '优化后 · 建议改写'}</p>
            <p className="qxc-copy qxc-diff-text">{renderSide('after')}</p>
            <span className="qxc-evidence">{props.decision === 'custom' ? '本人撰写' : AI_LABEL_COPY.RESUME_OPTIMIZE}</span>
          </section>
        </div>

        <div className="qxc-legend" aria-label="对照图例"><span><del>删掉</del> 删除</span><span><ins>加上</ins> 新增</span><span data-replacement="true">换写法</span><span>普通文字 保留</span></div>
        <div className="qxc-metrics"><span>字数 {props.item.before.length} → {shown.length}</span><span>删除 {diff.filter((part) => part.type === 'del').reduce((n, part) => n + part.text.length, 0)} 字 · 新增 {diff.filter((part) => part.type === 'ins').reduce((n, part) => n + part.text.length, 0)} 字</span></div>

        <section className="qxc-facts" data-has-additions={additions.length > 0 ? 'true' : 'false'}>
          <h2>新增事实核对</h2>
          {additions.length === 0 ? (
            <p>机械对照未发现改写中新增的数字或职责词。这不代表已校验，仍需你核对全文。</p>
          ) : (
            <>
              <p>下列内容在改写中出现、但原文没有。未逐项确认时不能选“用改写”。</p>
              <div className="qxc-fact-list">
                {additions.map((addition) => (
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
