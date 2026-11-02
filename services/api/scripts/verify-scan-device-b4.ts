/**
 * 屏上扫描后端 B4 给一体机的数据。这一文件按项加长：先是取消响应里的静默期倒计时。
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
import { AuditService } from '../src/audit/audit.service'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
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

    console.log('\nPASS verify-scan-device-b4')
  } finally {
    process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '90'
    setPrintScanCapabilityModeForTest(null)
    if (originalStorageDir === undefined) delete process.env['FILE_STORAGE_DIR']
    else process.env['FILE_STORAGE_DIR'] = originalStorageDir
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
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
