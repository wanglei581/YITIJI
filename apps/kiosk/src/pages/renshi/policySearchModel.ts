/** 关键词字数与服务端 POLICY_KEYWORD_MAX_LENGTH 同一口径：去首尾空白后的字符串长度。 */
export const POLICY_KEYWORD_MAX_LENGTH = 30

/**
 * 拼音还在候选栏里时，输入框的 value 带了未选的字母。
 * 这段接在已提交文字后面时，不计入字数。
 */
export function committedKeyword(value: string, composition = ''): string {
  if (composition && value.endsWith(composition)) return value.slice(0, -composition.length)
  return value
}

export function policyKeywordCount(value: string, composition = ''): number {
  return committedKeyword(value, composition).trim().length
}
