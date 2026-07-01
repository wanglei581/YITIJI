import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failures = 0

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  console.error(`  FAIL ${message}`)
  failures += 1
}

function contains(source, markers, message) {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length) fail(`${message}, missing: ${missing.join(' | ')}`)
  else pass(message)
}

console.log('\n=== terminal-agent print-scan safety verification ===')

const db = read('src/agent/db.ts')
const taskRunner = read('src/agent/task-runner.ts')
const heartbeat = read('src/agent/heartbeat.ts')
const types = read('src/agent/types.ts')
const index = read('src/index.ts')

contains(
  db,
  ['local task database unavailable; printing disabled', 'isDatabaseAvailable'],
  'db open failure must expose fail-closed availability state and operator-facing log',
)

contains(
  db,
  ['databaseRuntimeAvailable = false', 'logDatabaseRuntimeError', 'return true', 'markTaskDone', 'enqueuePatch', 'getPendingPatches', 'markPatchAttempt'],
  'db runtime operation failures must be caught instead of crashing the agent',
)

contains(
  taskRunner,
  ['isDatabaseAvailable', 'printing disabled', 'startTaskRunner'],
  'task runner must stop claim/print loop when local db is unavailable',
)

contains(
  heartbeat,
  ['localTaskDatabaseAvailable?: boolean | (() => boolean)', 'agent_degraded'],
  'heartbeat must report degraded state when local task db is unavailable',
)

contains(
  types,
  ["'agent_degraded'", 'localTaskDatabaseAvailable'],
  'agent heartbeat types must include degraded local-db state',
)

contains(
  index,
  ['() => isDatabaseAvailable(db)', 'localTaskDatabaseAvailable'],
  'agent entrypoint must wire db availability into heartbeat',
)

if (failures > 0) {
  console.error(`\nverify-print-scan-agent failed: ${failures} issue(s)`)
  process.exit(1)
}

console.log('\nALL PASS: terminal-agent print-scan safety verification')
