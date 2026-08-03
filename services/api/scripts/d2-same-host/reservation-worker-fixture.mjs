import { workerData, parentPort } from 'node:worker_threads'
import { ERROR_CODES, GovernanceError } from './governance-contract.mjs'
import { reserveExecution, runtimeAdapters } from './governance.mjs'

const gate = new Int32Array(workerData.gate)
const randomIds = [...workerData.randomIds]
const testOverrides = Object.freeze({
  randomId: () => randomIds.shift(),
  now: () => new Date(workerData.now),
  filesystemKind: () => 0xef53n,
  fault: () => {},
})
const adapters = Object.freeze({ ...runtimeAdapters, ...testOverrides })

parentPort.postMessage(Object.freeze({ kind: 'ready' }))
Atomics.wait(gate, 0, 0)

try {
  const result = reserveExecution(workerData.input, adapters)
  parentPort.postMessage(Object.freeze({ kind: 'result', ok: true, reservationId: result.reservationId }))
} catch (error) {
  const code = error instanceof GovernanceError ? error.code : ERROR_CODES.GOVERNANCE_STATE
  parentPort.postMessage(Object.freeze({ kind: 'result', ok: false, code }))
  process.exitCode = 2
}
