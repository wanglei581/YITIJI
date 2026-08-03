#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { ERROR_CODES, GovernanceError, canonicalJson, sha256 } from './governance-contract.mjs'
import {
  canonicalFutureTarget, captureCloneSnapshot, ensureLayout, loadReservationState,
  reserveExecution, runtimeAdapters, writeExclusiveJson,
} from './governance.mjs'
import {
  createManifestPayload, loadReservationState as parseReservationRecords,
} from './governance-reservation.mjs'

const roots = []
const FACETS = Object.freeze(['task', 'branch', 'baseline', 'clone', 'evidence', 'archive'])
const MANIFEST_KEYS = Object.freeze([
  'schemaVersion', 'reservationId', 'taskId', 'branch', 'baselineOid', 'clone',
  'evidenceOut', 'archiveOut', 'identityHashes', 'createdAt',
])
const CLONE_KEYS = Object.freeze(['realpath', 'dev', 'ino', 'branch', 'headOid', 'treeOid', 'clean'])

function tempRoot(prefix = 'd2-reservation-') {
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
let fixtureSequence = 0
function reserveFixture(options = {}) {
  fixtureSequence += 1
  const sequence = fixtureSequence
  const root = options.root ?? tempRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  chmodSync(root, 0o700)
  const origin = join(tempRoot('d2-reservation-origin-'), 'origin.git')
  const clone = options.clone ?? join(tempRoot('d2-reservation-clone-'), 'clone')
  git(dirname(origin), ['init', '--bare', origin])
  git(dirname(clone), ['clone', origin, clone])
  git(clone, ['config', 'user.name', 'D2 Fixture'])
  git(clone, ['config', 'user.email', 'd2@example.invalid'])
  const branch = options.branch ?? `fixture/reservation-${sequence}`
  git(clone, ['checkout', '-b', branch])
  writeFileSync(join(clone, 'tracked.txt'), `fixture-${sequence}\n`)
  git(clone, ['add', 'tracked.txt'])
  git(clone, ['commit', '-m', `fixture ${sequence}`])
  const baselineOid = git(clone, ['rev-parse', 'HEAD'])
  const outputRoot = tempRoot('d2-reservation-output-')
  const input = Object.freeze({
    stateRoot: root,
    taskId: options.taskId ?? `raw-task-canary-${sequence}`,
    branch,
    baselineOid,
    cloneRoot: clone,
    evidenceOut: options.evidenceOut ?? join(outputRoot, `RAW_PATH_CANARY_${sequence}.json`),
    archiveOut: options.archiveOut ?? join(outputRoot, `RAW_ARCHIVE_CANARY_${sequence}`),
  })
  const reservationId = sequence.toString(16).padStart(32, '0')
  const adapters = Object.freeze({
    ...runtimeAdapters, fault: () => {}, randomId: () => reservationId,
    now: () => new Date(`2026-08-01T00:00:${String(sequence % 60).padStart(2, '0')}.000Z`),
  })
  return Object.freeze({ root, clone, input, adapters, reservationId })
}
function expectCode(code, action, canaries = []) {
  assert.throws(action, (error) => {
    assert.equal(error.name, 'GovernanceError')
    assert.equal(error.code, code)
    assert.equal(error.message, code)
    const exposed = `${error.name}\n${error.code}\n${error.message}`
    for (const canary of canaries) assert.equal(exposed.includes(canary), false)
    return true
  })
}
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function reservationIntentCount(root) {
  const directory = join(root, 'reservations', 'by-reservation')
  return existsSync(directory) ? readdirSync(directory).length : 0
}
function candidatePayload(fixture, reservationId = 'f'.repeat(32)) {
  ensureLayout(fixture.root, fixture.adapters)
  const snapshot = captureCloneSnapshot(
    fixture.clone, fixture.input.branch, fixture.input.baselineOid, fixture.adapters,
  )
  const evidence = canonicalFutureTarget(
    fixture.input.evidenceOut, ERROR_CODES.ALREADY_RESERVED, fixture.adapters,
  )
  const archive = canonicalFutureTarget(
    fixture.input.archiveOut, ERROR_CODES.ARCHIVE_EXISTS, fixture.adapters,
  )
  return createManifestPayload(
    fixture.input, snapshot, evidence, archive, reservationId, '2026-08-01T00:01:00.000Z',
  )
}
function seedFacetCollision(fixture, facet) {
  const ownerId = 'f'.repeat(32)
  const payload = candidatePayload(fixture, ownerId)
  const manifestDigest = sha256(canonicalJson(payload))
  const facetIndex = FACETS.indexOf(facet)
  const ownerHashes = Object.freeze(Object.fromEntries(FACETS.map((name, index) => [
    name, index < facetIndex ? sha256(`owner:${facet}:${name}`) : payload.identityHashes[name],
  ])))
  writeExclusiveJson(join(fixture.root, 'reservations', 'by-reservation', `${ownerId}.json`), {
    schemaVersion: 1, kind: 'RESERVATION_INTENT', reservationId: ownerId,
    manifestDigest, createdAt: '2026-08-01T00:01:00.000Z',
  }, fixture.adapters)
  const eventId = `0000000000000000-${ownerId}`
  writeExclusiveJson(join(fixture.root, 'events', `${eventId}.json`), {
    schemaVersion: 1, eventId, kind: 'RESERVE_INTENT', outcome: 'RECORDED',
    reservationId: ownerId, identityHashes: ownerHashes,
    createdAt: '2026-08-01T00:01:00.000Z',
  }, fixture.adapters)
  for (const prefixFacet of FACETS.slice(0, facetIndex + 1)) {
    writeExclusiveJson(
      join(fixture.root, 'reservations', `by-${prefixFacet}`, `${ownerHashes[prefixFacet]}.json`),
      {
        schemaVersion: 1, kind: 'IDENTITY', facet: prefixFacet,
        identityHash: ownerHashes[prefixFacet], reservationId: ownerId,
        manifestDigest, createdAt: '2026-08-01T00:01:00.000Z',
      },
      fixture.adapters,
    )
  }
}

test('reservation writes one strict immutable manifest and redacted events', () => {
  const fixture = reserveFixture()
  const committedFacets = []
  const adapters = Object.freeze({ ...fixture.adapters, fault: (point, path) => {
    if (point === 'after-identity-file-sync') committedFacets.push(dirname(path).split('/').at(-1))
  } })
  const result = reserveExecution(fixture.input, adapters)
  assert.deepEqual(result, { reservationId: fixture.reservationId })
  assert.equal(Object.isFrozen(result), true)

  const manifestPath = join(fixture.root, 'manifests', `${fixture.reservationId}.json`)
  const manifest = readJson(manifestPath)
  assert.deepEqual(Object.keys(manifest).sort(), [...MANIFEST_KEYS].sort())
  assert.deepEqual(Object.keys(manifest.clone).sort(), [...CLONE_KEYS].sort())
  assert.deepEqual(Object.keys(manifest.identityHashes).sort(), [...FACETS].sort())
  assert.deepEqual(committedFacets, FACETS.map((facet) => `by-${facet}`))
  assert.equal(statSync(manifestPath).mode & 0o777, 0o600)
  assert.equal(statSync(manifestPath).nlink, 1)
  assert.equal(Object.hasOwn(manifest, 'digest'), false)

  const eventText = readdirSync(join(fixture.root, 'events'))
    .map((name) => readFileSync(join(fixture.root, 'events', name), 'utf8')).join('\n')
  for (const canary of [
    fixture.input.taskId, fixture.input.branch, fixture.input.baselineOid, fixture.input.cloneRoot,
    fixture.input.evidenceOut, fixture.input.archiveOut,
  ]) assert.equal(eventText.includes(canary), false)

  const state = loadReservationState(fixture.root, adapters)
  const memoryManifest = state.manifests.get(fixture.reservationId)
  assert.equal(memoryManifest.digest, sha256(canonicalJson(manifest)))
  assert.equal(Object.isFrozen(memoryManifest), true)
  assert.equal(Object.isFrozen(memoryManifest.payload), true)
  assert.equal(Object.hasOwn(memoryManifest.payload, 'digest'), false)
})

test('each reservation identity facet is consumed once with fixed collision mapping', () => {
  for (const facet of FACETS) {
    const fixture = reserveFixture()
    seedFacetCollision(fixture, facet)
    expectCode(ERROR_CODES.ALREADY_RESERVED, () => reserveExecution(fixture.input, fixture.adapters), [
      fixture.input.taskId, fixture.input.branch, fixture.input.baselineOid,
      fixture.input.cloneRoot, fixture.input.evidenceOut, fixture.input.archiveOut,
    ])
  }
})

test('only target-create EEXIST maps to ALREADY_RESERVED', () => {
  const fixture = reserveFixture()
  const adapters = Object.freeze({ ...fixture.adapters, syncDirectory: (fd, parent) => {
    if (parent.endsWith('/by-task')) {
      const error = new Error('SYNC_EEXIST_CANARY'); error.code = 'EEXIST'; throw error
    }
    runtimeAdapters.syncDirectory(fd, parent)
  } })
  expectCode(ERROR_CODES.WRITE, () => reserveExecution(fixture.input, adapters), [
    'SYNC_EEXIST_CANARY', fixture.input.taskId, fixture.input.cloneRoot,
  ])
})

test('post-create ALREADY_RESERVED faults map to WRITE', () => {
  const fixture = reserveFixture()
  const adapters = Object.freeze({ ...fixture.adapters, fault: (point) => {
    if (point === 'after-identity-file-sync') {
      throw new GovernanceError(ERROR_CODES.ALREADY_RESERVED)
    }
  } })
  expectCode(ERROR_CODES.WRITE, () => reserveExecution(fixture.input, adapters), [
    fixture.input.taskId, fixture.input.cloneRoot,
  ])
})

test('identity tombstone readback rejects equal-length write corruption', () => {
  const fixture = reserveFixture()
  let writes = 0
  const adapters = Object.freeze({ ...fixture.adapters, writeContext: (fd, payload) => {
    writes += 1
    if (writes !== 3) return runtimeAdapters.writeContext(fd, payload)
    const corrupted = Buffer.from(payload)
    corrupted[0] = corrupted[0] === 0x7b ? 0x5b : 0x7b
    return runtimeAdapters.writeContext(fd, corrupted)
  } })
  expectCode(ERROR_CODES.WRITE, () => reserveExecution(fixture.input, adapters), [
    fixture.input.taskId, fixture.input.cloneRoot,
  ])
  assert.equal(writes, 3)
})

test('event ids include controllable monotonic and random components without raw values', () => {
  const fixture = reserveFixture()
  const eventRandom = ['a'.repeat(32), 'b'.repeat(32)]
  const randomIds = [fixture.reservationId, ...eventRandom]
  const monotonicTimes = [0x12n, 0x13n]
  const adapters = Object.freeze({
    ...fixture.adapters,
    randomId: () => randomIds.shift(),
    monotonicTime: () => monotonicTimes.shift(),
  })
  reserveExecution(fixture.input, adapters)
  const events = readdirSync(join(fixture.root, 'events'))
    .map((name) => readJson(join(fixture.root, 'events', name)))
    .sort((left, right) => left.eventId.localeCompare(right.eventId))
  assert.deepEqual(events.map(({ eventId }) => eventId), [
    `0000000000000012-${eventRandom[0]}`,
    `0000000000000013-${eventRandom[1]}`,
  ])
  for (const event of events) {
    const text = canonicalJson(event)
    for (const canary of [
      fixture.input.taskId, fixture.input.branch, fixture.input.baselineOid,
      fixture.input.cloneRoot, fixture.input.evidenceOut, fixture.input.archiveOut,
    ]) assert.equal(text.includes(canary), false)
  }
})

test('reservation validates string timestamps, event id components, and unexpected adapter failures', () => {
  const stringTime = reserveFixture()
  assert.deepEqual(reserveExecution(stringTime.input, Object.freeze({
    ...stringTime.adapters, now: () => '2026-08-01T00:30:00.000Z',
  })), { reservationId: stringTime.reservationId })

  const invalidTime = reserveFixture()
  expectCode(ERROR_CODES.WRITE, () => reserveExecution(invalidTime.input, Object.freeze({
    ...invalidTime.adapters, now: () => 'invalid-time',
  })))
  assert.equal(reservationIntentCount(invalidTime.root), 0)

  const eventCases = [
    { monotonicTime: () => '1' }, { monotonicTime: () => -1n },
    { monotonicTime: () => 0x10000000000000000n },
    { eventRandom: () => 123 }, { eventRandom: () => 'bad' },
    { monotonicTime: () => { throw new Error('EVENT_CANARY') } },
    { monotonicTime: () => { throw new GovernanceError(ERROR_CODES.WRITE) } },
  ]
  for (const eventCase of eventCases) {
    const fixture = reserveFixture(); let randomCalls = 0
    const adapters = Object.freeze({
      ...fixture.adapters,
      ...eventCase,
      randomId: () => {
        randomCalls += 1
        return randomCalls === 1 ? fixture.reservationId
          : eventCase.eventRandom ? eventCase.eventRandom() : fixture.reservationId
      },
    })
    expectCode(ERROR_CODES.WRITE, () => reserveExecution(fixture.input, adapters))
    assert.equal(reservationIntentCount(fixture.root), 1)
  }

  const unexpected = reserveFixture()
  expectCode(ERROR_CODES.GOVERNANCE_STATE, () => reserveExecution(unexpected.input, Object.freeze({
    ...unexpected.adapters, randomId: () => { throw new Error('RESERVATION_CANARY') },
  })))
  assert.equal(reservationIntentCount(unexpected.root), 0)
})

test('a pre-existing archive target is ARCHIVE_EXISTS and creates no intent', () => {
  const fixture = reserveFixture()
  mkdirSync(fixture.input.archiveOut)
  expectCode(ERROR_CODES.ARCHIVE_EXISTS, () => reserveExecution(fixture.input, fixture.adapters))
  assert.equal(reservationIntentCount(fixture.root), 0)
})

test('governance root overlap fails before any reservation intent', () => {
  for (const relation of ['equal', 'contains', 'contained']) {
    for (const target of ['clone', 'evidence', 'archive', 'cleanup']) {
      const fixture = reserveFixture()
      const candidate = target === 'clone' ? fixture.input.cloneRoot
        : target === 'evidence' ? fixture.input.evidenceOut
          : target === 'archive' ? fixture.input.archiveOut
            : join(fixture.input.cloneRoot, 'services/api/scripts/d2-same-host/.work')
      const stateRoot = relation === 'equal' ? candidate
        : relation === 'contains' ? dirname(candidate) : join(candidate, 'governance')
      if (!existsSync(stateRoot)) mkdirSync(stateRoot, { recursive: true })
      chmodSync(stateRoot, 0o700)
      const input = { ...fixture.input, stateRoot }
      if (target === 'clone') input.cloneRoot = relation === 'equal' ? stateRoot
        : relation === 'contains' ? join(stateRoot, 'clone') : dirname(stateRoot)
      if (target === 'evidence') input.evidenceOut = relation === 'equal' ? stateRoot
        : relation === 'contains' ? join(stateRoot, 'evidence.json') : dirname(stateRoot)
      if (target === 'archive') input.archiveOut = relation === 'equal' ? stateRoot
        : relation === 'contains' ? join(stateRoot, 'archive') : dirname(stateRoot)
      expectCode(ERROR_CODES.GOVERNANCE_STATE, () => reserveExecution(input, fixture.adapters))
      assert.equal(reservationIntentCount(stateRoot), 0)
    }
  }
})

test('manifest schema rejects unknown disk fields and digest is never persisted', () => {
  const fixture = reserveFixture()
  const payload = candidatePayload(fixture)
  writeExclusiveJson(join(fixture.root, 'manifests', `${payload.reservationId}.json`), {
    ...payload, digest: sha256(canonicalJson(payload)),
  }, fixture.adapters)
  expectCode(ERROR_CODES.LEDGER, () => loadReservationState(fixture.root, fixture.adapters))
})

test('manifest schema does not coerce clone identity scalar types', () => {
  const fixture = reserveFixture()
  const payload = candidatePayload(fixture)
  writeExclusiveJson(join(fixture.root, 'manifests', `${payload.reservationId}.json`), {
    ...payload, clone: { ...payload.clone, dev: Number(payload.clone.dev) },
  }, fixture.adapters)
  expectCode(ERROR_CODES.LEDGER, () => loadReservationState(fixture.root, fixture.adapters))
})

test('manifest schema binds every identity hash to its canonical raw value', () => {
  const fixture = reserveFixture()
  const payload = candidatePayload(fixture)
  writeExclusiveJson(join(fixture.root, 'manifests', `${payload.reservationId}.json`), {
    ...payload,
    identityHashes: { ...payload.identityHashes, task: '0'.repeat(64) },
  }, fixture.adapters)
  expectCode(ERROR_CODES.LEDGER, () => loadReservationState(fixture.root, fixture.adapters))
})

test('manifest ledger rejects non-canonical absolute clone and output paths', () => {
  const fixture = reserveFixture()
  const payload = candidatePayload(fixture)
  const nonCanonical = '/tmp/a/../b'
  for (const field of ['clone', 'evidence', 'archive']) {
    const clone = field === 'clone' ? { ...payload.clone, realpath: nonCanonical } : payload.clone
    const evidenceOut = field === 'evidence' ? nonCanonical : payload.evidenceOut
    const archiveOut = field === 'archive' ? nonCanonical : payload.archiveOut
    const identityHashes = { ...payload.identityHashes }
    const facetValue = field === 'clone' ? clone
      : field === 'evidence' ? evidenceOut : archiveOut
    identityHashes[field] = sha256(canonicalJson({
      schemaVersion: 1, facet: field, value: facetValue,
    }))
    const invalid = {
      ...payload, clone, evidenceOut, archiveOut, identityHashes,
    }
    expectCode(ERROR_CODES.LEDGER, () => parseReservationRecords({
      root: fixture.root,
      records: Object.freeze([Object.freeze({
        path: join('manifests', `${payload.reservationId}.json`), value: invalid,
      })]),
    }))
  }
})

after(() => {
  for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true })
})
