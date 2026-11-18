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
 * 18 位证件号紧贴着下一个数字时，两侧都是数字，遮盖规则认不出。
 * 只在号和后面的数字之间插入换行，让下一号能单独被认出来。
 */
const GLUED_ID = /\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?=\d)/g

export function separateGluedIdNumbers(text: string): string {
  return text.replace(GLUED_ID, (hit) => `${hit}\n`)
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
  const resumeJson = input.resumeJson
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
