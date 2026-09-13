import assert from 'node:assert/strict'
import http from 'node:http'
import { ScanDeliveryBarrier } from '../src/agent/scan-candidate-barrier'
import { sendHeartbeat } from '../src/agent/heartbeat'
import type { AgentConfig, HeartbeatPayload } from '../src/agent/types'

async function waitForClockTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

async function verifyBarrierTelemetry(): Promise<void> {
  const barrier = new ScanDeliveryBarrier()
  assert.equal(barrier.beginWatchSession(), true)
  await waitForClockTick()
  assert.equal(barrier.enterRunning({ canonicalPath: '/verified/scan', dev: 1, ino: 2 }), true)

  const healthy = barrier.getTelemetry()
  assert.deepEqual(
    { health: healthy.health, action: healthy.requiredAction, reason: healthy.reason },
    { health: 'healthy', action: 'none', reason: null },
  )
  assert.equal(Number.isNaN(Date.parse(healthy.observedAt)), false)

  await waitForClockTick()
  barrier.lockOut('watcher_error')
  const locked = barrier.getTelemetry()
  assert.deepEqual(
    { health: locked.health, action: locked.requiredAction, reason: locked.reason },
    { health: 'locked_out', action: 'restart_required', reason: 'watcher_error' },
  )
  assert.notEqual(locked.observedAt, healthy.observedAt, 'lockout must latch its own first-observed timestamp')

  await waitForClockTick()
  barrier.lockOut('C:\\private\\resume.pdf')
  assert.deepEqual(barrier.getTelemetry(), locked, 'repeat lockout must preserve reason and timestamp')
  assert.equal(barrier.enterRunning({ canonicalPath: '/other', dev: 3, ino: 4 }), false)
  assert.equal(barrier.beginWatchSession(), false)
  assert.equal(barrier.getState(), 'locked_out', 'no production transition may unlock the process')

  const unknownReasonBarrier = new ScanDeliveryBarrier()
  unknownReasonBarrier.lockOut('C:\\private\\resume.pdf')
  assert.equal(unknownReasonBarrier.lockOutCode(), 'C:\\private\\resume.pdf', 'internal diagnostic remains unchanged')
  assert.equal(unknownReasonBarrier.getTelemetry().reason, 'unknown', 'wire telemetry must not expose local data')
}

async function verifyHeartbeatReadsCurrentState(): Promise<void> {
  const payloads: HeartbeatPayload[] = []
  let releaseObservationRequests = 0
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      if (request.method === 'PUT' && request.url?.endsWith('/heartbeat')) {
        payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as HeartbeatPayload)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ acknowledged: true }))
        return
      }
      if (request.method === 'GET' && request.url?.endsWith('/release-observation-plan')) {
        releaseObservationRequests += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ plan: null }))
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const barrier = new ScanDeliveryBarrier()
  const config: AgentConfig = {
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    terminalCode: 'VERIFY-SCAN-TELEMETRY',
    agentVersion: 'verify-only',
    terminalId: 'terminal-scan-telemetry',
    agentToken: 'test-only-agent-token',
    printerName: 'test-only-printer',
  }
  try {
    assert.equal(await sendHeartbeat({ config, getScanInputTelemetry: () => barrier.getTelemetry() }), true)
    barrier.beginWatchSession()
    barrier.enterRunning({ canonicalPath: '/verified/scan', dev: 1, ino: 2 })
    assert.equal(await sendHeartbeat({ config, getScanInputTelemetry: () => barrier.getTelemetry() }), true)
    barrier.lockOut('root_identity_changed')
    const firstLockedAt = barrier.getTelemetry().observedAt
    assert.equal(await sendHeartbeat({ config, getScanInputTelemetry: () => barrier.getTelemetry() }), true)
    assert.equal(await sendHeartbeat({ config, getScanInputTelemetry: () => barrier.getTelemetry() }), true)

    assert.equal(payloads[0]?.scanInputHealth, 'unknown', 'heartbeat before watcher must report unknown')
    assert.equal(payloads[1]?.scanInputHealth, 'healthy', 'later heartbeat must dynamically read running state')
    assert.equal(payloads[2]?.scanInputHealth, 'locked_out')
    assert.equal(payloads[2]?.scanInputAction, 'restart_required')
    assert.equal(payloads[2]?.scanInputReason, 'root_identity_changed')
    assert.equal(payloads[2]?.scanInputObservedAt, firstLockedAt)
    assert.equal(payloads[3]?.scanInputObservedAt, firstLockedAt, 'lockout timestamp must not move per heartbeat')
    const deadline = Date.now() + 1_000
    while (releaseObservationRequests < 4 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(releaseObservationRequests, 4, 'every successful heartbeat must finish its read-only observation')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

void (async () => {
  await verifyBarrierTelemetry()
  await verifyHeartbeatReadsCurrentState()
  console.log('PASS scan-input lockout telemetry: dynamic, PII-safe, stable, restart-only')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
