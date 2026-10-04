import { verifyTimelinePrivacy } from './support/console-screen-timeline-privacy'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ConsoleScreenUsageService } from '../src/console-screen/console-screen.usage.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { visitMetric } from '../src/console-screen/console-screen.visits'
import { shanghaiDayStart } from '../src/console-screen/console-screen.metric'
import { SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { assert, metricValue, isValue, isBelowThreshold, passed, failed, prepareDatabase, assertPrintedPages } from './console-screen-printed-visits-cases-01'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { assertPrintedDayBuckets } from './console-screen-printed-visits-cases-03'



export async function assertVisits(prisma: Prisma, screen: ConsoleScreenService, cache: ScreenSnapshotCache): Promise<void> {
  console.log('\n── W-69 服务人次 ──')
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const orgA = `org_w69_a_${suffix}`
  const orgB = `org_w69_b_${suffix}`
  const orgZero = `org_w69_z_${suffix}`
  const termA1 = `term_w69_a1_${suffix}`
  const termA2 = `term_w69_a2_${suffix}`
  const termB = `term_w69_b_${suffix}`
  const termZ = `term_w69_z_${suffix}`
  await prisma.organization.createMany({
    data: [
      { id: orgA, name: '服务人次机构A', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
      { id: orgB, name: '服务人次机构B', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
      { id: orgZero, name: '服务人次空机构', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
    ],
  })
  await prisma.terminal.createMany({
    data: [
      { id: termA1, terminalCode: `W69-A1-${suffix}`, agentToken: `tok_a1_${suffix}`, deviceFingerprint: 'fp', orgId: orgA, enabled: true },
      { id: termA2, terminalCode: `W69-A2-${suffix}`, agentToken: `tok_a2_${suffix}`, deviceFingerprint: 'fp', orgId: orgA, enabled: true },
      { id: termB, terminalCode: `W69-B-${suffix}`, agentToken: `tok_b_${suffix}`, deviceFingerprint: 'fp', orgId: orgB, enabled: true },
      { id: termZ, terminalCode: `W69-Z-${suffix}`, agentToken: `tok_z_${suffix}`, deviceFingerprint: 'fp', orgId: orgZero, enabled: true },
    ],
  })
  const now = new Date()
  const dayStart = shanghaiDayStart(now)
  const today = new Date(dayStart.getTime() + Math.floor((now.getTime() - dayStart.getTime()) / 2))
  const yesterday = new Date(dayStart.getTime() - 60 * 60 * 1000)
  const sessions = (terminalId: string, orgId: string, count: number, startedAt: Date) =>
    Array.from({ length: count }, () => ({
      terminalId,
      orgId,
      clientSessionId: randomUUID(),
      startedAt,
      lastActiveAt: startedAt,
      expiresAt: new Date(startedAt.getTime() + 30 * 60 * 1000),
    }))
  await prisma.kioskSession.createMany({
    data: [
      ...sessions(termA1, orgA, 6, today),
      ...sessions(termA2, orgA, 2, today),
      ...sessions(termB, orgB, 3, today),
      // A1 改绑前属于 B 时留下的会话：管理员计数；机构 A 不认（快照不是 A），机构 B 也不认（终端已不属 B）。
      ...sessions(termA1, orgB, 1, today),
      ...sessions(termA1, orgA, 4, yesterday),
    ],
  })

  cache.clear()
  const gov = await screen.getAdminSnapshot('gov')
  const ops = await screen.getAdminSnapshot('ops')
  const partnerA = await screen.getPartnerSnapshot(orgA)
  const partnerB = await screen.getPartnerSnapshot(orgB)
  const partnerZero = await screen.getPartnerSnapshot(orgZero)
  assert(
    'v1. 政务版服务人次 = 今日全部会话 12（6+2+3+1），不再是「会话未写入」',
    isValue(gov.metrics.visitCount, 12)
      && gov.metrics.visitCount?.window === 'shanghai-day'
      && gov.metrics.visitCount.source === 'KioskSession.startedAt',
    String(metricValue(gov.metrics.visitCount)),
  )
  assert('v2. 运营版仍不含服务人次', ops.metrics.visitCount === undefined)
  assert('v3. 机构 A 快照 = 8（只数本机构快照且终端仍属本机构）', isValue(partnerA.metrics.visitCount, 8), String(metricValue(partnerA.metrics.visitCount)))
  assert('v4. 机构 B 今日 3 人次：样本不足，不给数', isBelowThreshold(partnerB.metrics.visitCount), String(metricValue(partnerB.metrics.visitCount)))
  assert('v5. 没有会话的机构给 0（真的没有），不是未接入', isValue(partnerZero.metrics.visitCount, 0), String(metricValue(partnerZero.metrics.visitCount)))

  await verifyTimelinePrivacy(assert, prisma, termA1)
  const usage = new ConsoleScreenUsageService(prisma, new ScreenSnapshotCache())
  const adminToday = await usage.getAdminUsage('today', now)
  const admin7d = await usage.getAdminUsage('7d', now)
  const partnerAToday = await usage.getPartnerUsage(orgA, 'today', now)
  const partnerA7d = await usage.getPartnerUsage(orgA, '7d', now)
  const partnerBToday = await usage.getPartnerUsage(orgB, 'today', now)
  const partnerZeroToday = await usage.getPartnerUsage(orgZero, 'today', now)
  assert('v10z. 服务调用无会话时真实计数返回 0', isValue(partnerZeroToday.metrics.visits, 0))
  assert('v6. 服务调用（管理员，今日）服务人次 = 12', isValue(adminToday.metrics.visits, 12), String(metricValue(adminToday.metrics.visits)))
  assert('v7. 服务调用（管理员，近 7 天）只含昨日4，样本不足', isBelowThreshold(admin7d.metrics.visits), String(metricValue(admin7d.metrics.visits)))
  assert('v8. 服务调用（机构 A，今日）= 8', isValue(partnerAToday.metrics.visits, 8), String(metricValue(partnerAToday.metrics.visits)))
  assert('v9. 服务调用（机构 A，近 7 天）昨日4，样本不足', isBelowThreshold(partnerA7d.metrics.visits), String(metricValue(partnerA7d.metrics.visits)))
  assert('v10. 服务调用（机构 B，今日 3）样本不足', isBelowThreshold(partnerBToday.metrics.visits), String(metricValue(partnerBToday.metrics.visits)))
  assert('v11. 服务调用窗口随 range 走', adminToday.metrics.visits?.window === 'today' && admin7d.metrics.visits?.window === '7d')

  const twinAdminA1 = await screen.getAdminTerminalTwin(termA1)
  const twinPartnerA1 = await screen.getPartnerTerminalTwin(orgA, termA1)
  const twinAdminA2 = await screen.getAdminTerminalTwin(termA2)
  const twinAdminZ = await screen.getAdminTerminalTwin(termZ)
  assert('v12. 单台（管理员）A1 今日 = 7（含改绑前留下的 1 次）', isValue(twinAdminA1.today.visits, 7), String(metricValue(twinAdminA1.today.visits)))
  assert('v13. 单台（机构 A）A1 今日 = 6（只认本机构快照）', isValue(twinPartnerA1.today.visits, 6), String(metricValue(twinPartnerA1.today.visits)))
  assert('v14. 单台 A2 今日 2：样本不足', isBelowThreshold(twinAdminA2.today.visits), String(metricValue(twinAdminA2.today.visits)))
  assert('v15. 单台没有会话给 0', isValue(twinAdminZ.today.visits, 0), String(metricValue(twinAdminZ.today.visits)))

  const texts = JSON.stringify([gov, partnerA, partnerB, partnerZero, adminToday, admin7d, partnerAToday, partnerBToday, twinAdminA1, twinPartnerA1, twinAdminA2])
  assert('v16. 六处响应里不再出现「会话未写入」', !texts.includes(SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten))
  assert(
    'v17. 取数失败如实标本次没有取到，不给 0',
    (() => {
      const m = visitMetric({ ok: false, reason: SCREEN_UNAVAILABLE_REASON.sourceQueryFailed }, 'today', true)
      return m.available === false && m.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed && !('value' in m)
    })(),
  )
  const shared = readFileSync(join(__dirname, '..', '..', '..', 'packages/shared/src/types/consoleScreen.ts'), 'utf8')
  assert(
    'v18. 共享契约：visitCount / visits 放开为 ScreenMetric<number>',
    /visitCount\?: ScreenMetric<number>/.test(shared) && /visits\?: ScreenMetric<number>/.test(shared),
  )
}


export async function main(): Promise<void> {
  console.log('\n=== 数据大屏：累计打印页数与服务人次 ===')
  const db = prepareDatabase()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    const cache = new ScreenSnapshotCache()
    const screen = new ConsoleScreenService(prisma, new AdminOpsService(prisma), cache)
    const orgId = `org_w68_${randomUUID().slice(0, 8)}`
    const terminalId = `term_w68_${randomUUID().slice(0, 8)}`
    await prisma.organization.create({ data: { id: orgId, name: '出纸机构', type: 'school_employment_center', sceneTemplate: 'school', enabled: true } })
    await prisma.terminal.create({ data: { id: terminalId, terminalCode: `W68-${terminalId}`, agentToken: `tok_${terminalId}`, deviceFingerprint: 'fp', orgId, enabled: true } })
    await assertPrintedPages(prisma, screen, cache, terminalId)
    await assertPrintedDayBuckets(prisma, screen, cache, orgId)
    await assertVisits(prisma, screen, cache)
  } finally {
    await prisma.onModuleDestroy()
    db.cleanup()
  }
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`)
  if (failed > 0) {
    console.error('\n❌ verify:console-screen-printed-visits FAILED')
    process.exit(1)
  }
  console.log('\n✅ verify:console-screen-printed-visits PASSED')
}


export type Prisma = PrismaService

export interface PrintFixture {
  pages: number
  copies: unknown
  status: string
  errorCode?: string
  printOutcome?: string | null
  payStatus?: string
}

export interface DayPrintInput {
  pages: number
  copies: number
  status: string
  completedAt: Date | null
  paidAt: Date | null
  printOutcome?: string | null
  errorCode?: string | null
  itemPages?: number
  itemCopies?: number
}


export function carryContext<A extends object, B extends object>(before: A, next: B): A & B {
  return Object.defineProperties({ ...before, ...next }, { ...Object.getOwnPropertyDescriptors(before), ...Object.getOwnPropertyDescriptors(next) })
}
