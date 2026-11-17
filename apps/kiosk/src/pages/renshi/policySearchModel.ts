import { PolicyKeywordTooLongError, type PublishedPoliciesResult } from '../../services/api/policies'
import { policyRead } from './policyModel'

/** 关键词字数与服务端 POLICY_KEYWORD_MAX_LENGTH 同一口径：去首尾空白后的字符串长度。 */
export const POLICY_KEYWORD_MAX_LENGTH = 30
/** 和 policyRead 同一个 8 秒。到点没回来就按没连上，不一直停在正在找。 */
export const POLICY_SEARCH_TIMEOUT_MS = 8_000

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

export function isPolicyKeywordTooLong(error: unknown): boolean {
  return error instanceof PolicyKeywordTooLongError
    || (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'POLICY_KEYWORD_TOO_LONG')
}

export type PolicySearchOutcome =
  | { status: 'idle' }
  | { status: 'too-long'; count: number; keyword: string }
  | { status: 'ready'; result: PublishedPoliciesResult; keyword: string }
  | { status: 'failed'; keyword: string }

/** 去掉首尾空白后是空的、或超过 30 字，都不发请求。400 超长不当成没连上。 */
export async function resolvePolicySearch(
  keyword: string,
  request: (word: string) => Promise<PublishedPoliciesResult>,
  timeoutMs = POLICY_SEARCH_TIMEOUT_MS,
): Promise<PolicySearchOutcome> {
  const word = keyword.trim()
  if (!word) return { status: 'idle' }
  if (word.length > POLICY_KEYWORD_MAX_LENGTH) return { status: 'too-long', count: word.length, keyword: word }
  try {
    const result = await policyRead(request(word), timeoutMs)
    return { status: 'ready', result, keyword: word }
  } catch (error) {
    if (isPolicyKeywordTooLong(error)) return { status: 'too-long', count: word.length, keyword: word }
    return { status: 'failed', keyword: word }
  }
}

/** 按字面切分，不把关键词当正则。标出的是文字节点，不插入原文里的标签。 */
export function policyKeywordMarks(text: string, keyword: string): Array<{ text: string; hit: boolean }> {
  const word = keyword.trim()
  if (!word) return [{ text, hit: false }]
  const parts: Array<{ text: string; hit: boolean }> = []
  let rest = text
  while (rest.length > 0) {
    const at = rest.indexOf(word)
    if (at < 0) {
      parts.push({ text: rest, hit: false })
      break
    }
    if (at > 0) parts.push({ text: rest.slice(0, at), hit: false })
    parts.push({ text: word, hit: true })
    rest = rest.slice(at + word.length)
  }
  return parts
}
