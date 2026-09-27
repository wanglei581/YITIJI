import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { rememberAssistantDraft } from '../../services/assistantDraft'

/**
 * 青序流光 2.0 每页底部的「问小青」（稿 `.qx2-ai`）：把本步的一句问题留给顾问页预填，
 * 再进顾问页；发不发由用户在顾问页决定。样式在 styles/qingxu/primitives.css。
 */
export function QxAiHelp({ label, draft, testId }: { label: string; draft: string; testId?: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="qx-ai-help"
      data-testid={testId}
      onClick={() => {
        rememberAssistantDraft(draft)
        navigate('/assistant')
      }}
    >
      {label}
    </button>
  )
}

/** 底部一排：左「上一步」，右放 QxAiHelp（稿 `.qx2-actions`）。没有上一步的页不传 onPrev。 */
export function QxStepActions({
  onPrev,
  prevLabel = '上一步',
  children,
}: {
  onPrev?: () => void
  prevLabel?: string
  children: ReactNode
}) {
  return (
    <div className="qx-step-actions">
      {onPrev ? (
        <button type="button" className="qx-step-prev" onClick={onPrev}>
          {prevLabel}
        </button>
      ) : null}
      {children}
    </div>
  )
}
