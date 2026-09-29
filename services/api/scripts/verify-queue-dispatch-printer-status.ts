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
import { HeartbeatDto } from '../src/terminals/dto/heartbeat.dto'
import { assertTerminalPrinterAvailable, UNAVAILABLE_PRINTER_STATUSES } from '../src/terminals/printer-availability'

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
  terminal.heartbeats = [{ createdAt: now, printerStatus: 'ready' }]
  const recovered = await collectDerivedAlerts(prisma as never, now)
  assert.equal(recovered.alerts.filter((alert) => alert.type === 'printer_issue').length, 0)
}

async function main(): Promise<void> {
  for (const status of STATUSES) {
    assert.equal(UNAVAILABLE_PRINTER_STATUSES.has(status), true)
    assert.equal((await validate(plainToInstance(HeartbeatDto, { printerStatus: status }))).length, 0)
  }
  assert.equal(UNAVAILABLE_PRINTER_STATUSES.has('unknown'), false)

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
          const payload = error.getResponse() as { error?: { code?: string } }
          assert.equal(payload.error?.code, 'PRINTER_UNAVAILABLE')
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
  console.log('PASS queue dispatch printer status')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
