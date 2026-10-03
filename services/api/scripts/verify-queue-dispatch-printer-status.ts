/**
 * 队列闸门的两个心跳值：HTTP 能收下、落库、拦住新打印单，告警按心跳派生并在恢复后消失。
 * 一体机对这两个未知值走 fail-closed。不连数据库。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import 'reflect-metadata'
import { BadRequestException, Body, Controller, Headers, HttpCode, Module, Param, Put, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { collectDerivedAlerts } from '../src/admin-ops/derived-alerts'
import { fleetAlertForHeartbeat, printerFaultTitle } from '../src/console-screen/console-screen.fleet'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { describePrinterFault, toAdminPrinterStatus } from '../src/terminals/admin-printer-status'
import { HeartbeatDto } from '../src/terminals/dto/heartbeat.dto'
import {
  assertTerminalPrinterAvailable,
  QUEUE_DISPATCH_HALTED_MESSAGE,
  QUEUE_DISPATCH_HALTED_STATUSES,
  UNAVAILABLE_PRINTER_STATUSES,
} from '../src/terminals/printer-availability'

// terminals-agent.service 在模块加载期 requireEnv。静态 import 会被提到文件头，
// 所以这里先写环境变量，再在 main 里动态 import。不覆盖外部已设值。
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-queue-dispatch-terminal-admin-secret'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-queue-dispatch-terminal-action-secret'

const TERMINAL_ID = 'terminal-queue-dispatch-status'
const STATUSES = ['queue_cleanup_failed', 'queue_pause_failed'] as const
const LABELS = {
  queue_cleanup_failed: '开机清理失败，暂停接打印单',
  queue_pause_failed: '暂停队列失败，暂停接打印单',
} as const
const ADVICE = {
  queue_cleanup_failed: '开机清理打印队列失败，已暂停接单。请到现场清空打印队列后重启 Agent。',
  queue_pause_failed: '暂停打印队列失败，已暂停接单。请到现场检查打印队列后重启 Agent。',
} as const
const BW_PARAMS = {
  copies: 1,
  colorMode: 'black_white' as const,
  duplex: 'simplex' as const,
  paperSize: 'A4' as const,
  orientation: 'auto' as const,
  quality: 'standard' as const,
  scale: 'fit' as const,
  pagesPerSheet: 1 as const,
}

interface StoredHeartbeat {
  terminalId: string
  printerStatus: string | null
  createdAt: Date
}

function assertKioskFailClosed(): void {
  const repoRoot = join(__dirname, '..', '..', '..')
  const source = readFileSync(join(repoRoot, 'apps/kiosk/src/hooks/useTerminalDeviceStatus.ts'), 'utf8')
  const stripped = source
    .replace(
      /import \{[^}]+\} from 'react'\n/,
      'const useEffect = () => undefined\nconst useState = () => undefined\nconst useSyncExternalStore = () => undefined\n',
    )
    .replace(/import type \{[^}]+\} from '@ai-job-print\/shared'\n/, '')
    .replace(
      /import \{[^}]+\} from '\.\.\/services\/api\/client'\n/,
      'const API_BASE_URL = ""\nconst IS_MOCK_MODE = false\n',
    )
    .replace(
      /import \{[^}]+\} from '\.\.\/services\/api\/screensaver'\n/,
      'const getTerminalId = () => ""\nconst subscribeTerminalIdentity = () => () => undefined\n',
    )
    .replace(/import\.meta\.env/g, '({} as { VITE_PRINTER_NAME?: string })')
  const dir = mkdtempSync(join(tmpdir(), 'kiosk-printer-map-'))
  const file = join(dir, 'map-terminal-printer-status.ts')
  writeFileSync(
    file,
    `${stripped}
const cleanup = mapTerminalPrinterStatus({ heartbeatOnline: true, printerStatus: 'queue_cleanup_failed' })
const pause = mapTerminalPrinterStatus({ heartbeatOnline: true, printerStatus: 'queue_pause_failed' })
if (cleanup.printerReady !== false || pause.printerReady !== false) process.exit(1)
process.exit(0)
`,
  )
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', file], {
    cwd: join(repoRoot, 'apps/terminal-agent'),
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout || 'kiosk mapper did not run')
}

async function assertAlertsDisappear(status: (typeof STATUSES)[number], label: string): Promise<void> {
  const now = new Date()
  const terminal = {
    id: TERMINAL_ID,
    terminalCode: 'KSK-QUEUE',
    registeredAt: new Date(now.getTime() - 60_000),
    heartbeats: [{ createdAt: now, printerStatus: status }],
  }
  const prisma = {
    terminal: { findMany: async () => [terminal] },
    terminalHeartbeat: { groupBy: async () => [] },
    printTask: { findMany: async () => [], count: async () => 0 },
    feedbackTicket: { count: async () => 0, findFirst: async () => null },
  }
  const fault = await collectDerivedAlerts(prisma as never, now)
  const issues = fault.alerts.filter((alert) => alert.type === 'printer_issue')
  assert.equal(issues.length, 1)
  assert.match(issues[0]?.title ?? '', new RegExp(label))
  assert.equal(issues[0]?.severity, 'error')
  assert.equal(issues[0]?.detail, `终端在线，${ADVICE[status]}`)
  assert.equal(issues[0]?.detail.includes(status), false)
  terminal.heartbeats = [{ createdAt: now, printerStatus: 'ready' }]
  const recovered = await collectDerivedAlerts(prisma as never, now)
  assert.equal(recovered.alerts.filter((alert) => alert.type === 'printer_issue').length, 0)
}

function heartbeatPrisma(printerStatus: string) {
  const createdAt = new Date()
  return {
    terminal: { findFirst: async () => ({ id: TERMINAL_ID }) },
    terminalHeartbeat: { findFirst: async () => ({ printerStatus, createdAt }) },
  }
}

async function withPrinterSwitch(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const previous = process.env['PRINT_REQUIRE_PRINTER_ONLINE']
  if (value === undefined) delete process.env['PRINT_REQUIRE_PRINTER_ONLINE']
  else process.env['PRINT_REQUIRE_PRINTER_ONLINE'] = value
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env['PRINT_REQUIRE_PRINTER_ONLINE']
    else process.env['PRINT_REQUIRE_PRINTER_ONLINE'] = previous
  }
}

function quoteService(prisma: object): { quote: () => Promise<{ billablePages: number }>; pageCalls: () => number } {
  let pageCalls = 0
  const pageCount = {
    resolveBillablePages: async () => {
      pageCalls += 1
      return { billablePages: 1, billingPageSource: 'pdf_lightweight_scan' as const }
    },
  }
  const pricing = {
    quotePrint: async (input: { billablePages: number; billingPageSource: 'pdf_lightweight_scan' | 'image_single_page' }) => ({
      amountCents: 10,
      billablePages: input.billablePages,
      billingPageSource: input.billingPageSource,
      lines: [],
    }),
  }
  const quotes = new OrderQuoteService(pageCount as never, pricing as never, {} as never, prisma as never)
  return {
    quote: () => quotes.quote({
      terminalId: TERMINAL_ID,
      fileUrl: 'https://example.invalid/a.pdf',
      params: BW_PARAMS,
    }),
    pageCalls: () => pageCalls,
  }
}

const HALT_CODE = 'PRINT_TERMINAL_QUEUE_HALTED'
const HALT_MESSAGE = '这台终端暂停接打印单，暂不能下单，请稍后再试或换一台终端'
const OFFLINE_MESSAGE = '本机打印机当前不可用（离线、缺纸或故障），暂不能下单，请联系工作人员'
const NOT_READY_MESSAGE = '本机打印服务暂未就绪，暂不能下单，请稍后再试或联系工作人员'

function haltedPayload(error: unknown): { code?: string; message?: string } {
  assert.ok(error instanceof BadRequestException)
  assert.equal(error.getStatus(), 400)
  const payload = error.getResponse() as { error?: { code?: string; message?: string } }
  return payload.error ?? {}
}

async function expectHalted(run: () => Promise<unknown>): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    const body = haltedPayload(error)
    assert.equal(body.code, HALT_CODE)
    assert.equal(body.message, HALT_MESSAGE)
    assert.equal(body.message?.includes('本机'), false)
    assert.equal(QUEUE_DISPATCH_HALTED_MESSAGE, HALT_MESSAGE)
    return true
  })
}

async function expectUnavailable(run: () => Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    const body = haltedPayload(error)
    assert.equal(body.code, 'PRINTER_UNAVAILABLE')
    assert.equal(body.message, message)
    return true
  })
}

/** offline / error / paper_empty / 没有心跳仍用旧码和旧文案。报价与建单同一条函数。 */
async function assertOtherStatusesKeepPrinterUnavailable(): Promise<void> {
  await withPrinterSwitch('true', async () => {
    for (const status of ['offline', 'error', 'paper_empty'] as const) {
      const prisma = heartbeatPrisma(status)
      await expectUnavailable(
        () => assertTerminalPrinterAvailable(prisma as never, TERMINAL_ID, process.env),
        OFFLINE_MESSAGE,
      )
      await expectUnavailable(() => quoteService(prisma).quote(), OFFLINE_MESSAGE)
    }
    const missing = {
      terminal: { findFirst: async () => ({ id: TERMINAL_ID }) },
      terminalHeartbeat: { findFirst: async () => null },
    }
    await expectUnavailable(
      () => assertTerminalPrinterAvailable(missing as never, TERMINAL_ID, process.env),
      NOT_READY_MESSAGE,
    )
    await expectUnavailable(() => quoteService(missing).quote(), NOT_READY_MESSAGE)
  })
}

/** 开关关闭时，两个闸门状态仍拦截报价和建单；offline 仍按原语义放行。 */
async function assertSwitchOffStillBlocksQueueGates(): Promise<void> {
  for (const setting of [undefined, 'false'] as const) {
    await withPrinterSwitch(setting, async () => {
      for (const status of STATUSES) {
        const prisma = heartbeatPrisma(status)
        await expectHalted(() => assertTerminalPrinterAvailable(prisma as never, TERMINAL_ID, process.env))
        const quoted = quoteService(prisma)
        await expectHalted(() => quoted.quote())
        assert.equal(quoted.pageCalls(), 0, `${status}: blocked quote must not count pages`)
      }
      const offline = heartbeatPrisma('offline')
      await assertTerminalPrinterAvailable(offline as never, TERMINAL_ID, process.env)
      const quoted = quoteService(offline)
      const quote = await quoted.quote()
      assert.equal(quote.billablePages, 1)
      assert.equal(quoted.pageCalls(), 1, 'offline with the switch off still quotes')
    })
  }
}

function assertQueueGateDisplay(): void {
  const now = new Date()
  for (const status of STATUSES) {
    assert.equal(QUEUE_DISPATCH_HALTED_STATUSES.has(status), true)
    assert.equal(toAdminPrinterStatus(true, status), 'error')
    assert.equal(describePrinterFault(true, status), ADVICE[status])
    assert.equal(describePrinterFault(false, status), '终端离线，打印机状态未知')
    assert.equal(printerFaultTitle(status), LABELS[status])
    const alert = fleetAlertForHeartbeat({ createdAt: now, printerStatus: status }, now)
    assert.equal(alert?.kind, 'printer_issue')
    assert.equal(alert?.title, LABELS[status])
  }
}

function assertMutationsFail(): void {
  if (process.env['QUEUE_DISPATCH_MUTATION_CHILD'] === '1') return
  const availabilityPath = join(__dirname, '../src/terminals/printer-availability.ts')
  const original = readFileSync(availabilityPath, 'utf8')
  const mutations: Array<[string, string, string]> = [
    [
      'drop queue_cleanup_failed from the halt set',
      "export const QUEUE_DISPATCH_HALTED_STATUSES = new Set(['queue_cleanup_failed', 'queue_pause_failed'])",
      "export const QUEUE_DISPATCH_HALTED_STATUSES = new Set(['queue_pause_failed'])",
    ],
    [
      'halt branch uses the old printer code',
      "error: { code: 'PRINT_TERMINAL_QUEUE_HALTED', message:",
      "error: { code: 'PRINTER_UNAVAILABLE', message:",
    ],
    [
      'put the halt back under the switch',
      `  const availability = await readPrinterAvailability(prisma, terminalId)
  // 先看闸门，再看开关。这两个状态表示 Agent 已经停领，不能被开关放行。
  if (isQueueDispatchHalted(availability)) {`,
      `  const availability = await readPrinterAvailability(prisma, terminalId)
  if (!printerOnlineRequired(env)) return
  // 先看闸门，再看开关。这两个状态表示 Agent 已经停领，不能被开关放行。
  if (isQueueDispatchHalted(availability)) {`,
    ],
  ]
  for (const [label, from, to] of mutations) {
    assert.ok(original.includes(from), `${label}: anchor missing`)
    writeFileSync(availabilityPath, original.replace(from, to))
    try {
      const result = spawnSync(
        process.execPath,
        ['-r', '@swc-node/register', join(__dirname, 'verify-queue-dispatch-printer-status.ts')],
        {
          cwd: join(__dirname, '..'),
          encoding: 'utf8',
          timeout: 120_000,
          env: { ...process.env, QUEUE_DISPATCH_MUTATION_CHILD: '1' },
        },
      )
      assert.notEqual(result.status, 0, `${label}: reversed behavior must fail\n${result.stdout}\n${result.stderr}`)
    } finally {
      writeFileSync(availabilityPath, original)
    }
  }
}

async function main(): Promise<void> {
  for (const status of STATUSES) {
    assert.equal(UNAVAILABLE_PRINTER_STATUSES.has(status), true)
    assert.equal((await validate(plainToInstance(HeartbeatDto, { printerStatus: status }))).length, 0)
  }
  assert.equal(UNAVAILABLE_PRINTER_STATUSES.has('unknown'), false)
  await assertSwitchOffStillBlocksQueueGates()
  await assertOtherStatusesKeepPrinterUnavailable()
  assertQueueGateDisplay()

  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const stored: StoredHeartbeat[] = []
  const prisma = {
    terminal: {
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
    terminalHeartbeat: {
      create: async ({ data }: { data: { terminalId: string; printerStatus: string | null } }) => {
        const row = { terminalId: data.terminalId, printerStatus: data.printerStatus, createdAt: new Date() }
        stored.push(row)
        return row
      },
      findFirst: async () => stored[stored.length - 1] ?? null,
    },
  }
  const agent = new TerminalAgentService(prisma as never, {} as never, { validateTerminalToken: async () => undefined } as never)

  @Controller('terminals')
  class HeartbeatProbeController {
    constructor(private readonly terminals: TerminalAgentService) {}

    @Put(':terminalId/heartbeat')
    @HttpCode(200)
    heartbeat(
      @Param('terminalId') terminalId: string,
      @Body() dto: HeartbeatDto,
      @Headers('authorization') authorization?: string,
    ) {
      return this.terminals.heartbeat(terminalId, dto, authorization)
    }
  }

  @Module({
    controllers: [HeartbeatProbeController],
    providers: [{ provide: TerminalAgentService, useValue: agent }],
  })
  class ProbeModule {}

  const app = await NestFactory.create(ProbeModule, { logger: false })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  await app.listen(0, '127.0.0.1')
  try {
    const address = app.getHttpServer().address()
    if (!address || typeof address === 'string') throw new Error('listen address missing')
    for (const status of STATUSES) {
      const response = await fetch(`http://127.0.0.1:${address.port}/terminals/${TERMINAL_ID}/heartbeat`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: 'Bearer verify' },
        body: JSON.stringify({ printerStatus: status }),
      })
      assert.ok(response.status >= 200 && response.status < 300, `${status} heartbeat status ${response.status}`)
      const body = await response.json() as { acknowledged?: boolean }
      assert.equal(body.acknowledged, true)
      assert.equal(stored[stored.length - 1]?.printerStatus, status)
      await assert.rejects(
        () => assertTerminalPrinterAvailable(prisma as never, TERMINAL_ID, { PRINT_REQUIRE_PRINTER_ONLINE: 'true' }),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException)
          const payload = error.getResponse() as { error?: { code?: string; message?: string } }
          assert.equal(error.getStatus(), 400)
          assert.equal(payload.error?.code, HALT_CODE)
          assert.equal(payload.error?.message, HALT_MESSAGE)
          assert.equal(payload.error?.message?.includes('本机'), false)
          return true
        },
      )
    }
    const ready = await fetch(`http://127.0.0.1:${address.port}/terminals/${TERMINAL_ID}/heartbeat`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer verify' },
      body: JSON.stringify({ printerStatus: 'ready' }),
    })
    assert.ok(ready.status >= 200 && ready.status < 300)
    await assertTerminalPrinterAvailable(prisma as never, TERMINAL_ID, { PRINT_REQUIRE_PRINTER_ONLINE: 'true' })
  } finally {
    await app.close()
  }

  for (const status of STATUSES) {
    await assertAlertsDisappear(status, LABELS[status])
  }
  assertKioskFailClosed()
  assertMutationsFail()
  console.log('PASS queue dispatch printer status')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
