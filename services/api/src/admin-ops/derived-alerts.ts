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

/**
 * 只根据实时数据算出当前仍在发生的告警。不读处理表。
 *
 * 退款排除：RefundService 完成路径只写 Order.payStatus='refunded'，
 * 明确不改 PrintTask / printOutcome。这里按订单退款态过滤，禁止伪造出纸结果。
 */
export async function collectDerivedAlerts(
  prisma: PrismaService,
  now: Date,
): Promise<DerivedAlert[]> {
  const nowMs = now.getTime()
  const alerts: DerivedAlert[] = []

  const terminals = await prisma.terminal.findMany({
    select: {
      id: true,
      terminalCode: true,
      registeredAt: true,
      heartbeats: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, printerStatus: true },
      },
    },
  })

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
    const lastHeartbeat = t.heartbeats[0]
    const lastSeen = lastHeartbeat?.createdAt ?? t.registeredAt
    const offlineMs = nowMs - lastSeen.getTime()
    if (offlineMs >= ONLINE_WINDOW_MS) {
      const minutes = Math.floor(offlineMs / 60000)
      const subjectKey = buildSubjectKey('terminal_offline', t.id)
      alerts.push({
        id: subjectKey,
        subjectKey,
        subjectId: t.id,
        episodeToken: offlineEpisodeToken(lastSeen),
        type: 'terminal_offline',
        severity: offlineMs >= 30 * 60 * 1000 ? 'error' : 'warning',
        title: `终端 ${t.terminalCode} 离线`,
        detail: `最近一次心跳在 ${minutes} 分钟前(${lastSeen.toISOString().slice(0, 16).replace('T', ' ')})`,
        terminalCode: t.terminalCode,
        occurredAt: lastSeen.toISOString(),
      })
    } else if (lastHeartbeat?.printerStatus && !isHealthyPrinterStatus(lastHeartbeat.printerStatus)) {
      const label = PRINTER_STATUS_LABELS[lastHeartbeat.printerStatus] ?? `打印机状态异常(${lastHeartbeat.printerStatus})`
      const subjectKey = buildSubjectKey('printer_issue', t.id)
      const healthyAt = lastHealthyAt.get(t.id) ?? t.registeredAt
      alerts.push({
        id: subjectKey,
        subjectKey,
        subjectId: t.id,
        episodeToken: printerIssueEpisodeToken(lastHeartbeat.printerStatus, healthyAt),
        type: 'printer_issue',
        severity: lastHeartbeat.printerStatus === 'paper_empty' ? 'warning' : 'error',
        title: `终端 ${t.terminalCode} ${label}`,
        detail: `终端在线,但最近心跳上报打印机状态为 ${lastHeartbeat.printerStatus}`,
        terminalCode: t.terminalCode,
        occurredAt: lastHeartbeat.createdAt.toISOString(),
      })
    }
  }

  const failedTasks = await prisma.printTask.findMany({
    where: {
      status: 'failed',
      updatedAt: { gte: new Date(nowMs - FAILED_LOOKBACK_MS) },
      // SQL 的 NOT IN 不匹配 NULL，必须显式收未核查任务，否则普通失败告警会全灭。
      AND: [
        {
          OR: [
            { printOutcome: null },
            { printOutcome: { notIn: ['printed', 'not_printed'] } },
          ],
        },
        // 已退款订单不再报警。退款路径写的是 Order.payStatus，不是 printOutcome。
        { NOT: { order: { payStatus: 'refunded' } } },
      ],
    },
    select: {
      id: true,
      errorCode: true,
      updatedAt: true,
      terminal: { select: { terminalCode: true } },
      order: { select: { payStatus: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })
  for (const task of failedTasks) {
    if (task.order?.payStatus === 'refunded') continue
    const subjectKey = buildSubjectKey('print_failed', task.id)
    alerts.push({
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
    })
  }

  alerts.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
  return alerts
}
