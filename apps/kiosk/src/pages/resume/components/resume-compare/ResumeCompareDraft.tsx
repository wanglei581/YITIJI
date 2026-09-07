import type { ResumeCompareDecisions, ResumeCompareItem } from './resumeCompareModel'
import { decisionStats, draftTextFor, moduleKeyOf } from './resumeCompareModel'

export function ResumeCompareDraft(props: {
  items: ResumeCompareItem[]
  decisions: ResumeCompareDecisions
  confirmedByModule: Record<string, string[]>
  customByModule: Record<string, string>
}) {
  const stats = decisionStats(props.items, props.decisions)
  return (
    <details className="qx-card qxc-draft">
      <summary>裁决草稿</summary>
      <p>
        这是阅读草稿，不是简历最终稿；只有优化页编辑区的内容会进入导出。
      </p>
      <p className="qxc-draft-stats">
        已决定 {stats.decided}/{stats.total}
        {' · '}已采纳 {stats.adopt}
        {' · '}保留原文 {stats.keep}
        {' · '}自己写 {stats.custom}
        {' · '}待定 {stats.todo}
      </p>
      <ol>
        {props.items.map((item, index) => {
          const key = moduleKeyOf(item, index)
          const draft = draftTextFor(
            item,
            index,
            props.decisions,
            props.confirmedByModule[key] ?? [],
            props.customByModule[key],
          )
          return (
            <li key={key}>
              <b>{item.title || `第 ${index + 1} 条`} · {draft.label}</b>
              <span>{draft.text}</span>
              {draft.reason ? <em>{draft.reason}</em> : null}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
