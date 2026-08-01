#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync, cpSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { ERROR_CODES, GovernanceError } from './governance-contract.mjs'
import {
  ensureLayout, invokeExecution, parseInvokeCli, parseReserveCli, runCli, runtimeAdapters,
} from './governance.mjs'

const roots = []
let sequence = 0
function tempRoot(prefix) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix)); roots.push(root); return root
}
function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd, shell: false, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
  })
  if (result.status !== 0) throw new Error(`fixture git failed: ${args[0]}`)
  return result.stdout.replace(/\r?\n$/u, '')
}
function createClonePair() {
  const root = tempRoot('d2-invoke-clones-')
  const origin = join(root, 'origin.git'); const seed = join(root, 'seed')
  const cloneA = join(root, 'clone-a'); const cloneB = join(root, 'clone-b')
  git(root, ['init', '--bare', origin]); git(root, ['clone', origin, seed])
  git(seed, ['config', 'user.name', 'D2 Invocation Fixture'])
  git(seed, ['config', 'user.email', 'd2-invocation@example.invalid'])
  const branch = 'fixture/invocation'; git(seed, ['checkout', '-b', branch])
  const sourceDir = dirname(fileURLToPath(import.meta.url))
  const targetDir = join(seed, 'services/api/scripts/d2-same-host')
  cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => basename(source).startsWith('governance') || source === sourceDir,
  })
  git(seed, ['add', 'services/api/scripts/d2-same-host'])
  git(seed, ['commit', '-m', 'fixture governance runtime'])
  git(seed, ['push', '-u', 'origin', branch])
  git(root, ['clone', '--branch', branch, origin, cloneA])
  git(root, ['clone', '--branch', branch, origin, cloneB])
  return Object.freeze({
    cloneA: realpathSync(cloneA), cloneB: realpathSync(cloneB), branch,
    head: git(cloneA, ['rev-parse', 'HEAD']),
    governanceA: join(cloneA, 'services/api/scripts/d2-same-host/governance.mjs'),
    governanceB: join(cloneB, 'services/api/scripts/d2-same-host/governance.mjs'),
  })
}
let clonePair
function pair() { clonePair ??= createClonePair(); return clonePair }
function cliArgs(root, outputs, clone = pair().cloneA) {
  sequence += 1
  return [
    'reserve', '--state-root', root, '--task-id', `invoke-task-${sequence}`,
    '--branch', pair().branch, '--baseline', pair().head, '--clone', clone,
    '--evidence', join(outputs, `evidence-${sequence}.json`),
    '--archive', join(outputs, `archive-${sequence}`),
  ]
}
function reserveCli() {
  const root = tempRoot('d2-invoke-state-'); chmodSync(root, 0o700)
  const outputs = tempRoot('d2-invoke-output-'); const args = cliArgs(root, outputs)
  const result = spawnSync(process.execPath, [pair().governanceA, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const match = /^D2_PRIME_GOVERNANCE_RESERVED ([0-9a-f]{32})\n$/u.exec(result.stdout)
  assert.ok(match)
  return Object.freeze({
    root, outputs, reservationId: match[1], evidenceOut: args.at(-3), archiveOut: args.at(-1),
  })
}
function invokeChild(governance, reservation, fd = true) {
  const stdio = fd ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
  const child = spawn(process.execPath, [
    governance, 'invoke', '--state-root', reservation.root,
    '--reservation-id', reservation.reservationId, '--context-fd', '3',
  ], { stdio })
  const chunks = { stdout: [], stderr: [], context: [] }
  child.stdout.on('data', (value) => chunks.stdout.push(value))
  child.stderr.on('data', (value) => chunks.stderr.push(value))
  if (fd) child.stdio[3].on('data', (value) => chunks.context.push(value))
  return new Promise((resolve) => child.once('close', (code) => resolve(Object.freeze({
    code,
    stdout: Buffer.concat(chunks.stdout).toString('utf8'),
    stderr: Buffer.concat(chunks.stderr).toString('utf8'),
    context: Buffer.concat(chunks.context).toString('utf8'),
  }))))
}
function expectCode(code, action) {
  assert.throws(action, (error) => error instanceof GovernanceError && error.code === code)
}
function invokeInput(reservation) {
  return { stateRoot: reservation.root, reservationId: reservation.reservationId, contextFd: 3 }
}
function testAdapters(reservation, overrides = {}) {
  return Object.freeze({
    ...runtimeAdapters, filesystemKind: () => 0xef53n,
    moduleCloneRoot: () => pair().cloneA, randomId: () => 'd'.repeat(32),
    monotonicTime: () => 1n, now: () => new Date('2026-08-01T00:10:00.000Z'),
    fault: () => {}, writeInvocationContext: (_fd, value) => value.length, ...overrides,
  })
}

test('reserve and invoke CLI tables map exact long options and reject malformed argv', () => {
  const reserveArgv = [
    '--state-root', '/state', '--task-id', 'task-1', '--branch', 'branch/main',
    '--baseline', 'a'.repeat(40), '--clone', '/clone', '--evidence', '/evidence.json',
    '--archive', '/archive',
  ]
  assert.deepEqual(parseReserveCli(reserveArgv), {
    stateRoot: '/state', taskId: 'task-1', branch: 'branch/main', baselineOid: 'a'.repeat(40),
    cloneRoot: '/clone', evidenceOut: '/evidence.json', archiveOut: '/archive',
  })
  const invokeArgv = ['--state-root', '/state', '--reservation-id', 'b'.repeat(32), '--context-fd', '3']
  assert.deepEqual(parseInvokeCli(invokeArgv), {
    stateRoot: '/state', reservationId: 'b'.repeat(32), contextFd: 3,
  })
  for (const argv of [
    [...reserveArgv, '--unknown', 'x'], [...reserveArgv, '--task-id', 'again'],
    reserveArgv.slice(0, -1), ['-s', '/state'], ['--state-root=/state'],
  ]) expectCode(ERROR_CODES.INPUT, () => parseReserveCli(argv))
  for (const argv of [
    [...invokeArgv, '--unknown', 'x'], [...invokeArgv, '--context-fd', '3'],
    invokeArgv.slice(0, -1), ['-s', '/state'], ['--context-fd=3'],
    [...invokeArgv.slice(0, -1), '--missing-value'],
  ]) expectCode(ERROR_CODES.INPUT, () => parseInvokeCli(argv))
  for (const fd of ['3.0', '03', 'Infinity', 'NaN', '-3']) {
    expectCode(ERROR_CODES.INPUT, () => parseInvokeCli([...invokeArgv.slice(0, -1), fd]))
  }
})

test('symlink direct entry executes fail-closed while pure import stays silent', () => {
  const root = tempRoot('d2-invoke-entry-')
  const governance = join(dirname(fileURLToPath(import.meta.url)), 'governance.mjs')
  const link = join(root, 'governance-link.mjs'); symlinkSync(governance, link)
  const direct = spawnSync(process.execPath, [link, 'bogus'], { encoding: 'utf8' })
  assert.deepEqual({ status: direct.status, stdout: direct.stdout, stderr: direct.stderr }, {
    status: 2, stdout: '', stderr: `${ERROR_CODES.INPUT}\n`,
  })
  const imported = spawnSync(process.execPath, [
    '--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(link).href)})`,
  ], { encoding: 'utf8' })
  assert.deepEqual({ status: imported.status, stdout: imported.stdout, stderr: imported.stderr }, {
    status: 0, stdout: '', stderr: '',
  })
})

test('CLI emits each fixed error as one stderr line without canary leakage', () => {
  const argv = ['invoke', '--state-root', '/state', '--reservation-id', 'c'.repeat(32), '--context-fd', '3']
  for (const code of Object.values(ERROR_CODES)) {
    const output = { stdout: '', stderr: '' }
    const exitCode = runCli(argv, {
      invoke: () => {
        const error = new GovernanceError(code); error.cause = new Error('RAW_ERROR_CANARY'); throw error
      },
      reserve: () => { throw new Error('unused') },
      stdout: (value) => { output.stdout += value }, stderr: (value) => { output.stderr += value },
    })
    assert.deepEqual({ exitCode, ...output }, { exitCode: 2, stdout: '', stderr: `${code}\n` })
    assert.equal(output.stderr.includes('RAW_ERROR_CANARY'), false)
  }
})

test('CLI dispatches both success commands and maps unknown failures without leakage', () => {
  const reservationId = 'e'.repeat(32)
  const outputs = []
  const io = {
    reserve: () => ({ reservationId }), invoke: () => ({ reservationId }),
    stdout: (value) => outputs.push(['stdout', value]),
    stderr: (value) => outputs.push(['stderr', value]),
  }
  const reserve = [
    'reserve', '--state-root', '/state', '--task-id', 'task-1', '--branch', 'branch/main',
    '--baseline', 'a'.repeat(40), '--clone', '/clone', '--evidence', '/evidence',
    '--archive', '/archive',
  ]
  const invoke = [
    'invoke', '--state-root', '/state', '--reservation-id', reservationId, '--context-fd', '3',
  ]
  assert.equal(runCli(reserve, io), 0)
  assert.equal(runCli(invoke, io), 0)
  assert.equal(runCli(['unknown'], io), 2)
  assert.equal(runCli(invoke, { ...io, invoke: () => { throw new Error('CLI_CANARY') } }), 2)
  assert.deepEqual(outputs, [
    ['stdout', `D2_PRIME_GOVERNANCE_RESERVED ${reservationId}\n`],
    ['stdout', `D2_PRIME_GOVERNANCE_INVOKED ${reservationId}\n`],
    ['stderr', `${ERROR_CODES.INPUT}\n`],
    ['stderr', `${ERROR_CODES.GOVERNANCE_STATE}\n`],
  ])
})

test('spawned invoke keeps stdout opaque and writes exactly two private fd lines', async () => {
  const reservation = reserveCli()
  const result = await invokeChild(pair().governanceA, reservation)
  assert.deepEqual({ code: result.code, stderr: result.stderr }, { code: 0, stderr: '' })
  assert.equal(result.stdout, `D2_PRIME_GOVERNANCE_INVOKED ${reservation.reservationId}\n`)
  assert.equal(result.context, `${dirname(reservation.evidenceOut)}\n${reservation.evidenceOut}\n`)
  assert.equal(result.stdout.includes(reservation.evidenceOut), false)
  const second = await invokeChild(pair().governanceA, reservation)
  assert.deepEqual(second, {
    code: 2, stdout: '', stderr: `${ERROR_CODES.ALREADY_INVOKED}\n`, context: '',
  })
})

test('clone B cannot consume clone A reservation before an invocation tombstone exists', async () => {
  const reservation = reserveCli()
  const result = await invokeChild(pair().governanceB, reservation)
  assert.deepEqual(result, {
    code: 2, stdout: '', stderr: `${ERROR_CODES.GIT_IDENTITY}\n`, context: '',
  })
  assert.equal(readdirSync(join(reservation.root, 'invocations')).length, 0)
})

test('clone B symlink bridge to clone A module is rejected before invocation consumption', async () => {
  const reservation = reserveCli()
  const displaced = `${pair().governanceB}.original`
  renameSync(pair().governanceB, displaced)
  symlinkSync(pair().governanceA, pair().governanceB)
  try {
    const result = await invokeChild(pair().governanceB, reservation)
    assert.deepEqual(result, {
      code: 2, stdout: '', stderr: `${ERROR_CODES.GIT_IDENTITY}\n`, context: '',
    })
    assert.equal(readdirSync(join(reservation.root, 'invocations')).length, 0)
  } finally {
    rmSync(pair().governanceB, { force: true })
    renameSync(displaced, pair().governanceB)
  }
})

test('ancestor directory symlink alias to clone A module is rejected before invocation consumption', async () => {
  const reservation = reserveCli()
  const aliasRoot = tempRoot('d2-invoke-ancestor-alias-')
  const alias = join(aliasRoot, 'module-alias')
  symlinkSync(dirname(pair().governanceA), alias)
  const entry = join(alias, 'governance.mjs')
  assert.equal(lstatSync(entry).isSymbolicLink(), false)
  const result = await invokeChild(entry, reservation)
  assert.deepEqual(result, {
    code: 2, stdout: '', stderr: `${ERROR_CODES.GIT_IDENTITY}\n`, context: '',
  })
  assert.equal(readdirSync(join(reservation.root, 'invocations')).length, 0)
})

test('hardlinked governance CLI entry is rejected before invocation consumption', async () => {
  const reservation = reserveCli()
  const displaced = `${pair().governanceB}.original`
  renameSync(pair().governanceB, displaced)
  linkSync(pair().governanceA, pair().governanceB)
  try {
    assert.equal(lstatSync(pair().governanceB).nlink, 2)
    const result = await invokeChild(pair().governanceB, reservation)
    assert.deepEqual(result, {
      code: 2, stdout: '', stderr: `${ERROR_CODES.GIT_IDENTITY}\n`, context: '',
    })
    assert.equal(readdirSync(join(reservation.root, 'invocations')).length, 0)
  } finally {
    rmSync(pair().governanceB, { force: true })
    renameSync(displaced, pair().governanceB)
  }
})

test('clone and future target drift are rejected before the invocation commit point', () => {
  const dirty = reserveCli(); writeFileSync(join(pair().cloneA, 'dirty-invoke.txt'), 'dirty\n')
  try {
    expectCode(ERROR_CODES.GIT_IDENTITY,
      () => invokeExecution(invokeInput(dirty), testAdapters(dirty)))
  } finally { rmSync(join(pair().cloneA, 'dirty-invoke.txt')) }
  const evidence = reserveCli(); writeFileSync(evidence.evidenceOut, 'occupied\n')
  expectCode(ERROR_CODES.ALREADY_RESERVED,
    () => invokeExecution(invokeInput(evidence), testAdapters(evidence)))
  const archive = reserveCli(); writeFileSync(archive.archiveOut, 'occupied\n')
  expectCode(ERROR_CODES.ARCHIVE_EXISTS,
    () => invokeExecution(invokeInput(archive), testAdapters(archive)))
  for (const reservation of [dirty, evidence, archive]) {
    assert.equal(readdirSync(join(reservation.root, 'invocations')).length, 0)
  }
})

test('two workers invoking concurrently have exactly one permanent winner', async () => {
  const reservation = reserveCli(); const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const workerUrl = new URL('./invocation-worker-fixture.mjs', import.meta.url)
  const start = (index) => new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: {
      gate, workerCount: 2, cloneRoot: pair().cloneA, input: invokeInput(reservation),
      eventId: (index + 10).toString(16).padStart(32, '0'),
      monotonicTime: index + 10, now: `2026-08-01T00:10:0${index}.000Z`,
    } })
    let message
    worker.once('message', (value) => { message = value })
    worker.once('error', reject)
    worker.once('exit', (exitCode) => resolve({ exitCode, ...message }))
  })
  const results = await Promise.all([start(0), start(1)])
  assert.equal(results.filter(({ ok }) => ok).length, 1)
  assert.deepEqual(results.filter(({ ok }) => !ok).map(({ exitCode, code }) => [exitCode, code]), [
    [2, ERROR_CODES.ALREADY_INVOKED],
  ])
  assert.equal(readdirSync(join(reservation.root, 'invocations')).length, 1)
})

test('event or private fd write failure permanently consumes invocation', () => {
  const eventFailure = reserveCli()
  let invokedEventWrite = false
  const eventAdapters = testAdapters(eventFailure, { writeContext: (fd, value) => {
    if (value.includes(Buffer.from('"kind":"INVOKED"'))) {
      invokedEventWrite = true
      return runtimeAdapters.writeContext(fd, value.subarray(0, 1))
    }
    return runtimeAdapters.writeContext(fd, value)
  } })
  expectCode(ERROR_CODES.WRITE,
    () => invokeExecution(invokeInput(eventFailure), eventAdapters))
  assert.equal(invokedEventWrite, true)
  assert.equal(readdirSync(join(eventFailure.root, 'invocations')).length, 1)
  expectCode(ERROR_CODES.LEDGER,
    () => invokeExecution(invokeInput(eventFailure), testAdapters(eventFailure)))

  const fdFailure = reserveCli()
  expectCode(ERROR_CODES.WRITE, () => invokeExecution(invokeInput(fdFailure), testAdapters(fdFailure, {
    writeInvocationContext: (_fd, value) => value.length - 1,
  })))
  expectCode(ERROR_CODES.ALREADY_INVOKED,
    () => invokeExecution(invokeInput(fdFailure), testAdapters(fdFailure)))
})

test('only invocation target EEXIST maps to ALREADY_INVOKED; other faults map to WRITE', () => {
  const before = reserveCli()
  expectCode(ERROR_CODES.WRITE, () => invokeExecution(invokeInput(before), testAdapters(before, {
    fault: (point) => {
      if (point === 'before-invocation-tombstone') {
        throw new GovernanceError(ERROR_CODES.ALREADY_INVOKED)
      }
    },
  })))
  assert.equal(readdirSync(join(before.root, 'invocations')).length, 0)

  const after = reserveCli()
  expectCode(ERROR_CODES.WRITE, () => invokeExecution(invokeInput(after), testAdapters(after, {
    fault: (point) => {
      if (point === 'after-invocation-tombstone') {
        throw new GovernanceError(ERROR_CODES.ALREADY_INVOKED)
      }
    },
  })))
  assert.equal(readdirSync(join(after.root, 'invocations')).length, 1)
  expectCode(ERROR_CODES.ALREADY_INVOKED,
    () => invokeExecution(invokeInput(after), testAdapters(after)))
})

test('invoke validates missing manifests, module adapters, timestamps, event ids, and context fallback', () => {
  const missingRoot = tempRoot('d2-invoke-missing-'); chmodSync(missingRoot, 0o700)
  const missingAdapters = testAdapters({ root: missingRoot })
  ensureLayout(missingRoot, missingAdapters)
  expectCode(ERROR_CODES.MANIFEST, () => invokeExecution({
    stateRoot: missingRoot, reservationId: 'f'.repeat(32), contextFd: 3,
  }, missingAdapters))

  for (const thrown of [new Error('MODULE_CANARY'), new GovernanceError(ERROR_CODES.GIT_IDENTITY)]) {
    const reservation = reserveCli()
    expectCode(ERROR_CODES.GIT_IDENTITY, () => invokeExecution(
      invokeInput(reservation), testAdapters(reservation, { moduleCloneRoot: () => { throw thrown } }),
    ))
    assert.equal(readdirSync(join(reservation.root, 'invocations')).length, 0)
  }

  const stringTime = reserveCli()
  assert.deepEqual(invokeExecution(invokeInput(stringTime), testAdapters(stringTime, {
    now: () => '2026-08-01T00:20:00.000Z',
  })), { reservationId: stringTime.reservationId })
  const invalidTime = reserveCli()
  expectCode(ERROR_CODES.WRITE, () => invokeExecution(invokeInput(invalidTime), testAdapters(invalidTime, {
    now: () => 'invalid-time',
  })))
  assert.equal(readdirSync(join(invalidTime.root, 'invocations')).length, 0)

  const eventCases = [
    { monotonicTime: () => '1' }, { monotonicTime: () => -1n },
    { monotonicTime: () => 0x10000000000000000n }, { randomId: () => 123 },
    { randomId: () => 'bad' }, { monotonicTime: () => { throw new Error('EVENT_CANARY') } },
    { monotonicTime: () => { throw new GovernanceError(ERROR_CODES.WRITE) } },
  ]
  for (const overrides of eventCases) {
    const reservation = reserveCli()
    expectCode(ERROR_CODES.WRITE,
      () => invokeExecution(invokeInput(reservation), testAdapters(reservation, overrides)))
    assert.equal(readdirSync(join(reservation.root, 'invocations')).length, 1)
  }

  const fallback = reserveCli(); let fallbackContext = ''
  assert.deepEqual(invokeExecution(invokeInput(fallback), testAdapters(fallback, {
    writeInvocationContext: undefined,
    writeContext: (fd, value) => {
      if (value[0] === 0x7b) return runtimeAdapters.writeContext(fd, value)
      fallbackContext = value.toString('utf8'); return value.length
    },
  })), { reservationId: fallback.reservationId })
  assert.equal(fallbackContext, `${dirname(fallback.evidenceOut)}\n${fallback.evidenceOut}\n`)

  for (const thrown of [new Error('CONTEXT_CANARY'), new GovernanceError(ERROR_CODES.WRITE)]) {
    const reservation = reserveCli()
    expectCode(ERROR_CODES.WRITE, () => invokeExecution(invokeInput(reservation), testAdapters(reservation, {
      writeInvocationContext: () => { throw thrown },
    })))
    expectCode(ERROR_CODES.ALREADY_INVOKED,
      () => invokeExecution(invokeInput(reservation), testAdapters(reservation)))
  }
})

test('direct CLI without fd 3 returns WRITE and never falls back to stdout context', async () => {
  const reservation = reserveCli(); const first = await invokeChild(pair().governanceA, reservation, false)
  assert.deepEqual(first, { code: 2, stdout: '', stderr: `${ERROR_CODES.WRITE}\n`, context: '' })
  const second = await invokeChild(pair().governanceA, reservation)
  assert.deepEqual(second, {
    code: 2, stdout: '', stderr: `${ERROR_CODES.ALREADY_INVOKED}\n`, context: '',
  })
})

test('damaged invocation tombstones and manifests fail closed as LEDGER', async () => {
  const invocation = reserveCli(); assert.equal((await invokeChild(pair().governanceA, invocation)).code, 0)
  const tombstone = join(invocation.root, 'invocations', `${invocation.reservationId}.json`)
  writeFileSync(tombstone, '{', { flag: 'w' })
  const damaged = await invokeChild(pair().governanceA, invocation)
  assert.equal(damaged.stderr, `${ERROR_CODES.LEDGER}\n`)

  const manifest = reserveCli()
  const manifestPath = join(manifest.root, 'manifests', `${manifest.reservationId}.json`)
  const contents = readFileSync(manifestPath, 'utf8')
  writeFileSync(manifestPath, contents.replace('"taskId":"', '"taskId":"x'), { flag: 'w' })
  const drifted = await invokeChild(pair().governanceA, manifest)
  assert.equal(drifted.stderr, `${ERROR_CODES.LEDGER}\n`)
})

after(() => {
  for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true })
  console.log('D2_PRIME_GOVERNANCE_INVOCATION_ALL_PASS')
})
