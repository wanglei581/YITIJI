import assert from 'node:assert/strict'
import { createTaskRunnerControl } from '../src/agent/task-runner-control'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for task-runner control state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function main(): Promise<void> {
  const gates: Deferred[] = []
  let cycles = 0
  let active = 0
  let maxActive = 0
  const errors: unknown[] = []

  const control = createTaskRunnerControl({
    intervalMs: 60_000,
    runCycle: async () => {
      cycles += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      const gate = deferred()
      gates.push(gate)
      await gate.promise
      active -= 1
    },
    onCycleError: (error) => errors.push(error),
  })

  try {
    assert.deepEqual(control.wake(), { accepted: true, coalesced: false })
    await waitFor(() => cycles === 1)

    assert.deepEqual(control.wake(), { accepted: true, coalesced: true })
    assert.deepEqual(control.wake(), { accepted: true, coalesced: true })
    assert.equal(cycles, 1, 'wake requests must not overlap an active task cycle')

    gates[0]!.resolve()
    await waitFor(() => cycles === 2)
    assert.equal(
      maxActive,
      1,
      'coalesced rerun must start only after the full prior cycle resolves'
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(cycles, 2, 'multiple concurrent wake requests must coalesce to one rerun')
    gates[1]!.resolve()
    await waitFor(() => active === 0)
    assert.equal(errors.length, 0)
  } finally {
    control.stop()
  }

  assert.deepEqual(control.wake(), { accepted: false, coalesced: false })

  const disabled = createTaskRunnerControl({
    intervalMs: 60_000,
    enabled: false,
    runCycle: async () => {
      throw new Error('disabled runner must not execute')
    },
    onCycleError: (error) => errors.push(error),
  })
  assert.deepEqual(disabled.wake(), { accepted: false, coalesced: false })
  disabled.stop()

  console.log('verify-task-runner-wake: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
