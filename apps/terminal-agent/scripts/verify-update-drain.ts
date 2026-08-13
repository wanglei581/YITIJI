import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentConfig } from '../src/agent/types'
import { createTaskRunnerControl } from '../src/agent/task-runner-control'
import { createUpdateDrainController } from '../src/agent/update-drain'
import {
  clearUpdateMaintenanceMarker,
  isUpdateMaintenanceRequested,
  startUpdateMaintenanceLease,
} from '../src/agent/update-maintenance'
import { ensureLocalUpdateControlToken } from '../src/agent/update-control-token'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for update drain fixture')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fakeDatabase(pendingCount: () => number) {
  return {
    exec() { return this },
    close() {},
    prepare(sql: string) {
      return {
        run() { return { lastInsertRowid: 0, changes: 0 } },
        get() { return { count: sql.includes('pending_patches') ? pendingCount() : 0 } },
        all() { return [] },
      }
    },
  }
}

async function main(): Promise<void> {
  const gate = deferred()
  let cycles = 0
  let pendingReceipts = 0
  const runner = createTaskRunnerControl({
    intervalMs: 60_000,
    runCycle: async () => {
      cycles += 1
      await gate.promise
    },
    onCycleError: (error) => { throw error },
  })
  let maintenanceCleared = false
  let scanWatcherPaused = false
  const drain = createUpdateDrainController(runner, fakeDatabase(() => pendingReceipts), {
    clearMaintenanceRequest: () => {
      maintenanceCleared = true
      return true
    },
    pauseScanWatcher: () => { scanWatcherPaused = true },
    resumeScanWatcher: () => { scanWatcherPaused = false },
  })

  assert.equal(drain.status().acceptingClaims, true)
  assert.deepEqual(runner.wake(), { accepted: true, coalesced: false })
  await waitFor(() => cycles === 1)
  const draining = drain.begin(1_000)
  assert.equal(scanWatcherPaused, true)
  assert.deepEqual(runner.wake(), { accepted: false, coalesced: false })
  gate.resolve()
  assert.deepEqual(await draining, {
    acceptingClaims: false,
    activeTask: false,
    activeScanDeliveries: 0,
    pendingStatusReceipts: 0,
    ready: true,
    reason: 'ready',
  })

  pendingReceipts = 1
  assert.deepEqual(drain.status(), {
    acceptingClaims: false,
    activeTask: false,
    activeScanDeliveries: 0,
    pendingStatusReceipts: 1,
    ready: false,
    reason: 'status_receipts_pending',
  })
  runner.resume()
  const receiptBlocked = await drain.begin(100)
  assert.equal(receiptBlocked.ready, false)
  assert.equal(receiptBlocked.reason, 'status_receipts_pending')
  assert.equal(receiptBlocked.acceptingClaims, true, 'failed drain must restore normal claims')
  assert.equal(scanWatcherPaused, false, 'failed drain must resume scan intake')
  pendingReceipts = 0

  let activeScanDeliveries = 1
  const scanDrainRunner = createTaskRunnerControl({
    intervalMs: 60_000,
    runCycle: async () => undefined,
    onCycleError: (error) => { throw error },
  })
  const scanDrain = createUpdateDrainController(scanDrainRunner, fakeDatabase(() => 0), {
    getActiveScanDeliveryCount: () => activeScanDeliveries,
    idleRecheckMs: 5,
  })
  const scanDraining = scanDrain.begin(100)
  setTimeout(() => { activeScanDeliveries = 0 }, 20).unref()
  assert.equal((await scanDraining).ready, true, 'drain must wait for an in-flight scan delivery')
  scanDrain.cancel()
  scanDrainRunner.stop()

  const stuckScanRunner = createTaskRunnerControl({
    intervalMs: 60_000,
    runCycle: async () => undefined,
    onCycleError: (error) => { throw error },
  })
  const stuckScanDrain = createUpdateDrainController(stuckScanRunner, fakeDatabase(() => 0), {
    getActiveScanDeliveryCount: () => 1,
    idleRecheckMs: 5,
  })
  const scanBlocked = await stuckScanDrain.begin(25)
  assert.equal(scanBlocked.reason, 'scan_active')
  assert.equal(scanBlocked.activeScanDeliveries, 1)
  assert.equal(scanBlocked.acceptingClaims, true)
  stuckScanRunner.stop()

  let maintenanceRequested = true
  const leaseRunner = createTaskRunnerControl({
    intervalMs: 60_000,
    runCycle: async () => undefined,
    onCycleError: (error) => { throw error },
  })
  const maintenanceAwareDrain = createUpdateDrainController(
    leaseRunner,
    fakeDatabase(() => 0),
    {
      isMaintenanceRequested: () => maintenanceRequested,
      pauseScanWatcher: () => { scanWatcherPaused = true },
      resumeScanWatcher: () => { scanWatcherPaused = false },
      leaseMs: 15,
      maintenanceRecheckMs: 10,
    },
  )
  assert.equal((await maintenanceAwareDrain.begin(100)).ready, true)
  assert.equal(scanWatcherPaused, true)
  await delay(35)
  assert.equal(
    leaseRunner.getStatus().accepting,
    false,
    'an active maintenance marker must outlive the normal drain lease',
  )
  maintenanceRequested = false
  await waitFor(() => leaseRunner.getStatus().accepting)
  assert.equal(scanWatcherPaused, false, 'expired drain lease must resume scan intake with print claims')
  leaseRunner.stop()

  const config: AgentConfig = {
    apiBaseUrl: 'http://127.0.0.1:1/api/v1',
    terminalCode: 'T-UPDATE-DRAIN-VERIFY',
    printerName: 'Configured Test Printer',
    agentVersion: 'verify',
    terminalId: 'terminal-update-drain-verify',
    agentToken: 'unused-test-token',
    localApiPort: 0,
    localUpdateControlToken: Buffer.alloc(32, 11).toString('base64'),
  }
  const handle = startQrLoginLocalServer(config, {
    getUpdateDrainStatus: drain.status,
    beginUpdateDrain: drain.begin,
    cancelUpdateDrain: drain.cancel,
    completeUpdateDrain: drain.complete,
    getPanelStatus: () => ({
      runtimeVersion: '0.4.8',
      terminalCode: config.terminalCode,
      serviceState: 'running',
      cloudConnected: true,
      lastHeartbeatAt: new Date().toISOString(),
      printerStatus: 'ready',
      localTaskDatabaseAvailable: true,
      scanInputStatus: 'ready',
      scanInputReason: 'ready',
      credentialStatus: 'ready',
    }),
  })
  assert.ok(handle)
  if (!handle.server.listening) await once(handle.server, 'listening')
  const address = handle.server.address()
  assert.ok(typeof address === 'object' && address)
  const base = `http://127.0.0.1:${address.port}/local/update/drain`

  try {
    const denied = await fetch(`${base}/status`)
    assert.equal(denied.status, 403)
    assert.equal(denied.headers.get('access-control-allow-origin'), null)
    assert.equal(denied.headers.get('cache-control'), 'no-store')
    const headers = { 'X-Update-Control-Token': config.localUpdateControlToken! }
    const status = await fetch(`${base}/status`, { headers })
    assert.equal(status.status, 200)
    assert.equal(status.headers.get('access-control-allow-origin'), null)
    assert.equal(status.headers.get('cache-control'), 'no-store')

    const health = await fetch(`http://127.0.0.1:${address.port}/local/update/health`, { headers })
    assert.equal(health.status, 200)
    const healthBody = await health.json() as { data: { runtimeVersion: string; cloudConnected: boolean } }
    assert.deepEqual(healthBody.data, {
      runtimeVersion: '0.4.8',
      cloudConnected: true,
      localTaskDatabaseAvailable: true,
      credentialStatus: 'ready',
    })

    const begin = await fetch(`${base}/begin`, { method: 'POST', headers })
    assert.equal(begin.status, 200)
    const beginBody = await begin.json() as { data: { ready: boolean } }
    assert.equal(beginBody.data.ready, true)

    const complete = await fetch(`${base}/complete`, { method: 'POST', headers })
    assert.equal(complete.status, 200)
    const completeBody = await complete.json() as { data: { acceptingClaims: boolean } }
    assert.equal(completeBody.data.acceptingClaims, true)
    assert.equal(maintenanceCleared, true)
    assert.equal(scanWatcherPaused, false)

    const repeatedComplete = await fetch(`${base}/complete`, { method: 'POST', headers })
    assert.equal(repeatedComplete.status, 200, 'a lost completion response must be safely retryable')
    const repeatedCompleteBody = await repeatedComplete.json() as { data: { acceptingClaims: boolean } }
    assert.equal(repeatedCompleteBody.data.acceptingClaims, true)

    const bodyRejected = await fetch(`${base}/begin`, { method: 'POST', headers, body: '{}' })
    assert.equal(bodyRejected.status, 400)
    const bodyRejectedPayload = await bodyRejected.json() as { error: { code: string } }
    assert.equal(bodyRejectedPayload.error.code, 'LOCAL_UPDATE_DRAIN_BODY_NOT_ALLOWED')
    assert.equal(bodyRejected.headers.get('cache-control'), 'no-store')
    const queryRejected = await fetch(`${base}/status?unsafe=1`, { headers })
    assert.equal(queryRejected.status, 400)

    const secondBegin = await fetch(`${base}/begin`, { method: 'POST', headers })
    assert.equal(secondBegin.status, 200)
    const cancel = await fetch(`${base}/cancel`, { method: 'POST', headers })
    assert.equal(cancel.status, 200)
    const cancelBody = await cancel.json() as { data: { acceptingClaims: boolean } }
    assert.equal(cancelBody.data.acceptingClaims, true)
  } finally {
    await handle.close()
    runner.stop()
  }

  let activeMaintenance = true
  const guardedCancelRunner = createTaskRunnerControl({
    intervalMs: 60_000,
    runCycle: async () => undefined,
    onCycleError: (error) => { throw error },
  })
  const guardedCancelDrain = createUpdateDrainController(
    guardedCancelRunner,
    fakeDatabase(() => 0),
    { isMaintenanceRequested: () => activeMaintenance },
  )
  assert.equal((await guardedCancelDrain.begin(100)).ready, true)
  assert.equal(
    guardedCancelDrain.cancel().acceptingClaims,
    false,
    'cancel must not resume claims while an updater maintenance marker is active',
  )
  activeMaintenance = false
  assert.equal(guardedCancelDrain.cancel().acceptingClaims, true)
  guardedCancelRunner.stop()

  const markerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-update-marker-'))
  const markerPath = path.join(markerRoot, 'update-maintenance.json')
  try {
    fs.writeFileSync(markerPath, JSON.stringify({ expiresAt: new Date(Date.now() + 100).toISOString() }))
    assert.equal(isUpdateMaintenanceRequested({ markerPath }), true)
    const maintenanceRunner = createTaskRunnerControl({
      intervalMs: 60_000,
      runCycle: async () => undefined,
      onCycleError: (error) => { throw error },
    })
    let additionalIntakePaused = false
    const lease = startUpdateMaintenanceLease(maintenanceRunner, {
      markerPath,
      recheckMs: 5,
      pauseAdditionalIntake: () => { additionalIntakePaused = true },
      resumeAdditionalIntake: () => { additionalIntakePaused = false },
    })
    assert.ok(lease)
    assert.equal(maintenanceRunner.getStatus().accepting, false)
    assert.equal(additionalIntakePaused, true)
    await delay(40)
    fs.writeFileSync(markerPath, JSON.stringify({ expiresAt: new Date(Date.now() + 500).toISOString() }))
    await delay(100)
    assert.equal(
      maintenanceRunner.getStatus().accepting,
      false,
      'a renewed maintenance marker must keep claims paused past its original expiry',
    )
    assert.equal(clearUpdateMaintenanceMarker(markerPath), true)
    assert.equal(fs.existsSync(markerPath), false)
    await waitFor(() => maintenanceRunner.getStatus().accepting)
    assert.equal(additionalIntakePaused, false)
    maintenanceRunner.stop()
    fs.writeFileSync(markerPath, JSON.stringify({ expiresAt: new Date(Date.now() - 1_000).toISOString() }))
    assert.equal(isUpdateMaintenanceRequested({ markerPath }), false)
    assert.equal(fs.existsSync(markerPath), false)
  } finally {
    fs.rmSync(markerRoot, { recursive: true, force: true })
  }

  let persistedConfig: AgentConfig | undefined
  const tokenConfig = ensureLocalUpdateControlToken(
    {
      apiBaseUrl: 'https://example.test/api/v1',
      terminalCode: 'KSK-TOKEN-VERIFY',
      printerName: 'Configured Test Printer',
      agentVersion: 'verify',
    },
    (updated) => { persistedConfig = updated },
    () => Buffer.alloc(32, 7),
  )
  assert.equal(tokenConfig.localUpdateControlToken, Buffer.alloc(32, 7).toString('base64'))
  assert.equal(persistedConfig?.localUpdateControlToken, tokenConfig.localUpdateControlToken)
  persistedConfig = undefined
  assert.equal(
    ensureLocalUpdateControlToken(tokenConfig, () => { throw new Error('must not rewrite existing token') }),
    tokenConfig,
  )
  let repairedWeakToken: AgentConfig | undefined
  const repaired = ensureLocalUpdateControlToken(
    { ...tokenConfig, localUpdateControlToken: 'weak-token' },
    (updated) => { repairedWeakToken = updated },
    () => Buffer.alloc(32, 9),
  )
  assert.equal(repaired.localUpdateControlToken, Buffer.alloc(32, 9).toString('base64'))
  assert.equal(repairedWeakToken?.localUpdateControlToken, repaired.localUpdateControlToken)

  console.log('verify-update-drain: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
