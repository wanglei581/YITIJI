/**
 * Gate 0.4 Wave B — Agent unauthorized latch (static + behavioral).
 * No network. Never asserts on token values.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
const configManager = read('src/agent/config-manager.ts')
const diagnose = read('scripts/diagnose-production-agent.ps1')
const recoveryVerify = read('scripts/verify-windows-service-recovery.mjs')

assert.match(authState, /export function isUnauthorized/, 'auth-state must export isUnauthorized')
assert.match(authState, /export function markUnauthorized/, 'auth-state must export markUnauthorized')
assert.match(authState, /export function clearUnauthorized/, 'auth-state must export clearUnauthorized')
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

assert.match(offlineQueue, /isUnauthorized\(\)/, 'offline-queue must skip retries when latched')
assert.match(offlineQueue, /markUnauthorized/, 'offline-queue must latch on 401')
assert.match(
  offlineQueue,
  /isUnauthorizedHttpError/,
  'offline-queue must classify 401 before generic 4xx abandon',
)

assert.match(configManager, /AGENT_UNAUTHORIZED/, 'startup error codes must include AGENT_UNAUTHORIZED')
assert.match(configManager, /clearUnauthorized/, 'successful persistRegistration must clear the latch')
assert.match(diagnose, /AGENT_UNAUTHORIZED/, 'diagnose whitelist must include AGENT_UNAUTHORIZED')
assert.match(recoveryVerify, /AGENT_UNAUTHORIZED/, 'service-recovery verify whitelist must include AGENT_UNAUTHORIZED')

console.log('  PASS static wiring')

const require = createRequire(path.join(agentRoot, 'package.json'))
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', esModuleInterop: true },
})

const auth = require(path.join(agentRoot, 'src/agent/auth-state.ts'))
const { isUnauthorizedHttpError } = require(path.join(agentRoot, 'src/agent/api-client.ts'))
const axios = require('axios')

auth.__resetUnauthorizedForTests()
assert.equal(auth.isUnauthorized(), false, 'latch starts clear')
auth.markUnauthorized()
assert.equal(auth.isUnauthorized(), true, 'latch sets')
auth.markUnauthorized()
assert.equal(auth.isUnauthorized(), true, 'latch stays sticky')
auth.clearUnauthorized()
assert.equal(auth.isUnauthorized(), false, 'clear resets latch')

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

console.log('  PASS behavioral latch + 401 classifier')
console.log('\n✅ ALL PASS — Gate 0.4 Wave B unauthorized invariants hold')
