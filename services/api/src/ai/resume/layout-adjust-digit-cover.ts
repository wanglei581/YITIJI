/**
 * 排版出站兜底：引擎没认出的长数字，按现实写法再遮一层。
 *
 * 检测前先把全角数字、全角 X 折成半角，占位符里存的仍是原文，还原才能逐字对上。
 * 数字段之间只隔一个空格、短横、点或零宽字符，且合计达到 11 位的，按一整串遮。
 * 年月日期轴不是号码，原样留下，排版还要看见时间。
 */
import { LLM_MASK_LONG_DIGIT_CATEGORY } from '../../common/pii/mask-placeholder'

export interface LayoutDigitBook {
  /** 同一段原文共用一个占位符，三段还原才对得上。 */
  issue(original: string): string
}

/** 段与段之间只认这一个字符。两个空格、空格加短横，都不把两边接成一串。 */
const SINGLE_SEPARATORS = new Set<string>([
  ' ',
  '\u00A0',
  '\u3000',
  '-',
  '\uFF0D',
  '.',
  '\uFF0E',
  '\u200B',
  '\u200C',
  '\u200D',
  '\uFEFF',
  '\u2060',
])

const DATE_AXIS = /^(?:19|20)\d{2}[.-](?:0[1-9]|1[0-2])(?:[.-](?:0[1-9]|[12]\d|3[01]))?(?:-(?:19|20)\d{2}[.-](?:0[1-9]|1[0-2])(?:[.-](?:0[1-9]|[12]\d|3[01]))?)*$/u

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

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

/** 年月用点或短横连起来的日期轴。破折号不在分隔符里，到不了这里。 */
function isDateAxis(foldedSpan: string): boolean {
  const normalized = foldedSpan.replace(/．/gu, '.').replace(/－/gu, '-')
  return DATE_AXIS.test(normalized)
}

/**
 * 把仍然露在外面的长数字换成可还原占位符。
 * 先折半角，长度不变，所以命中区间可以直接切回原文。
 */
export function coverRealisticNumbers(text: string, book: LayoutDigitBook): string {
  const folded = foldDigits(text)
  const spans: Array<[number, number]> = []
  let index = 0
  while (index < folded.length) {
    if (!isDigit(folded[index] ?? '')) {
      index += 1
      continue
    }
    const runStart = index
    let digits = 0
    while (index < folded.length && isDigit(folded[index] ?? '')) {
      while (index < folded.length && isDigit(folded[index] ?? '')) {
        digits += 1
        index += 1
      }
      const separator = folded[index]
      const next = folded[index + 1]
      if (separator && next && SINGLE_SEPARATORS.has(separator) && isDigit(next)) {
        index += 1
        continue
      }
      break
    }
    let end = index
    const tail = folded[end]
    if ((tail === 'X' || tail === 'x') && end > runStart && isDigit(folded[end - 1] ?? '')) end += 1
    let start = runStart
    const before = text[runStart - 1]
    const digitRun = folded.slice(runStart, end).replace(/\D/gu, '')
    if ((before === '+' || before === '＋') && digitRun.startsWith('86')) start -= 1
    if (digits >= 11 && !isDateAxis(folded.slice(runStart, end))) spans.push([start, end])
    index = Math.max(index, end)
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
