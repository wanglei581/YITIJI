/**
 * 发布日期只认两个字段：优先 publishedDate，没有再用 publishConfirmedAt 的日期部分。
 * 同步时间不拿来填。两个都没有就返回 undefined，页面显示「—」。
 * 这里返回的是数据用的日历日。屏上的「11 月 5 日」走 policyPublishedLabel。
 */
export function policyPublishedOn(input: {
  publishedDate?: string | null
  publishConfirmedAt?: string | null
}): string | undefined {
  const published = input.publishedDate?.trim()
  if (published) return published
  const confirmed = input.publishConfirmedAt?.trim()
  if (!confirmed) return undefined
  const dated = /^(\d{4}-\d{2}-\d{2})/.exec(confirmed)
  return dated?.[1] ?? confirmed
}

function monthDayLabel(day: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return undefined
  return `${Number(match[2])} 月 ${Number(match[3])} 日`
}

/** 带时刻的值按北京时间取日历日。纯日历日不进这里。 */
function shanghaiCalendarDay(value: string): string | undefined {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined
}

function displayDay(value: string): string | undefined {
  const literal = monthDayLabel(value)
  if (literal) return literal
  const shanghai = shanghaiCalendarDay(value)
  return shanghai ? monthDayLabel(shanghai) : undefined
}

/** 屏上写「11 月 5 日」。日历日按字面；带时刻的按北京时间。字段优先级与 policyPublishedOn 相同。 */
export function policyPublishedLabel(input: {
  publishedDate?: string | null
  publishConfirmedAt?: string | null
}): string | undefined {
  const published = input.publishedDate?.trim()
  if (published) return displayDay(published) ?? published
  const confirmed = input.publishConfirmedAt?.trim()
  if (!confirmed) return undefined
  return displayDay(confirmed)
}
