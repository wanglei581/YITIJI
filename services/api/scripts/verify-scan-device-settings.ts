/**
 * 屏上扫描（device 路线）「原地改扫描设置」守门（后端第二批 B2，任务包 ③ 屏上扫描 §2 与补稿出错屏「改用玻璃台」）。
 *
 * 为什么单独一个门禁：verify-scan-device-sessions.ts 已超过 1000 行（CLAUDE.md §8），B2 的新规则不再往里堆。
 *
 * 覆盖：
 *   A. 契约：共享包 scanTask.ts 的五个常量数组与后端 scan-device-protocol.ts 逐项一致且等于任务包规格；
 *      共享包里的 409 / 403 原因码常量 = 后端实际抛的码（下面全部用共享常量作期望值）；新类型与可选字段；
 *      接口路径 / 方法 / 限额 / 不挂维护拦截
 *   B. 成功路径：error(feeder_empty) 后改 flatbed——来源变、state 回 ready、errorCode 清、页数 0、expiresAt 续到 ≥ now+10 分钟
 *      且 ≤ hardExpiresAt、会话 / 令牌 / ACK 不变；之后终端程序回报 scanning 被收下；回报表不动（回报 error → ready 仍 409）
 *   C. 不吃静默期：同一终端此刻在静默期内（另一场会话刚取消 / 过期）时改来源照样成功，且改完能走完 device 投递
 *   D. 只改颜色；两个都不给 400；取值非法 400（先于任何库访问，库里不变）；DTO 取值范围与多余字段
 *   E. 状态：只在 ready / error 允许；scanning / page_ready / composing / delivering / aborted 都 409 SETTINGS_LOCKED
 *   F. 不能改的情形：面板任务、已改用面板、已投递、已取消 / 过期 / 结束、hardExpiresAt 已到、scan_device 被关、令牌错、别的会员
 *   G. 续期边界：只剩 30 秒续到约 10 分钟、已更长不缩短、封顶 hardExpiresAt
 *   H. 幂等：同值第二次不写库、不续期；同值但在 error 状态仍会清错
 *   I. 并发：条件更新（CAS），读写之间被改了重读重判；一直对不上 409 STATE_CHANGED；不覆盖别人刚改的另一项
 *   J. GET 会话多返回 deviceSource / deviceColorMode / deviceUpdatedAt（device 任务有值、面板任务 null）
 *   K. HTTP 真路由：全局 ValidationPipe 下的 400、控制令牌 403、200、409
 *
 * 写库：本脚本在库里造终端 / 会话 / 文件，结束时清理，所以必须在隔离库上跑
 * （VERIFICATION_DATABASE_TARGET=isolated，库名带 ci/dev/test/verify）。
 * SQLite 与 PostgreSQL 两个 CI 作业各跑一遍。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:scan-device-settings
 */
import 'reflect-metadata'
// 要验「改设置不吃静默期」，必须用生产默认的 90 秒静默期（verify-scan-tasks 为了老用例把它关成 0，这里不能）。
delete process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS']
// 本门禁不验证招聘托管内容；按生产配置（托管关闭）显式声明，免得被运行环境里的同名变量悄悄带偏
// （verify-recruitment-hosting-gate-declares 要求引用了终端管理服务的门禁显式赋值）。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-device-settings-secret-0123456789-abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-device-settings-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-device-settings-action-secret-0123456789'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Module, RequestMethod, UnauthorizedException, ValidationPipe, type INestApplication } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { MAINTENANCE_BLOCKED_METADATA } from '../src/ai-access/ai-access.decorator'
import { AuditService } from '../src/audit/audit.service'
import { RedisService } from '../src/common/redis/redis.service'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { ScanDeviceSettingsDto } from '../src/scan-tasks/dto/scan-device-settings.dto'
import { ScanDeviceController } from '../src/scan-tasks/scan-device.controller'
import * as protocol from '../src/scan-tasks/scan-device-protocol'
import { ScanDeviceSessionsService } from '../src/scan-tasks/scan-device-sessions.service'
import { ScanTasksController } from '../src/scan-tasks/scan-tasks.controller'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { TerminalCapabilitiesService, setPrintScanCapabilityModeForTest } from '../src/terminals/terminal-capabilities.service'
import { TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import * as sharedScan from '../../../packages/shared/src/types/scanTask'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

// ── 规格（照任务包 §2.1 与补稿写死，不从被测代码里取）──────────────────────────────
const SPEC_START_MODES = ['panel', 'device'] as const
const SPEC_SOURCES = ['flatbed', 'feeder'] as const
const SPEC_COLOR_MODES = ['gray', 'color'] as const
const SPEC_STATES = ['ready', 'scanning', 'page_ready', 'composing', 'delivering', 'error', 'aborted'] as const
const SPEC_ERROR_CODES = [
  'feeder_empty', 'paper_jam', 'cover_open', 'busy', 'warming_up', 'not_ready', 'timeout', 'too_large', 'unknown',
] as const
/** 改设置只在这两个状态允许；其余（含 aborted）一律 SETTINGS_LOCKED。 */
const SPEC_SETTABLE_STATES: readonly string[] = ['ready', 'error']
/** 响应的键集合（任务包 B2 第 2 项）。 */
const SPEC_RESPONSE_KEYS = ['colorMode', 'deviceErrorCode', 'devicePageCount', 'deviceState', 'expiresAt', 'scanTaskId', 'source', 'startMode']
/** 共享包里一体机要判的码：值就是后端 error.code。 */
const SHARED_CODE_NAMES = [
  'SCAN_DEVICE_NOT_VERIFIED_ON_TERMINAL', 'SCAN_DEVICE_SETTINGS_LOCKED', 'SCAN_DEVICE_CAPABILITY_DISABLED',
  'SCAN_DEVICE_ALREADY_DELIVERED', 'SCAN_TASK_NOT_DEVICE', 'SCAN_DEVICE_STATE_CHANGED', 'SCAN_TASK_NOT_ACTIVE',
] as const
const { SCAN_DEVICE_SETTINGS_LOCKED, SCAN_DEVICE_CAPABILITY_DISABLED, SCAN_DEVICE_ALREADY_DELIVERED, SCAN_TASK_NOT_DEVICE, SCAN_DEVICE_STATE_CHANGED, SCAN_TASK_NOT_ACTIVE } = sharedScan
const SETTINGS_INVALID = 'SCAN_DEVICE_SETTINGS_INVALID'

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

type HttpLike = { getStatus?: () => number; getResponse?: () => unknown }
function httpErrorOf(error: unknown): { status: number | undefined; code: string | undefined; message: string } {
  const e = error as HttpLike
  const body = e.getResponse?.() as { error?: { code?: string; message?: string } } | undefined
  return { status: e.getStatus?.(), code: body?.error?.code, message: String(body?.error?.message ?? '') }
}

async function expectHttp(run: () => Promise<unknown>, status: number, code: string, label: string, quiet = false): Promise<string> {
  try {
    await run()
  } catch (error) {
    const got = httpErrorOf(error)
    assert.equal(got.status, status, `${label}：HTTP 状态应为 ${status}，实际 ${String(got.status)}（${got.code}）${String(error)}`)
    assert.equal(got.code, code, `${label}：错误码应为 ${code}，实际 ${String(got.code)}`)
    if (!quiet) pass(`${label}（${status} ${code}）`)
    return got.message
  }
  return assert.fail(`${label}：应当被拒绝（${status} ${code}），实际放行了`)
}

function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.4\n%${randomBytes(8).toString('hex')}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`, 'latin1')
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  setPrintScanCapabilityModeForTest('managed')

  const suffix = randomBytes(5).toString('hex')
  const storageDir = mkdtempSync(join(tmpdir(), 'verify-scan-device-settings-storage-'))
  const originalStorageDir = process.env['FILE_STORAGE_DIR']
  process.env['FILE_STORAGE_DIR'] = storageDir

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const files = new FilesService(prisma, new AuditService(prisma), new StorageService())
  const scanSvc = new ScanTasksService(prisma, files, capabilities)
  const deviceSvc = new ScanDeviceSessionsService(prisma, capabilities)
  const quiet = scanSvc as unknown as { assertTerminalQuietPeriod: (terminalId: string) => Promise<void> }

  const terminalIds: string[] = []
  const tokens = new Map<string, string>()
  const endUserIds: string[] = []
  let app: INestApplication | undefined

  async function makeTerminal(tag: string, scanDevice: 'available' | 'maintenance' | null = 'available') {
    const id = `t_sset_${tag}_${suffix}`
    const token = `sset-token-${randomBytes(12).toString('hex')}`
    await prisma.terminal.create({
      data: { id, terminalCode: `SSET-${tag}-${suffix}`.toUpperCase(), agentToken: token, deviceFingerprint: `verify-scan-device-settings-${suffix}`, enabled: true },
    })
    terminalIds.push(id)
    tokens.set(id, token)
    if (scanDevice) await capabilities.upsert(id, 'scan_device', scanDevice, undefined, 'verify-scan-device-settings')
    return { id, token }
  }
  const rowOf = (id: string) => prisma.scanTask.findUniqueOrThrow({ where: { id } })

  async function deviceSession(terminalId: string, opts: { source?: 'flatbed' | 'feeder'; colorMode?: 'gray' | 'color'; endUserId?: string | null } = {}) {
    const created = await scanSvc.create(
      { scanType: 'document', terminalId, startMode: 'device', source: opts.source ?? 'feeder', colorMode: opts.colorMode ?? 'gray' },
      opts.endUserId ?? null,
    )
    await scanSvc.ack(created.scanTaskId, opts.endUserId ?? null, created.controlToken, terminalId)
    return created
  }
  /** 新终端 + 新 device 会话 + 终端程序回报 scanning 后出错（默认进纸器无纸），返回常用句柄。 */
  async function erroredSession(tag: string, opts: { source?: 'flatbed' | 'feeder'; colorMode?: 'gray' | 'color'; endUserId?: string | null; errorCode?: protocol.ScanDeviceErrorCode } = {}) {
    const t = await makeTerminal(tag)
    const created = await deviceSession(t.id, opts)
    await deviceSvc.report(t.id, created.scanTaskId, { state: 'scanning' })
    await deviceSvc.report(t.id, created.scanTaskId, { state: 'error', errorCode: opts.errorCode ?? 'feeder_empty' })
    return { t, id: created.scanTaskId, token: created.controlToken }
  }
  const change = (s: { id: string; token: string }, input: Record<string, unknown>, endUserId: string | null = null) =>
    deviceSvc.updateDeviceSettings(s.id, endUserId, s.token, input)

  try {
    // ── A. 契约 ────────────────────────────────────────────────────────────────
    console.log('\n-- A. 契约与静态 --')
    const arrays = [
      ['SCAN_START_MODES', sharedScan.SCAN_START_MODES, protocol.SCAN_START_MODES, SPEC_START_MODES],
      ['SCAN_DEVICE_SOURCES', sharedScan.SCAN_DEVICE_SOURCES, protocol.SCAN_DEVICE_SOURCES, SPEC_SOURCES],
      ['SCAN_DEVICE_COLOR_MODES', sharedScan.SCAN_DEVICE_COLOR_MODES, protocol.SCAN_DEVICE_COLOR_MODES, SPEC_COLOR_MODES],
      ['SCAN_DEVICE_STATES', sharedScan.SCAN_DEVICE_STATES, protocol.SCAN_DEVICE_STATES, SPEC_STATES],
      ['SCAN_DEVICE_ERROR_CODES', sharedScan.SCAN_DEVICE_ERROR_CODES, protocol.SCAN_DEVICE_ERROR_CODES, SPEC_ERROR_CODES],
    ] as const
    for (const [name, shared, backend, spec] of arrays) {
      assert.deepEqual([...shared], [...backend], `${name}：共享契约（packages/shared/src/types/scanTask.ts）与后端副本（scan-device-protocol.ts）必须逐项一致`)
      assert.deepEqual([...shared], [...spec], `${name}：必须等于任务包规格`)
    }
    pass('共享契约的五个常量数组（startMode / 来源 / 颜色 / 状态 / 出错原因）与后端副本逐项一致，且等于任务包规格')
    assert.deepEqual([...protocol.SCAN_DEVICE_SETTABLE_STATES], [...SPEC_SETTABLE_STATES], '改设置只在 ready / error 两个状态允许')
    for (const name of SHARED_CODE_NAMES) assert.equal(sharedScan[name], name, `共享常量 ${name} 的值必须就是它的名字（= 后端 error.code）`)
    pass('共享契约里一体机要判的 7 个原因码常量值 = 码名（下面全部用它们作期望值去打后端）')

    const repoRoot = join(__dirname, '../../..')
    const sharedSource = readFileSync(join(repoRoot, 'packages/shared/src/types/scanTask.ts'), 'utf8')
    const interfaceBody = (name: string) => new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(sharedSource)?.[1]
    const createBody = interfaceBody('ScanSessionCreateRequest')
    assert.ok(createBody, '共享契约缺 ScanSessionCreateRequest')
    for (const key of ['startMode', 'source', 'colorMode']) assert.match(createBody, new RegExp(`\\b${key}\\?:`), `ScanSessionCreateRequest 缺可选字段 ${key}`)
    assert.doesNotMatch(createBody, /[Cc]ontrolToken/, '凭证不得进 body 类型（与一体机真实性门禁同一条）')
    const statusBody = interfaceBody('ScanSessionStatusResponse')
    assert.ok(statusBody, '共享契约缺 ScanSessionStatusResponse')
    for (const key of ['startMode', 'deviceState', 'devicePageCount', 'deviceErrorCode', 'deviceSource', 'deviceColorMode', 'deviceUpdatedAt']) {
      assert.match(statusBody, new RegExp(`\\b${key}\\?:`), `ScanSessionStatusResponse.${key} 必须是可选字段：老服务端不带，一体机缺省按面板处理`)
    }
    const settingsRequest = interfaceBody('ScanDeviceSettingsRequest')
    assert.ok(settingsRequest && /\bsource\?:/.test(settingsRequest) && /\bcolorMode\?:/.test(settingsRequest), 'ScanDeviceSettingsRequest 要有可选的 source / colorMode')
    const settingsResponse = interfaceBody('ScanDeviceSettingsResponse')
    assert.ok(settingsResponse, '共享契约缺 ScanDeviceSettingsResponse')
    for (const key of SPEC_RESPONSE_KEYS) assert.match(settingsResponse, new RegExp(`\\b${key}:`), `ScanDeviceSettingsResponse 缺 ${key}`)
    assert.ok(interfaceBody('ScanSwitchToPanelResponse'), '共享契约缺 ScanSwitchToPanelResponse')
    pass('共享契约：创建请求的 startMode / source / colorMode、状态响应七项新字段（全部可选）、三个新类型都在')

    const handler = ScanDeviceController.prototype.deviceSettings
    assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'scan/sessions/:id/device-settings')
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST)
    assert.equal(Reflect.getMetadata('THROTTLER:LIMITdefault', handler), 30, '限额照 switch-to-panel：30 次 / 分钟')
    assert.equal(Reflect.getMetadata('THROTTLER:TTLdefault', handler), 60_000)
    assert.equal(Reflect.getMetadata('THROTTLER:LIMITdefault', ScanDeviceController.prototype.switchToPanel), 30)
    for (const route of [ScanDeviceController.prototype.deviceReport, ScanDeviceController.prototype.switchToPanel, handler]) {
      assert.equal(Reflect.getMetadata(MAINTENANCE_BLOCKED_METADATA, route), undefined, '屏上扫描会话上的动作不挂维护拦截：已开始的会话维护期间也要能继续')
    }
    assert.equal(Reflect.getMetadata(MAINTENANCE_BLOCKED_METADATA, ScanDeviceController), undefined)
    pass('接口 POST /scan/sessions/:id/device-settings：路径与方法、限额 30/分钟、三个动作都不挂维护拦截')

    // ── B. 成功路径 ────────────────────────────────────────────────────────────
    console.log('\n-- B. 成功路径 --')
    {
      const owner = await prisma.endUser.create({ data: { id: `eu_sset_a_${suffix}`, phoneHash: `hash_sset_a_${suffix}`, phoneEnc: 'enc_a' } })
      endUserIds.push(owner.id)
      const s = await erroredSession('ok', { source: 'feeder', colorMode: 'gray', endUserId: owner.id })
      await prisma.scanTask.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() + 60_000) } })
      const before = await rowOf(s.id)
      assert.equal(before.deviceState, 'error')
      assert.equal(before.deviceErrorCode, 'feeder_empty')
      const calledAt = Date.now()

      const result = await change(s, { source: 'flatbed' }, owner.id)
      assert.deepEqual(Object.keys(result).sort(), SPEC_RESPONSE_KEYS, '响应键集合 = 任务包 B2 第 2 项')
      assert.equal(result.scanTaskId, s.id)
      assert.equal(result.startMode, 'device')
      assert.equal(result.source, 'flatbed')
      assert.equal(result.colorMode, 'gray', '没给的颜色保持原值')
      assert.equal(result.deviceState, 'ready')
      assert.equal(result.devicePageCount, 0)
      assert.equal(result.deviceErrorCode, null)
      const after = await rowOf(s.id)
      assert.equal(after.deviceSource, 'flatbed')
      assert.equal(after.deviceColorMode, 'gray')
      assert.equal(after.deviceState, 'ready', 'error → ready 只经这个用户动作')
      assert.equal(after.deviceErrorCode, null, '出错码被清掉')
      assert.equal(after.devicePageCount, 0)
      assert.ok(after.deviceUpdatedAt && after.deviceUpdatedAt.getTime() >= (before.deviceUpdatedAt as Date).getTime(), '写 deviceUpdatedAt')
      assert.ok(after.deviceUpdatedAt.getTime() >= calledAt - 2000)
      assert.ok(after.expiresAt.getTime() >= calledAt + 10 * 60_000 - 2000, `expiresAt 续到至少 now+10 分钟，实际只剩 ${Math.round((after.expiresAt.getTime() - calledAt) / 1000)} 秒`)
      assert.ok(after.expiresAt.getTime() <= (after.hardExpiresAt as Date).getTime(), '续期不超过 hardExpiresAt')
      assert.equal(result.expiresAt, after.expiresAt.toISOString(), '响应里的 expiresAt 与库一致')
      assert.equal(after.id, before.id)
      assert.equal(after.status, 'waiting', '会话仍是 waiting，没有取消或重建')
      assert.equal(after.startMode, 'device')
      assert.equal(after.controlTokenHash, before.controlTokenHash, '控制令牌原样保留')
      assert.equal(after.deliveryAckedAt?.getTime(), before.deliveryAckedAt?.getTime(), 'ACK 原样保留')
      assert.equal(after.endUserId, owner.id)
      assert.equal(after.hardExpiresAt?.getTime(), before.hardExpiresAt?.getTime())
      pass('error(feeder_empty) 后改 flatbed：来源变、ready、错误码清、0 页、续到 ≥ now+10 分钟且 ≤ hardExpiresAt、会话 / 令牌 / ACK / 归属不变')

      // 之后终端程序回报 scanning 被收下（ready → scanning）；回报表不动：回报 error → ready 仍 409
      const scanning = await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
      assert.equal(scanning.deviceState, 'scanning')
      assert.equal(scanning.devicePageCount, 1)
      await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'paper_jam' })
      await expectHttp(() => deviceSvc.report(s.t.id, s.id, { state: 'ready' }), 409, 'SCAN_DEVICE_TRANSITION_INVALID', '回报表不动：终端程序回报 error → ready 仍是 409（error → ready 只经用户改设置）')
      assert.equal((await rowOf(s.id)).deviceState, 'error')
      const again = await change(s, { colorMode: 'color' }, owner.id)
      assert.equal(again.deviceState, 'ready', '再次出错后还能再改')
      pass('改完终端程序回报 scanning 被收下（ready → scanning）；回报 error → ready 仍 409；再次出错后还能再改')
    }

    // ── C. 不吃静默期 ──────────────────────────────────────────────────────────
    console.log('\n-- C. 同一终端在静默期内也能改 --')
    for (const endedStatus of ['cancelled', 'expired'] as const) {
      const s = await erroredSession(`quiet_${endedStatus}`, { source: 'feeder' })
      await quiet.assertTerminalQuietPeriod(s.t.id)
      // 造出静默期：同一终端另有一场会话刚被取消 / 过期（直接插一行已结束的记录，updatedAt = 现在）
      await prisma.scanTask.create({ data: { terminalId: s.t.id, scanType: 'document', status: endedStatus, expiresAt: new Date(Date.now() - 1000) } })
      await expectHttp(() => quiet.assertTerminalQuietPeriod(s.t.id), 409, 'SCAN_TERMINAL_QUIET_PERIOD', `前提：同一终端另一场会话刚${endedStatus === 'cancelled' ? '取消' : '过期'}，终端此刻在静默期内`, true)
      await expectHttp(() => scanSvc.ack(s.id, null, s.token, s.t.id), 409, 'SCAN_TERMINAL_QUIET_PERIOD', '对照：此刻 ACK 被静默期挡住', true)
      await expectHttp(() => deviceSession(s.t.id), 409, 'SCAN_TERMINAL_QUIET_PERIOD', '对照：此刻建会话被静默期挡住', true)

      const result = await change(s, { source: 'flatbed' })
      assert.equal(result.source, 'flatbed')
      assert.equal(result.deviceState, 'ready')
      assert.equal((await rowOf(s.id)).status, 'waiting')

      // 改完能走完 device 投递：scanning → composing → 取租约 → origin=device 投递 → completed
      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
      await deviceSvc.report(s.t.id, s.id, { state: 'composing' })
      const lease = await scanSvc.getScanDeliveryLease(s.t.id)
      assert.equal(lease.scanTaskId, s.id)
      assert.equal(lease.startMode, 'device')
      // B3：device 段多带 maxPages / maxBytes。仍是整对象精确相等。本会话是 document，20 页 / 18 MiB。
      assert.deepEqual(
        lease.device,
        { source: 'flatbed', colorMode: 'gray', maxPages: 20, maxBytes: 18 * 1024 * 1024 },
        '终端程序下一次取租约拿到的是改过的来源，并带上该类型的页数与大小上限',
      )
      await scanSvc.deliverScanFile({
        terminalId: s.t.id, scanTaskId: s.id, deliveryLease: lease.deliveryLease, buffer: uniquePdf(), filename: 'scan.pdf',
        mimeType: 'application/pdf', observedAt: new Date().toISOString(), origin: 'device',
      })
      const done = await scanSvc.getStatus(s.id, null, s.token)
      assert.equal(done.status, 'completed')
      assert.equal(done.devicePageCount, 1)
      assert.ok(done.file, '走完投递，用户拿到文件')
    }
    pass('终端在静默期内（另一场会话刚取消 / 刚过期；对照：ACK、建会话此刻都被挡）改来源照样成功，且改完 scanning → composing → 投递 → completed 走得完')

    // ── D. 只改颜色 / 400 ─────────────────────────────────────────────────────
    console.log('\n-- D. 只改颜色、取值与组合校验 --')
    {
      const t = await makeTerminal('color')
      const created = await deviceSession(t.id, { source: 'flatbed', colorMode: 'gray' })
      const s = { t, id: created.scanTaskId, token: created.controlToken }
      assert.equal((await rowOf(s.id)).deviceState, 'ready')
      const r = await change(s, { colorMode: 'color' })
      assert.equal(r.colorMode, 'color')
      assert.equal(r.source, 'flatbed', '只给颜色：来源保持原值')
      const row = await rowOf(s.id)
      assert.equal(row.deviceColorMode, 'color')
      assert.equal(row.deviceSource, 'flatbed')
      assert.equal(row.deviceState, 'ready')
      assert.ok(row.deviceUpdatedAt, 'ready 时改设置也写 deviceUpdatedAt')
      const both = await change(s, { source: 'feeder', colorMode: 'gray' })
      assert.deepEqual([both.source, both.colorMode], ['feeder', 'gray'], '两个都给：一起改')
      pass('ready 时只改 colorMode：来源保持；两个一起给：一起改；ready 时改设置也写 deviceUpdatedAt')

      const frozen = await rowOf(s.id)
      const bad = (input: Record<string, unknown>) => () => change(s, input)
      await expectHttp(bad({}), 400, SETTINGS_INVALID, '两个都不给')
      await expectHttp(bad({ source: undefined, colorMode: undefined }), 400, SETTINGS_INVALID, '两个都是 undefined')
      await expectHttp(bad({ source: null, colorMode: null }), 400, SETTINGS_INVALID, '两个都是 null（等于没给）')
      await expectHttp(bad({ source: 'tray' }), 400, SETTINGS_INVALID, 'source 取值非法')
      await expectHttp(bad({ colorMode: 'rgb' }), 400, SETTINGS_INVALID, 'colorMode 取值非法')
      await expectHttp(bad({ source: 'flatbed', colorMode: 'rgb' }), 400, SETTINGS_INVALID, '一个合法一个非法：整体 400，不改合法的那个')
      await expectHttp(bad({ source: 1 }), 400, SETTINGS_INVALID, 'source 类型不对')
      await expectHttp(bad({ source: ['flatbed'] }), 400, SETTINGS_INVALID, 'source 是数组')
      await expectHttp(bad({ colorMode: '' }), 400, SETTINGS_INVALID, 'colorMode 是空串')
      await expectHttp(() => deviceSvc.updateDeviceSettings('no_such_task', null, 'wrong-token', {}), 400, SETTINGS_INVALID, '请求体不合法先于任何库访问：不存在的任务 + 空体也是 400，不是 404 / 403')
      const unchanged = await rowOf(s.id)
      assert.equal(unchanged.deviceSource, frozen.deviceSource)
      assert.equal(unchanged.deviceColorMode, frozen.deviceColorMode)
      assert.equal(unchanged.deviceUpdatedAt?.getTime(), frozen.deviceUpdatedAt?.getTime(), '被拒的请求不得写库')
      assert.equal(unchanged.expiresAt.getTime(), frozen.expiresAt.getTime())

      // DTO 层（与全局 ValidationPipe 同一套校验）：取值范围与多余字段
      const dtoErrors = (body: Record<string, unknown>) => validate(plainToInstance(ScanDeviceSettingsDto, body), { whitelist: true, forbidNonWhitelisted: true })
      for (const body of [{ source: 'flatbed' }, { source: 'feeder' }, { colorMode: 'gray' }, { colorMode: 'color' }, { source: 'flatbed', colorMode: 'color' }, {}]) {
        assert.equal((await dtoErrors(body)).length, 0, `DTO 应接受 ${JSON.stringify(body)}（「至少给一个」由 service 判）`)
      }
      for (const body of [{ source: 'x' }, { colorMode: 'x' }, { source: 1 }, { colorMode: true }, { extra: 1 }, { source: 'flatbed', extra: 1 }, { startMode: 'panel' }]) {
        assert.notEqual((await dtoErrors(body)).length, 0, `DTO 应拒绝 ${JSON.stringify(body)}`)
      }
      pass('两个都不给 / 取值非法 / 类型不对一律 400 且库里不变；请求体校验先于库访问；DTO 取值范围与多余字段被拒')
    }

    // ── E. 状态矩阵 ────────────────────────────────────────────────────────────
    console.log('\n-- E. 只在 ready / error 允许 --')
    {
      const t = await makeTerminal('states')
      const created = await deviceSession(t.id, { source: 'feeder', colorMode: 'gray' })
      const s = { t, id: created.scanTaskId, token: created.controlToken }
      let allowed = 0
      let locked = 0
      for (const state of SPEC_STATES) {
        await prisma.scanTask.update({
          where: { id: s.id },
          data: {
            status: 'waiting', startMode: 'device', deviceState: state, devicePageCount: state === 'ready' ? 0 : 2,
            deviceErrorCode: state === 'error' ? 'paper_jam' : null, deviceSource: 'feeder', deviceColorMode: 'gray',
            deviceUpdatedAt: null, expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        })
        const frozen = await rowOf(s.id)
        if (SPEC_SETTABLE_STATES.includes(state)) {
          const r = await change(s, { source: 'flatbed' })
          assert.equal(r.deviceState, 'ready', `${state} 时应允许改设置`)
          const row = await rowOf(s.id)
          assert.equal(row.deviceSource, 'flatbed')
          assert.equal(row.devicePageCount, 0, `${state} → 改设置后页数归 0`)
          assert.equal(row.deviceErrorCode, null)
          allowed += 1
        } else {
          const msg = await expectHttp(() => change(s, { source: 'flatbed' }), 409, SCAN_DEVICE_SETTINGS_LOCKED, `deviceState=${state} 时改设置被拒`, true)
          assert.ok(!msg.includes('工作人员'), `锁定说明不得让用户找现场工作人员（无人值守）：${msg}`)
          const row = await rowOf(s.id)
          assert.equal(row.deviceSource, frozen.deviceSource, `${state}：被拒后来源不得变化`)
          assert.equal(row.deviceState, state)
          assert.equal(row.devicePageCount, 2, `${state}：被拒后已收到的页数不得被清掉`)
          assert.equal(row.deviceUpdatedAt, null, `${state}：被拒后不得写 deviceUpdatedAt`)
          assert.equal(row.expiresAt.getTime(), frozen.expiresAt.getTime(), `${state}：被拒后不得续期`)
          locked += 1
        }
      }
      assert.equal(allowed, 2)
      assert.equal(locked, 5)
      pass(`7 个 deviceState 逐个：ready / error 允许（${allowed} 个）；scanning / page_ready / composing / delivering / aborted 409 ${SCAN_DEVICE_SETTINGS_LOCKED}（${locked} 个），库里一个字不变`)
    }

    // ── F. 不能改的情形 ────────────────────────────────────────────────────────
    console.log('\n-- F. 不能改的情形 --')
    {
      const owner = await prisma.endUser.create({ data: { id: `eu_sset_b_${suffix}`, phoneHash: `hash_sset_b_${suffix}`, phoneEnc: 'enc_b' } })
      const stranger = await prisma.endUser.create({ data: { id: `eu_sset_c_${suffix}`, phoneHash: `hash_sset_c_${suffix}`, phoneEnc: 'enc_c' } })
      endUserIds.push(owner.id, stranger.id)

      // 权限：照 DELETE / switch-to-panel
      const s = await erroredSession('perm', { endUserId: owner.id })
      const forbid = 'SCAN_TASK_FORBIDDEN'
      await expectHttp(() => deviceSvc.updateDeviceSettings(s.id, owner.id, undefined, { source: 'flatbed' }), 403, forbid, '没带控制令牌被拒')
      await expectHttp(() => deviceSvc.updateDeviceSettings(s.id, owner.id, randomBytes(24).toString('hex'), { source: 'flatbed' }), 403, forbid, '控制令牌不对被拒')
      await expectHttp(() => deviceSvc.updateDeviceSettings(s.id, stranger.id, s.token, { source: 'flatbed' }), 403, forbid, '令牌对但调用方是另一个会员被拒')
      await expectHttp(() => deviceSvc.updateDeviceSettings('no_such_task', null, s.token, { source: 'flatbed' }), 404, 'SCAN_TASK_NOT_FOUND', '任务不存在')
      const denied = await rowOf(s.id)
      assert.equal(denied.deviceState, 'error', '被拒的请求不得改库')
      assert.equal(denied.deviceSource, 'feeder')
      const loggedOut = await deviceSvc.updateDeviceSettings(s.id, null, s.token, { source: 'flatbed' })
      assert.equal(loggedOut.source, 'flatbed', '会员登出后（调用方身份为 null）凭令牌仍可改，与 DELETE 一致')
      const guest = await erroredSession('permguest')
      assert.equal((await deviceSvc.updateDeviceSettings(guest.id, stranger.id, guest.token, { source: 'flatbed' })).source, 'flatbed', '游客会话（无所有者）凭令牌即可')
      pass('权限：没令牌 / 令牌错 / 另一个会员 403，任务不存在 404，被拒不改库；会员登出后凭令牌可改；游客会话凭令牌可改')

      // 面板任务、已改用面板
      const tp = await makeTerminal('panel', null)
      const panel = await scanSvc.create({ scanType: 'document', terminalId: tp.id }, null)
      await expectHttp(() => deviceSvc.updateDeviceSettings(panel.scanTaskId, null, panel.controlToken, { source: 'flatbed' }), 409, SCAN_TASK_NOT_DEVICE, '面板任务没有屏上扫描设置可改')
      assert.equal((await rowOf(panel.scanTaskId)).deviceSource, null, '面板任务被拒后 device 列仍为空')
      const sw = await erroredSession('switched')
      await deviceSvc.switchToPanel(sw.id, null, sw.token)
      await expectHttp(() => change(sw, { source: 'flatbed' }), 409, SCAN_TASK_NOT_DEVICE, '已「改用面板扫描」的会话也算不是 device')
      assert.equal((await rowOf(sw.id)).startMode, 'panel')

      // 已投递
      const dl = await erroredSession('delivered')
      await prisma.scanTask.update({ where: { id: dl.id }, data: { status: 'matched', deviceState: 'delivering', devicePageCount: 2 } })
      await expectHttp(() => change(dl, { source: 'flatbed' }), 409, SCAN_DEVICE_ALREADY_DELIVERED, '投递中（matched）')
      await prisma.scanTask.update({ where: { id: dl.id }, data: { status: 'completed', fileId: 'file_x' } })
      await expectHttp(() => change(dl, { source: 'flatbed' }), 409, SCAN_DEVICE_ALREADY_DELIVERED, '已投递（completed 且有 fileId）')
      await prisma.scanTask.update({ where: { id: dl.id }, data: { status: 'waiting', fileId: 'file_y', deviceState: 'error' } })
      await expectHttp(() => change(dl, { source: 'flatbed' }), 409, SCAN_DEVICE_ALREADY_DELIVERED, '仍 waiting 但已有 fileId 同样算已投递')
      assert.equal((await rowOf(dl.id)).deviceSource, 'feeder')

      // 已取消 / 过期 / 结束
      const cancelled = await erroredSession('cancelled')
      await scanSvc.cancel(cancelled.id, null, cancelled.token)
      await expectHttp(() => change(cancelled, { source: 'flatbed' }), 409, SCAN_TASK_NOT_ACTIVE, '已取消')
      const expired = await erroredSession('expired')
      await prisma.scanTask.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
      await expectHttp(() => change(expired, { source: 'flatbed' }), 409, SCAN_TASK_NOT_ACTIVE, '已过期（截止时间已到）')
      await prisma.scanTask.update({ where: { id: expired.id }, data: { status: 'expired', expiresAt: new Date(Date.now() + 60_000) } })
      await expectHttp(() => change(expired, { source: 'flatbed' }), 409, SCAN_TASK_NOT_ACTIVE, 'status=expired')
      await prisma.scanTask.update({ where: { id: expired.id }, data: { status: 'failed' } })
      await expectHttp(() => change(expired, { source: 'flatbed' }), 409, SCAN_TASK_NOT_ACTIVE, 'status=failed')
      assert.equal((await rowOf(cancelled.id)).deviceSource, 'feeder', '被拒不改库')

      // hardExpiresAt 已到：expiresAt 还没到也不能靠改设置续命
      const hard = await erroredSession('hard')
      const beyond = new Date(Date.now() + 60_000)
      await prisma.scanTask.update({ where: { id: hard.id }, data: { hardExpiresAt: new Date(Date.now() - 1000), expiresAt: beyond } })
      await expectHttp(() => change(hard, { source: 'flatbed' }), 409, SCAN_TASK_NOT_ACTIVE, 'hardExpiresAt 已到不能再改')
      const hardRow = await rowOf(hard.id)
      assert.equal(hardRow.deviceSource, 'feeder')
      assert.equal(hardRow.expiresAt.getTime(), beyond.getTime(), '被拒后不得续期')
      assert.equal(hardRow.deviceState, 'error')

      // scan_device 被关
      const cap = await erroredSession('cap')
      await capabilities.upsert(cap.t.id, 'scan_device', 'maintenance', '换扫描仪', 'verify-scan-device-settings')
      await expectHttp(() => change(cap, { source: 'flatbed' }), 409, SCAN_DEVICE_CAPABILITY_DISABLED, 'scan_device 被关（维护中）')
      await capabilities.clear(cap.t.id, 'scan_device')
      await expectHttp(() => change(cap, { source: 'flatbed' }), 409, SCAN_DEVICE_CAPABILITY_DISABLED, 'scan_device 被清掉（未登记 = 拒绝）')
      assert.equal((await rowOf(cap.id)).deviceState, 'error', '能力被关时库里不变')
      await capabilities.upsert(cap.t.id, 'scan_device', 'available', undefined, 'verify-scan-device-settings')
      assert.equal((await change(cap, { source: 'flatbed' })).deviceState, 'ready', '重新开通后恢复')
      pass('不能改的情形：面板任务、已改用面板、投递中 / 已投递、已取消 / 过期 / 结束、hardExpiresAt 已到、scan_device 被关——全部 409 带原因码且库里不变')
    }

    // ── G. 续期边界 ────────────────────────────────────────────────────────────
    console.log('\n-- G. 续期边界 --')
    {
      // 只剩 30 秒：续到约 now + 10 分钟
      const a = await erroredSession('renew1')
      const t0 = Date.now()
      await prisma.scanTask.update({ where: { id: a.id }, data: { expiresAt: new Date(t0 + 30_000) } })
      const ra = await change(a, { source: 'flatbed' })
      const rowA = await rowOf(a.id)
      assert.ok(Math.abs(rowA.expiresAt.getTime() - (t0 + 10 * 60_000)) < 10_000, `只剩 30 秒时应续到约 10 分钟，实际差 ${rowA.expiresAt.getTime() - t0 - 600_000}ms`)
      assert.ok(rowA.expiresAt.getTime() <= (rowA.hardExpiresAt as Date).getTime())
      assert.equal(ra.expiresAt, rowA.expiresAt.toISOString())

      // 已经比 now + 10 分钟更长：不缩短
      const b = await erroredSession('renew2')
      const longer = new Date(Date.now() + 20 * 60_000)
      await prisma.scanTask.update({ where: { id: b.id }, data: { expiresAt: longer } })
      await change(b, { source: 'flatbed' })
      assert.equal((await rowOf(b.id)).expiresAt.getTime(), longer.getTime(), '已超过 now+10 分钟的截止时间不被缩短')

      // 封顶：hardExpiresAt 只剩 4 分钟 → 续到 hardExpiresAt，不能越过
      const c = await erroredSession('renew3')
      const hardAt = new Date(Date.now() + 4 * 60_000)
      await prisma.scanTask.update({ where: { id: c.id }, data: { hardExpiresAt: hardAt, expiresAt: new Date(Date.now() + 60_000) } })
      const rc = await change(c, { source: 'flatbed' })
      assert.equal((await rowOf(c.id)).expiresAt.getTime(), hardAt.getTime(), '续期必须封顶在 hardExpiresAt（不能越过 30 分钟上限）')
      assert.equal(rc.expiresAt, hardAt.toISOString())
      pass('续期：只剩 30 秒续到约 10 分钟；已更长不缩短；封顶 hardExpiresAt')
    }

    // ── H. 幂等 ────────────────────────────────────────────────────────────────
    console.log('\n-- H. 幂等 --')
    {
      const s = await erroredSession('idem', { source: 'feeder', colorMode: 'gray' })
      const first = await change(s, { source: 'flatbed' })
      const rowFirst = await rowOf(s.id)
      assert.equal(rowFirst.deviceState, 'ready')
      for (const input of [{ source: 'flatbed' }, { colorMode: 'gray' }, { source: 'flatbed', colorMode: 'gray' }]) {
        const again = await change(s, input)
        assert.deepEqual(again, first, `同值再调一次（${JSON.stringify(input)}）原样返回`)
        const row = await rowOf(s.id)
        assert.equal(row.deviceUpdatedAt?.getTime(), rowFirst.deviceUpdatedAt?.getTime(), `${JSON.stringify(input)}：同值重复调用不再写库`)
        assert.equal(row.expiresAt.getTime(), rowFirst.expiresAt.getTime(), `${JSON.stringify(input)}：同值重复调用不再续期`)
        assert.equal(again.expiresAt, rowFirst.expiresAt.toISOString(), '返回的 expiresAt 就是第一次续出来的')
      }
      // 同值但在 error 状态：不是幂等命中，要写（回到 ready、清错）
      await deviceSvc.report(s.t.id, s.id, { state: 'error', errorCode: 'cover_open' })
      const cleared = await change(s, { source: 'flatbed', colorMode: 'gray' })
      assert.equal(cleared.deviceState, 'ready')
      const rowCleared = await rowOf(s.id)
      assert.equal(rowCleared.deviceErrorCode, null, '同值但在 error 状态：仍会清掉出错码')
      assert.ok((rowCleared.deviceUpdatedAt as Date).getTime() >= (rowFirst.deviceUpdatedAt as Date).getTime())
      pass('同值第二次不写库、不续期（deviceUpdatedAt 与 expiresAt 不变，原样返回）；同值但在 error 状态仍会写回 ready 清错')
    }

    // ── I. 并发 ────────────────────────────────────────────────────────────────
    console.log('\n-- I. 并发（条件更新）--')
    {
      // 在服务读到行之后、写之前插入一次别人的改动，来模拟并发
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

      // I1. 读完之后终端程序刚好回报 scanning：CAS 对不上 → 重读 → 409 SETTINGS_LOCKED，且不覆盖终端程序刚写的
      const s1 = await erroredSession('race1')
      const r1 = racing(async (read, id) => {
        if (read === 1) await prisma.scanTask.update({ where: { id }, data: { deviceState: 'scanning', devicePageCount: 1, deviceErrorCode: null } })
      })
      await expectHttp(() => r1.svc.updateDeviceSettings(s1.id, null, s1.token, { source: 'flatbed' }), 409, SCAN_DEVICE_SETTINGS_LOCKED, '读与写之间终端程序回报了 scanning：重读后 409 SETTINGS_LOCKED')
      const row1 = await rowOf(s1.id)
      assert.equal(row1.deviceState, 'scanning')
      assert.equal(row1.devicePageCount, 1, '没有把终端程序刚收到的页数清掉')
      assert.equal(row1.deviceSource, 'feeder', '没有覆盖来源')
      assert.equal(r1.reads(), 2, '冲突后重读了一次')

      // I2. 读完之后另一项被别人改了（颜色 gray → color）：重读重判；最终响应与库一致，没把别人刚改的颜色写回旧值
      const s2 = await erroredSession('race2', { colorMode: 'gray' })
      const r2 = racing(async (read, id) => {
        if (read === 1) await prisma.scanTask.update({ where: { id }, data: { deviceColorMode: 'color' } })
      })
      const res2 = await r2.svc.updateDeviceSettings(s2.id, null, s2.token, { source: 'flatbed' })
      const row2 = await rowOf(s2.id)
      assert.equal(row2.deviceSource, 'flatbed')
      assert.equal(row2.deviceColorMode, 'color', '别人刚改的颜色不得被旧值覆盖')
      assert.equal(res2.colorMode, 'color', '响应与库一致')
      assert.equal(r2.reads(), 2)

      // I3. 一直对不上：3 轮后 409 STATE_CHANGED，库里一个字不被本次请求改
      const s3 = await erroredSession('race3', { colorMode: 'gray' })
      const r3 = racing(async (read, id) => {
        await prisma.scanTask.update({ where: { id }, data: { deviceColorMode: read % 2 === 1 ? 'color' : 'gray' } })
      })
      const before3 = await rowOf(s3.id)
      await expectHttp(() => r3.svc.updateDeviceSettings(s3.id, null, s3.token, { source: 'flatbed' }), 409, SCAN_DEVICE_STATE_CHANGED, '一直对不上：重读最多 3 轮后如实 409 STATE_CHANGED')
      assert.equal(r3.reads(), 3, '最多重读 3 轮')
      const after3 = await rowOf(s3.id)
      assert.equal(after3.deviceSource, 'feeder', '3 轮都没写成：来源不变')
      assert.equal(after3.deviceState, 'error')
      assert.equal(after3.deviceUpdatedAt?.getTime(), before3.deviceUpdatedAt?.getTime())
      pass('并发：读写之间终端程序回报 scanning → 重读后 409 且不清页数；另一项被改 → 重读后不覆盖；一直对不上 → 3 轮后 409 STATE_CHANGED')
    }

    // ── J. GET 会话多返回三项 ──────────────────────────────────────────────────
    console.log('\n-- J. GET /scan/sessions/:id --')
    {
      const t = await makeTerminal('get')
      const created = await deviceSession(t.id, { source: 'feeder', colorMode: 'color' })
      const s = { t, id: created.scanTaskId, token: created.controlToken }
      const fresh = await scanSvc.getStatus(s.id, null, s.token)
      assert.equal(fresh.startMode, 'device')
      assert.equal(fresh.deviceSource, 'feeder')
      assert.equal(fresh.deviceColorMode, 'color')
      assert.equal(fresh.deviceUpdatedAt, null, '终端程序还没回报、用户还没改：deviceUpdatedAt 为 null')
      await deviceSvc.report(t.id, s.id, { state: 'error', errorCode: 'feeder_empty' })
      const errored = await scanSvc.getStatus(s.id, null, s.token)
      assert.equal(errored.deviceState, 'error')
      assert.equal(errored.deviceErrorCode, 'feeder_empty')
      assert.equal(typeof errored.deviceUpdatedAt, 'string')
      assert.equal(errored.deviceUpdatedAt, (await rowOf(s.id)).deviceUpdatedAt?.toISOString())
      await change(s, { source: 'flatbed', colorMode: 'gray' })
      const changed = await scanSvc.getStatus(s.id, null, s.token)
      assert.equal(changed.deviceSource, 'flatbed', '改设置之后读到新来源')
      assert.equal(changed.deviceColorMode, 'gray', '改设置之后读到新颜色')
      assert.equal(changed.deviceState, 'ready')
      assert.equal(changed.deviceErrorCode, null)
      assert.equal(changed.devicePageCount, 0)
      assert.equal(changed.deviceUpdatedAt, (await rowOf(s.id)).deviceUpdatedAt?.toISOString())
      assert.equal(changed.status, 'waiting')

      const tp = await makeTerminal('getpanel', null)
      const panel = await scanSvc.create({ scanType: 'document', terminalId: tp.id }, null)
      const panelStatus = await scanSvc.getStatus(panel.scanTaskId, null, panel.controlToken)
      assert.deepEqual(
        [panelStatus.startMode, panelStatus.deviceSource, panelStatus.deviceColorMode, panelStatus.deviceUpdatedAt, panelStatus.deviceState, panelStatus.deviceErrorCode, panelStatus.devicePageCount],
        ['panel', null, null, null, null, null, 0],
        '面板任务：deviceSource / deviceColorMode / deviceUpdatedAt 都是 null',
      )
      const sw = await erroredSession('getswitched')
      await deviceSvc.switchToPanel(sw.id, null, sw.token)
      assert.ok((await rowOf(sw.id)).deviceUpdatedAt, '前提：库里还留着 device 时期的 deviceUpdatedAt')
      const swStatus = await scanSvc.getStatus(sw.id, null, sw.token)
      assert.deepEqual(
        [swStatus.startMode, swStatus.deviceSource, swStatus.deviceColorMode, swStatus.deviceUpdatedAt],
        ['panel', null, null, null],
        '已改用面板的会话按面板任务给：哪怕库里还留着 device 时期的列值',
      )
      pass('GET 返回 deviceSource / deviceColorMode / deviceUpdatedAt：device 任务有值（改设置后是新值），面板任务与已改用面板的任务全是 null')
    }

    // ── K. HTTP 真路由 ─────────────────────────────────────────────────────────
    console.log('\n-- K. HTTP 真路由 --')
    {
      const fakeTerminals = {
        assertAgentAuthorized: async (terminalId: string, authHeader: string | undefined) => {
          if (!authHeader || authHeader !== `Bearer ${tokens.get(terminalId)}`) {
            throw new UnauthorizedException({ error: { code: 'TERMINAL_TOKEN_INVALID', message: '终端令牌无效' } })
          }
        },
      }
      @Module({
        controllers: [ScanTasksController, ScanDeviceController],
        providers: [
          { provide: ScanTasksService, useValue: scanSvc },
          { provide: ScanDeviceSessionsService, useValue: deviceSvc },
          { provide: TerminalsService, useValue: fakeTerminals },
          // create / ack 路由上挂着 TerminalIdentityGuard，Nest 注册路由时要能解析它的依赖；本组用例不走这两条路由。
          { provide: TerminalSessionService, useValue: {} },
          { provide: JwtService, useValue: {} },
          { provide: RedisService, useValue: {} },
          // 控制器只在请求带会员 token 时才用到 prisma；本组用例不带，给个空桩即可。
          // 不能把真 prisma 交给 Nest：app.close() 会替它调 onModuleDestroy 断开连接，后面的清理就落空了。
          { provide: PrismaService, useValue: {} },
        ],
      })
      class ProbeModule {}
      app = await NestFactory.create(ProbeModule, { logger: ['error'], abortOnError: false })
      app.setGlobalPrefix('api/v1')
      // 与 main.ts 同一组选项：白名单 + 禁止多余字段 + 转换
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
      await app.listen(0, '127.0.0.1')
      const address = app.getHttpServer().address()
      assert.ok(address && typeof address !== 'string')
      const base = `http://127.0.0.1:${address.port}/api/v1`
      type Json = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string } }
      const call = async (path: string, init: RequestInit) => {
        const res = await fetch(`${base}${path}`, init)
        return { status: res.status, json: (await res.json()) as Json }
      }
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

      const s = await erroredSession('http')
      const path = `/scan/sessions/${s.id}/device-settings`
      const control = { 'x-scan-session-control': s.token }

      assert.equal((await post(path, { source: 'flatbed' })).status, 403, '不带控制令牌 403')
      assert.equal((await post(path, { source: 'flatbed' }, { 'x-scan-session-control': 'wrong' })).status, 403, '令牌不对 403')
      for (const body of [{}, { source: 'tray' }, { colorMode: 'rgb' }, { source: 'flatbed', extra: true }, { source: null, colorMode: null }, { source: 'flatbed', colorMode: 7 }]) {
        assert.equal((await post(path, body, control)).status, 400, `HTTP 应 400：${JSON.stringify(body)}`)
      }
      assert.equal((await rowOf(s.id)).deviceState, 'error', '被拒的请求不得改库')
      const ok = await post(path, { source: 'flatbed' }, control)
      assert.equal(ok.status, 200)
      assert.equal(ok.json.success, true)
      assert.deepEqual(Object.keys(ok.json.data ?? {}).sort(), SPEC_RESPONSE_KEYS)
      assert.equal(ok.json.data?.['source'], 'flatbed')
      assert.equal(ok.json.data?.['deviceState'], 'ready')
      const savedAt = (await rowOf(s.id)).deviceUpdatedAt?.getTime()
      assert.equal((await post(path, { source: 'flatbed' }, control)).status, 200, '重复调用幂等 200')
      assert.equal((await rowOf(s.id)).deviceUpdatedAt?.getTime(), savedAt, '重复调用不再写库')

      const got = await call(`/scan/sessions/${s.id}`, { method: 'GET', headers: control })
      assert.equal(got.status, 200)
      assert.equal(got.json.data?.['deviceSource'], 'flatbed')
      assert.equal(got.json.data?.['deviceColorMode'], 'gray')
      assert.equal(got.json.data?.['deviceState'], 'ready')
      assert.equal(typeof got.json.data?.['deviceUpdatedAt'], 'string')

      await deviceSvc.report(s.t.id, s.id, { state: 'scanning', pageCount: 1 })
      const locked = await post(path, { source: 'feeder' }, control)
      assert.equal(locked.status, 409)
      assert.equal(locked.json.error?.code, SCAN_DEVICE_SETTINGS_LOCKED)

      const tp = await makeTerminal('httppanel', null)
      const panel = await scanSvc.create({ scanType: 'document', terminalId: tp.id }, null)
      const notDevice = await post(`/scan/sessions/${panel.scanTaskId}/device-settings`, { source: 'flatbed' }, { 'x-scan-session-control': panel.controlToken })
      assert.equal(notDevice.status, 409)
      assert.equal(notDevice.json.error?.code, SCAN_TASK_NOT_DEVICE)
      const gotPanel = await call(`/scan/sessions/${panel.scanTaskId}`, { method: 'GET', headers: { 'x-scan-session-control': panel.controlToken } })
      assert.equal(gotPanel.json.data?.['deviceSource'], null)
      assert.equal(gotPanel.json.data?.['deviceColorMode'], null)
      assert.equal(gotPanel.json.data?.['deviceUpdatedAt'], null)
      pass('device-settings 真路由：403 / 400（非法取值、多余字段、全 null）/ 200 / 重复 200 / 409 SETTINGS_LOCKED / 409 NOT_DEVICE；GET 多返回三项')
    }

    console.log('\nPASS verify-scan-device-settings')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    if (app) await app.close().catch(() => undefined)
    if (originalStorageDir === undefined) delete process.env['FILE_STORAGE_DIR']
    else process.env['FILE_STORAGE_DIR'] = originalStorageDir
    const tasks = await prisma.scanTask.findMany({ where: { terminalId: { in: terminalIds } }, select: { fileId: true } }).catch(() => [])
    const fileIds = tasks.map((task) => task.fileId).filter((id): id is string => Boolean(id) && id !== 'file_x' && id !== 'file_y')
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } }).catch(() => undefined)
    await prisma.terminalCapability.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: endUserIds } } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    rmSync(storageDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
