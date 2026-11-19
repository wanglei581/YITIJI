/**
 * 排版出站怎么把数字段接起来。
 *
 * 通用分隔符是空格、制表符、各种短横和点、零宽字符，括号里面可以再夹空格。
 * 斜线、全角斜线、真实换行和回车不进通用表，否则年月区间会被收成占位符。
 * 扩展分隔（半角斜线、全角斜线、换行、回车，以及 JSON 里的反斜杠加 n、r、t、斜线）
 * 把数字切成段时，每段 1 到 10 位、合起来 11 位及以上，就按一个号码读完。
 * 和通用分隔混在同一串里也成立。不再按手机、身份证、银行卡的固定组数逐条列举。
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

/** 开括号和第一位数字之间可以有空格。只看紧邻的前一个字符会把开括号留在外面。 */
export function numberSpanStart(text: string, folded: string, runStart: number, end: number): number {
  const before = text[runStart - 1] ?? ''
  const digitRun = folded.slice(runStart, end).replace(/\D/gu, '')
  if ((before === '+' || before === '＋') && digitRun.startsWith('86')) return runStart - 1
  let cursor = runStart - 1
  while (cursor >= 0 && SEPARATOR_CHARS.has(text[cursor] ?? '')) cursor -= 1
  const opener = text[cursor] ?? ''
  if (opener === '(' || opener === '（') return cursor
  return runStart
}

/**
 * 从这一位数字起，顺着扩展分隔把后段接上。
 * 每一段都是 1 到 10 位。没跨过扩展分隔时返回空，交给通用分隔那条路。
 * 下一段超过 10 位就停在上一段末尾，不把超长的一段吞进来。
 */
export function matchExtendedSegments(folded: string, start: number): { end: number; digits: number } | null {
  const first = segmentLength(folded, start)
  if (first < 1 || first > 10) return null
  let cursor = start + first
  let digits = first
  let sawExtended = false
  while (cursor < folded.length) {
    const bridge = bridgeAcross(folded, cursor, true)
    if (bridge === null) break
    const length = segmentLength(folded, bridge.next)
    if (length < 1 || length > 10) break
    if (bridge.sawExtended) sawExtended = true
    digits += length
    cursor = bridge.next + length
  }
  if (!sawExtended) return null
  return { end: cursor, digits }
}

function segmentLength(folded: string, index: number): number {
  let length = 0
  while (isDigit(folded[index + length] ?? '')) length += 1
  return length
}

function bridgeToNextDigit(folded: string, index: number): number | null {
  const bridge = bridgeAcross(folded, index, false)
  return bridge === null ? null : bridge.next
}

/**
 * 括号里面可以夹空格。斜线、全角斜线、换行、回车只在 extended 时才算分隔。
 * sawExtended 只在真的跨过这些扩展分隔时为真，通用分隔和括号不算。
 */
function bridgeAcross(
  folded: string,
  index: number,
  extended: boolean,
): { next: number; sawExtended: boolean } | null {
  let cursor = index
  let saw = false
  let sawExtended = false
  let closed = false
  let opened = false
  while (cursor < folded.length) {
    const length = extended ? extendedSeparatorLength(folded, cursor) : separatorLength(folded, cursor)
    if (length > 0) {
      if (extended && separatorLength(folded, cursor) === 0) sawExtended = true
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
  return { next: cursor, sawExtended }
}

function separatorLength(folded: string, index: number): number {
  const char = folded[index] ?? ''
  if (char === '\\') {
    const next = folded[index + 1] ?? ''
    if (next === 't' || next === 'n' || next === 'r' || next === '/') return 2
  }
  return SEPARATOR_CHARS.has(char) ? 1 : 0
}

function extendedSeparatorLength(folded: string, index: number): number {
  const basic = separatorLength(folded, index)
  if (basic > 0) return basic
  const char = folded[index] ?? ''
  if (char === '/' || char === '\uFF0F' || char === '\n' || char === '\r') return 1
  return 0
}
