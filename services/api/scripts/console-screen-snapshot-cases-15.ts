import { NotFoundException } from '@nestjs/common'
import { SCREEN_ONLINE_WINDOW_SECONDS, SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { loadPartnerFleet } from '../src/console-screen/console-screen.queries'
import { TIMELINE_SEGMENT_CAP } from '../src/console-screen/console-screen.timeline'
import { assert } from './console-screen-snapshot-cases-01'
import { assertTwinCasesSetup } from './console-screen-snapshot-cases-14'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertTwinCasesPhase1(context: Awaited<ReturnType<typeof assertTwinCasesSetup>>) {
const { prisma, screen, cache, ids } = context
cache.clear()
const adminTwin = await screen.getAdminTerminalTwin(ids.termA)
const storedTask = await prisma.printTask.findUnique({ where: { id: ids.taskA }, select: { claimedAt: true } })
const adminText = JSON.stringify(adminTwin)
const current = adminTwin.currentTask.available ? adminTwin.currentTask.value : undefined
assert(
    '5d. 管理员孪生给出设备块，今日打印页数只计已出纸（本夹具已付内容页 10 但没出纸，所以是 0），服务人次无会话为 0，耗材不可用，且不含文件名',
    adminTwin.audience === 'admin'
      && adminTwin.terminal.id === ids.termA
      && adminTwin.terminal.areaLabel === '天河区'
      && adminTwin.terminal.locationLabel === '体育中心'
      && adminTwin.terminal.geo?.lat === 23.125
      && adminTwin.terminal.geo?.lng === 113.5
      && adminTwin.status.health === 'healthy'
      && adminTwin.status.onlineWindowSeconds === SCREEN_ONLINE_WINDOW_SECONDS
      && adminTwin.printer.available === true
      && adminTwin.printer.value.name === null
      && adminTwin.printer.value.state === 'printing'
      && adminTwin.printer.value.colorEnabled === false
      && adminTwin.printer.value.duplexEnabled === false
      && adminTwin.scanner.available === true
      && adminTwin.scanner.value.state === 'unknown'
      && adminTwin.currentTask.available === true
      && current !== null
      && current?.pages === 6
      && current?.colorMode === 'bw'
      && current?.startedAt === storedTask?.claimedAt?.toISOString().slice(0, 16) + 'Z'
      && adminTwin.today.printPages === 0
      && Number(adminTwin.today.printPages) !== 10
      && adminTwin.today.printTasks === null
      && adminTwin.today.scans === 0
      && adminTwin.today.failed === null
      && adminTwin.today.visits.available === true
      && adminTwin.today.visits.value === 0
      && adminTwin.consumables.available === false
      && adminTwin.consumables.reason === SCREEN_UNAVAILABLE_REASON.noConsumableOrGeo
      && !('value' in adminTwin.consumables)
      && adminTwin.timeline24h.available === true
      && !adminText.includes(ids.resumeFileName)
      && !adminText.includes('fileName')
      && !adminText.includes('black_white')
      && !adminText.includes('https://internal/secret')
      && !adminText.includes(ids.memberId)
      && !adminText.includes('"copies"'),
  )
const segments = adminTwin.timeline24h.available ? adminTwin.timeline24h.value : []
assert(
    '5e. 孪生时间轴升序、首尾相接、相邻不同状态，不含 printing',
    segments.length > 0
      && segments.length <= TIMELINE_SEGMENT_CAP
      && !segments.some((segment) => String(segment.state) === 'printing')
      && segments.every((segment, index) => index === 0 || segment.from === segments[index - 1]?.to)
      && segments.every((segment, index) => index === segments.length - 1 || segment.state !== segments[index + 1]?.state),
  )
const partnerTwin = await screen.getPartnerTerminalTwin(ids.orgA, ids.termA)
assert(
    '5f. 机构 A 可读自己的终端孪生，当日计数与管理员同一口径',
    partnerTwin.audience === 'partner'
      && partnerTwin.terminal.id === ids.termA
      && partnerTwin.today.printPages === 0
      && Number(partnerTwin.today.printPages) !== 10
      && partnerTwin.today.printTasks === null
      && partnerTwin.today.scans === 0
      && partnerTwin.today.failed === null
      && !JSON.stringify(partnerTwin).includes(ids.resumeFileName),
  )
let foreign: unknown
let missing: unknown
try {
    await screen.getPartnerTerminalTwin(ids.orgA, ids.termB)
  } catch (error) {
    foreign = error
  }
try {
    await screen.getPartnerTerminalTwin(ids.orgA, `missing_${ids.suffix}`)
  } catch (error) {
    missing = error
  }
const foreignBody = foreign instanceof NotFoundException ? foreign.getResponse() : null
const missingBody = missing instanceof NotFoundException ? missing.getResponse() : null
const foreignText = JSON.stringify(foreignBody)
assert(
    '5g. 别家终端与不存在是同一 404，响应不含对方编号或机构名',
    foreign instanceof NotFoundException
      && missing instanceof NotFoundException
      && foreignText === JSON.stringify(missingBody)
      && foreignText.includes('TERMINAL_NOT_FOUND')
      && !foreignText.includes(ids.termB)
      && !foreignText.includes(`SCRN-B-${ids.suffix}`)
      && !foreignText.includes('大屏机构B'),
  )
const paperTwin = await screen.getAdminTerminalTwin(ids.termB)
assert(
    '5h. 缺纸终端打印机为 error，没有当前任务时 value 为 null',
    paperTwin.printer.available === true
      && paperTwin.printer.value.state === 'error'
      && paperTwin.printer.value.errorLabel === '打印机缺纸'
      && paperTwin.currentTask.available === true
      && paperTwin.currentTask.value === null
      && paperTwin.scanner.available === true
      && paperTwin.scanner.value.state === 'unknown',
  )
await prisma.scanTask.create({
    data: {
      id: `scan_${ids.suffix}`,
      terminalId: ids.termA,
      scanType: 'document',
      status: 'matched',
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
cache.clear()
const busy = await screen.getAdminTerminalTwin(ids.termA)
const busyFleet = await loadPartnerFleet(prisma, new Date(), ids.orgA)
const busyCell = busyFleet.cells.find((cell) => cell.terminalId === ids.termA)
assert(
    '5i. 进行中扫描为 busy，今日扫描 1 笔不显示，打印状态仍优先',
    busy.scanner.available === true
      && busy.scanner.value.state === 'busy'
      && busy.scanner.value.label === null
      && busy.today.scans === null
      && busy.printer.available === true
      && busy.printer.value.state === 'printing'
      && busyCell?.activity === 'printing',
  )
await prisma.terminalCapability.create({
    data: { terminalId: ids.termA, capabilityKey: 'color_print', status: 'available' },
  })
cache.clear()
const colorTwin = await screen.getAdminTerminalTwin(ids.termA)
assert(
    '5j. 只有 available 的 color_print 打开彩色，未登记双面仍关闭',
    colorTwin.printer.available === true
      && colorTwin.printer.value.colorEnabled === true
      && colorTwin.printer.value.duplexEnabled === false,
  )
let uniqueCalls = 0
const originalUnique = prisma.terminal.findUnique.bind(prisma.terminal)
prisma.terminal.findUnique = (async (args?: unknown) => {
    uniqueCalls += 1
    return originalUnique(args as never)
  }) as typeof prisma.terminal.findUnique
cache.clear()
uniqueCalls = 0
await screen.getAdminTerminalTwin(ids.termA)
const firstCalls = uniqueCalls
await screen.getAdminTerminalTwin(ids.termA)
prisma.terminal.findUnique = originalUnique
assert(
    '5k. 孪生第二次命中 15 秒缓存，不再装载终端行',
    firstCalls >= 2 && uniqueCalls === firstCalls + 1,
    `first=${firstCalls} second=${uniqueCalls}`,
  )
const offAt = new Date(Date.now() - 34 * 60_000)
const offId = `term_scrn_off_${ids.suffix}`
const neverId = `term_scrn_never_${ids.suffix}`
const claimId = `term_scrn_claim_${ids.suffix}`
await prisma.terminal.createMany({
    data: [
      { id: offId, terminalCode: `000-OFF-${ids.suffix}`, agentToken: `tok_off_${ids.suffix}`, deviceFingerprint: `fp_off_${ids.suffix}`, orgId: ids.orgA, enabled: true },
      { id: neverId, terminalCode: `000-NEVER-${ids.suffix}`, agentToken: `tok_nv_${ids.suffix}`, deviceFingerprint: `fp_nv_${ids.suffix}`, orgId: ids.orgA, enabled: true },
      { id: claimId, terminalCode: `000-CLAIM-${ids.suffix}`, agentToken: `tok_cl_${ids.suffix}`, deviceFingerprint: `fp_cl_${ids.suffix}`, orgId: ids.orgA, enabled: true },
    ],
  })
return carryContext(context, { adminTwin, storedTask, adminText, current, segments, partnerTwin, get foreign() { return foreign }, set foreign(value: typeof foreign) { foreign = value }, get missing() { return missing }, set missing(value: typeof missing) { missing = value }, foreignBody, missingBody, foreignText, paperTwin, busy, busyFleet, busyCell, colorTwin, get uniqueCalls() { return uniqueCalls }, set uniqueCalls(value: typeof uniqueCalls) { uniqueCalls = value }, originalUnique, firstCalls, offAt, offId, neverId, claimId })
}
