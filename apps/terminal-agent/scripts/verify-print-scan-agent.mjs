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
  ],
  'instance lock must exclusive-create, fail-closed on unproven pid/publication, and never release a successor',
)

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

if (failed > 0) {
  console.error(`\nverify-print-scan-agent failed: ${failed} issue(s)`)
  process.exit(1)
}

console.log('\n✅ ALL PASS — terminal-agent print-scan safety invariants hold')
