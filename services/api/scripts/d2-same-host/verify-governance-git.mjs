#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync as nativeSpawnSync } from 'node:child_process'
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { ERROR_CODES, fail } from './governance-contract.mjs'
import {
  assertCloneSnapshotUnchanged, canonicalFutureTarget, captureCloneSnapshot, runtimeAdapters,
} from './governance.mjs'
import { GIT_QUERIES, runGit } from './governance-git.mjs'

const roots = []
function tempRoot(prefix = 'd2-git-') {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix)); roots.push(root); return root
}
function git(cwd, args) {
  const result = nativeSpawnSync('git', args, {
    cwd, shell: false, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
  })
  if (result.status !== 0) throw new Error('fixture git command failed')
  return result.stdout.replace(/\r?\n$/u, '')
}
function cloneFixture(format = 'sha1') {
  const root = tempRoot(); const origin = join(root, 'origin.git'); const clone = join(root, 'clone')
  const initArgs = ['init', '--bare']
  if (format === 'sha256') initArgs.push('--object-format=sha256')
  initArgs.push(origin); git(root, initArgs); git(root, ['clone', origin, clone])
  git(clone, ['config', 'user.name', 'D2 Fixture']); git(clone, ['config', 'user.email', 'd2@example.invalid'])
  const branch = 'fixture/main'; git(clone, ['checkout', '-b', branch])
  writeFileSync(join(clone, 'tracked.txt'), 'v1\n'); git(clone, ['add', 'tracked.txt'])
  git(clone, ['commit', '-m', 'fixture']); git(clone, ['push', '-u', 'origin', branch])
  const head = git(clone, ['rev-parse', 'HEAD']); const tree = git(clone, ['rev-parse', 'HEAD^{tree}'])
  return { root, origin, clone, branch, head, tree }
}
function adapters(overrides = {}) { return Object.freeze({ ...runtimeAdapters, fault: () => {}, ...overrides }) }
function expectCode(code, action, canary = '') {
  assert.throws(action, (error) => {
    assert.equal(error.name, 'GovernanceError'); assert.equal(error.code, code); assert.equal(error.message, code)
    assert.equal(`${error.name}\n${error.message}`.includes(canary || '\0'), false); return true
  })
}
function oidDifferent(oid) { return `${oid[0] === 'a' ? 'b' : 'a'}${oid.slice(1)}` }
function isTreeQuery(args) {
  return args.length === 3 && args[0] === 'rev-parse' && args[1] === '--verify' && args[2].endsWith('^{tree}')
}

test('clean independent SHA-1 clone snapshot binds exact physical and Git identity', () => {
  const f = cloneFixture(); const before = { clone: f.clone, branch: f.branch, head: f.head }
  const snapshot = captureCloneSnapshot(f.clone, f.branch, f.head, adapters())
  assert.deepEqual(snapshot, {
    realpath: realpathSync(f.clone), dev: String(statSync(f.clone, { bigint: true }).dev),
    ino: String(statSync(f.clone, { bigint: true }).ino), branch: f.branch,
    headOid: f.head, treeOid: f.tree, clean: true,
  })
  const repeated = captureCloneSnapshot(f.clone, f.branch, f.head, adapters())
  const unchanged = assertCloneSnapshotUnchanged(snapshot, adapters())
  assert.equal(Object.isFrozen(snapshot), true); assert.equal(Object.isFrozen(repeated), true)
  assert.equal(Object.isFrozen(unchanged), true); assert.notEqual(snapshot, repeated); assert.notEqual(snapshot, unchanged)
  assert.deepEqual(unchanged, snapshot); assert.deepEqual(before, { clone: f.clone, branch: f.branch, head: f.head })
  assert.match(snapshot.dev, /^\d+$/u); assert.match(snapshot.ino, /^\d+$/u)
})

test('real SHA-256 clone snapshot is mandatory and binds 64-character OIDs', () => {
  const f = cloneFixture('sha256'); const snapshot = captureCloneSnapshot(f.clone, f.branch, f.head, adapters())
  assert.equal(snapshot.headOid.length, 64); assert.equal(snapshot.treeOid.length, 64)
})

test('SHA-256 fixture is mandatory and cannot be statically skipped', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const forbidden = new RegExp(['\\bsk', 'ip\\s*:'].join(''), 'u')
  assert.doesNotMatch(source, forbidden)
})

test('dirty state, detached HEAD, invalid expectations, and owner mismatch fail closed', () => {
  const dirtyCases = [
    (f) => writeFileSync(join(f.clone, 'tracked.txt'), 'modified\n'),
    (f) => { writeFileSync(join(f.clone, 'tracked.txt'), 'staged\n'); git(f.clone, ['add', 'tracked.txt']) },
    (f) => writeFileSync(join(f.clone, 'untracked.txt'), 'untracked\n'),
    (f) => git(f.clone, ['checkout', '--detach', f.head]),
  ]
  for (const mutate of dirtyCases) {
    const f = cloneFixture(); mutate(f)
    expectCode(ERROR_CODES.GIT_IDENTITY, () => captureCloneSnapshot(f.clone, f.branch, f.head, adapters()))
  }
  const f = cloneFixture()
  for (const [branch, head] of [
    ['other/branch', f.head], ['-illegal', f.head], ['bad branch', f.head], [`bad\nbranch`, f.head],
    [f.branch, oidDifferent(f.head)], [f.branch, 'A'.repeat(f.head.length)], [f.branch, 'a'.repeat(39)],
  ]) expectCode(ERROR_CODES.GIT_IDENTITY, () => captureCloneSnapshot(f.clone, branch, head, adapters()))
  expectCode(ERROR_CODES.GIT_IDENTITY, () => captureCloneSnapshot(f.clone, f.branch, f.head,
    adapters({ effectiveUid: () => process.geteuid() + 1 })))
})

test('gitfile, .git symlink/file, clone symlink, and ancestor symlink are rejected', () => {
  const f = cloneFixture(); git(f.clone, ['branch', 'linked']); const linked = join(f.root, 'linked')
  git(f.clone, ['worktree', 'add', linked, 'linked'])
  expectCode(ERROR_CODES.GIT_IDENTITY, () => captureCloneSnapshot(linked, 'linked', f.head, adapters()))
  for (const kind of ['file', 'symlink']) {
    const x = cloneFixture(); renameSync(join(x.clone, '.git'), join(x.clone, '.git-real'))
    if (kind === 'file') writeFileSync(join(x.clone, '.git'), 'gitdir: .git-real\n')
    else symlinkSync('.git-real', join(x.clone, '.git'))
    expectCode(ERROR_CODES.GIT_IDENTITY, () => captureCloneSnapshot(x.clone, x.branch, x.head, adapters()))
  }
  const rootLink = `${f.clone}-link`; symlinkSync(f.clone, rootLink)
  expectCode(ERROR_CODES.GIT_IDENTITY, () => captureCloneSnapshot(rootLink, f.branch, f.head, adapters()))
  const parentLink = join(f.root, 'parent-link'); symlinkSync(dirname(f.clone), parentLink)
  expectCode(ERROR_CODES.GIT_IDENTITY,
    () => captureCloneSnapshot(join(parentLink, 'clone'), f.branch, f.head, adapters()))
})

test('Git execution uses fixed argv without shell and rejects failures or hostile output', () => {
  const calls = []; const spawnSync = (command, args, options) => {
    calls.push({ command, args, options }); return { status: 0, stdout: 'ok\n', stderr: '' }
  }
  assert.equal(runGit('/canonical', ['rev-parse', '--verify', 'HEAD'], {}, { spawnSync }), 'ok')
  assert.deepEqual(calls[0], {
    command: 'git', args: ['rev-parse', '--verify', 'HEAD'],
    options: { cwd: '/canonical', shell: false, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } },
  })
  const canary = 'RAW_STDERR_CANARY'
  for (const result of [
    { status: 1, stdout: '', stderr: canary }, { status: 0, stdout: 'one\ntwo\n', stderr: '' },
    { status: 0, stdout: 'evil\0value\n', stderr: '' }, { status: 0, stdout: 'evil\rvalue\n', stderr: '' },
    { status: 0, stdout: 'evil\u0085value\n', stderr: '' },
    { status: 0, stdout: 123, stderr: '' }, { status: 0, stdout: '', stderr: '' },
  ]) expectCode(ERROR_CODES.GIT_IDENTITY, () => runGit('/canonical', ['status'], {},
    { spawnSync: () => result }), canary)
  expectCode(ERROR_CODES.GIT_IDENTITY, () => runGit('/canonical', ['status'], {},
    { spawnSync: () => { throw new Error(canary) } }), canary)
  const hostileOptions = new Proxy({}, { get: () => { throw new Error(canary) } })
  expectCode(ERROR_CODES.GIT_IDENTITY,
    () => runGit('/canonical', ['status'], hostileOptions, { spawnSync }), canary)
  assert.equal(runGit('/canonical', ['status'], { allowEmpty: true },
    { spawnSync: () => ({ status: 0, stdout: '\r\n', stderr: canary }) }), '')
})

test('capture uses only the approved Git query argv and rejects tree or path-swap faults', () => {
  const f = cloneFixture(); const calls = []
  const spawnSync = (command, args, options) => { calls.push(args); return nativeSpawnSync(command, args, options) }
  captureCloneSnapshot(f.clone, f.branch, f.head, adapters({ spawnSync }))
  const tree = [...GIT_QUERIES.tree, `${f.head}^{tree}`]
  assert.deepEqual(calls, [
    ['check-ref-format', '--branch', f.branch], GIT_QUERIES.top, GIT_QUERIES.branch,
    GIT_QUERIES.head, tree, GIT_QUERIES.clean, GIT_QUERIES.branch, GIT_QUERIES.head,
    GIT_QUERIES.clean, tree, GIT_QUERIES.branch, GIT_QUERIES.head, GIT_QUERIES.clean,
  ])
  const badTreeSpawn = (command, args, options) => isTreeQuery(args)
    ? { status: 0, stdout: `${'a'.repeat(f.head.length === 40 ? 64 : 40)}\n`, stderr: '' }
    : nativeSpawnSync(command, args, options)
  expectCode(ERROR_CODES.GIT_IDENTITY,
    () => captureCloneSnapshot(f.clone, f.branch, f.head, adapters({ spawnSync: badTreeSpawn })))
  let swapped = false
  expectCode(ERROR_CODES.GIT_IDENTITY, () => captureCloneSnapshot(f.clone, f.branch, f.head, adapters({
    fault: (point) => {
      if (point === 'after-clone-stat' && !swapped) {
        swapped = true; renameSync(f.clone, `${f.clone}-old`); git(f.root, ['clone', f.origin, f.clone])
        git(f.clone, ['checkout', f.branch])
      }
    },
  })))
})

test('capture rejects same-tree HEAD changes and query-time dirty or .git identity drift', () => {
  for (const mutation of ['same-tree-head', 'same-tree-head-late', 'dirty', 'dirty-late', 'git-identity']) {
    const f = cloneFixture(); let mutated = false
    const point = mutation === 'same-tree-head' ? 'after-head-before'
      : mutation === 'same-tree-head-late' ? 'after-head-after'
        : mutation === 'dirty' ? 'after-clean-before'
          : mutation === 'dirty-late' ? 'after-clean-after' : 'after-tree-before'
    expectCode(ERROR_CODES.GIT_IDENTITY, () => captureCloneSnapshot(f.clone, f.branch, f.head, adapters({
      fault: (currentPoint) => {
        if (currentPoint !== point || mutated) return
        mutated = true
        if (mutation.startsWith('same-tree-head')) git(f.clone, ['commit', '--allow-empty', '-m', 'same tree'])
        if (mutation.startsWith('dirty')) writeFileSync(join(f.clone, 'late-untracked.txt'), 'dirty\n')
        if (mutation === 'git-identity') {
          renameSync(join(f.clone, '.git'), join(f.clone, '.git-old'))
          cpSync(join(f.clone, '.git-old'), join(f.clone, '.git'), { recursive: true })
        }
      },
    })))
    assert.equal(mutated, true)
  }
})

test('snapshot unchanged check detects replacement and every bound identity field without mutation', () => {
  const replacement = cloneFixture(); const snapshot = captureCloneSnapshot(
    replacement.clone, replacement.branch, replacement.head, adapters())
  const before = structuredClone(snapshot); renameSync(replacement.clone, `${replacement.clone}-old`)
  git(replacement.root, ['clone', replacement.origin, replacement.clone]); git(replacement.clone, ['checkout', replacement.branch])
  expectCode(ERROR_CODES.GIT_IDENTITY, () => assertCloneSnapshotUnchanged(snapshot, adapters()))
  assert.deepEqual(snapshot, before)
  for (const change of ['branch', 'head', 'tree', 'clean', 'dev', 'ino']) {
    const f = cloneFixture(); const bound = captureCloneSnapshot(f.clone, f.branch, f.head, adapters())
    let custom = adapters()
    if (change === 'branch') git(f.clone, ['checkout', '-b', 'fixture/other'])
    if (change === 'head') { writeFileSync(join(f.clone, 'tracked.txt'), 'v2\n'); git(f.clone, ['commit', '-am', 'v2']) }
    if (change === 'tree') custom = adapters({ spawnSync: (command, args, options) => isTreeQuery(args)
      ? { status: 0, stdout: `${oidDifferent(bound.treeOid)}\n`, stderr: '' }
      : nativeSpawnSync(command, args, options) })
    if (change === 'clean') writeFileSync(join(f.clone, 'untracked.txt'), 'dirty\n')
    if (change === 'dev' || change === 'ino') custom = adapters({ statSync: (path, options) => {
      const actual = statSync(path, options)
      return { uid: actual.uid, dev: actual.dev + BigInt(change === 'dev'),
        ino: actual.ino + BigInt(change === 'ino'), mode: actual.mode,
        isDirectory: () => actual.isDirectory(), isSymbolicLink: () => actual.isSymbolicLink() }
    } })
    expectCode(ERROR_CODES.GIT_IDENTITY, () => assertCloneSnapshotUnchanged(bound, custom))
  }
})

test('future targets canonicalize through real directory ancestors and require nonexistence', () => {
  const root = tempRoot('d2-future-'); const parent = join(root, 'real', 'nested'); mkdirSync(parent, { recursive: true })
  const candidate = join(parent, '.', 'later', '..', 'later', 'evidence.json')
  assert.equal(canonicalFutureTarget(candidate, ERROR_CODES.ALREADY_RESERVED, adapters()),
    join(realpathSync(parent), 'later', 'evidence.json'))
  for (const code of [ERROR_CODES.ALREADY_RESERVED, ERROR_CODES.ARCHIVE_EXISTS]) {
    for (const kind of ['file', 'directory', 'real-link', 'dangling-link']) {
      const path = join(root, `${code}-${kind}`)
      if (kind === 'file') writeFileSync(path, '')
      if (kind === 'directory') mkdirSync(path)
      if (kind === 'real-link') symlinkSync(parent, path)
      if (kind === 'dangling-link') symlinkSync(join(root, 'missing'), path)
      expectCode(code, () => canonicalFutureTarget(path, code, adapters()))
    }
  }
})

test('future target rejects unsafe paths, ancestors, OS faults, and ancestor swaps without leakage', () => {
  const root = tempRoot('d2-future-hostile-'); const real = join(root, 'real'); mkdirSync(real)
  const file = join(root, 'plain'); writeFileSync(file, '')
  const link = join(root, 'link'); symlinkSync(real, link)
  for (const code of [ERROR_CODES.ALREADY_RESERVED, ERROR_CODES.ARCHIVE_EXISTS]) {
    for (const path of [
      'relative', `${join(real, 'x')}\0`, `${join(real, 'x')}\t`, `${join(real, 'x')}\x01`,
      `${join(real, 'x')}\x1f`, `${join(real, 'x')}\x7f`, `${join(real, 'x')}\u0085`,
      `${join(real, 'x')}\u009f`, `${join(real, 'x')}\r`,
      `${join(real, 'x')}\n`, join(file, 'x'), join(link, 'x'),
    ]) {
      expectCode(code, () => canonicalFutureTarget(path, code, adapters()))
    }
    const canary = 'FUTURE_LSTAT_CANARY'
    expectCode(code, () => canonicalFutureTarget(join(real, 'fault', 'x'), code,
      adapters({ lstatSync: () => { throw new Error(canary) } })), canary)
    let swapped = false
    expectCode(code, () => canonicalFutureTarget(join(real, 'future', 'x'), code, adapters({
      fault: (point) => {
        if (point === 'after-existing-ancestor' && !swapped) {
          swapped = true; renameSync(real, `${real}-old`); symlinkSync(`${real}-old`, real)
        }
      },
    })))
  }
})

test('future target rejects ancestor replacement after final missing check', () => {
  for (const code of [ERROR_CODES.ALREADY_RESERVED, ERROR_CODES.ARCHIVE_EXISTS]) {
    for (const replacement of ['symlink', 'directory']) {
      const root = tempRoot('d2-future-final-swap-'); const ancestor = join(root, 'ancestor'); mkdirSync(ancestor)
      let swapped = false
      expectCode(code, () => canonicalFutureTarget(join(ancestor, 'future.json'), code, adapters({
        fault: (point) => {
          if (point !== 'after-final-missing-check' || swapped) return
          swapped = true; renameSync(ancestor, `${ancestor}-old`)
          if (replacement === 'symlink') symlinkSync(`${ancestor}-old`, ancestor)
          else mkdirSync(ancestor)
        },
      })))
      assert.equal(swapped, true)
    }
  }
})

test('wrapper adapter failures always map to the wrapper error code', () => {
  const f = cloneFixture(); const target = join(tempRoot('d2-adapter-code-'), 'future.json')
  const hostile = {}
  Object.defineProperty(hostile, 'fault', {
    enumerable: true, get: () => fail(ERROR_CODES.LEDGER),
  })
  expectCode(ERROR_CODES.ALREADY_RESERVED,
    () => canonicalFutureTarget(target, ERROR_CODES.ALREADY_RESERVED, hostile))
  expectCode(ERROR_CODES.GIT_IDENTITY,
    () => captureCloneSnapshot(f.clone, f.branch, f.head, hostile))
})

test('future target rejects a same-path real-directory replacement between ancestor lstat and realpath', () => {
  for (const code of [ERROR_CODES.ALREADY_RESERVED, ERROR_CODES.ARCHIVE_EXISTS]) {
    const root = tempRoot('d2-future-real-swap-'); const ancestor = join(root, 'ancestor'); mkdirSync(ancestor)
    let swapped = false
    expectCode(code, () => canonicalFutureTarget(join(ancestor, 'future', 'target.json'), code, adapters({
      fault: (point, current) => {
        if (point === 'after-ancestor-lstat' && current === ancestor && !swapped) {
          swapped = true; renameSync(ancestor, `${ancestor}-old`); mkdirSync(ancestor)
        }
      },
    })))
    assert.equal(swapped, true)
  }
})

test('imported default module clone identity fails closed outside the governance CLI entry', () => {
  expectCode(ERROR_CODES.GIT_IDENTITY, () => runtimeAdapters.moduleCloneRoot())
  const root = realpathSync(git(dirname(fileURLToPath(import.meta.url)), ['rev-parse', '--show-toplevel']))
  assert.equal(root, realpathSync(resolve(root)))
})

after(() => {
  for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true })
  console.log('D2_PRIME_GOVERNANCE_GIT_ALL_PASS')
})
