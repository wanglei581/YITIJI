/**
 * Gate 0.4 Wave B — Agent unauthorized latch (static + behavioral).
 * No network. Never asserts on token values.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(agentRoot, rel), 'utf8')
}

console.log('\n=== Gate 0.4 Wave B: agent unauthorized latch ===')

const authState = read('src/agent/auth-state.ts')
const apiClient = read('src/agent/api-client.ts')
const heartbeat = read('src/agent/heartbeat.ts')
const taskRunner = read('src/agent/task-runner.ts')
const offlineQueue = read('src/agent/offline-queue.ts')
const scanWatcher = read('src/agent/scan-watcher.ts')
const configManager = read('src/agent/config-manager.ts')
const entrypoint = read('src/index.ts')
const installer = read('scripts/install-production-agent.ps1')
const diagnose = read('scripts/diagnose-production-agent.ps1')
const recoveryVerify = read('scripts/verify-windows-service-recovery.mjs')

assert.match(authState, /export function isUnauthorized/, 'auth-state must export isUnauthorized')
assert.match(authState, /export function markUnauthorized/, 'auth-state must export markUnauthorized')
assert.match(authState, /export function clearUnauthorized/, 'auth-state must export clearUnauthorized')
assert.match(authState, /agent\.unauthorized/, 'auth-state must persist a credential-free unauthorized marker')
assert.match(authState, /let unauthorized = readPersistedUnauthorized\(\)/, 'latch must reload its marker at process start')
assert.doesNotMatch(authState, /agentToken|Bearer |Authorization/i, 'auth-state must not mention tokens')

assert.match(apiClient, /export function isUnauthorizedHttpError/, 'api-client must classify 401')
assert.match(apiClient, /status\s*===\s*401/, 'api-client 401 classifier must check status===401')

assert.match(heartbeat, /isUnauthorizedHttpError/, 'heartbeat must detect unauthorized HTTP errors')
assert.match(heartbeat, /markUnauthorized/, 'heartbeat must latch on 401')
assert.match(heartbeat, /writeStartupDiagnosticSafely\('AGENT_UNAUTHORIZED'\)/, 'heartbeat must write AGENT_UNAUTHORIZED diagnostic')
assert.match(heartbeat, /isUnauthorized\(\)/, 'heartbeat must skip when latched')

assert.match(taskRunner, /isUnauthorized\(\)/, 'task-runner must skip claim when latched')
assert.match(taskRunner, /markUnauthorized/, 'task-runner must latch on claim 401')
assert.match(taskRunner, /isUnauthorizedHttpError/, 'task-runner must classify claim 401')
assert.match(taskRunner, /export async function patchStatus/, 'status PATCH must be behavior-testable')
assert.match(taskRunner, /shouldAbortBeforePrint/, 'task-runner must gate the physical print call')

assert.match(offlineQueue, /isUnauthorized\(\)/, 'offline-queue must skip retries when latched')
assert.match(offlineQueue, /markUnauthorized/, 'offline-queue must latch on 401')
assert.match(
  offlineQueue,
  /isUnauthorizedHttpError/,
  'offline-queue must classify 401 before generic 4xx abandon',
)
assert.match(offlineQueue, /retained for retry after re-bind/, 'offline 401 must retain the pending patch')
const offlineUnauthorizedBranch = offlineQueue.match(
  /if \(isUnauthorizedHttpError\(e\)\) \{([\s\S]*?)\n    \}/,
)?.[1]
assert.ok(offlineUnauthorizedBranch, 'offline queue must have an explicit 401 branch')
assert.doesNotMatch(
  offlineUnauthorizedBranch,
  /markPatchAttempt/,
  'offline 401 must not abandon the pending patch',
)

assert.match(scanWatcher, /preserveScanFileForUnauthorized/, 'scan delivery must preserve files on 401')
assert.match(scanWatcher, /if \(isUnauthorized\(\)\) return/, 'scan delivery must pause while latched')

assert.match(configManager, /AGENT_UNAUTHORIZED/, 'startup error codes must include AGENT_UNAUTHORIZED')
assert.match(configManager, /clearUnauthorized/, 'successful persistRegistration must clear the latch')
assert.ok(
  configManager.indexOf('saveConfig(updated)') < configManager.indexOf('clearUnauthorized()'),
  'persistRegistration must clear only after config persistence succeeds',
)
assert.ok(
  entrypoint.indexOf('await sendHeartbeat(heartbeatOptions)') < entrypoint.indexOf("writeStartupDiagnosticSafely('AGENT_READY'"),
  'startup must not report ready before an authenticated heartbeat',
)
assert.match(installer, /\$unauthorizedMarkerPath/, 'installer must know the persistent latch marker')
assert.match(
  installer,
  /if \(\$null -ne \$tokenToPersist\)[\s\S]+Remove-Item -LiteralPath \$unauthorizedMarkerPath/,
  'successful BindCode credential replacement must clear the persistent latch',
)
assert.match(diagnose, /AGENT_UNAUTHORIZED/, 'diagnose whitelist must include AGENT_UNAUTHORIZED')
assert.match(recoveryVerify, /AGENT_UNAUTHORIZED/, 'service-recovery verify whitelist must include AGENT_UNAUTHORIZED')

console.log('  PASS static wiring')

const require = createRequire(path.join(agentRoot, 'package.json'))
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', esModuleInterop: true },
})

const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-unauthorized-verify-'))
process.env.PROGRAMDATA = verifyRoot

try {
  const auth = require(path.join(agentRoot, 'src/agent/auth-state.ts'))
  const { isUnauthorizedHttpError } = require(path.join(agentRoot, 'src/agent/api-client.ts'))
  const taskRunnerModule = require(path.join(agentRoot, 'src/agent/task-runner.ts'))
  const offlineQueueModule = require(path.join(agentRoot, 'src/agent/offline-queue.ts'))
  const scanWatcherModule = require(path.join(agentRoot, 'src/agent/scan-watcher.ts'))
  const axios = require('axios')

  const markerPath = path.join(verifyRoot, 'AIJobPrintAgent', 'agent.unauthorized')
  auth.__setUnauthorizedMarkerPathForTests(markerPath)
  auth.__resetUnauthorizedForTests(true)
  assert.equal(auth.isUnauthorized(), false, 'latch starts clear')
  auth.markUnauthorized()
  assert.equal(auth.isUnauthorized(), true, 'latch sets')
  assert.equal(fs.existsSync(markerPath), true, '401 latch persists a local marker')
  auth.__setUnauthorizedMarkerPathForTests(markerPath)
  assert.equal(auth.isUnauthorized(), true, 'fresh-process reload stays fail-closed')
  auth.clearUnauthorized()
  assert.equal(auth.isUnauthorized(), false, 'successful replacement clear resets latch')
  assert.equal(fs.existsSync(markerPath), false, 'successful replacement removes marker')

  const fake401 = new axios.AxiosError('unauthorized')
  fake401.response = {
    status: 401,
    data: { error: { code: 'AUTH_TOKEN_INVALID' } },
    statusText: 'Unauthorized',
    headers: {},
    config: {},
  }
  assert.equal(isUnauthorizedHttpError(fake401), true, 'AxiosError 401 must classify as unauthorized')

  const fake403 = new axios.AxiosError('forbidden')
  fake403.response = { status: 403, data: {}, statusText: 'Forbidden', headers: {}, config: {} }
  assert.equal(isUnauthorizedHttpError(fake403), false, '403 must not latch as unauthorized')
  assert.equal(isUnauthorizedHttpError(new Error('nope')), false, 'generic errors are not unauthorized')

  auth.__resetUnauthorizedForTests(true)
  const printingAck = await taskRunnerModule.patchStatus(
    'verify-printing-401',
    { status: 'printing' },
    'https://invalid.example/api/v1',
    'not-a-real-token',
    'verify-terminal',
    async () => { throw fake401 },
  )
  assert.equal(printingAck, false, 'printing PATCH 401 is not acknowledged')
  assert.equal(auth.isUnauthorized(), true, 'printing PATCH 401 latches')
  assert.equal(taskRunnerModule.shouldAbortBeforePrint(), true, 'printing PATCH 401 aborts before print()')

  auth.__resetUnauthorizedForTests(true)
  const dbCalls = []
  const failIfMutatedDb = {
    prepare(sql) {
      dbCalls.push(sql)
      throw new Error('offline 401 must not mutate pending_patches')
    },
  }
  const pendingPatch = {
    id: 7,
    taskId: 'verify-offline-401',
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    attempts: 3,
    nextRetryAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
  }
  const offlineOutcome = await offlineQueueModule.processPatch(
    pendingPatch,
    {
      apiBaseUrl: 'https://invalid.example/api/v1',
      terminalId: 'verify-terminal',
      terminalCode: 'VERIFY-001',
      agentToken: 'not-a-real-token',
    },
    failIfMutatedDb,
    async () => { throw fake401 },
  )
  assert.equal(offlineOutcome, 'paused_unauthorized', 'offline 401 pauses the queue')
  assert.deepEqual(dbCalls, [], 'offline 401 neither deletes nor increments the patch')
  assert.equal(pendingPatch.attempts, 3, 'offline 401 preserves attempts')

  auth.__resetUnauthorizedForTests(true)
  const scanFolder = path.join(verifyRoot, 'scan')
  fs.mkdirSync(scanFolder, { recursive: true })
  const scanPath = path.join(scanFolder, 'verify-scan.pdf')
  fs.writeFileSync(scanPath, 'verify scan payload')
  await scanWatcherModule.processCandidate(
    scanPath,
    path.basename(scanPath),
    {
      apiBaseUrl: 'https://invalid.example/api/v1',
      terminalId: 'verify-terminal',
      terminalCode: 'VERIFY-001',
      agentToken: 'not-a-real-token',
      scanWatchFolder: scanFolder,
    },
    async () => { throw fake401 },
  )
  assert.equal(auth.isUnauthorized(), true, 'scan delivery 401 latches')
  assert.equal(fs.existsSync(scanPath), true, 'scan delivery 401 preserves the source file')

  console.log('  PASS persistent latch + printing/offline/scan 401 behavior')
} finally {
  fs.rmSync(verifyRoot, { recursive: true, force: true })
}
console.log('\n✅ ALL PASS — Gate 0.4 Wave B unauthorized invariants hold')
