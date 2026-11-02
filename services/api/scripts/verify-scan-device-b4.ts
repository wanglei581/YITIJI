/**
 * 屏上扫描后端 B4 给一体机的数据：取消响应里的静默期倒计时、GET 的页数上限、
 * 扫描仪找不到或出错时的派生告警。
 *
 * 写库：本脚本在库里造终端 / 会话 / 心跳，结束时清理，所以必须在隔离库上跑
 * （VERIFICATION_DATABASE_TARGET=isolated，库名带 ci/dev/test/verify）。
 * SQLite 与 PostgreSQL 两个 CI 作业各跑一遍。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:scan-device-b4
 */
import 'reflect-metadata'
// 倒计时用例要生产默认的 90 秒。个别用例临时改成 0，测完改回。不让运行环境里的同名变量悄悄改写。
process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '90'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-device-b4-secret-0123456789-abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-device-b4-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-device-b4-action-secret-0123456789'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectDerivedAlerts, resolveDerivedAlert } from '../src/admin-ops/derived-alerts'
import { AuditService } from '../src/audit/audit.service'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { ScanDeviceSessionsService } from '../src/scan-tasks/scan-device-sessions.service'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { TerminalCapabilitiesService, setPrintScanCapabilityModeForTest } from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

type HttpLike = { getStatus?: () => number; getResponse?: () => unknown }
function httpErrorOf(error: unknown): { status: number | undefined; code: string | undefined; message: string; remainingSeconds: number | undefined } {
  const e = error as HttpLike
  const body = e.getResponse?.() as { error?: { code?: string; message?: string; details?: { remainingSeconds?: number } } } | undefined
  return {
    status: e.getStatus?.(),
    code: body?.error?.code,
    message: String(body?.error?.message ?? ''),
    remainingSeconds: body?.error?.details?.remainingSeconds,
  }
}

async function expectHttp(run: () => Promise<unknown>, status: number, code: string, label: string): Promise<{ message: string; remainingSeconds: number | undefined }> {
  try {
    await run()
  } catch (error) {
    const got = httpErrorOf(error)
    assert.equal(got.status, status, `${label}：HTTP 状态应为 ${status}，实际 ${String(got.status)}（${got.code}）`)
    assert.equal(got.code, code, `${label}：错误码应为 ${code}，实际 ${String(got.code)}`)
    pass(`${label}（${status} ${code}）`)
    return { message: got.message, remainingSeconds: got.remainingSeconds }
  }
  return assert.fail(`${label}：应当被拒绝（${status} ${code}），实际放行了`)
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  setPrintScanCapabilityModeForTest('managed')

  const suffix = randomBytes(5).toString('hex')
  const storageDir = mkdtempSync(join(tmpdir(), 'verify-scan-device-b4-storage-'))
  const originalStorageDir = process.env['FILE_STORAGE_DIR']
  process.env['FILE_STORAGE_DIR'] = storageDir

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const files = new FilesService(prisma, new AuditService(prisma), new StorageService())
  const scanSvc = new ScanTasksService(prisma, files, capabilities)
  const deviceSvc = new ScanDeviceSessionsService(prisma, capabilities)
  const terminalIds: string[] = []

  async function makeTerminal(tag: string, scanDevice: 'available' | null = null) {
    const id = `t_b4_${tag}_${suffix}`
    await prisma.terminal.create({
      data: { id, terminalCode: `B4-${tag}-${suffix}`.toUpperCase(), agentToken: `b4-token-${randomBytes(12).toString('hex')}`, deviceFingerprint: `verify-scan-device-b4-${suffix}`, enabled: true },
    })
    terminalIds.push(id)
    if (scanDevice) await capabilities.upsert(id, 'scan_device', scanDevice, undefined, 'verify-scan-device-b4')
    return { id }
  }

  try {
    console.log('\n-- 取消响应给出静默期结束时刻与服务端当前时间 --')
    process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '90'
    {
      const t = await makeTerminal('cancelpanel')
      const created = await scanSvc.create({ scanType: 'document', terminalId: t.id }, null)
      const before = Date.now()
      const cancelled = await scanSvc.cancel(created.scanTaskId, null, created.controlToken)
      const after = Date.now()
      assert.equal(cancelled.status, 'cancelled', '取消结果仍是 cancelled')
      assert.equal(cancelled.scanTaskId, created.scanTaskId)
      assert.match(cancelled.serverNow, ISO, 'serverNow 是 ISO 时间')
      assert.match(cancelled.quietPeriodEndsAt, ISO, 'quietPeriodEndsAt 是 ISO 时间')
      const serverNowMs = Date.parse(cancelled.serverNow)
      assert.ok(serverNowMs >= before - 1000 && serverNowMs <= after + 1000, 'serverNow 是这次取消时的服务端时间')
      const row = await prisma.scanTask.findUniqueOrThrow({ where: { id: created.scanTaskId } })
      assert.equal(row.status, 'cancelled')
      assert.equal(cancelled.quietPeriodEndsAt, new Date(row.updatedAt.getTime() + 90_000).toISOString(), '静默期从取消落库的 updatedAt 起算 90 秒')
      const blocked = await expectHttp(
        () => scanSvc.create({ scanType: 'document', terminalId: t.id }, null),
        409,
        'SCAN_TERMINAL_QUIET_PERIOD',
        '同一终端在静默期内不能再建会话',
      )
      const remainingMs = Date.parse(cancelled.quietPeriodEndsAt) - Date.now()
      const expectedSeconds = Math.max(1, Math.ceil(remainingMs / 1000))
      assert.ok(
        blocked.remainingSeconds !== undefined && Math.abs(blocked.remainingSeconds - expectedSeconds) <= 2,
        `建会话被拒的剩余秒数应接近倒计时（期望约 ${expectedSeconds}，实际 ${String(blocked.remainingSeconds)}）`,
      )
      await expectHttp(
        () => scanSvc.cancel(created.scanTaskId, null, created.controlToken),
        409,
        'SCAN_TASK_CANCEL_CONFLICT',
        '已经取消的会话再取消仍是原来的冲突',
      )
      pass('面板会话取消多给 quietPeriodEndsAt 与 serverNow，其余取消行为不变')
    }
    {
      const t = await makeTerminal('canceldevice', 'available')
      const created = await scanSvc.create(
        { scanType: 'id', terminalId: t.id, startMode: 'device', source: 'flatbed', colorMode: 'gray' },
        null,
      )
      const cancelled = await scanSvc.cancel(created.scanTaskId, null, created.controlToken)
      const row = await prisma.scanTask.findUniqueOrThrow({ where: { id: created.scanTaskId } })
      assert.equal(cancelled.status, 'cancelled')
      assert.equal(row.startMode, 'device', '取消没有改扫描方式')
      assert.equal(cancelled.quietPeriodEndsAt, new Date(row.updatedAt.getTime() + 90_000).toISOString())
      pass('屏上扫描会话取消同样给倒计时依据，扫描方式不变')
    }
    {
      process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '0'
      const t = await makeTerminal('canceloff')
      const created = await scanSvc.create({ scanType: 'document', terminalId: t.id }, null)
      const cancelled = await scanSvc.cancel(created.scanTaskId, null, created.controlToken)
      assert.equal(cancelled.quietPeriodEndsAt, cancelled.serverNow, '静默期关着时结束时刻等于 serverNow')
      const next = await scanSvc.create({ scanType: 'document', terminalId: t.id }, null)
      assert.equal(typeof next.scanTaskId, 'string', '静默期关着时取消之后立刻可以再建会话')
      process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '90'
      pass('静默期关着：仍给两个时间，结束时刻等于 serverNow，不挡下一场')
    }

    console.log('\n-- GET 会话给页数上限（与租约同源）--')
    {
      const documentTerminal = await makeTerminal('pagesdoc', 'available')
      const document = await scanSvc.create(
        { scanType: 'document', terminalId: documentTerminal.id, startMode: 'device', source: 'feeder', colorMode: 'gray' },
        null,
      )
      await scanSvc.ack(document.scanTaskId, null, document.controlToken, documentTerminal.id)
      const documentStatus = await scanSvc.getStatus(document.scanTaskId, null, document.controlToken)
      const documentLease = await scanSvc.getScanDeliveryLease(documentTerminal.id)
      assert.equal(documentStatus.deviceMaxPages, 20, '非证件屏上扫描最多 20 页')
      assert.equal(documentStatus.deviceMaxPages, documentLease.device?.maxPages, 'GET 的页数上限与租约 device.maxPages 是同一个数')

      const idTerminal = await makeTerminal('pagesid', 'available')
      const idScan = await scanSvc.create(
        { scanType: 'id', terminalId: idTerminal.id, startMode: 'device', source: 'flatbed', colorMode: 'color' },
        null,
      )
      await scanSvc.ack(idScan.scanTaskId, null, idScan.controlToken, idTerminal.id)
      const idStatus = await scanSvc.getStatus(idScan.scanTaskId, null, idScan.controlToken)
      const idLease = await scanSvc.getScanDeliveryLease(idTerminal.id)
      assert.equal(idStatus.deviceMaxPages, 4, '证件屏上扫描最多 4 页')
      assert.equal(idStatus.deviceMaxPages, idLease.device?.maxPages)

      const panelTerminal = await makeTerminal('pagespanel')
      const panel = await scanSvc.create({ scanType: 'id', terminalId: panelTerminal.id }, null)
      const panelStatus = await scanSvc.getStatus(panel.scanTaskId, null, panel.controlToken)
      assert.equal(panelStatus.deviceMaxPages, null, '面板任务给 null，哪怕扫描类型是证件')
      assert.equal(panelStatus.startMode, 'panel')

      // 上一场 document 还在 waiting，同一终端不能再开。先取消再开。静默期 90 秒会挡住，临时关掉。
      process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '0'
      await scanSvc.cancel(document.scanTaskId, null, document.controlToken)
      const switchedSession = await scanSvc.create(
        { scanType: 'id', terminalId: documentTerminal.id, startMode: 'device', source: 'flatbed', colorMode: 'gray' },
        null,
      )
      await deviceSvc.switchToPanel(switchedSession.scanTaskId, null, switchedSession.controlToken)
      const switchedStatus = await scanSvc.getStatus(switchedSession.scanTaskId, null, switchedSession.controlToken)
      const switchedRow = await prisma.scanTask.findUniqueOrThrow({ where: { id: switchedSession.scanTaskId } })
      assert.equal(switchedRow.startMode, 'panel')
      assert.equal(switchedRow.scanType, 'id', '库里仍是证件类型')
      assert.equal(switchedStatus.deviceMaxPages, null, '已改用面板的会话按面板给 null')
      assert.equal(switchedStatus.startMode, 'panel')
      process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '90'
      pass('GET deviceMaxPages：证件 4、其余 20，与租约同源；面板与已改用面板为 null')
    }

    console.log('\n-- 扫描仪心跳派生告警（与打印机同一条现算通道）--')
    {
      type Beat = { scanDeviceHealth?: string | null; printerStatus?: string | null; createdAt?: Date }
      async function beat(terminalId: string, data: Beat = {}) {
        return prisma.terminalHeartbeat.create({
          data: {
            terminalId,
            status: 'online',
            printerStatus: data.printerStatus === undefined ? 'ready' : data.printerStatus,
            scanDeviceHealth: data.scanDeviceHealth === undefined ? null : data.scanDeviceHealth,
            createdAt: data.createdAt,
          },
        })
      }
      function scanAlerts(collection: Awaited<ReturnType<typeof collectDerivedAlerts>>, terminalId: string) {
        return collection.alerts.filter((alert) => alert.type === 'scan_device_issue' && alert.subjectId === terminalId)
      }
      async function collect() {
        return collectDerivedAlerts(prisma, new Date())
      }

      const fault = await makeTerminal('scanfault', 'available')
      const faultRow = await prisma.terminal.findUniqueOrThrow({ where: { id: fault.id }, select: { registeredAt: true } })
      const firstFaultAt = new Date(Date.now() - 50_000)
      await beat(fault.id, { scanDeviceHealth: 'not_found', createdAt: firstFaultAt })
      const first = await collect()
      const firstAlerts = scanAlerts(first, fault.id)
      assert.equal(firstAlerts.length, 1, '已开通且在线、心跳 not_found，应有一条扫描仪告警')
      assert.equal(firstAlerts[0]?.subjectKey, `scan_device_issue:${fault.id}`)
      assert.equal(firstAlerts[0]?.severity, 'error')
      assert.match(firstAlerts[0]?.title ?? '', /扫描仪找不到/)
      assert.equal(firstAlerts[0]?.episodeToken, `not_found:${faultRow.registeredAt.toISOString()}`, '只有故障心跳时，回合用注册时间')
      assert.equal(first.alerts.filter((alert) => alert.type === 'printer_issue' && alert.subjectId === fault.id).length, 0, '打印机正常时不另发打印机告警')
      const again = scanAlerts(await collect(), fault.id)
      assert.equal(again[0]?.subjectKey, firstAlerts[0]?.subjectKey)
      assert.equal(again[0]?.episodeToken, firstAlerts[0]?.episodeToken, '再收集一次，去重键与回合不变')
      await beat(fault.id, { scanDeviceHealth: 'not_found', createdAt: new Date(Date.now() - 20_000) })
      const still = scanAlerts(await collect(), fault.id)
      assert.equal(still.length, 1)
      assert.equal(still[0]?.episodeToken, firstAlerts[0]?.episodeToken, '连续两次故障心跳、中间没有正常心跳，回合不变')
      const resolvedWhileFault = await resolveDerivedAlert(prisma, 'scan_device_issue', fault.id, new Date())
      assert.equal(resolvedWhileFault?.subjectKey, firstAlerts[0]?.subjectKey, '故障还在时正向查证找得到')

      const readyBeat = await beat(fault.id, { scanDeviceHealth: 'ready', createdAt: new Date(Date.now() - 10_000) })
      const recovered = await collect()
      assert.equal(scanAlerts(recovered, fault.id).length, 0, '心跳改报 ready 后扫描仪告警消失')
      assert.equal(await resolveDerivedAlert(prisma, 'scan_device_issue', fault.id, new Date()), null, '恢复后正向查证返回空')
      await beat(fault.id, { scanDeviceHealth: 'not_found', createdAt: new Date() })
      const relapsed = scanAlerts(await collect(), fault.id)
      assert.equal(relapsed.length, 1, '再次 not_found 重新出现')
      assert.equal(relapsed[0]?.episodeToken, `not_found:${readyBeat.createdAt.toISOString()}`, '新回合用最近一次正常心跳的时间')
      assert.notEqual(relapsed[0]?.episodeToken, firstAlerts[0]?.episodeToken)

      const errored = await makeTerminal('scanerror', 'available')
      const errorRow = await prisma.terminal.findUniqueOrThrow({ where: { id: errored.id }, select: { registeredAt: true } })
      await beat(errored.id, { scanDeviceHealth: 'error' })
      const errorAlerts = scanAlerts(await collect(), errored.id)
      assert.equal(errorAlerts.length, 1, '心跳 error 同样告警')
      assert.match(errorAlerts[0]?.title ?? '', /扫描仪出错/)
      assert.equal(errorAlerts[0]?.episodeToken, `error:${errorRow.registeredAt.toISOString()}`)

      const quiet = await makeTerminal('scanquiet', 'available')
      const quietBase = Date.now() - 15_000
      const quietHealth = ['ready', 'busy', 'unknown', null] as const
      for (let index = 0; index < quietHealth.length; index += 1) {
        const health = quietHealth[index]
        await beat(quiet.id, { scanDeviceHealth: health, createdAt: new Date(quietBase + index * 1000) })
        assert.equal(scanAlerts(await collect(), quiet.id).length, 0, `${String(health)} 不产生扫描仪告警`)
      }

      const missing = await makeTerminal('scanmiss')
      await beat(missing.id, { scanDeviceHealth: 'not_found' })
      assert.equal(scanAlerts(await collect(), missing.id).length, 0, '没开通 scan_device 不告警')

      const unverified = await makeTerminal('scanunverified')
      await capabilities.upsert(unverified.id, 'scan_device', 'not_verified', undefined, 'verify-scan-device-b4')
      await beat(unverified.id, { scanDeviceHealth: 'not_found' })
      assert.equal(scanAlerts(await collect(), unverified.id).length, 0, 'scan_device 未核验不告警')

      const maintenance = await makeTerminal('scanmaint')
      await capabilities.upsert(maintenance.id, 'scan_device', 'maintenance', undefined, 'verify-scan-device-b4')
      await beat(maintenance.id, { scanDeviceHealth: 'not_found' })
      assert.equal(scanAlerts(await collect(), maintenance.id).length, 0, '维护中不告警')

      const stale = await makeTerminal('scanstale', 'available')
      await beat(stale.id, { scanDeviceHealth: 'not_found', createdAt: new Date(Date.now() - 6 * 60 * 1000) })
      const staleCollection = await collect()
      assert.equal(scanAlerts(staleCollection, stale.id).length, 0, '心跳超出 5 分钟在线窗口不发扫描仪告警')
      assert.equal(
        staleCollection.alerts.filter((alert) => alert.type === 'terminal_offline' && alert.subjectId === stale.id).length,
        1,
        '同一条过期心跳仍按原通道产生离线告警',
      )

      const both = await makeTerminal('scanboth', 'available')
      await beat(both.id, { scanDeviceHealth: 'not_found', printerStatus: 'paper_empty' })
      const bothCollection = await collect()
      const bothScan = scanAlerts(bothCollection, both.id)
      const bothPrinter = bothCollection.alerts.filter((alert) => alert.type === 'printer_issue' && alert.subjectId === both.id)
      assert.equal(bothScan.length, 1, '缺纸与扫描仪找不到可以同时存在')
      assert.equal(bothPrinter.length, 1)
      assert.notEqual(bothScan[0]?.subjectKey, bothPrinter[0]?.subjectKey)

      const clearedByNull = await makeTerminal('scannullclear', 'available')
      const nullBeat = await beat(clearedByNull.id, { scanDeviceHealth: null, createdAt: new Date(Date.now() - 30_000) })
      await beat(clearedByNull.id, { scanDeviceHealth: 'not_found', createdAt: new Date(Date.now() - 5_000) })
      const nullClearAlerts = scanAlerts(await collect(), clearedByNull.id)
      assert.equal(nullClearAlerts.length, 1)
      assert.equal(nullClearAlerts[0]?.episodeToken, `not_found:${nullBeat.createdAt.toISOString()}`, '健康值为空的心跳算一次恢复')

      pass('扫描仪告警：not_found / error 才发，去重，恢复后消失，可与打印机告警并存')
    }

    console.log('\nPASS verify-scan-device-b4')
  } finally {
    process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '90'
    setPrintScanCapabilityModeForTest(null)
    if (originalStorageDir === undefined) delete process.env['FILE_STORAGE_DIR']
    else process.env['FILE_STORAGE_DIR'] = originalStorageDir
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.terminalCapability.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    rmSync(storageDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
