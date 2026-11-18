/**
 * 排版调整出站：三段先完整遮盖，再在不切开占位符、也不留下数字前缀的位置截断原文。
 * 任一段超过遮盖入口上限就明确失败，不把后半段静默截掉。
 */
import { ServiceUnavailableException } from '@nestjs/common'
import { LLM_MASK_INPUT_LIMIT, maskUserTextsForLlmReversible } from '../../common/pii/llm-input-mask'

export const AI_LAYOUT_ADJUST_TOO_LONG = 'AI_LAYOUT_ADJUST_TOO_LONG'
export const AI_LAYOUT_ADJUST_TOO_LONG_MESSAGE =
  '这份简历一次放不下。请先删短一些内容，再试一次；也可以直接按现在的版式导出。'

const PLACEHOLDER = /\[(?:劳动者|用人单位|身份证|手机号|银行卡|邮箱|详细地址|统一社会信用代码)_\d+\]/g

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

const JSON_GLUE_BREAK = '|'

function separateGluedJsonStrings(json: string): string {
  if (!json) return json
  try {
    return JSON.stringify(mapJsonStrings(JSON.parse(json) as unknown))
  } catch {
    return separateGluedIdNumbers(json, JSON_GLUE_BREAK)
  }
}

function mapJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') return separateGluedIdNumbers(value, JSON_GLUE_BREAK)
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
  const re = new RegExp(PLACEHOLDER.source, 'g')
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
  const originalText = separateGluedIdNumbers(input.originalText)
  const resumeValues = separateGluedIdNumbers(input.resumeValues)
  // 换行写进 JSON 字符串再序列化会变成 \n，字母 n 贴着下一号，遮盖规则仍认不出。
  // 字符串值里改用竖线，序列化后还是非数字边界。
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
  const [maskedOriginal = '', maskedResumeValues = '', maskedResumeJson = ''] = masked.texts
  return {
    maskedOriginal: cutMaskedLayoutText(maskedOriginal, input.maxOriginalChars),
    maskedResumeValues,
    maskedResumeJson,
    restore: masked.restore,
  }
}
