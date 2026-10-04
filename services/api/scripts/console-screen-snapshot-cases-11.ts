import { assert } from './console-screen-snapshot-cases-01'
import { assertServiceContractPhase1 } from './console-screen-snapshot-cases-10'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertServiceContractPhase2(context: Awaited<ReturnType<typeof assertServiceContractPhase1>>) {
const { prisma, screen, suffix, orgA, orgB, termA, termB, memberId, now, yesterdayInstant } = context
await prisma.order.createMany({
      data: [
        {
          orderNo: `SCRN-Y-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 5,
          payStatus: 'paid',
          taskStatus: 'completed',
          createdAt: now,
          paidAt: yesterdayInstant,
          printParamsJson: JSON.stringify({ copies: 13 }),
        },
        {
          orderNo: `SCRN-T-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 7,
          payStatus: 'paid',
          taskStatus: 'completed',
          createdAt: yesterdayInstant,
          paidAt: now,
          printParamsJson: JSON.stringify({ copies: 11 }),
        },
        {
          orderNo: `SCRN-U-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 100,
          payStatus: 'unpaid',
          taskStatus: 'pending',
          printParamsJson: JSON.stringify({ copies: 2 }),
        },
        {
          orderNo: `SCRN-R-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 80,
          payStatus: 'refunded',
          taskStatus: 'completed',
          paidAt: now,
          printParamsJson: JSON.stringify({ copies: 4 }),
        },
        {
          orderNo: `SCRN-P-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 40,
          payStatus: 'paying',
          taskStatus: 'pending',
          printParamsJson: JSON.stringify({ copies: 3 }),
        },
      ],
    })
await prisma.aiServiceLog.createMany({
      data: [
        { operation: 'parseResume', status: 'success', latencyMs: 100, estimatedCostCny: 0.2, terminalId: termA, createdAt: now },
        { operation: 'parseResume', status: 'failed', latencyMs: 20, terminalId: termA, createdAt: now },
      ],
    })
const jumpQualified = `公共就业-${suffix}`
const jumpSmall = `小样本-${suffix}`
await prisma.externalJumpLog.createMany({
      data: [
        ...Array.from({ length: 20 }, (_, i) => ({
          endUserId: memberId, targetType: 'job', targetId: `job-big-${suffix}-${i}`, action: 'external_apply',
          sourceName: jumpQualified, createdAt: now, expiresAt: new Date(now.getTime() + 86400000),
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          endUserId: memberId, targetType: 'job', targetId: `job-small-${suffix}-${i}`, action: 'external_apply',
          sourceName: jumpSmall, createdAt: now, expiresAt: new Date(now.getTime() + 86400000),
        })),
      ],
    })
const gov = await screen.getAdminSnapshot('gov')
assert(
      '3a2. gov 走同一份 derived alerts 与 24h 任务流',
      context.alertCalls === 1
        && gov.metrics.alertsRealtime?.available === true
        && gov.metrics.alertsRealtime.source === 'derived-alerts'
        && gov.metrics.alertsRealtime.window === 'current'
        && gov.metrics.taskFlow24h?.available === true
        && gov.metrics.taskFlow24h.source === 'PrintTask/ScanTask.groupBy(status)'
        && gov.metrics.taskFlow24h.window === '24h',
      `alertCalls=${context.alertCalls} alerts=${JSON.stringify(gov.metrics.alertsRealtime)?.slice(0, 180)} flow=${JSON.stringify(gov.metrics.taskFlow24h)?.slice(0, 180)}`,
    )
const ops = await screen.getAdminSnapshot('ops')
assert(
      '3a3. ops 命中同一 admin:alerts 缓存，任务流与告警与 gov 相同',
      context.alertCalls === 1
        && JSON.stringify(ops.metrics.alertsRealtime) === JSON.stringify(gov.metrics.alertsRealtime)
        && JSON.stringify(ops.metrics.taskFlow24h) === JSON.stringify(gov.metrics.taskFlow24h),
      `alertCalls=${context.alertCalls}`,
    )
const partnerA = await screen.getPartnerSnapshot(orgA)
const partnerB = await screen.getPartnerSnapshot(orgB)
assert(
      '3a. gov 含 visitCount（已接入，W-69），同时含任务流与告警',
      Boolean(gov.metrics.visitCount && gov.metrics.visitCount.available === true && gov.metrics.alertsRealtime && gov.metrics.taskFlow24h),
    )
assert('3b. ops 含 alerts 且不含 visitCount', Boolean(ops.metrics.alertsRealtime && !ops.metrics.visitCount))
assert(
      '3c. 服务人次按今日会话计，本夹具没写会话就是真 0（不是未接入）',
      gov.metrics.visitCount?.available === true
        && gov.metrics.visitCount.window === 'shanghai-day'
        && gov.metrics.visitCount.value === 0,
    )
assert(
      '3d. Partner A 只看到本机构在架岗位 1，不含 B 的 2',
      partnerA.metrics.jobsOnShelf?.available === true
        && partnerA.metrics.jobsOnShelf.value.published === 1,
      partnerA.metrics.jobsOnShelf?.available ? `published=${partnerA.metrics.jobsOnShelf.value.published}` : 'unavailable',
    )
assert(
      '3d2. Partner A 机队不含 B 的终端',
      partnerA.metrics.terminalsOnline?.available === true
        && partnerB.metrics.terminalsOnline?.available === true
        && partnerA.metrics.terminalsOnline.value.matchedCount === 1
        && partnerA.metrics.terminalsOnline.value.sampledCount === 1
        && partnerB.metrics.terminalsOnline.value.matchedCount === 1
        && partnerB.metrics.terminalsOnline.value.sampledCount === 1
        && Number(partnerA.metrics.terminalsOnline.value.matchedCount) !== 2,
      partnerA.metrics.terminalsOnline?.available && partnerB.metrics.terminalsOnline?.available
        ? `A matched=${partnerA.metrics.terminalsOnline.value.matchedCount} B matched=${partnerB.metrics.terminalsOnline.value.matchedCount}`
        : 'unavailable',
    )
const wallA = partnerA.metrics.fleetWall
const cellA = wallA?.available === true ? wallA.value.cells[0] : undefined
const wallB = partnerB.metrics.fleetWall
const cellB = wallB?.available === true ? wallB.value.cells[0] : undefined
const govCells = gov.metrics.fleetWall?.available === true ? gov.metrics.fleetWall.value.cells : []
assert(
      '5a. Partner A 格子带落点且正在打印，响应不含机构 B 的 terminalId',
      wallA?.available === true
        && wallA.value.cells.length === 1
        && cellA?.health === 'healthy'
        && cellA.terminalId === termA
        && cellA.terminalCode === `SCRN-A-${suffix}`
        && cellA.displayName === '天河一体机'
        && cellA.areaLabel === '天河区'
        && cellA.geo?.lat === 23.125
        && cellA.geo.lng === 113.5
        && cellA.activity === 'printing'
        && cellA.alert === null
        && !JSON.stringify(wallA).includes(termB),
    )
assert(
      '5a2. 机队格子带服务点位，未设置则为 null',
      cellA?.locationLabel === '体育中心'
        && cellB?.locationLabel === null
        && govCells.find((cell) => cell.terminalId === termA)?.locationLabel === '体育中心'
        && govCells.find((cell) => cell.terminalId === termB)?.locationLabel === null,
      `A=${String(cellA?.locationLabel)} B=${String(cellB?.locationLabel)}`,
    )
return carryContext(context, { jumpQualified, jumpSmall, gov, ops, partnerA, partnerB, wallA, cellA, wallB, cellB, govCells })
}
