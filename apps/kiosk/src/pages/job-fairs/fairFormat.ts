// 招聘会域共用的时间格式化。
//
// 单独成文件是为了避免「页面 ↔ 页内基础件」互相 import 形成环：
// 列表页要用卡片，卡片又要用格式化函数，函数放在页面里就绕回去了。

import { formatDateTime, parseInstant, shanghaiParts, shanghaiTodayKey } from '@ai-job-print/shared'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function fmtFairDate(iso: string): string {
  return formatDateTime(iso, { style: 'month-day', fallback: iso })
}

export function fmtFairTime(iso: string): string {
  return formatDateTime(iso, { style: 'time', fallback: iso })
}

/** 同步时间：当天只给时分，其余给月日。看的人要的是「新不新」，不是完整时间戳。 */
export function fmtFairSync(iso: string): string {
  const instant = parseInstant(iso)
  if (!instant) return iso
  const parts = shanghaiParts(instant)
  if (parts.dateKey === shanghaiTodayKey()) return `今天 ${pad(parts.hour)}:${pad(parts.minute)}`
  return `${pad(parts.month)}-${pad(parts.day)}`
}

export function fmtFairDateTime(iso: string): string {
  return formatDateTime(iso, { fallback: iso })
}

export function fmtFairFullDateTime(iso: string): string {
  return formatDateTime(iso, { style: 'zh-datetime', fallback: iso })
}

export function fmtFairSyncDate(iso: string): string {
  return formatDateTime(iso, { style: 'zh-date', fallback: iso })
}

/** 上海时区的日期键，供日历筛选比对用。 */
export function fairDateKey(iso: string): string {
  const instant = parseInstant(iso)
  if (!instant) return iso
  return shanghaiParts(instant).dateKey
}
