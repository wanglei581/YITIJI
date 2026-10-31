import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-input-terminal-admin-secret-012345'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-input-action-secret-0123456789'

type HeartbeatRecord = Record<string, unknown> & { createdAt: Date }

async function main(): Promise<void> {
  const root = process.cwd()
  const { HeartbeatDto } = await import('../src/terminals/dto/heartbeat.dto')
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const { TerminalAdminService } = await import('../src/terminals/terminals-admin.service')

  const validLocked = plainToInstance(HeartbeatDto, {
    scanInputHealth: 'locked_out',
    scanInputAction: 'restart_required',
    scanInputReason: 'watcher_error',
    scanInputObservedAt: '2026-09-13T10:20:30.123Z',
  })
  assert.equal((await validate(validLocked)).length, 0)
  const validHealthy = plainToInstance(HeartbeatDto, {
    scanInputHealth: 'healthy',
    scanInputAction: 'none',
    scanInputReason: null,
    scanInputObservedAt: '2026-09-13T10:20:29.000Z',
  })
  assert.equal((await validate(validHealthy)).length, 0, 'healthy telemetry must accept an explicit null reason')
  for (const invalid of [
    { ...validLocked, scanInputHealth: 'broken' },
    { ...validLocked, scanInputAction: 'remote_unlock' },
    { ...validLocked, scanInputReason: 'C:\\private\\resume.pdf' },
    { ...validLocked, scanInputObservedAt: 'not-a-timestamp' },
    { ...validLocked, scanInputObservedAt: '2'.repeat(65) },
    { ...validLocked, scanInputHealth: null },
    { ...validLocked, scanInputAction: null },
    { ...validLocked, scanInputObservedAt: null },
  ]) {
    assert.notEqual((await validate(plainToInstance(HeartbeatDto, invalid))).length, 0)
  }

  let latestHeartbeat: HeartbeatRecord | undefined
  const terminalId = 'terminal-scan-input-telemetry'
  const prisma = {
    terminal: {
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      // 公开只读 printer-status（一体机「机器状态」页读）：按终端取最近一条心跳。
      findFirst: async () => ({
        id: terminalId,
        terminalCode: 'SCAN-TELEMETRY-001',
        heartbeats: latestHeartbeat ? [latestHeartbeat] : [],
      }),
      findMany: async () => [{
        id: terminalId,
        terminalCode: 'SCAN-TELEMETRY-001',
        displayName: null,
        macAddress: null,
        locationLabel: null,
        enabled: true,
        lifecycleStatus: 'active',
        lifecycleVersion: 1,
        credentialGeneration: 1,
        orgId: null,
        org: null,
        registeredAt: new Date('2026-09-13T09:00:00.000Z'),
        credentials: [{ id: 'credential-1' }],
        heartbeats: latestHeartbeat ? [latestHeartbeat] : [],
        releaseTargets: [],
      }],
    },
    terminalHeartbeat: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        latestHeartbeat = { ...data, createdAt: new Date('2026-09-13T10:20:31.000Z') }
        return latestHeartbeat
      },
    },
  }
  const credentials = { validateTerminalToken: async () => ({}) }
  const agent = new TerminalAgentService(
    prisma as never,
    {} as never,
    credentials as never,
  )
  const lockedDto = plainToInstance(HeartbeatDto, {
    status: 'online',
    ...validLocked,
  })
  await agent.heartbeat(terminalId, lockedDto, 'Bearer redacted')
  assert.equal(latestHeartbeat?.scanInputHealth, 'locked_out')
  assert.equal(latestHeartbeat?.scanInputAction, 'restart_required')
  assert.equal(latestHeartbeat?.scanInputReason, 'watcher_error')
  assert.deepEqual(latestHeartbeat?.scanInputObservedAt, new Date('2026-09-13T10:20:30.123Z'))

  const admin = new TerminalAdminService(
    prisma as never,
    agent,
    {} as never,
    { toAdminObservation: () => null } as never,
  )
  const projected = (await admin.listTerminalsForAdmin()).terminals[0]
  assert.equal(projected?.scanInputHealth, 'locked_out')
  assert.equal(projected?.scanInputAction, 'restart_required')
  assert.equal(projected?.scanInputReason, 'watcher_error')
  assert.equal(projected?.scanInputObservedAt, '2026-09-13T10:20:30.123Z')

  // 10/29 本机走查 I-01：一体机「机器状态」页要读到「扫描件的存放」这一项的真实读数。公开只读的 printer-status
  // 只给这一档（不带原因码、恢复动作、路径），锁死时给 locked_out，不冒充可用。
  const publicLocked = await admin.getTerminalPrinterStatus(terminalId)
  assert.equal(publicLocked.found, true)
  assert.equal(publicLocked.scanInputHealth, 'locked_out')
  assert.deepEqual(
    Object.keys(publicLocked).sort(),
    ['found', 'isOnline', 'lastSeenAt', 'printerStatus', 'scanInputHealth'],
    'public printer-status must not leak scan input reason, action or observation time',
  )

  await agent.heartbeat(terminalId, validHealthy, 'Bearer redacted')
  assert.equal(latestHeartbeat?.scanInputHealth, 'healthy')
  assert.equal(latestHeartbeat?.scanInputAction, 'none')
  assert.equal(latestHeartbeat?.scanInputReason, null)
  assert.equal((await admin.getTerminalPrinterStatus(terminalId)).scanInputHealth, 'healthy')
  // 库里出现不认识的值：当 unknown，不冒充 healthy。
  latestHeartbeat = { ...latestHeartbeat!, scanInputHealth: 'ok-ish' }
  assert.equal((await admin.getTerminalPrinterStatus(terminalId)).scanInputHealth, 'unknown')

  latestHeartbeat = undefined
  await agent.heartbeat(terminalId, plainToInstance(HeartbeatDto, { status: 'online' }), 'Bearer redacted')
  assert.equal(latestHeartbeat?.scanInputHealth, null, 'old Agents remain accepted')
  assert.equal(latestHeartbeat?.scanInputAction, null)
  assert.equal(latestHeartbeat?.scanInputReason, null)
  assert.equal(latestHeartbeat?.scanInputObservedAt, null)
  const oldAgentProjection = (await admin.listTerminalsForAdmin()).terminals[0]
  assert.equal(oldAgentProjection?.scanInputHealth, null)
  assert.equal(oldAgentProjection?.scanInputAction, null)
  assert.equal(oldAgentProjection?.scanInputReason, null)
  assert.equal(oldAgentProjection?.scanInputObservedAt, null)
  assert.equal(
    (await admin.getTerminalPrinterStatus(terminalId)).scanInputHealth,
    null,
    'old Agents do not report scan input health: the kiosk must read null as unread, not as healthy',
  )

  for (const invalidSemanticDto of [
    { scanInputHealth: 'locked_out', scanInputAction: 'none', scanInputReason: 'watcher_error', scanInputObservedAt: '2026-09-13T10:20:30.123Z' },
    { scanInputHealth: 'locked_out', scanInputAction: 'restart_required', scanInputReason: null, scanInputObservedAt: '2026-09-13T10:20:30.123Z' },
    { scanInputHealth: 'healthy', scanInputAction: 'restart_required', scanInputReason: null, scanInputObservedAt: '2026-09-13T10:20:30.123Z' },
    { scanInputHealth: 'healthy' },
    { scanInputHealth: 'locked_out', scanInputAction: 'restart_required', scanInputReason: 'C:\\private\\resume.pdf', scanInputObservedAt: '2026-09-13T10:20:30.123Z' },
    { scanInputHealth: 'locked_out', scanInputAction: 'restart_required', scanInputReason: 'watcher_error', scanInputObservedAt: '2026-09-13' },
  ]) {
    await assert.rejects(
      agent.heartbeat(terminalId, plainToInstance(HeartbeatDto, invalidSemanticDto), 'Bearer redacted'),
    )
  }

  const controllerSources = readdirSync(join(root, 'src/terminals'))
    .filter((name) => name.endsWith('.controller.ts'))
    .map((name) => readFileSync(join(root, 'src/terminals', name), 'utf8'))
    .join('\n')
  assert.doesNotMatch(
    controllerSources,
    /scan.?input[\s\S]{0,80}(?:unlock|recover|restart)|(?:unlock|recover)[\s\S]{0,80}scan.?input/i,
    'scan-input lockout must not expose a remote mutation or recovery endpoint',
  )

  for (const schemaPath of ['prisma/schema.prisma', 'prisma/postgres/schema.prisma']) {
    const schema = readFileSync(join(root, schemaPath), 'utf8')
    const model = schema.slice(schema.indexOf('model TerminalHeartbeat'), schema.indexOf('// ── F0.5 Agent release'))
    assert.match(model, /scanInputHealth\s+String\?/)
    assert.match(model, /scanInputAction\s+String\?/)
    assert.match(model, /scanInputReason\s+String\?/)
    assert.match(model, /scanInputObservedAt\s+DateTime\?/)
  }
  for (const migrationPath of [
    'prisma/migrations/20260913210000_add_scan_input_lockout_telemetry/migration.sql',
    'prisma/postgres/migrations/20260913210000_add_scan_input_lockout_telemetry/migration.sql',
  ]) {
    const migration = readFileSync(join(root, migrationPath), 'utf8')
    for (const field of ['scanInputHealth', 'scanInputAction', 'scanInputReason', 'scanInputObservedAt']) {
      assert.match(migration, new RegExp(`ADD COLUMN "${field}"`))
    }
  }

  console.log('PASS scan-input lockout telemetry API: DTO, persistence, old Agent, admin projection, dual schema')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
