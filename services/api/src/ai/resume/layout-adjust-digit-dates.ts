/**
 * 排版出站里，整段连起来像日期或时间的不遮。
 *
 * 年份是 19xx 或 20xx。后面可以接 1 到 2 位的月（1–12）和日（1–31）。
 * 分隔可以是点、斜线、短横、全角，或中文「年月日」。
 * 紧凑的 8 位年月日、6 位年月，以及只由年份组成的串，同样留下。
 * 月或日对不上的，例如 20231345，不当成日期。
 */

export function isLayoutDateOrTime(foldedSpan: string): boolean {
  const normalized = normalizeDateSpan(foldedSpan)
  if (normalized.length === 0) return false
  return isTimeSpan(normalized) || isCalendarSpan(normalized)
}

function normalizeDateSpan(foldedSpan: string): string {
  return foldedSpan
    .replace(/\\t|\\n|\\r|\\\//gu, '-')
    .replace(/[·•・．.]/gu, '-')
    .replace(/[‐‑–—﹣－/／]/gu, '-')
    .replace(/：/gu, ':')
    .replace(/[ \t\n\r\u00A0\u3000]/gu, '')
}

function isCalendarSpan(text: string): boolean {
  let index = 0
  let count = 0
  while (index < text.length) {
    const end = parseDate(text, index)
    if (end === null || end <= index) return false
    index = end
    count += 1
    if (index >= text.length) return count >= 1
    if (text[index] !== '-') return false
    index += 1
    if (index >= text.length) return false
  }
  return false
}

/** 读完一个日期。年份单独成立时，后面的分隔留给下一段。 */
function parseDate(text: string, index: number): number | null {
  if (!isYearAt(text, index)) return null
  const yearEnd = index + 4
  const mark = text[yearEnd] ?? ''
  if (mark === '年') return parseChineseDate(text, yearEnd + 1)
  if (isDigitChar(mark)) return parseCompactDate(text, index)
  if (mark !== '-') return mark === '' ? yearEnd : null
  const monthEnd = readBounded(text, yearEnd + 1, 1, 12)
  if (monthEnd === null) return yearEnd
  if (text[monthEnd] !== '-') return monthEnd
  const dayEnd = readBounded(text, monthEnd + 1, 1, 31)
  return dayEnd === null ? monthEnd : dayEnd
}

function parseChineseDate(text: string, index: number): number | null {
  const monthEnd = readBounded(text, index, 1, 12)
  if (monthEnd === null || text[monthEnd] !== '月') return null
  const cursor = monthEnd + 1
  if (cursor >= text.length || text[cursor] === '-') return cursor
  const dayEnd = readBounded(text, cursor, 1, 31)
  if (dayEnd === null) return cursor
  if (text[dayEnd] === '日') return dayEnd + 1
  if ((text[dayEnd] ?? '') === '' || text[dayEnd] === '-') return dayEnd
  return null
}

/** 没有分隔符的 YYYYMMDD 或 YYYYMM。后面还粘着数字就不是完整日期。 */
function parseCompactDate(text: string, index: number): number | null {
  if (isBoundedDigits(text, index, 8)) {
    const month = Number(text.slice(index + 4, index + 6))
    const day = Number(text.slice(index + 6, index + 8))
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return index + 8
  }
  if (isBoundedDigits(text, index, 6)) {
    const month = Number(text.slice(index + 4, index + 6))
    if (month >= 1 && month <= 12) return index + 6
  }
  return null
}

function isYearAt(text: string, index: number): boolean {
  if (index + 4 > text.length) return false
  return /^(?:19|20)\d{2}$/u.test(text.slice(index, index + 4))
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
