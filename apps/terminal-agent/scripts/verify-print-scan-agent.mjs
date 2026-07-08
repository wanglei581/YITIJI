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

console.log('\n=== terminal-agent print-scan safety verification ===')

const db = read('src/agent/db.ts')
const taskRunner = read('src/agent/task-runner.ts')
const heartbeat = read('src/agent/heartbeat.ts')
const types = read('src/agent/types.ts')
const index = read('src/index.ts')
const wmi = read('src/agent/wmi.ts')
const printerTypes = read('src/printer/types.ts')

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
  taskRunner,
  [
    'TEMP_FILE_TTL_MS = 60 * 60 * 1000',
    "fileName.startsWith('task_')",
    "fileName.startsWith('print_') && fileName.endsWith('.pdf')",
    'cleanupStaleTempFiles()',
    'maybeCleanupStaleTempFiles()',
    'fs.unlinkSync(filePath)',
  ],
  'task runner must TTL-clean stale task downloads and image conversion PDFs after crashes',
)

mustContain(
  taskRunner,
  [
    'finally',
    'fs.existsSync(tempFilePath)',
    'fs.unlinkSync(tempFilePath)',
    'temp file deleted',
  ],
  'task runner must delete downloaded task temp file in finally after completion or failure',
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
  taskRunner,
  [
    "localStatus === 'spooled'",
    "'PRINT_JOB_UNCONFIRMED'",
    "patch('failed', 'PRINT_JOB_UNCONFIRMED'",
    'enqueuePatch(db, task.taskId, { status: \'failed\', errorCode: \'PRINT_JOB_UNCONFIRMED\'',
  ],
  'spooled restart recovery must not report completed; it must fail unconfirmed and queue retry if offline',
)

mustContain(
  taskRunner,
  [
    'let seenRetainedOnce = false',
    "case 'retained'",
    'seenRetainedOnce = true',
    'if (seenRetainedOnce)',
    "errorCode: 'PRINT_JOB_UNCONFIRMED'",
    "rawStatus: 'Printing, Retained (timeout)'",
  ],
  'Pantum retained timeout must be treated as unconfirmed instead of completed',
)

mustContain(
  wmi,
  [
    "'retained'",
    "flags.includes('retained')",
    'Do NOT map to \'completed\' or \'paper_empty\' here',
  ],
  'WMI monitor must keep Retained as an indeterminate state',
)

mustContain(
  printerTypes,
  ["'PRINT_JOB_UNCONFIRMED'"],
  'terminal-agent print error codes must include PRINT_JOB_UNCONFIRMED',
)

if (failed > 0) {
  console.error(`\nverify-print-scan-agent failed: ${failed} issue(s)`)
  process.exit(1)
}

console.log('\n✅ ALL PASS — terminal-agent print-scan safety invariants hold')
