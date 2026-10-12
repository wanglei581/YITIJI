import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import 'reflect-metadata'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
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

  await agent.heartbeat(terminalId, validHealthy, 'Bearer redacted')
  assert.equal(latestHeartbeat?.scanInputHealth, 'healthy')
  assert.equal(latestHeartbeat?.scanInputAction, 'none')
  assert.equal(latestHeartbeat?.scanInputReason, null)

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

  // 打印完成记录开关 + 推断单数：存最近一次心跳，后台记录读得到；老版本不带则为 null；
  // 坏值与不认识的字段仍是 400（入参白名单没有放宽）。
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' },
    }),
  })
  const acceptHeartbeat = async (body: object) => pipe.transform(body, { type: 'body', metatype: HeartbeatDto })
  const heartbeatStatus = async (body: object): Promise<number> => {
    try {
      await acceptHeartbeat(body)
      return 200
    } catch (error) {
      return error instanceof BadRequestException ? error.getStatus() : 0
    }
  }
  const reported = await acceptHeartbeat({
    status: 'online',
    printCompletionLog: 'enabled',
    printResultsInferred: 3,
  })
  await agent.heartbeat(terminalId, reported, 'Bearer redacted')
  assert.equal(latestHeartbeat?.printCompletionLog, 'enabled')
  assert.equal(latestHeartbeat?.printResultsInferred, 3)
  const reportedProjection = (await admin.listTerminalsForAdmin()).terminals[0]
  assert.equal(reportedProjection?.printCompletionLog, 'enabled')
  assert.equal(reportedProjection?.printResultsInferred, 3)
  assert.equal(await heartbeatStatus({ printCompletionLog: 'disabled', printResultsInferred: 0 }), 200)
  assert.equal(await heartbeatStatus({ printCompletionLog: 'unknown', printResultsInferred: 1000000 }), 200)

  const omitted = await acceptHeartbeat({ status: 'online' })
  assert.equal(await heartbeatStatus({ status: 'online' }), 200, 'old Agents that omit both fields stay 200')
  await agent.heartbeat(terminalId, omitted, 'Bearer redacted')
  assert.equal(latestHeartbeat?.printCompletionLog, null)
  assert.equal(latestHeartbeat?.printResultsInferred, null)
  const omittedProjection = (await admin.listTerminalsForAdmin()).terminals[0]
  assert.equal(omittedProjection?.printCompletionLog, null)
  assert.equal(omittedProjection?.printResultsInferred, null)

  for (const invalid of [
    { printCompletionLog: 'on' },
    { printResultsInferred: -1 },
    { printResultsInferred: 1.5 },
    { printResultsInferred: '3' },
    { printResultsInferred: 1000001 },
    { printCompletionLog: 'enabled', printResultsInferred: 1, notARealField: true },
  ]) {
    assert.equal(await heartbeatStatus(invalid), 400, `expected 400 for ${JSON.stringify(invalid)}`)
  }

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
    assert.match(model, /printCompletionLog\s+String\?/)
    assert.match(model, /printResultsInferred\s+Int\?/)
  }
  for (const migrationPath of [
    'prisma/migrations/20261012130000_heartbeat_print_result_basis/migration.sql',
    'prisma/postgres/migrations/20261012130000_heartbeat_print_result_basis/migration.sql',
  ]) {
    const migration = readFileSync(join(root, migrationPath), 'utf8')
    assert.match(migration, /ADD COLUMN "printCompletionLog"/)
    assert.match(migration, /ADD COLUMN "printResultsInferred"/)
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
