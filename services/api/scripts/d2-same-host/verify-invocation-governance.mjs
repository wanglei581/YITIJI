#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ERROR_CODES,
  consumeInvocation,
  reserveInvocation,
} from './invocation-governance.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SCRIPT_DIR = dirname(SCRIPT_PATH)
const GOVERNANCE_MODULE = join(SCRIPT_DIR, 'invocation-governance.mjs')
const RUN_PATH = join(SCRIPT_DIR, 'run.sh')
const RUNBOOK_PATH = join(SCRIPT_DIR, '../../../../docs/device/f1-d2-same-host-dual-port-runbook.md')
const REQUIRED_IDENTITIES = Object.freeze([
  'D2_GOVERNANCE_ROOT',
  'D2_TASK_ID',
  'D2_BASELINE_SHA',
  'D2_BRANCH_NAME',
  'D2_CLONE_PATH',
  'D2_EVIDENCE_OUT',
  'D2_ARCHIVE_PATH',
])
const SHELL_CONTINUATION = String.fromCharCode(92)
const APPROVED_EXECUTABLE_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
const RESERVE_FAIL_FAST_LINES = Object.freeze([
  ': "${D2_GOVERNANCE_ROOT:?missing exact governance root}"',
  ': "${D2_TASK_ID:?missing exact task id}"',
  ': "${D2_BASELINE_SHA:?missing exact baseline}"',
  ': "${D2_BRANCH_NAME:?missing exact branch}"',
  ': "${D2_CLONE_PATH:?missing exact fresh clone path}"',
  ': "${D2_EVIDENCE_OUT:?missing exact evidence path}"',
  ': "${D2_ARCHIVE_PATH:?missing exact archive target}"',
])
const RESERVE_ENVIRONMENT_LINES = Object.freeze([
  `env -i ${SHELL_CONTINUATION}`,
  `  PATH="${APPROVED_EXECUTABLE_PATH}" ${SHELL_CONTINUATION}`,
  `  HOME="$HOME" ${SHELL_CONTINUATION}`,
  `  LANG=C.UTF-8 ${SHELL_CONTINUATION}`,
])
const RESERVE_IDENTITY_LINES = Object.freeze(REQUIRED_IDENTITIES.map(
  (name) => `  ${name}="$${name}" ${SHELL_CONTINUATION}`,
))
const RESERVE_FENCED_BLOCK = [
  '```bash',
  ...RESERVE_FAIL_FAST_LINES,
  ...RESERVE_ENVIRONMENT_LINES,
  ...RESERVE_IDENTITY_LINES,
  'node services/api/scripts/d2-same-host/invocation-governance.mjs --reserve',
  '```',
].join('\n')
const GOVERNANCE_LAUNCH_LINES = Object.freeze([
  `"$GOVERNANCE_ENV_BIN" -i PATH="$APPROVED_PATH" HOME="$SCRIPT_DIR" ${SHELL_CONTINUATION}`,
  ...RESERVE_IDENTITY_LINES,
  `  "$GOVERNANCE_NODE_BIN" "$SCRIPT_DIR/invocation-governance.mjs" --consume ${SHELL_CONTINUATION}`,
  '  || exit 2',
])
const GOVERNANCE_LAUNCH = GOVERNANCE_LAUNCH_LINES.join('\n')
const SOURCE_PREFLIGHT_LINES = Object.freeze([
  ': "${D2_SOURCE_REPOSITORY:?missing exact approved source repository}"',
  ': "${D2_BASELINE_SHA:?missing exact baseline}"',
  `PATH="${APPROVED_EXECUTABLE_PATH}"`,
  'export PATH',
  'D2_SOURCE_ROOT="$(cd -P -- "$D2_SOURCE_REPOSITORY" && pwd -P)"',
  'cd -P -- "$D2_SOURCE_ROOT"',
  '[[ "$(git rev-parse --show-toplevel)" == "$D2_SOURCE_ROOT" ]]',
  '[[ "$(git rev-parse HEAD)" == "$D2_BASELINE_SHA" ]]',
  'git diff --quiet --ignore-submodules --',
  'git diff --cached --quiet --ignore-submodules --',
])
const FRESH_CLONE_LINES = Object.freeze([
  ': "${D2_SOURCE_REPOSITORY:?missing exact approved source repository}"',
  ': "${D2_BASELINE_SHA:?missing exact baseline}"',
  ': "${D2_BRANCH_NAME:?missing exact branch}"',
  ': "${D2_CLONE_PATH:?missing exact fresh clone path}"',
  `PATH="${APPROVED_EXECUTABLE_PATH}"`,
  'export PATH',
  'git clone --no-local -- "$D2_SOURCE_REPOSITORY" "$D2_CLONE_PATH"',
  'cd -P -- "$D2_CLONE_PATH"',
  'git switch -c "$D2_BRANCH_NAME" "$D2_BASELINE_SHA"',
  'D2_CLONE_ROOT="$(pwd -P)"',
  '[[ "$(git rev-parse --show-toplevel)" == "$D2_CLONE_ROOT" ]]',
  '[[ "$(git rev-parse HEAD)" == "$D2_BASELINE_SHA" ]]',
  '[[ "$(git symbolic-ref --quiet --short HEAD)" == "$D2_BRANCH_NAME" ]]',
  'git diff --quiet --ignore-submodules --',
  'git diff --cached --quiet --ignore-submodules --',
])
function compoundCommandLines(lines) {
  return Object.freeze(lines.map((line, index) => (
    index === lines.length - 1 ? line : `${line} && ${SHELL_CONTINUATION}`
  )))
}
const SOURCE_PREFLIGHT_COMPOUND_LINES = compoundCommandLines(SOURCE_PREFLIGHT_LINES)
const FRESH_CLONE_COMPOUND_LINES = compoundCommandLines(FRESH_CLONE_LINES)
const SOURCE_PREFLIGHT_FENCED_BLOCK = ['```bash', ...SOURCE_PREFLIGHT_COMPOUND_LINES, '```'].join('\n')
const FRESH_CLONE_FENCED_BLOCK = ['```bash', ...FRESH_CLONE_COMPOUND_LINES, '```'].join('\n')
const CRITICAL_CHAIN_COMMANDS = Object.freeze([
  SOURCE_PREFLIGHT_LINES[4], SOURCE_PREFLIGHT_LINES[6], SOURCE_PREFLIGHT_LINES[7],
  SOURCE_PREFLIGHT_LINES[8], FRESH_CLONE_LINES[6], FRESH_CLONE_LINES[8],
 FRESH_CLONE_LINES[10], FRESH_CLONE_LINES[11], FRESH_CLONE_LINES[12], FRESH_CLONE_LINES[13],
])
const RUNBOOK_UNIQUE_COMMANDS = Object.freeze([
  'node services/api/scripts/d2-same-host/invocation-governance.mjs --reserve',
  FRESH_CLONE_LINES[6],
  FRESH_CLONE_LINES[8],
])
const EXPECTED_ERROR_CODES = Object.freeze({
  PATH: 'D2_PRIME_NO_GO_GOVERNANCE_PATH',
  INPUT: 'D2_PRIME_NO_GO_INVOCATION_INPUT',
  BUSY: 'D2_PRIME_NO_GO_INVOCATION_BUSY',
  RESERVED: 'D2_PRIME_NO_GO_INVOCATION_RESERVED',
  NOT_RESERVED: 'D2_PRIME_NO_GO_INVOCATION_NOT_RESERVED',
  ARCHIVE_EXISTS: 'D2_PRIME_NO_GO_ARCHIVE_EXISTS',
  LEDGER: 'D2_PRIME_NO_GO_INVOCATION_LEDGER',
})
const FIXED_ERROR_CODES = new Set(Object.values(EXPECTED_ERROR_CODES))
const CLI_TIMEOUT_MS = 5_000
const MAX_LEDGER_BYTES = 64 * 1024 * 1024
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const HASH = /^[0-9a-f]{64}$/
const BARRIER_CLI_SOURCE = String.raw`
  const { spawnSync } = require('node:child_process')
  let started = false
  const timeout = setTimeout(() => process.exit(124), 4000)
  process.send({ type: 'ready' })
  process.once('message', (message) => {
    if (message !== 'start' || started) process.exit(125)
    started = true
    clearTimeout(timeout)
    const result = spawnSync(process.execPath, [process.argv[1], '--reserve'], {
      env: process.env,
      encoding: 'utf8',
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    process.exit(result.status ?? 126)
  })
`

function createFixture(label) {
  const root = mkdtempSync(join(tmpdir(), `d2-invocation-${label}-`))
  chmodSync(root, 0o700)
  const governanceRoot = join(root, 'governance')
  const cloneParent = join(root, 'clones')
  const evidenceParent = join(root, 'evidence')
  const archiveParent = join(root, 'archive')
  for (const path of [governanceRoot, cloneParent, evidenceParent, archiveParent]) {
    mkdirSync(path, { mode: 0o700 })
  }
  return {
    root,
    governanceRoot,
    cloneParent,
    rawNonce: `raw-nonce-${label}-must-not-leak`,
    input: {
      governanceRoot,
      taskId: `task-${label}`,
      baselineSha: 'a'.repeat(40),
      branchName: `codex/${label}`,
      clonePath: join(cloneParent, 'fresh-clone'),
      evidenceOut: join(evidenceParent, 'evidence.json'),
      archivePath: join(archiveParent, 'archive.tar.gz'),
    },
  }
}

function cleanupFixture(fixture) {
  rmSync(fixture.root, { recursive: true, force: true })
}

function expectCode(action, expectedCode) {
  assert.throws(
    action,
    (error) => error instanceof Error && error.message === expectedCode,
  )
}

function mode(path) {
  return statSync(path).mode & 0o777
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalFuturePath(path) {
  return join(realpathSync(dirname(path)), basename(path))
}

function cliEnvironment(input, rawNonce) {
  return {
    HOME: dirname(input.governanceRoot),
    LANG: 'C.UTF-8',
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    D2_GOVERNANCE_ROOT: input.governanceRoot,
    D2_TASK_ID: input.taskId,
    D2_BASELINE_SHA: input.baselineSha,
    D2_BRANCH_NAME: input.branchName,
    D2_CLONE_PATH: input.clonePath,
    D2_EVIDENCE_OUT: input.evidenceOut,
    D2_ARCHIVE_PATH: input.archivePath,
    D2_NONCE: rawNonce,
  }
}

function runCli(args, env, cwd) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [GOVERNANCE_MODULE, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const settle = (status, signal, timedOut = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({ status, signal, stdout, stderr, timedOut })
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle(null, 'SIGKILL', true)
    }, CLI_TIMEOUT_MS)
    child.once('error', () => settle(null, null))
    child.once('close', (status, signal) => settle(status, signal))
  })
}

function rawValues(input, rawNonce) {
  return [
    input.governanceRoot,
    input.taskId,
    input.baselineSha,
    input.branchName,
    input.clonePath,
    input.evidenceOut,
    input.archivePath,
    rawNonce,
  ]
}

function expectedFacets(input) {
  return {
    taskId: sha256(input.taskId),
    baselineId: sha256(input.baselineSha),
    branchId: sha256(input.branchName),
    cloneId: sha256(canonicalFuturePath(input.clonePath)),
    evidenceId: sha256(canonicalFuturePath(input.evidenceOut)),
    archiveId: sha256(canonicalFuturePath(input.archivePath)),
  }
}

function killBarrierProcess(child) {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

function spawnBarrierCli(env, cwd) {
  const child = spawn(process.execPath, ['-e', BARRIER_CLI_SOURCE, GOVERNANCE_MODULE], {
    cwd,
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let stdout = ''
  let stderr = ''
  let settled = false
  let readySettled = false
  let resolveReady
  let rejectReady
  let resolveResult
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise
    rejectReady = rejectPromise
  })
  const result = new Promise((resolvePromise) => { resolveResult = resolvePromise })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const settleReady = (error) => {
    if (readySettled) return
    readySettled = true
    if (error) rejectReady(error)
    else resolveReady()
  }
  const settle = (status, signal, timedOut = false) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (!readySettled) settleReady(new Error('barrier child exited before ready'))
    resolveResult({ status, signal, stdout, stderr, timedOut })
  }
  const timer = setTimeout(() => {
    killBarrierProcess(child)
    settle(null, 'SIGKILL', true)
  }, CLI_TIMEOUT_MS)
  child.on('message', (message) => {
    if (message?.type === 'ready') settleReady()
  })
  child.once('error', (error) => {
    settleReady(error)
    settle(null, null)
  })
  child.once('close', (status, signal) => settle(status, signal))
  return {
    ready,
    result,
    start() {
      if (!settled) child.send('start', (error) => {
        if (error) {
          killBarrierProcess(child)
          settle(null, null)
        }
      })
    },
    terminate() {
      if (!settled) {
        killBarrierProcess(child)
        settle(null, 'SIGKILL', true)
      }
    },
  }
}

function assertClosedCliFailure(result, forbiddenValues) {
  assert.equal(result.timedOut, false)
  assert.equal(result.status, 2)
  assert.equal(result.signal, null)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /^D2_PRIME_NO_GO_[A-Z0-9_]+\n$/)
  assert.ok(FIXED_ERROR_CODES.has(result.stderr.trim()))
  for (const forbidden of forbiddenValues) assert.equal(result.stderr.includes(forbidden), false)
}

function verifyReserveConsumeAndReplay() {
  const fixture = createFixture('reserve-consume')
  try {
    const reservedAt = '2026-08-01T01:02:03.000Z'
    const invokedAt = '2026-08-01T01:02:04.000Z'
    const first = reserveInvocation(fixture.input, { now: () => Date.parse(reservedAt) })
    assert.deepEqual(first, { event: 'RESERVED' })
    mkdirSync(fixture.input.clonePath, { mode: 0o700 })
    const consumed = consumeInvocation(fixture.input, { now: () => Date.parse(invokedAt) })
    assert.deepEqual(consumed, { event: 'INVOKED' })
    const facets = expectedFacets(fixture.input)
    const reservationDir = join(fixture.governanceRoot, 'reservations', facets.taskId)
    const reservationSource = readFileSync(join(reservationDir, 'reservation.json'), 'utf8')
    const invokedSource = readFileSync(join(reservationDir, 'invoked.json'), 'utf8')
    assert.deepEqual(JSON.parse(reservationSource), { v: 1, ...facets })
    assert.deepEqual(JSON.parse(invokedSource), { v: 1, ...facets })
    for (const forbidden of rawValues(fixture.input, fixture.rawNonce)) {
      assert.equal(reservationSource.includes(forbidden), false)
      assert.equal(invokedSource.includes(forbidden), false)
    }
    const ledgerSource = readFileSync(join(fixture.governanceRoot, 'invocations.jsonl'), 'utf8')
    const ledgerRecords = ledgerSource.trimEnd().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(ledgerRecords, [
      { v: 1, event: 'RESERVED', recordedAt: reservedAt, ...facets },
      { v: 1, event: 'INVOKED', recordedAt: invokedAt, ...facets },
    ])
    expectCode(() => consumeInvocation(fixture.input), EXPECTED_ERROR_CODES.RESERVED)
  } finally {
    cleanupFixture(fixture)
  }

  const reused = createFixture('reused-clone')
  try {
    reserveInvocation(reused.input)
    const reusedParentAlias = join(reused.root, 'reused-clone-parent-alias')
    symlinkSync(reused.cloneParent, reusedParentAlias, 'dir')
    const secondIdentity = {
      ...reused.input,
      taskId: 'task-reused-clone-second',
      baselineSha: 'b'.repeat(40),
      branchName: 'codex/reused-clone-second',
      clonePath: join(reusedParentAlias, 'fresh-clone'),
      evidenceOut: join(reused.root, 'evidence', 'second-evidence.json'),
      archivePath: join(reused.root, 'archive', 'second-archive.tar.gz'),
    }
    assert.notEqual(secondIdentity.clonePath, reused.input.clonePath)
    expectCode(() => reserveInvocation(secondIdentity), EXPECTED_ERROR_CODES.RESERVED)
  } finally {
    cleanupFixture(reused)
  }
}

async function verifyConcurrentSingleWinner() {
  const fixture = createFixture('concurrent')
  const children = []
  try {
    const env = cliEnvironment(fixture.input, fixture.rawNonce)
    for (let index = 0; index < 8; index += 1) {
      children.push(spawnBarrierCli(env, fixture.root))
    }
    await Promise.all(children.map((child) => child.ready))
    for (const child of children) child.start()
    const results = await Promise.all(children.map((child) => child.result))
    assert.ok(results.every((result) => result.timedOut === false))
    const winners = results.filter((result) => result.status === 0)
    const losers = results.filter((result) => result.status !== 0)
    assert.equal(winners.length, 1)
    assert.equal(losers.length, 7)
    assert.equal(winners[0].signal, null)
    assert.equal(winners[0].stdout, '')
    assert.equal(winners[0].stderr, '')
    for (const loser of losers) {
      assertClosedCliFailure(loser, rawValues(fixture.input, fixture.rawNonce))
      assert.ok([
        EXPECTED_ERROR_CODES.BUSY,
        EXPECTED_ERROR_CODES.RESERVED,
      ].includes(loser.stderr.trim()))
    }
    const ledger = readFileSync(join(fixture.governanceRoot, 'invocations.jsonl'), 'utf8')
    const records = ledger.trimEnd().split('\n').map((line) => JSON.parse(line))
    assert.equal(records.length, 1)
    assert.deepEqual(records[0], {
      v: 1,
      event: 'RESERVED',
      recordedAt: records[0].recordedAt,
      ...expectedFacets(fixture.input),
    })
    assert.match(records[0].recordedAt, RFC3339)
    const reservationNames = readdirSync(join(fixture.governanceRoot, 'reservations'))
    assert.deepEqual(reservationNames, [expectedFacets(fixture.input).taskId])
    for (const forbidden of rawValues(fixture.input, fixture.rawNonce)) {
      assert.equal(ledger.includes(forbidden), false)
    }
  } finally {
    for (const child of children) child.terminate()
    cleanupFixture(fixture)
  }
}

function verifyArchiveAndAliasRejection() {
  const archive = createFixture('archive-exists')
  try {
    writeFileSync(archive.input.archivePath, 'pre-existing archive', { mode: 0o600 })
    expectCode(() => reserveInvocation(archive.input), EXPECTED_ERROR_CODES.ARCHIVE_EXISTS)
  } finally {
    cleanupFixture(archive)
  }

  const alias = createFixture('path-alias')
  try {
    const aliasParent = join(alias.root, 'clone-parent-alias')
    symlinkSync(alias.cloneParent, aliasParent, 'dir')
    reserveInvocation(alias.input)
    const aliasedInput = {
      ...alias.input,
      taskId: 'task-path-alias-second',
      baselineSha: 'b'.repeat(40),
      branchName: 'codex/path-alias-second',
      clonePath: join(aliasParent, 'fresh-clone'),
      evidenceOut: join(alias.root, 'evidence', 'physical.json'),
      archivePath: join(alias.root, 'archive', 'physical.tar.gz'),
    }
    assert.notEqual(aliasedInput.clonePath, alias.input.clonePath)
    expectCode(() => reserveInvocation(aliasedInput), EXPECTED_ERROR_CODES.RESERVED)
  } finally {
    cleanupFixture(alias)
  }
}

function verifyCanonicalTargetSafety() {
  const writableParent = createFixture('writable-target-parent')
  try {
    chmodSync(dirname(writableParent.input.evidenceOut), 0o770)
    expectCode(() => reserveInvocation(writableParent.input), EXPECTED_ERROR_CODES.PATH)
    assert.equal(existsSync(join(writableParent.governanceRoot, 'reservation.lock')), false)
  } finally {
    cleanupFixture(writableParent)
  }

  const repointed = createFixture('repointed-target-parent')
  try {
    const alternateParent = join(repointed.root, 'alternate-clones')
    const aliasParent = join(repointed.root, 'mutable-clone-parent')
    mkdirSync(alternateParent, { mode: 0o700 })
    symlinkSync(repointed.cloneParent, aliasParent, 'dir')
    const aliasedInput = {
      ...repointed.input,
      clonePath: join(aliasParent, 'fresh-clone'),
    }
    expectCode(
      () => reserveInvocation(aliasedInput, {
        internalHooks: {
          afterLockAcquired() {
            rmSync(aliasParent)
            symlinkSync(alternateParent, aliasParent, 'dir')
          },
        },
      }),
      EXPECTED_ERROR_CODES.PATH,
    )
    assert.equal(existsSync(join(repointed.governanceRoot, 'reservation.lock')), false)
    assert.equal(existsSync(join(repointed.governanceRoot, 'reservations')), false)
  } finally {
    cleanupFixture(repointed)
  }
}

function verifyCrashAndLedgerFailures() {
  const crashed = createFixture('crash-lock')
  try {
    const lockPath = join(crashed.governanceRoot, 'reservation.lock')
    mkdirSync(lockPath, { mode: 0o700 })
    const staleTime = new Date('2001-02-03T04:05:06.000Z')
    utimesSync(lockPath, staleTime, staleTime)
    const staleLock = lstatSync(lockPath, { bigint: true })
    expectCode(() => reserveInvocation(crashed.input), EXPECTED_ERROR_CODES.BUSY)
    const retainedLock = lstatSync(lockPath, { bigint: true })
    assert.ok(retainedLock.isDirectory())
    assert.equal(retainedLock.ino, staleLock.ino)
    assert.equal(retainedLock.mtimeNs, staleLock.mtimeNs)
    assert.ok(retainedLock.mtimeNs < BigInt(Date.now() - 20 * 365 * 24 * 60 * 60 * 1000) * 1_000_000n)
    assert.equal(mode(lockPath), 0o700)
  } finally {
    cleanupFixture(crashed)
  }

  const ledgerFailure = createFixture('ledger-failure')
  try {
    const ledgerPath = join(ledgerFailure.governanceRoot, 'invocations.jsonl')
    expectCode(
      () => reserveInvocation(ledgerFailure.input, {
        now: () => {
          mkdirSync(ledgerPath, { mode: 0o700 })
          return Date.parse('2026-08-01T03:04:05.000Z')
        },
      }),
      EXPECTED_ERROR_CODES.LEDGER,
    )
    const lockPath = join(ledgerFailure.governanceRoot, 'reservation.lock')
    const lockTombstone = lstatSync(lockPath, { bigint: true })
    assert.ok(lockTombstone.isDirectory())
    assert.equal(mode(lockPath), 0o700)
    assert.ok(lstatSync(ledgerPath).isDirectory())
    assert.equal(mode(ledgerPath), 0o700)
    const facets = expectedFacets(ledgerFailure.input)
    const reservationDir = join(
      ledgerFailure.governanceRoot,
      'reservations',
      facets.taskId,
    )
    const reservationPath = join(reservationDir, 'reservation.json')
    assert.equal(mode(reservationDir), 0o700)
    assert.equal(mode(reservationPath), 0o600)
    const reservationSource = readFileSync(reservationPath, 'utf8')
    assert.deepEqual(JSON.parse(reservationSource), { v: 1, ...facets })
    for (const forbidden of rawValues(ledgerFailure.input, ledgerFailure.rawNonce)) {
      assert.equal(reservationSource.includes(forbidden), false)
    }
    const reservationStat = lstatSync(reservationPath, { bigint: true })
    expectCode(() => reserveInvocation(ledgerFailure.input), EXPECTED_ERROR_CODES.BUSY)
    const retainedTombstone = lstatSync(lockPath, { bigint: true })
    assert.equal(retainedTombstone.ino, lockTombstone.ino)
    assert.equal(retainedTombstone.mtimeNs, lockTombstone.mtimeNs)
    const retainedReservation = lstatSync(reservationPath, { bigint: true })
    assert.equal(retainedReservation.ino, reservationStat.ino)
    assert.equal(retainedReservation.mtimeNs, reservationStat.mtimeNs)
    assert.equal(readFileSync(reservationPath, 'utf8'), reservationSource)
  } finally {
    cleanupFixture(ledgerFailure)
  }
}

function verifyMutationTimingTombstones() {
  const cases = [
    {
      label: 'reservations-root-mutation',
      hookName: 'afterReservationsRootCreated',
      markerPath: (fixture) => join(fixture.governanceRoot, 'reservations'),
    },
    {
      label: 'identity-directory-mutation',
      hookName: 'afterReservationDirectoryCreated',
      markerPath: (fixture) => join(
        fixture.governanceRoot,
        'reservations',
        expectedFacets(fixture.input).taskId,
      ),
    },
    {
      label: 'reservation-file-open',
      hookName: 'afterReservationFileOpened',
      markerPath: (fixture) => join(
        fixture.governanceRoot,
        'reservations',
        expectedFacets(fixture.input).taskId,
        'reservation.json',
      ),
      emptyFile: true,
    },
  ]

  for (const testCase of cases) {
    const fixture = createFixture(testCase.label)
    try {
      expectCode(
        () => reserveInvocation(fixture.input, {
          internalHooks: {
            [testCase.hookName]() { throw new Error('injected mutation failure') },
          },
        }),
        EXPECTED_ERROR_CODES.LEDGER,
      )
      const lockPath = join(fixture.governanceRoot, 'reservation.lock')
      assert.ok(lstatSync(lockPath).isDirectory())
      assert.equal(mode(lockPath), 0o700)
      const markerPath = testCase.markerPath(fixture)
      assert.ok(lstatSync(markerPath))
      if (testCase.emptyFile) assert.equal(statSync(markerPath).size, 0)
      expectCode(() => reserveInvocation(fixture.input), EXPECTED_ERROR_CODES.BUSY)
    } finally {
      cleanupFixture(fixture)
    }
  }

  const invoked = createFixture('invoked-file-open')
  try {
    reserveInvocation(invoked.input)
    mkdirSync(invoked.input.clonePath, { mode: 0o700 })
    expectCode(
      () => consumeInvocation(invoked.input, {
        internalHooks: {
          afterInvokedFileOpened() { throw new Error('injected invoked failure') },
        },
      }),
      EXPECTED_ERROR_CODES.LEDGER,
    )
    const lockPath = join(invoked.governanceRoot, 'reservation.lock')
    assert.ok(lstatSync(lockPath).isDirectory())
    assert.equal(mode(lockPath), 0o700)
    const invokedPath = join(
      invoked.governanceRoot,
      'reservations',
      expectedFacets(invoked.input).taskId,
      'invoked.json',
    )
    assert.equal(statSync(invokedPath).size, 0)
    expectCode(() => consumeInvocation(invoked.input), EXPECTED_ERROR_CODES.BUSY)
  } finally {
    cleanupFixture(invoked)
  }
}

async function verifyBoundedLedgerNodes() {
  const fifo = createFixture('ledger-fifo')
  try {
    const ledgerPath = join(fifo.governanceRoot, 'invocations.jsonl')
    const created = spawnSync('mkfifo', [ledgerPath], { encoding: 'utf8' })
    assert.equal(created.status, 0, created.stderr)
    chmodSync(ledgerPath, 0o600)
    const startedAt = Date.now()
    const result = await runCli(
      ['--reserve'],
      cliEnvironment(fifo.input, fifo.rawNonce),
      fifo.root,
    )
    const elapsedMs = Date.now() - startedAt
    assertClosedCliFailure(result, rawValues(fifo.input, fifo.rawNonce))
    assert.equal(result.stderr.trim(), EXPECTED_ERROR_CODES.LEDGER)
    assert.ok(elapsedMs < CLI_TIMEOUT_MS / 2, `FIFO rejection took ${elapsedMs}ms`)
    assert.equal(existsSync(join(fifo.governanceRoot, 'reservation.lock')), false)
  } finally {
    cleanupFixture(fifo)
  }

  const linkedLedger = createFixture('ledger-hardlink')
  try {
    const sourcePath = join(linkedLedger.root, 'linked-ledger-source')
    const ledgerPath = join(linkedLedger.governanceRoot, 'invocations.jsonl')
    writeFileSync(sourcePath, '', { mode: 0o600 })
    linkSync(sourcePath, ledgerPath)
    assert.equal(statSync(ledgerPath).nlink, 2)
    expectCode(() => reserveInvocation(linkedLedger.input), EXPECTED_ERROR_CODES.LEDGER)
    assert.equal(existsSync(join(linkedLedger.governanceRoot, 'reservation.lock')), false)
  } finally {
    cleanupFixture(linkedLedger)
  }

  const sparseLedger = createFixture('ledger-sparse-oversize')
  try {
    const ledgerPath = join(sparseLedger.governanceRoot, 'invocations.jsonl')
    writeFileSync(ledgerPath, '', { mode: 0o600 })
    truncateSync(ledgerPath, MAX_LEDGER_BYTES + 1)
    const startedAt = Date.now()
    expectCode(() => reserveInvocation(sparseLedger.input), EXPECTED_ERROR_CODES.LEDGER)
    assert.ok(Date.now() - startedAt < CLI_TIMEOUT_MS / 2)
    assert.equal(existsSync(join(sparseLedger.governanceRoot, 'reservation.lock')), false)
  } finally {
    cleanupFixture(sparseLedger)
  }

  const linkedMarker = createFixture('marker-hardlink')
  try {
    reserveInvocation(linkedMarker.input)
    mkdirSync(linkedMarker.input.clonePath, { mode: 0o700 })
    const reservationPath = join(
      linkedMarker.governanceRoot,
      'reservations',
      expectedFacets(linkedMarker.input).taskId,
      'reservation.json',
    )
    linkSync(reservationPath, join(linkedMarker.root, 'reservation-hardlink'))
    assert.equal(statSync(reservationPath).nlink, 2)
    expectCode(() => consumeInvocation(linkedMarker.input), EXPECTED_ERROR_CODES.LEDGER)
    assert.equal(existsSync(join(linkedMarker.governanceRoot, 'reservation.lock')), false)
  } finally {
    cleanupFixture(linkedMarker)
  }
}

function verifyRepositoryProbeIsLazyAndFailClosed() {
  const source = readFileSync(GOVERNANCE_MODULE, 'utf8')
  assert.doesNotMatch(source, /^const MODULE_REPOSITORY\b/m)
  assert.match(
    source,
    /if \(error\?\.code !== 'ENOENT' && error\?\.code !== 'ENOTDIR'\) fail\(ERROR_CODES\.PATH\)/,
  )
  const validationStart = source.indexOf('function validateGovernanceRoot')
  const validationEnd = source.indexOf('\nfunction ', validationStart + 1)
  assert.ok(validationStart >= 0 && validationEnd > validationStart)
  assert.match(
    source.slice(validationStart, validationEnd),
    /containingRepository\(dirname\(MODULE_PATH\)\)/,
  )
}

function verifyMalformedInputs() {
  const cases = [
    ['task', (fixture) => ({ ...fixture.input, taskId: 'Bad Task' }), EXPECTED_ERROR_CODES.INPUT],
    ['baseline', (fixture) => ({ ...fixture.input, baselineSha: 'ABC123' }), EXPECTED_ERROR_CODES.INPUT],
    ['branch-space', (fixture) => ({ ...fixture.input, branchName: 'bad branch' }), EXPECTED_ERROR_CODES.INPUT],
    ['branch-leading-dash', (fixture) => ({ ...fixture.input, branchName: '-foo' }), EXPECTED_ERROR_CODES.INPUT],
    ['branch-dotdot', (fixture) => ({ ...fixture.input, branchName: 'bad..branch' }), EXPECTED_ERROR_CODES.INPUT],
    ['branch-reflog', (fixture) => ({ ...fixture.input, branchName: 'bad@{branch' }), EXPECTED_ERROR_CODES.INPUT],
    ['branch-lock', (fixture) => ({ ...fixture.input, branchName: 'bad.lock' }), EXPECTED_ERROR_CODES.INPUT],
    ['clone-relative', (fixture) => ({ ...fixture.input, clonePath: 'relative/clone' }), EXPECTED_ERROR_CODES.PATH],
    ['evidence-relative', (fixture) => ({ ...fixture.input, evidenceOut: 'relative/evidence.json' }), EXPECTED_ERROR_CODES.PATH],
    ['archive-relative', (fixture) => ({ ...fixture.input, archivePath: 'relative/archive.tgz' }), EXPECTED_ERROR_CODES.PATH],
  ]
  for (const [label, mutate, expectedCode] of cases) {
    const fixture = createFixture(`invalid-${label}`)
    try {
      expectCode(() => reserveInvocation(mutate(fixture)), expectedCode)
      assert.equal(existsSync(join(fixture.governanceRoot, 'reservation.lock')), false)
    } finally {
      cleanupFixture(fixture)
    }
  }

  const looseRoot = createFixture('invalid-root-mode')
  try {
    chmodSync(looseRoot.governanceRoot, 0o755)
    expectCode(() => reserveInvocation(looseRoot.input), EXPECTED_ERROR_CODES.PATH)
  } finally {
    cleanupFixture(looseRoot)
  }

  const linkedRoot = createFixture('invalid-root-symlink')
  try {
    const governanceAlias = join(linkedRoot.root, 'governance-alias')
    symlinkSync(linkedRoot.governanceRoot, governanceAlias, 'dir')
    expectCode(
      () => reserveInvocation({ ...linkedRoot.input, governanceRoot: governanceAlias }),
      EXPECTED_ERROR_CODES.PATH,
    )
  } finally {
    cleanupFixture(linkedRoot)
  }

  const insideRoot = createFixture('invalid-clone-inside-root')
  try {
    mkdirSync(join(insideRoot.governanceRoot, 'clones'), { mode: 0o700 })
    expectCode(
      () => reserveInvocation({
        ...insideRoot.input,
        clonePath: join(insideRoot.governanceRoot, 'clones', 'fresh-clone'),
      }),
      EXPECTED_ERROR_CODES.PATH,
    )
  } finally {
    cleanupFixture(insideRoot)
  }
}

function verifyLedgerShapeAndModes() {
  const fixture = createFixture('ledger-shape')
  const priorNonce = process.env.D2_NONCE
  process.env.D2_NONCE = fixture.rawNonce
  try {
    reserveInvocation(fixture.input, { now: () => Date.parse('2026-08-01T02:03:04.000Z') })
    mkdirSync(fixture.input.clonePath, { mode: 0o700 })
    consumeInvocation(fixture.input, { now: () => Date.parse('2026-08-01T02:03:05.000Z') })

    const ledgerPath = join(fixture.governanceRoot, 'invocations.jsonl')
    const reservationsRoot = join(fixture.governanceRoot, 'reservations')
    assert.equal(mode(fixture.governanceRoot), 0o700)
    assert.equal(mode(ledgerPath), 0o600)
    assert.equal(mode(reservationsRoot), 0o700)
    const reservationNames = readdirSync(reservationsRoot)
    assert.equal(reservationNames.length, 1)
    assert.match(reservationNames[0], HASH)
    const reservationDir = join(reservationsRoot, reservationNames[0])
    assert.equal(mode(reservationDir), 0o700)
    assert.equal(mode(join(reservationDir, 'reservation.json')), 0o600)
    assert.equal(mode(join(reservationDir, 'invoked.json')), 0o600)

    const ledger = readFileSync(ledgerPath, 'utf8')
    const records = ledger.trimEnd().split('\n').map((line) => JSON.parse(line))
    assert.equal(records.length, 2)
    assert.deepEqual(records.map((record) => record.event), ['RESERVED', 'INVOKED'])
    const allowedKeys = [
      'archiveId', 'baselineId', 'branchId', 'cloneId', 'event',
      'evidenceId', 'recordedAt', 'taskId', 'v',
    ]
    for (const record of records) {
      assert.deepEqual(Object.keys(record).sort(), allowedKeys)
      assert.equal(record.v, 1)
      assert.match(record.recordedAt, RFC3339)
      assert.ok(Number.isFinite(Date.parse(record.recordedAt)))
      for (const key of ['archiveId', 'baselineId', 'branchId', 'cloneId', 'evidenceId', 'taskId']) {
        assert.match(record[key], HASH)
      }
    }
    for (const forbidden of rawValues(fixture.input, fixture.rawNonce)) {
      assert.equal(ledger.includes(forbidden), false)
    }
  } finally {
    if (priorNonce === undefined) delete process.env.D2_NONCE
    else process.env.D2_NONCE = priorNonce
    cleanupFixture(fixture)
  }
}

async function verifyCliRedaction() {
  const malformed = createFixture('cli-malformed')
  try {
    const input = { ...malformed.input, taskId: 'RAW TASK VALUE' }
    const result = await runCli(
      ['--reserve'],
      cliEnvironment(input, malformed.rawNonce),
      malformed.root,
    )
    assertClosedCliFailure(result, rawValues(input, malformed.rawNonce))
    assert.equal(result.stderr.trim(), EXPECTED_ERROR_CODES.INPUT)
  } finally {
    cleanupFixture(malformed)
  }

  const archive = createFixture('cli-archive')
  try {
    writeFileSync(archive.input.archivePath, 'raw archive body', { mode: 0o600 })
    const result = await runCli(
      ['--reserve'],
      cliEnvironment(archive.input, archive.rawNonce),
      archive.root,
    )
    assertClosedCliFailure(result, rawValues(archive.input, archive.rawNonce))
    assert.equal(result.stderr.trim(), EXPECTED_ERROR_CODES.ARCHIVE_EXISTS)
  } finally {
    cleanupFixture(archive)
  }
}

function uncommentedShell(source) {
  return source.split('\n').map((line) => (
    /^[ \t]*#/.test(line) ? '' : line
  )).join('\n')
}

function executableLineIndex(source, pattern, message) {
  const match = pattern.exec(source)
  assert.ok(match, message)
  return match.index
}

function shellAssignments(source) {
  const assignments = []
  for (const line of source.split('\n')) {
    let declaration = line.trimStart()
    while (true) {
      const prefix = /^(?:readonly|export|declare)\b[ \t]*/.exec(declaration)
      if (!prefix) break
      declaration = declaration.slice(prefix[0].length)
      while (/^-[A-Za-z]+\b[ \t]*/.test(declaration)) {
        declaration = declaration.replace(/^-[A-Za-z]+\b[ \t]*/, '')
      }
    }
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(declaration)
    if (assignment) assignments.push([assignment[1], assignment[2]])
  }
  return assignments
}

function shellFunctionSource(source, name) {
  const start = executableLineIndex(
    source,
    new RegExp(`^${name}\\(\\) \\{$`, 'm'),
    `${name} must exist`,
  )
  const end = source.indexOf('\n}', start)
  assert.ok(end > start, `${name} must have a complete body`)
  return Object.freeze({ start, end: end + 2, body: source.slice(start, end + 2) })
}

function assertInvocationWiring(rawRunSource) {
  const runSource = uncommentedShell(rawRunSource)
  assert.equal(runSource.split(GOVERNANCE_LAUNCH).length - 1, 1)
  assert.ok(runSource.includes(
    `done\n${GOVERNANCE_LAUNCH}\n\n[[ "$(uname -s)" == "Linux" ]]`,
  ))
  const consumeAnchor = '"$GOVERNANCE_NODE_BIN" "$SCRIPT_DIR/invocation-governance.mjs" --consume'
  const consume = executableLineIndex(
    runSource,
    /^[ \t]*"\$GOVERNANCE_NODE_BIN" "\$SCRIPT_DIR\/invocation-governance\.mjs" --consume[ \t]*\\[ \t]*$/m,
    'run.sh must consume the invocation reservation on an executable line',
  )
  const root = executableLineIndex(runSource, /^ROOT="\$\(cd -P .*\)"$/m, 'ROOT derivation must exist')
  const approvedPath = executableLineIndex(runSource, /^APPROVED_PATH=.*$/m, 'approved PATH must exist')
  const approvedExport = executableLineIndex(
    runSource,
    /^export PATH="\$APPROVED_PATH"$/m,
    'approved PATH must be exported before governance discovery',
  )
  const governanceEnv = executableLineIndex(
    runSource,
    /^GOVERNANCE_ENV_BIN="\$\(command -v env 2>\/dev\/null \|\| true\)"$/m,
    'governance env must be discovered from approved PATH',
  )
  const governanceNode = executableLineIndex(
    runSource,
    /^GOVERNANCE_NODE_BIN="\$\(command -v node 2>\/dev\/null \|\| true\)"$/m,
    'governance node must be discovered from approved PATH',
  )
  const governanceLaunch = executableLineIndex(
    runSource,
    /^[ \t]*"\$GOVERNANCE_ENV_BIN" -i PATH="\$APPROVED_PATH" HOME="\$SCRIPT_DIR"[ \t]*\\[ \t]*$/m,
    'governance consume must launch through the approved absolute env binary',
  )
  const kernel = executableLineIndex(
    runSource,
    /^\[\[ "\$\(uname -s\)" == "Linux" \]\].*$/m,
    'kernel preflight must exist',
  )
  const requiredCommands = executableLineIndex(
    runSource,
    /^required_commands=.*$/m,
    'required command preflight must exist',
  )
  const toolchain = executableLineIndex(runSource, /^node --version.*$/m, 'toolchain preflight must exist')
  const nonce = executableLineIndex(runSource, /^NONCE=.*$/m, 'nonce derivation must exist')
  assert.ok(approvedPath > root, 'approved PATH bootstrap must follow ROOT derivation')
  assert.ok(approvedPath < approvedExport, 'approved PATH must be validated before export')
  assert.ok(approvedExport < governanceEnv, 'env discovery must use approved PATH')
  assert.ok(approvedExport < governanceNode, 'node discovery must use approved PATH')
  assert.ok(governanceEnv < governanceLaunch, 'approved env discovery must precede launch')
  assert.ok(governanceNode < governanceLaunch, 'approved node discovery must precede launch')
  assert.ok(governanceLaunch < consume, 'approved env must execute the governance node consume')
  const governanceBootstrap = runSource.slice(approvedPath, governanceLaunch)
  assert.match(
    governanceBootstrap,
    /\[\[ "\$GOVERNANCE_ENV_BIN" == \/\* && -x "\$GOVERNANCE_ENV_BIN" \]\]/,
  )
  assert.match(
    governanceBootstrap,
    /\[\[ "\$GOVERNANCE_NODE_BIN" == \/\* && -x "\$GOVERNANCE_NODE_BIN" \]\]/,
  )
  assert.doesNotMatch(runSource.slice(0, consume), /^[ \t]*env[ \t]+-i\b/m)
  for (const [name, anchor] of [
    ['kernel', kernel],
    ['required commands', requiredCommands],
    ['toolchain', toolchain],
    ['nonce', nonce],
  ]) {
    assert.ok(anchor >= 0 && consume < anchor, `consume must precede ${name}`)
  }

  const identity = shellFunctionSource(runSource, 'assert_invocation_clone_identity')
  assert.match(identity.body, /git -C "\$ROOT" rev-parse HEAD/)
  assert.match(identity.body, /\[\[ "\$current_baseline" == "\$D2_BASELINE_SHA" \]\]/)
  assert.match(
    identity.body,
    /current_branch="\$\(git -C "\$ROOT" symbolic-ref --quiet --short HEAD 2>\/dev\/null\)"[ \t]*\\\n[ \t]*\|\| no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"/,
  )
  assert.match(identity.body, /\[\[ "\$current_branch" == "\$D2_BRANCH_NAME" \]\]/)
  assert.match(identity.body, /current_root="\$\(realpath "\$ROOT" 2>\/dev\/null\)"/)
  assert.match(identity.body, /invocation_clone_root="\$\(realpath "\$D2_CLONE_PATH" 2>\/dev\/null\)"/)
  assert.match(identity.body, /\[\[ "\$current_root" == "\$invocation_clone_root" \]\]/)
  assert.match(identity.body, /git -C "\$ROOT" diff --quiet --ignore-submodules --/)
  assert.match(identity.body, /git -C "\$ROOT" diff --cached --quiet --ignore-submodules --/)

  const identityCalls = [...runSource.matchAll(/^[ \t]*assert_invocation_clone_identity[ \t]*$/gm)]
    .map((match) => match.index)
  assert.equal(identityCalls.length, 3, 'clone identity must be checked exactly three times')
  const firstSystemdMutation = executableLineIndex(
    runSource,
    /^systemd-run --user --collect[ \t]*\\[ \t]*$/m,
    'systemd preflight mutation must exist',
  )
  const systemdPreflight = executableLineIndex(
    runSource,
    /^systemctl --user show-environment.*$/m,
    'systemd preflight gate must exist',
  )
  const drill = executableLineIndex(
    runSource,
    /^[ \t]*"\$NODE_BIN" "\$SCRIPT_DIR\/drill\.mjs"[ \t]*$/m,
    'drill invocation must exist',
  )
  assert.ok(identityCalls[0] > identity.end && identityCalls[0] < toolchain)
  assert.ok(identityCalls[1] > toolchain && identityCalls[1] < systemdPreflight)
  assert.ok(identityCalls[2] > firstSystemdMutation && identityCalls[2] < drill)

  const traps = [...runSource.matchAll(/^[ \t]*trap\b/gm)].map((match) => match.index)
  assert.ok(traps.length > 0, 'run.sh must retain cleanup traps')
  assert.ok(traps.every((trap) => consume < trap), 'consume must precede every cleanup trap')
  const cleanupStart = executableLineIndex(
    runSource,
    /^bootstrap_cleanup\(\) \{$/m,
    'bootstrap_cleanup must exist',
  )
  assert.ok(cleanupStart > consume, 'bootstrap_cleanup must follow consume')
  const beforeCleanup = runSource.slice(0, cleanupStart)
  const cleanupSource = runSource.slice(cleanupStart)
  assert.doesNotMatch(
    cleanupSource,
    /D2_GOVERNANCE_ROOT|\b[A-Za-z_][A-Za-z0-9_]*governance[A-Za-z0-9_]*\b/i,
  )
  assert.doesNotMatch(
    cleanupSource,
    /\b(?:rm|rmdir|unlink)\b[^\n]*(?:D2_GOVERNANCE_ROOT|governance)/i,
  )
  const governanceAliases = new Set(['D2_GOVERNANCE_ROOT'])
  const assignments = shellAssignments(beforeCleanup)
  let aliasAdded = true
  while (aliasAdded) {
    aliasAdded = false
    for (const [name, value] of assignments) {
      if (governanceAliases.has(name)) continue
      if ([...governanceAliases].some((alias) => (
        new RegExp(`\\$(?:\\{${alias}\\}|${alias}(?![A-Za-z0-9_]))`).test(value)
      ))) {
        governanceAliases.add(name)
        aliasAdded = true
      }
    }
  }
  for (const alias of governanceAliases) {
    assert.doesNotMatch(
      cleanupSource,
      new RegExp(`\\$(?:\\{${alias}\\}|${alias}(?![A-Za-z0-9_]))`),
    )
  }
}

function markedBlock(source, startMarker, endMarker) {
  assert.equal((source.match(new RegExp(startMarker, 'g')) ?? []).length, 1)
  assert.equal((source.match(new RegExp(endMarker, 'g')) ?? []).length, 1)
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0 && end > start)
  return source.slice(start + startMarker.length, end)
}

function assertRunbookInvocationContract(runbook) {
  const reserveBlock = markedBlock(
    runbook,
    '<!-- D2_INVOCATION_RESERVE_COMMAND_START -->',
    '<!-- D2_INVOCATION_RESERVE_COMMAND_END -->',
  )
  const drillBlock = markedBlock(
    runbook,
    '<!-- D2_FRESH_RETAKE_COMMAND_START -->',
    '<!-- D2_FRESH_RETAKE_COMMAND_END -->',
  )
  assert.equal(reserveBlock.trim(), RESERVE_FENCED_BLOCK)
  assert.equal(runbook.split(SOURCE_PREFLIGHT_FENCED_BLOCK).length - 1, 1)
  assert.equal(runbook.split(FRESH_CLONE_FENCED_BLOCK).length - 1, 1)
  for (const command of RUNBOOK_UNIQUE_COMMANDS) {
    assert.equal(runbook.split(command).length - 1, 1)
  }
  assert.equal(
    (runbook.match(/^[ \t]*pnpm --filter @ai-job-print\/api drill:d2-same-host[ \t]*$/gm) ?? []).length,
    1,
  )
  assert.equal(
    (reserveBlock.match(/^[ \t]*node services\/api\/scripts\/d2-same-host\/invocation-governance\.mjs --reserve[ \t]*$/gm) ?? []).length,
    1,
  )
  assert.ok(reserveBlock.includes(
    [...RESERVE_FAIL_FAST_LINES, ...RESERVE_ENVIRONMENT_LINES].join('\n'),
  ))
  for (const name of REQUIRED_IDENTITIES) {
    const assignment = new RegExp(
      `^[ \\t]*${name}="\\$${name}"[ \\t]*(?:\\\\)?[ \\t]*$`,
      'm',
    )
    assert.match(reserveBlock, assignment)
    assert.match(drillBlock, assignment)
  }
}

function mutateMarkedBlock(source, startMarker, endMarker, mutation) {
  const start = source.indexOf(startMarker) + startMarker.length
  const end = source.indexOf(endMarker)
  assert.ok(start >= startMarker.length && end > start)
  const block = source.slice(start, end)
  const mutated = mutation(block)
  assert.notEqual(mutated, block)
  return `${source.slice(0, start)}${mutated}${source.slice(end)}`
}

function verifyWiringAndRunbookContracts() {
  const runSource = readFileSync(RUN_PATH, 'utf8')
  assertInvocationWiring(runSource)
  for (const mutation of [
    `if false; then\n${GOVERNANCE_LAUNCH}\nfi`,
    `cat <<'D2_GOVERNANCE_LAUNCH'\n${GOVERNANCE_LAUNCH}\nD2_GOVERNANCE_LAUNCH`,
    GOVERNANCE_LAUNCH.replace(
      RESERVE_IDENTITY_LINES[1],
      `${RESERVE_IDENTITY_LINES[1]}\n${RESERVE_IDENTITY_LINES[1]}`,
    ),
    `${GOVERNANCE_LAUNCH}\nD2_TASK_ID="overridden"`,
  ]) {
    assert.throws(() => assertInvocationWiring(runSource.replace(GOVERNANCE_LAUNCH, mutation)))
  }
  const consumeAnchor = '"$GOVERNANCE_NODE_BIN" "$SCRIPT_DIR/invocation-governance.mjs" --consume'
  assert.throws(() => assertInvocationWiring(runSource.replace(consumeAnchor, ':')))
  assert.throws(() => assertInvocationWiring(runSource.replace(consumeAnchor, `# ${consumeAnchor}`)))
  assert.throws(() => assertInvocationWiring(
    `${runSource.replace(consumeAnchor, ':')}\n${consumeAnchor}\n`,
  ))
  assert.throws(() => assertInvocationWiring(
    `${runSource}\nrm -rf -- "$D2_GOVERNANCE_ROOT"\n`,
  ))
  const nodeDiscovery = 'GOVERNANCE_NODE_BIN="$(command -v node 2>/dev/null || true)"\n'
  assert.ok(runSource.includes(nodeDiscovery))
  assert.throws(() => assertInvocationWiring(
    runSource.replace(nodeDiscovery, '').replace('APPROVED_PATH=', `${nodeDiscovery}APPROVED_PATH=`),
  ))
  assert.throws(() => assertInvocationWiring(
    runSource.replace('"$GOVERNANCE_ENV_BIN" -i', 'env -i'),
  ))
  const approvedBootstrapStart = runSource.indexOf('APPROVED_PATH=')
  const approvedBootstrapEndMarker = 'export PATH="$APPROVED_PATH"\n'
  const approvedBootstrapEnd = runSource.indexOf(approvedBootstrapEndMarker, approvedBootstrapStart)
    + approvedBootstrapEndMarker.length
  assert.ok(approvedBootstrapStart >= 0 && approvedBootstrapEnd > approvedBootstrapStart)
  const approvedBootstrap = runSource.slice(approvedBootstrapStart, approvedBootstrapEnd)
  const withoutApprovedBootstrap = `${runSource.slice(0, approvedBootstrapStart)}${runSource.slice(approvedBootstrapEnd)}`
  assert.throws(() => assertInvocationWiring(withoutApprovedBootstrap.replace(
    '[[ "$(uname -s)" == "Linux" ]]',
    `${approvedBootstrap}[[ "$(uname -s)" == "Linux" ]]`,
  )))
  for (const criticalIdentityCheck of [
    'git -C "$ROOT" rev-parse HEAD',
    '[[ "$current_baseline" == "$D2_BASELINE_SHA" ]]',
    'git -C "$ROOT" symbolic-ref --quiet --short HEAD',
    '[[ "$current_branch" == "$D2_BRANCH_NAME" ]]',
    'realpath "$D2_CLONE_PATH"',
    '[[ "$current_root" == "$invocation_clone_root" ]]',
    'git -C "$ROOT" diff --quiet --ignore-submodules --',
    'git -C "$ROOT" diff --cached --quiet --ignore-submodules --',
  ]) {
    assert.ok(runSource.includes(criticalIdentityCheck))
    assert.throws(() => assertInvocationWiring(runSource.replace(criticalIdentityCheck, ':')))
  }
  const identityCallPattern = /^[ \t]*assert_invocation_clone_identity[ \t]*$/gm
  const identityCallMatches = [...runSource.matchAll(identityCallPattern)]
  assert.equal(identityCallMatches.length, 3)
  for (const identityCall of identityCallMatches) {
    assert.throws(() => assertInvocationWiring(
      `${runSource.slice(0, identityCall.index)}:${runSource.slice(identityCall.index + identityCall[0].length)}`,
    ))
  }
  assert.throws(() => assertInvocationWiring(runSource.replace(
    'bootstrap_cleanup() {',
    'GOVERNANCE_CACHE="$D2_GOVERNANCE_ROOT/cache"\nbootstrap_cleanup() {\n  rmdir -- "$GOVERNANCE_CACHE"',
  )))
  assert.throws(() => assertInvocationWiring(runSource.replace(
    'bootstrap_cleanup() {',
    'CLEANUP_TARGET="$D2_GOVERNANCE_ROOT/cache"\nbootstrap_cleanup() {\n  unlink -- "$CLEANUP_TARGET"',
  )))
  assert.throws(() => assertInvocationWiring(runSource.replace(
    'bootstrap_cleanup() {',
    'readonly cleanup_target="$D2_GOVERNANCE_ROOT/cache"\nbootstrap_cleanup() {\n  rm -rf -- "$cleanup_target"',
  )))
  assert.throws(() => assertInvocationWiring(runSource.replace(
    'bootstrap_cleanup() {',
    'export cleanup_target="$D2_GOVERNANCE_ROOT/cache"\nbootstrap_cleanup() {\n  rmdir -- "$cleanup_target"',
  )))
  assert.throws(() => assertInvocationWiring(runSource.replace(
    'bootstrap_cleanup() {',
    'declare cleanup_target="$D2_GOVERNANCE_ROOT/cache"\nbootstrap_cleanup() {\n  unlink -- "$cleanup_target"',
  )))

  const runbook = readFileSync(RUNBOOK_PATH, 'utf8')
  assertRunbookInvocationContract(runbook)
  for (const command of RUNBOOK_UNIQUE_COMMANDS) {
    for (const suffix of [' || true', ' # duplicate']) {
      assert.throws(() => assertRunbookInvocationContract(`${runbook}\n${command}${suffix}\n`))
    }
  }
  for (const command of CRITICAL_CHAIN_COMMANDS) {
    assert.throws(() => assertRunbookInvocationContract(runbook.replace(
      `${command} && ${SHELL_CONTINUATION}`,
      command,
    )))
  }
  for (const requiredLine of [
    SOURCE_PREFLIGHT_LINES[7],
    SOURCE_PREFLIGHT_LINES[8],
    SOURCE_PREFLIGHT_LINES[9],
    FRESH_CLONE_LINES[6],
    FRESH_CLONE_LINES[8],
    FRESH_CLONE_LINES[12],
  ]) {
    assert.throws(() => assertRunbookInvocationContract(runbook.replace(requiredLine, ':')))
  }
  for (const line of RESERVE_FAIL_FAST_LINES) {
    assert.throws(() => assertRunbookInvocationContract(
      mutateMarkedBlock(
        runbook,
        'D2_INVOCATION_RESERVE_COMMAND_START',
        'D2_INVOCATION_RESERVE_COMMAND_END',
        (block) => block.replace(`${line}\n`, ''),
      ),
    ))
  }
  assert.throws(() => assertRunbookInvocationContract(
    mutateMarkedBlock(
      runbook,
      'D2_INVOCATION_RESERVE_COMMAND_START',
      'D2_INVOCATION_RESERVE_COMMAND_END',
      (block) => block.replace(RESERVE_ENVIRONMENT_LINES[0], `env ${SHELL_CONTINUATION}`),
    ),
  ))
  for (const line of RESERVE_ENVIRONMENT_LINES.slice(1)) {
    assert.throws(() => assertRunbookInvocationContract(
      mutateMarkedBlock(
        runbook,
        'D2_INVOCATION_RESERVE_COMMAND_START',
        'D2_INVOCATION_RESERVE_COMMAND_END',
        (block) => block.replace(`${line}\n`, ''),
      ),
    ))
  }
  assert.throws(() => assertRunbookInvocationContract(
    mutateMarkedBlock(
      runbook,
      'D2_INVOCATION_RESERVE_COMMAND_START',
      'D2_INVOCATION_RESERVE_COMMAND_END',
      (block) => block.replace('D2_TASK_ID="$D2_TASK_ID"', 'D2_TASK_IDENTIFIER="$D2_TASK_ID"'),
    ),
  ))
  assert.throws(() => assertRunbookInvocationContract(
    mutateMarkedBlock(
      runbook,
      'D2_FRESH_RETAKE_COMMAND_START',
      'D2_FRESH_RETAKE_COMMAND_END',
      (block) => block.replace('D2_TASK_ID="$D2_TASK_ID"', 'D2_TASK_IDENTIFIER="$D2_TASK_ID"'),
    ),
  ))
  assert.throws(() => assertRunbookInvocationContract(
    `${runbook}\n<!-- D2_INVOCATION_RESERVE_COMMAND_START -->\n`,
  ))
  assert.throws(() => assertRunbookInvocationContract(
    `${runbook}\npnpm --filter @ai-job-print/api drill:d2-same-host\n`,
  ))
}

export async function verifyInvocationGovernanceContract() {
  assert.deepEqual(ERROR_CODES, EXPECTED_ERROR_CODES)
  verifyReserveConsumeAndReplay()
  await verifyConcurrentSingleWinner()
  verifyArchiveAndAliasRejection()
  verifyCanonicalTargetSafety()
  verifyCrashAndLedgerFailures()
  verifyMutationTimingTombstones()
  await verifyBoundedLedgerNodes()
  verifyRepositoryProbeIsLazyAndFailClosed()
  verifyMalformedInputs()
  verifyLedgerShapeAndModes()
  await verifyCliRedaction()
  verifyWiringAndRunbookContracts()
  console.log('  PASS invocation governance atomically reserves and consumes each retake once')
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await verifyInvocationGovernanceContract()
}
