/**
 * 设备管理 → 打印机「本系统出纸」。
 * 临时 SQLite，不写共享库。时钟由调用方注入。
 * 控制器会连带加载终端模块，密钥必须在 import 之前就位。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-admin-printer-output-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-admin-printer-output-action-secret-0123456789'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

import 'reflect-metadata'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { MODULE_METADATA } from '@nestjs/common/constants'
import {
  AdminPrinterOutputService,
  shanghaiMonthStart,
  type AdminPrinterOutput,
} from '../src/terminals/admin-printer-output'
import { TerminalsModule } from '../src/terminals/terminals.module'
import { PrismaService } from '../src/prisma/prisma.service'
import type { AdminPrinterView } from '../src/terminals/terminals-admin.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const NOW = new Date('2026-11-15T10:00:00+08:00')
const BOUNDARY = new Date('2026-12-01T00:30:00+08:00')
const TERM_A = 'term-output-a'
const TERM_B = 'term-output-b'
const TERM_C = 'term-output-c'

const EXPECTED_A: AdminPrinterOutput = {
  today: { sides: 25, colorSides: 10, duplexSides: 16 },
  month: { sides: 41, colorSides: 10, duplexSides: 16 },
  monthUnconfirmedTasks: 1,
}

function fail(label: string, detail?: string): never {
  throw new Error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

function pass(label: string): void {
  console.log(`PASS ${label}`)
}

function check(label: string, condition: boolean, detail?: string): void {
  if (!condition) fail(label, detail)
  pass(label)
}

function sameOutput(actual: AdminPrinterOutput | undefined, expected: AdminPrinterOutput): boolean {
  if (!actual) return false
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function prepareDatabase(): { cleanup: () => void } {
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    throw new Error('VERIFICATION_DATABASE_PRODUCTION_FORBIDDEN')
  }
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const previousTarget = process.env['VERIFICATION_DATABASE_TARGET']
  const directory = mkdtempSync(join(tmpdir(), 'verify-admin-printer-output-'))
  const databasePath = join(directory, 'verify-admin-printer-output.db')
  closeSync(openSync(databasePath, 'a'))
  process.env['DATABASE_URL'] = `file:${databasePath}`
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  const apiRoot = join(__dirname, '..')
  const prismaCli = join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js')
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    const err = error as { stderr?: string; stdout?: string; message?: string }
    throw new Error(`prisma migrate deploy failed: ${(err.stderr || err.stdout || err.message || 'unknown').trim()}`)
  }
  return {
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      if (previousTarget === undefined) delete process.env['VERIFICATION_DATABASE_TARGET']
      else process.env['VERIFICATION_DATABASE_TARGET'] = previousTarget
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

const PRINTER: AdminPrinterView = {
  id: 'printer:term-a',
  terminalId: TERM_A,
  terminalCode: 'TERM-A',
  name: 'TERM-A 打印机',
  model: null,
  serialNumber: null,
  status: 'online',
  printerStatus: 'ready',
  currentTask: null,
  tonerLevel: null,
  paperTrayLevel: null,
  paperStatus: null,
  fault: null,
  lastHeartbeatAt: null,
  lastSyncAt: null,
}

async function controllerWith(summarize: () => Promise<unknown>) {
  const { AdminPrintersController } = await import('../src/terminals/admin-printers.controller')
  return new AdminPrintersController(
    { listPrintersForAdmin: async () => ({ printers: [PRINTER] }) } as never,
    { summarize } as never,
  )
}

async function assertController(): Promise<void> {
  const warnings: string[] = []
  const original = Logger.prototype.warn
  Logger.prototype.warn = function (message: unknown) {
    warnings.push(String(message))
  }
  try {
    const broken = await (await controllerWith(async () => {
      throw new Error('stats down')
    })).list('output')
    check('统计抛错时列表仍返回这台打印机', broken.data.printers.length === 1 && broken.data.printers[0]?.name === 'TERM-A 打印机')
    check('统计抛错时 output 为 null', broken.data.printers[0]?.output === null)
    check("统计抛错时 outputStatus 为 unavailable", broken.data.outputStatus === 'unavailable')
    check('统计抛错时打一条 warn', warnings.length === 1)

    const capped = await (await controllerWith(async () => ({ status: 'capped' }))).list('output')
    check('超上限时列表仍在，output 为 null', capped.data.printers[0]?.output === null && capped.data.printers.length === 1)
    check("超上限时 outputStatus 为 capped", capped.data.outputStatus === 'capped')

    const sample: AdminPrinterOutput = {
      today: { sides: 2, colorSides: 2, duplexSides: 0 },
      month: { sides: 2, colorSides: 2, duplexSides: 0 },
      monthUnconfirmedTasks: 0,
    }
    const ok = await (await controllerWith(async () => ({ status: 'ok', byTerminal: new Map([[TERM_A, sample]]) }))).list('output')
    check('统计正常时拼上这台的 output', sameOutput(ok.data.printers[0]?.output ?? undefined, sample) && ok.data.outputStatus === 'ok')
  } finally {
    Logger.prototype.warn = original
  }
}

interface SeedTask {
  id: string
  terminalId: string
  completedAt: string
  status?: string
  errorCode?: string | null
  printOutcome?: string | null
  params?: Record<string, unknown> | 'bad'
  orderPages?: number
  itemPages?: number
  itemColorMode?: string
  itemDuplex?: string
  itemCopies?: number
}

async function seedTask(prisma: PrismaService, task: SeedTask): Promise<void> {
  const status = task.status ?? 'completed'
  await prisma.printTask.create({
    data: {
      id: task.id,
      terminalId: task.terminalId,
      fileUrl: `https://files.invalid/${task.id}`,
      fileMd5: 'md5',
      paramsJson: task.params === 'bad' ? 'not-json' : JSON.stringify(task.params ?? {}),
      status,
      errorCode: task.errorCode ?? null,
      printOutcome: task.printOutcome === undefined ? null : task.printOutcome,
      completedAt: new Date(task.completedAt),
    },
  })
  if (task.orderPages === undefined && task.itemPages === undefined) return
  const order = await prisma.order.create({
    data: {
      orderNo: `NO-${task.id}`,
      printTaskId: task.id,
      terminalId: task.terminalId,
      amountCents: 0,
      billablePages: task.orderPages ?? null,
      payStatus: 'paid',
      taskStatus: status,
    },
  })
  if (task.itemPages === undefined) return
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      seq: 1,
      fileId: `file-${task.id}`,
      colorMode: task.itemColorMode ?? 'black_white',
      duplex: task.itemDuplex ?? 'simplex',
      copies: task.itemCopies ?? 1,
      billablePages: task.itemPages,
      amountCents: 0,
      status,
      printTaskId: task.id,
    },
  })
}

async function seed(prisma: PrismaService): Promise<void> {
  for (const id of [TERM_A, TERM_B, TERM_C]) {
    await prisma.terminal.create({
      data: { id, terminalCode: id, agentToken: `tok-${id}`, deviceFingerprint: 'fp' },
    })
  }
  const tasks: SeedTask[] = [
    {
      id: 'a-color-simplex',
      terminalId: TERM_A,
      completedAt: '2026-11-15T09:00:00+08:00',
      params: { colorMode: 'color', duplex: 'simplex', copies: 2 },
      orderPages: 3,
    },
    {
      id: 'a-long-duplex',
      terminalId: TERM_A,
      completedAt: '2026-11-15T08:00:00+08:00',
      params: { colorMode: 'black_white', duplex: 'duplex_long_edge', copies: 3 },
      orderPages: 99,
      itemPages: 4,
      itemColorMode: 'color',
      itemDuplex: 'simplex',
      itemCopies: 1,
    },
    {
      id: 'a-earlier',
      terminalId: TERM_A,
      completedAt: '2026-11-03T12:00:00+08:00',
      params: { colorMode: 'black_white', duplex: 'simplex', copies: 1 },
      orderPages: 5,
    },
    {
      id: 'a-last-month',
      terminalId: TERM_A,
      completedAt: '2026-10-20T12:00:00+08:00',
      params: { colorMode: 'black_white', duplex: 'simplex', copies: 1 },
      orderPages: 7,
    },
    {
      id: 'a-not-printed',
      terminalId: TERM_A,
      completedAt: '2026-11-15T09:30:00+08:00',
      printOutcome: 'not_printed',
      params: { colorMode: 'black_white', duplex: 'simplex', copies: 1 },
      orderPages: 8,
    },
    {
      id: 'a-unconfirmed',
      terminalId: TERM_A,
      completedAt: '2026-11-10T12:00:00+08:00',
      status: 'failed',
      errorCode: 'PRINT_JOB_UNCONFIRMED',
      params: { colorMode: 'color', duplex: 'duplex_long_edge', copies: 1 },
      orderPages: 9,
    },
    {
      id: 'a-failed-printed',
      terminalId: TERM_A,
      completedAt: '2026-11-15T07:00:00+08:00',
      status: 'failed',
      printOutcome: 'printed',
      params: { colorMode: 'color', duplex: 'duplex_short_edge', copies: 2 },
      orderPages: 2,
    },
    {
      id: 'a-no-order',
      terminalId: TERM_A,
      completedAt: '2026-11-15T06:00:00+08:00',
      params: { copies: 5, pages: 100, billablePages: 100 },
    },
    {
      id: 'a-bad-json',
      terminalId: TERM_A,
      completedAt: '2026-11-15T05:00:00+08:00',
      params: 'bad',
      orderPages: 2,
    },
    {
      id: 'a-single',
      terminalId: TERM_A,
      completedAt: '2026-11-15T04:00:00+08:00',
      params: { colorMode: 'black_white', duplex: 'single', copies: 1 },
      orderPages: 1,
    },
    {
      id: 'a-prev-month-edge',
      terminalId: TERM_A,
      completedAt: '2026-11-30T23:59:00+08:00',
      params: { colorMode: 'black_white', duplex: 'simplex', copies: 1 },
      orderPages: 11,
    },
    {
      id: 'a-dec-1',
      terminalId: TERM_A,
      completedAt: '2026-12-01T00:10:00+08:00',
      params: { colorMode: 'black_white', duplex: 'simplex', copies: 1 },
      orderPages: 3,
    },
    {
      id: 'b-today',
      terminalId: TERM_B,
      completedAt: '2026-11-15T09:00:00+08:00',
      params: { colorMode: 'color', duplex: 'duplex_long_edge', copies: 1 },
      orderPages: 10,
    },
  ]
  for (const task of tasks) await seedTask(prisma, task)
}

async function assertNumbers(prisma: PrismaService): Promise<void> {
  const service = new AdminPrinterOutputService(prisma)
  const listed = await service.summarize([TERM_A, TERM_B, TERM_C], { now: NOW })
  check('十一月统计未触顶', listed.status === 'ok')
  if (listed.status !== 'ok') return
  const a = listed.byTerminal.get(TERM_A)
  const b = listed.byTerminal.get(TERM_B)
  const c = listed.byTerminal.get(TERM_C)
  check(
    '终端 A：今天 25 面（彩色 10 · 双面 16）；本月 41 面（另含 11 月 3 日 5 面、11 月 30 日 11 面）；未确认 1。不含未出纸、无订单、上个月',
    sameOutput(a, EXPECTED_A),
    JSON.stringify(a),
  )
  check(
    '别的终端的 10 面彩色双面不串进本终端',
    sameOutput(b, {
      today: { sides: 10, colorSides: 10, duplexSides: 10 },
      month: { sides: 10, colorSides: 10, duplexSides: 10 },
      monthUnconfirmedTasks: 0,
    }),
    JSON.stringify(b),
  )
  check('没有出纸的终端给 0，不是 null', c !== undefined && sameOutput(c, {
    today: { sides: 0, colorSides: 0, duplexSides: 0 },
    month: { sides: 0, colorSides: 0, duplexSides: 0 },
    monthUnconfirmedTasks: 0,
  }))

  const scoped = await service.summarize([TERM_A], { now: NOW, rowCap: 8 })
  check(
    '只查本终端：上限等于本终端出纸行数时仍给出精确数字',
    scoped.status === 'ok' && sameOutput(scoped.byTerminal.get(TERM_A), EXPECTED_A),
    scoped.status,
  )

  const capped = await service.summarize([TERM_A], { now: NOW, rowCap: 7 })
  check('行数超过上限时返回 capped，不给算少了的数', capped.status === 'capped' && !('byTerminal' in capped))

  const boundary = await service.summarize([TERM_A], { now: BOUNDARY })
  check('月界查询未触顶', boundary.status === 'ok')
  if (boundary.status !== 'ok') return
  const edge = boundary.byTerminal.get(TERM_A)
  check(
    '2026-12-01T00:30+08 时，11 月 30 日 23:59 的单不进今天也不进本月；12 月 1 日 0:10 的 3 面算今天也算本月',
    sameOutput(edge, {
      today: { sides: 3, colorSides: 0, duplexSides: 0 },
      month: { sides: 3, colorSides: 0, duplexSides: 0 },
      monthUnconfirmedTasks: 0,
    }),
    JSON.stringify(edge),
  )
}

function responseHasOutput(data: { printers: Array<object>; outputStatus?: string }): boolean {
  if ('output' in data || 'outputStatus' in data) return true
  return data.printers.some((printer) => 'output' in printer)
}

async function assertInclude(): Promise<void> {
  let calls = 0
  const sample: AdminPrinterOutput = {
    today: { sides: 2, colorSides: 2, duplexSides: 0 },
    month: { sides: 2, colorSides: 2, duplexSides: 0 },
    monthUnconfirmedTasks: 0,
  }
  const { AdminPrintersController } = await import('../src/terminals/admin-printers.controller')
  const controller = new AdminPrintersController(
    { listPrintersForAdmin: async () => ({ printers: [PRINTER] }) } as never,
    {
      summarize: async () => {
        calls += 1
        return { status: 'ok', byTerminal: new Map([[TERM_A, sample]]) }
      },
    } as never,
  )
  const plain = await controller.list()
  check('不带参数时 summarize 一次都没被调', calls === 0)
  check('不带参数时响应没有 output', !responseHasOutput(plain.data))
  const asked = await controller.list('output')
  check('include=output 时 summarize 调一次', calls === 1)
  check(
    'include=output 时有 output',
    asked.data.outputStatus === 'ok' && sameOutput(asked.data.printers[0]?.output ?? undefined, sample),
  )
  const beforeGarbage = calls
  const garbage = await controller.list('garbage')
  check('include=garbage 当没带', calls === beforeGarbage && !responseHasOutput(garbage.data))
}

/** 类本身，或 `{ provide: 这个类 }`，都算登记了。 */
function registersProvider(entry: unknown, token: unknown): boolean {
  if (entry === token) return true
  if (typeof entry !== 'object' || entry === null || !('provide' in entry)) return false
  return (entry as { provide: unknown }).provide === token
}

async function assertDependencyInjection(prisma: PrismaService): Promise<void> {
  const { Module } = await import('@nestjs/common')
  const { NestFactory } = await import('@nestjs/core')
  const { JwtService } = await import('@nestjs/jwt')
  const { AdminPrintersController } = await import('../src/terminals/admin-printers.controller')
  const { TerminalsService } = await import('../src/terminals/terminals.service')
  const { RedisService } = await import('../src/common/redis/redis.service')

  // 只读真实模块的装饰器元数据，不实例化 TerminalsModule。
  // 键用 @nestjs/common/constants 的 MODULE_METADATA（值即 'providers' / 'controllers'）。
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TerminalsModule) ?? []) as unknown[]
  const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, TerminalsModule) ?? []) as unknown[]
  const serviceRegistered = providers.some((entry) => registersProvider(entry, AdminPrinterOutputService))
  const controllerRegistered = controllers.includes(AdminPrintersController)
  check(
    '真实 TerminalsModule 登记了出纸服务和打印机控制器',
    serviceRegistered && controllerRegistered,
    `service=${serviceRegistered} controller=${controllerRegistered}`,
  )

  // 控制器上的守卫会被 Nest 一起实例化。桩掉它们的外部依赖。
  // 要验证的是 AdminPrinterOutputService 能不能注入 PrismaService。
  @Module({
    controllers: [AdminPrintersController],
    providers: [
      AdminPrinterOutputService,
      { provide: PrismaService, useValue: prisma },
      { provide: TerminalsService, useValue: { listPrintersForAdmin: async () => ({ printers: [PRINTER] }) } },
      { provide: JwtService, useValue: {} },
      { provide: RedisService, useValue: {} },
    ],
  })
  class AdminPrinterDiProbeModule {}

  let app: { get: (token: unknown) => unknown; close: () => Promise<void> } | undefined
  try {
    app = await NestFactory.createApplicationContext(AdminPrinterDiProbeModule, { logger: false, abortOnError: false })
    const output = app.get(AdminPrinterOutputService)
    const controller = app.get(AdminPrintersController)
    const resolved = output instanceof AdminPrinterOutputService && controller instanceof AdminPrintersController
    check('依赖注入真能解析', resolved)
    if (!(controller instanceof AdminPrintersController)) return
    try {
      const listed = await controller.list('output')
      check(
        '容器里取出的控制器能统计出纸',
        listed.data.outputStatus === 'ok',
        `outputStatus=${String(listed.data.outputStatus)}`,
      )
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('FAIL ')) throw error
      const message = error instanceof Error ? error.message : String(error)
      fail('容器里取出的控制器能统计出纸', message)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('FAIL ')) throw error
    const message = error instanceof Error ? error.message : String(error)
    fail('依赖注入真能解析', message)
  } finally {
    if (app) await app.close()
  }
}

async function main(): Promise<void> {
  console.log('\n=== 管理员打印机本系统出纸 ===')
  check(
    '上海月初是 +08:00 的 1 日 0 点，不是 UTC 0 点',
    shanghaiMonthStart(BOUNDARY).toISOString() === '2026-11-30T16:00:00.000Z',
    shanghaiMonthStart(BOUNDARY).toISOString(),
  )
  check(
    '十一月中旬的月初是 11 月 1 日 0 点 +08:00',
    shanghaiMonthStart(NOW).toISOString() === '2026-10-31T16:00:00.000Z',
  )
  await assertController()
  await assertInclude()
  const db = prepareDatabase()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    await seed(prisma)
    await assertNumbers(prisma)
    await assertDependencyInjection(prisma)
  } finally {
    await prisma.onModuleDestroy()
    db.cleanup()
  }
  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFAIL verify:admin-printer-output 执行异常')
  console.error(error)
  process.exit(1)
})
