/**
 * 遮盖引擎实际写出的占位符类别。形态是 `[类别_序号]`。
 * 还原、截断都用这一份，再加上下面的长数字。护照、微信号、QQ 号不在这里：当前遮盖函数不会产出它们。
 */
export const LLM_MASK_PLACEHOLDER_CATEGORIES = [
  '劳动者',
  '用人单位',
  '身份证',
  '手机号',
  '银行卡',
  '邮箱',
  '详细地址',
  '统一社会信用代码',
] as const

export type LlmMaskPlaceholderCategory = (typeof LLM_MASK_PLACEHOLDER_CATEGORIES)[number]

/**
 * 排版出站兜底才写这一类：拆分规则没认出的 11 位及以上连续数字。
 * 引擎不会产出。种类对齐仍只数上面八类。
 */
export const LLM_MASK_LONG_DIGIT_CATEGORY = '长数字'

/** captureCategory 为 true 时，第 1 组是类别名。给粘着匹配用。 */
export function llmMaskPlaceholderPattern(flags = 'g', captureCategory = false): RegExp {
  const inner = [...LLM_MASK_PLACEHOLDER_CATEGORIES, LLM_MASK_LONG_DIGIT_CATEGORY].join('|')
  const group = captureCategory ? `(${inner})` : `(?:${inner})`
  return new RegExp(`\\[${group}_\\d+\\]`, flags)
}
