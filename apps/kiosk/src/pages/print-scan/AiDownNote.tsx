import { useXiaoqingAvailability } from './useXiaoqingAvailability'

/**
 * 本包每一屏正文最上面的 AI 状态：小青确实接不上时写一句实话，并说明这一步不靠它也能做完。
 * 底栏的「问小青」不在这里动 —— 它仍可点，点过去由问小青页自己按能力降级。
 */
export function AiDownNote() {
  if (useXiaoqingAvailability() !== 'unavailable') return null
  return (
    <p className="sx-ai-note" role="status" data-testid="ai-down-note">
      小青暂时接不上。这一步不用它也能做完，照下面的按钮继续。
    </p>
  )
}
