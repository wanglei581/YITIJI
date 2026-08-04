import { spawnSync as nativeSpawnSync } from 'node:child_process'
import { lstatSync as nativeLstatSync, realpathSync as nativeRealpathSync, statSync as nativeStatSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { ERROR_CODES, GovernanceError, fail } from './governance-contract.mjs'

const frozenArgs = (...args) => Object.freeze(args)
export const GIT_QUERIES = Object.freeze({
  top: frozenArgs('rev-parse', '--show-toplevel'),
  branch: frozenArgs('symbolic-ref', '--quiet', '--short', 'HEAD'),
  head: frozenArgs('rev-parse', '--verify', 'HEAD'),
  tree: frozenArgs('rev-parse', '--verify'),
  clean: frozenArgs('status', '--porcelain=v2', '--untracked-files=all'),
})

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u

function gitIdentityFailure() { fail(ERROR_CODES.GIT_IDENTITY) }
function mapFailure(code, action) {
  try { return action() } catch (error) {
    if (error instanceof GovernanceError && error.code === code) throw error
    fail(code)
  }
}
function adapter(adapters, name, fallback) {
  const candidate = adapters?.[name]
  return typeof candidate === 'function' ? candidate : fallback
}
function stripOneTerminator(value) {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

export function runGit(cwd, args, options = {}, adapters = {}) {
  return mapFailure(ERROR_CODES.GIT_IDENTITY, () => {
    const allowEmpty = options?.allowEmpty === true
    if (typeof cwd !== 'string' || !isAbsolute(cwd) || CONTROL.test(cwd) ||
      !Array.isArray(args) || args.some((value) => typeof value !== 'string' || CONTROL.test(value))) {
      gitIdentityFailure()
    }
    const result = adapter(adapters, 'spawnSync', nativeSpawnSync)('git', args, {
      cwd, shell: false, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
    })
    if (result?.status !== 0 || typeof result.stdout !== 'string') gitIdentityFailure()
    const output = stripOneTerminator(result.stdout)
    if (CONTROL.test(output) || (!allowEmpty && output.length === 0)) gitIdentityFailure()
    return output
  })
}

function pathComponents(path) {
  const root = parse(path).root
  const suffix = relative(root, path)
  return [root, ...(suffix ? suffix.split(sep) : []).map((part, index, parts) =>
    join(root, ...parts.slice(0, index + 1)))]
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid &&
    left.mode === right.mode && left.isDirectory() === right.isDirectory() &&
    left.isSymbolicLink() === right.isSymbolicLink()
}
function pathOps(adapters) {
  return {
    lstat: adapter(adapters, 'lstatSync', nativeLstatSync),
    realpath: adapter(adapters, 'realpathSync', nativeRealpathSync),
    stat: adapter(adapters, 'statSync', nativeStatSync),
    fault: adapter(adapters, 'fault', () => {}),
  }
}

export function assertNoSymlinkComponents(absPath, adapters = {}) {
  return mapFailure(ERROR_CODES.GIT_IDENTITY, () => {
    if (typeof absPath !== 'string' || !isAbsolute(absPath) || CONTROL.test(absPath)) gitIdentityFailure()
    const canonical = resolve(absPath)
    if (canonical !== absPath) gitIdentityFailure()
    const { lstat, realpath } = pathOps(adapters)
    for (const current of pathComponents(canonical)) {
      const stat = lstat(current, { bigint: true })
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpath(current) !== current) gitIdentityFailure()
    }
    return canonical
  })
}

function assertOid(value) { if (typeof value !== 'string' || !OID.test(value)) gitIdentityFailure() }
function cloneStat(path, adapters) {
  const stat = pathOps(adapters).stat(path, { bigint: true })
  if (!stat.isDirectory()) gitIdentityFailure()
  return stat
}
function assertRealGitDirectory(cloneRoot, adapters) {
  const gitDir = join(cloneRoot, '.git')
  const stat = pathOps(adapters).lstat(gitDir, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) gitIdentityFailure()
  return stat
}
function cloneIdentity(canonical, adapters) {
  assertNoSymlinkComponents(canonical, adapters)
  const realpath = pathOps(adapters).realpath(canonical)
  if (realpath !== canonical) gitIdentityFailure()
  return { realpath, root: cloneStat(canonical, adapters), git: assertRealGitDirectory(canonical, adapters) }
}
function treeQuery(headOid) {
  assertOid(headOid)
  return [...GIT_QUERIES.tree, `${headOid}^{tree}`]
}

export function captureCloneSnapshot(cloneRoot, expectedBranch, expectedOid, adapters = {}) {
  return mapFailure(ERROR_CODES.GIT_IDENTITY, () => {
    const canonical = assertNoSymlinkComponents(cloneRoot, adapters)
    runGit(canonical, ['check-ref-format', '--branch', expectedBranch], {}, adapters)
    assertOid(expectedOid)
    const identityBefore = cloneIdentity(canonical, adapters)
    const { fault } = pathOps(adapters); fault('after-clone-stat', canonical)
    const top = runGit(canonical, GIT_QUERIES.top, {}, adapters)
    const branchBefore = runGit(canonical, GIT_QUERIES.branch, {}, adapters)
    fault('after-branch-before', canonical)
    const headBefore = runGit(canonical, GIT_QUERIES.head, {}, adapters); assertOid(headBefore)
    fault('after-head-before', canonical)
    const treeBefore = runGit(canonical, treeQuery(headBefore), {}, adapters); assertOid(treeBefore)
    fault('after-tree-before', canonical)
    const cleanBefore = runGit(canonical, GIT_QUERIES.clean, { allowEmpty: true }, adapters)
    fault('after-clean-before', canonical)
    const branchAfter = runGit(canonical, GIT_QUERIES.branch, {}, adapters)
    const headAfter = runGit(canonical, GIT_QUERIES.head, {}, adapters); assertOid(headAfter)
    fault('after-head-after', canonical)
    const cleanAfter = runGit(canonical, GIT_QUERIES.clean, { allowEmpty: true }, adapters)
    fault('after-clean-after', canonical)
    const treeAfter = runGit(canonical, treeQuery(headAfter), {}, adapters); assertOid(treeAfter)
    const branchFinal = runGit(canonical, GIT_QUERIES.branch, {}, adapters)
    const headFinal = runGit(canonical, GIT_QUERIES.head, {}, adapters); assertOid(headFinal)
    const cleanFinal = runGit(canonical, GIT_QUERIES.clean, { allowEmpty: true }, adapters)
    const identityAfter = cloneIdentity(canonical, adapters)
    const owner = adapter(adapters, 'effectiveUid', () => process.geteuid())()
    if (identityBefore.root.uid !== BigInt(owner) || identityBefore.git.uid !== BigInt(owner) ||
      top !== canonical || identityBefore.realpath !== identityAfter.realpath ||
      branchBefore !== expectedBranch || branchAfter !== branchBefore || branchFinal !== branchBefore ||
      headBefore !== expectedOid || headAfter !== headBefore || headFinal !== headBefore ||
      treeBefore !== treeAfter || headBefore.length !== treeBefore.length ||
      cleanBefore !== '' || cleanAfter !== '' || cleanFinal !== '' ||
      !sameIdentity(identityBefore.root, identityAfter.root) ||
      !sameIdentity(identityBefore.git, identityAfter.git)) gitIdentityFailure()
    return Object.freeze({
      realpath: canonical, dev: String(identityBefore.root.dev), ino: String(identityBefore.root.ino),
      branch: branchBefore, headOid: headBefore, treeOid: treeBefore, clean: true,
    })
  })
}

const SNAPSHOT_KEYS = Object.freeze(['realpath', 'dev', 'ino', 'branch', 'headOid', 'treeOid', 'clean'])
function readSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) gitIdentityFailure()
  const keys = Reflect.ownKeys(snapshot)
  if (keys.length !== SNAPSHOT_KEYS.length || SNAPSHOT_KEYS.some((key) => !keys.includes(key))) gitIdentityFailure()
  const copy = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, snapshot[key]]))
  if (copy.clean !== true || !/^[0-9]+$/u.test(copy.dev) || !/^[0-9]+$/u.test(copy.ino) ||
    typeof copy.branch !== 'string' || typeof copy.realpath !== 'string') gitIdentityFailure()
  assertOid(copy.headOid); assertOid(copy.treeOid)
  return copy
}

export function assertCloneSnapshotUnchanged(snapshot, adapters = {}) {
  return mapFailure(ERROR_CODES.GIT_IDENTITY, () => {
    const expected = readSnapshot(snapshot)
    const current = captureCloneSnapshot(expected.realpath, expected.branch, expected.headOid, adapters)
    if (SNAPSHOT_KEYS.some((key) => current[key] !== expected[key])) gitIdentityFailure()
    return current
  })
}

function missing(error) { return error?.code === 'ENOENT' }
function targetFail(code) { fail(code) }
function proveRealDirectory(current, before, expected, code, ops) {
  if (!before.isDirectory() || before.isSymbolicLink()) targetFail(code)
  ops.fault('after-ancestor-lstat', current)
  const canonical = ops.realpath(current)
  const after = ops.lstat(current, { bigint: true })
  if (!after.isDirectory() || after.isSymbolicLink() || canonical !== current ||
    !sameIdentity(before, after) || (expected && !sameIdentity(expected, after))) targetFail(code)
  return after
}
function inspectFuture(path, code, adapters) {
  const ops = pathOps(adapters); const existing = []; let firstMissing
  for (const current of pathComponents(path)) {
    let stat
    try { stat = ops.lstat(current, { bigint: true }) } catch (error) {
      if (!missing(error)) throw error
      firstMissing = current; break
    }
    if (current === path) targetFail(code)
    existing.push([current, proveRealDirectory(current, stat, undefined, code, ops)])
  }
  if (!firstMissing) targetFail(code)
  return { existing, firstMissing }
}
function assertMissing(path, code, ops) {
  try { ops.lstat(path, { bigint: true }); targetFail(code) } catch (error) {
    if (error instanceof GovernanceError) throw error
    if (!missing(error)) throw error
  }
}
function assertFutureMissing(proof, target, code, ops) {
  assertMissing(proof.firstMissing, code, ops)
  if (proof.firstMissing !== target) assertMissing(target, code, ops)
}
function revalidateAncestors(existing, code, ops) {
  for (const [current, expected] of existing) {
    const before = ops.lstat(current, { bigint: true })
    proveRealDirectory(current, before, expected, code, ops)
  }
}

export function canonicalFutureTarget(path, conflictCode, adapters = {}) {
  return mapFailure(conflictCode, () => {
    if (typeof path !== 'string' || !isAbsolute(path) || CONTROL.test(path)) targetFail(conflictCode)
    const canonical = resolve(path); const ops = pathOps(adapters)
    const proof = inspectFuture(canonical, conflictCode, adapters)
    ops.fault('after-existing-ancestor', proof.existing.at(-1)?.[0])
    assertFutureMissing(proof, canonical, conflictCode, ops)
    ops.fault('after-first-missing-check', proof.firstMissing)
    revalidateAncestors(proof.existing, conflictCode, ops)
    assertFutureMissing(proof, canonical, conflictCode, ops)
    ops.fault('after-final-missing-check', proof.firstMissing)
    revalidateAncestors(proof.existing, conflictCode, ops)
    return canonical
  })
}
