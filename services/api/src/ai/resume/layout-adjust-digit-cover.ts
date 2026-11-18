/**
 * 排版出站兜底：引擎没认出的长数字，按现实写法再遮一层。
 *
 * 检测前先把全角数字、全角 X 折成半角，占位符里存的仍是原文，还原才能逐字对上。
 * 折完之后只认连续数字。分段、跨字段在后面的步骤里加，这里先不把分隔符吃进去。
 */
import { LLM_MASK_LONG_DIGIT_CATEGORY } from '../../common/pii/mask-placeholder'

export interface LayoutDigitBook {
  /** 同一段原文共用一个占位符，三段还原才对得上。 */
  issue(original: string): string
}

const CONTINUOUS_DIGITS = /\d{11,}[Xx]?/gu

export function foldDigits(text: string): string {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    const code = char.charCodeAt(0)
    if (code >= 0xff10 && code <= 0xff19) out += String.fromCharCode(code - 0xff10 + 0x30)
    else if (char === 'Ｘ' || char === 'ｘ') out += 'X'
    else out += char
  }
  return out
}

export function createLongDigitBook(
  extra: Map<string, string>,
  byValue: Map<string, string>,
): LayoutDigitBook {
  return {
    issue(original: string): string {
      const known = byValue.get(original)
      if (known) return known
      const token = `[${LLM_MASK_LONG_DIGIT_CATEGORY}_${extra.size + 1}]`
      extra.set(token, original)
      byValue.set(original, token)
      return token
    },
  }
}

/** 把仍然露在外面的长数字换成可还原占位符。索引按折半角后的字符串，长度不变。 */
export function coverRealisticNumbers(text: string, book: LayoutDigitBook): string {
  const folded = foldDigits(text)
  const spans: Array<[number, number]> = []
  for (const match of folded.matchAll(CONTINUOUS_DIGITS)) {
    const start = match.index ?? 0
    spans.push([start, start + match[0].length])
  }
  return replaceSpans(text, spans, book)
}

function replaceSpans(text: string, spans: ReadonlyArray<readonly [number, number]>, book: LayoutDigitBook): string {
  if (spans.length === 0) return text
  const pieces: string[] = []
  let cursor = 0
  for (const [start, end] of spans) {
    pieces.push(text.slice(cursor, start), book.issue(text.slice(start, end)))
    cursor = end
  }
  pieces.push(text.slice(cursor))
  return pieces.join('')
}
