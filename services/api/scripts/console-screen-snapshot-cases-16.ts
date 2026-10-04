import { BadRequestException } from '@nestjs/common'
import { SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { loadPartnerFleet } from '../src/console-screen/console-screen.queries'
import { CHINA_LAT_MIN, CHINA_LNG_MAX, terminalPlacementPatch } from '../src/terminals/terminal-placement'
import { TIMELINE_HEARTBEAT_ROW_CAP } from '../src/console-screen/console-screen.timeline'
import { assert } from './console-screen-snapshot-cases-01'
import { createOnlineHeartbeats } from './console-screen-snapshot-cases-04'
import { assertTwinCasesPhase1 } from './console-screen-snapshot-cases-15'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertTwinCasesPhase2(context: Awaited<ReturnType<typeof assertTwinCasesPhase1>>) {
const { prisma, screen, cache, ids, offAt, offId, neverId, claimId } = context
await prisma.terminalHeartbeat.create({
    data: { terminalId: offId, status: 'online', printerStatus: 'paper_empty', createdAt: offAt },
  })
await prisma.printTask.create({
    data: {
      id: `pt_claim_${ids.suffix}`,
      terminalId: claimId,
      fileUrl: 'https://internal/claim-secret',
      fileMd5: 'md5claim',
      paramsJson: JSON.stringify({ fileName: ids.resumeFileName, billablePages: 3, colorMode: 'color' }),
      status: 'claimed',
      claimedAt: new Date(),
    },
  })
const fleet = await loadPartnerFleet(prisma, new Date(), ids.orgA)
const fleetText = JSON.stringify(fleet)
const offCell = fleet.cells.find((cell) => cell.terminalId === offId)
const neverCell = fleet.cells.find((cell) => cell.terminalId === neverId)
const claimCell = fleet.cells.find((cell) => cell.terminalId === claimId)
assert(
    '5l. 离线 34 分钟、从未上报、已领取算打印中，机构墙不含别家 terminalId 和文件名',
    offCell?.alert?.kind === 'offline'
      && offCell.alert.title === '离线 34 分钟'
      && offCell.alert.since === offAt.toISOString()
      && offCell.activity === null
      && neverCell?.alert?.kind === 'never_reported'
      && neverCell.alert.title === '从未上报'
      && neverCell.alert.since === null
      && neverCell.health === 'unknown'
      && claimCell?.activity === 'printing'
      && claimCell.alert?.kind === 'never_reported'
      && fleet.cells.every((cell) => cell.terminalId !== ids.termB)
      && !fleetText.includes(ids.termB)
      && !fleetText.includes(ids.resumeFileName)
      && !fleetText.includes('https://internal/claim-secret'),
  )
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-terminal-admin-secret-not-production'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-terminal-action-secret-not-production'
const [{ AuditService }, { AdminTerminalsController }, { TerminalToolboxService }, { TerminalAdminService }, { TerminalAgentService }, { TerminalsService }] = await Promise.all([
    import('../src/audit/audit.service'),
    import('../src/terminals/admin-terminals.controller'),
    import('../src/terminals/terminal-toolbox.service'),
    import('../src/terminals/terminals-admin.service'),
    import('../src/terminals/terminals-agent.service'),
    import('../src/terminals/terminals.service'),
  ])
const audit = new AuditService(prisma)
const agent = new TerminalAgentService(prisma, audit)
const adminSvc = new TerminalAdminService(prisma, agent, new TerminalToolboxService(prisma), undefined as never)
const terminals = new TerminalsService(agent, adminSvc)
const controller = new AdminTerminalsController(terminals, undefined as never, audit)
const actor = { userId: ids.adminId, role: 'admin' as const, orgId: null }
const req = { headers: {} }
const auditWhere = { action: 'terminal.profile.update', targetId: `SCRN-B-${ids.suffix}` }
const before = await prisma.auditLog.count({ where: auditWhere })
let areaError: unknown
let pairError: unknown
let rangeError: unknown
try {
    await controller.updateProfile(ids.termB, { areaLabel: '一二三四五六七八九十一二三四五六七八九十一' }, actor, req)
  } catch (error) {
    areaError = error
  }
try {
    await controller.updateProfile(ids.termB, { geoLat: 23.1 }, actor, req)
  } catch (error) {
    pairError = error
  }
try {
    await controller.updateProfile(ids.termB, { geoLat: 0, geoLng: 0 }, actor, req)
  } catch (error) {
    rangeError = error
  }
const afterReject = await prisma.auditLog.count({ where: auditWhere })
const saved = await controller.updateProfile(ids.termB, { areaLabel: ' 越秀区 ', geoLat: 23.125, geoLng: 113.5 }, actor, req)
const inclusive = terminalPlacementPatch({ geoLat: CHINA_LAT_MIN, geoLng: CHINA_LNG_MAX })
let belowRange: unknown
try {
    terminalPlacementPatch({ geoLat: CHINA_LAT_MIN - 0.01, geoLng: CHINA_LNG_MAX })
  } catch (error) {
    belowRange = error
  }
const auditRow = await prisma.auditLog.findFirst({ where: auditWhere, orderBy: { createdAt: 'desc' } })
const payload = JSON.parse(auditRow?.payloadJson ?? '{}') as { areaLabel?: string; geoLat?: number; geoLng?: number }
const kept = await controller.updateProfile(ids.termB, { displayName: '只改名称' }, actor, req)
const cleared = await controller.updateProfile(ids.termB, { geoLat: null, geoLng: null }, actor, req)
assert(
    '5m. 所在区超过 20 字、经纬度不成对或越界被拒绝且不写审计；成功写入有审计；局部更新不抹坐标',
    areaError instanceof BadRequestException
      && JSON.stringify((areaError as BadRequestException).getResponse()).includes('TERMINAL_AREA_LABEL_INVALID')
      && pairError instanceof BadRequestException
      && JSON.stringify((pairError as BadRequestException).getResponse()).includes('TERMINAL_GEO_INVALID')
      && rangeError instanceof BadRequestException
      && JSON.stringify((rangeError as BadRequestException).getResponse()).includes('TERMINAL_GEO_INVALID')
      && afterReject === before
      && saved.data.areaLabel === '越秀区'
      && saved.data.geoLat === 23.125
      && saved.data.geoLng === 113.5
      && inclusive.geoLat === CHINA_LAT_MIN
      && inclusive.geoLng === CHINA_LNG_MAX
      && belowRange instanceof BadRequestException
      && payload.areaLabel === '越秀区'
      && payload.geoLat === 23.125
      && payload.geoLng === 113.5
      && kept.data.displayName === '只改名称'
      && kept.data.areaLabel === '越秀区'
      && kept.data.geoLat === 23.125
      && cleared.data.geoLat === null
      && cleared.data.geoLng === null
      && cleared.data.areaLabel === '越秀区',
  )
const steadyId = `term_scrn_steady_${ids.suffix}`
const floodId = `term_scrn_flood_${ids.suffix}`
const retryId = `term_scrn_retry_${ids.suffix}`
await prisma.terminal.createMany({
    data: [
      { id: steadyId, terminalCode: `SCRN-STD-${ids.suffix}`, agentToken: `tok_std_${ids.suffix}`, deviceFingerprint: `fp_std_${ids.suffix}`, orgId: ids.orgA, enabled: true },
      { id: floodId, terminalCode: `SCRN-FLD-${ids.suffix}`, agentToken: `tok_fld_${ids.suffix}`, deviceFingerprint: `fp_fld_${ids.suffix}`, orgId: ids.orgA, enabled: true },
      { id: retryId, terminalCode: `SCRN-RTY-${ids.suffix}`, agentToken: `tok_rty_${ids.suffix}`, deviceFingerprint: `fp_rty_${ids.suffix}`, orgId: ids.orgA, enabled: true },
    ],
  })
const steadyAnchor = new Date()
const steadyTimes: Date[] = []
for (let at = steadyAnchor.getTime() - 24 * 60 * 60 * 1000; at <= steadyAnchor.getTime(); at += 30_000) {
    steadyTimes.push(new Date(at))
  }
await createOnlineHeartbeats(prisma, steadyId, steadyTimes, 'ready')
await prisma.terminalHeartbeat.create({
    data: { terminalId: steadyId, status: 'online', printerStatus: 'ready', createdAt: new Date() },
  })
cache.clear()
const steadyTwin = await screen.getAdminTerminalTwin(steadyId)
const steadySegments = steadyTwin.timeline24h.available ? steadyTwin.timeline24h.value : []
const steadyIdle = steadySegments.filter((segment) => segment.state === 'idle').length
assert(
    '5s. 30 秒一次、全天在线的终端 timeline24h 可用，合并后只有 1 段 idle',
    steadyTwin.timeline24h.available === true
      && steadySegments.length === 1
      && steadyIdle === 1
      && steadySegments[0]?.state === 'idle',
    `available=${String(steadyTwin.timeline24h.available)} segments=${steadySegments.length} idle=${steadyIdle} rows=${steadyTimes.length + 1} cap=${TIMELINE_HEARTBEAT_ROW_CAP}`,
  )
const floodAt = Date.now()
await createOnlineHeartbeats(
    prisma,
    floodId,
    Array.from({ length: TIMELINE_HEARTBEAT_ROW_CAP + 1 }, () => new Date(floodAt)),
    'ready',
  )
cache.clear()
const floodTwin = await screen.getAdminTerminalTwin(floodId)
assert(
    '5t. 心跳行数超过上限时 timeline24h 仍如实不可用',
    floodTwin.timeline24h.available === false
      && floodTwin.timeline24h.reason === SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded,
    floodTwin.timeline24h.available ? 'available' : floodTwin.timeline24h.reason,
  )
const retryDone = new Date(Date.now() - 30 * 60_000)
const retryStart = new Date(retryDone.getTime() - 24_000)
const retryTaskId = `pt_scrn_retry_${ids.suffix}`
return carryContext(context, { fleet, fleetText, offCell, neverCell, claimCell, AuditService, AdminTerminalsController, TerminalToolboxService, TerminalAdminService, TerminalAgentService, TerminalsService, audit, agent, adminSvc, terminals, controller, actor, req, auditWhere, before, get areaError() { return areaError }, set areaError(value: typeof areaError) { areaError = value }, get pairError() { return pairError }, set pairError(value: typeof pairError) { pairError = value }, get rangeError() { return rangeError }, set rangeError(value: typeof rangeError) { rangeError = value }, afterReject, saved, inclusive, get belowRange() { return belowRange }, set belowRange(value: typeof belowRange) { belowRange = value }, auditRow, payload, kept, cleared, steadyId, floodId, retryId, steadyAnchor, steadyTimes, steadyTwin, steadySegments, steadyIdle, floodAt, floodTwin, retryDone, retryStart, retryTaskId })
}
