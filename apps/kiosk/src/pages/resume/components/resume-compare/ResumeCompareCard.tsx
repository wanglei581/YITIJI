import type { ReactNode } from 'react'
import { AI_LABEL_COPY } from '@ai-job-print/shared'
import type { ResumeCompareDecision } from './resumeCompareModel'
import { detectUnconfirmedTextAdditions } from '../resume-deliver/facts'
import { wordDiff } from './wordDiff'

/**
 * 逐条对照的一张卡（稿 compare）：顶上一行「上一条 + 图例」，左原文右改写（逐字差异），字数，
 * 新增事实要逐项勾「是我的真实信息」后才能用改写。选择与批量在页面里，这里只管这一条的内容。
 */
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
  onPrevious?: () => void
  /** 顶上一行与左右两栏之间要放的东西（统计、批量、提示）。 */
  intro?: ReactNode
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
  const deleted = diff.filter((part) => part.type === 'del').reduce((n, part) => n + part.text.length, 0)
  const added = diff.filter((part) => part.type === 'ins').reduce((n, part) => n + part.text.length, 0)
  return (
    <>
      <div className="qxt-cmptop" aria-label={`第 ${props.index + 1} / ${props.total} 条`}>
        {props.onPrevious
          ? <button type="button" className="qxt-prev" onClick={props.onPrevious}>上一条</button>
          : <button type="button" className="qxt-prev" onClick={props.onExit}>返回优化页</button>}
        <div className="qxt-legend" aria-label="对照图例"><span><del>删掉</del> 删除</span><span><ins>加上</ins> 新增</span><span data-replacement="true">换写法</span><span>普通文字 保留</span></div>
      </div>
      {props.intro}
      <div className="qxt-cols" aria-label="逐字差异" data-decision={props.decision ?? 'undecided'}>
        <section className="qxt-col">
          <b>{props.decision === 'custom' ? '优化前 · 原文' : '原文'}</b>
          <p>{renderSide('before')}</p>
          <small>{props.isDemoResult ? '合成样本，不是你的原文' : '摘自本次简历原文'}</small>
        </section>
        <section className="qxt-col qxt-diff">
          <b>{props.decision === 'custom' ? '你写的这版' : '改写'}</b>
          <p>{renderSide('after')}</p>
          <small>{props.decision === 'custom' ? '本人撰写' : AI_LABEL_COPY.RESUME_OPTIMIZE}</small>
        </section>
      </div>
      <p className="qxt-metrics">字数 {props.item.before.length} → {shown.length} · 删除 {deleted} 字 · 新增 {added} 字</p>
      <section className="qxt-facts" data-has-additions={additions.length > 0 ? 'true' : 'false'} aria-label="新增事实核对">
        {additions.length === 0 ? (
          <p>机械对照未发现改写中新增的数字或职责词。这不代表已校验，仍需你核对全文。</p>
        ) : (
          <>
            <p>下列内容在改写中出现、但原文没有。未逐项确认时不能选「用改写」。</p>
            {additions.map((addition) => (
              <label key={addition} className="qxt-fact">
                <input type="checkbox" checked={confirmed.has(addition)} onChange={(event) => props.onConfirm(addition, event.target.checked)} />
                <span><mark>{addition}</mark>是我的真实信息</span>
              </label>
            ))}
          </>
        )}
      </section>
    </>
  )
}
