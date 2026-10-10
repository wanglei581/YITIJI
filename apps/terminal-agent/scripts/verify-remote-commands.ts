/**
 * 远程指令门禁。本地假后端，清空与退出都换成假实现。
 * 不建打印机，不碰 Windows 队列。反向改坏必须让本脚本非 0 退出。
 */
import { verifyRemoteCommandRework } from './remote-command-rework.helper'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { AgentConfig } from '../src/agent/types'
import { resetAgentStartedAtFallbackForTests, sendHeartbeat } from '../src/agent/heartbeat'
import {
  createRemoteCommandProcessor,
  postTerminalCommandAck,
} from '../src/agent/remote-commands'
import {
  claimPrintTasksIfGateOpen,
  holdPrintClaims,
  releasePrintClaims,
  remoteClaimHoldReason,
  __resetPrintDispatchGateForTests,
} from '../src/agent/print-dispatch-gate'
import {
  LIST_JOBS_SCRIPT,
  clearAllJobsOnConfiguredPrinter,
  parseAllPrintJobsOutput,
} from '../src/agent/print-queue-hold'
import { __resetInFlightPrintWorkForTests } from '../src/agent/task-runner'

const JOB = 'ZZJobTitleSecret9'
const PRINTER = 'ZZPrinterSecret9'
const ACCOUNT = 'ZZAccountSecret9'
const OTHER = 'ZZOtherPrinter9'
const TERMINAL_ID = 'term-remote-cmd'
const TOKEN = 'token-remote-cmd'
const NOW = new Date('2026-10-06T12:00:00.000Z')
const ISSUED = '2026-10-06T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'
const DOWNGRADE_LOG = 'heartbeat: server does not accept agentStartedAt, disabled'

const captured: string[] = []
const originalWrites = new Map<NodeJS.WriteStream, typeof process.stdout.write>()

function installCapture(): void {
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write
    originalWrites.set(stream, original)
    stream.write = function (
      this: NodeJS.WriteStream,
      chunk: string | Uint8Array,
      ...rest: unknown[]
    ): boolean {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return original.apply(this, [chunk, ...rest] as never)
    } as typeof stream.write
  }
}

function restoreCapture(): void {
  for (const [stream, original] of originalWrites) stream.write = original
  originalWrites.clear()
}

function logText(): string {
  return captured.join('')
}

interface HeartbeatRecord {
  body: Record<string, unknown>
  authorization: string | undefined
  terminalHeader: string | undefined
}

interface AckRecord {
  commandId: string
  body: Record<string, unknown>
}

export interface FakeServer {
  baseUrl: string
  heartbeats: HeartbeatRecord[]
  acks: AckRecord[]
  commands: unknown[] | null
  rejectStartedAt: boolean
  heartbeatStatus: number
  ackResult: unknown | undefined
  dropAcceptedResponse: boolean
  timeoutAcceptedResponse: boolean
  results: Map<string, unknown>
  ackStatus: number
  close: () => Promise<void>
}

function validationBody(): string {
  return JSON.stringify({
    success: false,
    error: {
      code: 'VALIDATION_FAILED',
      message: 'agentStartedAt: property agentStartedAt should not exist',
      details: ['agentStartedAt: property agentStartedAt should not exist'],
    },
  })
}

async function startServer(): Promise<FakeServer> {
  const api: FakeServer = {
    baseUrl: '',
    heartbeats: [],
    acks: [],
    commands: null,
    rejectStartedAt: false,
    heartbeatStatus: 200,
    ackStatus: 200,
    ackResult: undefined,
    dropAcceptedResponse: false,
    timeoutAcceptedResponse: false,
    results: new Map(),
    close: async () => undefined,
  }
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const url = req.url ?? ''
      const raw = Buffer.concat(chunks).toString('utf8')
      if (req.method === 'GET' && url.endsWith('/release-observation-plan')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ plan: null }))
        return
      }
      if (req.method === 'PUT' && url.endsWith('/heartbeat')) {
        const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
        api.heartbeats.push({
          body,
          authorization: req.headers.authorization,
          terminalHeader: req.headers['x-terminal-id'] as string | undefined,
        })
        if (api.rejectStartedAt && Object.prototype.hasOwnProperty.call(body, 'agentStartedAt')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(validationBody())
          return
        }
        if (api.heartbeatStatus !== 200) {
          res.writeHead(api.heartbeatStatus, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            error: { code: 'BAD_REQUEST', message: '请求内容有误，请检查后重试' },
          }))
          return
        }
        const payload: Record<string, unknown> = { acknowledged: true }
        if (api.commands) {
          payload.commands = api.commands.filter((row) => !api.results.has(String((row as Record<string, unknown>)?.id)))
          api.commands = null
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
        return
      }
      const ack = url.match(/\/commands\/([^/]+)\/ack$/)
      if (req.method === 'POST' && ack) {
        const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
        api.acks.push({ commandId: decodeURIComponent(ack[1] ?? ''), body })
        const id = decodeURIComponent(ack[1] ?? '')
        const result = api.results.has(id) ? api.results.get(id) : (api.ackResult === undefined ? body['result'] : api.ackResult)
        if (api.ackStatus === 200 && (api.dropAcceptedResponse || api.timeoutAcceptedResponse) && body['result'] === 'accepted') {
          api.results.set(id, 'accepted')
          const timeout = api.timeoutAcceptedResponse
          api.dropAcceptedResponse = false
          api.timeoutAcceptedResponse = false
          if (timeout) return // client closes after its injected timeout
          req.socket.destroy() // committed but response lost; no later heartbeat delivery
          return
        }
        if (api.ackStatus === 200 && ['accepted', 'rejected_busy', 'expired', 'done', 'failed'].includes(String(result))) api.results.set(id, result)
        res.writeHead(api.ackStatus, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(api.ackStatus === 200
          ? { success: true, data: { result } }
          : { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '服务器内部错误' } }))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'not found' } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  api.baseUrl = `http://127.0.0.1:${address.port}/api/v1`
  api.close = () => new Promise((resolve) => server.close(() => resolve()))
  return api
}

function configFor(baseUrl: string): AgentConfig {
  return {
    apiBaseUrl: baseUrl,
    terminalCode: 'T-REMOTE',
    printerName: PRINTER,
    agentVersion: '0.4.14',
    terminalId: TERMINAL_ID,
    agentToken: TOKEN,
    holdPrinterQueueWhenIdle: true,
  }
}

function command(
  id: string,
  type: 'restart_agent' | 'clear_print_queue',
  expiresAt: string,
): Record<string, unknown> {
  return {
    id,
    type,
    issuedAt: ISSUED,
    expiresAt,
    documentName: JOB,
    printerName: PRINTER,
    userName: ACCOUNT,
    otherPrinter: OTHER,
  }
}

function assertAckShape(body: Record<string, unknown>): void {
  const keys = Object.keys(body).sort()
  const allowed = keys.length === 1
    ? keys[0] === 'result'
    : keys.length === 2 && keys[0] === 'remainingJobs' && keys[1] === 'result'
  assert.equal(allowed, true, 'ack body has a key other than result and remainingJobs')
}

function resetRuntime(): void {
  resetAgentStartedAtFallbackForTests()
  __resetPrintDispatchGateForTests()
  __resetInFlightPrintWorkForTests()
}

interface Harness {
  exitCodes: number[]
  order: string[]
  busy: boolean
  busyCalls: number
  clearCalls: number
  printerNames: string[]
  removedIds: number[]
  claimedWhileHeld: boolean
  clearImpl: (printerName: string) => Promise<{ result: 'done' | 'failed'; remainingJobs: number }>
}

function harness(): Harness {
  return {
    exitCodes: [],
    order: [],
    busy: false,
    busyCalls: 0,
    clearCalls: 0,
    printerNames: [],
    removedIds: [],
    claimedWhileHeld: false,
    clearImpl: async () => ({ result: 'done', remainingJobs: 0 }),
  }
}

function processor(config: AgentConfig, state: Harness) {
  return createRemoteCommandProcessor({
    now: () => NOW,
    sleep: async () => undefined,
    requestServiceRestart: async () => false,
    isBusy: () => {
      state.busyCalls += 1
      return state.busy
    },
    ack: async (commandId, body) => {
      state.order.push(`ack:${body.result}`)
      if (body.result === 'accepted') {
        let claimed = false
        await claimPrintTasksIfGateOpen(
          { holdEnabled: false, pause: async () => undefined, cleanup: async () => undefined },
          async () => { claimed = true },
        )
        if (claimed) state.claimedWhileHeld = true
      }
      return postTerminalCommandAck(config, commandId, body)
    },
    exit: (code) => {
      state.order.push('exit')
      state.exitCodes.push(code)
    },
    holdPrinterQueueWhenIdle: true,
    pauseQueue: async () => {
      state.order.push('pause')
    },
    clearPrintQueue: async (printerName) => {
      state.clearCalls += 1
      state.printerNames.push(printerName)
      let claimed = false
      await claimPrintTasksIfGateOpen(
        { holdEnabled: false, pause: async () => undefined, cleanup: async () => undefined },
        async () => { claimed = true },
      )
      if (claimed) state.claimedWhileHeld = true
      return state.clearImpl(printerName)
    },
    holdClaims: holdPrintClaims,
    releaseClaims: releasePrintClaims,
    printerName: config.printerName,
  })
}

async function beat(
  server: FakeServer,
  config: AgentConfig,
  handle: (commands: unknown, context: { agentStartedAtSent: boolean }) => Promise<void>,
  commands?: unknown[],
): Promise<boolean> {
  server.commands = commands ?? null
  return sendHeartbeat({ config, onRemoteCommands: handle })
}

function startedAtOf(record: HeartbeatRecord): string | undefined {
  const value = record.body['agentStartedAt']
  return typeof value === 'string' ? value : undefined
}

function assertSources(): void {
  const root = join(__dirname, '../../..')
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  const windows = readFileSync(join(root, '.github/workflows/windows-agent-installer.yml'), 'utf8')
  assert.ok(ci.includes('pnpm run verify:remote-commands\n'), 'ci.yml must run verify:remote-commands')
  assert.ok(windows.includes('verify:remote-commands-windows'), 'windows workflow must run the spooler gate')
  const index = readFileSync(join(__dirname, '../src/index.ts'), 'utf8')
  assert.match(index, /onRemoteCommands:\s*createProductionRemoteCommandHandler\(config\)/)
  const remote = readFileSync(join(__dirname, '../src/agent/remote-commands.ts'), 'utf8')
  assert.match(remote, /isBusy:\s*\(\)\s*=>\s*hasInFlightPrintWork\(\)\s*\|\|\s*isScanDeliveryInFlight\(\)/)
  const factory = remote.slice(remote.indexOf('export function createProductionRemoteCommandHandler'))
  assert.doesNotMatch(factory, /getActiveDatabase/)
  assert.match(factory, /clearAllJobsOnConfiguredPrinter\(printerName/)
  assert.match(factory, /printerName:\s*config\.printerName/)
  const restart = remote.slice(remote.indexOf('const acceptRestart'), remote.indexOf('const clearQueue'))
  assert.match(restart, /result:\s*'accepted'/)
  assert.doesNotMatch(restart, /result:\s*'done'/)
  assert.match(restart, /requestServiceRestart/)
  const scan = readFileSync(join(__dirname, '../src/agent/scan-watcher.ts'), 'utf8')
  assert.match(scan, /export function isScanDeliveryInFlight\(\): boolean \{\n  return inFlightPaths\.size > 0\n\}/)
  const hold = readFileSync(join(__dirname, '../src/agent/print-queue-hold.ts'), 'utf8')
  const allAt = LIST_JOBS_SCRIPT.indexOf("if ($scope -eq 'all')")
  const elseAt = LIST_JOBS_SCRIPT.indexOf('} else {', allAt)
  assert.ok(allAt > 0 && elseAt > allAt, 'list script must keep an all-jobs branch')
  const branch = LIST_JOBS_SCRIPT.slice(allAt, elseAt)
  assert.equal(branch.includes('Resolve-PrintJobUserSid'), false, 'all-jobs branch must not resolve a SID')
  assert.equal(branch.includes('Equals'), false, 'all-jobs branch must not compare a SID')
  assert.equal(branch.includes('$currentSid'), false, 'all-jobs branch must not read the current SID')
  assert.equal(/\bcontinue\b/.test(branch), false, 'all-jobs branch must not skip a job')
  const listFn = hold.slice(
    hold.indexOf('export async function listAllConfiguredPrintJobs'),
    hold.indexOf('export interface ClearAllPrintJobsOptions'),
  )
  assert.match(listFn, /scope:\s*'all'/)
  const clearFn = hold.slice(
    hold.indexOf('export async function clearAllJobsOnConfiguredPrinter'),
    hold.indexOf('export function printJobUserSidCommand'),
  )
  assert.match(clearFn, /remove\(printerName,\s*before\.ids\)/)
  assert.doesNotMatch(clearFn, /selectOwnPrintJobIds/)
  assert.doesNotMatch(clearFn, /ownedByCurrentProcess/)
}

function assertParserKeepsEveryJob(): void {
  const parsed = parseAllPrintJobsOutput(JSON.stringify({
    jobs: [
      { id: 7, owned: false, unreadable: false },
      { id: 8, owned: false, unreadable: true },
    ],
    unreadable: 1,
    total: 2,
  }))
  assert.deepEqual(parsed.ids, [7, 8])
  assert.equal(parsed.total, 2)
}

async function assertNonWindowsNoop(): Promise<void> {
  let listed = false
  const outcome = await clearAllJobsOnConfiguredPrinter(PRINTER, {
    platform: 'darwin',
    runList: async () => {
      listed = true
      return { total: 3, ids: [1, 2, 3] }
    },
  })
  assert.deepEqual(outcome, { result: 'done', remainingJobs: 0 })
  assert.equal(listed, false)
}

function assertHoldAlreadyCalled(calls: string[], label: string): void {
  const busyAt = calls.indexOf('isBusy')
  assert.ok(busyAt > 0, `${label}: isBusy must run after holdClaims, got ${calls.join(' > ')}`)
  assert.equal(
    calls.slice(0, busyAt).includes('holdClaims'),
    true,
    `${label}: holdClaims must already have run when isBusy is called, got ${calls.join(' > ')}`,
  )
}

async function assertHoldClaimsBeforeBusy(server: FakeServer, config: AgentConfig): Promise<void> {
  resetRuntime()
  server.acks.length = 0
  const calls: string[] = []
  let busy = false
  const handle = createRemoteCommandProcessor({
    now: () => NOW,
    sleep: async () => undefined,
    requestServiceRestart: async () => false,
    isBusy: () => {
      calls.push('isBusy')
      return busy
    },
    ack: async (commandId, body) => {
      calls.push(`ack:${body.result}`)
      return postTerminalCommandAck(config, commandId, body)
    },
    exit: () => {
      calls.push('exit')
    },
    holdPrinterQueueWhenIdle: true,
    pauseQueue: async () => {
      calls.push('pause')
    },
    clearPrintQueue: async () => ({ result: 'done', remainingJobs: 0 }),
    holdClaims: (reason) => {
      calls.push('holdClaims')
      holdPrintClaims(reason)
    },
    releaseClaims: () => {
      calls.push('releaseClaims')
      releasePrintClaims()
    },
    printerName: config.printerName,
  })

  assert.equal(await beat(server, config, handle, [command('tcmd_orderclr', 'clear_print_queue', FUTURE)]), true)
  assertHoldAlreadyCalled(calls, 'clear')
  assert.equal(server.acks[0]?.body['result'], 'done')
  assert.equal(calls.includes('exit'), false)
  assert.equal(remoteClaimHoldReason(), null)

  busy = true
  calls.length = 0
  resetRuntime()
  server.acks.length = 0
  assert.equal(await beat(server, config, handle, [command('tcmd_orderbusy', 'restart_agent', FUTURE)]), true)
  assertHoldAlreadyCalled(calls, 'busy restart')
  assert.equal(server.acks[0]?.body['result'], 'rejected_busy')
  const busyAt = calls.indexOf('isBusy')
  const releaseAt = calls.indexOf('releaseClaims')
  const ackAt = calls.indexOf('ack:rejected_busy')
  assert.ok(releaseAt > busyAt, `busy restart must release after the busy check, got ${calls.join(' > ')}`)
  assert.ok(ackAt > releaseAt, `busy restart must ack after release, got ${calls.join(' > ')}`)
  assert.equal(calls.includes('exit'), false)
  assert.equal(calls.includes('pause'), false)
  assert.equal(remoteClaimHoldReason(), null)
}

function namesAreConfigured(names: string[]): void {
  assert.ok(names.length > 0, 'clear must be invoked')
  assert.equal(names.every((name) => name === PRINTER), true, 'clear touched a printer other than the configured one')
  assert.equal(names.includes(OTHER), false)
}

async function main(): Promise<void> {
  installCapture()
  try {
    assertSources()
    assertParserKeepsEveryJob()
    await assertNonWindowsNoop()
    const server = await startServer()
    const config = configFor(server.baseUrl)
    try {
      resetRuntime()
      assert.equal(await beat(server, config, async () => undefined), true)
      assert.equal(await beat(server, config, async () => undefined), true)
      assert.equal(server.heartbeats.length, 2)
      const first = startedAtOf(server.heartbeats[0]!)
      const second = startedAtOf(server.heartbeats[1]!)
      assert.equal(typeof first, 'string')
      assert.equal(first, second)
      assert.match(first ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      assert.equal(server.heartbeats[0]?.authorization, `Bearer ${TOKEN}`)
      assert.equal(server.heartbeats[0]?.terminalHeader, TERMINAL_ID)
      assert.equal(logText().includes(DOWNGRADE_LOG), false)

      server.heartbeats.length = 0
      server.rejectStartedAt = true
      resetRuntime()
      assert.equal(await beat(server, config, async () => undefined), true)
      assert.equal(server.heartbeats.length, 2)
      assert.equal(typeof startedAtOf(server.heartbeats[0]!), 'string')
      assert.equal(Object.prototype.hasOwnProperty.call(server.heartbeats[1]!.body, 'agentStartedAt'), false)
      assert.equal(logText().includes(DOWNGRADE_LOG), true)
      const afterDowngrade = logText().split(DOWNGRADE_LOG).length - 1
      assert.equal(await beat(server, config, async () => undefined), true)
      assert.equal(Object.prototype.hasOwnProperty.call(server.heartbeats[2]!.body, 'agentStartedAt'), false)
      assert.equal(logText().split(DOWNGRADE_LOG).length - 1, afterDowngrade)
      server.rejectStartedAt = false

      server.heartbeats.length = 0
      server.heartbeatStatus = 400
      resetRuntime()
      const downgradesBefore = logText().split(DOWNGRADE_LOG).length - 1
      assert.equal(await beat(server, config, async () => undefined), false)
      assert.equal(await beat(server, config, async () => undefined), false)
      assert.ok(server.heartbeats.length >= 2)
      assert.equal(server.heartbeats.every((hit) => typeof startedAtOf(hit) === 'string'), true)
      assert.equal(logText().split(DOWNGRADE_LOG).length - 1, downgradesBefore)
      assert.equal(logText().includes('heartbeat: ✗ failed'), true)
      server.heartbeatStatus = 200

      resetRuntime()
      server.heartbeats.length = 0
      server.acks.length = 0
      const restart = harness()
      const restartHandle = processor(config, restart)
      assert.equal(await beat(server, config, restartHandle, [command('tcmd_restart1', 'restart_agent', FUTURE)]), true)
      assert.equal(server.acks.length, 1)
      assert.equal(server.acks[0]?.body['result'], 'accepted')
      assert.equal(Object.prototype.hasOwnProperty.call(server.acks[0]!.body, 'remainingJobs'), false)
      assertAckShape(server.acks[0]!.body)
      assert.deepEqual(restart.order, ['ack:accepted', 'pause', 'exit'])
      assert.equal(restart.exitCodes.length, 1)
      assert.notEqual(restart.exitCodes[0], 0)
      assert.equal(restart.claimedWhileHeld, false)
      assert.equal(restart.clearCalls, 0)

      resetRuntime()
      server.acks.length = 0
      server.ackStatus = 500
      const retry = harness()
      const retryHandle = processor(config, retry)
      assert.equal(await beat(server, config, retryHandle, [command('tcmd_retryack', 'restart_agent', FUTURE)]), true)
      assert.equal(retry.exitCodes.length, 0)
      assert.equal(server.acks.length, 4)
      assert.equal(remoteClaimHoldReason(), null)
      server.ackStatus = 200
      assert.equal(await beat(server, config, retryHandle, [command('tcmd_retryack', 'restart_agent', FUTURE)]), true)
      assert.equal(server.acks.length, 5)
      assert.equal(server.acks[4]?.body['result'], 'accepted')
      assert.equal(retry.exitCodes.length, 1)
      assert.notEqual(retry.exitCodes[0], 0)

      resetRuntime()
      server.acks.length = 0
      const busy = harness()
      busy.busy = true
      const busyHandle = processor(config, busy)
      assert.equal(await beat(server, config, busyHandle, [
        command('tcmd_busyres', 'restart_agent', FUTURE),
        command('tcmd_busyclr', 'clear_print_queue', FUTURE),
      ]), true)
      assert.equal(server.acks.length, 2)
      assert.equal(server.acks[0]?.body['result'], 'rejected_busy')
      assert.equal(server.acks[1]?.body['result'], 'rejected_busy')
      assert.equal(busy.exitCodes.length, 0)
      assert.equal(busy.clearCalls, 0)
      assert.equal(busy.order.includes('exit'), false)
      assert.equal(busy.order.includes('pause'), false)
      assert.equal(remoteClaimHoldReason(), null)

      await assertHoldClaimsBeforeBusy(server, config)

      resetRuntime()
      server.acks.length = 0
      server.ackResult = 'expired'
      const expired = harness()
      const expiredHandle = processor(config, expired)
      assert.equal(await beat(server, config, expiredHandle, [command('tcmd_expired', 'restart_agent', PAST)]), true)
      assert.equal(server.acks.length, 1)
      assert.equal(server.acks[0]?.body['result'], 'accepted')
      assertAckShape(server.acks[0]!.body)
      assert.equal(expired.busyCalls, 1)
      assert.equal(expired.exitCodes.length, 0)
      assert.equal(expired.clearCalls, 0)

      resetRuntime()
      server.acks.length = 0
      server.ackResult = undefined
      const bad = harness()
      const badHandle = processor(config, bad)
      assert.equal(await beat(server, config, badHandle, [
        { type: 'clear_print_queue', issuedAt: ISSUED, expiresAt: FUTURE, documentName: JOB, printerName: PRINTER, userName: ACCOUNT },
        { id: 'bad-type-id', type: PRINTER, issuedAt: ISSUED, expiresAt: FUTURE, documentName: JOB },
        { id: 'bad-time-id', type: 'restart_agent', issuedAt: 'not-a-time', expiresAt: FUTURE, documentName: JOB, printerName: PRINTER },
        { id: PRINTER.repeat(5), type: 'restart_agent', issuedAt: ISSUED, expiresAt: FUTURE, documentName: JOB },
      ]), true)
      assert.equal(server.acks.length, 0)
      assert.equal(bad.exitCodes.length, 0)
      assert.equal(bad.clearCalls, 0)
      assert.equal(logText().includes('result=skipped'), true)

      resetRuntime()
      server.acks.length = 0
      const duplicate = harness()
      const duplicateHandle = processor(config, duplicate)
      const duplicated = command('tcmd_same_id', 'clear_print_queue', FUTURE)
      duplicate.clearImpl = async (printerName) => clearWith(printerName, duplicate, [
        { total: 0, ids: [] },
      ])
      assert.equal(await beat(server, config, duplicateHandle, [duplicated, { ...duplicated }]), true)
      assert.equal(await beat(server, config, duplicateHandle, [duplicated]), true)
      assert.equal(server.acks.length, 1)
      assert.equal(server.acks[0]?.commandId, 'tcmd_same_id')
      assert.equal(duplicate.clearCalls, 1)

      resetRuntime()
      server.acks.length = 0
      const cleared = harness()
      cleared.clearImpl = async (printerName) => clearWith(printerName, cleared, [
        { total: 2, ids: [7, 8] },
        { total: 0, ids: [] },
      ])
      const clearHandle = processor(config, cleared)
      assert.equal(await beat(server, config, clearHandle, [command('tcmd_clear00', 'clear_print_queue', FUTURE)]), true)
      assert.equal(server.acks.length, 1)
      assert.equal(server.acks[0]?.body['result'], 'done')
      const doneBody = server.acks[0]!.body
      assert.equal(
        !Object.prototype.hasOwnProperty.call(doneBody, 'remainingJobs') || doneBody['remainingJobs'] === 0,
        true,
      )
      assertAckShape(doneBody)
      assert.deepEqual(cleared.removedIds, [7, 8])
      namesAreConfigured(cleared.printerNames)
      assert.equal(cleared.claimedWhileHeld, false)
      assert.equal(cleared.exitCodes.length, 0)
      assert.equal(remoteClaimHoldReason(), null)

      resetRuntime()
      server.acks.length = 0
      const left = harness()
      left.clearImpl = async (printerName) => clearWith(printerName, left, [
        { total: 2, ids: [3, 4] },
        { total: 2, ids: [3, 4] },
      ])
      assert.equal(await beat(server, config, processor(config, left), [command('tcmd_left002', 'clear_print_queue', FUTURE)]), true)
      assert.equal(server.acks[0]?.body['result'], 'failed')
      assert.equal(server.acks[0]?.body['remainingJobs'], 2)
      assertAckShape(server.acks[0]!.body)
      namesAreConfigured(left.printerNames)

      resetRuntime()
      server.acks.length = 0
      const broken = harness()
      broken.clearImpl = async (printerName) => clearWith(printerName, broken, ['fail'])
      assert.equal(await beat(server, config, processor(config, broken), [command('tcmd_listbad', 'clear_print_queue', FUTURE)]), true)
      assert.equal(server.acks[0]?.body['result'], 'failed')
      const remaining = server.acks[0]?.body['remainingJobs']
      assert.equal(typeof remaining, 'number')
      assert.equal(Number.isInteger(remaining), true)
      assert.equal((remaining as number) >= 0, true)
      assertAckShape(server.acks[0]!.body)
      namesAreConfigured(broken.printerNames)
      assert.equal(logText().includes('remote-command: clear list failed before a count; remaining reported as 0'), true)

      await verifyRemoteCommandRework(server, config, logText)
      for (const ack of server.acks) assertAckShape(ack.body)
      const forbidden = [
        ['job', JOB],
        ['printer', PRINTER],
        ['account', ACCOUNT],
        ['other', OTHER],
      ] as const
      const text = logText()
      for (const [label, secret] of forbidden) {
        assert.equal(text.includes(secret), false, `log contained forbidden ${label}`)
      }
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 30))
      await server.close()
    }
  } finally {
    restoreCapture()
  }
}

function clearWith(
  printerName: string,
  state: Harness,
  steps: Array<{ total: number; ids: number[] } | 'fail'>,
): Promise<{ result: 'done' | 'failed'; remainingJobs: number }> {
  let index = 0
  return clearAllJobsOnConfiguredPrinter(printerName, {
    platform: 'win32',
    holdWhenIdle: true,
    runList: async (name) => {
      state.printerNames.push(name)
      const step = steps[index] ?? steps[steps.length - 1]
      index += 1
      if (!step || step === 'fail') throw new Error('list failed')
      return step
    },
    runRemove: async (name, ids) => {
      state.printerNames.push(name)
      state.removedIds.push(...ids)
    },
    pause: async (name) => {
      state.printerNames.push(name)
    },
  })
}

void main().then(() => {
  console.log('verify-remote-commands: all cases passed')
}).catch((error: unknown) => {
  restoreCapture()
  console.error(error)
  process.exit(1)
})
