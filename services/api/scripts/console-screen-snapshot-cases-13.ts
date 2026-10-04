
import { SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { FLEET_SAMPLE_TAKE, PARTNER_FLEET_TAKE } from '../src/console-screen/console-screen.metric'
import { assert } from './console-screen-snapshot-cases-01'
import { assertRecruitmentHostingContract } from './console-screen-snapshot-cases-09'
import { assertServiceContractPhase3 } from './console-screen-snapshot-cases-12'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertServiceContractPhase4(context: Awaited<ReturnType<typeof assertServiceContractPhase3>>) {
const { prisma, cache, opsService, originalListDerivedAlerts, screen, suffix, orgA, orgB, userA, userB, adminId, memberId, userBlank, resumeFileName, now, phoneEnc, pickupCode, jumpQualified, jumpSmall, gov, ops, partnerA, partnerB } = context
const secrets = [
      'https://internal/secret',
      'https://internal/hist1',
      'https://internal/hist2',
      'https://internal/hist3',
      'https://internal/ok',
      `tok_a_${suffix}`,
      `tok_b_${suffix}`,
      `ph_${suffix}`,
      phoneEnc,
      pickupCode,
      memberId,
      userA,
      userB,
      adminId,
      userBlank,
      `fp_a_${suffix}`,
      `fp_b_${suffix}`,
      `file_scrn_${suffix}`,
      resumeFileName,
      'md5h1',
      'md5h2',
      'md5h3',
      'md5ok',
    ]
const asText = JSON.stringify({ gov, ops, partnerA, partnerB })
const leaked = secrets.filter((secret) => asText.includes(secret))
assert(
      '3j2. 序列化快照不含敏感种子值',
      leaked.length === 0,
      `命中 ${leaked.join(',')}`,
    )
assert('3k. 响应不含投递成功等违禁文案', !/投递成功|一键投递|立即投递|平台投递/.test(asText))
assert('3l. Partner 响应 audience=partner 且 generatedAt 为 ISO', partnerA.audience === 'partner' && /\d{4}-\d{2}-\d{2}T/.test(partnerA.generatedAt))
await assertRecruitmentHostingContract(prisma, screen, {
      orgA,
      orgB,
      memberId,
      suffix,
      now,
      jumpQualified,
      jumpSmall,
    })
let fleetCalls = 0
let seenFleetTake: unknown
const originalFindMany = prisma.terminal.findMany.bind(prisma.terminal)
prisma.terminal.findMany = (async (args?: unknown) => {
      fleetCalls += 1
      seenFleetTake = args && typeof args === 'object' ? (args as { take?: unknown }).take : undefined
      return originalFindMany(args as never)
    }) as typeof prisma.terminal.findMany
cache.clear()
const firstGov = await screen.getAdminSnapshot('gov')
const secondOps = await screen.getAdminSnapshot('ops')
assert(
      '3m. gov/ops 共享 realtime 缓存，fleet 只打一次且 take 有界',
      fleetCalls === 1 && seenFleetTake === FLEET_SAMPLE_TAKE,
      `calls=${fleetCalls} take=${String(seenFleetTake)}`,
    )
assert('3n. 第二次命中 realtime 缓存', firstGov.freshness.realtime === 'miss' && secondOps.freshness.realtime === 'hit')
prisma.terminal.findMany = originalFindMany
const orgEmpty = `org_scrn_empty_${suffix}`
await prisma.organization.create({
      data: { id: orgEmpty, name: '大屏空机构', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
    })
const emptyPartner = await screen.getPartnerSnapshot(orgEmpty)
assert(
      '3o. 空机构在架岗位 available:true 且 published=0，不是未接入',
      emptyPartner.status === 'ok'
        && emptyPartner.metrics.jobsOnShelf?.available === true
        && emptyPartner.metrics.jobsOnShelf.value.published === 0,
    )
await prisma.organization.delete({ where: { id: orgEmpty } })
cache.clear()
prisma.terminal.findMany = (async () => {
      throw new Error('fleet slice down')
    }) as typeof prisma.terminal.findMany
const degradedGov = await screen.getAdminSnapshot('gov')
prisma.terminal.findMany = originalFindMany
assert(
      '3p. 局部失败：机队 unavailable，其它计数仍在，status=degraded',
      degradedGov.status === 'degraded'
        && degradedGov.degraded
        && degradedGov.metrics.terminalsOnline?.available === false
        && degradedGov.metrics.terminalsOnline.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed
        && degradedGov.metrics.jobsOnShelf?.available === true,
    )
cache.clear()
let fleetAttempts = 0
prisma.terminal.findMany = (async (args?: unknown) => {
      fleetAttempts += 1
      if (fleetAttempts === 1) throw new Error('transient fleet down')
      return originalFindMany(args as never)
    }) as typeof prisma.terminal.findMany
const failedThen = await screen.getAdminSnapshot('gov')
const recovered = await screen.getAdminSnapshot('gov')
prisma.terminal.findMany = originalFindMany
assert(
      '3r. 失败切片不入缓存，第二次会重新 load 且成功才缓存',
      failedThen.metrics.terminalsOnline?.available === false
        && recovered.metrics.terminalsOnline?.available === true
        && fleetAttempts === 2
        && recovered.freshness.realtime === 'miss',
      `attempts=${fleetAttempts}`,
    )
cache.clear()
const cachedOk = await screen.getAdminSnapshot('gov')
const cachedOk2 = await screen.getAdminSnapshot('ops')
assert(
      '3s. 成功结果才缓存',
      cachedOk.freshness.realtime === 'miss' && cachedOk2.freshness.realtime === 'hit',
    )
cache.clear()
opsService.listDerivedAlerts = (async () => {
      throw new Error('alerts slice down')
    }) as AdminOpsService['listDerivedAlerts']
const govAlertsDown = await screen.getAdminSnapshot('gov')
const opsAlertsDown = await screen.getAdminSnapshot('ops')
opsService.listDerivedAlerts = (async (view, limit) => {
      context.alertCalls += 1
      return originalListDerivedAlerts(view, limit)
    }) as AdminOpsService['listDerivedAlerts']
assert(
      '3v. 告警源失败时 gov 与 ops 一起 degraded，任务流仍在',
      govAlertsDown.status === 'degraded'
        && govAlertsDown.degraded === true
        && govAlertsDown.metrics.alertsRealtime?.available === false
        && govAlertsDown.metrics.alertsRealtime.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed
        && govAlertsDown.metrics.taskFlow24h?.available === true
        && govAlertsDown.metrics.terminalsOnline?.available === true
        && opsAlertsDown.status === 'degraded'
        && opsAlertsDown.metrics.alertsRealtime?.available === false
        && opsAlertsDown.metrics.alertsRealtime.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed
        && JSON.stringify(govAlertsDown.metrics.alertsRealtime) === JSON.stringify(opsAlertsDown.metrics.alertsRealtime),
      `gov=${govAlertsDown.status} ops=${opsAlertsDown.status}`,
    )
const extra = Array.from({ length: PARTNER_FLEET_TAKE }, (_, i) => ({
      id: `term_scrn_cap_${suffix}_${i}`,
      terminalCode: `SCRN-CAP-${suffix}-${String(i).padStart(3, '0')}`,
      agentToken: `tok_cap_${suffix}_${i}`,
      deviceFingerprint: `fp_cap_${suffix}_${i}`,
      orgId: orgA,
      enabled: true,
    }))
await prisma.terminal.createMany({ data: extra })
await prisma.terminalHeartbeat.createMany({
      data: extra.map((row) => ({ terminalId: row.id, status: 'online', createdAt: now })),
    })
cache.clear()
const cappedPartner = await screen.getPartnerSnapshot(orgA)
const online = cappedPartner.metrics.terminalsOnline
const wall = cappedPartner.metrics.fleetWall
const sampleSum = online?.available === true
      ? online.value.healthy + online.value.degraded + online.value.offline + online.value.unknown
      : -1
return carryContext(context, { secrets, asText, leaked, get fleetCalls() { return fleetCalls }, set fleetCalls(value: typeof fleetCalls) { fleetCalls = value }, get seenFleetTake() { return seenFleetTake }, set seenFleetTake(value: typeof seenFleetTake) { seenFleetTake = value }, originalFindMany, firstGov, secondOps, orgEmpty, emptyPartner, degradedGov, get fleetAttempts() { return fleetAttempts }, set fleetAttempts(value: typeof fleetAttempts) { fleetAttempts = value }, failedThen, recovered, cachedOk, cachedOk2, govAlertsDown, opsAlertsDown, extra, cappedPartner, online, wall, sampleSum })
}
