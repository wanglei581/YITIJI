// ============================================================
// 已存自我探索记分再送进新的模型调用之前，核对同意是否仍是当前版本。
//
// 合规窗口 9/29 裁定：凭旧版本同意，不得把已存结果用于新的 AI 生成。
// 这里的做法是「不带上」而不是「整单拒绝」：职业规划照常生成，只是这次不纳入自我探索记分
// （basedOn.selfAssessment 如实为 null）。理由：职业规划是核心功能，不能因为一份附带参考过期
// 就整单不可用；旧同意本就不授权新的处理，不带上即满足要求。用户按当前说明重新做一次自我探索后，
// 下一次规划自然会纳入。
//
// 不放进 self-assessment.service.ts：那个文件已超过 500 行，而且查看、撤回、
// 打印不走这道判定。不放进 career-plan.service.ts：这是同意口径，不是规划排版。
// ============================================================

import { isConsentCurrent } from './self-assessment.service'

export interface StoredSelfAssessmentAiHint<D> {
  dimensions: ReadonlyArray<D>
  consentVersion: string | null
}

/** 没纳入自我探索的原因。null = 纳入了，或本来就没有可用记分。 */
export type SelfAssessmentExclusion = 'consent_outdated' | null

/**
 * 只有同意是当前版本的记分才可以送进新的模型调用；否则这次不纳入，并如实给出原因
 * （合规 9/29：不许悄悄降级，前端据此提示「重新确认说明后可以纳入」）。
 */
export function selfAssessmentForNewAi<D>(hint: StoredSelfAssessmentAiHint<D>): { dimensions: D[]; excluded: SelfAssessmentExclusion } {
  if (hint.dimensions.length === 0) return { dimensions: [], excluded: null }
  if (isConsentCurrent(hint.consentVersion)) return { dimensions: [...hint.dimensions], excluded: null }
  return { dimensions: [], excluded: 'consent_outdated' }
}
