import { EyeIcon, MessageCircleIcon } from 'lucide-react'
import { QxAiHelp } from '../../components/qingxu/QxAiHelp'

/** 稿 48：一行原因、置灰的小青控件与自己核对入口（稿上叫人工核对）；通用办事指引不使用它。 */
export function PolicyAiFallback({ unavailable, aiLabel, aiDraft, policyId, onManual }: {
  unavailable: boolean
  aiLabel: string
  aiDraft: string
  policyId: string
  onManual: () => void
}) {
  const reasonId = `rq-ai-why-${policyId}`
  return (
    <div className="rq-ai-fallback">
      <p className="rq-why" id={reasonId}>
        {unavailable
          ? '小青暂时不可用。看原文、筛选、扫码与条件核对都不经过它，可以继续用。'
          : '小青暂不解释政策，也不判断你能不能办；请看原文或向经办窗口核对。'}
      </p>
      <div className="rq-strip">
        <div className="rq-exit rq-ai-off" aria-disabled="true" aria-describedby={reasonId}>
          <MessageCircleIcon aria-hidden="true" />
          <div>
            <b>{unavailable ? '小青暂时不可用' : '本条政策暂未接入小青'}</b>
            <small>{unavailable ? '这一页其余功能照常' : '小青还不能解释政策原文'}</small>
            {/* 问别的问题仍可用，不继承政策解释控件的置灰。 */}
            <div aria-disabled="false">
              <QxAiHelp label={aiLabel} draft={aiDraft} testId="renshi-ask-ai" />
            </div>
          </div>
        </div>
        <button type="button" className="rq-exit" data-testid="renshi-policy-manual-source" onClick={onManual}>
          <EyeIcon aria-hidden="true" />
          {/* 10/8 产品负责人批准的文字偏离：稿上是『不经过模型的人工核对』，不要照稿改回去。
              合规提醒：「不经过 AI」必须一直属实。这个入口点开的视图以后哪一项接了小青或模型，这句和 RenshiPage 里另外两句「不经过 AI」要同步改；
              fusion-w4「政策库条目有自己核对入口，点开后不出现小青块」守着这一视图期间 0 条 AI 请求。 */}
          <span><b>自己看原文与来源</b><small>不经过 AI，自己对照</small></span>
        </button>
      </div>
    </div>
  )
}
