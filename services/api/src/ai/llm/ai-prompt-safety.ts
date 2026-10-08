// 审计表 docs/reviews/2026-09-26-ai-label-copy-prompt-audit.md 第 83–95 行。
// 两句必须原样出现在每一段 system prompt 里。半截禁令（只点到年龄、性别）
// 要换成第二句，不能和它并存。

import { AI_SAFETY_REFUSAL_INSTRUCTION } from '../safety/refusal'
import { AI_POLICY_ANSWER_CONSTRAINT, AI_POLICY_ANSWER_CONSTRAINT_VOICE } from '../safety/policy-constraint'

export interface AiSafetyOptions { policyVariant?: 'text' | 'voice' }

function policyConstraint(options: AiSafetyOptions): string {
  return options.policyVariant === 'voice' ? AI_POLICY_ANSWER_CONSTRAINT_VOICE : AI_POLICY_ANSWER_CONSTRAINT
}

/** 公共层反复套用或配置复用文字稿时，只保留当前渠道的完整政策约束一次。 */
function withPolicyConstraint(prompt: string, options: AiSafetyOptions): string {
  const base = prompt.replaceAll(AI_POLICY_ANSWER_CONSTRAINT, '')
    .replaceAll(AI_POLICY_ANSWER_CONSTRAINT_VOICE, '').trimEnd()
  return `${base}\n${policyConstraint(options)}`
}

export const AI_SAFETY_NO_FABRICATION = '不得编造学历、工作经历或证书。'

export const AI_SAFETY_NO_DISCRIMINATION =
  '不得基于性别、年龄、婚育、民族、户籍、健康状况作出区别对待或暗示。'

/** 缺哪句补哪句。已经写过的不重复，避免和半截禁令换成完整句之后叠成两份。 */
export function withAiSafety(prompt: string, options: AiSafetyOptions = {}): string {
  const base = prompt.trimEnd()
  const extra: string[] = []
  if (!base.includes(AI_SAFETY_NO_FABRICATION)) extra.push(AI_SAFETY_NO_FABRICATION)
  if (!base.includes(AI_SAFETY_NO_DISCRIMINATION)) extra.push(AI_SAFETY_NO_DISCRIMINATION)
  if (!base.includes(AI_SAFETY_REFUSAL_INSTRUCTION)) extra.push(AI_SAFETY_REFUSAL_INSTRUCTION)
  return withPolicyConstraint(extra.length === 0 ? base : `${base}\n${extra.join('\n')}`, options)
}

/**
 * 固定追加，不看原文里有没有。
 * 后台或环境变量换掉的提示词删不掉这两句（审计表第 95 行）。
 * 政策约束按渠道选全文，并单独去重；其余安全句保持原追加行为。
 */
export function appendAiSafetySentences(prompt: string, options: AiSafetyOptions = {}): string {
  const base = `${prompt.trimEnd()}\n\n${AI_SAFETY_NO_FABRICATION}\n${AI_SAFETY_NO_DISCRIMINATION}\n${AI_SAFETY_REFUSAL_INSTRUCTION}`
  return withPolicyConstraint(base, options)
}
