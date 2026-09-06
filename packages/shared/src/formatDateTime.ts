/**
 * 三端时间展示与解析。
 *
 * 后端对外时间字段一律 ISO-8601（含 `Z` 或 `±HH:MM`）。历史 `fmtSyncTime`
 * 曾输出无时区的 UTC「YYYY-MM-DD HH:mm」，Safari `new Date(str)` 为 Invalid Date，
 * Chrome 当本地解析，岗位来源四要素会被误判缺失。本模块把无时区串按 UTC 读，
 * 展示一律 Asia/Shanghai（UTC+8，无夏令时）。
 */

export const DISPLAY_TIMEZONE = 'Asia/Shanghai'
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export type DateTimeDisplayStyle =
  | 'datetime'
  | 'date'
  | 'time'
  | 'zh-date'
  | 'zh-datetime'
  | 'month-day'

export interface ShanghaiWallParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  dateKey: string
}

const NAIVE_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/
const HAS_ZONE = /[zZ]$|[+-]\d{2}:?\d{2}$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const SENTINELS = new Set(['从未同步', '—', '-', '暂无', '暂无同步时间'])

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function looksLikeDateTime(raw: string): boolean {
  return DATE_ONLY.test(raw) || NAIVE_DATE_TIME.test(raw) || HAS_ZONE.test(raw.replace(' ', 'T'))
}

/** 无时区的「YYYY-MM-DD[ T]HH:mm[:ss]」按 UTC 读（历史 fmtSyncTime 口径）。 */
function normalizeToIso(raw: string): string {
  const trimmed = raw.trim()
  if (HAS_ZONE.test(trimmed)) {
    return trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
  }
  if (DATE_ONLY.test(trimmed)) return trimmed
  const naive = NAIVE_DATE_TIME.exec(trimmed)
  if (naive) {
    const time = naive[2].length === 5 ? `${naive[2]}:00` : naive[2]
    return `${naive[1]}T${time}Z`
  }
  return trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
}

export function parseInstant(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const trimmed = value.trim()
  if (!trimmed || SENTINELS.has(trimmed)) return null
  const parsed = new Date(normalizeToIso(trimmed))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function isParseableInstant(value: string | Date | null | undefined): boolean {
  return parseInstant(value) !== null
}

export function shanghaiParts(instant: Date): ShanghaiWallParts {
  const shifted = new Date(instant.getTime() + SHANGHAI_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  const hour = shifted.getUTCHours()
  const minute = shifted.getUTCMinutes()
  const second = shifted.getUTCSeconds()
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
  }
}

export function shanghaiTodayKey(now: Date = new Date()): string {
  return shanghaiParts(now).dateKey
}

function renderParts(parts: ShanghaiWallParts, style: DateTimeDisplayStyle): string {
  switch (style) {
    case 'date':
      return parts.dateKey
    case 'time':
      return `${pad(parts.hour)}:${pad(parts.minute)}`
    case 'month-day':
      return `${pad(parts.month)}-${pad(parts.day)}`
    case 'zh-date':
      return `${parts.year}年${parts.month}月${parts.day}日`
    case 'zh-datetime':
      return `${parts.year}年${parts.month}月${parts.day}日 ${pad(parts.hour)}:${pad(parts.minute)}`
    case 'datetime':
    default:
      return `${parts.dateKey} ${pad(parts.hour)}:${pad(parts.minute)}`
  }
}

export function formatDateTime(
  value: string | Date | null | undefined,
  options?: { style?: DateTimeDisplayStyle; fallback?: string },
): string {
  const fallback = options?.fallback ?? '—'
  const style = options?.style ?? 'datetime'
  if (value == null) return fallback
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    const instant = parseInstant(trimmed)
    if (!instant) return looksLikeDateTime(trimmed) ? fallback : trimmed
    return renderParts(shanghaiParts(instant), style)
  }
  const instant = parseInstant(value)
  if (!instant) return fallback
  return renderParts(shanghaiParts(instant), style)
}

export function formatDate(
  value: string | Date | null | undefined,
  fallback = '—',
): string {
  return formatDateTime(value, { style: 'date', fallback })
}

export function formatTime(
  value: string | Date | null | undefined,
  fallback = '—',
): string {
  return formatDateTime(value, { style: 'time', fallback })
}

/** `<input type="datetime-local">` 需要的无时区墙钟，按 Asia/Shanghai。 */
export function toDatetimeLocalValue(value: string | Date | null | undefined): string {
  const instant = parseInstant(value)
  if (!instant) return ''
  const parts = shanghaiParts(instant)
  return `${parts.dateKey}T${pad(parts.hour)}:${pad(parts.minute)}`
}

/** 把 datetime-local 墙钟按 Asia/Shanghai 解释成 ISO（含 Z）。 */
export function fromDatetimeLocalValue(value: string): string {
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)
  if (!match) {
    throw new RangeError('datetime-local 值无法按 Asia/Shanghai 解释')
  }
  const utcMs =
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      match[6] ? Number(match[6]) : 0,
    ) - SHANGHAI_OFFSET_MS
  return new Date(utcMs).toISOString()
}
