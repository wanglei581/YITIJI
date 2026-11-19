/**
 * 排版出站里，整段连起来像日期或时间的不遮。
 *
 * 年份只认 1950–2100。后面可以接 1 到 2 位的月（1–12）和日（1–31）。
 * 分隔可以是点、斜线、短横、全角，或中文「年月日」。
 * 紧凑的 8 位年月日、6 位年月，以及只由年份组成的串，同样留下。
 * 月或日对不上的，例如 20231345，不当成日期。
 * 带月的日期接成区间时，起不能晚于止，只比两头都写到的那一级；倒序的不当成日期。
 * 只由年份组成的串是年份列表，不看先后。
 * 紧凑 8 位年月日只能单独出现，或者两个接成区间；前后再接别的数字段，整段不当成日期。
 * 钟点时间的时分秒可以用冒号，也可以用点号：9:00-18:00、9.00-18.00、09.00.00-18.00.00。
 */

export function isLayoutDateOrTime(foldedSpan: string): boolean {
  const normalized = normalizeDateSpan(foldedSpan)
  if (normalized.length === 0) return false
  return isTimeSpan(normalized) || isTimeSpan(normalizeDateSpan(dotsAsColons(foldedSpan))) || isCalendarSpan(normalized)
}

/** 点号分隔的钟点时间。点和全角点换成冒号，再按钟点时间认；间隔号不换。 */
function dotsAsColons(foldedSpan: string): string {
  return foldedSpan.replace(/[.．]/gu, ':')
}

function normalizeDateSpan(foldedSpan: string): string {
  return foldedSpan
    .replace(/\\t|\\n|\\r|\\\//gu, '-')
    .replace(/[·•・．.]/gu, '-')
    .replace(/[‐‑–—﹣－/／]/gu, '-')
    .replace(/：/gu, ':')
    .replace(/[ \t\n\r\u00A0\u3000]/gu, '')
}

/** 读出来的一个日期。没写到的月、日记 0。compact 是没有分隔的 8 位年月日。 */
interface ParsedDate {
  end: number
  year: number
  month: number
  day: number
  compact: boolean
}

function dateAt(end: number, year: number, month = 0, day = 0, compact = false): ParsedDate {
  return { end, year, month, day, compact }
}

function isCalendarSpan(text: string): boolean {
  const dates: ParsedDate[] = []
  let index = 0
  while (index < text.length) {
    const parsed = parseDate(text, index)
    if (parsed === null || parsed.end <= index) return false
    dates.push(parsed)
    index = parsed.end
    if (index >= text.length) break
    if (text[index] !== '-') return false
    index += 1
    if (index >= text.length) return false
  }
  return dates.length > 0 && compactStandsAlone(dates) && isInOrder(dates)
}

/**
 * 紧凑 8 位年月日只能单独出现，或两个接成区间。
 * 后面再紧跟数字段的，像证件号里的生日加顺序码（19900307-2015），不放过。
 */
function compactStandsAlone(dates: readonly ParsedDate[]): boolean {
  if (!dates.some((date) => date.compact)) return true
  return dates.length <= 2 && dates.every((date) => date.compact)
}

/**
 * 带月的区间，起不能晚于止。两头写到的级别不同时（2021-1 接 2021），只比两头都写到的那一级。
 * 全是年份的串是年份列表，不看先后。
 */
function isInOrder(dates: readonly ParsedDate[]): boolean {
  if (dates.every((date) => date.month === 0)) return true
  for (let index = 1; index < dates.length; index += 1) {
    const before = dates[index - 1]
    const after = dates[index]
    if (!before || !after) return false
    const depth = Math.min(depthOf(before), depthOf(after))
    if (sortKey(before, depth) > sortKey(after, depth)) return false
  }
  return true
}

function depthOf(date: ParsedDate): number {
  if (date.day > 0) return 3
  return date.month > 0 ? 2 : 1
}

function sortKey(date: ParsedDate, depth: number): number {
  return date.year * 10000 + (depth >= 2 ? date.month * 100 : 0) + (depth >= 3 ? date.day : 0)
}

/** 读完一个日期。年份单独成立时，后面的分隔留给下一段。 */
function parseDate(text: string, index: number): ParsedDate | null {
  if (!isYearAt(text, index)) return null
  const year = Number(text.slice(index, index + 4))
  const yearEnd = index + 4
  const mark = text[yearEnd] ?? ''
  if (mark === '年') return parseChineseDate(text, yearEnd + 1, year)
  if (isDigitChar(mark)) return parseCompactDate(text, index, year)
  if (mark !== '-') return mark === '' ? dateAt(yearEnd, year) : null
  const monthEnd = readBounded(text, yearEnd + 1, 1, 12)
  if (monthEnd === null) return dateAt(yearEnd, year)
  const month = Number(text.slice(yearEnd + 1, monthEnd))
  if (text[monthEnd] !== '-') return dateAt(monthEnd, year, month)
  const dayEnd = readBounded(text, monthEnd + 1, 1, 31)
  if (dayEnd === null) return dateAt(monthEnd, year, month)
  return dateAt(dayEnd, year, month, Number(text.slice(monthEnd + 1, dayEnd)))
}

function parseChineseDate(text: string, index: number, year: number): ParsedDate | null {
  const monthEnd = readBounded(text, index, 1, 12)
  if (monthEnd === null || text[monthEnd] !== '月') return null
  const month = Number(text.slice(index, monthEnd))
  const cursor = monthEnd + 1
  if (cursor >= text.length || text[cursor] === '-') return dateAt(cursor, year, month)
  const dayEnd = readBounded(text, cursor, 1, 31)
  if (dayEnd === null) return dateAt(cursor, year, month)
  const day = Number(text.slice(cursor, dayEnd))
  if (text[dayEnd] === '日') return dateAt(dayEnd + 1, year, month, day)
  if ((text[dayEnd] ?? '') === '' || text[dayEnd] === '-') return dateAt(dayEnd, year, month, day)
  return null
}

/** 没有分隔符的 YYYYMMDD 或 YYYYMM。后面还粘着数字就不是完整日期。 */
function parseCompactDate(text: string, index: number, year: number): ParsedDate | null {
  if (isBoundedDigits(text, index, 8)) {
    const month = Number(text.slice(index + 4, index + 6))
    const day = Number(text.slice(index + 6, index + 8))
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return dateAt(index + 8, year, month, day, true)
  }
  if (isBoundedDigits(text, index, 6)) {
    const month = Number(text.slice(index + 4, index + 6))
    if (month >= 1 && month <= 12) return dateAt(index + 6, year, month)
  }
  return null
}

/** 年份只认 1950–2100，更早或更晚的四位数不当年份。 */
function isYearAt(text: string, index: number): boolean {
  if (index + 4 > text.length) return false
  const digits = text.slice(index, index + 4)
  if (!/^\d{4}$/u.test(digits)) return false
  const year = Number(digits)
  return year >= 1950 && year <= 2100
}

/** 取 1 到 2 位、落在范围内、并且不再粘着数字的数。两位优先，两位不合法就不退回一位。 */
function readBounded(text: string, index: number, min: number, max: number): number | null {
  const first = text[index] ?? ''
  if (!isDigitChar(first)) return null
  const second = text[index + 1] ?? ''
  if (isDigitChar(second)) {
    const value = Number(first + second)
    if (value < min || value > max) return null
    if (isDigitChar(text[index + 2] ?? '')) return null
    return index + 2
  }
  const value = Number(first)
  if (value < min || value > max) return null
  return index + 1
}

function isBoundedDigits(text: string, index: number, length: number): boolean {
  for (let offset = 0; offset < length; offset += 1) {
    if (!isDigitChar(text[index + offset] ?? '')) return false
  }
  return !isDigitChar(text[index + length] ?? '')
}

function isDigitChar(char: string): boolean {
  return char >= '0' && char <= '9'
}

function isTimeSpan(text: string): boolean {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:-(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u.exec(text)
  if (!match) return false
  if (!inRange(match[1], 0, 23) || !inRange(match[2], 0, 59) || !inRange(match[3], 0, 59)) return false
  if (match[4] === undefined) return true
  return inRange(match[4], 0, 23) && inRange(match[5], 0, 59) && inRange(match[6], 0, 59)
}

function inRange(value: string | undefined, min: number, max: number): boolean {
  if (value === undefined) return true
  const number = Number(value)
  return number >= min && number <= max
}
