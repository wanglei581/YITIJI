// 自我探索 · 同意页的两种勾选块（稿 34 的 .consent-list / .cbox）。
//
// 与 SelfAssessmentQxKit.tsx 同一条分工：**本文件不放业务文案**，用户可见的中文都由
// SelfAssessmentFlow.tsx 传进来（那是合规扫描点名的文件）。条款与勾选框文字本身来自
// 题目接口下发，这里只负责排版和把链接原位嵌进句子。

import { useId, type ReactNode } from 'react'
import type { SelfAssessmentConsentLink } from '@ai-job-print/shared'
import { consentLabelSegments } from '../../selfAssessmentConsent'

/** 下发的条款原文，按下发顺序编号。 */
export function SaConsentList({ items }: { items: readonly string[] }) {
  return (
    <ol className="sa-consent" data-testid="self-assessment-consent-items">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}><em>{index + 1}</em><div>{item}</div></li>
      ))}
    </ol>
  )
}

/** 普通勾选块（整块是一个 84px 高的 checkbox 按钮）。 */
export function SaConsentBox({
  checked, label, note, testId, onToggle,
}: { checked: boolean; label: ReactNode; note?: string; testId: string; onToggle: () => void }) {
  return (
    <button type="button" className="sa-cbox" role="checkbox" aria-checked={checked} data-testid={testId} onClick={onToggle}>
      <span className="sa-box" aria-hidden="true">✓</span>
      <span>{label}{note ? <small>{note}</small> : null}</span>
    </button>
  )
}

/**
 * 句子里带链接的勾选块。按钮里不能再套一个可点的链接，所以拆成：
 * 左边的方框是真正的 checkbox 按钮（读屏读到整句作为名字），整行点哪里都能勾，
 * 只有链接那一段点了是去读隐私政策、不改勾选状态。
 */
export function SaConsentLinkedCheck({
  checked, label, links, testId, onToggle, onOpenLink,
}: {
  checked: boolean
  label: string
  links: readonly SelfAssessmentConsentLink[]
  testId: string
  onToggle: () => void
  onOpenLink: (link: SelfAssessmentConsentLink) => void
}) {
  const labelId = useId()
  return (
    <div className="sa-cbox" data-checked={checked ? 'true' : 'false'} onClick={onToggle}>
      <button type="button" className="sa-cbox-hit" role="checkbox" aria-checked={checked} aria-labelledby={labelId} data-testid={testId}>
        <span className="sa-box" aria-hidden="true">✓</span>
      </button>
      <span id={labelId} data-testid={`${testId}-label`}>
        {consentLabelSegments(label, links).map((segment, index) => segment.link ? (
          <button
            key={index}
            type="button"
            className="sa-cbox-link"
            data-testid="self-assessment-consent-link"
            onClick={(event) => { event.stopPropagation(); onOpenLink(segment.link as SelfAssessmentConsentLink) }}
          >
            {segment.text}
          </button>
        ) : <span key={index}>{segment.text}</span>)}
      </span>
    </div>
  )
}
