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

/** 只有同意是当前版本的记分才可以送进新的模型调用；否则返回空（这次不纳入）。 */
export function selfAssessmentDimensionsForNewAi<D>(hint: StoredSelfAssessmentAiHint<D>): D[] {
  if (hint.dimensions.length === 0) return []
  return isConsentCurrent(hint.consentVersion) ? [...hint.dimensions] : []
}
