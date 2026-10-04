import { FLEET_SAMPLE_TAKE, PARTNER_FLEET_TAKE } from '../src/console-screen/console-screen.metric'
import { loadAdminFleet } from '../src/console-screen/console-screen.queries'
import { assert } from './console-screen-snapshot-cases-01'
import { assertServiceContractPhase4 } from './console-screen-snapshot-cases-13'
import { assertTwinCases } from './console-screen-snapshot-cases-17'
import { assertHttp, carryContext } from './console-screen-snapshot-cases-18'
import { assertServiceContractSetup } from './console-screen-snapshot-cases-09'
import { assertServiceContractPhase1 } from './console-screen-snapshot-cases-10'
import { assertServiceContractPhase2 } from './console-screen-snapshot-cases-11'
import { assertServiceContractPhase3 } from './console-screen-snapshot-cases-12'
import { PrismaService } from '../src/prisma/prisma.service'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'



export async function assertServiceContractPhase5(context: Awaited<ReturnType<typeof assertServiceContractPhase4>>) {
const { prisma, cache, screen, suffix, ids, now, originalFindMany, cappedPartner, online, wall, sampleSum } = context
assert(
      '3q. Partner>200 时 total 是样本、matchedCount 是全量、分类加总等于样本',
      online?.available === true
        && wall?.available === true
        && online.value.truncated
        && wall.value.truncated
        && online.value.sampledCount === PARTNER_FLEET_TAKE
        && wall.value.sampledCount === PARTNER_FLEET_TAKE
        && wall.value.cells.length === PARTNER_FLEET_TAKE
        && online.value.total === online.value.sampledCount
        && sampleSum === online.value.total
        && online.value.matchedCount === PARTNER_FLEET_TAKE + 1
        && wall.value.matchedCount === PARTNER_FLEET_TAKE + 1
        && online.value.sampleCap === PARTNER_FLEET_TAKE
        && online.value.matchedCount !== sampleSum,
      online?.available === true
        ? `total=${online.value.total} sampled=${online.value.sampledCount} matched=${online.value.matchedCount} sum=${sampleSum}`
        : 'unavailable',
    )
assert(
      '3j3. 截断机队快照仍不含 agentToken 种子',
      !JSON.stringify(cappedPartner).includes(`tok_cap_${suffix}`),
    )
cache.clear()
const adminFleet = await loadAdminFleet(prisma, now)
const adminMapped = await screen.getAdminSnapshot('ops')
const adminOnline = adminMapped.metrics.terminalsOnline
assert(
      '3t. Admin 机队同样 count + 有界 sample，禁止无界 findMany',
      adminFleet.truncated
        && adminFleet.matchedCount === PARTNER_FLEET_TAKE + 2
        && adminFleet.overview.summary.total === FLEET_SAMPLE_TAKE
        && adminOnline?.available === true
        && adminOnline.value.truncated
        && adminOnline.value.sampledCount === FLEET_SAMPLE_TAKE
        && adminOnline.value.matchedCount === PARTNER_FLEET_TAKE + 2
        && adminOnline.value.sampleCap === FLEET_SAMPLE_TAKE,
      adminOnline?.available
        ? `sampled=${adminOnline.value.sampledCount} matched=${adminOnline.value.matchedCount}`
        : `slice matched=${adminFleet.matchedCount} total=${adminFleet.overview.summary.total}`,
    )
cache.clear()
let inflightFleetLoads = 0
let releaseFleet!: () => void
const fleetGate = new Promise<void>((resolve) => {
      releaseFleet = resolve
    })
prisma.terminal.findMany = (async (args?: unknown) => {
      inflightFleetLoads += 1
      await fleetGate
      return originalFindMany(args as never)
    }) as typeof prisma.terminal.findMany
const inflightGov = screen.getAdminSnapshot('gov')
while (inflightFleetLoads < 1) await Promise.resolve()
const inflightOps = screen.getAdminSnapshot('ops')
releaseFleet()
const [leftSnap, rightSnap] = await Promise.all([inflightGov, inflightOps])
prisma.terminal.findMany = originalFindMany
assert(
      '3u. 服务层同一 realtime key 并发 miss 只 load 机队一次',
      inflightFleetLoads === 1
        && leftSnap.metrics.terminalsOnline?.available === true
        && rightSnap.metrics.terminalsOnline?.available === true,
      `loads=${inflightFleetLoads}`,
    )
await assertTwinCases(prisma, screen, cache, ids)
if (process.env['VERIFY_SKIP_HTTP'] !== '1') await assertHttp(prisma, ids)
return carryContext(context, { adminFleet, adminMapped, adminOnline, get inflightFleetLoads() { return inflightFleetLoads }, set inflightFleetLoads(value: typeof inflightFleetLoads) { inflightFleetLoads = value }, get releaseFleet() { return releaseFleet }, set releaseFleet(value: typeof releaseFleet) { releaseFleet = value }, fleetGate, inflightGov, inflightOps, leftSnap, rightSnap })
}


export async function assertServiceContract(): Promise<void> {
const context = await assertServiceContractSetup()
const { isolated, prisma, cleanup, previousHosting } = context
try {
const phase1 = await assertServiceContractPhase1(context)
const phase2 = await assertServiceContractPhase2(phase1)
const phase3 = await assertServiceContractPhase3(phase2)
const phase4 = await assertServiceContractPhase4(phase3)
await assertServiceContractPhase5(phase4)

}  finally {
    if (previousHosting === undefined) delete process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED']
    else process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = previousHosting
    await cleanup()
    await prisma.onModuleDestroy()
    isolated.cleanup()
  }

}


export async function assertTwinCasesSetup(
  prisma: PrismaService,
  screen: ConsoleScreenService,
  cache: ScreenSnapshotCache,
  ids: {
    orgA: string
    orgB: string
    termA: string
    termB: string
    adminId: string
    memberId: string
    taskA: string
    suffix: string
    resumeFileName: string
  },
){

return { prisma, screen, cache, ids }
}
