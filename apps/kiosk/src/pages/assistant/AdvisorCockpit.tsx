// ============================================================
// AdvisorCockpit — 小青页的 AI 身份说明（AIGC 可见标识 + 「不是真人」）
//
// 触屏版把座舱标题、状态读数都交给顶部意图带（标题、说明、状态胶囊取自 COCKPIT_COPY，
// 只复述真实信号），这里只留每页必须常驻的两句：AIGC 标识，以及小青是 AI 顾问、不是真人。
// 不发请求、不持有会话状态。
// ============================================================

import { AigcMark } from '../../ai'
import type { CockpitState } from './advisorScenes'

export function AdvisorCockpit({ state }: { state: CockpitState }) {
  return (
    <div className="assistant-disclosure" data-cockpit-state={state}>
      {/* AIGC 可见标识：每页恰好一次（interface-handoff.md §3），常驻不藏弹窗。 */}
      <AigcMark />
      <p className="assistant-advisor-disclosure">
        小青是 AI 顾问，<b>不是真人在跟你说话</b>
      </p>
    </div>
  )
}
