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
  ['createServer(', 'server.listen', 'EADDRINUSE', 'ECONNREFUSED', 'agent.pid', 'machine_identity_unavailable', 'writeStartupDiagnosticSafely'],
  'instance lock must use process-lifetime named pipe / Unix socket and fail closed',
)

mustNotContain(
  instanceLock,
  ['stale_lock_requires_operator', 'renameSync', 'tasklist'],
  'instance lock must not use PID stale-lock takeover or path rename',
)

mustContain(
  tempCleanup,
  ['lstatSync', 'task_[A-Za-z0-9_-]', 'PRINT_IMAGE_TEMP_PDF_NAME', 'PrintTaskTempCleanupError'],
  'print-task temp cleanup must lstat eligible task_* and print_ image temps and fail closed on removal errors',
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
    ['新进程可以接管', '崩溃后 PID 失效', 'stale_lock_requires_operator'],
    'onsite recovery runsheet must not claim crash auto-takeover of the instance lock',
  )
  mustNotContain(
    hostRunbook,
    ['崩溃自动重启（失败操作：30s→60s→120s'],
    'host acceptance runbook must not treat SCM 30s restart as proven lock recovery',
  )
  mustContain(
    recoveryRunsheet,
    ['进程退出后由操作系统释放', 'agent.pid', 'DEVICE', 'NO-GO'],
    'onsite recovery runsheet must describe fail-closed lock recovery and remaining DEVICE NO-GO',
  )
  mustContain(
    fieldRunbook,
    ['进程退出后由操作系统释放', 'agent.pid'],
    'print-scan field runbook must require diagnosis before any operator lock removal',
  )
  mustContain(
    hostRunbook,
    ['进程退出后由操作系统释放', 'agent.pid', 'NO-GO'],
    'host acceptance runbook must keep lock recovery fail-closed and DEVICE unproven',
  )
}

if (failed > 0) {
  console.error(`\nverify-print-scan-agent failed: ${failed} issue(s)`)
  process.exit(1)
}

console.log('\n✅ ALL PASS — terminal-agent print-scan safety invariants hold')
