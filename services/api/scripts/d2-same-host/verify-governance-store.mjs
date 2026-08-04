#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  chmodSync, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, statfsSync, symlinkSync, writeFileSync, writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { ERROR_CODES, fail } from './governance-contract.mjs'
import {
  assertSeparatedRoots, ensureLayout, isApprovedLocalFilesystem, loadGovernanceRecords,
  runtimeAdapters, validateGovernanceRoot, writeExclusiveJson,
} from './governance.mjs'

const FIXED_LEAVES = [
  'by-reservation', 'by-task', 'by-branch', 'by-baseline', 'by-clone', 'by-evidence',
  'by-archive',
].map((name) => `reservations/${name}`).concat('invocations', 'manifests', 'events')
function withTempRoot(action) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'd2-governance-'))
  chmodSync(root, 0o700)
  try { return action(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
function runtimeTestAdapters(overrides = {}) {
  const events = []
  return Object.freeze({
    effectiveUid: () => process.geteuid(), filesystemKind: () => 0xef53n,
    syncDirectory: (fd, path) => events.push(['sync-directory', path, fd]),
    fault: (point, path) => events.push([point, path]), events, ...overrides,
  })
}
function expectGovernanceCode(code, action, canary = '') {
  assert.throws(action, (error) => {
    assert.equal(error.name, 'GovernanceError')
    assert.equal(error.code, code)
    assert.equal(error.message, code)
    if (canary) assert.equal(`${error.name}\n${error.message}`.includes(canary), false)
    return true
  })
}
function hostileAdapterCases() {
  const ownKeysCanary = 'ADAPTER_OWN_KEYS_CANARY'
  const getterCanary = 'ADAPTER_ENUMERABLE_GETTER_CANARY'
  const getterAdapters = {}
  Object.defineProperty(getterAdapters, 'fault', {
    enumerable: true,
    get: () => { throw new Error(getterCanary) },
  })
  return [
    [ownKeysCanary, new Proxy({}, { ownKeys: () => { throw new Error(ownKeysCanary) } })],
    [getterCanary, getterAdapters],
  ]
}
function capturedCode(action) {
  try { action(); return null } catch (error) { return error instanceof Error ? error.code : null }
}
function writeLeaf(root, relativePath, contents, mode = 0o600) {
  const path = join(root, relativePath)
  writeFileSync(path, contents, { mode })
  return path
}

let completed = 0
test('governance root must be canonical, private, owned, local, and pre-existing', () => {
  withTempRoot((root) => {
    assert.equal(Object.isFrozen(runtimeAdapters), true)
    assert.equal(runtimeAdapters.effectiveUid(), process.geteuid())
    assert.equal(typeof runtimeAdapters.filesystemKind(root), 'number')
    assert.match(runtimeAdapters.randomId(), /^[0-9a-f]{32}$/)
    assert.equal(runtimeAdapters.now() instanceof Date, true)
    assert.equal(validateGovernanceRoot(root, runtimeTestAdapters()), root)
    expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => validateGovernanceRoot(`${root}\n`))
    expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => validateGovernanceRoot(`${root}\n`, null))
    for (const [index, [canary, adapters]] of hostileAdapterCases().entries()) {
      expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE,
        () => validateGovernanceRoot(root, adapters), canary)
      expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE,
        () => ensureLayout(root, adapters), canary)
      const writePath = join(root, 'events', `hostile-${index}.json`)
      expectGovernanceCode(ERROR_CODES.WRITE,
        () => writeExclusiveJson(writePath, { hostile: true }, adapters), canary)
      assert.equal(existsSync(writePath), false)
      expectGovernanceCode(ERROR_CODES.LEDGER,
        () => loadGovernanceRecords(root, adapters), canary)
    }
    const preservedAdapters = {}
    Object.defineProperty(preservedAdapters, 'fault', {
      enumerable: true,
      get: () => fail(ERROR_CODES.GIT_IDENTITY),
    })
    expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE,
      () => validateGovernanceRoot(root, preservedAdapters))
    for (const magic of [0xef53n, 0x58465342n, 0x9123683en, 0x1an]) {
      assert.equal(isApprovedLocalFilesystem(magic), true)
    }
    assert.equal(isApprovedLocalFilesystem(0x794c7630n), false)
    for (const candidate of [join(root, 'missing'), `${root}/../${root.split('/').at(-1)}`, `${root}\0`, `${root}\r`, `${root}\n`]) {
      expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => validateGovernanceRoot(candidate, runtimeTestAdapters()))
    }
    expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => validateGovernanceRoot(root,
      runtimeTestAdapters({ effectiveUid: () => process.geteuid() + 1 })))
    chmodSync(root, 0o755)
    expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => validateGovernanceRoot(root, runtimeTestAdapters()))
    chmodSync(root, 0o700)
    expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => validateGovernanceRoot(writeLeaf(root, 'plain', '{}\n'), runtimeTestAdapters()))
  })
  withTempRoot((root) => {
    const link = `${root}-link`; symlinkSync(root, link)
    try {
      expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => validateGovernanceRoot(link, runtimeTestAdapters()))
      expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => validateGovernanceRoot(root,
        runtimeTestAdapters({ filesystemKind: () => 0xdeadbeefn })))
    } finally { rmSync(link, { force: true }) }
  })
  if (process.platform === 'darwin') withTempRoot((root) => assert.equal(BigInt(statfsSync(root).type), 0x1an))
  completed += 1
})
test('layout creates only private owned real fixed directories and rejects drift', () => {
  withTempRoot((root) => {
    ensureLayout(root, runtimeTestAdapters())
    for (const relative of FIXED_LEAVES) {
      const stat = lstatSync(join(root, relative))
      assert.equal(stat.isDirectory(), true); assert.equal(stat.isSymbolicLink(), false)
      assert.equal(stat.uid, process.geteuid()); assert.equal(stat.mode & 0o777, 0o700)
    }
  })
  for (const drift of ['unknown', 'symlink', 'file', 'mode', 'leaf-directory', 'leaf-symlink']) withTempRoot((root) => {
    ensureLayout(root, runtimeTestAdapters())
    if (drift === 'unknown') mkdirSync(join(root, 'other'), { mode: 0o700 })
    if (drift === 'symlink') { rmSync(join(root, 'events'), { recursive: true }); symlinkSync(join(root, 'manifests'), join(root, 'events')) }
    if (drift === 'file') { rmSync(join(root, 'events'), { recursive: true }); writeLeaf(root, 'events', '') }
    if (drift === 'mode') chmodSync(join(root, 'events'), 0o755)
    if (drift === 'leaf-directory') mkdirSync(join(root, 'events', 'unexpected'), { mode: 0o700 })
    if (drift === 'leaf-symlink') symlinkSync(join(root, 'manifests'), join(root, 'events', 'unexpected-link'))
    expectGovernanceCode(ERROR_CODES.LEDGER, () => ensureLayout(root, runtimeTestAdapters()))
  })
  completed += 1
})
test('exclusive JSON writes canonical durable files and never overwrites or rolls back', () => {
  withTempRoot((root) => {
    ensureLayout(root, runtimeTestAdapters())
    const path = join(root, 'events', 'event.json'); const adapters = runtimeTestAdapters()
    writeExclusiveJson(path, { z: 2, a: 1 }, adapters)
    const stat = lstatSync(path)
    assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1)
    assert.equal(readFileSync(path, 'utf8'), '{"a":1,"z":2}\n')
    assert.deepEqual(adapters.events.map(([event]) => event), ['after-file-sync', 'sync-directory'])
    expectGovernanceCode(ERROR_CODES.WRITE, () => writeExclusiveJson(path, { replaced: true }, adapters))
    assert.equal(readFileSync(path, 'utf8'), '{"a":1,"z":2}\n')
    const realSyncPath = join(root, 'events', 'real-sync.json')
    writeExclusiveJson(realSyncPath, { real: true }, runtimeTestAdapters({ syncDirectory: runtimeAdapters.syncDirectory }))
    assert.equal(loadGovernanceRecords(root, runtimeTestAdapters()).records.length, 2)
  })
  const failures = ['fault', 'governance-fault', 'directory', 'oversize', 'zero', 'partial',
    'parent-swap', 'unsafe-path', 'hardlink', 'chmod', 'replacement', 'content-drift']
  const observed = []; const artifacts = []; const closedFds = []; const contentInodes = []
  let syncedParentFd
  for (const failure of failures) withTempRoot((root) => {
    ensureLayout(root, runtimeTestAdapters())
    const filename = failure === 'unsafe-path' ? 'unsafe\n.json' : `${failure}.json`
    const path = join(root, 'events', filename); const displaced = join(root, 'events-original')
    const metadataFaults = {
      hardlink: () => linkSync(path, join(root, 'hardlink-copy')),
      chmod: () => chmodSync(path, 0o644),
      replacement: () => { renameSync(path, join(root, 'replacement-original.json')); writeLeaf(root, 'events/replacement.json', '{}\n') },
    }
    const adapters = runtimeTestAdapters(failure === 'fault' ? { fault: () => { throw new Error('fault') } }
      : failure === 'governance-fault' ? { fault: () => fail(ERROR_CODES.LEDGER) }
        : failure === 'directory' ? {
          writeContext: (fd, payload) => { closedFds.push(fd); runtimeAdapters.writeContext(fd, payload) },
          syncDirectory: (fd) => { closedFds.push(fd); throw new Error('directory') },
        } : failure === 'content-drift' ? { syncDirectory: (fd, parent) => {
          runtimeAdapters.syncDirectory(fd, parent); const before = lstatSync(path, { bigint: true }).ino
          writeFileSync(path, '{"durable":null}\n', { flag: 'r+' })
          contentInodes.push([before, lstatSync(path, { bigint: true }).ino])
        } } : failure === 'zero' ? { writeContext: () => {} }
          : failure === 'partial' ? { writeContext: (fd, payload) => writeSync(fd, payload, 0, 1) }
            : failure === 'parent-swap' ? { fault: () => { renameSync(dirname(path), displaced); mkdirSync(dirname(path), { mode: 0o700 }) } }
              : metadataFaults[failure] ? { fault: metadataFaults[failure] } : {})
    const value = failure === 'oversize' ? { value: 'x'.repeat(70 * 1024) } : { durable: true }
    observed.push(capturedCode(() => writeExclusiveJson(path, value, adapters)))
    const artifact = failure === 'parent-swap' ? join(displaced, filename)
      : failure === 'replacement' ? join(root, 'replacement-original.json') : path
    artifacts.push(existsSync(artifact))
    if (failure === 'parent-swap') syncedParentFd = adapters.events.find(([event]) => event === 'sync-directory')?.[2]
  })
  assert.deepEqual(observed, failures.map(() => ERROR_CODES.WRITE))
  assert.deepEqual(artifacts, failures.map((failure) => !['oversize', 'unsafe-path'].includes(failure)))
  assert.equal(Number.isInteger(syncedParentFd), true)
  assert.deepEqual(contentInodes, contentInodes.map(([inode]) => [inode, inode]))
  for (const fd of closedFds) assert.throws(() => fstatSync(fd), { code: 'EBADF' })
  completed += 1
})
test('state loading safely accepts valid immutable leaves and rejects corrupt leaves', () => {
  withTempRoot((root) => {
    ensureLayout(root, runtimeTestAdapters()); writeLeaf(root, 'events/a.json', '{"a":1}\n')
    writeLeaf(root, 'manifests/b.json', '{"b":2}\n')
    const state = loadGovernanceRecords(root, runtimeTestAdapters())
    assert.equal(Object.isFrozen(state), true); assert.equal(Object.isFrozen(state.records), true)
    assert.equal(state.records.length, 2)
  })
  const cases = [
    ['symlink', (root) => symlinkSync(join(root, 'manifests'), join(root, 'events', 'bad.json'))],
    ['hardlink', (root) => { const path = writeLeaf(root, 'events/bad.json', '{}\n'); linkSync(path, join(root, 'manifests', 'linked.json')) }],
    ['mode', (root) => writeLeaf(root, 'events/bad.json', '{}\n', 0o644)],
    ['owner', (root) => writeLeaf(root, 'events/bad.json', '{}\n')],
    ['oversize', (root) => writeLeaf(root, 'events/bad.json', `${'x'.repeat(65_536)}\n`)],
    ['missing-newline', (root) => writeLeaf(root, 'events/bad.json', '{}')],
    ['double-newline', (root) => writeLeaf(root, 'events/bad.json', '{}\n\n')],
    ['malformed', (root) => writeLeaf(root, 'events/bad.json', '{]\n')],
    ['noncanonical', (root) => writeLeaf(root, 'events/bad.json', '{"z":1,"a":2}\n')],
    ['unsafe-name', (root) => writeLeaf(root, 'events/evil\nname.json', '{}\n')],
    ['unknown-top', (root) => writeLeaf(root, 'unknown.json', '{}\n')],
  ]
  const leafCodes = []
  for (const [name, setup] of cases) withTempRoot((root) => {
    ensureLayout(root, runtimeTestAdapters()); setup(root)
    const adapters = name === 'owner'
      ? runtimeTestAdapters({ effectiveUid: (path) => path.endsWith('.json') ? process.geteuid() + 1 : process.geteuid() })
      : runtimeTestAdapters()
    leafCodes.push(capturedCode(() => loadGovernanceRecords(root, adapters)))
  })
  const mutations = ['ancestor-swap', 'root-add', 'leaf-add', 'replace-pending', 'read-leaf-drift']
  const mutationCodes = []
  for (const mutation of mutations) withTempRoot((root) => {
    ensureLayout(root, runtimeTestAdapters()); writeLeaf(root, 'events/a.json', '{}\n')
    writeLeaf(root, 'events/b.json', '{}\n'); let swapped = false
    const adapters = runtimeTestAdapters({ fault: (point, path) => {
      const trigger = mutation === 'read-leaf-drift' ? '/b.json' : '/a.json'
      if (point === 'after-leaf-lstat' && path.endsWith(trigger) && !swapped) {
        swapped = true
        if (mutation === 'ancestor-swap') { renameSync(join(root, 'events'), join(root, 'events-original')); symlinkSync(join(root, 'events-original'), join(root, 'events')) }
        if (mutation === 'root-add') writeLeaf(root, 'unknown.json', '{}\n')
        if (mutation === 'leaf-add') writeLeaf(root, 'events/late.json', '{}\n')
        if (mutation === 'replace-pending') { renameSync(join(root, 'events/b.json'), join(root, 'events/b-original.json')); writeLeaf(root, 'events/b.json', '{"new":true}\n') }
        if (mutation === 'read-leaf-drift') writeFileSync(join(root, 'events/a.json'), '{"a":2}\n', { flag: 'r+' })
      }
    } })
    mutationCodes.push(capturedCode(() => loadGovernanceRecords(root, adapters)))
  })
  assert.deepEqual({ leafCodes, mutationCodes }, {
    leafCodes: cases.map(() => ERROR_CODES.LEDGER), mutationCodes: mutations.map(() => ERROR_CODES.LEDGER),
  })
  withTempRoot((root) => {
    ensureLayout(root, runtimeTestAdapters())
    const path = writeLeaf(root, 'events/torn.json', '{}\n')
    const adapters = runtimeTestAdapters({ fault: (point, candidate) => {
      if (point === 'after-leaf-lstat' && candidate === path) writeFileSync(path, '{"changed":true}\n')
    } })
    expectGovernanceCode(ERROR_CODES.LEDGER, () => loadGovernanceRecords(root, adapters))
  })
  completed += 1
})
test('governance root rejects overlap with clone, evidence, archive, and cleanup roots', () => {
  const root = '/var/tmp/d2-state'
  for (const other of [root, `${root}/child`, dirname(root)]) {
    for (const slot of ['clone', 'evidence', 'archive', 'cleanup']) {
      const values = { clone: '/var/tmp/clone', evidence: '/var/tmp/evidence', archive: '/var/tmp/archive', cleanup: ['/var/tmp/work'] }
      values[slot] = slot === 'cleanup' ? [other] : other
      expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => assertSeparatedRoots(root,
        values.clone, values.evidence, values.archive, values.cleanup))
    }
  }
  assert.doesNotThrow(() => assertSeparatedRoots(root, '/var/tmp/clone', '/var/tmp/evidence',
    '/var/tmp/archive', ['/var/tmp/work']))
  expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE, () => assertSeparatedRoots(root,
    'relative', '/var/tmp/evidence', '/var/tmp/archive', ['/var/tmp/work']))
  for (const unsafe of ['\0', '\r', '\n']) expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE,
    () => assertSeparatedRoots(root, `/var/tmp/clone${unsafe}`, '/var/tmp/evidence',
      '/var/tmp/archive', ['/var/tmp/work']))
  const separationCanary = 'SEPARATION_PATH_CANARY'
  const hostilePath = new Proxy({}, {
    get: () => { throw new Error(separationCanary) },
    ownKeys: () => { throw new Error(separationCanary) },
  })
  expectGovernanceCode(ERROR_CODES.GOVERNANCE_STATE,
    () => assertSeparatedRoots(hostilePath, '/var/tmp/clone', '/var/tmp/evidence',
      '/var/tmp/archive', ['/var/tmp/work']), separationCanary)
  completed += 1
})
after(() => {
  assert.equal(completed, 5)
  console.log('D2_PRIME_GOVERNANCE_STORE_ALL_PASS')
})
