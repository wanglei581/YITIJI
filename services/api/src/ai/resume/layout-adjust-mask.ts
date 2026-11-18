/**
 * 排版调整出站：三段先完整遮盖，再把仍然连在一起的 11 位及以上数字换成可还原占位符，
 * 最后在不切开占位符、也不留下数字前缀的位置截断原文。
 * 任一段超过遮盖入口上限就明确失败，不把后半段静默截掉。
 *
 * 残留的长数字走兜底遮盖，不走失败关闭。合同断言会把简历里的日期轴误判成残留，
 * 这里若因 strict 为 false 就回 503，没有证件号的简历也会排不了版。
 * 兜底先把全角数字折成半角，再认连续数字。占位符里存原文，还原仍逐字对上。
 */
import { ServiceUnavailableException } from '@nestjs/common'
import { LLM_MASK_INPUT_LIMIT, maskUserTextsForLlmReversible } from '../../common/pii/llm-input-mask'
import { llmMaskPlaceholderPattern } from '../../common/pii/mask-placeholder'
import { coverRealisticNumbers, createLongDigitBook } from './layout-adjust-digit-cover'

export const AI_LAYOUT_ADJUST_TOO_LONG = 'AI_LAYOUT_ADJUST_TOO_LONG'
export const AI_LAYOUT_ADJUST_TOO_LONG_MESSAGE =
  '这份简历一次放不下。请先删短一些内容，再试一次；也可以直接按现在的版式导出。'

/**
 * 18 位证件号。末位可以是数字或 X。
 * 号后面紧贴数字，或号前面紧贴数字，遮盖规则的边界都对不上。
 */
const ID_BODY = String.raw`\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]`
const GLUED_ID_AFTER = new RegExp(`${ID_BODY}(?=\\d)`, 'g')
const GLUED_ID_BEFORE = new RegExp(`(?<=\\d)(?=${ID_BODY})`, 'g')
/** 11 位手机号紧贴后面的数字。只看证件号后面有没有数字，拆不开这种。 */
const GLUED_PHONE_AFTER = /(?<!\d)1[3-9]\d{9}(?=\d)/g

export function separateGluedIdNumbers(text: string, breakWith = '\n'): string {
  return text
    .replace(GLUED_ID_AFTER, (hit) => `${hit}${breakWith}`)
    .replace(GLUED_ID_BEFORE, breakWith)
    .replace(GLUED_PHONE_AFTER, (hit) => `${hit}${breakWith}`)
}

/**
 * 只作遮盖前的边界，出站前会删掉。
 * 不用换行：换行写进 JSON 再序列化是反斜杠加字母 n。
 * 实测第二段 18 位号仍会被遮住，但身份证规则的前边界认字母，类别落到银行卡。
 * 这个字符不是数字也不是字母，序列化后还在，两段按各自的号类遮。
 */
const GLUE_SENTINEL = '\uE000'

function separateGluedJsonStrings(json: string): string {
  if (!json) return json
  try {
    return JSON.stringify(mapJsonStrings(JSON.parse(json) as unknown))
  } catch {
    return separateGluedIdNumbers(json, GLUE_SENTINEL)
  }
}

function mapJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') return separateGluedIdNumbers(value, GLUE_SENTINEL)
  if (Array.isArray(value)) return value.map((item) => mapJsonStrings(item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = mapJsonStrings(item)
    }
    return out
  }
  return value
}

function stripGlue(text: string): string {
  return text.split(GLUE_SENTINEL).join('')
}

function withLongDigits(
  engineRestore: (value: string) => string,
  extra: ReadonlyMap<string, string>,
): (value: string) => string {
  if (extra.size === 0) return engineRestore
  return (value: string): string => {
    const restored = engineRestore(value)
    if (typeof restored !== 'string' || restored.length === 0) return restored
    return restored.replace(llmMaskPlaceholderPattern('gu'), (token) => extra.get(token) ?? token)
  }
}

function tooLong(): never {
  throw new ServiceUnavailableException({
    error: { code: AI_LAYOUT_ADJUST_TOO_LONG, message: AI_LAYOUT_ADJUST_TOO_LONG_MESSAGE },
  })
}

/** 截到 limit。切点落在占位符里就退到占位符前面；末尾剩下的数字整段丢掉。 */
export function cutMaskedLayoutText(text: string, limit: number): string {
  if (limit <= 0) return ''
  if (text.length <= limit) return text
  let cut = limit
  const re = llmMaskPlaceholderPattern('g')
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (end <= cut) continue
    if (start < cut) cut = start
    break
  }
  return text.slice(0, cut).replace(/\d+$/u, '')
}

export function maskLayoutAdjustOutbound(input: {
  originalText: string
  resumeValues: string
  resumeJson: string
  maxOriginalChars: number
}): {
  maskedOriginal: string
  maskedResumeValues: string
  maskedResumeJson: string
  restore: (value: string) => string
} {
  const originalText = separateGluedIdNumbers(input.originalText, GLUE_SENTINEL)
  const resumeValues = separateGluedIdNumbers(input.resumeValues, GLUE_SENTINEL)
  const resumeJson = separateGluedJsonStrings(input.resumeJson)
  if (
    originalText.length > LLM_MASK_INPUT_LIMIT
    || resumeValues.length > LLM_MASK_INPUT_LIMIT
    || resumeJson.length > LLM_MASK_INPUT_LIMIT
  ) {
    tooLong()
  }
  const masked = maskUserTextsForLlmReversible(
    [originalText, resumeValues, resumeJson],
    'resume_layout_adjust',
  )
  const extra = new Map<string, string>()
  const book = createLongDigitBook(extra, new Map())
  const cover = (text: string) => coverRealisticNumbers(stripGlue(text), book)
  const [maskedOriginal = '', maskedResumeValues = '', maskedResumeJson = ''] = masked.texts
  return {
    maskedOriginal: cutMaskedLayoutText(cover(maskedOriginal), input.maxOriginalChars),
    maskedResumeValues: cover(maskedResumeValues),
    maskedResumeJson: cover(maskedResumeJson),
    restore: withLongDigits(masked.restore, extra),
  }
}
