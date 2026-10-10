/** 返工行为断言；由 verify:remote-commands 调用，SQLite 真实开关连接。 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FakeServer } from './verify-remote-commands'
import type { AgentConfig } from '../src/agent/types'
import { createRemoteCommandProcessor, postTerminalCommandAck, type RemoteCommandDeps, type RemoteCommandResult } from '../src/agent/remote-commands'
import { openDatabase } from '../src/agent/db'
import { createRemoteCommandStore } from '../src/agent/remote-command-store'
import { sendHeartbeat, resetAgentStartedAtFallbackForTests } from '../src/agent/heartbeat'
import { claimPrintTasksIfGateOpen, holdPrintClaims, releasePrintClaims, remoteClaimHoldReason, __resetPrintDispatchGateForTests, noteStartupPrintQueueFailure } from '../src/agent/print-dispatch-gate'
import { requestServiceRestart } from '../src/agent/service-restart'
import { processCandidate, clearStartupBacklogForTest } from '../src/agent/scan-watcher'

const cmd = (id: string, type = 'restart_agent', duration = 600_000) => ({
  id, type, issuedAt: '2026-10-10T00:00:00Z',
  expiresAt: new Date(Date.parse('2026-10-10T00:00:00Z') + duration).toISOString(),
})

export async function verifyRemoteCommandRework(server: FakeServer, config: AgentConfig, logText: () => string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'remote-command-rework-'))
  const previousProgramData = process.env['PROGRAMDATA']
  process.env['PROGRAMDATA'] = root
  let db = openDatabase()
  assert.ok(db, 'real SQLite must open for durable result tests')
  const store = createRemoteCommandStore(() => db)
  let clock = Date.parse('2026-10-10T00:00:00Z')
  let monotonic = 0
  let clears = 0
  let requests = 0
  let busyCalls = 0
  let busy = false
  const exits: number[] = []
  const waits: number[] = []
  const deps = (overrides: Partial<RemoteCommandDeps> = {}): RemoteCommandDeps => ({
    now: () => new Date(clock), monotonicNow: () => monotonic,
    sleep: async (ms) => {
      assert.equal(remoteClaimHoldReason(), 'restart_agent', 'hold must survive retry waits')
      waits.push(ms)
    },
    store,
    isBusy: () => { busyCalls++; return busy },
    ack: (id, body) => postTerminalCommandAck(config, id, body),
    exit: (code) => { exits.push(code) },
    holdPrinterQueueWhenIdle: true, pauseQueue: async () => undefined,
    clearPrintQueue: async () => { clears++; return { result: 'done', remainingJobs: 0 } },
    holdClaims: holdPrintClaims, releaseClaims: releasePrintClaims,
    printerName: config.printerName,
    requestServiceRestart: async () => { requests++; return false },
    ...overrides,
  })
  const reset = () => {
    __resetPrintDispatchGateForTests()
    resetAgentStartedAtFallbackForTests()
    server.ackStatus = 200; server.ackResult = undefined; server.acks.length = 0
    server.heartbeats.length = 0; server.rejectStartedAt = false
    clears = 0; requests = 0; busyCalls = 0; busy = false; exits.length = 0; waits.length = 0
  }
  try {
    // All five authoritative results; terminal must never infer acceptance from 2xx.
    for (const result of ['expired', 'failed', 'done', 'rejected_busy'] as const) {
      reset(); server.ackResult = result
      const handle = createRemoteCommandProcessor(deps())
      const command = cmd(`rework-reject-${result}`)
      await handle([command]); await handle([command])
      assert.equal(requests, 0); assert.deepEqual(exits, [])
      assert.equal(remoteClaimHoldReason(), null)
      assert.equal(server.acks.length, 1, 'terminal result must be marked seen')
    }
    // Invalid success payload is an ACK failure, not permission to restart.
    for (const result of ['unknown', 42, null]) {
      reset(); server.ackResult = result
      assert.equal(await postTerminalCommandAck(config, 'invalid', { result: 'accepted' }), null)
    }
    reset(); server.dropAcceptedResponse = true
    const lost = cmd('rework-response-lost')
    const lostHandle = createRemoteCommandProcessor(deps())
    await lostHandle([lost])
    assert.equal(requests, 1); assert.equal(exits.length, 1)
    assert.equal(server.acks.length, 2)
    assert.deepEqual(server.acks[0], server.acks[1], 'retry ID and request body must be identical')
    assert.deepEqual(waits, [2_000])
    server.commands = [lost]
    let delivered: unknown = null
    assert.equal(await sendHeartbeat({ config, onRemoteCommands: async (commands) => { delivered = commands } }), true)
    assert.deepEqual(delivered, [], 'committed acceptance must not be redelivered')

    reset(); server.timeoutAcceptedResponse = true
    const timeoutHandle = createRemoteCommandProcessor(deps({
      ack: (id, body) => postTerminalCommandAck(config, id, body, 30),
    }))
    await timeoutHandle([cmd('rework-accepted-timeout')])
    assert.equal(requests, 1); assert.equal(server.acks.length, 2)
    assert.deepEqual(server.acks[0], server.acks[1])
    assert.deepEqual(waits, [2_000])

    reset(); server.ackStatus = 500
    const failureHandle = createRemoteCommandProcessor(deps())
    const failure = cmd('rework-all-failed')
    await failureHandle([failure])
    assert.equal(requests, 0); assert.equal(exits.length, 0)
    assert.equal(remoteClaimHoldReason(), null)
    assert.equal(server.acks.length, 4) // initial + three retries
    assert.deepEqual(waits, [2_000, 5_000, 10_000])
    server.ackStatus = 200
    await failureHandle([failure])
    assert.equal(requests, 1); assert.equal(server.acks.length, 5)

    reset(); server.ackStatus = 500
    const durable = cmd('rework-durable', 'clear_print_queue')
    let handle = createRemoteCommandProcessor(deps())
    await handle([durable])
    assert.equal(clears, 1)
    assert.equal(store.get(durable.id)?.result, 'done')
    busy = true
    await handle([durable])
    assert.equal(clears, 1); assert.equal(busyCalls, 1)
    assert.deepEqual(server.acks[0], server.acks[1])
    db!.close(); db = openDatabase(); assert.ok(db)
    handle = createRemoteCommandProcessor(deps()) // drop ALL processor memory
    server.ackStatus = 200
    await handle([durable])
    assert.equal(clears, 1); assert.equal(busyCalls, 1)
    assert.deepEqual(server.acks[0], server.acks[2])
    assert.deepEqual(Object.keys(store.get(durable.id)!).sort(), ['commandId', 'finishedAt', 'remainingJobs', 'result', 'type'])
    store.prune(new Date(clock + 86_400_001)); assert.equal(store.get(durable.id), undefined)

    // Every returned value, including late done/failed, updates local authoritative result.
    for (const result of ['accepted', 'rejected_busy', 'expired', 'done', 'failed'] as RemoteCommandResult[]) {
      reset(); server.ackResult = result
      const logBefore = logText().length
      const command = cmd(`srv${result}`, 'clear_print_queue')
      await createRemoteCommandProcessor(deps())([command])
      assert.equal(server.acks[0]?.body.result, 'done')
      assert.equal(store.get(command.id)?.result, result)
      assert.ok(logText().slice(logBefore).includes(`result=${result} remaining=0`), 'log must use server result')
    }
    reset(); server.ackResult = 'done'
    const failed = cmd('rework-failed-to-done', 'clear_print_queue')
    await createRemoteCommandProcessor(deps({ clearPrintQueue: async () => ({ result: 'failed', remainingJobs: 2 }) }))([failed])
    assert.equal(server.acks[0]?.body.result, 'failed'); assert.equal(store.get(failed.id)?.result, 'done')

    reset(); busy = true; server.ackResult = 'failed'
    const busyClear = cmd('rework-busy-server-result', 'clear_print_queue')
    await createRemoteCommandProcessor(deps())([busyClear])
    assert.equal(clears, 0); assert.equal(server.acks[0]?.body.result, 'rejected_busy')
    assert.equal(store.get(busyClear.id)?.result, 'failed')

    reset(); clock += 3_600_000 // wall clock fast by an hour; server duration unchanged
    await createRemoteCommandProcessor(deps())([cmd('rework-fast-clear', 'clear_print_queue'), cmd('rework-fast-clock')])
    assert.equal(requests, 1); assert.equal(clears, 1)
    assert.equal(server.acks.some((ack) => ack.body.result === 'expired'), false)

    reset(); monotonic = 0
    await createRemoteCommandProcessor(deps({
      clearPrintQueue: async () => { clears++; monotonic = 1001; return { result: 'done', remainingJobs: 0 } },
    }))([cmd('rework-first-clear', 'clear_print_queue', 1000), cmd('rework-delayed-clear', 'clear_print_queue', 1000)])
    assert.equal(clears, 1); assert.equal(server.acks[1]?.body.result, 'expired')

    reset(); monotonic = 0
    await createRemoteCommandProcessor(deps({ isBusy: async () => { monotonic = 1001; return false } }))([cmd('rework-busy-check-delay', 'clear_print_queue', 1000)])
    assert.equal(clears, 0); assert.equal(server.acks[0]?.body.result, 'expired')
    assert.equal(remoteClaimHoldReason(), null)

    reset(); noteStartupPrintQueueFailure('cleanup')
    let claimed = false
    await claimPrintTasksIfGateOpen({
      holdEnabled: true, pause: async () => undefined,
      cleanup: async () => { holdPrintClaims('restart_agent') },
    }, async () => { claimed = true })
    assert.equal(claimed, false, 'recovery hold gap must not claim')
    let scanDelivered = false
    clearStartupBacklogForTest()
    const scanFolder = join(root, 'scan')
    mkdirSync(scanFolder)
    const scanFile = join(scanFolder, 'gate.pdf')
    writeFileSync(scanFile, '%PDF-1.4\n%%EOF')
    const scanConfig = { ...config, scanWatchFolder: scanFolder }
    await processCandidate(scanFile, 'gate.pdf', scanConfig, async () => { scanDelivered = true })
    assert.equal(scanDelivered, false); assert.equal(existsSync(scanFile), true)
    releasePrintClaims()
    await processCandidate(scanFile, 'gate.pdf', scanConfig, async () => { scanDelivered = true })
    assert.equal(scanDelivered, true, 'same candidate can deliver once hold is released')
    assert.equal(existsSync(scanFile), false)

    assert.equal(await requestServiceRestart({ platform: 'darwin' }), false)
    reset()
    const callbacks: Array<() => void> = []
    await createRemoteCommandProcessor(deps({
      requestServiceRestart: async () => { requests++; return true },
      restartFallbackMs: 5, scheduleFallback: (callback, ms) => { assert.equal(ms, 5); callbacks.push(callback) },
    }))([cmd('rework-task-success')])
    assert.equal(requests, 1); assert.equal(exits.length, 0)
    assert.equal(callbacks.length, 1); callbacks[0]!()
    assert.deepEqual(exits, [1])
    reset()
    await createRemoteCommandProcessor(deps())([cmd('rework-task-failed')])
    assert.deepEqual(exits, [1])

    reset(); monotonic = 0; server.rejectStartedAt = true
    const heartbeatOptions = { config, startedAtProbeIntervalMs: 10, monotonicNow: () => monotonic }
    const hasField = () => server.heartbeats.map((hit) => Object.hasOwnProperty.call(hit.body, 'agentStartedAt'))
    assert.equal(await sendHeartbeat(heartbeatOptions), true)
    assert.deepEqual(hasField(), [true, false])
    assert.equal(await sendHeartbeat(heartbeatOptions), true)
    assert.deepEqual(hasField(), [true, false, false])
    monotonic = 11
    assert.equal(await sendHeartbeat(heartbeatOptions), true)
    assert.deepEqual(hasField(), [true, false, false, true, false])
    monotonic = 12
    assert.equal(await sendHeartbeat(heartbeatOptions), true)
    assert.equal(hasField().at(-1), false)
    server.rejectStartedAt = false; monotonic = 22
    assert.equal(await sendHeartbeat(heartbeatOptions), true)
    assert.equal(await sendHeartbeat(heartbeatOptions), true)
    assert.deepEqual(hasField().slice(-2), [true, true])

    reset(); monotonic = 0; server.rejectStartedAt = true
    const deferredHandle = createRemoteCommandProcessor(deps())
    const restart = cmd('rework-deferred-restart')
    server.commands = [restart, cmd('rework-allowed-clear', 'clear_print_queue')]
    assert.equal(await sendHeartbeat({ ...heartbeatOptions, onRemoteCommands: deferredHandle }), true)
    assert.equal(requests, 0); assert.equal(clears, 1)
    assert.equal(server.acks.length, 1); assert.equal(server.acks[0]?.body.result, 'done')
    monotonic = 11; server.rejectStartedAt = false; server.commands = [restart]
    assert.equal(await sendHeartbeat({ ...heartbeatOptions, onRemoteCommands: deferredHandle }), true)
    assert.equal(requests, 1); assert.equal(server.acks[1]?.body.result, 'accepted')
  } finally {
    db?.close()
    if (previousProgramData === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previousProgramData
    rmSync(root, { recursive: true, force: true })
    reset()
  }
}
