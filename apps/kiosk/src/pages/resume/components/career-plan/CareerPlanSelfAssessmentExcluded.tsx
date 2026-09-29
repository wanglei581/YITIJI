import { CompassIcon } from 'lucide-react'
import type { CareerPlanResponse } from '@ai-job-print/shared'

/** 合规 9/29 定稿的原句，一字不改（服务端 #1119 的提交说明与 shared 类型注释同一句）。 */
export const CAREER_PLAN_SA_EXCLUDED_COPY = '你之前的自我探索结果因说明已更新，这次没有纳入；重新确认说明后可以纳入。'

/**
 * 职业规划「依据」旁的一行：之前的自我探索是在旧版说明下做的，这次没有送进模型。
 * 只在服务端明说 `consent_outdated` 时出现；null / 缺省一律不显示（不猜）。
 * 按钮沿用本页主操作的 qx-btn 幽灵样式，去自我探索同意页按新说明重新确认。
 */
export function CareerPlanSelfAssessmentExcluded({ excluded, onGo }: {
  excluded: CareerPlanResponse['selfAssessmentExcluded']
  onGo: () => void
}) {
  if (excluded !== 'consent_outdated') return null
  return (
    <div className="jfq-guard" role="note" data-testid="career-plan-sa-excluded" style={{ alignItems: 'center' }}>
      <CompassIcon size={20} aria-hidden="true" />
      <p style={{ flex: 1 }}>{CAREER_PLAN_SA_EXCLUDED_COPY}</p>
      <button type="button" className="qx-btn rdq-aria-btn" data-variant="ghost" data-testid="career-plan-sa-excluded-go" onClick={onGo}>
        去自我探索重新确认
      </button>
    </div>
  )
}
