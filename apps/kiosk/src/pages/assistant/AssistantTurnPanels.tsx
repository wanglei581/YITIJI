import type { ReactNode } from 'react'
import { K } from '../public-touch/PublicBlocks'
import { IllusChecklist, IllusResume } from '../public-touch/PublicIllus'
import { AdvisorThinking } from './AdvisorConversation'

/** 回答之后的操作与等待卡，保留顾问页既有版式。 */
export function AssistantTurnActions({ body, summary, onAsk, onRetry, onReset, onComplaint }: {
  body: string; summary: ReactNode
  onAsk: () => void; onRetry: () => void; onReset: () => void; onComplaint: () => void
}) {
  return (
    <div className="assistant-task-actions" data-cols="3" role="group" aria-label="这一轮之后可以做什么">
      {body === 'reply' ? <>
        {summary}
        <button type="button" className="assistant-direct-question assistant-turn-action" onClick={onAsk}>
          <strong>再问一句</strong>
        </button>
      </> : <>
        <button type="button" className="assistant-direct-question assistant-turn-action" data-primary="true" onClick={onRetry}>
          <strong>重试这一轮</strong>
        </button>
        <button type="button" className="assistant-direct-question assistant-turn-action" onClick={onReset}>
          <strong>换个问题</strong>
        </button>
      </>}
      <button type="button" className="assistant-complaint" onClick={onComplaint}>
        <strong>投诉 AI 内容</strong>
      </button>
    </div>
  )
}

export function AssistantWaitingCards({ status }: { status: ReactNode }) {
  return (
    <div className="qxp-pair assistant-wait-pair">
      <div className="qxp-card assistant-wait-card">
        <AdvisorThinking />
        {status}
        <div className="qxp-artbox" aria-hidden="true"><IllusResume w={200} annot /></div>
      </div>
      <div className="qxp-card assistant-wait-card">
        <K as="h3">不由 AI 决定</K>
        <p className="qxp-note">身份、付款、打印、政策资格和录用结果都不由这一轮回答决定。</p>
        <div className="qxp-artbox" aria-hidden="true"><IllusChecklist w={200} /></div>
      </div>
    </div>
  )
}
