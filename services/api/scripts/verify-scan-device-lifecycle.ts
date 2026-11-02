/**
 * 屏上扫描（device 路线）会话生命周期守门（后端第二批 B2 追加）：投递怎么抢占、截止时间怎么续。
 *
 * 为什么单独一个门禁：verify-scan-device-sessions.ts（1000 多行）与 verify-scan-device-settings.ts（700 多行）
 * 都已经够大（CLAUDE.md §8），这三处修复的用例不再往里堆。
 *
 * 覆盖：
 *   A. 投递抢占（B1 复审修复，B4 再钉 deviceUpdatedAt）：deliverScanFile 第 6 步把任务从 waiting 抢占成 matched 的那次条件更新，必须钉住读到的 startMode；
 *      device 任务另钉 deviceState ∈ composing / delivering、devicePageCount ≥ 1，以及读到的 deviceUpdatedAt。用包一层 PrismaService 的办法，
 *      在那次 updateMany 真正执行前先让别的请求赢（用户改用面板、终端程序回报 error / aborted、出错重扫又回到 delivering……），断言投递被
 *      409 SCAN_TASK_STATE_CHANGED 拒、任务仍是 waiting、没有挂上文件、没留下「已尝试」的去重痕迹；面板投递不受影响；进纸器与玻璃台的正常投递照常通过
 *   B. 截止时间只增不减（B1 复审修复）：report / switch-to-panel / device-settings 的条件更新都钉住读到的 expiresAt，
 *      并发的同状态回报（或别的续期）交错时，较晚算出的截止时间不会被较早算出的值覆盖回去
 *   C. 续期窗口（补稿 cs-scan-more）：回报 state=page_ready 续到 now+10 分钟，其余 state 仍 3 分钟，都不超过 hardExpiresAt
 *
 * 写库：本脚本在库里造终端 / 会话 / 文件，结束时清理，所以必须在隔离库上跑
 * （VERIFICATION_DATABASE_TARGET=isolated，库名带 ci/dev/test/verify）。
 * SQLite 与 PostgreSQL 两个 CI 作业各跑一遍。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:scan-device-lifecycle
 */
import 'reflect-metadata'
// 与生产默认一致：90 秒终端静默期（本门禁不依赖它，但不让运行环境里的同名变量悄悄改写行为）。
delete process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS']
// 本门禁不验证招聘托管内容；按生产配置（托管关闭）显式声明（verify-recruitment-hosting-gate-declares 的要求）。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-device-lifecycle-secret-0123456789-abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-device-lifecycle-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-device-lifecycle-action-secret-0123456789'

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditService } from '../src/audit/audit.service'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import * as protocol from '../src/scan-tasks/scan-device-protocol'
import { ScanDeviceSessionsService } from '../src/scan-tasks/scan-device-sessions.service'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { TerminalCapabilitiesService, setPrintScanCapabilityModeForTest } from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

// ── 规格（照任务包与协调方的修复说明写死，不从被测代码里取）─────────────────────────
/** 投递只收这两个设备状态（且至少 1 页）。 */
const SPEC_DELIVERABLE_STATES = ['composing', 'delivering']
const STATE_CHANGED = 'SCAN_TASK_STATE_CHANGED'

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

type HttpLike = { getStatus?: () => number; getResponse?: () => unknown }
function httpErrorOf(error: unknown): { status: number | undefined; code: string | undefined; message: string } {
  const e = error as HttpLike
  const body = e.getResponse?.() as { error?: { code?: string; message?: string } } | undefined
  return { status: e.getStatus?.(), code: body?.error?.code, message: String(body?.error?.message ?? '') }
}

async function expectHttp(run: () => Promise<unknown>, status: number, code: string, label: string): Promise<string> {
  try {
    await run()
  } catch (error) {
    const got = httpErrorOf(error)
    assert.equal(got.status, status, `${label}：HTTP 状态应为 ${status}，实际 ${String(got.status)}（${got.code}）${String(error)}`)
    assert.equal(got.code, code, `${label}：错误码应为 ${code}，实际 ${String(got.code)}`)
    pass(`${label}（${status} ${code}）`)
    return got.message
  }
  return assert.fail(`${label}：应当被拒绝（${status} ${code}），实际放行了`)
}

function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.4\n%${randomBytes(8).toString('hex')}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`, 'latin1')
}
const sha256Of = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  setPrintScanCapabilityModeForTest('managed')

  const suffix = randomBytes(5).toString('hex')
  const storageDir = mkdtempSync(join(tmpdir(), 'verify-scan-device-lifecycle-storage-'))
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
    const id = `t_slife_${tag}_${suffix}`
    await prisma.terminal.create({
      data: { id, terminalCode: `SLIFE-${tag}-${suffix}`.toUpperCase(), agentToken: `slife-token-${randomBytes(12).toString('hex')}`, deviceFingerprint: `verify-scan-device-lifecycle-${suffix}`, enabled: true },
    })
    terminalIds.push(id)
    if (scanDevice) await capabilities.upsert(id, 'scan_device', scanDevice, undefined, 'verify-scan-device-lifecycle')
    return { id }
  }
  const rowOf = (id: string) => prisma.scanTask.findUniqueOrThrow({ where: { id } })

  type Session = { t: { id: string }; id: string; token: string }
  async function deviceSession(tag: string, opts: { source?: 'flatbed' | 'feeder'; colorMode?: 'gray' | 'color' } = {}): Promise<Session> {
    const t = await makeTerminal(tag)
    const created = await scanSvc.create(
      { scanType: 'document', terminalId: t.id, startMode: 'device', source: opts.source ?? 'feeder', colorMode: opts.colorMode ?? 'gray' },
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
  /** device 会话推进到可投递：scanning（pages 页）→ composing（→ delivering）。 */
  async function readyToDeliver(tag: string, finalState: 'composing' | 'delivering' = 'composing'): Promise<Session> {
    const s = await deviceSession(tag)
    await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 2 })
    await deviceSvc.report(s.t.id, s.id, { state: 'composing' })
    if (finalState === 'delivering') await deviceSvc.report(s.t.id, s.id, { state: 'delivering' })
    return s
  }
  const leaseOf = async (s: Session) => (await scanSvc.getScanDeliveryLease(s.t.id)).deliveryLease
  async function deliver(svc: ScanTasksService, s: Session, pdf: Buffer, origin?: 'device' | 'watcher') {
    return svc.deliverScanFile({
      terminalId: s.t.id, scanTaskId: s.id, deliveryLease: await leaseOf(s), buffer: pdf, filename: 'scan.pdf',
      mimeType: 'application/pdf', observedAt: new Date().toISOString(), ...(origin ? { origin } : {}),
    })
  }

  try {
    // ── A. 投递抢占 ────────────────────────────────────────────────────────────
    console.log('\n-- A. 投递抢占（waiting → matched）要钉住扫描方式与设备状态 --')
    {
      // 包一层 PrismaService：只拦「waiting → matched」那次抢占（data.status === 'matched'）——先跑钩子再真正执行，
      // 模拟「读完快照、通过来源校验之后，别的请求先到」。心跳、completed、failed 等别的 updateMany 照常。
      const claimRace = (hook: () => Promise<void>) => {
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
        const wrapped = new Proxy(prisma, { get: (target, prop) => (prop === 'scanTask' ? scanTask : bind(target, prop)) }) as PrismaService
        return { svc: new ScanTasksService(wrapped, files, capabilities), ran: () => ran }
      }

      // A0. 钉住的列（纯函数）：面板任务只多一条恒真的 startMode，device 任务再多 deviceState / devicePageCount / deviceUpdatedAt
      assert.deepEqual([...protocol.SCAN_DEVICE_DELIVERABLE_STATES], SPEC_DELIVERABLE_STATES, '可投递的设备状态 = composing / delivering')
      assert.deepEqual(protocol.scanDeliverClaimPins({ startMode: 'panel' }), { startMode: 'panel' }, '面板任务只钉 startMode，不加设备条件')
      const readAt = new Date('2026-11-03T08:00:00.000Z')
      assert.deepEqual(
        protocol.scanDeliverClaimPins({ startMode: 'device' }),
        { startMode: 'device', deviceState: { in: SPEC_DELIVERABLE_STATES }, devicePageCount: { gte: 1 }, deviceUpdatedAt: null },
        'device 任务没读到 deviceUpdatedAt 时钉 null',
      )
      assert.deepEqual(
        protocol.scanDeliverClaimPins({ startMode: 'device', deviceUpdatedAt: readAt }),
        { startMode: 'device', deviceState: { in: SPEC_DELIVERABLE_STATES }, devicePageCount: { gte: 1 }, deviceUpdatedAt: readAt },
        'device 任务钉的是读到的那一个 deviceUpdatedAt，不是「现在」',
      )
      pass('抢占要钉的列：面板任务只有 startMode；device 任务另有 deviceState、devicePageCount ≥ 1、读到的 deviceUpdatedAt')

      /** 钩子先赢：投递被 409 拒、任务仍 waiting、没挂文件、没留去重痕迹。返回这次用的 PDF，供之后验证同一份内容还能投。 */
      async function expectClaimLost(label: string, s: Session, hook: () => Promise<void>): Promise<Buffer> {
        const pdf = uniquePdf()
        const raced = claimRace(hook)
        await expectHttp(() => deliver(raced.svc, s, pdf, 'device'), 409, STATE_CHANGED, label)
        assert.equal(raced.ran(), 1, `${label}：钩子必须在抢占那次 updateMany 之前执行过一次，否则这个用例什么都没证明`)
        const row = await rowOf(s.id)
        assert.equal(row.status, 'waiting', `${label}：任务仍是 waiting（没被抢占成 matched）`)
        assert.equal(row.fileId, null, `${label}：没有挂上文件`)
        assert.equal(row.lastAttemptHash, null, `${label}：抢占没成功，不得留下「已尝试」的去重痕迹（否则同一份内容再也投不进去）`)
        assert.equal(row.matchedFileMtime, null)
        assert.equal(await prisma.fileObject.count({ where: { sha256: sha256Of(pdf) } }), 0, `${label}：库里不得出现这份内容的文件`)
        return pdf
      }

      // A1. 抢占前用户「改用面板」：已切面板的会话不得收到设备扫描件；之后照面板流程能继续
      {
        const s = await readyToDeliver('claimswitch')
        const pdf = await expectClaimLost('投递读完快照后、抢占前用户改用面板', s, async () => {
          await deviceSvc.switchToPanel(s.id, null, s.token)
        })
        const row = await rowOf(s.id)
        assert.equal(row.startMode, 'panel')
        assert.equal(row.deviceState, 'aborted')
        const watcher = await deliver(scanSvc, s, pdf)
        assert.equal(watcher.scanTaskId, s.id)
        assert.equal((await rowOf(s.id)).status, 'completed', '改用面板之后，面板（watcher）仍能把同一份内容投进这个会话')
      }

      // A2. 抢占前终端程序回报 error：不得挂上设备扫描件；终端程序重来（error → scanning → composing）后同一份内容能投
      {
        const s = await readyToDeliver('claimerror')
        const pdf = await expectClaimLost('投递读完快照后、抢占前终端程序回报 error', s, async () => {
          await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'paper_jam' })
        })
        assert.equal((await rowOf(s.id)).deviceState, 'error', '终端程序的 error 回报没有被投递覆盖')
        await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
        await deviceSvc.report(s.t.id, s.id, { state: 'composing' })
        await deliver(scanSvc, s, pdf, 'device')
        assert.equal((await rowOf(s.id)).status, 'completed', '终端程序恢复后同一份内容能投进去')
      }

      // A2b. B4 防 ABA：抢占前出错重扫已经回到 delivering（状态和页数再次可投递），旧投递仍不得挂上新一轮
      {
        const s = await readyToDeliver('claimaba')
        await expectClaimLost('出错重扫回到 delivering 后旧投递迟到', s, async () => {
          await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'paper_jam' })
          await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
          await deviceSvc.report(s.t.id, s.id, { state: 'composing' })
          await deviceSvc.report(s.t.id, s.id, { state: 'delivering' })
        })
        const row = await rowOf(s.id)
        assert.equal(row.status, 'waiting', '旧投递没把新一轮抢占走')
        assert.equal(row.deviceState, 'delivering', '新一轮的 delivering 回报还在')
        assert.equal(row.devicePageCount, 1, '新一轮的页数还在，没有被旧投递改掉')
        assert.equal(row.fileId, null)
      }

      // A3. 抢占前终端程序回报 aborted：不得挂上设备扫描件；用户还能改用面板
      {
        const s = await readyToDeliver('claimaborted')
        const pdf = await expectClaimLost('投递读完快照后、抢占前终端程序回报 aborted', s, async () => {
          await deviceSvc.report(s.t.id, s.id, { state: 'aborted' })
        })
        assert.equal((await rowOf(s.id)).deviceState, 'aborted')
        await deviceSvc.switchToPanel(s.id, null, s.token)
        await deliver(scanSvc, s, pdf)
        assert.equal((await rowOf(s.id)).status, 'completed', '中止之后用户改用面板，同一份内容仍能走面板投递')
      }

      // A4 / A5. 只翻一列，证明每条新增的条件都各自有用
      {
        const s = await readyToDeliver('claimmode')
        await expectClaimLost('只有 startMode 被改成 panel（设备状态与页数都没动）', s, async () => {
          await prisma.scanTask.update({ where: { id: s.id }, data: { startMode: 'panel' } })
        })
        const p = await readyToDeliver('claimpages')
        await expectClaimLost('只有 devicePageCount 被改成 0（设备状态没动）', p, async () => {
          await prisma.scanTask.update({ where: { id: p.id }, data: { devicePageCount: 0 } })
        })
      }
      pass('抢占前别的请求先赢（改用面板 / error / aborted / 只翻 startMode / 只翻页数）：全部 409 且不挂文件、不留去重痕迹；用户的后路（面板、终端重来）仍通')

      // A6. 正向对照：可投递的设备会话（composing、delivering）经同一个包装服务照常投递成功
      for (const state of ['composing', 'delivering'] as const) {
        const s = await readyToDeliver(`claimok_${state}`, state)
        const raced = claimRace(async () => undefined)
        const result = await deliver(raced.svc, s, uniquePdf(), 'device')
        assert.equal(raced.ran(), 1)
        assert.equal(result.scanTaskId, s.id)
        const row = await rowOf(s.id)
        assert.equal(row.status, 'completed')
        assert.ok(row.fileId)
        assert.equal(row.devicePageCount, 2)
      }
      pass('正向对照：deviceState=composing / delivering 且已收 ≥ 1 页的进纸器会话经抢占照常投递成功')

      // A6b. 玻璃台同样能投：page_ready 之后 composing → delivering，经同一个包装服务照常成功
      {
        const s = await deviceSession('claimflatbed', { source: 'flatbed' })
        await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
        await deviceSvc.report(s.t.id, s.id, { state: 'page_ready' })
        await deviceSvc.report(s.t.id, s.id, { state: 'composing' })
        await deviceSvc.report(s.t.id, s.id, { state: 'delivering' })
        const raced = claimRace(async () => undefined)
        const result = await deliver(raced.svc, s, uniquePdf(), 'device')
        assert.equal(raced.ran(), 1)
        assert.equal(result.scanTaskId, s.id)
        const row = await rowOf(s.id)
        assert.equal(row.status, 'completed')
        assert.equal(row.deviceSource, 'flatbed')
        assert.ok(row.fileId)
      }
      pass('正向对照：玻璃台（flatbed）走到 delivering 后照常投递成功')

      // A7. 面板路线不受影响：不加设备条件——即使设备列被翻到“不可投递”的样子，面板任务照常投递
      {
        const s = await panelSession('claimpanel')
        const raced = claimRace(async () => {
          await prisma.scanTask.update({ where: { id: s.id }, data: { deviceState: 'error', devicePageCount: 0, deviceErrorCode: 'paper_jam' } })
        })
        const result = await deliver(raced.svc, s, uniquePdf())
        assert.equal(raced.ran(), 1, '钩子确实在抢占前执行过')
        assert.equal(result.scanTaskId, s.id)
        assert.equal((await rowOf(s.id)).status, 'completed', '面板任务的抢占不看设备列')

        // 已改用面板的会话（startMode=panel、deviceState=aborted）走 watcher 投递同样不受影响
        const sw = await readyToDeliver('claimswitched')
        await deviceSvc.switchToPanel(sw.id, null, sw.token)
        const raced2 = claimRace(async () => {
          await prisma.scanTask.update({ where: { id: sw.id }, data: { deviceState: 'error', devicePageCount: 0 } })
        })
        await deliver(raced2.svc, sw, uniquePdf())
        assert.equal(raced2.ran(), 1)
        assert.equal((await rowOf(sw.id)).status, 'completed')

        // 现有行为照旧：抢占前会话被取消 → 409（status 仍是钉住的）
        const c = await panelSession('claimcancel')
        const raced3 = claimRace(async () => {
          await scanSvc.cancel(c.id, null, c.token)
        })
        await expectHttp(() => deliver(raced3.svc, c, uniquePdf()), 409, STATE_CHANGED, '面板会话：抢占前被取消，现有行为照旧 409')
        assert.equal(raced3.ran(), 1)
        assert.equal((await rowOf(c.id)).status, 'cancelled')
      }
      pass('面板路线不受影响：设备列被翻也照常投递；已改用面板的会话 watcher 投递照常；抢占前被取消仍是原来的 409')
    }

    // ── B. 截止时间只增不减 ────────────────────────────────────────────────────
    console.log('\n-- B. 并发时截止时间只增不减（条件更新钉住读到的 expiresAt）--')
    {
      // 在服务读到行之后、写之前插入别人的操作，来模拟并发（每次 findUnique 返回后调一次钩子，read 从 1 数起）
      const racing = (hook: (read: number, id: string) => Promise<void>) => {
        let reads = 0
        const wrapped = {
          scanTask: {
            findUnique: async (args: { where: { id: string } }) => {
              const row = await prisma.scanTask.findUnique(args as never)
              reads += 1
              await hook(reads, args.where.id)
              return row
            },
            updateMany: (args: never) => prisma.scanTask.updateMany(args),
          },
        }
        return { svc: new ScanDeviceSessionsService(wrapped as never, capabilities), reads: () => reads }
      }
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

      // B1. 两条同状态回报交错：先读的那条（A）在写之前，后读的那条（B）已经写完，A 的 now 比 B 的早，
      //     A 算出的截止时间比 B 的小。A 的条件更新钉住读到的 expiresAt，写不进去 → 重读 → 按最新值重新续，最终不小于 B 写下的值
      {
        const s = await deviceSession('monoreport')
        await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
        // 把截止时间压到 now+30 秒，两条回报才都真的要续（续到各自的 now+3 分钟）
        await prisma.scanTask.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() + 30_000) } })
        let laterValue = 0
        const racer = racing(async (read, id) => {
          if (read !== 1) return
          await sleep(40) // 保证 B 的 now 比 A 的 now 至少晚 40ms，两条续出来的截止时间可区分
          await deviceSvc.report(s.t.id, id, { state: 'scanning', pageCount: 1 })
          laterValue = (await rowOf(id)).expiresAt.getTime()
        })
        const result = await racer.svc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
        const finalAt = (await rowOf(s.id)).expiresAt.getTime()
        assert.ok(laterValue > 0, '钩子必须执行过（较晚那条回报已写下截止时间）')
        assert.ok(finalAt >= laterValue, `两条同状态回报交错：截止时间只增不减。较晚那条写下 ${laterValue}，最终却是 ${finalAt}（被较早算出的值覆盖回去了）`)
        assert.equal(result.expiresAt, new Date(finalAt).toISOString(), '响应里的 expiresAt 与库一致')
        assert.equal(racer.reads(), 2, '条件更新对不上后重读重判了一次')
        assert.equal((await rowOf(s.id)).deviceState, 'scanning')
      }

      // B2. 改用面板与别人的续期交错：别人刚把截止时间续到 25 分钟后（比 now+10 分钟更晚，仍在 hardExpiresAt 之内），
      //     改用面板不得把它写回 now+10 分钟
      {
        const s = await deviceSession('monoswitch')
        await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'feeder_empty' })
        await prisma.scanTask.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() + 30_000) } })
        const extended = new Date(Date.now() + 25 * 60_000)
        const racer = racing(async (read, id) => {
          if (read === 1) await prisma.scanTask.update({ where: { id }, data: { expiresAt: extended } })
        })
        const result = await racer.svc.switchToPanel(s.id, null, s.token)
        const row = await rowOf(s.id)
        assert.equal(row.startMode, 'panel')
        assert.ok(row.expiresAt.getTime() >= extended.getTime(), `改用面板与别人的续期交错：截止时间只增不减。别人续到 ${extended.getTime()}，最终却是 ${row.expiresAt.getTime()}`)
        assert.equal(result.expiresAt, row.expiresAt.toISOString(), '响应里的 expiresAt 与库一致')
        assert.equal(racer.reads(), 2, '条件更新对不上后重读重判了一次')
      }

      // B3. 改扫描设置与别人的续期交错：同上
      {
        const s = await deviceSession('monosettings')
        await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'feeder_empty' })
        await prisma.scanTask.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() + 30_000) } })
        const extended = new Date(Date.now() + 25 * 60_000)
        const racer = racing(async (read, id) => {
          if (read === 1) await prisma.scanTask.update({ where: { id }, data: { expiresAt: extended } })
        })
        const result = await racer.svc.updateDeviceSettings(s.id, null, s.token, { source: 'flatbed' })
        const row = await rowOf(s.id)
        assert.equal(row.deviceSource, 'flatbed')
        assert.equal(row.deviceState, 'ready')
        assert.ok(row.expiresAt.getTime() >= extended.getTime(), `改设置与别人的续期交错：截止时间只增不减。别人续到 ${extended.getTime()}，最终却是 ${row.expiresAt.getTime()}`)
        assert.equal(result.expiresAt, row.expiresAt.toISOString(), '响应里的 expiresAt 与库一致')
        assert.equal(racer.reads(), 2, '条件更新对不上后重读重判了一次')
      }
      pass('截止时间只增不减：两条同状态回报交错、改用面板与别人的续期交错、改设置与别人的续期交错——条件更新钉住读到的 expiresAt，对不上就重读重判')
    }

    // ── C. 续期窗口 ────────────────────────────────────────────────────────────
    console.log('\n-- C. 回报续期窗口：page_ready 10 分钟，其余 3 分钟（补稿 cs-scan-more）--')
    {
      const MIN = 60_000
      // 规格写死：补稿 cs-scan-more（玻璃台「这一页扫好了」屏）写「最多 20 页；10 分钟内没操作会自动结束，并删除已扫的页」，
      // 用户放下一页稍慢一点，会话不能只剩 3 分钟就过期；其余回报沿用 B1 的 3 分钟。
      assert.equal(protocol.SCAN_DEVICE_PAGE_READY_RENEW_WINDOW_MS, 10 * MIN)
      assert.equal(protocol.SCAN_DEVICE_RENEW_WINDOW_MS, 3 * MIN)
      for (const state of protocol.SCAN_DEVICE_STATES) {
        assert.equal(protocol.scanDeviceReportRenewWindowMs(state), state === 'page_ready' ? 10 * MIN : 3 * MIN, `${state} 回报的续期窗口`)
      }

      const near = (actual: number, expected: number) => Math.abs(actual - expected) < 10_000
      const s = await deviceSession('pageready')
      const squeeze = (id = s.id) => prisma.scanTask.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 30_000) } })
      const report = async (input: Parameters<ScanDeviceSessionsService['report']>[2]) => {
        const t0 = Date.now()
        const result = await deviceSvc.report(s.t.id, s.id, input)
        const row = await rowOf(s.id)
        assert.equal(result.expiresAt, row.expiresAt.toISOString(), `${input.state}：响应里的 expiresAt 与库一致`)
        assert.ok(row.expiresAt.getTime() <= (row.hardExpiresAt as Date).getTime(), `${input.state}：续期不超过 hardExpiresAt`)
        return { t0, row }
      }

      // 只剩 30 秒时回报：scanning 仍续到约 3 分钟
      await squeeze()
      let r = await report({ state: 'scanning', pageCount: 1 })
      assert.ok(near(r.row.expiresAt.getTime(), r.t0 + 3 * MIN), `scanning 回报应续到约 now+3 分钟，实际差 ${r.row.expiresAt.getTime() - r.t0 - 3 * MIN}ms`)

      // page_ready：续到至少 now+10 分钟（且不超过 hardExpiresAt）
      await squeeze()
      r = await report({ state: 'page_ready', pageCount: 1 })
      assert.ok(r.row.expiresAt.getTime() >= r.t0 + 10 * MIN, `page_ready 回报后 expiresAt 应 ≥ now+10 分钟，实际只剩 ${Math.round((r.row.expiresAt.getTime() - r.t0) / 1000)} 秒`)
      assert.ok(near(r.row.expiresAt.getTime(), r.t0 + 10 * MIN), 'page_ready 回报续到约 now+10 分钟（不是更久）')

      // 同状态重复回报 page_ready：仍是 10 分钟
      await squeeze()
      r = await report({ state: 'page_ready' })
      assert.ok(r.row.expiresAt.getTime() >= r.t0 + 10 * MIN, '重复回报 page_ready 同样续到 ≥ now+10 分钟')

      // 用户点「再扫一页」：page_ready → scanning。截止时间不缩短（max 取较大者）
      const beforeNext = (await rowOf(s.id)).expiresAt.getTime()
      r = await report({ state: 'scanning', pageCount: 2 })
      assert.ok(r.row.expiresAt.getTime() >= beforeNext, '再扫下一页的 scanning 回报不得把已续到的 10 分钟缩回 3 分钟')

      // 第二页扫好：又是 10 分钟
      await squeeze()
      r = await report({ state: 'page_ready', pageCount: 2 })
      assert.ok(r.row.expiresAt.getTime() >= r.t0 + 10 * MIN, '第二页 page_ready 也续到 ≥ now+10 分钟')

      // 点「扫完了」：composing 与 error 仍是 3 分钟
      await squeeze()
      r = await report({ state: 'composing' })
      assert.ok(near(r.row.expiresAt.getTime(), r.t0 + 3 * MIN), `composing 回报应续到约 now+3 分钟，实际差 ${r.row.expiresAt.getTime() - r.t0 - 3 * MIN}ms`)
      await squeeze()
      r = await report({ state: 'error', errorCode: 'paper_jam' })
      assert.ok(near(r.row.expiresAt.getTime(), r.t0 + 3 * MIN), `error 回报应续到约 now+3 分钟，实际差 ${r.row.expiresAt.getTime() - r.t0 - 3 * MIN}ms`)

      // 封顶：hardExpiresAt 只剩 6 分钟，page_ready 的 10 分钟窗口也只能续到 hardExpiresAt
      const capped = await deviceSession('pagereadycap')
      await deviceSvc.report(capped.t.id, capped.id, { state: 'scanning', pageCount: 1 })
      const hardAt = new Date(Date.now() + 6 * MIN)
      await prisma.scanTask.update({ where: { id: capped.id }, data: { hardExpiresAt: hardAt, expiresAt: new Date(Date.now() + 30_000) } })
      const cappedResult = await deviceSvc.report(capped.t.id, capped.id, { state: 'page_ready', pageCount: 1 })
      assert.equal((await rowOf(capped.id)).expiresAt.getTime(), hardAt.getTime(), 'page_ready 的续期也必须封顶在 hardExpiresAt')
      assert.equal(cappedResult.expiresAt, hardAt.toISOString())

      // 已经更长不缩短：截止时间已是 20 分钟后（仍在 hardExpiresAt 之内），page_ready 不得缩短它
      const longer = await deviceSession('pagereadylonger')
      await deviceSvc.report(longer.t.id, longer.id, { state: 'scanning', pageCount: 1 })
      const farAt = new Date(Date.now() + 20 * MIN)
      await prisma.scanTask.update({ where: { id: longer.id }, data: { expiresAt: farAt } })
      await deviceSvc.report(longer.t.id, longer.id, { state: 'page_ready', pageCount: 1 })
      assert.equal((await rowOf(longer.id)).expiresAt.getTime(), farAt.getTime(), '已超过 now+10 分钟的截止时间不被缩短')
      pass('page_ready 回报续到 ≥ now+10 分钟且 ≤ hardExpiresAt（重复回报同样）；scanning / composing / error 仍是 3 分钟；再扫下一页不缩短；封顶 hardExpiresAt；已更长不缩短')
    }

    // @@NEXT-SECTION@@

    console.log('\nPASS verify-scan-device-lifecycle')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    if (originalStorageDir === undefined) delete process.env['FILE_STORAGE_DIR']
    else process.env['FILE_STORAGE_DIR'] = originalStorageDir
    const tasks = await prisma.scanTask.findMany({ where: { terminalId: { in: terminalIds } }, select: { fileId: true } }).catch(() => [])
    const fileIds = tasks.map((task) => task.fileId).filter((id): id is string => Boolean(id))
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } }).catch(() => undefined)
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
