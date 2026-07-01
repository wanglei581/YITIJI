/**
 * 打印扫描首期安全底座静态门禁。
 *
 * 只验证 Task 1 的安全不变量，不做扫描/证件照/U 盘功能实现验收。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:print-scan-first-release
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  console.error(`  FAIL ${message}`)
  failures += 1
}

function contains(source: string, markers: string[], message: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length) fail(`${message}，缺少: ${missing.join(' | ')}`)
  else pass(message)
}

function notContains(source: string, markers: string[], message: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length) fail(`${message}，不应包含: ${found.join(' | ')}`)
  else pass(message)
}

function section(source: string, start: string, end: string): string {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  if (a < 0 || b < 0) {
    fail(`无法定位区块: ${start} -> ${end}`)
    return ''
  }
  return source.slice(a, b)
}

console.log('\n=== print-scan first-release safety verification ===')

const printJobsService = read('src/print-jobs/print-jobs.service.ts')
const printJobsController = read('src/print-jobs/print-jobs.controller.ts')
const terminalsService = read('src/terminals/terminals.service.ts')

contains(
  printJobsController,
  ["@Headers('x-terminal-id')", 'terminalId: terminalId ?? null'],
  'Kiosk create print job request must pass X-Terminal-Id into PrintJobsService',
)

contains(
  printJobsService,
  ['terminalId?: string | null', 'PRINT_TERMINAL_REQUIRED', 'resolveTargetTerminalId(ctx.terminalId)', 'terminalId: targetTerminalId'],
  'PrintJobsService.create must require and persist target terminalId',
)

const claimBlock = section(terminalsService, 'async claimTasks', '// ── 4. Patch task status')
contains(
  claimBlock,
  ["where: { status: 'pending', terminalId }", "where: { id: task.id, status: 'pending', terminalId }"],
  'claim must filter pending tasks by terminalId',
)
notContains(
  claimBlock,
  ["terminalId,\n            claimedAt"],
  'claim must not overwrite target terminalId as claimedBy',
)

const statusBlock = section(terminalsService, 'async patchTaskStatus', 'async validateTerminalToken')
contains(
  statusBlock,
  ['TASK_TERMINAL_MISSING', 'TASK_NOT_OWNED'],
  'status patch must reject legacy unbound tasks and wrong terminal updates',
)

const resetBlock = section(terminalsService, 'private async resetExpiredClaims', 'private async seedPrintTask')
notContains(
  resetBlock,
  ['terminalId: null'],
  'expired claim reset must preserve target terminalId for same-terminal retry',
)
contains(
  resetBlock,
  ["status: 'claimed'", 'claimExpiry: { lt: now }', "status: 'pending'"],
  'claim TTL reset must keep lease recovery behavior',
)

const moduleInitBlock = section(terminalsService, 'async onModuleInit', '// ── 1. Register')
contains(
  moduleInitBlock,
  ['shouldSeedPrintTask()', 'await this.seedPrintTask()'],
  'module init must gate seed print task through explicit helper',
)
notContains(
  moduleInitBlock,
  ["process.env['NODE_ENV'] !== 'production'", 'NODE_ENV"] !== \'production\''],
  'module init must not seed every non-production environment',
)

const seedGateBlock = section(terminalsService, 'function shouldSeedPrintTask', '// ── PrintJobParams')
contains(
  seedGateBlock,
  ['ENABLE_PRINT_SEED_TASK', "explicit === 'true'", "explicit === 'false'", "nodeEnv === 'development'", "nodeEnv === 'test'"],
  'seed print task must be development/test only unless explicitly enabled',
)
notContains(
  seedGateBlock,
  ["process.env['NODE_ENV'] !== 'production'", "NODE_ENV'] !== 'production'"],
  'seed helper must not default every non-production environment to seed-enabled',
)

if (failures > 0) {
  console.error(`\nverify-print-scan-first-release failed: ${failures} issue(s)`)
  process.exit(1)
}

console.log('\nALL PASS: print-scan first-release safety verification')
