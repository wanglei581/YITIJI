/**
 * 排版出站怎么把数字段接起来。
 *
 * 通用分隔符是空格、制表符、各种短横和点、零宽字符，括号里面可以再夹空格。
 * 斜线、换行、回车不进通用表，否则 2020/09 - 2024/06 会被收成占位符。
 * 它们只在分段对得上号码时才接：手机 3-4-4、身份证 6-8-4、
 * 银行卡每组 4 位、固话区号 3 到 4 位再加 7 到 8 位。
 * JSON 里的反斜杠加 n、r、t 也按分隔符读。
 */

/**
 * 段与段之间的分隔。可以连续出现，也可以和括号一起把一段包住。
 * 短横：- – — ‐ ‑ － ﹣。点：. · • ． ・。制表符含正文里的 U+0009，
 * 以及 JSON 字符串里写成反斜杠加 t 的那两个字符。
 */
const SEPARATOR_CHARS = new Set<string>([
  ' ',
  '\t',
  '\u00A0',
  '\u3000',
  '-',
  '\u2010',
  '\u2011',
  '\u2013',
  '\u2014',
  '\uFE63',
  '\uFF0D',
  '.',
  '\u00B7',
  '\u2022',
  '\u30FB',
  '\uFF0E',
  '\u200B',
  '\u200C',
  '\u200D',
  '\uFEFF',
  '\u2060',
])

/**
 * 斜线或换行两侧的数字段。对得上才遮，避免把年月区间收进去。
 * 银行卡常见 16 位四组，或 19 位再加最后 3 位。固话是区号加本地号。
 */
const STRUCTURED_GROUPS: ReadonlyArray<readonly number[]> = [
  [3, 4, 4],
  [6, 8, 4],
  [4, 4, 4, 4],
  [4, 4, 4, 4, 3],
  [3, 8],
  [3, 7],
  [4, 8],
  [4, 7],
]

export function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

/** 从第一位数字起，把隔着通用分隔符或括号的后续数字段一起读完。 */
export function readJoinedDigits(folded: string, start: number): { end: number; digits: number } {
  let index = start
  let digits = 0
  while (index < folded.length && isDigit(folded[index] ?? '')) {
    while (index < folded.length && isDigit(folded[index] ?? '')) {
      digits += 1
      index += 1
    }
    const nextDigit = bridgeToNextDigit(folded, index)
    if (nextDigit === null) break
    index = nextDigit
  }
  return { end: index, digits }
}

export function skipSeparators(folded: string, index: number): number {
  let cursor = index
  while (cursor < folded.length) {
    const length = separatorLength(folded, cursor)
    if (length === 0) break
    cursor += length
  }
  return cursor
}

export function extendCheckDigit(folded: string, end: number): number {
  const tail = folded[end] ?? ''
  if ((tail === 'X' || tail === 'x') && end > 0 && isDigit(folded[end - 1] ?? '')) return end + 1
  return end
}

export function numberSpanStart(text: string, folded: string, runStart: number, end: number): number {
  const before = text[runStart - 1] ?? ''
  const digitRun = folded.slice(runStart, end).replace(/\D/gu, '')
  if ((before === '+' || before === '＋') && digitRun.startsWith('86')) return runStart - 1
  if (before === '(' || before === '（') return runStart - 1
  return runStart
}

/** 从这一位数字起，找对得上分段规律、并且比通用分隔符接得更远的那一串。 */
export function matchStructuredNumber(folded: string, start: number): number | null {
  let best: number | null = null
  for (const groups of STRUCTURED_GROUPS) {
    const end = matchGroups(folded, start, groups)
    if (end !== null && (best === null || end > best)) best = end
  }
  const idTail = matchGroups(folded, start, [6, 8, 3])
  if (idTail !== null) {
    const tail = folded[idTail] ?? ''
    if ((tail === 'X' || tail === 'x') && (best === null || idTail + 1 > best)) best = idTail + 1
  }
  return best
}

function matchGroups(folded: string, start: number, groups: readonly number[]): number | null {
  let cursor = start
  for (let group = 0; group < groups.length; group += 1) {
    const size = groups[group] ?? 0
    if (!hasExactDigits(folded, cursor, size)) return null
    cursor += size
    if (group === groups.length - 1) break
    const next = bridgeStructured(folded, cursor)
    if (next === null) return null
    cursor = next
  }
  return cursor
}

function hasExactDigits(folded: string, index: number, count: number): boolean {
  for (let offset = 0; offset < count; offset += 1) {
    if (!isDigit(folded[index + offset] ?? '')) return false
  }
  return !isDigit(folded[index + count] ?? '')
}

function bridgeToNextDigit(folded: string, index: number): number | null {
  return bridgeAcross(folded, index, false)
}

function bridgeStructured(folded: string, index: number): number | null {
  return bridgeAcross(folded, index, true)
}

/** 括号里面可以夹空格。斜线、换行、回车只在 extended 时才算分隔。 */
function bridgeAcross(folded: string, index: number, extended: boolean): number | null {
  let cursor = index
  let saw = false
  let closed = false
  let opened = false
  while (cursor < folded.length) {
    const length = extended ? extendedSeparatorLength(folded, cursor) : separatorLength(folded, cursor)
    if (length > 0) {
      cursor += length
      saw = true
      continue
    }
    const char = folded[cursor] ?? ''
    if (!closed && (char === ')' || char === '）')) {
      cursor += 1
      closed = true
      saw = true
      continue
    }
    if (!opened && (char === '(' || char === '（')) {
      cursor += 1
      opened = true
      saw = true
      continue
    }
    break
  }
  if (!saw || !isDigit(folded[cursor] ?? '')) return null
  return cursor
}

function separatorLength(folded: string, index: number): number {
  const char = folded[index] ?? ''
  if (char === '\\' && folded[index + 1] === 't') return 2
  return SEPARATOR_CHARS.has(char) ? 1 : 0
}

function extendedSeparatorLength(folded: string, index: number): number {
  const basic = separatorLength(folded, index)
  if (basic > 0) return basic
  const char = folded[index] ?? ''
  if (char === '\\') {
    const next = folded[index + 1] ?? ''
    if (next === 'n' || next === 'r' || next === '/') return 2
  }
  if (char === '/' || char === '\n' || char === '\r') return 1
  return 0
}
