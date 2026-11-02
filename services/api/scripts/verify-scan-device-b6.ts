/**
 * 屏上扫描后端 B6：用扫描轮次替换 B4 的 deviceUpdatedAt 钉。
 *
 * 覆盖：
 *   1. 旧一轮拿到的租约，要等新一轮已经到 delivering 才投递 → 409 SCAN_TASK_STATE_CHANGED，不建文件
 *   2. 投递读行后、CAS 前有一次合法的同状态 delivering 重发（以及 composing → delivering）→ 正常投递仍成功
 *   3. 正常进纸器、玻璃台多页投递成功
 *   4. deviceRound 只在 ready / error → scanning 加一（同状态、翻页、改设置都不加）
 *   5. 轮次在签名负载里；改了签名就无效；改了轮次再签，投递要比对
 *   6. 面板任务的租约不多 deviceRound，投递不比轮次
 *
 * 写库：本脚本在库里造终端 / 会话 / 文件，结束时清理，所以必须在隔离库上跑
 * （VERIFICATION_DATABASE_TARGET=isolated，库名带 ci/dev/test/verify）。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:scan-device-b6
 */
import 'reflect-metadata'
process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '0'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-device-b6-secret-0123456789-abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-device-b6-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-device-b6-action-secret-0123456789'

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { AuditService } from '../src/audit/audit.service'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { signScanDeliveryLease, verifyScanDeliveryLease } from '../src/scan-tasks/scan-lease'
import { scanDeviceRoundStarts } from '../src/scan-tasks/scan-device-protocol'
import { ScanDeviceSessionsService } from '../src/scan-tasks/scan-device-sessions.service'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { StorageService } from '../src/storage/storage.service'
import { TerminalCapabilitiesService, setPrintScanCapabilityModeForTest } from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const STATE_CHANGED = 'SCAN_TASK_STATE_CHANGED'
const PANEL_LEASE_KEYS = ['deliveryLease', 'expiresAt', 'notBefore', 'scanTaskId', 'serverNow']

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

type HttpLike = { getStatus?: () => number; getResponse?: () => unknown }
function httpErrorOf(error: unknown): { status: number | undefined; code: string | undefined } {
  const e = error as HttpLike
  const body = e.getResponse?.() as { error?: { code?: string } } | undefined
  return { status: e.getStatus?.(), code: body?.error?.code }
}

async function expectHttp(run: () => Promise<unknown>, status: number, code: string, label: string): Promise<void> {
  try {
    await run()
  } catch (error) {
    const got = httpErrorOf(error)
    assert.equal(got.status, status, `${label}：HTTP 状态应为 ${status}，实际 ${String(got.status)}（${got.code}）`)
    assert.equal(got.code, code, `${label}：错误码应为 ${code}，实际 ${String(got.code)}`)
    pass(`${label}（${status} ${code}）`)
    return
  }
  assert.fail(`${label}：应当被拒绝（${status} ${code}），实际放行了`)
}

async function uniquePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  doc.setTitle(randomBytes(8).toString('hex'))
  return Buffer.from(await doc.save())
}

const sha256Of = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

function decodeLease(lease: string): Record<string, unknown> {
  const encoded = lease.split('.')[0]
  assert.ok(encoded, '租约缺少负载')
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  setPrintScanCapabilityModeForTest('managed')

  const suffix = randomBytes(5).toString('hex')
  const storageDir = mkdtempSync(join(tmpdir(), 'verify-scan-device-b6-storage-'))
  const originalStorageDir = process.env['FILE_STORAGE_DIR']
  process.env['FILE_STORAGE_DIR'] = storageDir

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const files = new FilesService(prisma, new AuditService(prisma), new StorageService())
  const scanSvc = new ScanTasksService(prisma, files, capabilities)
  const deviceSvc = new ScanDeviceSessionsService(prisma, capabilities)
  const terminalIds: string[] = []

  async function makeTerminal(tag: string, scanDevice: 'available' | null = 'available') {
    const id = `t_b6_${tag}_${suffix}`
    await prisma.terminal.create({
      data: {
        id,
        terminalCode: `B6-${tag}-${suffix}`.toUpperCase(),
        agentToken: `b6-token-${randomBytes(12).toString('hex')}`,
        deviceFingerprint: `verify-scan-device-b6-${suffix}`,
        enabled: true,
      },
    })
    terminalIds.push(id)
    if (scanDevice) await capabilities.upsert(id, 'scan_device', scanDevice, undefined, 'verify-scan-device-b6')
    return { id }
  }
  const rowOf = (id: string) => prisma.scanTask.findUniqueOrThrow({ where: { id } })

  type Session = { t: { id: string }; id: string; token: string }
  async function deviceSession(tag: string, source: 'flatbed' | 'feeder' = 'feeder'): Promise<Session> {
    const t = await makeTerminal(tag)
    const created = await scanSvc.create(
      { scanType: 'document', terminalId: t.id, startMode: 'device', source, colorMode: 'gray' },
      null,
    )
    await scanSvc.ack(created.scanTaskId, null, created.controlToken, t.id)
    return { t, id: created.scanTaskId, token: created.controlToken }
  }
  async function panelSession(tag: string): Promise<Session> {
    const t = await makeTerminal(tag, null)
    const created = await scanSvc.create({ scanType: 'document', terminalId: t.id }, null)
    await scanSvc.ack(created.scanTaskId, null, created.controlToken, t.id)
    return { t, id: created.scanTaskId, token: created.controlToken }
  }

  async function deliverWith(
    svc: ScanTasksService,
    s: Session,
    pdf: Buffer,
    lease: string,
    origin?: 'device' | 'watcher',
  ) {
    return svc.deliverScanFile({
      terminalId: s.t.id,
      scanTaskId: s.id,
      deliveryLease: lease,
      buffer: pdf,
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
      ...(origin ? { origin } : {}),
    })
  }
  const freshLease = async (s: Session) => (await scanSvc.getScanDeliveryLease(s.t.id)).deliveryLease

  /** 在 waiting → matched 的抢占真正执行前先跑钩子。 */
  function claimRace(hook: () => Promise<void>) {
    let ran = 0
    const bind = (target: object, prop: string | symbol) => {
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
    const scanTask = new Proxy(prisma.scanTask, {
      get(target, prop) {
        if (prop === 'updateMany') {
          return async (args: { data?: { status?: string } }) => {
            if (args?.data?.status === 'matched') {
              ran += 1
              await hook()
            }
            return prisma.scanTask.updateMany(args as never)
          }
        }
        return bind(target, prop)
      },
    })
    const wrapped = new Proxy(prisma, {
      get: (target, prop) => (prop === 'scanTask' ? scanTask : bind(target, prop)),
    }) as PrismaService
    return { svc: new ScanTasksService(wrapped, files, capabilities), ran: () => ran }
  }

  async function assertNoFile(label: string, s: Session, pdf: Buffer): Promise<void> {
    const row = await rowOf(s.id)
    assert.equal(row.status, 'waiting', `${label}：任务仍是 waiting`)
    assert.equal(row.fileId, null, `${label}：没有挂上文件`)
    assert.equal(row.lastAttemptHash, null, `${label}：不得留下已尝试的去重痕迹`)
    assert.equal(await prisma.fileObject.count({ where: { sha256: sha256Of(pdf) } }), 0, `${label}：库里不得出现这份内容`)
  }

  try {
    console.log('\n-- 轮次只在 ready / error → scanning 加一 --')
    {
      for (const [from, to, expected] of [
        ['ready', 'scanning', true],
        ['error', 'scanning', true],
        [null, 'scanning', true],
        ['ready', 'ready', false],
        ['scanning', 'scanning', false],
        ['page_ready', 'scanning', false],
        ['scanning', 'page_ready', false],
        ['page_ready', 'page_ready', false],
        ['composing', 'delivering', false],
        ['delivering', 'delivering', false],
        ['error', 'error', false],
        ['scanning', 'error', false],
      ] as const) {
        assert.equal(scanDeviceRoundStarts(from, to), expected, `${String(from)} → ${to} 是否开新一轮`)
      }
      const s = await deviceSession('rounds')
      const roundOf = async () => (await rowOf(s.id)).deviceRound
      assert.equal(await roundOf(), 0, '还没开始扫描时轮次是 0')
      await deviceSvc.report(s.t.id, s.id, { state: 'ready' })
      assert.equal(await roundOf(), 0, 'ready 重发不加')
      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
      assert.equal(await roundOf(), 1, 'ready → scanning 加一')
      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 2 })
      assert.equal(await roundOf(), 1, 'scanning 同状态重发不加')
      await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'paper_jam' })
      assert.equal(await roundOf(), 1, '转到 error 不加')
      await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'paper_jam' })
      assert.equal(await roundOf(), 1, 'error 同状态重发不加')
      await deviceSvc.updateDeviceSettings(s.id, null, s.token, { source: 'flatbed' })
      const reset = await rowOf(s.id)
      assert.equal(reset.deviceState, 'ready')
      assert.equal(reset.devicePageCount, 0)
      assert.equal(reset.deviceRound, 1, '改设置回到 ready 不加')
      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
      assert.equal(await roundOf(), 2, '改设置之后下一次 ready → scanning 才加一')
      await deviceSvc.report(s.t.id, s.id, { state: 'page_ready' })
      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 2 })
      await deviceSvc.report(s.t.id, s.id, { state: 'page_ready' })
      await deviceSvc.report(s.t.id, s.id, { state: 'composing' })
      await deviceSvc.report(s.t.id, s.id, { state: 'delivering' })
      await deviceSvc.report(s.t.id, s.id, { state: 'delivering' })
      assert.equal(await roundOf(), 2, '翻页、合成、投递中、同状态 delivering 都不加')
      pass('deviceRound 只在 ready / error → scanning 加一')
    }

    console.log('\n-- 签名负载里的轮次，面板不多这个字段 --')
    {
      const s = await deviceSession('signed')
      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
      const view = await scanSvc.getScanDeliveryLease(s.t.id)
      assert.equal(Object.prototype.hasOwnProperty.call(view, 'deviceRound'), false, '响应顶层不多 deviceRound')
      assert.equal(
        view.device !== undefined && Object.prototype.hasOwnProperty.call(view.device, 'deviceRound'),
        false,
        'device 段不多 deviceRound',
      )
      const verified = verifyScanDeliveryLease(view.deliveryLease, s.t.id, s.id)
      assert.equal(verified.deviceRound, 1, '已验签负载里的轮次就是当时库里的 deviceRound')
      assert.equal(decodeLease(view.deliveryLease)['deviceRound'], 1)

      const panel = await panelSession('panel')
      await prisma.scanTask.update({ where: { id: panel.id }, data: { deviceRound: 7 } })
      const panelView = await scanSvc.getScanDeliveryLease(panel.t.id)
      assert.deepEqual(Object.keys(panelView).sort(), PANEL_LEASE_KEYS, '面板租约响应一个键都不能多')
      const panelVerified = verifyScanDeliveryLease(panelView.deliveryLease, panel.t.id, panel.id)
      assert.equal(panelVerified.deviceRound, undefined, '面板签名负载没有 deviceRound')
      assert.equal('deviceRound' in decodeLease(panelView.deliveryLease), false)
      const panelResult = await deliverWith(scanSvc, panel, await uniquePdf(), panelView.deliveryLease)
      assert.equal(panelResult.scanTaskId, panel.id)
      assert.equal((await rowOf(panel.id)).status, 'completed', '库里轮次被改成 7，面板投递仍不比轮次')
      pass('device 轮次在签名负载里；面板租约不多字段、不比轮次')
    }

    console.log('\n-- 旧一轮的租约在新一轮已到 delivering 时才投递 --')
    {
      const s = await deviceSession('late')
      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 2 })
      await deviceSvc.report(s.t.id, s.id, { state: 'composing' })
      await deviceSvc.report(s.t.id, s.id, { state: 'delivering' })
      const oldLease = await freshLease(s)
      assert.equal(verifyScanDeliveryLease(oldLease, s.t.id, s.id).deviceRound, 1)
      await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'paper_jam' })
      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
      await deviceSvc.report(s.t.id, s.id, { state: 'composing' })
      await deviceSvc.report(s.t.id, s.id, { state: 'delivering' })
      const row = await rowOf(s.id)
      assert.equal(row.deviceRound, 2, '新一轮 error → scanning 之后轮次是 2')
      assert.equal(row.deviceState, 'delivering')
      const pdf = await uniquePdf()
      await expectHttp(
        () => deliverWith(scanSvc, s, pdf, oldLease, 'device'),
        409,
        STATE_CHANGED,
        '旧一轮租约在新一轮已到 delivering 时才投递',
      )
      await assertNoFile('旧租约迟到', s, pdf)
      assert.equal((await rowOf(s.id)).deviceRound, 2, '被拒的投递不得改轮次')
      assert.equal((await rowOf(s.id)).devicePageCount, 1, '新一轮的页数还在')

      const forged = signScanDeliveryLease({
        ...verifyScanDeliveryLease(await freshLease(s), s.t.id, s.id),
        deviceRound: 1,
      })
      const forgedPdf = await uniquePdf()
      await expectHttp(
        () => deliverWith(scanSvc, s, forgedPdf, forged, 'device'),
        409,
        STATE_CHANGED,
        '签名有效但轮次改成旧值',
      )
      await assertNoFile('改过轮次的租约', s, forgedPdf)

      const current = await freshLease(s)
      const signature = current.split('.')[1]
      const tamperedBody = decodeLease(current)
      tamperedBody['deviceRound'] = 99
      const tampered = `${Buffer.from(JSON.stringify(tamperedBody)).toString('base64url')}.${signature}`
      const tamperedPdf = await uniquePdf()
      await expectHttp(
        () => deliverWith(scanSvc, s, tamperedPdf, tampered, 'device'),
        409,
        'SCAN_LEASE_INVALID',
        '改签名负载里的轮次但不重新签名',
      )
      await assertNoFile('篡改负载', s, tamperedPdf)

      const ok = await deliverWith(scanSvc, s, await uniquePdf(), await freshLease(s), 'device')
      assert.equal(ok.scanTaskId, s.id)
      assert.equal((await rowOf(s.id)).status, 'completed', '新一轮用当时的租约仍能投递')
      pass('旧轮次租约被拒且不建文件；当时的轮次仍能投递')
    }

    console.log('\n-- 投递读行后、CAS 前的合法回报不挡正常投递 --')
    {
      const same = await deviceSession('resend')
      await deviceSvc.report(same.t.id, same.id, { state: 'scanning', pageCount: 2 })
      await deviceSvc.report(same.t.id, same.id, { state: 'composing' })
      await deviceSvc.report(same.t.id, same.id, { state: 'delivering' })
      const before = await rowOf(same.id)
      let resentAt = 0
      const raced = claimRace(async () => {
        await deviceSvc.report(same.t.id, same.id, { state: 'delivering', pageCount: 2 })
        resentAt = (await rowOf(same.id)).deviceUpdatedAt?.getTime() ?? 0
      })
      const pdf = await uniquePdf()
      const result = await deliverWith(raced.svc, same, pdf, await freshLease(same), 'device')
      assert.equal(raced.ran(), 1, '同状态重发必须发生在抢占之前')
      assert.ok(resentAt >= (before.deviceUpdatedAt?.getTime() ?? 0), '同状态重发确实写过 deviceUpdatedAt')
      assert.equal(result.scanTaskId, same.id)
      const after = await rowOf(same.id)
      assert.equal(after.status, 'completed')
      assert.equal(after.deviceRound, 1, '同状态重发没有把轮次加一')
      assert.ok(after.fileId)
      pass('读行后、CAS 前再报一次 delivering，投递仍成功')

      const flip = await deviceSession('flip')
      await deviceSvc.report(flip.t.id, flip.id, { state: 'scanning', pageCount: 2 })
      await deviceSvc.report(flip.t.id, flip.id, { state: 'composing' })
      const roundBefore = (await rowOf(flip.id)).deviceRound
      const racedFlip = claimRace(async () => {
        await deviceSvc.report(flip.t.id, flip.id, { state: 'delivering' })
      })
      const flipped = await deliverWith(racedFlip.svc, flip, await uniquePdf(), await freshLease(flip), 'device')
      assert.equal(racedFlip.ran(), 1)
      assert.equal(flipped.scanTaskId, flip.id)
      const flipRow = await rowOf(flip.id)
      assert.equal(flipRow.status, 'completed')
      assert.equal(flipRow.deviceState, 'delivering', 'composing → delivering 的回报留下了')
      assert.equal(flipRow.deviceRound, roundBefore, '这次状态变化不加轮次')
      pass('读行后、CAS 前从 composing 报到 delivering，投递仍成功')
    }

    console.log('\n-- 正常进纸器与玻璃台多页投递 --')
    {
      const feeder = await deviceSession('feeder', 'feeder')
      await deviceSvc.report(feeder.t.id, feeder.id, { state: 'scanning', pageCount: 1 })
      await deviceSvc.report(feeder.t.id, feeder.id, { state: 'scanning', pageCount: 3 })
      await deviceSvc.report(feeder.t.id, feeder.id, { state: 'composing' })
      await deviceSvc.report(feeder.t.id, feeder.id, { state: 'delivering' })
      assert.equal((await rowOf(feeder.id)).deviceRound, 1)
      const feederResult = await deliverWith(scanSvc, feeder, await uniquePdf(), await freshLease(feeder), 'device')
      assert.equal(feederResult.scanTaskId, feeder.id)
      const feederRow = await rowOf(feeder.id)
      assert.equal(feederRow.status, 'completed')
      assert.equal(feederRow.devicePageCount, 3)
      assert.equal(feederRow.deviceSource, 'feeder')
      assert.ok(feederRow.fileId)

      const flatbed = await deviceSession('flatbed', 'flatbed')
      await deviceSvc.report(flatbed.t.id, flatbed.id, { state: 'scanning', pageCount: 1 })
      await deviceSvc.report(flatbed.t.id, flatbed.id, { state: 'page_ready' })
      await deviceSvc.report(flatbed.t.id, flatbed.id, { state: 'scanning', pageCount: 2 })
      await deviceSvc.report(flatbed.t.id, flatbed.id, { state: 'page_ready' })
      await deviceSvc.report(flatbed.t.id, flatbed.id, { state: 'composing' })
      await deviceSvc.report(flatbed.t.id, flatbed.id, { state: 'delivering' })
      assert.equal((await rowOf(flatbed.id)).deviceRound, 1, '玻璃台翻页不加轮次')
      const flatbedResult = await deliverWith(scanSvc, flatbed, await uniquePdf(), await freshLease(flatbed), 'device')
      assert.equal(flatbedResult.scanTaskId, flatbed.id)
      const flatbedRow = await rowOf(flatbed.id)
      assert.equal(flatbedRow.status, 'completed')
      assert.equal(flatbedRow.devicePageCount, 2)
      assert.equal(flatbedRow.deviceSource, 'flatbed')
      assert.ok(flatbedRow.fileId)
      pass('进纸器 3 页、玻璃台 2 页都投递成功，轮次都只加了一次')
    }

    console.log('\nPASS verify-scan-device-b6')
  } finally {
    process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '0'
    setPrintScanCapabilityModeForTest(null)
    if (originalStorageDir === undefined) delete process.env['FILE_STORAGE_DIR']
    else process.env['FILE_STORAGE_DIR'] = originalStorageDir
    const tasks = await prisma.scanTask.findMany({ where: { terminalId: { in: terminalIds } }, select: { fileId: true } }).catch(() => [])
    const fileIds = tasks.map((task) => task.fileId).filter((id): id is string => Boolean(id))
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    if (fileIds.length > 0) await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } }).catch(() => undefined)
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
