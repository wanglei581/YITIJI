
import { assert } from './console-screen-snapshot-cases-01'
import { assertTwinCasesPhase2 } from './console-screen-snapshot-cases-16'
import { carryContext } from './console-screen-snapshot-cases-18'
import { PrismaService } from '../src/prisma/prisma.service'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { assertTwinCasesSetup } from './console-screen-snapshot-cases-14'
import { assertTwinCasesPhase1 } from './console-screen-snapshot-cases-15'



export async function assertTwinCasesPhase3(context: Awaited<ReturnType<typeof assertTwinCasesPhase2>>) {
const { prisma, screen, cache, ids, retryId, retryDone, retryStart, retryTaskId } = context
await prisma.printTask.create({
    data: {
      id: retryTaskId,
      terminalId: retryId,
      fileUrl: 'https://internal/retry-secret',
      fileMd5: 'md5retry',
      paramsJson: '{}',
      status: 'completed',
      claimedAt: retryStart,
      completedAt: null,
      createdAt: retryStart,
    },
  })
await prisma.printTaskStatusLog.createMany({
    data: [
      ...Array.from({ length: 24 }, (_, index) => ({
        taskId: retryTaskId,
        fromStatus: index === 0 ? 'claimed' : 'printing',
        toStatus: 'printing',
        createdAt: new Date(retryStart.getTime() + index * 1_000),
      })),
      { taskId: retryTaskId, fromStatus: 'printing', toStatus: 'completed', createdAt: retryDone },
    ],
  })
await prisma.terminalHeartbeat.create({
    data: { terminalId: retryId, status: 'online', printerStatus: 'ready', createdAt: new Date() },
  })
cache.clear()
const retryTwin = await screen.getAdminTerminalTwin(retryId)
const retrySegments = retryTwin.timeline24h.available ? retryTwin.timeline24h.value : []
const timelineEnd = retrySegments[retrySegments.length - 1]?.to
const printing = retrySegments.filter((segment) => String(segment.state) === 'printing')
assert(
    '5u. 25 次流转后已完成的任务不会被画成打印到现在',
    retryTwin.timeline24h.available === true
      && printing.length === 0
      && timelineEnd !== undefined
      && !printing.some((segment) => segment.to === timelineEnd)
      && printing.every((segment) => segment.to !== timelineEnd),
    `end=${timelineEnd ?? 'none'} done=${retryDone.toISOString()} printing=${printing.map((segment) => `${segment.from}->${segment.to}`).join(',') || 'none'}`,
  )
const cutoffId = `term_scrn_cutoff_${ids.suffix}`
const cutoffDone = new Date(Date.now() - 45 * 60_000)
const cutoffStart = new Date(cutoffDone.getTime() - 25_000)
const cutoffTaskId = `pt_scrn_cutoff_${ids.suffix}`
await prisma.terminal.create({
    data: {
      id: cutoffId,
      terminalCode: `SCRN-CUT-${ids.suffix}`,
      agentToken: `tok_cut_${ids.suffix}`,
      deviceFingerprint: `fp_cut_${ids.suffix}`,
      orgId: ids.orgA,
      enabled: true,
    },
  })
await prisma.printTask.create({
    data: {
      id: cutoffTaskId,
      terminalId: cutoffId,
      fileUrl: 'https://internal/cutoff-secret',
      fileMd5: 'md5cutoff',
      paramsJson: '{}',
      status: 'completed',
      claimedAt: cutoffStart,
      completedAt: cutoffDone,
      createdAt: cutoffStart,
    },
  })
await prisma.printTaskStatusLog.createMany({
    data: Array.from({ length: 25 }, (_, index) => ({
      taskId: cutoffTaskId,
      fromStatus: index === 0 ? 'claimed' : 'printing',
      toStatus: 'printing',
      createdAt: new Date(cutoffStart.getTime() + index * 1_000),
    })),
  })
await prisma.terminalHeartbeat.create({
    data: { terminalId: cutoffId, status: 'online', printerStatus: 'ready', createdAt: new Date() },
  })
cache.clear()
const cutoffTwin = await screen.getAdminTerminalTwin(cutoffId)
const cutoffSegments = cutoffTwin.timeline24h.available ? cutoffTwin.timeline24h.value : []
const cutoffEnd = cutoffSegments[cutoffSegments.length - 1]?.to
const cutoffPrinting = cutoffSegments.filter((segment) => String(segment.state) === 'printing')
assert(
    '5v. 结束日志被截掉但任务已 completed 时，用 completedAt 收口，不画到现在',
    cutoffTwin.timeline24h.available === true
      && cutoffPrinting.length === 0
      && cutoffEnd !== undefined
      && cutoffPrinting.every((segment) => segment.to === cutoffDone.toISOString() && segment.to !== cutoffEnd),
    `end=${cutoffEnd ?? 'none'} done=${cutoffDone.toISOString()} printing=${cutoffPrinting.map((segment) => segment.to).join(',') || 'none'}`,
  )
const boundId = `term_scrn_bound_${ids.suffix}`
const boundAt = new Date()
await prisma.terminal.create({
    data: {
      id: boundId,
      terminalCode: `SCRN-BND-${ids.suffix}`,
      agentToken: `tok_bnd_${ids.suffix}`,
      deviceFingerprint: `fp_bnd_${ids.suffix}`,
      orgId: ids.orgA,
      enabled: true,
      locationLabel: '边界点位',
    },
  })
await prisma.printTask.createMany({
    data: Array.from({ length: 4 }, (_, index) => ({
      id: `pt_bnd_${ids.suffix}_${index}`,
      terminalId: boundId,
      fileUrl: `https://internal/bound-${index}`,
      fileMd5: `md5bnd${index}${ids.suffix}`,
      paramsJson: '{}',
      status: 'completed',
      createdAt: boundAt,
    })),
  })
await prisma.printTaskStatusLog.create({
    data: {
      taskId: `pt_bnd_${ids.suffix}_0`,
      fromStatus: 'printing',
      toStatus: 'failed',
      createdAt: boundAt,
    },
  })
await prisma.order.create({
    data: {
      orderNo: `SCRN-BND-${ids.suffix}`,
      type: 'print',
      terminalId: boundId,
      amountCents: 10,
      billablePages: 5,
      payStatus: 'paid',
      taskStatus: 'completed',
      paidAt: boundAt,
    },
  })
cache.clear()
const adminBound = await screen.getAdminTerminalTwin(boundId)
const partnerBound = await screen.getPartnerTerminalTwin(ids.orgA, boundId)
assert(
    '5w. 终端当日计数：扫描 0、失败 1 次与打印任务 4 笔都少于 5、打印页数因没有出纸完成时间是 0；管理员与机构相同',
    adminBound.today.scans === 0
      && adminBound.today.failed === null
      && adminBound.today.printTasks === null
      && adminBound.today.printPages === 0
      && Number(adminBound.today.printPages) !== 5
      && partnerBound.today.scans === adminBound.today.scans
      && partnerBound.today.failed === adminBound.today.failed
      && partnerBound.today.printTasks === adminBound.today.printTasks
      && partnerBound.today.printPages === adminBound.today.printPages
      && partnerBound.audience === 'partner',
    `admin=${JSON.stringify(adminBound.today)} partner=${JSON.stringify(partnerBound.today)}`,
  )
return carryContext(context, { retryTwin, retrySegments, timelineEnd, printing, cutoffId, cutoffDone, cutoffStart, cutoffTaskId, cutoffTwin, cutoffSegments, cutoffEnd, cutoffPrinting, boundId, boundAt, adminBound, partnerBound })
}


export async function assertTwinCases(
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
): Promise<void> {
const context = await assertTwinCasesSetup(prisma, screen, cache, ids)
const phase1 = await assertTwinCasesPhase1(context)
const phase2 = await assertTwinCasesPhase2(phase1)
await assertTwinCasesPhase3(phase2)

}
