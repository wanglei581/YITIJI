/**
 * 给人看的北京时间。
 *
 * 为什么单独放这里，而不放进已有的 beijingDayKey / shanghaiDay：
 * 那些函数是额度、计量、统计的分桶键，改它们的输出会换掉 Redis 键和聚合桶。
 * 告警正文、纸上的生成时间、运营看到的失败原因要的是同一套「亚洲/上海」墙钟，
 * 而且要能写到分钟和秒。放进短信额度或告警文件里，PDF 和批量发布就会去依赖不该依赖的模块。
 *
 * 只用于拼进句子、纸面和文件名。存库、接口里的 ISO 字段、日志机器时间继续用 UTC。
 */
const BEIJING_TIME_ZONE = 'Asia/Shanghai'

const dateTimeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BEIJING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function assertValid(date: Date): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError('北京时间格式化需要有效的 Date')
  }
}

function clockParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  const picked: Record<string, string> = {}
  for (const part of dateTimeFormat.formatToParts(date)) {
    if (part.type !== 'literal') picked[part.type] = part.value
  }
  return {
    year: picked.year ?? '',
    month: picked.month ?? '',
    day: picked.day ?? '',
    hour: picked.hour === '24' ? '00' : (picked.hour ?? ''),
    minute: picked.minute ?? '',
    second: picked.second ?? '',
  }
}

/** 北京时间自然日 YYYY-MM-DD。16:30Z 落在次日。 */
export function formatBeijingDate(date: Date): string {
  assertValid(date)
  const p = clockParts(date)
  return `${p.year}-${p.month}-${p.day}`
}

/** 北京时间 YYYY-MM-DD HH:mm。告警正文用这个精度。 */
export function formatBeijingMinute(date: Date): string {
  assertValid(date)
  const p = clockParts(date)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

/** 北京时间 YYYY-MM-DD HH:mm:ss。纸上需要看到秒的时候用。 */
export function formatBeijingDateTime(date: Date): string {
  assertValid(date)
  const p = clockParts(date)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}
