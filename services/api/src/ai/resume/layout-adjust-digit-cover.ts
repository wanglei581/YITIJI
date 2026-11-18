/**
 * 排版出站兜底：引擎没认出的长数字，按现实写法再遮一层。
 *
 * 检测前先把全角数字、全角 X 折成半角，占位符里存的仍是原文，还原才能逐字对上。
 * 数字段之间可以隔空格、制表符、各种短横和点、零宽字符，也可以把一段用括号包住。
 * 连续多个空格、空格包住的短横，同样把两边接成一串。合计达到 11 位的按一整串遮。
 * 简历 JSON 再按字段对齐：相邻字符串值或数值拼起来够 11 位的，各换成自己的占位符。
 * 占位符是本次请求的标记，用户原文里写不出同样的一串。
 * 年月日期轴不是号码，原样留下，排版还要看见时间。
 */
import { randomBytes } from 'node:crypto'

export interface LayoutDigitBook {
  /** 同一段原文共用一个占位符，三段还原才对得上。 */
  issue(original: string): string
}

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

const TOKEN_OPEN = '⦃'
const TOKEN_CLOSE = '⦄'

/** 本次请求的占位符。中间有字母，不会被长数字扫描再吞一遍。 */
export function layoutTokenPattern(flags = 'g'): RegExp {
  return new RegExp(`${TOKEN_OPEN}[0-9a-f]+:\\d+${TOKEN_CLOSE}`, flags)
}

/**
 * 每次请求换一串标记。同一段原文共用一个占位符。
 * 标记里夹着字母，检测长数字时不会把占位符自己当成号码。
 */
export function createLayoutTokenBook(inputs: readonly string[]): {
  book: LayoutDigitBook
  extra: Map<string, string>
} {
  const nonce = pickNonce(inputs)
  const extra = new Map<string, string>()
  const byValue = new Map<string, string>()
  let counter = 0
  return {
    extra,
    book: {
      issue(original: string): string {
        const known = byValue.get(original)
        if (known) return known
        counter += 1
        const token = `${TOKEN_OPEN}${nonce}:${counter}${TOKEN_CLOSE}`
        extra.set(token, original)
        byValue.set(original, token)
        return token
      },
    },
  }
}

/**
 * 六位，且以字母开头。一位序号时整个标记 10 个字，
 * 贴着 12000 字窗口末尾的证件号换完仍然进得了窗口。
 * 连续数字最长 5 位，兜底扫描不会误伤占位符。
 */
function pickNonce(inputs: readonly string[]): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const nonce = `a${randomBytes(3).toString('hex').slice(0, 5)}`
    const marker = `${TOKEN_OPEN}${nonce}:`
    if (inputs.every((text) => !text.includes(marker))) return nonce
  }
  return `a${randomBytes(3).toString('hex').slice(0, 5)}`
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

/** 年月用点或短横连起来的日期轴。各种点和短横先折成半角，空白和转义制表符拿掉再认。 */
function isDateAxis(foldedSpan: string): boolean {
  const normalized = foldedSpan
    .replace(/\\t/gu, '')
    .replace(/[·•・．]/gu, '.')
    .replace(/[‐‑–—﹣－]/gu, '-')
    .replace(/[ \t\u00A0\u3000]/gu, '')
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
    const joined = readJoinedDigits(folded, index)
    const digits = joined.digits
    index = joined.end
    let end = index
    const tail = folded[end]
    if ((tail === 'X' || tail === 'x') && end > runStart && isDigit(folded[end - 1] ?? '')) end += 1
    let start = runStart
    const before = text[runStart - 1] ?? ''
    const digitRun = folded.slice(runStart, end).replace(/\D/gu, '')
    if ((before === '+' || before === '＋') && digitRun.startsWith('86')) start -= 1
    else if (before === '(' || before === '（') start -= 1
    if (digits >= 11 && !isDateAxis(folded.slice(runStart, end))) spans.push([start, end])
    index = Math.max(index, end)
  }
  return replaceSpans(text, spans, book)
}

/**
 * 取舍：顺着原文扫字符串值，不把整段 JSON 去掉标点再拼。
 * 去掉标点会把键名和不相邻的数字也接上，还原做不到逐字。
 * 键名跳过。带反斜杠转义的值、普通文字、日期轴都断开，不参与拼接。
 * 数值字段按它写在 JSON 里的数字参加拼接，不重新序列化。
 * 每一段都是纯数字的年、年月或年月日时不接。
 * 命中的每个字段换成自己的占位符，里面存该字段原文。
 */
export function coverAdjacentJsonValues(json: string, book: LayoutDigitBook): string {
  const literals = scanJsonAtoms(json)
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
    if (literal.breaksRun) {
      flush()
      continue
    }
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

function scanJsonAtoms(json: string): Array<{
  innerStart: number
  innerEnd: number
  hasEscape: boolean
  isKey: boolean
  breaksRun: boolean
}> {
  const literals: Array<{
    innerStart: number
    innerEnd: number
    hasEscape: boolean
    isKey: boolean
    breaksRun: boolean
  }> = []
  let index = 0
  while (index < json.length) {
    const char = json[index] ?? ''
    if (char === '⦃') {
      const close = json.indexOf('⦄', index + 1)
      index = close < 0 ? json.length : close + 1
      continue
    }
    if (char === '"') {
      const innerStart = index + 1
      index += 1
      let hasEscape = false
      let closed = false
      while (index < json.length) {
        const inner = json[index] ?? ''
        if (inner === '\\') {
          hasEscape = true
          index += 2
          continue
        }
        if (inner === '"') {
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
      literals.push({ innerStart, innerEnd, hasEscape, isKey: json[look] === ':', breaksRun: false })
      continue
    }
    if (char === '-' && isJsonNumberStart(json, index) && isDigit(json[index + 1] ?? '')) {
      index = skipJsonNumber(json, index + 1)
      literals.push({ innerStart: index, innerEnd: index, hasEscape: false, isKey: false, breaksRun: true })
      continue
    }
    if (isDigit(char) && isJsonNumberStart(json, index)) {
      const innerStart = index
      while (index < json.length && isDigit(json[index] ?? '')) index += 1
      const next = json[index] ?? ''
      if (next === '.' || next === 'e' || next === 'E') {
        index = skipJsonNumber(json, innerStart)
        literals.push({ innerStart, innerEnd: innerStart, hasEscape: false, isKey: false, breaksRun: true })
        continue
      }
      literals.push({ innerStart, innerEnd: index, hasEscape: false, isKey: false, breaksRun: false })
      continue
    }
    index += 1
  }
  return literals
}

/** 数值只认写在值位置上的。占位符和键名里的数字不参加拼接。 */
function isJsonNumberStart(json: string, index: number): boolean {
  let look = index - 1
  while (look >= 0 && isJsonWhitespace(json[look] ?? '')) look -= 1
  if (look < 0) return true
  const prev = json[look] ?? ''
  return prev === ':' || prev === ',' || prev === '['
}

function skipJsonNumber(json: string, index: number): number {
  if (json[index] === '-') index += 1
  while (index < json.length && isDigit(json[index] ?? '')) index += 1
  if (json[index] === '.') {
    index += 1
    while (index < json.length && isDigit(json[index] ?? '')) index += 1
  }
  if (json[index] === 'e' || json[index] === 'E') {
    index += 1
    if (json[index] === '+' || json[index] === '-') index += 1
    while (index < json.length && isDigit(json[index] ?? '')) index += 1
  }
  return index
}

function isJsonWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/** 整段都是数字，中间只隔允许的分隔符或括号。日期轴留在外面，当断开用。 */
function isJoinableNumber(raw: string): boolean {
  if (raw.length === 0) return false
  const folded = foldDigits(raw)
  if (isDateAxis(folded)) return false
  let index = 0
  const digitsOnly = folded.replace(/\D/gu, '')
  if ((folded[0] === '+' || folded[0] === '＋') && digitsOnly.startsWith('86')) index = 1
  if (folded[index] === '(' || folded[index] === '（') index += 1
  if (!isDigit(folded[index] ?? '')) return false
  const joined = readJoinedDigits(folded, index)
  let end = joined.end
  const tail = folded[end] ?? ''
  if ((tail === 'X' || tail === 'x') && end > index && isDigit(folded[end - 1] ?? '')) end += 1
  return end === folded.length && joined.digits > 0
}

/** 从第一位数字起，把隔着分隔符或括号的后续数字段一起读完。 */
function readJoinedDigits(folded: string, start: number): { end: number; digits: number } {
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

/**
 * 数字段之后如果是括号和分隔符，并且后面还是数字，返回下一段数字的下标。
 * 接不上就返回 null。JSON 里的制表符是反斜杠加 t，按一个分隔符读。
 */
function bridgeToNextDigit(folded: string, index: number): number | null {
  let cursor = index
  const close = folded[cursor] ?? ''
  if (close === ')' || close === '）') cursor += 1
  let separators = 0
  while (cursor < folded.length) {
    const length = separatorLength(folded, cursor)
    if (length === 0) break
    cursor += length
    separators += 1
  }
  const open = folded[cursor] ?? ''
  if (open === '(' || open === '（') cursor += 1
  if (!isDigit(folded[cursor] ?? '')) return null
  if (separators === 0 && close !== ')' && close !== '）' && open !== '(' && open !== '（') return null
  return cursor
}

function separatorLength(folded: string, index: number): number {
  const char = folded[index] ?? ''
  if (char === '\\' && folded[index + 1] === 't') return 2
  return SEPARATOR_CHARS.has(char) ? 1 : 0
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
