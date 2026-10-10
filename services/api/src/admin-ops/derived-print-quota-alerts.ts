import { quotaDay } from '../ai/quota/ai-quota.policy'
import type { PrismaService } from '../prisma/prisma.service'
import { readFreePrintQuotaConfig } from '../print-jobs/free-print-quota.config'
import { terminalDailyLimit } from '../print-jobs/free-print-quota.policy'
import { todayFreePrintSidesByTerminal } from '../print-jobs/free-print-quota.usage'
import { buildSubjectKey } from './derived-alert-identity'

export const PRINT_TERMINAL_QUOTA_HIGH = 'print_terminal_quota_high' as const

export interface PrintQuotaAlert {
  id: string
  subjectKey: string
  subjectId: string
  episodeToken: string
  type: typeof PRINT_TERMINAL_QUOTA_HIGH
  severity: 'error' | 'warning'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
}

/**
 * 只算仍在运营的终端（enabled 且 lifecycleStatus 为 active）。
 * 只计今天已出纸成功的免费面数，在途不出告警。
 * 达到阈值 warning，用满（100%）升 error。回合 = 终端 + 北京日期。
 */
export async function collectPrintQuotaAlerts(prisma: PrismaService, now: Date): Promise<PrintQuotaAlert[]> {
  const config = await readFreePrintQuotaConfig(prisma)
  const terminals = await prisma.terminal.findMany({
    where: { enabled: true, lifecycleStatus: 'active' },
    select: { id: true, terminalCode: true, displayName: true, dailyFreePrintSides: true },
  })
  const usedByTerminal = await todayFreePrintSidesByTerminal(prisma, terminals.map((terminal) => terminal.id), now)
  const day = quotaDay(now)
  const alerts: PrintQuotaAlert[] = []
  for (const terminal of terminals) {
    const used = usedByTerminal.get(terminal.id) ?? 0
    const limit = terminalDailyLimit(terminal.dailyFreePrintSides, config.terminalDailySides)
    if (used * 100 < limit * config.alertPercent) continue
    const name = terminal.displayName?.trim() || terminal.terminalCode
    const severity = used >= limit ? 'error' : 'warning'
    const subjectKey = buildSubjectKey(PRINT_TERMINAL_QUOTA_HIGH, terminal.id)
    alerts.push({
      id: subjectKey,
      subjectKey,
      subjectId: terminal.id,
      episodeToken: day,
      type: PRINT_TERMINAL_QUOTA_HIGH,
      severity,
      title: `终端 ${name} 今日免费打印量已达 ${used} / ${limit} 面`,
      detail: `北京时间 ${day}，已出纸 ${used} 面，上限 ${limit} 面`,
      terminalCode: terminal.terminalCode,
      occurredAt: now.toISOString(),
    })
  }
  return alerts
}

export async function resolvePrintQuotaAlert(
  prisma: PrismaService,
  subjectId: string,
  now: Date,
): Promise<PrintQuotaAlert | null> {
  const alerts = await collectPrintQuotaAlerts(prisma, now)
  return alerts.find((alert) => alert.subjectId === subjectId) ?? null
}
