import { randomUUID } from 'node:crypto'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { ConsoleScreenUsageService } from '../../src/console-screen/console-screen.usage.service'
import { ScreenSnapshotCache } from '../../src/console-screen/console-screen.cache'
import { PartnerStatsService, buildPeriodRange, type StatsPeriod } from '../../src/orgs/partner-stats.service'
import { requirePartnerOrgId } from '../../src/console-screen/console-screen.org'
import { usageWindow } from '../../src/console-screen/console-screen.usage.queries'

type Assert = (label: string, condition: boolean, detail?: string) => void
export async function verifyClosedWindows(assert: Assert, prisma: PrismaService): Promise<void> {
  const now = new Date('2030-10-04T04:00:00Z')
  const later = new Date('2030-10-04T06:00:00Z')
  const todayStart = new Date('2030-10-03T16:00:00Z')
  const yesterday = new Date('2030-10-03T04:00:00Z')
  const tag = randomUUID()
  const org = await prisma.organization.create({ data: { id: randomUUID(), name: `closed-window-${tag}`, type: 'school_employment_center', sceneTemplate: 'school' } })
  const orgId = requirePartnerOrgId(org.id)
  const terminal = await prisma.terminal.create({ data: { id: randomUUID(), terminalCode: `CW-${tag}`, agentToken: `cw-${tag}`, deviceFingerprint: tag, orgId: org.id, orgBoundAt: new Date('2030-01-01T00:00:00Z') } })
  const member = await prisma.endUser.create({ data: { id: randomUUID(), phoneHash: `cw-${tag}`, phoneEnc: `cw-${tag}` } })
  const policy = await prisma.policyPost.create({ data: { id: randomUUID(), sourceOrgId: org.id, sourceName: 'verify', title: '窗口门禁', kind: 'notice' } })
  const source = await prisma.jobSource.create({ data: { id: randomUUID(), orgId: org.id, name: 'verify', sourceKind: 'manual', accessMode: 'manual' } })
  const seed = async (at: Date, count: number) => {
    await prisma.terminalHeartbeat.create({ data: { id: randomUUID(), terminalId: terminal.id, printerStatus: at.getTime() < todayStart.getTime() ? 'error' : 'ready', createdAt: at } })
    await prisma.kioskSession.createMany({ data: Array.from({ length: count }, (_, i) => ({ id: randomUUID(), terminalId: terminal.id, orgId: org.id, clientSessionId: `${tag}-${at.toISOString()}-${i}`, startedAt: at, expiresAt: later })) })
    await prisma.printTask.createMany({ data: Array.from({ length: count }, () => ({ id: randomUUID(), terminalId: terminal.id, status: 'completed', fileUrl: 'https://verify.invalid/file', fileMd5: 'verify', paramsJson: '{}', createdAt: at, completedAt: at })) })
    await prisma.scanTask.createMany({ data: Array.from({ length: count }, () => ({ id: randomUUID(), terminalId: terminal.id, scanType: 'document', status: 'completed', expiresAt: later, createdAt: at })) })
    await prisma.externalJumpLog.createMany({ data: Array.from({ length: count }, () => ({ id: randomUUID(), endUserId: member.id, targetType: 'policy', targetId: policy.id, action: 'external_open', sourceName: `CW-${tag}`, expiresAt: later, createdAt: at })) })
    await prisma.browseLog.createMany({ data: Array.from({ length: count }, () => ({ id: randomUUID(), endUserId: member.id, targetType: 'policy', targetId: policy.id, expiresAt: later, createdAt: at })) })
    await prisma.aiServiceLog.createMany({ data: Array.from({ length: count }, () => ({ id: randomUUID(), operation: 'parseResume', status: 'success', provider: 'llm:deepseek', createdAt: at, latencyMs: 10, estimatedCostCny: 0.01 })) })
    await prisma.order.createMany({ data: Array.from({ length: count }, (_, i) => ({ id: randomUUID(), orderNo: `CW-${tag}-${at.toISOString()}-${i}`, payStatus: 'paid', paidAt: at, channel: 'kiosk', createdAt: at })) })
    await prisma.syncLog.createMany({ data: Array.from({ length: count }, () => ({ id: randomUUID(), orgId: org.id, sourceId: source.id, dataType: 'policy', syncMode: 'manual', result: 'success', addedCount: 1, createdAt: at })) })
  }
  await seed(yesterday, 7)
  await seed(new Date(now.getTime() - 60000), 3)
  await seed(todayStart, 1)
  const stats = new PartnerStatsService(prisma)
  async function snapshots(at: Date) {
    const usage = new ConsoleScreenUsageService(prisma, new ScreenSnapshotCache())
    const result: Record<string, unknown> = {}
    for (const range of ['7d', '30d'] as const) {
      const admin = await usage.getAdminUsage(range, at)
      const partner = await usage.getPartnerUsage(org.id, range, at)
      const counts = Object.fromEntries(Object.entries(admin.metrics).filter(([k]) => !['heat7d', 'pulse2h'].includes(k)))
      result[`admin-${range}`] = counts
      result[`partner-${range}`] = partner.metrics
      const visits = admin.metrics.visits
      assert(`${range}：今天3、昨天7、今天零点1，仅返回昨天7人次`, visits?.available === true && visits.value === 7)
      assert(`${range}：排除今天，边界是上海零点`, usageWindow(range, at).to.toISOString() === todayStart.toISOString())
      const top = admin.metrics.topSources30d
      assert(`${range}：独立30天榜也仅返回昨天7次`, top?.available === true && top.value.items.some((item) => item.sourceName === `CW-${tag}` && item.count === 7))
      const daily = partner.metrics.partnerDaily
      assert(`${range}：每日趋势没有今天的点`, daily?.available === true && daily.value.days.every((d) => d.date < '2030-10-04'))
    }
    for (const period of ['week', 'month', 'quarter'] as StatsPeriod[]) {
      const ops = await stats.getTerminalOperations(orgId, period, at)
      const summary = await stats.getStats(orgId, period, at)
      result[`ops-${period}`] = { visits: ops.totals.visitCount, services: ops.totals.serviceCount, output: ops.totals.output, faults: ops.totals.faults, unrecoveredTerminals: ops.totals.unrecoveredTerminals, rows: ops.terminals.map((r) => ({ visitCount: r.visitCount, serviceCount: r.serviceCount, output: r.output, faults: r.faults })) }
      result[`stats-${period}`] = { sync: summary.sync, statusDist: summary.statusDist, trend: summary.trend }
      assert(`${period}：终端各计数只含昨天7，统计同步7`, ops.totals.visitCount === 7 && ops.totals.output.printed === 7 && ops.totals.serviceCount === 14 && summary.sync.totalBatches.current === 7)
      const span = buildPeriodRange(period, at.getTime())
      assert(`${period}：前后周期相邻且趋势无今天`, span.to.toISOString() === todayStart.toISOString() && span.prevTo.getTime() === span.from.getTime() && summary.trend.every((d) => d.date < '2030-10-04'))
    }
    return result
  }
  const before = await snapshots(now)
  await seed(new Date(later.getTime() - 60000), 1)
  const after = await snapshots(later)
  assert('closed-window：同一天后移 now 并加1条，7d/30d/week/month/quarter 计数逐字段不变', JSON.stringify(before) === JSON.stringify(after))
}
