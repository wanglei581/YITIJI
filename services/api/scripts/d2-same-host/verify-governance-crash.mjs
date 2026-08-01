#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { Worker } from 'node:worker_threads'
import {
  ERROR_CODES, GovernanceError, canonicalJson, parseManifestPayload, sha256,
} from './governance-contract.mjs'
import {
  loadGovernanceState, reserveExecution, runtimeAdapters, writeExclusiveJson,
} from './governance.mjs'

const FACETS = Object.freeze(['task', 'branch', 'baseline', 'clone', 'evidence', 'archive'])
const COMMIT_POINTS = Object.freeze([
  'reservation-intent', ...FACETS.map((facet) => `facet:${facet}`), 'manifest', 'event:RESERVED',
])
const roots = []
let sequence = 0

function tempRoot(prefix) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix))
  roots.push(root)
  return root
}
function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd, shell: false, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
  })
  if (result.status !== 0) throw new Error('fixture git command failed')
  return result.stdout.replace(/\r?\n$/u, '')
}
function fixture(options = {}) {
  sequence += 1
  const root = options.root ?? tempRoot('d2-crash-state-')
  chmodSync(root, 0o700)
  const origin = join(tempRoot('d2-crash-origin-'), 'origin.git')
  const clone = join(tempRoot('d2-crash-clone-'), 'clone')
  git(dirname(origin), ['init', '--bare', origin])
  git(dirname(clone), ['clone', origin, clone])
  git(clone, ['config', 'user.name', 'D2 Crash Fixture'])
  git(clone, ['config', 'user.email', 'd2-crash@example.invalid'])
  const branch = `fixture/crash-${sequence}`
  git(clone, ['checkout', '-b', branch])
  writeFileSync(join(clone, 'tracked.txt'), `fixture-${sequence}\n`)
  git(clone, ['add', 'tracked.txt'])
  git(clone, ['commit', '-m', `fixture ${sequence}`])
  const output = tempRoot('d2-crash-output-')
  return Object.freeze({
    root,
    input: Object.freeze({
      stateRoot: root,
      taskId: `crash-task-${sequence}`,
      branch,
      baselineOid: git(clone, ['rev-parse', 'HEAD']),
      cloneRoot: clone,
      evidenceOut: join(output, `evidence-${sequence}.json`),
      archiveOut: join(output, `archive-${sequence}`),
    }),
  })
}
function id(value) { return value.toString(16).padStart(32, '0') }
function adapters(ids, fault = () => {}) {
  const randomIds = [...ids]
  const testOverrides = Object.freeze({
    randomId: () => randomIds.shift(),
    now: () => new Date('2026-08-01T00:05:00.000Z'),
    filesystemKind: () => 0xef53n,
    fault,
  })
  assert.deepEqual(Object.keys(testOverrides).sort(), ['fault', 'filesystemKind', 'now', 'randomId'])
  return Object.freeze({ ...runtimeAdapters, ...testOverrides })
}
function expectCode(code, action) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof GovernanceError, true)
    assert.equal(error.code, code)
    assert.equal(error.message, code)
    return true
  })
}
function manifestCount(root) {
  const directory = join(root, 'manifests')
  return existsSync(directory) ? readdirSync(directory).length : 0
}
function leafPaths(root) {
  const leaves = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else leaves.push(path)
    }
  }
  walk(root)
  return leaves.sort()
}
function copyState(source) {
  const parent = tempRoot('d2-crash-copy-')
  const target = join(parent, 'state')
  cpSync(source, target, { recursive: true })
  const normalizeModes = (path) => {
    chmodSync(path, 0o700)
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) normalizeModes(child)
      else chmodSync(child, 0o600)
    }
  }
  normalizeModes(target)
  return target
}
function rewriteCanonical(path, mutate) {
  const value = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, `${canonicalJson(mutate(value))}\n`, { flag: 'w', mode: 0o600 })
  chmodSync(path, 0o600)
}
function removeReservationLeaf(root, segment) {
  const path = leafPaths(root).find((candidate) => candidate.includes(segment))
  assert.ok(path)
  unlinkSync(path)
}
function startWorker(input, gate, workerIndex) {
  const worker = new Worker(new URL('./reservation-worker-fixture.mjs', import.meta.url), {
    workerData: {
      gate,
      input,
      now: '2026-08-01T00:06:00.000Z',
      randomIds: [id(0x100 + workerIndex), id(0x200 + workerIndex), id(0x300 + workerIndex)],
    },
  })
  let result
  const ready = new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.on('message', (message) => {
      if (message.kind === 'ready') resolve()
      if (message.kind === 'result') result = message
    })
  })
  const done = new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('exit', (exitCode) => resolve(Object.freeze({ exitCode, result })))
  })
  return Object.freeze({ ready, done })
}

test('sixteen workers racing one independent clone produce exactly one complete reservation', async () => {
  const value = fixture()
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const workers = Array.from({ length: 16 }, (_, index) => startWorker(value.input, gate, index))
  await Promise.all(workers.map(({ ready }) => ready))
  Atomics.store(new Int32Array(gate), 0, 1)
  Atomics.notify(new Int32Array(gate), 0, workers.length)
  const outcomes = await Promise.all(workers.map(({ done }) => done))
  const winners = outcomes.filter(({ exitCode, result }) => exitCode === 0 && result?.ok)
  const losers = outcomes.filter(({ exitCode, result }) => exitCode === 2 && result?.ok === false)
  assert.equal(winners.length, 1)
  assert.equal(losers.length, 15)
  assert.equal(manifestCount(value.root), 1)
  for (const { result } of losers) assert.equal(Object.values(ERROR_CODES).includes(result.code), true)
  const state = loadGovernanceState(value.root, adapters([id(0x900), id(0x901), id(0x902)]))
  assert.equal(state.completeReservations.size, 1)
})

test('every reservation commit point leaves only an auditable immutable prefix after a crash', () => {
  for (const [index, commitPoint] of COMMIT_POINTS.entries()) {
    const value = fixture()
    const fault = (point) => {
      if (point === `after-${commitPoint}`) throw new Error('CRASH_CANARY')
    }
    expectCode(ERROR_CODES.GOVERNANCE_STATE,
      () => reserveExecution(value.input, adapters([id(0x1000 + index), id(0x1100 + index), id(0x1200 + index)], fault)))
    const committedLeaves = leafPaths(value.root).map((path) => path.slice(value.root.length + 1))
    const state = loadGovernanceState(
      value.root, adapters([id(0x2000 + index), id(0x2100 + index), id(0x2200 + index)]),
    )
    assert.deepEqual(
      leafPaths(value.root).map((path) => path.slice(value.root.length + 1)), committedLeaves,
    )
    assert.equal(state.reservations.size, 1)
    assert.equal(state.completeReservations.size, commitPoint === 'event:RESERVED' ? 1 : 0)
    const expectedFacets = commitPoint.startsWith('facet:')
      ? FACETS.indexOf(commitPoint.slice('facet:'.length)) + 1
      : ['manifest', 'event:RESERVED'].includes(commitPoint) ? FACETS.length : 0
    assert.equal(state.identities.size, expectedFacets)
    if (expectedFacets > 0) {
      expectCode(ERROR_CODES.ALREADY_RESERVED, () => reserveExecution(
        value.input, adapters([id(0x3000 + index), id(0x3100 + index), id(0x3200 + index)]),
      ))
    } else {
      expectCode(ERROR_CODES.WRITE, () => reserveExecution(
        value.input,
        adapters([id(0x1000 + index), id(0x3300 + index), id(0x3400 + index)]),
      ))
    }
  }
})

test('every tombstone, manifest, and event corruption blocks all new reservations with LEDGER', () => {
  const owner = fixture()
  reserveExecution(owner.input, adapters([id(0x4000), id(0x4001), id(0x4002)]))
  const candidate = fixture()
  const originalLeaves = leafPaths(owner.root)
  assert.equal(originalLeaves.length, 10)
  for (const [leafIndex, original] of originalLeaves.entries()) {
    const relative = original.slice(owner.root.length + 1)
    for (const corruption of ['truncate', 'mode', 'hardlink']) {
      const root = copyState(owner.root)
      const target = join(root, relative)
      if (corruption === 'truncate') writeFileSync(target, '{', { flag: 'w' })
      if (corruption === 'mode') chmodSync(target, 0o640)
      if (corruption === 'hardlink') linkSync(target, join(dirname(target), `.hardlink-${basename(target)}`))
      expectCode(ERROR_CODES.LEDGER, () => reserveExecution(
        { ...candidate.input, stateRoot: root },
        adapters([id(0x5000 + leafIndex), id(0x5100 + leafIndex), id(0x5200 + leafIndex)]),
      ))
    }
  }
})

test('orphan manifest is LEDGER before any same-identity reservation write', () => {
  const owner = fixture()
  reserveExecution(owner.input, adapters([id(0x5800), id(0x5801), id(0x5802)]))
  const root = copyState(owner.root)
  for (const path of leafPaths(root)) {
    if (!path.includes('/manifests/')) unlinkSync(path)
  }
  const leaves = leafPaths(root)
  assert.equal(leaves.length, 1)
  assert.equal(leaves[0].includes('/manifests/'), true)
  const payload = parseManifestPayload(JSON.parse(readFileSync(leaves[0], 'utf8')))
  assert.match(sha256(canonicalJson(payload)), /^[0-9a-f]{64}$/u)
  const before = leaves.map((path) => path.slice(root.length + 1))

  expectCode(ERROR_CODES.LEDGER,
    () => loadGovernanceState(root, adapters([id(0x5810)])))
  assert.deepEqual(leafPaths(root).map((path) => path.slice(root.length + 1)), before)
  expectCode(ERROR_CODES.LEDGER, () => reserveExecution(
    { ...owner.input, stateRoot: root }, adapters([id(0x5820), id(0x5821), id(0x5822)]),
  ))
  assert.deepEqual(leafPaths(root).map((path) => path.slice(root.length + 1)), before)
})

test('governance state builds fresh read-only maps and validates all cross-record relations', () => {
  const owner = fixture()
  reserveExecution(owner.input, adapters([id(0x6000), id(0x6001), id(0x6002)]))
  const first = loadGovernanceState(owner.root, adapters([id(0x6100), id(0x6101), id(0x6102)]))
  const second = loadGovernanceState(owner.root, adapters([id(0x6200), id(0x6201), id(0x6202)]))
  assert.deepEqual([
    first.reservations.size, first.identities.size, first.manifests.size,
    first.events.size, first.invocations.size, first.completeReservations.size,
  ], [1, 6, 1, 2, 0, 1])
  for (const name of ['reservations', 'identities', 'manifests', 'events', 'invocations', 'completeReservations']) {
    assert.notEqual(first[name], second[name])
    assert.equal(first[name].set, undefined)
    assert.equal(Object.isFrozen(first[name]), true)
  }
  const reservationId = [...first.completeReservations.keys()][0]
  assert.equal(first.reservations.has(reservationId), true)
  assert.equal([...first.reservations].length, 1)
  assert.equal([...first.reservations.entries()].length, 1)
  assert.equal([...first.reservations.values()].length, 1)
  const visited = []
  first.reservations.forEach((value, key, map) => visited.push([value.reservationId, key, map.size]))
  assert.deepEqual(visited, [[reservationId, reservationId, 1]])

  const orphanIdentity = copyState(owner.root)
  const taskIdentity = leafPaths(orphanIdentity).find((path) => path.includes('/by-task/'))
  rewriteCanonical(taskIdentity, (value) => ({ ...value, reservationId: 'f'.repeat(32) }))
  expectCode(ERROR_CODES.LEDGER, () => loadGovernanceState(orphanIdentity, adapters([id(0x6300)])))

  const missingFacet = copyState(owner.root)
  removeReservationLeaf(missingFacet, '/by-archive/')
  expectCode(ERROR_CODES.LEDGER, () => loadGovernanceState(missingFacet, adapters([id(0x6400)])))

  const brokenDigest = copyState(owner.root)
  const intent = leafPaths(brokenDigest).find((path) => path.includes('/by-reservation/'))
  rewriteCanonical(intent, (value) => ({ ...value, manifestDigest: '0'.repeat(64) }))
  expectCode(ERROR_CODES.LEDGER, () => loadGovernanceState(brokenDigest, adapters([id(0x6500)])))

  const missingManifest = copyState(owner.root)
  removeReservationLeaf(missingManifest, '/manifests/')
  expectCode(ERROR_CODES.LEDGER, () => loadGovernanceState(missingManifest, adapters([id(0x6600)])))

  const missingIntent = copyState(owner.root)
  removeReservationLeaf(missingIntent, '/by-reservation/')
  expectCode(ERROR_CODES.LEDGER, () => loadGovernanceState(missingIntent, adapters([id(0x6700)])))

  const eventIdentityDrift = copyState(owner.root)
  const driftedEvent = leafPaths(eventIdentityDrift).find((path) => {
    if (!path.includes('/events/')) return false
    return JSON.parse(readFileSync(path, 'utf8')).kind === 'RESERVED'
  })
  rewriteCanonical(driftedEvent, (value) => ({
    ...value, identityHashes: { ...value.identityHashes, task: '0'.repeat(64) },
  }))
  expectCode(ERROR_CODES.LEDGER,
    () => loadGovernanceState(eventIdentityDrift, adapters([id(0x6725)])))

  const invocationPrefix = copyState(owner.root)
  const manifest = first.manifests.get(reservationId)
  writeExclusiveJson(join(invocationPrefix, 'invocations', `${reservationId}.json`), {
    schemaVersion: 1, kind: 'INVOCATION', reservationId,
    manifestDigest: manifest.digest, createdAt: '2026-08-01T00:07:00.000Z',
  }, adapters([id(0x6750)]))
  assert.equal(loadGovernanceState(invocationPrefix, adapters([id(0x6751)])).invocations.size, 1)

  const invokedWithoutTombstone = copyState(owner.root)
  const reservedEvent = leafPaths(invokedWithoutTombstone).find((path) => {
    if (!path.includes('/events/')) return false
    return JSON.parse(readFileSync(path, 'utf8')).kind === 'RESERVED'
  })
  rewriteCanonical(reservedEvent, (value) => ({ ...value, kind: 'INVOKED' }))
  expectCode(ERROR_CODES.LEDGER,
    () => loadGovernanceState(invokedWithoutTombstone, adapters([id(0x6760)])))

  const nonPrefix = fixture()
  expectCode(ERROR_CODES.GOVERNANCE_STATE, () => reserveExecution(
    nonPrefix.input,
    adapters([id(0x6800), id(0x6801), id(0x6802)], (point) => {
      if (point === 'after-facet:baseline') throw new Error('PREFIX_CRASH')
    }),
  ))
  removeReservationLeaf(nonPrefix.root, '/by-branch/')
  expectCode(ERROR_CODES.LEDGER, () => loadGovernanceState(nonPrefix.root, adapters([id(0x6900)])))
})

after(() => {
  for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true })
  console.log('D2_PRIME_GOVERNANCE_CRASH_ALL_PASS')
})
