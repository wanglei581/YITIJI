/**
 * 屏上扫描（device 路线）云端会话守门（后端第一批 B1，任务包 ③ 屏上扫描 §2）。
 *
 * 覆盖：
 *   A. 契约：scan_device 在共享契约与后端副本里一致、在 DEFAULT_DENY；状态转移表等于下面写死的规格表；后台键名对照
 *   B. 建会话：缺 scan_device（或不是 available）拒 403；scan 本身不可用同样拒；panel 会话不受影响；
 *      字段组合校验（device 缺 source / panel 带 source 都 400）；hardExpiresAt = createdAt + 30 分钟；静默期照旧
 *   C. current-lease / GET：device 任务多带 startMode 与 device 参数，面板任务响应一个键都不多；GET 四项
 *   D. device-report：49 种状态组合逐条（合法收、非法 409）；页数不减；续期不超过 hardExpiresAt；
 *      取消 / 过期 / 已改面板 / 能力被关 / 未 ACK / 别的终端 的各种拒绝与原因码
 *   E. switch-to-panel：原地切换、会话与令牌与 ACK 不变、幂等、权限、不触发静默期；切换后 lease 变面板、watcher 能投
 *   F. deliver 的 origin：错配被拒、没带按 watcher、device 投递要 composing / delivering + 页数 ≥ 1 + PDF
 *   G. 心跳：新字段收下、旧心跳不带也行、不认识的值当 unknown、公开 printer-status 给出
 *   H. HTTP 真路由：全局 ValidationPipe 下的 400、终端令牌守卫、multipart 的 origin 字段不被白名单拦
 *
 * 写库：本脚本在库里造终端 / 会话 / 文件，结束时清理，所以必须在隔离库上跑
 * （VERIFICATION_DATABASE_TARGET=isolated，库名带 ci/dev/test/verify）。
 * SQLite 与 PostgreSQL 两个 CI 作业各跑一遍。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:scan-device-sessions
 */
import 'reflect-metadata'
// 要验「改用面板扫描不吃静默期」，必须用生产默认的 90 秒静默期（verify-scan-tasks 为了老用例把它关成 0，这里不能）。
delete process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS']
// 本门禁不验证招聘托管内容；按生产配置（托管关闭）显式声明，免得被运行环境里的同名变量悄悄带偏
// （verify-recruitment-hosting-gate-declares 要求引用了终端管理服务的门禁显式赋值）。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-device-secret-0123456789-abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-device-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-device-action-secret-0123456789'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Module,
  RequestMethod,
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AuditService } from '../src/audit/audit.service'
import { RedisService } from '../src/common/redis/redis.service'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { ScanDeviceController } from '../src/scan-tasks/scan-device.controller'
import {
  SCAN_DEVICE_ERROR_CODES,
  SCAN_DEVICE_HARD_LIFETIME_MS,
  SCAN_DEVICE_MAX_PAGE_COUNT,
  SCAN_DEVICE_RENEW_WINDOW_MS,
  SCAN_DEVICE_STATES,
  SCAN_DEVICE_STATE_TRANSITIONS,
  renewScanDeviceExpiry,
  type ScanDeviceState,
} from '../src/scan-tasks/scan-device-protocol'
import { ScanDeviceSessionsService } from '../src/scan-tasks/scan-device-sessions.service'
import { ScanDeviceReportDto } from '../src/scan-tasks/dto/scan-device-report.dto'
import { CreateScanTaskDto } from '../src/scan-tasks/dto/create-scan-task.dto'
import { ScanTasksController } from '../src/scan-tasks/scan-tasks.controller'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { HeartbeatDto } from '../src/terminals/dto/heartbeat.dto'
import { publicScanDeviceHealth } from '../src/terminals/printer-status'
import {
  TerminalCapabilitiesService,
  setPrintScanCapabilityModeForTest,
} from '../src/terminals/terminal-capabilities.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import * as apiContract from '../src/terminals/terminal-capabilities.types'
import * as sharedContract from '../../../packages/shared/src/types/printScanCapability'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

// ── 规格表（照任务包 §2.1 / §2.3 写死，不从被测代码里取）──────────────────────────
const SPEC_STATES = ['ready', 'scanning', 'page_ready', 'composing', 'delivering', 'error', 'aborted'] as const
const SPEC_ERROR_CODES = [
  'feeder_empty', 'paper_jam', 'cover_open', 'busy', 'warming_up', 'not_ready', 'timeout', 'too_large', 'unknown',
] as const
/** 状态转移规格：from → 允许的 to。其余 49 - 25 = 24 个组合必须 409。 */
const SPEC_TRANSITIONS: Record<ScanDeviceState, readonly ScanDeviceState[]> = {
  ready: ['ready', 'scanning', 'error', 'aborted'],
  scanning: ['scanning', 'page_ready', 'composing', 'error', 'aborted'],
  page_ready: ['page_ready', 'scanning', 'composing', 'error', 'aborted'],
  composing: ['composing', 'delivering', 'error', 'aborted'],
  delivering: ['delivering', 'error', 'aborted'],
  error: ['error', 'scanning', 'aborted'],
  aborted: ['aborted'],
}

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
  const storageDir = mkdtempSync(join(tmpdir(), 'verify-scan-device-storage-'))
  const originalStorageDir = process.env['FILE_STORAGE_DIR']
  process.env['FILE_STORAGE_DIR'] = storageDir

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const files = new FilesService(prisma, new AuditService(prisma), new StorageService())
  const scanSvc = new ScanTasksService(prisma, files, capabilities)
  const deviceSvc = new ScanDeviceSessionsService(prisma, capabilities)

  const terminalIds: string[] = []
  const tokens = new Map<string, string>()
  const endUserIds: string[] = []
  let app: INestApplication | undefined

  async function makeTerminal(tag: string, scanDevice: 'available' | 'maintenance' | 'testing' | 'not_verified' | 'unsupported' | null = 'available') {
    const id = `t_sdev_${tag}_${suffix}`
    const token = `sdev-token-${randomBytes(12).toString('hex')}`
    await prisma.terminal.create({
      data: { id, terminalCode: `SDEV-${tag}-${suffix}`.toUpperCase(), agentToken: token, deviceFingerprint: `verify-scan-device-${suffix}`, enabled: true },
    })
    terminalIds.push(id)
    tokens.set(id, token)
    if (scanDevice) await capabilities.upsert(id, 'scan_device', scanDevice, undefined, 'verify-scan-device')
    return { id, token }
  }
  const rowOf = (id: string) => prisma.scanTask.findUniqueOrThrow({ where: { id } })

  async function deviceSession(terminalId: string, opts: { source?: 'flatbed' | 'feeder'; colorMode?: 'gray' | 'color'; endUserId?: string | null; ack?: boolean } = {}) {
    const created = await scanSvc.create(
      { scanType: 'document', terminalId, startMode: 'device', source: opts.source ?? 'feeder', colorMode: opts.colorMode ?? 'gray' },
      opts.endUserId ?? null,
    )
    if (opts.ack !== false) await scanSvc.ack(created.scanTaskId, opts.endUserId ?? null, created.controlToken, terminalId)
    return created
  }
  async function panelSession(terminalId: string, ack = true) {
    const created = await scanSvc.create({ scanType: 'document', terminalId }, null)
    if (ack) await scanSvc.ack(created.scanTaskId, null, created.controlToken, terminalId)
    return created
  }

  try {
    // ── A. 契约 ────────────────────────────────────────────────────────────────
    console.log('\n-- A. 契约与静态 --')
    assert.deepEqual([...SCAN_DEVICE_STATES], [...SPEC_STATES], 'deviceState 取值必须等于任务包 §2.1')
    assert.deepEqual([...SCAN_DEVICE_ERROR_CODES], [...SPEC_ERROR_CODES], 'deviceErrorCode 取值必须等于任务包 §2.1')
    pass('deviceState 7 个取值、deviceErrorCode 9 个取值与任务包 §2.1 一致')
    assert.deepEqual(SCAN_DEVICE_STATE_TRANSITIONS, SPEC_TRANSITIONS, '状态转移表必须等于规格表（改表要同时改本门禁的规格并说明理由）')
    const legalCount = Object.values(SPEC_TRANSITIONS).reduce((n, to) => n + to.length, 0)
    assert.equal(legalCount, 25, '规格表合法组合应为 25 个')
    pass('状态转移表与规格表逐项一致（49 个组合：25 合法、24 非法）')
    assert.equal(SCAN_DEVICE_HARD_LIFETIME_MS, 30 * 60 * 1000, '续期上限 = createdAt + 30 分钟')
    assert.equal(SCAN_DEVICE_RENEW_WINDOW_MS, 3 * 60 * 1000, '每次回报续到 now + 3 分钟')
    pass('续期上限 30 分钟、续期窗口 3 分钟')

    for (const [label, contract] of [['api 副本', apiContract], ['shared', sharedContract]] as const) {
      assert.ok((contract.PRINT_SCAN_CAPABILITY_KEYS as readonly string[]).includes('scan_device'), `${label}能力键表缺 scan_device`)
      assert.ok((contract.DEFAULT_DENY_CAPABILITY_KEYS as readonly string[]).includes('scan_device'), `${label}的 DEFAULT_DENY 缺 scan_device（未登记必须 = 拒绝）`)
      assert.ok(contract.CAPABILITY_DENIAL_REASON['scan_device'], `${label}缺 scan_device 的拒绝理由`)
    }
    assert.deepEqual(apiContract.PRINT_SCAN_CAPABILITY_KEYS, sharedContract.PRINT_SCAN_CAPABILITY_KEYS)
    assert.deepEqual(apiContract.DEFAULT_DENY_CAPABILITY_KEYS, sharedContract.DEFAULT_DENY_CAPABILITY_KEYS)
    assert.deepEqual(apiContract.CAPABILITY_DENIAL_REASON, sharedContract.CAPABILITY_DENIAL_REASON)
    const reason = String(apiContract.CAPABILITY_DENIAL_REASON['scan_device'])
    assert.ok(reason.includes('验证') && !reason.includes('不支持'), '拒绝理由要说「尚未通过真机验证」，不能说「不支持」')
    pass('scan_device 在 shared 与后端副本一致、在 DEFAULT_DENY、拒绝理由说的是「未验证」')

    const repoRoot = join(__dirname, '../../..')
    const adminService = readFileSync(join(repoRoot, 'apps/admin/src/services/api/printScan.ts'), 'utf8')
    const adminCenter = readFileSync(join(repoRoot, 'apps/admin/src/routes/print-scan/CapabilityCenter.tsx'), 'utf8')
    assert.ok(adminService.includes("'scan_device'"), 'Admin 能力键第三副本缺 scan_device')
    assert.match(adminCenter, /scan_device:\s*'屏上扫描/, 'Admin 能力配置页缺「屏上扫描」键名对照')
    pass('后台：能力键第三副本含 scan_device，设备能力页有「屏上扫描」键名对照')

    const controllerSource = readFileSync(join(__dirname, '../src/scan-tasks/scan-device.controller.ts'), 'utf8')
    assert.doesNotMatch(controllerSource.replace(/\/\*[\s\S]*?\*\//g, ''), /@MaintenanceBlocked\(/, '新接口不得挂维护拦截：已开始的会话维护期间也要能回报、能切面板')
    const report = ScanDeviceController.prototype.deviceReport
    assert.equal(Reflect.getMetadata(PATH_METADATA, report), 'terminals/:terminalId/scan-tasks/:taskId/device-report')
    assert.equal(Reflect.getMetadata(METHOD_METADATA, report), RequestMethod.POST)
    const switcher = ScanDeviceController.prototype.switchToPanel
    assert.equal(Reflect.getMetadata(PATH_METADATA, switcher), 'scan/sessions/:id/switch-to-panel')
    assert.equal(Reflect.getMetadata(METHOD_METADATA, switcher), RequestMethod.POST)
    assert.match(controllerSource, /assertAgentAuthorized\([^)]*\)[\s\S]*this\.device\.report\(/, 'device-report 必须先验终端令牌再进 service')
    const moduleSource = readFileSync(join(__dirname, '../src/scan-tasks/scan-tasks.module.ts'), 'utf8')
    assert.match(moduleSource, /ScanDeviceController/)
    assert.match(moduleSource, /ScanDeviceSessionsService/)
    assert.match(readFileSync(join(__dirname, '../src/scan-tasks/scan-tasks.controller.ts'), 'utf8'), /@Body\('origin'\)/, 'deliver 必须逐字段取 origin')
    pass('两个新接口路径与方法、终端令牌守卫在前、不挂维护拦截、模块已注册，deliver 取 origin 字段')

    // ── B. 建会话 ──────────────────────────────────────────────────────────────
    console.log('\n-- B. 建会话 --')
    {
      const noCap = await makeTerminal('nocap', null)
      const panel = await panelSession(noCap.id)
      const panelRow = await rowOf(panel.scanTaskId)
      assert.equal(panelRow.startMode, 'panel')
      assert.equal(panelRow.deviceState, null)
      assert.equal(panelRow.devicePageCount, 0)
      assert.equal(panelRow.hardExpiresAt, null)
      pass('没有 scan_device 的终端：面板会话照常建，startMode 默认 panel、device 列为空')
      await prisma.scanTask.update({ where: { id: panel.scanTaskId }, data: { status: 'completed' } })

      const msg = await expectHttp(
        () => scanSvc.create({ scanType: 'document', terminalId: noCap.id, startMode: 'device', source: 'feeder', colorMode: 'gray' }, null),
        403, 'SCAN_DEVICE_NOT_VERIFIED_ON_TERMINAL', '缺 scan_device 建 device 会话被拒',
      )
      assert.ok(msg.includes('验证') && !msg.includes('不支持') && !msg.includes('工作人员'), `拒绝说明要讲「未验证」、不说「不支持」、不让用户找现场工作人员：${msg}`)
      assert.equal(await prisma.scanTask.count({ where: { terminalId: noCap.id, startMode: 'device' } }), 0, '被拒时不得留下会话行')

      for (const status of ['maintenance', 'testing', 'not_verified', 'unsupported'] as const) {
        const t = await makeTerminal(`cap_${status}`, status)
        await expectHttp(
          () => scanSvc.create({ scanType: 'document', terminalId: t.id, startMode: 'device', source: 'feeder', colorMode: 'gray' }, null),
          403, 'SCAN_DEVICE_NOT_VERIFIED_ON_TERMINAL', `scan_device=${status} 建 device 会话被拒`,
        )
        const ok = await panelSession(t.id)
        assert.ok(ok.scanTaskId, `scan_device=${status} 不影响面板会话`)
      }
      pass('scan_device 为 maintenance / testing / not_verified / unsupported 都拒 device、面板会话不受影响')

      const scanOff = await makeTerminal('scanoff', 'available')
      await capabilities.upsert(scanOff.id, 'scan', 'maintenance', '扫描仪送修', 'verify-scan-device')
      await expectHttp(
        () => scanSvc.create({ scanType: 'document', terminalId: scanOff.id, startMode: 'device', source: 'feeder', colorMode: 'gray' }, null),
        403, 'CAPABILITY_UNAVAILABLE', 'device 会话要 scan 与 scan_device 都 available：scan 维护中被拒',
      )

      const t = await makeTerminal('create', 'available')
      const created = await deviceSession(t.id, { source: 'flatbed', colorMode: 'color', ack: false })
      const row = await rowOf(created.scanTaskId)
      assert.equal(row.startMode, 'device')
      assert.equal(row.deviceSource, 'flatbed')
      assert.equal(row.deviceColorMode, 'color')
      assert.equal(row.deviceState, 'ready')
      assert.equal(row.devicePageCount, 0)
      assert.equal(row.deviceErrorCode, null)
      assert.equal(row.deviceUpdatedAt, null)
      assert.equal(row.deliveryAckedAt, null, '新会话仍须 Kiosk ACK 之后才能被终端程序取到')
      assert.equal(row.status, 'waiting')
      assert.ok(row.hardExpiresAt, 'device 会话必须有 hardExpiresAt')
      assert.equal(row.hardExpiresAt.getTime() - row.createdAt.getTime(), 30 * 60 * 1000, 'hardExpiresAt = createdAt + 30 分钟，分毫不差')
      assert.ok(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - 10 * 60 * 1000) < 2000, '初始 expiresAt 仍是 10 分钟')
      assert.equal(created.instructions.length > 0, true, '建会话仍下发面板步骤（改用面板时直接用）')
      pass('device 会话落库：startMode / 来源 / 颜色 / ready / 0 页，hardExpiresAt = createdAt + 30 分钟，仍待 ACK')

      // 字段校验：组合错误一律 400
      const bad = (extra: Record<string, unknown>) => () =>
        scanSvc.create({ scanType: 'document', terminalId: t.id, ...extra } as never, null)
      await expectHttp(bad({ startMode: 'device', colorMode: 'gray' }), 400, 'SCAN_START_PARAMS_INVALID', 'device 缺 source')
      await expectHttp(bad({ startMode: 'device', source: 'feeder' }), 400, 'SCAN_START_PARAMS_INVALID', 'device 缺 colorMode')
      await expectHttp(bad({ startMode: 'device' }), 400, 'SCAN_START_PARAMS_INVALID', 'device 两项都缺')
      await expectHttp(bad({ startMode: 'device', source: 'tray', colorMode: 'gray' }), 400, 'SCAN_START_PARAMS_INVALID', 'device source 取值非法')
      await expectHttp(bad({ startMode: 'device', source: 'feeder', colorMode: 'rgb' }), 400, 'SCAN_START_PARAMS_INVALID', 'device colorMode 取值非法')
      await expectHttp(bad({ startMode: 'panel', source: 'feeder' }), 400, 'SCAN_START_PARAMS_INVALID', 'panel 带 source')
      await expectHttp(bad({ startMode: 'panel', colorMode: 'gray' }), 400, 'SCAN_START_PARAMS_INVALID', 'panel 带 colorMode')
      await expectHttp(bad({ source: 'feeder' }), 400, 'SCAN_START_PARAMS_INVALID', '不传 startMode 却带 source（按 panel 处理 → 不许带）')
      await expectHttp(bad({ startMode: 'serial' }), 400, 'SCAN_START_MODE_INVALID', 'startMode 取值非法')
      await expectHttp(
        bad({ startMode: 'device', source: 'feeder', colorMode: 'gray', retryOfScanTaskId: 'prior_1' }),
        400, 'SCAN_DEVICE_RETRY_UNSUPPORTED', 'device 不支持安全重扫授权',
      )
      assert.equal(await prisma.scanTask.count({ where: { terminalId: t.id } }), 1, '被拒的请求不得多出会话行（只有上面那条）')

      // DTO 层（与全局 ValidationPipe 同一套校验）：取值范围、多余字段
      const dtoErrors = async (body: Record<string, unknown>) =>
        validate(plainToInstance(CreateScanTaskDto, { scanType: 'document', terminalId: 't1', ...body }), { whitelist: true, forbidNonWhitelisted: true })
      assert.equal((await dtoErrors({})).length, 0, '不带新字段的旧请求体照旧合法')
      assert.equal((await dtoErrors({ startMode: 'device', source: 'feeder', colorMode: 'gray' })).length, 0)
      for (const body of [{ startMode: 'x' }, { source: 'x' }, { colorMode: 'x' }, { startMode: 1 }, { extra: 1 }]) {
        assert.notEqual((await dtoErrors(body)).length, 0, `DTO 应拒绝 ${JSON.stringify(body)}`)
      }
      pass('字段校验：device 缺 source / colorMode、panel 带 source / colorMode、取值非法、device 带重扫授权都 400；DTO 取值范围与多余字段被拒')

      // 静默期照旧：取消后立刻再建（device 也一样）被挡
      await scanSvc.cancel(created.scanTaskId, null, created.controlToken)
      await expectHttp(() => deviceSession(t.id), 409, 'SCAN_TERMINAL_QUIET_PERIOD', '取消后立刻再建 device 会话仍被静默期挡住（建会话路径的静默期不变）')
      await expectHttp(() => panelSession(t.id), 409, 'SCAN_TERMINAL_QUIET_PERIOD', '面板会话同样')
    }

    // ── C. current-lease 与 GET ────────────────────────────────────────────────
    console.log('\n-- C. current-lease 与 GET --')
    {
      const t = await makeTerminal('lease')
      const created = await deviceSession(t.id, { source: 'feeder', colorMode: 'gray', ack: false })
      await expectHttp(() => scanSvc.getScanDeliveryLease(t.id), 409, 'NO_WAITING_SCAN_TASK', 'device 任务未 ACK 前取不到租约（与面板一样）')
      await scanSvc.ack(created.scanTaskId, null, created.controlToken, t.id)
      const lease = await scanSvc.getScanDeliveryLease(t.id)
      assert.equal(lease.scanTaskId, created.scanTaskId)
      assert.equal(lease.startMode, 'device')
      assert.deepEqual(lease.device, { source: 'feeder', colorMode: 'gray' })
      assert.ok(lease.deliveryLease)
      assert.deepEqual(Object.keys(lease).sort(), ['deliveryLease', 'device', 'expiresAt', 'notBefore', 'scanTaskId', 'serverNow', 'startMode'])
      pass('device 任务 ACK 后 current-lease 多带 startMode:device 与 device:{source,colorMode}')

      const status = await scanSvc.getStatus(created.scanTaskId, null, created.controlToken)
      assert.equal(status.startMode, 'device')
      assert.equal(status.deviceState, 'ready')
      assert.equal(status.devicePageCount, 0)
      assert.equal(status.deviceErrorCode, null)
      await deviceSvc.report(t.id, created.scanTaskId, { state: 'scanning', pageCount: 2 })
      await deviceSvc.report(t.id, created.scanTaskId, { state: 'error', errorCode: 'paper_jam' })
      const afterError = await scanSvc.getStatus(created.scanTaskId, null, created.controlToken)
      assert.equal(afterError.deviceState, 'error')
      assert.equal(afterError.devicePageCount, 2)
      assert.equal(afterError.deviceErrorCode, 'paper_jam')
      assert.equal(afterError.status, 'waiting', 'device 回报不改 status：status 仍是 waiting')
      pass('GET 返回 startMode / deviceState / devicePageCount / deviceErrorCode，回报后随之变化')

      const panelTerminal = await makeTerminal('panelview', null)
      const panel = await panelSession(panelTerminal.id)
      const panelLease = await scanSvc.getScanDeliveryLease(panelTerminal.id)
      assert.deepEqual(
        Object.keys(panelLease).sort(),
        ['deliveryLease', 'expiresAt', 'notBefore', 'scanTaskId', 'serverNow'],
        '面板任务的 current-lease 响应一个键都不能多（现有终端程序按旧形状解析）',
      )
      const panelStatus = await scanSvc.getStatus(panel.scanTaskId, null, panel.controlToken)
      assert.equal(panelStatus.startMode, 'panel')
      assert.equal(panelStatus.deviceState, null)
      assert.equal(panelStatus.devicePageCount, 0)
      assert.equal(panelStatus.deviceErrorCode, null)
      pass('面板任务：lease 形状不变，GET 给 startMode:panel、其余 null / 0')
    }

    // ── D. device-report ───────────────────────────────────────────────────────
    console.log('\n-- D. device-report --')
    {
      // D1. 49 个状态组合逐条：合法收、非法 409；非法时库里一个字都不许变
      const t = await makeTerminal('pairs')
      const created = await deviceSession(t.id)
      const id = created.scanTaskId
      let accepted = 0
      let rejected = 0
      for (const from of SPEC_STATES) {
        for (const to of SPEC_STATES) {
          const fromPages = from === 'ready' ? 0 : 2
          await prisma.scanTask.update({
            where: { id },
            data: {
              status: 'waiting', startMode: 'device', deviceState: from, devicePageCount: fromPages,
              deviceErrorCode: from === 'error' ? 'paper_jam' : null, deviceUpdatedAt: null,
              expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
          })
          const payload = {
            state: to,
            pageCount: to === 'ready' ? 0 : 2,
            ...(to === 'error' ? { errorCode: 'cover_open' as const } : {}),
          }
          const legal = (SPEC_TRANSITIONS[from] as readonly string[]).includes(to)
          if (legal) {
            const result = await deviceSvc.report(t.id, id, payload)
            assert.equal(result.deviceState, to, `${from} → ${to} 应被收下`)
            const row = await rowOf(id)
            assert.equal(row.deviceState, to)
            assert.equal(row.deviceErrorCode, to === 'error' ? 'cover_open' : null, `${from} → ${to}：errorCode 只随 error 存在`)
            assert.ok(row.deviceUpdatedAt, `${from} → ${to}：收下后要写 deviceUpdatedAt`)
            accepted += 1
          } else {
            await expectHttp(() => deviceSvc.report(t.id, id, payload), 409, 'SCAN_DEVICE_TRANSITION_INVALID', `${from} → ${to} 不在转移表`, true)
            const row = await rowOf(id)
            assert.equal(row.deviceState, from, `${from} → ${to} 被拒后 deviceState 不得变化`)
            assert.equal(row.devicePageCount, fromPages)
            assert.equal(row.deviceUpdatedAt, null, '被拒的回报不得写 deviceUpdatedAt')
            rejected += 1
          }
        }
      }
      assert.equal(accepted, 25)
      assert.equal(rejected, 24)
      pass(`状态转移 49 个组合逐条：${accepted} 个合法被收下、${rejected} 个非法被 409 且库里不变`)
    }
    {
      // D2. 回报内容自相矛盾 → 400（先于转移表，库里不变）
      const t = await makeTerminal('invalid')
      const created = await deviceSession(t.id)
      const id = created.scanTaskId
      await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 2 })
      const invalid = (input: Record<string, unknown>) => () => deviceSvc.report(t.id, id, input as never)
      await expectHttp(invalid({ state: 'error' }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'state=error 不带 errorCode')
      await expectHttp(invalid({ state: 'error', errorCode: 'smoke' }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'errorCode 取值非法')
      await expectHttp(invalid({ state: 'scanning', errorCode: 'paper_jam' }), 400, 'SCAN_DEVICE_REPORT_INVALID', '非 error 状态带 errorCode')
      await expectHttp(invalid({ state: 'scanning', pageCount: -1 }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'pageCount 为负')
      await expectHttp(invalid({ state: 'scanning', pageCount: 1.5 }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'pageCount 不是整数')
      await expectHttp(invalid({ state: 'scanning', pageCount: SCAN_DEVICE_MAX_PAGE_COUNT + 1 }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'pageCount 超过上限')
      await expectHttp(invalid({ state: 'sleeping' }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'state 取值非法')
      await prisma.scanTask.update({ where: { id }, data: { deviceState: 'ready', devicePageCount: 0 } })
      await expectHttp(invalid({ state: 'ready', pageCount: 1 }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'state=ready 带页数（还没收到任何页）')
      await prisma.scanTask.update({ where: { id }, data: { deviceState: 'scanning', devicePageCount: 0 } })
      await expectHttp(invalid({ state: 'composing' }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'composing 一页都没有')
      await expectHttp(invalid({ state: 'page_ready' }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'page_ready 一页都没有')
      await prisma.scanTask.update({ where: { id }, data: { deviceState: 'composing', devicePageCount: 0 } })
      await expectHttp(invalid({ state: 'delivering' }), 400, 'SCAN_DEVICE_REPORT_INVALID', 'delivering 一页都没有')
      const unchanged = await rowOf(id)
      assert.equal(unchanged.deviceState, 'composing')
      assert.equal(unchanged.devicePageCount, 0)

      // 回报 DTO（与全局 ValidationPipe 同一套）：多余字段、取值范围
      const dtoErrors = async (body: Record<string, unknown>) =>
        validate(plainToInstance(ScanDeviceReportDto, body), { whitelist: true, forbidNonWhitelisted: true })
      assert.equal((await dtoErrors({ state: 'scanning', pageCount: 3 })).length, 0)
      assert.equal((await dtoErrors({ state: 'error', errorCode: 'feeder_empty' })).length, 0)
      for (const body of [{}, { state: 'x' }, { state: 'scanning', pageCount: -1 }, { state: 'scanning', pageCount: 1.5 }, { state: 'scanning', pageCount: 201 }, { state: 'error', errorCode: 'x' }, { state: 'scanning', extra: 1 }, { state: 'scanning', pageCount: '3' }]) {
        assert.notEqual((await dtoErrors(body)).length, 0, `回报 DTO 应拒绝 ${JSON.stringify(body)}`)
      }
      pass('回报内容矛盾一律 400 且库里不变；回报 DTO 拒绝非法取值与多余字段')
    }
    {
      // D3. 页数只许不减
      const t = await makeTerminal('pages')
      const created = await deviceSession(t.id)
      const id = created.scanTaskId
      await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 3 })
      await expectHttp(() => deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 2 }), 409, 'SCAN_DEVICE_PAGE_COUNT_DECREASED', 'pageCount 3 → 2 被拒')
      assert.equal((await rowOf(id)).devicePageCount, 3, '被拒后页数仍是 3')
      const same = await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 3 })
      assert.equal(same.devicePageCount, 3)
      const omitted = await deviceSvc.report(t.id, id, { state: 'scanning' })
      assert.equal(omitted.devicePageCount, 3, '缺省 pageCount = 不变')
      const up = await deviceSvc.report(t.id, id, { state: 'page_ready', pageCount: 5 })
      assert.equal(up.devicePageCount, 5)
      await expectHttp(() => deviceSvc.report(t.id, id, { state: 'composing', pageCount: 4 }), 409, 'SCAN_DEVICE_PAGE_COUNT_DECREASED', '换状态时页数也不许减')
      // 同一会话「放好再试」：error → scanning 新一轮，页数从 0 重新数（上一轮的页出错时已被终端程序删除）
      await deviceSvc.report(t.id, id, { state: 'error', errorCode: 'paper_jam' })
      assert.equal((await rowOf(id)).devicePageCount, 5, '出错本身不清页数')
      const retry = await deviceSvc.report(t.id, id, { state: 'scanning' })
      assert.equal(retry.devicePageCount, 0, 'error → scanning：新一轮从 0 页重新数')
      assert.equal((await rowOf(id)).deviceErrorCode, null, '重试后清掉上一轮的 errorCode')
      const first = await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 1 })
      assert.equal(first.devicePageCount, 1)
      await expectHttp(() => deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 0 }), 409, 'SCAN_DEVICE_PAGE_COUNT_DECREASED', '新一轮内同样只许不减')
      pass('devicePageCount 只许不减（同数、缺省、增加可以；减少 409）；仅 error → scanning 才从 0 重数')
    }
    {
      // D4. 续期：min(max(expiresAt, now + 3 分钟), hardExpiresAt)
      const day = new Date('2026-01-01T00:00:00.000Z')
      const hard = new Date(day.getTime() + 30 * 60_000)
      assert.equal(renewScanDeviceExpiry({ expiresAt: new Date(day.getTime() + 10 * 60_000), hardExpiresAt: hard, now: new Date(day.getTime() + 9 * 60_000) }).getTime(), day.getTime() + 12 * 60_000, '9 分钟时回报：续到 12 分钟')
      assert.equal(renewScanDeviceExpiry({ expiresAt: new Date(day.getTime() + 10 * 60_000), hardExpiresAt: hard, now: new Date(day.getTime() + 2 * 60_000) }).getTime(), day.getTime() + 10 * 60_000, '2 分钟时回报：已超过 now+3 分钟，不缩短')
      assert.equal(renewScanDeviceExpiry({ expiresAt: new Date(day.getTime() + 28 * 60_000), hardExpiresAt: hard, now: new Date(day.getTime() + 29 * 60_000) }).getTime(), hard.getTime(), '29 分钟时回报：封顶在 hardExpiresAt')

      const t = await makeTerminal('renew')
      const created = await deviceSession(t.id)
      const id = created.scanTaskId
      const t0 = Date.now()
      await prisma.scanTask.update({ where: { id }, data: { expiresAt: new Date(t0 + 30_000) } })
      const renewed = await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 1 })
      const renewedAt = (await rowOf(id)).expiresAt.getTime()
      assert.ok(Math.abs(renewedAt - (t0 + 3 * 60_000)) < 10_000, `只剩 30 秒时回报，应续到约 now+3 分钟，实际差 ${renewedAt - t0 - 180_000}ms`)
      assert.equal(renewed.expiresAt, new Date(renewedAt).toISOString(), '响应里的 expiresAt 与库一致')
      assert.ok((await rowOf(id)).deviceUpdatedAt, '收下回报要写 deviceUpdatedAt')

      const farFuture = new Date(t0 + 9 * 60_000)
      await prisma.scanTask.update({ where: { id }, data: { expiresAt: farFuture } })
      await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 2 })
      assert.equal((await rowOf(id)).expiresAt.getTime(), farFuture.getTime(), '已超过 now+3 分钟的截止时间不被缩短')

      // 续期不超过 hardExpiresAt
      const hardAt = new Date(t0 + 60_000)
      await prisma.scanTask.update({ where: { id }, data: { hardExpiresAt: hardAt, expiresAt: new Date(t0 + 30_000) } })
      await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 3 })
      assert.equal((await rowOf(id)).expiresAt.getTime(), hardAt.getTime(), '续期必须封顶在 hardExpiresAt，不能越过 30 分钟上限')

      // 已经超过上限的会话不再收回报
      await prisma.scanTask.update({ where: { id }, data: { hardExpiresAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000) } })
      await expectHttp(() => deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 4 }), 409, 'SCAN_DEVICE_TASK_ENDED', '超过 hardExpiresAt 不再收回报')
      pass('续期：只剩 30 秒续到约 3 分钟；已更长不缩短；封顶 hardExpiresAt；超过上限不再收')
    }
    {
      // D5. 拒绝与原因码
      const t = await makeTerminal('reject')
      const other = await makeTerminal('rejectother')
      const created = await deviceSession(t.id)
      const id = created.scanTaskId
      await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 1 })
      await expectHttp(() => deviceSvc.report(other.id, id, { state: 'scanning', pageCount: 2 }), 404, 'SCAN_TASK_NOT_FOUND', '别的终端回报本终端的任务：与不存在同一个答复')
      await expectHttp(() => deviceSvc.report(t.id, 'no_such_task', { state: 'scanning' }), 404, 'SCAN_TASK_NOT_FOUND', '任务不存在')
      assert.equal((await rowOf(id)).devicePageCount, 1, '越权回报不得改库')

      // 能力被关：409 + 原因码，库里不变
      await capabilities.upsert(t.id, 'scan_device', 'maintenance', '换扫描仪', 'verify-scan-device')
      await expectHttp(() => deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 2 }), 409, 'SCAN_DEVICE_CAPABILITY_DISABLED', 'scan_device 被关后回报 409')
      assert.equal((await rowOf(id)).devicePageCount, 1)
      await capabilities.clear(t.id, 'scan_device')
      await expectHttp(() => deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 2 }), 409, 'SCAN_DEVICE_CAPABILITY_DISABLED', 'scan_device 被清掉（未登记）同样 409')
      await capabilities.upsert(t.id, 'scan_device', 'available', undefined, 'verify-scan-device')
      const back = await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 2 })
      assert.equal(back.devicePageCount, 2, '重新开通后回报恢复')

      // 未 ACK
      const t2 = await makeTerminal('rejectack')
      const unacked = await deviceSession(t2.id, { ack: false })
      await expectHttp(() => deviceSvc.report(t2.id, unacked.scanTaskId, { state: 'scanning' }), 409, 'SCAN_DEVICE_TASK_NOT_ACKED', '未 ACK 的会话不收回报')

      // 面板任务
      const t3 = await makeTerminal('rejectpanel', null)
      const panel = await panelSession(t3.id)
      await expectHttp(() => deviceSvc.report(t3.id, panel.scanTaskId, { state: 'scanning' }), 409, 'SCAN_TASK_NOT_DEVICE', '面板任务不收 device 回报')

      // 取消 / 过期 / 完成
      await scanSvc.cancel(id, null, created.controlToken)
      await expectHttp(() => deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 3 }), 409, 'SCAN_DEVICE_TASK_CANCELLED', '已取消的会话回报 409')
      const t4 = await makeTerminal('rejectexp')
      const expiring = await deviceSession(t4.id)
      await prisma.scanTask.update({ where: { id: expiring.scanTaskId }, data: { expiresAt: new Date(Date.now() - 1000) } })
      await expectHttp(() => deviceSvc.report(t4.id, expiring.scanTaskId, { state: 'scanning' }), 409, 'SCAN_DEVICE_TASK_ENDED', '已过期的会话回报 409')
      await prisma.scanTask.update({ where: { id: expiring.scanTaskId }, data: { status: 'expired', expiresAt: new Date(Date.now() + 60_000) } })
      await expectHttp(() => deviceSvc.report(t4.id, expiring.scanTaskId, { state: 'scanning' }), 409, 'SCAN_DEVICE_TASK_ENDED', 'expired 状态的会话回报 409')
      await prisma.scanTask.update({ where: { id: expiring.scanTaskId }, data: { status: 'completed' } })
      await expectHttp(() => deviceSvc.report(t4.id, expiring.scanTaskId, { state: 'scanning' }), 409, 'SCAN_DEVICE_TASK_ENDED', '已完成的会话回报 409')

      // 投递进行中（matched）：同状态重复回报当作重复，原样应答；其余 409
      const t5 = await makeTerminal('rejectmatched')
      const delivering = await deviceSession(t5.id)
      await prisma.scanTask.update({ where: { id: delivering.scanTaskId }, data: { status: 'matched', deviceState: 'delivering', devicePageCount: 2 } })
      const dup = await deviceSvc.report(t5.id, delivering.scanTaskId, { state: 'delivering', pageCount: 2 })
      assert.equal(dup.deviceState, 'delivering')
      await expectHttp(() => deviceSvc.report(t5.id, delivering.scanTaskId, { state: 'error', errorCode: 'unknown' }), 409, 'SCAN_DEVICE_TASK_DELIVERING', '投递进行中不收别的状态')
      assert.equal((await rowOf(delivering.scanTaskId)).deviceState, 'delivering')
      pass('拒绝与原因码：别的终端 404、能力被关 / 清掉 409、未 ACK、面板任务、已取消、已过期、已完成、投递进行中')
    }

    // ── E. switch-to-panel ─────────────────────────────────────────────────────
    console.log('\n-- E. switch-to-panel --')
    {
      const owner = await prisma.endUser.create({ data: { id: `eu_sdev_a_${suffix}`, phoneHash: `hash_sdev_a_${suffix}`, phoneEnc: 'enc_a' } })
      const stranger = await prisma.endUser.create({ data: { id: `eu_sdev_b_${suffix}`, phoneHash: `hash_sdev_b_${suffix}`, phoneEnc: 'enc_b' } })
      endUserIds.push(owner.id, stranger.id)

      const t = await makeTerminal('switch')
      const created = await deviceSession(t.id, { endUserId: owner.id })
      const id = created.scanTaskId
      await deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 2 })
      await deviceSvc.report(t.id, id, { state: 'error', errorCode: 'paper_jam' })
      const before = await rowOf(id)

      // 权限：照 DELETE
      await expectHttp(() => deviceSvc.switchToPanel(id, owner.id, undefined), 403, 'SCAN_TASK_FORBIDDEN', '没带控制令牌被拒')
      await expectHttp(() => deviceSvc.switchToPanel(id, owner.id, randomBytes(24).toString('hex')), 403, 'SCAN_TASK_FORBIDDEN', '控制令牌不对被拒')
      await expectHttp(() => deviceSvc.switchToPanel(id, stranger.id, created.controlToken), 403, 'SCAN_TASK_FORBIDDEN', '令牌对但调用方是另一个会员被拒')
      await expectHttp(() => deviceSvc.switchToPanel('no_such_task', null, created.controlToken), 404, 'SCAN_TASK_NOT_FOUND', '任务不存在')
      assert.equal((await rowOf(id)).startMode, 'device', '被拒的切换不得改库')

      // 成功：会员登出后（调用方身份为 null）凭令牌仍可切，与 DELETE 一致
      const result = await deviceSvc.switchToPanel(id, null, created.controlToken)
      assert.equal(result.scanTaskId, id)
      assert.equal(result.startMode, 'panel')
      assert.ok(result.instructions.length > 0, '切换后直接给面板步骤')
      const after = await rowOf(id)
      assert.equal(after.startMode, 'panel')
      assert.equal(after.deviceState, 'aborted')
      assert.equal(after.deviceErrorCode, null, '切换清掉 deviceErrorCode')
      assert.equal(after.status, 'waiting', '会话仍是 waiting，没有被取消或重建')
      assert.equal(after.id, before.id)
      assert.equal(after.controlTokenHash, before.controlTokenHash, '控制令牌原样保留')
      assert.equal(after.deliveryAckedAt?.getTime(), before.deliveryAckedAt?.getTime(), 'ACK 原样保留')
      assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime())
      assert.equal(after.endUserId, owner.id)
      pass('原地切换：startMode→panel、deviceState→aborted、清 errorCode；会话 / 令牌 / ACK / 归属 / 截止时间原样')

      // 幂等
      const again = await deviceSvc.switchToPanel(id, owner.id, created.controlToken)
      assert.equal(again.startMode, 'panel')
      const afterAgain = await rowOf(id)
      assert.equal(afterAgain.deviceUpdatedAt?.getTime(), after.deviceUpdatedAt?.getTime(), '重复调用不再写库')
      pass('重复调用幂等')

      // 不触发静默期：没有任何取消 / 过期行；ACK 仍可立即重放；对照：取消会触发
      const quiet = (scanSvc as unknown as { assertTerminalQuietPeriod: (terminalId: string) => Promise<void> })
      await quiet.assertTerminalQuietPeriod(t.id)
      assert.equal(await prisma.scanTask.count({ where: { terminalId: t.id, status: { in: ['cancelled', 'expired'] } } }), 0, '切换不得产生 cancelled / expired 行')
      const reack = await scanSvc.ack(id, owner.id, created.controlToken, t.id)
      assert.equal(reack.scanTaskId, id, '切换后紧接着 ACK 不被静默期挡')

      // 切换后：lease 按面板、report 被拒、watcher 投递能成
      const lease = await scanSvc.getScanDeliveryLease(t.id)
      assert.deepEqual(Object.keys(lease).sort(), ['deliveryLease', 'expiresAt', 'notBefore', 'scanTaskId', 'serverNow'], '切换后 lease 是面板形状')
      await expectHttp(() => deviceSvc.report(t.id, id, { state: 'scanning', pageCount: 3 }), 409, 'SCAN_DEVICE_SWITCHED_TO_PANEL', '切换后终端程序回报拿到 409（据此停扫）')
      const status = await scanSvc.getStatus(id, owner.id, created.controlToken)
      assert.equal(status.startMode, 'panel')
      assert.equal(status.deviceState, null)
      assert.equal(status.devicePageCount, 0)
      assert.equal(status.deviceErrorCode, null)
      await expectHttp(
        () => scanSvc.deliverScanFile({ terminalId: t.id, scanTaskId: id, deliveryLease: lease.deliveryLease, buffer: uniquePdf(), filename: 'x.pdf', mimeType: 'application/pdf', observedAt: new Date().toISOString(), origin: 'device' }),
        409, 'SCAN_DELIVER_ORIGIN_MISMATCH', '切换后 origin=device 的投递被拒',
      )
      const delivered = await scanSvc.deliverScanFile({ terminalId: t.id, scanTaskId: id, deliveryLease: lease.deliveryLease, buffer: uniquePdf(), filename: 'panel.pdf', mimeType: 'application/pdf', observedAt: new Date().toISOString() })
      assert.equal(delivered.scanTaskId, id)
      assert.equal((await rowOf(id)).status, 'completed')
      pass('切换后：不触发静默期、紧接着 ACK 可重放、lease 变面板形状、report 拿 409、watcher（不带 origin）投递成功')

      // 对照：取消会触发静默期（这正是单独做 switch-to-panel 的原因）
      const t2 = await makeTerminal('switchquiet')
      const c2 = await deviceSession(t2.id)
      await scanSvc.cancel(c2.scanTaskId, null, c2.controlToken)
      await expectHttp(() => quiet.assertTerminalQuietPeriod(t2.id), 409, 'SCAN_TERMINAL_QUIET_PERIOD', '对照：取消会触发终端静默期')

      // 不能切的情形
      const t3 = await makeTerminal('switchno')
      const c3 = await deviceSession(t3.id)
      await prisma.scanTask.update({ where: { id: c3.scanTaskId }, data: { status: 'matched', deviceState: 'delivering', devicePageCount: 2 } })
      await expectHttp(() => deviceSvc.switchToPanel(c3.scanTaskId, null, c3.controlToken), 409, 'SCAN_DEVICE_ALREADY_DELIVERED', '投递中（matched）不能切')
      await prisma.scanTask.update({ where: { id: c3.scanTaskId }, data: { status: 'completed', fileId: 'file_x' } })
      await expectHttp(() => deviceSvc.switchToPanel(c3.scanTaskId, null, c3.controlToken), 409, 'SCAN_DEVICE_ALREADY_DELIVERED', '已投递文件（completed）不能切')
      assert.equal((await rowOf(c3.scanTaskId)).startMode, 'device')
      const t4 = await makeTerminal('switchcancel')
      const c4 = await deviceSession(t4.id)
      await scanSvc.cancel(c4.scanTaskId, null, c4.controlToken)
      await expectHttp(() => deviceSvc.switchToPanel(c4.scanTaskId, null, c4.controlToken), 409, 'SCAN_TASK_NOT_ACTIVE', '已取消不能切')
      const t5 = await makeTerminal('switchexp')
      const c5 = await deviceSession(t5.id)
      await prisma.scanTask.update({ where: { id: c5.scanTaskId }, data: { expiresAt: new Date(Date.now() - 1000) } })
      await expectHttp(() => deviceSvc.switchToPanel(c5.scanTaskId, null, c5.controlToken), 409, 'SCAN_TASK_NOT_ACTIVE', '已过期不能切')
      const t6 = await makeTerminal('switchpanel', null)
      const c6 = await panelSession(t6.id)
      await expectHttp(() => deviceSvc.switchToPanel(c6.scanTaskId, null, c6.controlToken), 409, 'SCAN_TASK_NOT_DEVICE', '本来就是面板会话：无需切换')
      pass('不能切的情形：投递中 / 已投递 / 已取消 / 已过期 / 本来就是面板会话')

      // 从 ready / scanning / page_ready / composing 都能切（还没投递文件就行）
      for (const from of ['ready', 'scanning', 'page_ready', 'composing'] as const) {
        const tt = await makeTerminal(`switch_${from}`)
        const cc = await deviceSession(tt.id)
        await prisma.scanTask.update({ where: { id: cc.scanTaskId }, data: { deviceState: from, devicePageCount: from === 'ready' ? 0 : 2 } })
        const r = await deviceSvc.switchToPanel(cc.scanTaskId, null, cc.controlToken)
        assert.equal(r.startMode, 'panel')
        assert.equal((await rowOf(cc.scanTaskId)).deviceState, 'aborted')
      }
      pass('ready / scanning / page_ready / composing 状态下都能原地切换')
    }

    // ── F. deliver 的 origin ───────────────────────────────────────────────────
    console.log('\n-- F. deliver 的 origin --')
    {
      const lateral = async (terminalId: string, taskId: string, over: Record<string, unknown> = {}) => {
        const lease = await scanSvc.getScanDeliveryLease(terminalId)
        assert.equal(lease.scanTaskId, taskId)
        return scanSvc.deliverScanFile({
          terminalId, scanTaskId: taskId, deliveryLease: lease.deliveryLease, buffer: uniquePdf(),
          filename: 'scan.pdf', mimeType: 'application/pdf', observedAt: new Date().toISOString(), ...over,
        })
      }

      // 面板会话：没带 origin 照常成功；origin=watcher 也行；origin=device 被拒
      const tp = await makeTerminal('originpanel', null)
      const panel = await panelSession(tp.id)
      await expectHttp(() => lateral(tp.id, panel.scanTaskId, { origin: 'device' }), 409, 'SCAN_DELIVER_ORIGIN_MISMATCH', '面板会话收到 origin=device 被拒')
      await expectHttp(() => lateral(tp.id, panel.scanTaskId, { origin: 'scanner' }), 400, 'SCAN_DELIVER_ORIGIN_INVALID', 'origin 取值非法（面板会话）')
      await expectHttp(() => lateral(tp.id, panel.scanTaskId, { origin: ['watcher', 'watcher'] }), 400, 'SCAN_DELIVER_ORIGIN_INVALID', 'origin 重复出现（数组）非法')
      assert.equal((await rowOf(panel.scanTaskId)).status, 'waiting', '被拒的投递不改会话')
      const okPanel = await lateral(tp.id, panel.scanTaskId)
      assert.equal(okPanel.scanTaskId, panel.scanTaskId)
      assert.equal((await rowOf(panel.scanTaskId)).status, 'completed')
      const tp2 = await makeTerminal('originpanel2', null)
      const panel2 = await panelSession(tp2.id)
      const okWatcher = await lateral(tp2.id, panel2.scanTaskId, { origin: 'watcher' })
      assert.equal(okWatcher.scanTaskId, panel2.scanTaskId)
      pass('面板会话：没带 origin 按 watcher 照常投递；origin=watcher 可以；origin=device 409；非法取值 400')

      // device 会话
      const td = await makeTerminal('origindevice')
      const dev = await deviceSession(td.id, { source: 'flatbed' })
      const setDevice = (data: Record<string, unknown>) => prisma.scanTask.update({ where: { id: dev.scanTaskId }, data })
      await setDevice({ deviceState: 'delivering', devicePageCount: 3 })
      await expectHttp(() => lateral(td.id, dev.scanTaskId), 409, 'SCAN_DELIVER_ORIGIN_MISMATCH', 'device 会话没带 origin（= watcher）被拒')
      await expectHttp(() => lateral(td.id, dev.scanTaskId, { origin: 'watcher' }), 409, 'SCAN_DELIVER_ORIGIN_MISMATCH', 'device 会话收到 origin=watcher 被拒')
      await expectHttp(() => lateral(td.id, dev.scanTaskId, { origin: '' }), 409, 'SCAN_DELIVER_ORIGIN_MISMATCH', '空 origin 按 watcher：device 会话被拒')
      for (const state of ['ready', 'scanning', 'page_ready', 'error', 'aborted'] as const) {
        await setDevice({ deviceState: state, devicePageCount: 3 })
        await expectHttp(() => lateral(td.id, dev.scanTaskId, { origin: 'device' }), 409, 'SCAN_DEVICE_STATE_NOT_DELIVERABLE', `device 投递在 deviceState=${state} 时被拒（只收 composing / delivering）`)
      }
      for (const state of ['composing', 'delivering'] as const) {
        await setDevice({ deviceState: state, devicePageCount: 0 })
        await expectHttp(() => lateral(td.id, dev.scanTaskId, { origin: 'device' }), 409, 'SCAN_DEVICE_STATE_NOT_DELIVERABLE', `device 投递在 ${state} 但 devicePageCount=0 时被拒（至少 1 页）`)
      }
      await setDevice({ deviceState: 'delivering', devicePageCount: 3 })
      await expectHttp(() => lateral(td.id, dev.scanTaskId, { origin: 'device', buffer: Buffer.from('GIF89a not a pdf'), mimeType: 'image/gif' }), 400, 'SCAN_DEVICE_FILE_NOT_PDF', 'device 投递只收 PDF（图片被拒）')
      await expectHttp(() => lateral(td.id, dev.scanTaskId, { origin: 'device', mimeType: 'application/octet-stream' }), 400, 'SCAN_DEVICE_FILE_NOT_PDF', 'device 投递声明的类型不是 PDF 被拒')
      await expectHttp(() => lateral(td.id, dev.scanTaskId, { origin: 'device', buffer: Buffer.from('not a pdf at all') }), 400, 'SCAN_DEVICE_FILE_NOT_PDF', 'device 投递内容不是 PDF 被拒（声明 pdf 也不行）')
      assert.equal((await rowOf(dev.scanTaskId)).status, 'waiting', '被拒的 device 投递不改会话')
      assert.equal((await rowOf(dev.scanTaskId)).fileId, null)

      const okDevice = await lateral(td.id, dev.scanTaskId, { origin: 'device' })
      assert.equal(okDevice.scanTaskId, dev.scanTaskId)
      const done = await rowOf(dev.scanTaskId)
      assert.equal(done.status, 'completed')
      assert.ok(done.fileId)
      const doneStatus = await scanSvc.getStatus(dev.scanTaskId, null, dev.controlToken)
      assert.equal(doneStatus.status, 'completed')
      assert.equal(doneStatus.startMode, 'device')
      assert.equal(doneStatus.devicePageCount, 3)
      assert.ok(doneStatus.file, '屏上扫描完成后用户拿到文件')
      assert.equal(doneStatus.file?.mimeType, 'application/pdf')
      pass('device 会话：没带 / watcher / 空 origin 被拒；状态不是 composing / delivering、一页都没有、不是 PDF 都被拒；origin=device 的 PDF 投递成功并转 completed')

      // composing 同样可投（终端程序可能直接 composing 后投递）
      const tc = await makeTerminal('origincomposing')
      const comp = await deviceSession(tc.id)
      await prisma.scanTask.update({ where: { id: comp.scanTaskId }, data: { deviceState: 'composing', devicePageCount: 1 } })
      const okComp = await lateral(tc.id, comp.scanTaskId, { origin: 'device' })
      assert.equal(okComp.scanTaskId, comp.scanTaskId)
      pass('deviceState=composing 且已有 1 页时同样可以投递')
    }

    // ── G. 心跳 ────────────────────────────────────────────────────────────────
    console.log('\n-- G. 心跳与公开 printer-status --')
    {
      // DTO
      const hbErrors = async (body: Record<string, unknown>) => validate(plainToInstance(HeartbeatDto, body), { whitelist: true, forbidNonWhitelisted: true })
      assert.equal((await hbErrors({ scanDeviceHealth: 'ready', scanDeviceObservedAt: '2026-11-02T10:20:30.123Z' })).length, 0)
      assert.equal((await hbErrors({ status: 'online' })).length, 0, '旧心跳不带这两项照旧合法')
      for (const health of ['ready', 'busy', 'not_found', 'error', 'unknown']) {
        assert.equal((await hbErrors({ scanDeviceHealth: health })).length, 0, `${health} 应合法`)
      }
      for (const body of [{ scanDeviceHealth: 'sleeping' }, { scanDeviceHealth: null }, { scanDeviceObservedAt: 'yesterday' }, { scanDeviceObservedAt: '2'.repeat(65) }, { scanDeviceObservedAt: null }]) {
        assert.notEqual((await hbErrors(body)).length, 0, `心跳 DTO 应拒绝 ${JSON.stringify(body)}`)
      }

      // 入库与公开读（假 Prisma，写法同 verify-scan-input-lockout-telemetry）
      let latest: (Record<string, unknown> & { createdAt: Date }) | undefined
      const terminalId = 'terminal-scan-device-telemetry'
      const fake = {
        terminal: {
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
          findFirst: async () => ({ id: terminalId, terminalCode: 'SCAN-DEVICE-001', heartbeats: latest ? [latest] : [] }),
        },
        terminalHeartbeat: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            latest = { ...data, createdAt: new Date() }
            return latest
          },
        },
      }
      const agent = new TerminalAgentService(fake as never, {} as never, { validateTerminalToken: async () => ({}) } as never)
      const admin = new TerminalAdminService(fake as never, agent, {} as never, { toAdminObservation: () => null } as never)

      const observed = new Date(Date.now() - 60_000)
      await agent.heartbeat(terminalId, plainToInstance(HeartbeatDto, { status: 'online', scanDeviceHealth: 'ready', scanDeviceObservedAt: observed.toISOString() }), 'Bearer redacted')
      assert.equal(latest?.scanDeviceHealth, 'ready')
      assert.deepEqual(latest?.scanDeviceObservedAt, observed)
      const pub = await admin.getTerminalPrinterStatus(terminalId)
      assert.equal(pub.scanDeviceHealth, 'ready')
      assert.equal(pub.scanDeviceObservedAt, observed.toISOString())
      pass('心跳带 scanDeviceHealth / scanDeviceObservedAt：收下入库，公开 printer-status 给出')

      for (const health of ['busy', 'not_found', 'error', 'unknown'] as const) {
        await agent.heartbeat(terminalId, plainToInstance(HeartbeatDto, { scanDeviceHealth: health, scanDeviceObservedAt: observed.toISOString() }), 'Bearer redacted')
        assert.equal((await admin.getTerminalPrinterStatus(terminalId)).scanDeviceHealth, health)
      }
      // 只带其中一项也收（不因遥测不全让整条心跳失败）
      await agent.heartbeat(terminalId, plainToInstance(HeartbeatDto, { scanDeviceHealth: 'busy' }), 'Bearer redacted')
      assert.equal(latest?.scanDeviceHealth, 'busy')
      assert.equal(latest?.scanDeviceObservedAt, null)

      // 晚于收到时刻的探测时间按收到时刻记；不带时区的拒收
      const before = Date.now()
      await agent.heartbeat(terminalId, plainToInstance(HeartbeatDto, { scanDeviceHealth: 'ready', scanDeviceObservedAt: new Date(Date.now() + 3600_000).toISOString() }), 'Bearer redacted')
      const clamped = (latest?.scanDeviceObservedAt as Date).getTime()
      assert.ok(clamped >= before && clamped <= Date.now(), '未来的探测时间不得原样入库')
      await assert.rejects(
        agent.heartbeat(terminalId, plainToInstance(HeartbeatDto, { scanDeviceHealth: 'ready', scanDeviceObservedAt: '2026-11-02T10:20:30' }), 'Bearer redacted'),
        /./,
        '不带时区的探测时间必须拒收',
      )

      // 旧心跳不带：照收、库里 null、公开给 null（不是 ready）
      await agent.heartbeat(terminalId, plainToInstance(HeartbeatDto, { status: 'online' }), 'Bearer redacted')
      assert.equal(latest?.scanDeviceHealth, null)
      assert.equal(latest?.scanDeviceObservedAt, null)
      const oldPub = await admin.getTerminalPrinterStatus(terminalId)
      assert.equal(oldPub.scanDeviceHealth, null, '老终端程序不报：公开接口给 null，一体机读作「读不到」而不是 ready')
      assert.equal(oldPub.scanDeviceObservedAt, null)

      // 库里出现不认识的值：当 unknown，不冒充 ready
      latest = { ...latest!, scanDeviceHealth: 'sleeping', scanDeviceObservedAt: observed }
      assert.equal((await admin.getTerminalPrinterStatus(terminalId)).scanDeviceHealth, 'unknown')
      assert.equal(publicScanDeviceHealth('sleeping'), 'unknown')
      assert.equal(publicScanDeviceHealth(''), 'unknown')
      assert.equal(publicScanDeviceHealth(null), null)
      assert.equal(publicScanDeviceHealth(undefined), null)
      assert.equal(publicScanDeviceHealth('ready'), 'ready')
      pass('旧心跳不带照收且公开给 null；不认识的值当 unknown；只带一项也收；未来时间被截；不带时区被拒')

      // 真库：新列真的能写能读（迁移与 schema 一致）
      const hbTerminal = await makeTerminal('heartbeat', null)
      const realAgent = new TerminalAgentService(prisma, new AuditService(prisma))
      await prisma.terminal.update({ where: { id: hbTerminal.id }, data: { lifecycleStatus: 'active' } })
      await prisma.terminalHeartbeat.create({ data: { terminalId: hbTerminal.id, status: 'online', scanDeviceHealth: 'not_found', scanDeviceObservedAt: observed } })
      const realAdmin = new TerminalAdminService(prisma, realAgent, {} as never, { toAdminObservation: () => null } as never)
      const realPub = await realAdmin.getTerminalPrinterStatus(hbTerminal.id)
      assert.equal(realPub.scanDeviceHealth, 'not_found')
      assert.equal(realPub.scanDeviceObservedAt, observed.toISOString())
      pass('真库：心跳新列读写一致，公开接口按终端取最近一条')
    }

    // ── H. HTTP 真路由 ─────────────────────────────────────────────────────────
    console.log('\n-- H. HTTP 真路由 --')
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
      const call = async (path: string, init: RequestInit) => {
        const res = await fetch(`${base}${path}`, init)
        return { status: res.status, json: (await res.json()) as { success?: boolean; data?: Record<string, unknown>; error?: { code?: string } } }
      }
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

      const t = await makeTerminal('http')
      const created = await deviceSession(t.id)
      const reportPath = `/terminals/${t.id}/scan-tasks/${created.scanTaskId}/device-report`
      const auth = { authorization: `Bearer ${t.token}` }

      assert.equal((await post(reportPath, { state: 'scanning', pageCount: 1 })).status, 401, '不带终端令牌 401')
      assert.equal((await post(reportPath, { state: 'scanning', pageCount: 1 }, { authorization: 'Bearer wrong' })).status, 401, '错误终端令牌 401')
      assert.equal((await post(reportPath, { state: 'sleeping' }, auth)).status, 400, '非法 state 400')
      assert.equal((await post(reportPath, { state: 'scanning', pageCount: 1, extra: true }, auth)).status, 400, '多余字段 400（全局白名单）')
      assert.equal((await post(reportPath, { state: 'scanning', pageCount: -3 }, auth)).status, 400, '负页数 400')
      const okReport = await post(reportPath, { state: 'scanning', pageCount: 1 }, auth)
      assert.equal(okReport.status, 200)
      assert.equal(okReport.json.success, true)
      assert.equal(okReport.json.data?.['deviceState'], 'scanning')
      assert.equal(okReport.json.data?.['devicePageCount'], 1)
      const illegal = await post(reportPath, { state: 'delivering', pageCount: 1 }, auth)
      assert.equal(illegal.status, 409)
      assert.equal(illegal.json.error?.code, 'SCAN_DEVICE_TRANSITION_INVALID')
      const otherTerminal = await makeTerminal('httpother')
      const crossed = await post(`/terminals/${otherTerminal.id}/scan-tasks/${created.scanTaskId}/device-report`, { state: 'scanning', pageCount: 2 }, { authorization: `Bearer ${otherTerminal.token}` })
      assert.equal(crossed.status, 404, '别的终端用自己的令牌回报本终端的任务：404')
      pass('device-report 真路由：401 / 400（非法取值、多余字段）/ 200 / 409 / 404')

      // multipart deliver：origin 不被全局白名单拦；多余文本字段也不会 400（逐字段取）
      await post(reportPath, { state: 'composing', pageCount: 1 }, auth)
      const lease = await scanSvc.getScanDeliveryLease(t.id)
      const form = () => {
        const f = new FormData()
        f.append('scanTaskId', created.scanTaskId)
        f.append('deliveryLease', lease.deliveryLease)
        f.append('observedAt', new Date().toISOString())
        return f
      }
      const deliverUrl = `/terminals/${t.id}/scan-sessions/deliver`
      const withoutOrigin = form()
      withoutOrigin.append('file', new Blob([new Uint8Array(uniquePdf())], { type: 'application/pdf' }), 'scan.pdf')
      const mismatch = await call(deliverUrl, { method: 'POST', headers: auth, body: withoutOrigin })
      assert.equal(mismatch.status, 409)
      assert.equal(mismatch.json.error?.code, 'SCAN_DELIVER_ORIGIN_MISMATCH', 'device 会话 multipart 没带 origin → 按 watcher → 409')
      const withOrigin = form()
      withOrigin.append('origin', 'device')
      withOrigin.append('unrelatedField', 'whatever')
      withOrigin.append('file', new Blob([new Uint8Array(uniquePdf())], { type: 'application/pdf' }), '扫描件.pdf')
      const delivered = await call(deliverUrl, { method: 'POST', headers: auth, body: withOrigin })
      assert.equal(delivered.status, 201, `multipart 带 origin=device 应投递成功（实际 ${delivered.status} ${JSON.stringify(delivered.json)}）`)
      assert.equal(delivered.json.data?.['scanTaskId'], created.scanTaskId)

      // 面板会话 multipart 不带 origin：与以前完全一样
      const tp = await makeTerminal('httppanel', null)
      const panel = await panelSession(tp.id)
      const panelLease = await scanSvc.getScanDeliveryLease(tp.id)
      const panelForm = new FormData()
      panelForm.append('scanTaskId', panel.scanTaskId)
      panelForm.append('deliveryLease', panelLease.deliveryLease)
      panelForm.append('observedAt', new Date().toISOString())
      panelForm.append('file', new Blob([new Uint8Array(uniquePdf())], { type: 'application/pdf' }), 'panel.pdf')
      const panelDelivered = await call(`/terminals/${tp.id}/scan-sessions/deliver`, { method: 'POST', headers: { authorization: `Bearer ${tp.token}` }, body: panelForm })
      assert.equal(panelDelivered.status, 201, '面板 multipart 不带 origin 照常成功')
      pass('multipart deliver 真路由：origin 字段不被全局白名单拦；device 会话没带 origin 409；面板不带 origin 照旧')

      // switch-to-panel 真路由
      const ts = await makeTerminal('httpswitch')
      const cs = await deviceSession(ts.id)
      const switchPath = `/scan/sessions/${cs.scanTaskId}/switch-to-panel`
      assert.equal((await post(switchPath, {})).status, 403, '不带控制令牌 403')
      assert.equal((await post(switchPath, {}, { 'x-scan-session-control': 'wrong' })).status, 403, '令牌不对 403')
      const switched = await post(switchPath, {}, { 'x-scan-session-control': cs.controlToken })
      assert.equal(switched.status, 200)
      assert.equal(switched.json.data?.['startMode'], 'panel')
      assert.ok(Array.isArray(switched.json.data?.['instructions']))
      const again = await post(switchPath, {}, { 'x-scan-session-control': cs.controlToken })
      assert.equal(again.status, 200, '重复调用幂等')
      const stale = await post(`/terminals/${ts.id}/scan-tasks/${cs.scanTaskId}/device-report`, { state: 'scanning', pageCount: 1 }, { authorization: `Bearer ${ts.token}` })
      assert.equal(stale.status, 409)
      assert.equal(stale.json.error?.code, 'SCAN_DEVICE_SWITCHED_TO_PANEL')
      pass('switch-to-panel 真路由：403 / 200 / 重复 200；切换后 device-report 409 SCAN_DEVICE_SWITCHED_TO_PANEL')
    }

    console.log('\nPASS verify-scan-device-sessions')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    if (app) await app.close().catch(() => undefined)
    if (originalStorageDir === undefined) delete process.env['FILE_STORAGE_DIR']
    else process.env['FILE_STORAGE_DIR'] = originalStorageDir
    const tasks = await prisma.scanTask.findMany({ where: { terminalId: { in: terminalIds } }, select: { fileId: true } }).catch(() => [])
    const fileIds = tasks.map((task) => task.fileId).filter((id): id is string => Boolean(id) && id !== 'file_x')
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } }).catch(() => undefined)
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
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
