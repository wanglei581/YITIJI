import type { ReactNode } from 'react'
import type { PolicyPostView } from '../../services/api/policies'
import { policyPublishedLabel } from './policyFacts'
import { policyKeywordMarks } from './policySearchModel'

function marked(text: string, keyword?: string): ReactNode {
  if (!keyword) return text
  return policyKeywordMarks(text, keyword).map((part, index) => part.hit
    ? <mark className="policy-kw" key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>)
}

/** 类别列表和搜索结果共用的一行。截止日期、类别、关键词都是有才写。 */
export function PolicyGuideRow({ policy, onOpen, highlight, categoryLabel, deadlineLabel }: {
  policy: PolicyPostView
  onOpen: () => void
  highlight?: string
  categoryLabel?: string
  deadlineLabel?: string
}) {
  return <button type="button" className="policy-min-card qxt-rise" data-policy-id={policy.id} onClick={onOpen}>
    <b>{marked(policy.title, highlight)}</b>
    <span className="policy-min-summary">{marked(policy.summary || '发布机构没有提供摘要', highlight)}</span>
    <span className="policy-min-meta">
      <span>{policy.sourceName || '发布机构未提供'}</span>
      <span>更新于 {policyPublishedLabel(policy) ?? '日期未提供'}</span>
      {categoryLabel && <span className="policy-min-chip">{categoryLabel}</span>}
      {deadlineLabel && <span className="qxt-chip-clay policy-deadline">{deadlineLabel}</span>}
      {policy.requiredMaterials?.trim() && <span className="policy-min-chip">有材料清单</span>}
      {policy.externalUrlVerified === true && <span className="policy-min-chip">可扫码看原文</span>}
    </span>
  </button>
}
