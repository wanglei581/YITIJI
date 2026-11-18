/**
 * 排版出站兜底：引擎没认出的长数字，按现实写法再遮一层。
 *
 * 检测前先把全角数字、全角 X 折成半角，占位符里存的仍是原文，还原才能逐字对上。
 * 数字段之间只隔一个空格、短横、点或零宽字符，且合计达到 11 位的，按一整串遮。
 * 简历 JSON 再按字段对齐：相邻字符串值拼起来够 11 位的，各换成自己的占位符。
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
/** 纯数字的年、年月、年月日。两段这样的值接起来不是人写的号码。 */
const DATE_PIECE = /^(?:19|20)\d{2}(?:(?:0[1-9]|1[0-2])(?:(?:0[1-9]|[12]\d|3[01]))?)?$/u

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

/**
 * 取舍：顺着原文扫字符串值，不把整段 JSON 去掉标点再拼。
 * 去掉标点会把键名和不相邻的数字也接上，还原做不到逐字。
 * 键名跳过。带反斜杠转义的值、普通文字、日期轴都断开，不参与拼接。
 * 每一段都是纯数字的年、年月或年月日时不接。
 * 命中的每个字段换成自己的占位符，里面存该字段原文。
 */
export function coverAdjacentJsonValues(json: string, book: LayoutDigitBook): string {
  const literals = scanJsonStringLiterals(json)
  const spans: Array<[number, number]> = []
  let run: Array<(typeof literals)[number]> = []
  const flush = (): void => {
    if (run.length < 2) {
      run = []
      return
    }
    const pieces = run.map((literal) => foldDigits(json.slice(literal.innerStart, literal.innerEnd)))
    const total = pieces.reduce((sum, piece) => sum + countDigits(piece), 0)
    const allDates = pieces.every((piece) => DATE_PIECE.test(piece))
    if (total >= 11 && !allDates) {
      for (const literal of run) spans.push([literal.innerStart, literal.innerEnd])
    }
    run = []
  }
  for (const literal of literals) {
    if (literal.isKey) continue
    const inner = json.slice(literal.innerStart, literal.innerEnd)
    if (literal.hasEscape || !isJoinableNumber(inner)) {
      flush()
      continue
    }
    run.push(literal)
  }
  flush()
  return replaceSpans(json, spans, book)
}

function scanJsonStringLiterals(json: string): Array<{
  innerStart: number
  innerEnd: number
  hasEscape: boolean
  isKey: boolean
}> {
  const literals: Array<{ innerStart: number; innerEnd: number; hasEscape: boolean; isKey: boolean }> = []
  let index = 0
  while (index < json.length) {
    if (json[index] !== '"') {
      index += 1
      continue
    }
    const innerStart = index + 1
    index += 1
    let hasEscape = false
    let closed = false
    while (index < json.length) {
      const char = json[index] ?? ''
      if (char === '\\') {
        hasEscape = true
        index += 2
        continue
      }
      if (char === '"') {
        closed = true
        break
      }
      index += 1
    }
    if (!closed) break
    const innerEnd = index
    index += 1
    let look = index
    while (look < json.length && isJsonWhitespace(json[look] ?? '')) look += 1
    literals.push({ innerStart, innerEnd, hasEscape, isKey: json[look] === ':' })
  }
  return literals
}

function isJsonWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/** 整段都是数字，中间只隔一个允许的分隔符。日期轴留在外面，当断开用。 */
function isJoinableNumber(raw: string): boolean {
  if (raw.length === 0) return false
  const folded = foldDigits(raw)
  if (isDateAxis(folded)) return false
  let index = 0
  const digitsOnly = folded.replace(/\D/gu, '')
  if ((folded[0] === '+' || folded[0] === '＋') && digitsOnly.startsWith('86')) index = 1
  if (!isDigit(folded[index] ?? '')) return false
  while (index < folded.length) {
    if (isDigit(folded[index] ?? '')) {
      index += 1
      continue
    }
    const separator = folded[index] ?? ''
    const next = folded[index + 1] ?? ''
    if (SINGLE_SEPARATORS.has(separator) && isDigit(next)) {
      index += 1
      continue
    }
    if ((separator === 'X' || separator === 'x') && index === folded.length - 1) return true
    return false
  }
  return true
}

function countDigits(folded: string): number {
  let count = 0
  for (let index = 0; index < folded.length; index += 1) {
    if (isDigit(folded[index] ?? '')) count += 1
  }
  return count
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
