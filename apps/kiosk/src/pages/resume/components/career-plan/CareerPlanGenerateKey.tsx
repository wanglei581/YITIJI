// 求职方案页底栏的「生成 / 重新生成」主键（稿 career）。
//
// 已知 AI 停用 —— 服务端明确回了能力级停用码（`ai/aiOutage.ts` 的 AI_OUTAGE_CODES：AI_PAUSED、未配置、预算用尽……），
// 这些码「配置恢复之前每一次都会失败」，重试不会变好：主键置灰、点了不发请求，原因写在底栏小字里（稿：AI 停时「生成求职方案」disabled），
// 不用 AI 的出路（打印求职参考单，里面没有方案正文）留在它旁边。
// 临时性错误（网络、超时、限流、上游 5xx）不进能力级码表，不会走到这里：主键照常可点，失败之后字改成「重试…」。
//
// 置灰一律 aria-disabled + onClick 自己短路（原生 disabled 会让读屏跳过、触屏读不到原因），aria-describedby 连着底栏小字。

import { ArrowRightIcon } from 'lucide-react'
import { CAREER_AI_DOWN_WHY_ID, careerGenerateLabel } from './careerPlanGenerateCopy'

export function CareerPlanGenerateKey({ hasPlan, generating, knownDown, retry, onGenerate }: {
  hasPlan: boolean
  generating: boolean
  /** 已知 AI 停用（页面的 aiOutage 有值）。 */
  knownDown: boolean
  /** 上一次生成撞上了临时性错误，这一下是重试。 */
  retry: boolean
  onGenerate: () => void
}) {
  return (
    <button
      type="button"
      className="qx-btn rdq-aria-btn"
      data-variant="primary"
      data-career-plan-generate={knownDown ? 'blocked' : 'open'}
      aria-disabled={generating || knownDown}
      aria-describedby={knownDown ? CAREER_AI_DOWN_WHY_ID : undefined}
      onClick={() => { if (!knownDown) onGenerate() }}
    >
      {generating ? null : <ArrowRightIcon size={22} aria-hidden="true" />}
      {careerGenerateLabel({ hasPlan, generating, retry })}
    </button>
  )
}
