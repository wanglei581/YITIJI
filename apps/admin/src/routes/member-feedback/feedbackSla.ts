// 「AI 内容投诉」答复时限（C3）。纯函数、零 import：门禁 verify:feedback-sla 在纯 node 下
// 用 typescript transpileModule 直接执行本文件，所以这里不得 import 任何模块。
//
// 口径（2026-09-29 总指挥）：
//   - 只对分类为「AI 内容投诉」（ai_content）、状态为待查看 / 处理中的工单计时；
//     已回复、已关闭不再计时。其它分类不计时；「个人信息请求」不走意见反馈，这里不涉及。
//   - 提交当天不算，从下一个工作日起数满 N 个工作日，截止为第 N 个工作日上海时间 23:59:59。
//   - 一律按 Asia/Shanghai 计算（中国不实行夏令时，固定 UTC+8）。
//   - 只在后台前端计算，不加服务端超时状态机。

/**
 * 答复时限（工作日数）。律师审阅后可能调整，改这一处即可，页面与门禁都读它。
 */
export const AI_CONTENT_COMPLAINT_SLA_WORKDAYS = 5

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 2026 年部分节假日安排（国务院办公厅 国办发明电〔2025〕7号）。
 * 只列放假日与调休上班日；其余日期按周一至周五为工作日。
 */
const OFFICIAL_CALENDARS: Record<number, { holidays: readonly string[]; adjustedWorkdays: readonly string[] }> = {
  2026: {
    holidays: [
      // 元旦
      ...dateRange('2026-01-01', '2026-01-03'),
      // 春节
      ...dateRange('2026-02-15', '2026-02-23'),
      // 清明节
      ...dateRange('2026-04-04', '2026-04-06'),
      // 劳动节
      ...dateRange('2026-05-01', '2026-05-05'),
      // 端午节
      ...dateRange('2026-06-19', '2026-06-21'),
      // 中秋节
      ...dateRange('2026-09-25', '2026-09-27'),
      // 国庆节
      ...dateRange('2026-10-01', '2026-10-07'),
    ],
    adjustedWorkdays: [
      '2026-01-04', // 周日上班
      '2026-02-14', // 周六上班
      '2026-02-28', // 周六上班
      '2026-05-09', // 周六上班
      '2026-09-20', // 周日上班
      '2026-10-10', // 周六上班
    ],
  },
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 日序号：上海日历日期对应的「自 1970-01-01 起第几天」。只用于比较与逐日前进。 */
type DayIndex = number

function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let day = keyToIndex(from); day <= keyToIndex(to); day += 1) out.push(indexToKey(day))
  return out
}

function keyToIndex(key: string): DayIndex {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY_MS)
}

/** 日序号 → YYYY-MM-DD（按 UTC 字段取，日序号本身已是上海日期，不再换算时区）。 */
function indexToKey(day: DayIndex): string {
  const date = new Date(day * DAY_MS)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function yearOf(day: DayIndex): number {
  return new Date(day * DAY_MS).getUTCFullYear()
}

/** 某一时刻落在上海的哪一天。 */
export function shanghaiDayIndex(instant: Date): DayIndex {
  return Math.floor((instant.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS)
}

/** 这一天是不是工作日；estimated=true 表示该年官方安排尚未收录，按周一至周五估算。 */
export function workdayInfo(day: DayIndex): { workday: boolean; estimated: boolean } {
  const calendar = OFFICIAL_CALENDARS[yearOf(day)]
  const weekday = new Date(day * DAY_MS).getUTCDay()
  const weekendDay = weekday === 0 || weekday === 6
  if (!calendar) return { workday: !weekendDay, estimated: true }
  const key = indexToKey(day)
  if (calendar.adjustedWorkdays.includes(key)) return { workday: true, estimated: false }
  if (calendar.holidays.includes(key)) return { workday: false, estimated: false }
  return { workday: !weekendDay, estimated: false }
}

export interface AiComplaintDeadline {
  /** 截止日（上海日期），YYYY-MM-DD。 */
  deadlineDate: string
  /** 截止时刻：截止日上海时间 23:59:59。 */
  deadlineAt: Date
  /** 计算过程中用到了尚未收录官方安排的年份（按周一至周五估算）。 */
  estimated: boolean
  /** 被估算的第一个年份；estimated=false 时为 null。 */
  estimatedYear: number | null
  workdays: number
}

/** 提交当天不算，从下一个工作日起数满 workdays 个工作日。 */
export function aiComplaintDeadline(
  submittedAt: Date | string,
  workdays: number = AI_CONTENT_COMPLAINT_SLA_WORKDAYS,
): AiComplaintDeadline {
  const submitted = typeof submittedAt === 'string' ? new Date(submittedAt) : submittedAt
  let day = shanghaiDayIndex(submitted)
  let counted = 0
  let estimatedYear: number | null = null
  while (counted < workdays) {
    day += 1
    const info = workdayInfo(day)
    if (info.estimated && estimatedYear === null) estimatedYear = yearOf(day)
    if (info.workday) counted += 1
  }
  return {
    deadlineDate: indexToKey(day),
    deadlineAt: new Date((day + 1) * DAY_MS - SHANGHAI_OFFSET_MS - 1000),
    estimated: estimatedYear !== null,
    estimatedYear,
    workdays,
  }
}

/** (from, to] 之间的工作日个数。 */
function workdaysBetween(from: DayIndex, to: DayIndex): number {
  let count = 0
  for (let day = from + 1; day <= to; day += 1) {
    if (workdayInfo(day).workday) count += 1
  }
  return count
}

export type AiComplaintSlaUrgency = 'normal' | 'soon' | 'today' | 'overdue'

export type AiComplaintSla =
  | { kind: 'stopped'; label: string }
  | {
      kind: 'running'
      urgency: AiComplaintSlaUrgency
      /** 列表上的短标签：剩 N 个工作日 / 今天到期 / 已超期 N 个工作日。 */
      listLabel: string
      /** 详情里的完整说明。 */
      detailLabel: string
      deadline: AiComplaintDeadline
    }

export interface SlaTicketInput {
  category: string
  status: string
  createdAt: string | Date
}

/** 截止日的人话写法：10 月 12 日（周一）；跨年时带年份。 */
export function formatDeadlineDate(deadlineDate: string, now: Date): string {
  const day = keyToIndex(deadlineDate)
  const [y, m, d] = deadlineDate.split('-').map(Number)
  const yearPrefix = y !== yearOf(shanghaiDayIndex(now)) ? `${y} 年 ` : ''
  return `${yearPrefix}${m} 月 ${d} 日（${WEEKDAY_LABELS[new Date(day * DAY_MS).getUTCDay()]}）`
}

/**
 * 工单当前的答复时限状态。不是 AI 内容投诉返回 null（不计时）。
 */
export function aiComplaintSla(ticket: SlaTicketInput, now: Date = new Date()): AiComplaintSla | null {
  if (ticket.category !== 'ai_content') return null
  if (ticket.status === 'replied') return { kind: 'stopped', label: '已回复，不再计时' }
  if (ticket.status === 'closed') return { kind: 'stopped', label: '已关闭，不再计时' }
  if (ticket.status !== 'pending' && ticket.status !== 'processing') return null

  const deadline = aiComplaintDeadline(ticket.createdAt)
  const today = shanghaiDayIndex(now)
  const deadlineDay = keyToIndex(deadline.deadlineDate)

  let urgency: AiComplaintSlaUrgency
  let listLabel: string
  if (today > deadlineDay) {
    const overdue = Math.max(1, workdaysBetween(deadlineDay, today))
    urgency = 'overdue'
    listLabel = `已超期 ${overdue} 个工作日`
  } else if (today === deadlineDay) {
    urgency = 'today'
    listLabel = '今天到期'
  } else {
    const remaining = workdaysBetween(today, deadlineDay)
    urgency = remaining <= 1 ? 'soon' : 'normal'
    listLabel = `剩 ${remaining} 个工作日`
  }

  const latestKnownYear = Math.max(...Object.keys(OFFICIAL_CALENDARS).map(Number))
  const estimateNote = deadline.estimatedYear === null
    ? ''
    : deadline.estimatedYear > latestKnownYear
      ? `（${deadline.estimatedYear} 年节假日安排尚未公布，按周一至周五估算）`
      : `（${deadline.estimatedYear} 年节假日安排未收录，按周一至周五估算）`
  const detailLabel =
    `答复时限：${formatDeadlineDate(deadline.deadlineDate, now)}前 · ` +
    `${deadline.workdays} 个工作日，已扣除法定节假日${estimateNote}`

  return { kind: 'running', urgency, listLabel, detailLabel, deadline }
}
