/**
 * 屏上扫描后端 B8：已结束任务的 device-report 在 409 里带上最终状态。
 *
 * 覆盖：
 *   1. completed / cancelled / expired / failed 仍是原来的 409 原因码，error.details 带
 *      taskStatus 与 fileDelivered（挂上 fileId 才是 true）
 *   2. 库里仍是 waiting、但截止时间已过或到了最长时限：原因码不变，taskStatus 记为 expired
 *   3. 投递中（matched）仍是 SCAN_DEVICE_TASK_DELIVERING，details 只有 taskStatus: 'matched'
 *   4. 同状态重发仍原样应答
 *   5. 别的终端仍是 404，响应里没有 taskStatus / fileDelivered / fileId
 *   6. 面板任务、已改用面板的任务不带这些字段
 *   7. 统一错误过滤器只透出上述有界字段，文件编号不会出现在 HTTP 正文里
 *
 * 写库：本脚本在库里造终端 / 会话，结束时清理，所以必须在隔离库上跑
 * （VERIFICATION_DATABASE_TARGET=isolated，库名带 ci/dev/test/verify）。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:scan-device-b8
 */
import 'reflect-metadata'
process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '0'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-device-b8-secret-0123456789-abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-device-b8-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-device-b8-action-secret-0123456789'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArgumentsHost } from '@nestjs/common'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { ScanDeviceSessionsService } from '../src/scan-tasks/scan-device-sessions.service'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { StorageService } from '../src/storage/storage.service'
import { TerminalCapabilitiesService, setPrintScanCapabilityModeForTest } from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

type ReportDetails =
  | { taskStatus: 'completed' | 'cancelled' | 'expired' | 'failed'; fileDelivered: boolean }
  | { taskStatus: 'matched' }

type HttpLike = { getStatus?: () => number; getResponse?: () => unknown }

function rawError(error: unknown): { status: number | undefined; error: Record<string, unknown> } {
  const e = error as HttpLike
  const body = e.getResponse?.() as { error?: Record<string, unknown> } | undefined
  return { status: e.getStatus?.(), error: body?.error ?? {} }
}

function throughFilter(error: unknown): { statusCode: number; body: { error: Record<string, unknown> } } {
  const filter = new HttpExceptionFilter()
  const captured: { statusCode?: number; body?: { error: Record<string, unknown> } } = {}
  const response = {
    status(statusCode: number) {
      captured.statusCode = statusCode
      return this
    },
    json(body: { error: Record<string, unknown> }) {
      captured.body = body
      return this
    },
  }
  const host = {
    switchToHttp() {
      return {
        getResponse: () => response,
        getRequest: () => ({ requestId: 'verify-scan-device-b8' }),
      }
    },
  } as unknown as ArgumentsHost
  filter.catch(error, host)
  return { statusCode: captured.statusCode ?? 0, body: captured.body ?? { error: {} } }
}

async function expectReport(
  run: () => Promise<unknown>,
  status: number,
  code: string,
  message: string,
  details: ReportDetails | undefined,
  label: string,
  secret: string | null,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    const raw = rawError(error)
    const expected = details === undefined ? { code, message } : { code, message, details }
    assert.equal(raw.status, status, `${label}：HTTP 状态应为 ${status}，实际 ${String(raw.status)}`)
    assert.deepEqual(raw.error, expected, `${label}：异常体应为 ${JSON.stringify(expected)}，实际 ${JSON.stringify(raw.error)}`)
    const http = throughFilter(error)
    assert.equal(http.statusCode, status, `${label}：过滤器后的状态应为 ${status}`)
    assert.equal(http.body.error.code, code, `${label}：过滤器后的错误码应为 ${code}`)
    assert.equal(http.body.error.message, message, `${label}：过滤器后的说明应保持原句`)
    if (details === undefined) {
      assert.equal(http.body.error.details, undefined, `${label}：过滤器后不应出现 details`)
    } else {
      assert.deepEqual(http.body.error.details, details, `${label}：过滤器后的 details 应与异常体一致`)
    }
    if (secret) {
      assert.ok(!JSON.stringify(raw.error).includes(secret), `${label}：异常体不得带出文件编号`)
      assert.ok(!JSON.stringify(http.body).includes(secret), `${label}：HTTP 正文不得带出文件编号`)
    }
    pass(`${label}（${status} ${code}）`)
    return
  }
  assert.fail(`${label}：应当被拒绝（${status} ${code}），实际放行了`)
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  setPrintScanCapabilityModeForTest('managed')

  const suffix = randomBytes(5).toString('hex')
  const fileId = `file_b8_${suffix}`
  const storageDir = mkdtempSync(join(tmpdir(), 'verify-scan-device-b8-storage-'))
  const originalStorageDir = process.env['FILE_STORAGE_DIR']
  process.env['FILE_STORAGE_DIR'] = storageDir

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const files = new FilesService(prisma, new AuditService(prisma), new StorageService())
  const scanSvc = new ScanTasksService(prisma, files, capabilities)
  const deviceSvc = new ScanDeviceSessionsService(prisma, capabilities)
  const terminalIds: string[] = []
  const future = new Date(Date.now() + 10 * 60_000)
  const past = new Date(Date.now() - 60_000)

  async function makeTerminal(tag: string, scanDevice: 'available' | null = 'available') {
    const id = `t_b8_${tag}_${suffix}`
    await prisma.terminal.create({
      data: {
        id,
        terminalCode: `B8-${tag}-${suffix}`.toUpperCase(),
        agentToken: `b8-token-${randomBytes(12).toString('hex')}`,
        deviceFingerprint: `verify-scan-device-b8-${suffix}`,
        enabled: true,
      },
    })
    terminalIds.push(id)
    if (scanDevice) await capabilities.upsert(id, 'scan_device', scanDevice, undefined, 'verify-scan-device-b8')
    return { id }
  }

  async function deviceSession(tag: string) {
    const t = await makeTerminal(tag)
    const created = await scanSvc.create(
      { scanType: 'document', terminalId: t.id, startMode: 'device', source: 'feeder', colorMode: 'gray' },
      null,
    )
    await scanSvc.ack(created.scanTaskId, null, created.controlToken, t.id)
    return { t, id: created.scanTaskId, token: created.controlToken }
  }

  try {
    console.log('\n-- 已结束与投递中 --')
    const own = await deviceSession('own')
    const report = (terminalId: string, taskId: string, state: 'scanning' | 'error' | 'delivering' = 'scanning') =>
      deviceSvc.report(
        terminalId,
        taskId,
        state === 'error' ? { state, errorCode: 'unknown' } : { state, pageCount: state === 'scanning' ? 1 : 2 },
      )

    const ended: Array<{
      label: string
      data: { status: string; fileId: string | null; expiresAt?: Date; hardExpiresAt?: Date }
      code: string
      message: string
      details: ReportDetails
    }> = [
      {
        label: '已完成且已挂上文件',
        data: { status: 'completed', fileId, expiresAt: future },
        code: 'SCAN_DEVICE_TASK_ENDED',
        message: '扫描任务已结束，请停止屏上扫描',
        details: { taskStatus: 'completed', fileDelivered: true },
      },
      {
        label: '已取消且没有文件',
        data: { status: 'cancelled', fileId: null, expiresAt: future },
        code: 'SCAN_DEVICE_TASK_CANCELLED',
        message: '扫描任务已取消，请停止屏上扫描',
        details: { taskStatus: 'cancelled', fileDelivered: false },
      },
      {
        label: '已过期且已挂上文件',
        data: { status: 'expired', fileId, expiresAt: future },
        code: 'SCAN_DEVICE_TASK_ENDED',
        message: '扫描任务已结束，请停止屏上扫描',
        details: { taskStatus: 'expired', fileDelivered: true },
      },
      {
        label: '已失败且没有文件',
        data: { status: 'failed', fileId: null, expiresAt: future },
        code: 'SCAN_DEVICE_TASK_ENDED',
        message: '扫描任务已结束，请停止屏上扫描',
        details: { taskStatus: 'failed', fileDelivered: false },
      },
      {
        label: '截止时间已过、库里仍是 waiting',
        data: { status: 'waiting', fileId: null, expiresAt: past },
        code: 'SCAN_DEVICE_TASK_ENDED',
        message: '扫描任务已过期，请停止屏上扫描',
        details: { taskStatus: 'expired', fileDelivered: false },
      },
      {
        label: '到了最长时限、库里仍是 waiting',
        data: { status: 'waiting', fileId: null, expiresAt: future, hardExpiresAt: past },
        code: 'SCAN_DEVICE_TASK_ENDED',
        message: '屏上扫描会话已达最长时限，请停止屏上扫描',
        details: { taskStatus: 'expired', fileDelivered: false },
      },
    ]

    for (const item of ended) {
      await prisma.scanTask.update({ where: { id: own.id }, data: item.data })
      await expectReport(
        () => report(own.t.id, own.id),
        409,
        item.code,
        item.message,
        item.details,
        item.label,
        item.data.fileId,
      )
      const row = await prisma.scanTask.findUniqueOrThrow({ where: { id: own.id } })
      assert.equal(row.status, item.data.status, `${item.label}：拒绝回报不得改状态`)
      assert.equal(row.fileId, item.data.fileId, `${item.label}：拒绝回报不得改文件`)
    }

    await prisma.scanTask.update({
      where: { id: own.id },
      data: { status: 'matched', fileId, expiresAt: future, hardExpiresAt: future, deviceState: 'delivering', devicePageCount: 2 },
    })
    const dup = await deviceSvc.report(own.t.id, own.id, { state: 'delivering', pageCount: 2 })
    assert.equal(dup.deviceState, 'delivering', '投递中的同状态重发仍原样应答')
    assert.equal((await prisma.scanTask.findUniqueOrThrow({ where: { id: own.id } })).status, 'matched', '同状态重发不改状态')
    pass('投递中同状态重发原样应答')
    await expectReport(
      () => report(own.t.id, own.id, 'error'),
      409,
      'SCAN_DEVICE_TASK_DELIVERING',
      '文件正在投递，暂不接受新的屏上扫描回报',
      { taskStatus: 'matched' },
      '投递中不收别的状态',
      fileId,
    )
    const matched = await prisma.scanTask.findUniqueOrThrow({ where: { id: own.id } })
    assert.equal(matched.deviceState, 'delivering', '投递中拒绝新状态不得改 deviceState')
    assert.equal(matched.fileId, fileId, '投递中拒绝新状态不得改文件')

    console.log('\n-- 不泄露 --')
    await prisma.scanTask.update({
      where: { id: own.id },
      data: { status: 'completed', fileId, expiresAt: future },
    })
    const other = await makeTerminal('other')
    await expectReport(
      () => report(other.id, own.id),
      404,
      'SCAN_TASK_NOT_FOUND',
      '扫描任务不存在',
      undefined,
      '别的终端看不到已完成任务的状态',
      fileId,
    )
    assert.equal(
      (await prisma.scanTask.findUniqueOrThrow({ where: { id: own.id } })).status,
      'completed',
      '越权回报不得改状态',
    )

    const panelTerminal = await makeTerminal('panel', null)
    const panel = await scanSvc.create({ scanType: 'document', terminalId: panelTerminal.id }, null)
    await scanSvc.ack(panel.scanTaskId, null, panel.controlToken, panelTerminal.id)
    await prisma.scanTask.update({
      where: { id: panel.scanTaskId },
      data: { status: 'completed', fileId },
    })
    await expectReport(
      () => report(panelTerminal.id, panel.scanTaskId),
      409,
      'SCAN_TASK_NOT_DEVICE',
      '该扫描任务不是屏上扫描',
      undefined,
      '面板任务即使已完成也不带最终状态',
      fileId,
    )

    const switched = await deviceSession('switch')
    await deviceSvc.switchToPanel(switched.id, null, switched.token)
    await prisma.scanTask.update({
      where: { id: switched.id },
      data: { status: 'completed', fileId },
    })
    const switchedRow = await prisma.scanTask.findUniqueOrThrow({ where: { id: switched.id } })
    assert.equal(switchedRow.startMode, 'panel')
    assert.equal(switchedRow.deviceState, 'aborted')
    await expectReport(
      () => report(switched.t.id, switched.id),
      409,
      'SCAN_DEVICE_SWITCHED_TO_PANEL',
      '用户已改用面板扫描，请停止屏上扫描',
      undefined,
      '已改用面板的任务即使已完成也不带最终状态',
      fileId,
    )

    console.log('\nPASS verify-scan-device-b8')
  } finally {
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

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
