// 审计表 docs/reviews/2026-09-26-ai-label-copy-prompt-audit.md 第 83–95 行。
// 两句必须原样出现在每一段 system prompt 里。半截禁令（只点到年龄、性别）
// 要换成第二句，不能和它并存。

export const AI_SAFETY_NO_FABRICATION = '不得编造学历、工作经历或证书。'

export const AI_SAFETY_NO_DISCRIMINATION =
  '不得基于性别、年龄、婚育、民族、户籍、健康状况作出区别对待或暗示。'

/** 缺哪句补哪句。已经写过的不重复，避免和半截禁令换成完整句之后叠成两份。 */
export function withAiSafety(prompt: string): string {
  const base = prompt.trimEnd()
  const extra: string[] = []
  if (!base.includes(AI_SAFETY_NO_FABRICATION)) extra.push(AI_SAFETY_NO_FABRICATION)
  if (!base.includes(AI_SAFETY_NO_DISCRIMINATION)) extra.push(AI_SAFETY_NO_DISCRIMINATION)
  return extra.length === 0 ? base : `${base}\n${extra.join('\n')}`
}

/**
 * 固定追加，不看原文里有没有。
 * 后台或环境变量换掉的提示词删不掉这两句（审计表第 95 行）。
 */
export function appendAiSafetySentences(prompt: string): string {
  return `${prompt.trimEnd()}\n\n${AI_SAFETY_NO_FABRICATION}\n${AI_SAFETY_NO_DISCRIMINATION}`
}
