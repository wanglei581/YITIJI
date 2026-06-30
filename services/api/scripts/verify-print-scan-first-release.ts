import fs from 'fs'
import path from 'path'

const root = process.cwd()
let failed = 0

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function mustContain(source: string, needles: string[], message: string): void {
  const missing = needles.filter((needle) => !source.includes(needle))
  if (missing.length === 0) pass(message)
  else fail(`${message}，缺少: ${missing.join(' | ')}`)
}

function mustNotContain(source: string, needles: string[], message: string): void {
  const found = needles.filter((needle) => source.includes(needle))
  if (found.length === 0) pass(message)
  else fail(`${message}，不应包含: ${found.join(' | ')}`)
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  if (startIndex < 0) return ''
  const endIndex = source.indexOf(end, startIndex + start.length)
  return endIndex < 0 ? source.slice(startIndex) : source.slice(startIndex, endIndex)
}

function main(): void {
  console.log('\n=== print-scan first-release safety verification ===')

  const printJobsService = read('src/print-jobs/print-jobs.service.ts')
  const printJobsController = read('src/print-jobs/print-jobs.controller.ts')
  const terminalsService = read('src/terminals/terminals.service.ts')
  const printJobsApi = read('../../apps/kiosk/src/services/print/printJobsApi.ts')

  mustContain(
    printJobsController,
    ["@Headers('x-terminal-id')", 'terminalId: terminalId ?? null'],
    'Kiosk create print job request must pass X-Terminal-Id into PrintJobsService',
  )

  mustContain(
    printJobsApi,
    ["'X-Terminal-Id': terminalId", 'VITE_TERMINAL_ID', 'missing terminal id'],
    'Kiosk print API must send configured terminal id and fail closed when missing',
  )

  mustContain(
    printJobsService,
    ['terminalId?: string | null', 'PRINT_TERMINAL_REQUIRED', 'terminalId: targetTerminalId'],
    'PrintJobsService.create must require and persist target terminalId',
  )

  const claimBlock = section(terminalsService, 'async claimTasks', '// ── 4. Patch task status')
  mustContain(
    claimBlock,
    ["where: { status: 'pending', terminalId }", "where: { id: task.id, status: 'pending', terminalId }"],
    'claim must filter pending tasks by terminalId',
  )
  mustNotContain(
    claimBlock,
    ["data: {\n            status: 'claimed',\n            terminalId,"],
    'claim must not overwrite target terminalId as claimedBy',
  )

  const statusBlock = section(terminalsService, 'async patchTaskStatus', 'async validateTerminalToken')
  mustContain(
    statusBlock,
    ['TASK_TERMINAL_MISSING', 'TASK_NOT_OWNED', 'await this.findAndValidate(terminalIdHeader, authHeader)'],
    'status patch must reject legacy unbound tasks and wrong terminal updates',
  )

  const resetBlock = section(terminalsService, 'private async resetExpiredClaims', 'private async seedPrintTask')
  mustNotContain(
    resetBlock,
    ['terminalId: null'],
    'expired claim reset must preserve target terminalId for same-terminal retry',
  )
  mustContain(
    resetBlock,
    ["status: 'claimed'", 'claimExpiry: { lt: now }', "status: 'pending'"],
    'claim TTL reset must keep lease recovery behavior',
  )

  if (failed > 0) {
    console.error(`\nverify-print-scan-first-release failed: ${failed} issue(s)`)
    process.exit(1)
  }

  console.log('\n✅ ALL PASS — print-scan first-release safety invariants hold')
}

main()
