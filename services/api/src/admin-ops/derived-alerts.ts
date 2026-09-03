import type { PrismaService } from '../prisma/prisma.service'
import { HEALTHY_PRINTER_STATUS_VALUES, isHealthyPrinterStatus } from '../terminals/printer-status'
import {
  buildSubjectKey,
  offlineEpisodeToken,
  printerIssueEpisodeToken,
  printFailedEpisodeToken,
  type DerivedAlertType,
} from './derived-alert-identity'

/** 与 terminals.service 同口径:lastSeen 距今 < 3 分钟 = 在线。 */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000
/** 打印失败告警回看窗口。 */
export const FAILED_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * print_failed 单次列表的物化上限。
 *
 * 为什么还留上限:24 小时内的失败任务数没有天然边界(批量打印事故会几百上千条),
 * 而告警中心是被反复轮询的读端点,无上限 findMany 等于把内存和响应体大小交给故障
 * 规模决定。
 *
 * 为什么上限不再等于「事实」:
 *   1. firingCount 走同一 where 的 count(),是精确总数,不受本上限影响;
 *   2. 超出部分通过 omitted 如实告知界面,不让操作员以为列表就是全部(CLAUDE.md §9);
 *   3. 能否处置某一条与本上限无关——处置走 resolveDerivedAlert() 的单条正向查证,
 *      不再扫列表,所以第 501 条同样可以被确认 / 静默 / 关闭。
 */
export const PRINT_FAILED_LIST_CAP = 500

const PRINTER_STATUS_LABELS: Record<string, string> = {
  offline: '打印机离线',
  paper_empty: '打印机缺纸',
  error: '打印机故障',
  not_found: '打印机未找到',
}

export interface DerivedAlert {
  id: string
  subjectKey: string
  subjectId: string
  episodeToken: string
  type: DerivedAlertType
  severity: 'error' | 'warning'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
}

export interface DerivedAlertCollection {
  /** 本次实际物化出来的告警。 */
  alerts: DerivedAlert[]
  /** 当前满足条件的告警总数(精确计数,不受列表上限影响)。 */
  firingTotal: number
  /** 因列表上限未被物化的条数;0 表示 alerts 就是全部。 */
  omitted: number
  /** 触发截断的上限值,便于界面如实说明。 */
  cap: number
}

type TerminalRow = {
  id: string
  terminalCode: string
  registeredAt: Date
  heartbeats: Array<{ createdAt: Date; printerStatus: string | null }>
}

type FailedTaskRow = {
  id: string
  errorCode: string | null
  updatedAt: Date
  terminal: { terminalCode: string } | null
  order: { payStatus: string } | null
}

const TERMINAL_SELECT = {
  id: true,
  terminalCode: true,
  registeredAt: true,
  heartbeats: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true, printerStatus: true },
  },
} as const

const FAILED_TASK_SELECT = {
  id: true,
  errorCode: true,
  updatedAt: true,
  terminal: { select: { terminalCode: true } },
  order: { select: { payStatus: true } },
} as const

/**
 * 打印失败告警的判定条件。列表 / 计数 / 单条查证共用同一份,
 * 避免「列表里没有」和「其实还在 firing」因为条件漂移而不一致。
 *
 * 退款排除:RefundService 完成路径只写 Order.payStatus='refunded',
 * 明确不改 PrintTask / printOutcome。这里按订单退款态过滤,禁止伪造出纸结果。
 */
function failedTaskWhere(nowMs: number) {
  return {
    status: 'failed',
    updatedAt: { gte: new Date(nowMs - FAILED_LOOKBACK_MS) },
    // SQL 的 NOT IN 不匹配 NULL,必须显式收未核查任务,否则普通失败告警会全灭。
    AND: [
      {
        OR: [
          { printOutcome: null },
          { printOutcome: { notIn: ['printed', 'not_printed'] } },
        ],
      },
      // 已退款订单不再报警。退款路径写的是 Order.payStatus,不是 printOutcome。
      { NOT: { order: { payStatus: 'refunded' } } },
    ],
  }
}

/** 终端类告警(离线 / 打印机异常)的唯一判定入口。 */
function buildTerminalAlert(
  terminal: TerminalRow,
  lastHealthyAt: Date | null,
  nowMs: number,
): DerivedAlert | null {
  const lastHeartbeat = terminal.heartbeats[0]
  const lastSeen = lastHeartbeat?.createdAt ?? terminal.registeredAt
  const offlineMs = nowMs - lastSeen.getTime()

  if (offlineMs >= ONLINE_WINDOW_MS) {
    const minutes = Math.floor(offlineMs / 60000)
    const subjectKey = buildSubjectKey('terminal_offline', terminal.id)
    return {
      id: subjectKey,
      subjectKey,
      subjectId: terminal.id,
      episodeToken: offlineEpisodeToken(lastSeen),
      type: 'terminal_offline',
      severity: offlineMs >= 30 * 60 * 1000 ? 'error' : 'warning',
      title: `终端 ${terminal.terminalCode} 离线`,
      detail: `最近一次心跳在 ${minutes} 分钟前(${lastSeen.toISOString().slice(0, 16).replace('T', ' ')})`,
      terminalCode: terminal.terminalCode,
      occurredAt: lastSeen.toISOString(),
    }
  }

  if (lastHeartbeat?.printerStatus && !isHealthyPrinterStatus(lastHeartbeat.printerStatus)) {
    const label = PRINTER_STATUS_LABELS[lastHeartbeat.printerStatus] ?? `打印机状态异常(${lastHeartbeat.printerStatus})`
    const subjectKey = buildSubjectKey('printer_issue', terminal.id)
    const healthyAt = lastHealthyAt ?? terminal.registeredAt
    return {
      id: subjectKey,
      subjectKey,
      subjectId: terminal.id,
      episodeToken: printerIssueEpisodeToken(lastHeartbeat.printerStatus, healthyAt),
      type: 'printer_issue',
      severity: lastHeartbeat.printerStatus === 'paper_empty' ? 'warning' : 'error',
      title: `终端 ${terminal.terminalCode} ${label}`,
      detail: `终端在线,但最近心跳上报打印机状态为 ${lastHeartbeat.printerStatus}`,
      terminalCode: terminal.terminalCode,
      occurredAt: lastHeartbeat.createdAt.toISOString(),
    }
  }

  return null
}

/** 打印失败告警的唯一构造入口。 */
function buildPrintFailedAlert(task: FailedTaskRow): DerivedAlert {
  const subjectKey = buildSubjectKey('print_failed', task.id)
  return {
    id: subjectKey,
    subjectKey,
    subjectId: task.id,
    episodeToken: printFailedEpisodeToken(task.id),
    type: 'print_failed',
    severity: 'warning',
    title: `打印任务失败${task.errorCode ? `(${task.errorCode})` : ''}`,
    detail: `任务 ${task.id}${task.terminal?.terminalCode ? ` · 终端 ${task.terminal.terminalCode}` : ''},失败于 ${task.updatedAt.toISOString().slice(0, 16).replace('T', ' ')}`,
    terminalCode: task.terminal?.terminalCode ?? null,
    occurredAt: task.updatedAt.toISOString(),
  }
}

/** 最近一次健康心跳时间;用于 printer_issue 的 episodeToken。 */
async function lastHealthyHeartbeatAt(prisma: PrismaService, terminalId: string): Promise<Date | null> {
  const row = await prisma.terminalHeartbeat.findFirst({
    where: { terminalId, printerStatus: { in: [...HEALTHY_PRINTER_STATUS_VALUES] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return row?.createdAt ?? null
}

/**
 * 只根据实时数据算出当前仍在发生的告警。不读处理表,也不写任何东西。
 *
 * 返回值同时给出精确总数与截断条数:调用方可以列出一部分,但必须如实说有多少条。
 */
export async function collectDerivedAlerts(
  prisma: PrismaService,
  now: Date,
): Promise<DerivedAlertCollection> {
  const nowMs = now.getTime()
  const alerts: DerivedAlert[] = []

  const terminals = (await prisma.terminal.findMany({
    select: TERMINAL_SELECT,
  })) as unknown as TerminalRow[]

  const printerIssueIds: string[] = []
  for (const t of terminals) {
    const lastHeartbeat = t.heartbeats[0]
    const lastSeen = lastHeartbeat?.createdAt ?? t.registeredAt
    const offlineMs = nowMs - lastSeen.getTime()
    if (offlineMs < ONLINE_WINDOW_MS && lastHeartbeat?.printerStatus && !isHealthyPrinterStatus(lastHeartbeat.printerStatus)) {
      printerIssueIds.push(t.id)
    }
  }

  const lastHealthyAt = new Map<string, Date>()
  if (printerIssueIds.length > 0) {
    const grouped = await prisma.terminalHeartbeat.groupBy({
      by: ['terminalId'],
      where: {
        terminalId: { in: printerIssueIds },
        printerStatus: { in: [...HEALTHY_PRINTER_STATUS_VALUES] },
      },
      _max: { createdAt: true },
    })
    for (const row of grouped) {
      if (row._max.createdAt) lastHealthyAt.set(row.terminalId, row._max.createdAt)
    }
  }

  for (const t of terminals) {
    const alert = buildTerminalAlert(t, lastHealthyAt.get(t.id) ?? null, nowMs)
    if (alert) alerts.push(alert)
  }
  // 终端类告警一台终端最多一条,总数就是列表长度,不存在截断。
  const terminalAlertCount = alerts.length

  const where = failedTaskWhere(nowMs)
  const [failedTasks, failedTotal] = await Promise.all([
    prisma.printTask.findMany({
      where,
      select: FAILED_TASK_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: PRINT_FAILED_LIST_CAP,
    }) as unknown as Promise<FailedTaskRow[]>,
    prisma.printTask.count({ where }),
  ])
  for (const task of failedTasks) {
    if (task.order?.payStatus === 'refunded') continue
    alerts.push(buildPrintFailedAlert(task))
  }

  alerts.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
  // count() 与 findMany 之间可能有新失败写入,omitted 用 max(0,…) 兜底,不出现负数。
  const omitted = Math.max(0, failedTotal - failedTasks.length)
  return {
    alerts,
    firingTotal: terminalAlertCount + Math.max(failedTotal, failedTasks.length),
    omitted,
    cap: PRINT_FAILED_LIST_CAP,
  }
}

/**
 * 单条正向查证:直接问「这一个主体现在还满足告警条件吗」。
 *
 * 处置端点用它而不是扫 collectDerivedAlerts 的列表,原因有二:
 *   1. 列表有物化上限,用列表判定会让被截断的告警变成「不存在」,操作员既看不到
 *      也处置不了;
 *   2. 这是正向查证——回 null 表示我们确实查过这个主体并且条件不成立,
 *      而不是「这次列表里没看见」。缺席不能当证据。
 */
export async function resolveDerivedAlert(
  prisma: PrismaService,
  type: DerivedAlertType,
  subjectId: string,
  now: Date,
): Promise<DerivedAlert | null> {
  const nowMs = now.getTime()

  if (type === 'print_failed') {
    const task = (await prisma.printTask.findFirst({
      where: { id: subjectId, ...failedTaskWhere(nowMs) },
      select: FAILED_TASK_SELECT,
    })) as unknown as FailedTaskRow | null
    if (!task || task.order?.payStatus === 'refunded') return null
    return buildPrintFailedAlert(task)
  }

  const terminal = (await prisma.terminal.findUnique({
    where: { id: subjectId },
    select: TERMINAL_SELECT,
  })) as unknown as TerminalRow | null
  if (!terminal) return null

  const needsHealthy = type === 'printer_issue'
  const alert = buildTerminalAlert(
    terminal,
    needsHealthy ? await lastHealthyHeartbeatAt(prisma, terminal.id) : null,
    nowMs,
  )
  // 同一台终端只会命中离线或打印机异常之一;类型对不上说明这一类当前没有在发生。
  return alert && alert.type === type ? alert : null
}
