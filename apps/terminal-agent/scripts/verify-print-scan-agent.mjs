import fs from 'fs'
import path from 'path'

const root = process.cwd()
let failed = 0

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function mustContain(source, needles, message) {
  const missing = needles.filter((needle) => !source.includes(needle))
  if (missing.length === 0) pass(message)
  else fail(`${message}, missing: ${missing.join(' | ')}`)
}

function mustNotContain(source, needles, message) {
  const present = needles.filter((needle) => source.includes(needle))
  if (present.length === 0) pass(message)
  else fail(`${message}, unexpectedly present: ${present.join(' | ')}`)
}

console.log('\n=== terminal-agent print-scan safety verification ===')

const db = read('src/agent/db.ts')
const taskRunner = read('src/agent/task-runner.ts')
const heartbeat = read('src/agent/heartbeat.ts')
const types = read('src/agent/types.ts')
const index = read('src/index.ts')
const instanceLock = read('src/agent/instance-lock.ts')
const tempCleanup = read('src/agent/print-task-temp-cleanup.ts')

mustContain(
  db,
  ['local task database unavailable; printing disabled', 'isDatabaseAvailable'],
  'db open failure must expose fail-closed availability state and operator-facing log',
)

mustContain(
  taskRunner,
  ['isDatabaseAvailable', 'printing disabled', 'startTaskRunner'],
  'task runner must stop claim/print loop when local db is unavailable',
)

mustContain(
  heartbeat,
  ['localTaskDatabaseAvailable', 'agent_degraded'],
  'heartbeat must report degraded state when local task db is unavailable',
)

mustContain(
  types,
  ["'agent_degraded'", 'localTaskDatabaseAvailable'],
  'agent heartbeat types must include degraded local-db state',
)

mustContain(
  index,
  ['isDatabaseAvailable(db)', 'localTaskDatabaseAvailable'],
  'agent entrypoint must wire db availability into heartbeat',
)

mustContain(
  instanceLock,
  [
    "openSync(pidFile, 'wx'",
    'TASKLIST_FAIL_CLOSED',
    'SUCCESSOR_PID_GUARD',
    'OWNED_INODE_STILL_AT_PATH',
    'UNPROVEN_PID_FAIL_CLOSED',
    'STRICT_PID_PARSE',
    'PUBLICATION_FAIL_NO_UNLINK',
    'COMPLETE_PID_WRITE',
    'STALE_LOCK_REQUIRES_OPERATOR',
    'writeStartupDiagnosticSafely',
    '不要先删除',
    'diagnose-production-agent.ps1',
    'failClosedOnLock',
  ],
  'instance lock must exclusive-create, fail-closed on unproven/foreign-stale pid, and never release a successor',
)

mustNotContain(
  instanceLock,
  ['If this is incorrect, delete'],
  'duplicate/unavailable lock errors must not induce deleting the lock first',
)

{
  const failClosed = instanceLock.indexOf('function failClosedOnLock')
  const writeDiag = instanceLock.indexOf('writeStartupDiagnosticSafely', failClosed)
  const exitCall = instanceLock.indexOf('process.exit(1)', failClosed)
  if (failClosed >= 0 && writeDiag > failClosed && exitCall > writeDiag) {
    pass('lock fail-closed must write startup diagnostic before exiting')
  } else {
    fail('lock fail-closed must write startup diagnostic before exiting')
  }
}

mustContain(
  tempCleanup,
  ['lstatSync', 'task_[A-Za-z0-9_-]', 'PrintTaskTempCleanupError'],
  'print-task temp cleanup must lstat eligible task_* files and fail closed on removal errors',
)

if (/\bstatSync\s*\(/.test(tempCleanup)) {
  fail('print-task temp cleanup must not follow symlinks via statSync')
} else {
  pass('print-task temp cleanup must not follow symlinks via statSync')
}

mustNotContain(
  taskRunner,
  ['cleanupCrashLeftoverPrintTaskTemps'],
  'claim/print loop must not sweep temp files (would delete in-flight downloads)',
)

{
  const acquire = index.indexOf('acquireLock()')
  const cleanup = index.indexOf('cleanupCrashLeftoverPrintTaskTemps()')
  const runner = index.indexOf('startTaskRunner(')
  if (acquire >= 0 && cleanup > acquire && runner > cleanup) {
    pass('startup must acquire lock, then clean leftovers, then start claim/print')
  } else {
    fail('startup order must be acquireLock → leftover cleanup → startTaskRunner')
  }
}

{
  const recoveryRunsheet = read('../../docs/device/onsite-failure-recovery-runsheet-2026-09.md')
  const hostRunbook = read('../../docs/device/windows-host-acceptance-runbook.md')
  const fieldRunbook = read('../../docs/acceptance/print-scan-field-execution-runbook.md')
  mustNotContain(
    recoveryRunsheet,
    ['新进程可以接管', '崩溃后 PID 失效'],
    'onsite recovery runsheet must not claim crash auto-takeover of the instance lock',
  )
  mustNotContain(
    hostRunbook,
    ['崩溃自动重启（失败操作：30s→60s→120s'],
    'host acceptance runbook must not treat SCM 30s restart as proven lock recovery',
  )
  mustContain(
    recoveryRunsheet,
    ['不要先删除', 'stale_lock_requires_operator', 'DEVICE', 'NO-GO', 'diagnose-production-agent.ps1'],
    'onsite recovery runsheet must describe fail-closed lock recovery and remaining DEVICE NO-GO',
  )
  mustContain(
    fieldRunbook,
    ['不要先删除', 'diagnose-production-agent.ps1', 'stale_lock_requires_operator'],
    'print-scan field runbook must require diagnosis before any operator lock removal',
  )
  mustContain(
    hostRunbook,
    ['不要先删除', 'stale_lock_requires_operator', 'NO-GO'],
    'host acceptance runbook must keep lock recovery fail-closed and DEVICE unproven',
  )
}

if (failed > 0) {
  console.error(`\nverify-print-scan-agent failed: ${failed} issue(s)`)
  process.exit(1)
}

console.log('\n✅ ALL PASS — terminal-agent print-scan safety invariants hold')
