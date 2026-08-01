import { workerData, parentPort } from 'node:worker_threads'
import { GovernanceError } from './governance-contract.mjs'
import { invokeExecution, runtimeAdapters } from './governance.mjs'

const gate = new Int32Array(workerData.gate)
const adapters = Object.freeze({
  ...runtimeAdapters,
  filesystemKind: () => 0xef53n,
  moduleCloneRoot: () => workerData.cloneRoot,
  randomId: () => workerData.eventId,
  monotonicTime: () => BigInt(workerData.monotonicTime),
  now: () => new Date(workerData.now),
  fault: (point) => {
    if (point !== 'before-invocation-tombstone') return
    Atomics.add(gate, 0, 1)
    Atomics.notify(gate, 0)
    while (Atomics.load(gate, 0) < workerData.workerCount) Atomics.wait(gate, 0, 1, 100)
  },
  writeInvocationContext: (_fd, value) => value.length,
})

try {
  const result = invokeExecution(workerData.input, adapters)
  parentPort.postMessage({ ok: true, reservationId: result.reservationId })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code: error instanceof GovernanceError ? error.code : null,
  })
  process.exitCode = 2
}
