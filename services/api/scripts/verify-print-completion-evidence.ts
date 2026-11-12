/**
 * 心跳可以带打印完成判据，也可以不带。
 * 带了就落进最新心跳；不带就记 null，后台显示未上报，不能当成可用。
 *
 * 运行：node -r @swc-node/register scripts/verify-print-completion-evidence.ts
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-print-completion-admin-secret-0123456789abcd'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-print-completion-action-secret-0123456789ab'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-completion-file-signing-secret-012345'

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { printCompletionEvidenceLabel } from '../../../apps/admin/src/routes/terminals/printCompletionEvidence'
import { AuditService } from '../src/audit/audit.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { HeartbeatDto } from '../src/terminals/dto/heartbeat.dto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = join(__dirname, '..')
const REPO_ROOT = join(API_ROOT, '../..')
const TERM = 'term-print-completion'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
const meta = { type: 'body' as const, metatype: HeartbeatDto, data: '' }

async function accept(body: Record<string, unknown>): Promise<HeartbeatDto> {
  const parsed = await pipe.transform(body, meta)
  assert.equal(parsed instanceof HeartbeatDto, true)
  return parsed as HeartbeatDto
}

async function reject(body: Record<string, unknown>): Promise<void> {
  await assert.rejects(() => pipe.transform(body, meta), (error: unknown) => error instanceof BadRequestException)
}

async function main(): Promise<void> {
  const sqliteMigration = read(join(API_ROOT, 'prisma/migrations/20261111120000_add_terminal_heartbeat_print_completion/migration.sql'))
  const postgresMigration = read(join(API_ROOT, 'prisma/postgres/migrations/20261111120000_add_terminal_heartbeat_print_completion/migration.sql'))
  assert.equal(sqliteMigration, postgresMigration)
  assert.match(sqliteMigration, /ADD COLUMN "printCompletionEvidence" TEXT/)
  const agent = read(join(API_ROOT, 'src/terminals/terminals-agent.service.ts'))
  assert.match(agent, /printCompletionEvidence: dto\.printCompletionEvidence \?\? null/)
  const admin = read(join(API_ROOT, 'src/terminals/terminals-admin.service.ts'))
  assert.match(admin, /printCompletionEvidence: true/)
  const drawer = read(join(REPO_ROOT, 'apps/admin/src/routes/terminals/TerminalDetailDrawer.tsx'))
  assert.match(drawer, /printCompletionEvidenceLabel\(terminal\.printCompletionEvidence\)/)
  assert.equal(printCompletionEvidenceLabel('available'), '打印完成判据可用')
  assert.equal(printCompletionEvidenceLabel('unavailable'), '打印完成判据不可用')
  assert.equal(printCompletionEvidenceLabel(null), '打印完成判据未上报')
  assert.equal(printCompletionEvidenceLabel(undefined), '打印完成判据未上报')
  assert.equal(printCompletionEvidenceLabel('healthy'), '打印完成判据未上报')

  const omitted = await accept({ status: 'online' })
  assert.equal(omitted.printCompletionEvidence, undefined)
  assert.equal((await accept({ status: 'online', printCompletionEvidence: 'available' })).printCompletionEvidence, 'available')
  assert.equal((await accept({ status: 'online', printCompletionEvidence: 'unavailable' })).printCompletionEvidence, 'unavailable')
  await reject({ status: 'online', printCompletionEvidence: 'healthy' })
  await reject({ status: 'online', printCompletionEvidence: null })
  await reject({ status: 'online', printCompletionEvidence: 'available', extraField: true })
  console.log('PASS 心跳校验收下 available / unavailable，不收别的值；不带字段仍然合法')

  const dir = mkdtempSync(join(tmpdir(), 'print-completion-'))
  const databasePath = join(dir, 'verify-print-completion.db')
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') process.env['NODE_ENV'] = 'test'
  assertIsolatedVerificationDatabase()
  closeSync(openSync(databasePath, 'wx'))
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', databaseUrl, '--accept-data-loss',
  ], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' })
  for (const file of [
    'prisma/migrations/20260724200000_guard_planned_terminal_updates/migration.sql',
    'prisma/migrations/20260726003000_guard_retired_terminal/migration.sql',
  ]) {
    execFileSync('sqlite3', [databasePath], { input: read(join(API_ROOT, file)) })
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const { TerminalAdminService } = await import('../src/terminals/terminals-admin.service')
  const agentService = new TerminalAgentService(prisma, audit, { validateTerminalToken: async () => undefined } as never)
  const adminService = new TerminalAdminService(
    prisma,
    agentService,
    {} as never,
    { toAdminObservation: () => null } as never,
  )

  await prisma.terminal.create({
    data: {
      id: TERM,
      terminalCode: 'PC-01',
      displayName: '完成判据测试机',
      agentToken: 'agent-print-completion',
      deviceFingerprint: 'fp-print-completion',
      credentialGeneration: 0,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })

  await agentService.heartbeat(TERM, await accept({ status: 'online', printCompletionEvidence: 'unavailable' }), 'Bearer redacted')
  const unavailable = await prisma.terminalHeartbeat.findFirst({
    where: { terminalId: TERM },
    orderBy: { createdAt: 'desc' },
  })
  assert.equal(unavailable?.printCompletionEvidence, 'unavailable')

  await agentService.heartbeat(TERM, await accept({ status: 'online' }), 'Bearer redacted')
  const omittedRow = await prisma.terminalHeartbeat.findFirst({
    where: { terminalId: TERM },
    orderBy: { createdAt: 'desc' },
  })
  assert.equal(omittedRow?.printCompletionEvidence, null)
  assert.notEqual(omittedRow?.id, unavailable?.id)
  const listed = await adminService.listTerminalsForAdmin()
  const view = listed.terminals.find((item) => item.id === TERM)
  assert.equal(view?.printCompletionEvidence, null)
  assert.equal(printCompletionEvidenceLabel(view?.printCompletionEvidence), '打印完成判据未上报')

  await agentService.heartbeat(TERM, await accept({ status: 'online', printCompletionEvidence: 'available' }), 'Bearer redacted')
  const again = await adminService.listTerminalsForAdmin()
  assert.equal(again.terminals.find((item) => item.id === TERM)?.printCompletionEvidence, 'available')
  console.log('PASS 心跳把打印完成判据写入终端状态；老终端不带字段时记为未上报')
  await prisma.onModuleDestroy()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
