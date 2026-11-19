import type { ReactNode } from 'react'
import type { PolicyPostView } from '../../services/api/policies'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { policyPublishedLabel } from './policyFacts'
import { policyKeywordMarks } from './policySearchModel'

function marked(text: string, keyword?: string): ReactNode {
  if (!keyword) return text
  return policyKeywordMarks(text, keyword).map((part, index) => part.hit
    ? <mark className="policy-kw" key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>)
}

/** 类别列表和搜索结果共用的一行。截止日期、类别、关键词都是有才写。搜索行不放办理签。 */
export function PolicyGuideRow({ policy, onOpen, highlight, categoryLabel, deadlineLabel, showHandling = true }: {
  policy: PolicyPostView
  onOpen: () => void
  highlight?: string
  categoryLabel?: string
  deadlineLabel?: string
  /** 列表放材料清单和原文签。搜索结果只留类别和截止，避免折行。 */
  showHandling?: boolean
}) {
  return <button type="button" className="policy-min-card qxt-rise" data-policy-id={policy.id} onClick={onOpen}>
    <b>{marked(policy.title, highlight)}</b>
    <span className="policy-min-summary">{marked(policy.summary || '发布机构没有提供摘要', highlight)}</span>
    <span className="policy-min-meta">
      <span className="policy-min-org"><QxTouchIcon name="landmark" size={22} />{policy.sourceName || '发布机构未提供'}</span>
      <span>更新于 {policyPublishedLabel(policy) ?? '日期未提供'}</span>
      {categoryLabel && <span className="policy-info-chip">{categoryLabel}</span>}
      {deadlineLabel && <span className="qxt-chip-clay policy-deadline">{deadlineLabel}</span>}
      {showHandling && policy.requiredMaterials?.trim() && <span className="policy-info-chip">有材料清单</span>}
      {showHandling && policy.externalUrlVerified === true && <span className="policy-info-chip">可扫码看原文</span>}
    </span>
  </button>
}
