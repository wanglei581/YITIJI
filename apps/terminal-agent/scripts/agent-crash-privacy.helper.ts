import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { cleanupCrashLeftoverPrintTaskTemps } from '../src/agent/print-task-temp-cleanup'

type InstanceLockModule = typeof import('../src/agent/instance-lock')

const instanceLockOverride = process.env['AGENT_INSTANCE_LOCK_SOURCE_OVERRIDE']
const instanceLockModulePath = instanceLockOverride ?? '../src/agent/instance-lock'
const resolvedInstanceLockModulePath = require.resolve(instanceLockModulePath)
if (instanceLockOverride) {
  const mutationRoot = dirname(dirname(dirname(resolvedInstanceLockModulePath)))
  assert.equal(
    basename(mutationRoot).startsWith('agent-lock-mutation-'),
    true,
    'instance-lock override must point into an isolated mutation mirror',
  )
} else {
  assert.equal(
    resolvedInstanceLockModulePath,
    require.resolve('../src/agent/instance-lock'),
    'default instance-lock tests must load the tracked module',
  )
}
const {
  __resetInstanceLockForTests,
  __setInstanceLockHooksForTests,
  getLockPath,
  releaseLock,
  tryAcquireLock,
} = require(resolvedInstanceLockModulePath) as InstanceLockModule

const agentRoot = join(__dirname, '..')
const helperPath = join(__dirname, 'agent-crash-privacy.helper.ts')
const lockSourcePath = join(__dirname, '../src/agent/instance-lock.ts')
const loggerSourcePath = join(__dirname, '../src/logger.ts')
const indexSourcePath = join(__dirname, '../src/index.ts')
const taskRunnerSourcePath = join(__dirname, '../src/agent/task-runner.ts')
const cleanupSourcePath = join(__dirname, '../src/agent/print-task-temp-cleanup.ts')

const WX_OPEN = "fd = fs.openSync(pidFile, 'wx', 0o600)"
const WX_OPEN_MUTATED = "fd = fs.openSync(pidFile, 'w', 0o600)"
const SUCCESSOR_GUARD = '    if (raw !== String(owned.pid)) return'
const TASKLIST_FAIL_CLOSED = `    if (result.error || result.status !== 0) {
      // TASKLIST_FAIL_CLOSED: unavailable tasklist must never look like a dead pid.
      return true
    }`
const TASKLIST_FAIL_OPEN = `    if (result.error || result.status !== 0) {
      // TASKLIST_FAIL_CLOSED: unavailable tasklist must never look like a dead pid.
      return false
    }`
const UNPROVEN_PID = `function hasProvenRemovablePid(pid: number | null): pid is number {
  // UNPROVEN_PID_FAIL_CLOSED: empty/corrupt/prefix pid is not a dead owner.
  return pid !== null
}`
const UNPROVEN_PID_MUTATED = `function hasProvenRemovablePid(pid: number | null): pid is number {
  // UNPROVEN_PID_FAIL_CLOSED: empty/corrupt/prefix pid is not a dead owner.
  return true
}`
const STRICT_PID_PARSE = `function parseStrictLockPid(raw: string): number | null {
  // STRICT_PID_PARSE: the whole file is one decimal pid, optional one trailing newline.
  const match = /^([1-9][0-9]{0,9})\\n?$/.exec(raw)
  if (!match || match[1] === undefined) return null
  const pid = Number(match[1])
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  return pid
}`
const STRICT_PID_PARSE_MUTATED = `function parseStrictLockPid(raw: string): number | null {
  // STRICT_PID_PARSE: the whole file is one decimal pid, optional one trailing newline.
  const parsed = parseInt(raw.trim(), 10)
  const pid = Number.isInteger(parsed) && parsed > 0 ? parsed : null
  return pid
}`
const PUBLICATION_FAIL_NO_UNLINK = `    // PUBLICATION_FAIL_NO_UNLINK: never path-unlink an unproven entry.
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'EISDIR') return 'exists'
    return 'publication-failed'`
const PUBLICATION_FAIL_UNLINK = `    // PUBLICATION_FAIL_NO_UNLINK: never path-unlink an unproven entry.
    try { fs.unlinkSync(pidFile) } catch { /* ignore */ }
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'EISDIR') return 'exists'
    return 'publication-failed'`

function sleepSync(ms: number): void {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isolatedRoot(): string {
  return mkdtempSync(join(tmpdir(), 'agent-crash-privacy-'))
}

function restoreProgramData(previous: string | undefined): void {
  if (previous === undefined) delete process.env['PROGRAMDATA']
  else process.env['PROGRAMDATA'] = previous
}

function withIsolatedLock<T>(fn: (root: string, lockPath: string) => T): T {
  const root = isolatedRoot()
  const previous = process.env['PROGRAMDATA']
  process.env['PROGRAMDATA'] = root
  __resetInstanceLockForTests()
  try {
    return fn(root, getLockPath())
  } finally {
    try {
      releaseLock()
    } catch {
      // ignore
    }
    __resetInstanceLockForTests()
    restoreProgramData(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

function captureStdio(fn: () => void): string {
  const chunks: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  const collect = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return true
  }) as typeof process.stdout.write
  process.stdout.write = collect
  process.stderr.write = collect
  try {
    fn()
    return chunks.join('')
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

function waitForFile(filePath: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(filePath)) {
    if (Date.now() > deadline) return false
    sleepSync(15)
  }
  return true
}

function runClaimWorker(): void {
  const go = process.env['LOCK_GO_FILE']
  const resultFile = process.env['LOCK_RESULT_FILE']
  const hold = process.env['LOCK_HOLD_FILE']
  const doneFile = process.env['LOCK_DONE_FILE']
  if (!go || !resultFile || !hold || !doneFile) process.exit(3)
  const deadline = Date.now() + 8_000
  while (!existsSync(go)) {
    if (Date.now() > deadline) {
      writeFileSync(resultFile, JSON.stringify({ status: 'timeout' }))
      process.exit(3)
    }
    sleepSync(5)
  }
  const result = tryAcquireLock()
  writeFileSync(resultFile, JSON.stringify(result))
  if (result.status !== 'acquired') {
    writeFileSync(doneFile, '1')
    process.exit(2)
  }
  while (existsSync(hold)) sleepSync(20)
  releaseLock()
  writeFileSync(doneFile, '1')
  process.exit(0)
}

function spawnClaimWorkers(
  programData: string,
  stalePid?: number,
): { parsed: Array<{ status: string }>; root: string } {
  const root = programData
  mkdirSync(join(root, 'AIJobPrintAgent'), { recursive: true })
  if (stalePid !== undefined) {
    writeFileSync(join(root, 'AIJobPrintAgent', 'agent.pid'), `${stalePid}\n`)
  }
  const go = join(root, 'go')
  const hold = join(root, 'hold')
  writeFileSync(hold, '1')
  const jobs = [1, 2].map((i) => ({
    resultFile: join(root, `r${i}.json`),
    doneFile: join(root, `d${i}.txt`),
  }))
  const children = jobs.map((job) =>
    spawn(process.execPath, ['-r', 'ts-node/register', helperPath, '--lock-claim-worker'], {
      cwd: agentRoot,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: '1',
        PROGRAMDATA: root,
        LOCK_GO_FILE: go,
        LOCK_RESULT_FILE: job.resultFile,
        LOCK_HOLD_FILE: hold,
        LOCK_DONE_FILE: job.doneFile,
      },
      stdio: 'ignore',
    }),
  )
  try {
    writeFileSync(go, '1')
    for (const job of jobs) {
      assert.equal(waitForFile(job.resultFile, 10_000), true, `claim worker result missing: ${job.resultFile}`)
    }
    const parsed = jobs.map((job) => JSON.parse(readFileSync(job.resultFile, 'utf8')) as { status: string })
    return { parsed, root }
  } finally {
    if (existsSync(hold)) unlinkSync(hold)
    const deadline = Date.now() + 8_000
    while (jobs.some((job) => !existsSync(job.doneFile)) && Date.now() < deadline) sleepSync(20)
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }
}

function assertExactlyOneAcquirer(stalePid?: number): void {
  const root = isolatedRoot()
  try {
    const { parsed } = spawnClaimWorkers(root, stalePid)
    const acquired = parsed.filter((row) => row.status === 'acquired')
    const others = parsed.filter((row) => row.status !== 'acquired')
    assert.equal(
      acquired.length,
      1,
      `exactly one claimant must acquire, got ${JSON.stringify(parsed)}`,
    )
    assert.equal(others.length, 1, 'the loser must not acquire')
    assert.notEqual(others[0]?.status, 'acquired')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function verifyExclusiveCreateAndLiveDuplicate(): void {
  withIsolatedLock((_root, lockPath) => {
    const first = tryAcquireLock()
    assert.equal(first.status, 'acquired')
    assert.equal(readFileSync(lockPath, 'utf8').trim(), String(process.pid))
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    try {
      assert.ok(sleeper.pid, 'sleeper must have a pid')
      releaseLock()
      writeFileSync(lockPath, `${sleeper.pid}\n`)
      const second = tryAcquireLock()
      assert.equal(second.status, 'duplicate', 'a live foreign pid must not be taken over')
      if (second.status === 'duplicate') {
        assert.equal(second.existingPid, sleeper.pid)
      }
    } finally {
      sleeper.kill('SIGKILL')
    }
  })
}

function verifyStaleTakeover(): void {
  withIsolatedLock((_root, lockPath) => {
    mkdirSync(join(_root, 'AIJobPrintAgent'), { recursive: true })
    writeFileSync(lockPath, '999999\n')
    const result = tryAcquireLock()
    assert.equal(result.status, 'acquired', 'a dead pid must be take-overable')
    assert.equal(readFileSync(lockPath, 'utf8').trim(), String(process.pid))
  })
}

function verifySuccessorSafeRelease(): void {
  withIsolatedLock((_root, lockPath) => {
    assert.equal(tryAcquireLock().status, 'acquired')
    writeFileSync(lockPath, '1\n')
    releaseLock()
    assert.equal(existsSync(lockPath), true, 'successor-owned pid file must survive predecessor release')
    assert.equal(readFileSync(lockPath, 'utf8').trim(), '1')
  })
}

function verifyTasklistFailClosed(): void {
  withIsolatedLock((_root, lockPath) => {
    mkdirSync(join(_root, 'AIJobPrintAgent'), { recursive: true })
    writeFileSync(lockPath, '999999\n')
    __setInstanceLockHooksForTests({
      platform: 'win32',
      spawnSync: (() => ({
        error: new Error('tasklist missing'),
        status: 1,
        stdout: '',
        stderr: '',
        pid: 0,
        output: [null, '', ''],
        signal: null,
      })) as unknown as typeof spawnSync,
    })
    const result = tryAcquireLock()
    assert.equal(
      result.status,
      'duplicate',
      'tasklist failure must treat the existing pid as alive',
    )
  })
}

function verifyLockPathNotRegular(): void {
  withIsolatedLock((_root, lockPath) => {
    mkdirSync(lockPath, { recursive: true })
    const result = tryAcquireLock()
    assert.equal(result.status, 'unavailable')
    if (result.status === 'unavailable') {
      assert.equal(result.reason, 'lock_path_not_regular_file')
    }
    assert.equal(lstatSync(lockPath).isDirectory(), true, 'must not remove a directory occupying the lock path')
  })
}

function verifyReentrantAcquire(): void {
  withIsolatedLock(() => {
    assert.equal(tryAcquireLock().status, 'acquired')
    assert.equal(tryAcquireLock().status, 'acquired')
  })
}

function verifyUnprovenEmptyLock(): void {
  withIsolatedLock((_root, lockPath) => {
    mkdirSync(join(_root, 'AIJobPrintAgent'), { recursive: true })
    writeFileSync(lockPath, '')
    const result = tryAcquireLock()
    assert.equal(existsSync(lockPath), true, 'empty lock must not be unlinked')
    assert.equal(readFileSync(lockPath, 'utf8'), '', 'empty lock bytes must be unchanged')
    assert.equal(result.status, 'unavailable', 'empty lock must not be taken over')
    if (result.status === 'unavailable') {
      assert.equal(result.reason, 'lock_pid_unproven')
    }
  })
}

function verifyUnprovenCorruptLock(): void {
  withIsolatedLock((_root, lockPath) => {
    mkdirSync(join(_root, 'AIJobPrintAgent'), { recursive: true })
    const corrupt = '123x\n'
    writeFileSync(lockPath, corrupt)
    const result = tryAcquireLock()
    assert.equal(result.status, 'unavailable', 'prefix/corrupt pid must not be taken over')
    if (result.status === 'unavailable') {
      assert.equal(result.reason, 'lock_pid_unproven')
    }
    assert.equal(existsSync(lockPath), true, 'corrupt lock must not be unlinked')
    assert.equal(readFileSync(lockPath, 'utf8'), corrupt, 'corrupt lock bytes must be unchanged')
  })
}

function verifyUnprovenWhitespaceLock(): void {
  withIsolatedLock((_root, lockPath) => {
    mkdirSync(join(_root, 'AIJobPrintAgent'), { recursive: true })
    const corrupt = '123 \n'
    writeFileSync(lockPath, corrupt)
    const result = tryAcquireLock()
    assert.equal(existsSync(lockPath), true, 'whitespace-corrupt lock must not be unlinked')
    assert.equal(readFileSync(lockPath, 'utf8'), corrupt, 'whitespace-corrupt lock bytes must be unchanged')
    assert.equal(result.status, 'unavailable', 'whitespace-corrupt pid must not be taken over')
    if (result.status === 'unavailable') {
      assert.equal(result.reason, 'lock_pid_unproven')
    }
  })
}

function verifyPartialWriteDoesNotUnlink(): void {
  withIsolatedLock((_root, lockPath) => {
    __setInstanceLockHooksForTests({
      writeSync: () => 1,
    })
    const result = tryAcquireLock()
    assert.equal(result.status, 'unavailable', 'partial pid write must fail closed')
    if (result.status === 'unavailable') {
      assert.equal(result.reason, 'lock_publication_failed')
    }
    assert.equal(existsSync(lockPath), true, 'partial pid write must not unlink the wx path')
  })
}

function verifyPublicationFailureDoesNotUnlinkSuccessor(): void {
  withIsolatedLock((_root, lockPath) => {
    __setInstanceLockHooksForTests({
      writeSync: () => {
        try {
          unlinkSync(lockPath)
        } catch {
          // the wx inode may still be open
        }
        writeFileSync(lockPath, '1\n')
        const error = new Error('ENOSPC') as NodeJS.ErrnoException
        error.code = 'ENOSPC'
        throw error
      },
    })
    const result = tryAcquireLock()
    assert.notEqual(result.status, 'acquired', 'publication failure must not report ownership')
    assert.equal(existsSync(lockPath), true, 'publication failure must not delete an unproven path')
    assert.equal(
      readFileSync(lockPath, 'utf8'),
      '1\n',
      'successor content must survive publication-failure cleanup',
    )
  })
}

function verifyFsyncFailureDoesNotUnlink(): void {
  withIsolatedLock((_root, lockPath) => {
    __setInstanceLockHooksForTests({
      fsyncSync: () => {
        const error = new Error('EIO') as NodeJS.ErrnoException
        error.code = 'EIO'
        throw error
      },
    })
    const result = tryAcquireLock()
    assert.equal(result.status, 'unavailable', 'fsync failure must fail closed')
    if (result.status === 'unavailable') {
      assert.equal(result.reason, 'lock_publication_failed')
    }
    assert.equal(existsSync(lockPath), true, 'fsync failure must not path-unlink the wx file')
  })
}

function verifyConcurrentClaimants(): void {
  assertExactlyOneAcquirer()
  assertExactlyOneAcquirer()
}

function verifyConcurrentStaleTakeover(): void {
  assertExactlyOneAcquirer(999999)
}

function mutateAndRun(label: string, original: string, mutated: string, flag: string, mustFailOn: RegExp): void {
  const source = readFileSync(lockSourcePath, 'utf8')
  assert.equal(source.includes(original), true, `${label}: original block must exist`)
  const next = source.replace(original, mutated)
  assert.notEqual(next, source, `${label}: mutation must change the file`)
  const mutationRoot = mkdtempSync(join(tmpdir(), 'agent-lock-mutation-'))
  const mutationSrc = join(mutationRoot, 'src')
  const mutationAgent = join(mutationSrc, 'agent')
  const mutationLockPath = join(mutationAgent, 'instance-lock.ts')
  try {
    mkdirSync(mutationAgent, { recursive: true })
    // instance-lock.ts currently has one relative dependency: ../logger.
    // A future dependency change should fail loudly until this mirror is extended.
    writeFileSync(mutationLockPath, next)
    writeFileSync(join(mutationSrc, 'logger.ts'), readFileSync(loggerSourcePath))
    const child = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', helperPath, flag],
      {
        cwd: agentRoot,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          TS_NODE_TRANSPILE_ONLY: '1',
          AGENT_INSTANCE_LOCK_SOURCE_OVERRIDE: mutationLockPath,
        },
      },
    )
    const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`
    assert.notEqual(child.status, 0, `${label}: mutated code must make the child nonzero\n${output}`)
    assert.match(output, mustFailOn, `${label}: child must fail on the intended assertion\n${output}`)
  } finally {
    rmSync(mutationRoot, { recursive: true, force: true })
  }
  assert.equal(
    readFileSync(lockSourcePath, 'utf8'),
    source,
    `${label}: tracked source must remain byte-for-byte unchanged`,
  )
}

function verifyReverseMutations(): void {
  mutateAndRun(
    'wx-to-w',
    WX_OPEN,
    WX_OPEN_MUTATED,
    '--concurrent-lock-race',
    /exactly one claimant must acquire/,
  )
  mutateAndRun(
    'successor-guard',
    SUCCESSOR_GUARD,
    '    if (false && raw !== String(owned.pid)) return',
    '--successor-release',
    /successor-owned pid file must survive predecessor release/,
  )
  mutateAndRun(
    'tasklist-fail-open',
    TASKLIST_FAIL_CLOSED,
    TASKLIST_FAIL_OPEN,
    '--tasklist-fail-closed',
    /tasklist failure must treat the existing pid as alive/,
  )
  mutateAndRun(
    'unproven-pid-removable',
    UNPROVEN_PID,
    UNPROVEN_PID_MUTATED,
    '--unproven-pid',
    /empty lock bytes must be unchanged|empty lock must not be unlinked/,
  )
  mutateAndRun(
    'strict-pid-parseint',
    STRICT_PID_PARSE,
    STRICT_PID_PARSE_MUTATED,
    '--corrupt-pid',
    /prefix\/corrupt pid must not be taken over/,
  )
  mutateAndRun(
    'publication-fail-unlink',
    PUBLICATION_FAIL_NO_UNLINK,
    PUBLICATION_FAIL_UNLINK,
    '--publication-failure',
    /publication failure must not delete an unproven path|successor content must survive publication-failure cleanup/,
  )
}

function verifyStartupOrderingSource(): void {
  const index = readFileSync(indexSourcePath, 'utf8')
  const acquire = index.indexOf('acquireLock()')
  const cleanup = index.indexOf('cleanupCrashLeftoverPrintTaskTemps()')
  const db = index.indexOf('openDatabase()')
  const runner = index.indexOf('startTaskRunner(')
  assert.ok(acquire >= 0, 'index must acquire the instance lock')
  assert.ok(cleanup > acquire, 'cleanup must run after acquireLock')
  assert.ok(db > cleanup, 'database open must run after leftover cleanup')
  assert.ok(runner > cleanup, 'claim/print must start after leftover cleanup')
  const runnerSource = readFileSync(taskRunnerSourcePath, 'utf8')
  assert.equal(
    runnerSource.includes('cleanupCrashLeftoverPrintTaskTemps'),
    false,
    'claim loop rebuild must never sweep temp files (would delete live downloads)',
  )
  const lockSource = readFileSync(lockSourcePath, 'utf8')
  assert.equal(lockSource.includes(WX_OPEN), true, 'lock create must use wx exclusive create')
  assert.equal(lockSource.includes('TASKLIST_FAIL_CLOSED'), true)
  assert.equal(lockSource.includes('SUCCESSOR_PID_GUARD'), true)
  assert.equal(lockSource.includes('UNPROVEN_PID_FAIL_CLOSED'), true)
  assert.equal(lockSource.includes('STRICT_PID_PARSE'), true)
  assert.equal(lockSource.includes('PUBLICATION_FAIL_NO_UNLINK'), true)
  assert.equal(lockSource.includes('COMPLETE_PID_WRITE'), true)
  const cleanupSource = readFileSync(cleanupSourcePath, 'utf8')
  assert.match(cleanupSource, /\blstatSync\s*\(/, 'cleanup must lstat and not follow links')
  assert.doesNotMatch(
    cleanupSource,
    /\bstatSync\s*\(/,
    'cleanup must not statSync (that follows symlinks)',
  )
}

function verifyRegularCleanupAndPreservation(): void {
  const root = isolatedRoot()
  const tempDir = join(root, 'temp')
  mkdirSync(tempDir, { recursive: true })
  const secret = 'SENSITIVE_RESUME_CONTENT_XYZ'
  const leftover = join(tempDir, 'task_ptask_kiosk_deadbeef.pdf')
  const leftoverJpg = join(tempDir, 'task_abc123.jpg')
  const unrelatedPrint = join(tempDir, 'print_uuid.pdf')
  const notes = join(tempDir, 'notes.txt')
  const wrongExt = join(tempDir, 'task_abc.doc')
  const bak = join(tempDir, 'task_abc.pdf.bak')
  const nestedDir = join(tempDir, 'nested')
  mkdirSync(nestedDir)
  const nestedLeftover = join(nestedDir, 'task_nested.pdf')
  const matchingDir = join(tempDir, 'task_dironly.pdf')
  mkdirSync(matchingDir)
  writeFileSync(join(matchingDir, 'inside.pdf'), secret)
  writeFileSync(leftover, secret)
  writeFileSync(leftoverJpg, 'jpg')
  writeFileSync(unrelatedPrint, 'print leftover')
  writeFileSync(notes, 'notes')
  writeFileSync(wrongExt, 'doc')
  writeFileSync(bak, secret)
  writeFileSync(nestedLeftover, secret)

  const logs = captureStdio(() => {
    cleanupCrashLeftoverPrintTaskTemps({ tempDir })
  })
  assert.equal(existsSync(leftover), false, 'matching pdf leftover must be removed')
  assert.equal(existsSync(leftoverJpg), false, 'matching jpg leftover must be removed')
  assert.equal(existsSync(unrelatedPrint), true, 'print_ artifacts must be preserved')
  assert.equal(existsSync(notes), true)
  assert.equal(existsSync(wrongExt), true)
  assert.equal(existsSync(bak), true)
  assert.equal(existsSync(nestedLeftover), true, 'files in subdirectories must not be touched')
  assert.equal(existsSync(join(matchingDir, 'inside.pdf')), true, 'matching-name directories must be rejected')
  assert.doesNotMatch(logs, /task_ptask_kiosk_deadbeef/)
  assert.doesNotMatch(logs, /SENSITIVE_RESUME_CONTENT_XYZ/)
  assert.doesNotMatch(logs, new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  rmSync(root, { recursive: true, force: true })
}

function verifySymlinkRejection(): void {
  const root = isolatedRoot()
  const tempDir = join(root, 'temp')
  mkdirSync(tempDir, { recursive: true })
  const target = join(root, 'outside-secret.pdf')
  const linkPath = join(tempDir, 'task_linked.pdf')
  writeFileSync(target, 'SENSITIVE_OUTSIDE')
  let linked = false
  try {
    symlinkSync(target, linkPath)
    linked = true
  } catch {
    linked = false
  }
  if (linked) {
    cleanupCrashLeftoverPrintTaskTemps({ tempDir })
    assert.equal(existsSync(linkPath), true, 'matching symlink must not be unlinked')
    assert.equal(existsSync(target), true, 'symlink target must not be followed or deleted')
    assert.equal(readFileSync(target, 'utf8'), 'SENSITIVE_OUTSIDE')
  } else {
    let unlinkCalls = 0
    cleanupCrashLeftoverPrintTaskTemps({
      tempDir,
      lstatSync: ((p: string) => {
        if (p === linkPath || String(p).endsWith('task_linked.pdf')) {
          return {
            isSymbolicLink: () => true,
            isFile: () => false,
            isDirectory: () => false,
          }
        }
        return lstatSync(p)
      }) as typeof lstatSync,
      unlinkSync: ((p: string) => {
        unlinkCalls += 1
        unlinkSync(p)
      }) as typeof unlinkSync,
    })
    assert.equal(unlinkCalls, 0, 'injected symlink must never be unlinked')
  }
  rmSync(root, { recursive: true, force: true })
}

function verifyDeletionFailure(): void {
  const root = isolatedRoot()
  const tempDir = join(root, 'temp')
  mkdirSync(tempDir, { recursive: true })
  const leftover = join(tempDir, 'task_cannot_delete.pdf')
  writeFileSync(leftover, 'SENSITIVE_RESUME_CONTENT_XYZ')
  const logs = captureStdio(() => {
    assert.throws(
      () =>
        cleanupCrashLeftoverPrintTaskTemps({
          tempDir,
          unlinkSync: () => {
            throw new Error('EACCES')
          },
        }),
      /leftover print task temp file could not be removed/,
    )
  })
  assert.equal(existsSync(leftover), true, 'eligible leftover must remain when unlink fails')
  assert.doesNotMatch(logs, /task_cannot_delete/)
  assert.doesNotMatch(logs, /SENSITIVE_RESUME_CONTENT_XYZ/)
  rmSync(root, { recursive: true, force: true })
}

function verifyTempDirSymlinkFailClosed(): void {
  const root = isolatedRoot()
  const realDir = join(root, 'real-temp')
  const tempDir = join(root, 'temp-link')
  mkdirSync(realDir, { recursive: true })
  const leftover = join(realDir, 'task_via_link.pdf')
  writeFileSync(leftover, 'SENSITIVE_RESUME_CONTENT_XYZ')
  let linked = false
  try {
    symlinkSync(realDir, tempDir)
    linked = true
  } catch {
    linked = false
  }
  if (linked) {
    assert.throws(
      () => cleanupCrashLeftoverPrintTaskTemps({ tempDir }),
      /print task temp path is not a regular directory/,
    )
    assert.equal(existsSync(leftover), true, 'must not enumerate through a symlinked temp dir')
  } else {
    assert.throws(
      () =>
        cleanupCrashLeftoverPrintTaskTemps({
          tempDir: realDir,
          lstatSync: ((p: string) => {
            if (p === realDir) {
              return {
                isSymbolicLink: () => true,
                isDirectory: () => true,
                isFile: () => false,
              }
            }
            return lstatSync(p)
          }) as typeof lstatSync,
        }),
      /print task temp path is not a regular directory/,
    )
    assert.equal(existsSync(leftover), true)
  }
  rmSync(root, { recursive: true, force: true })
}

function verifyMissingTempDirIsOk(): void {
  const root = isolatedRoot()
  cleanupCrashLeftoverPrintTaskTemps({ tempDir: join(root, 'missing') })
  rmSync(root, { recursive: true, force: true })
}

export function runInstanceLockHardeningTests(): void {
  verifyExclusiveCreateAndLiveDuplicate()
  verifyStaleTakeover()
  verifySuccessorSafeRelease()
  verifyTasklistFailClosed()
  verifyLockPathNotRegular()
  verifyReentrantAcquire()
  verifyUnprovenEmptyLock()
  verifyUnprovenCorruptLock()
  verifyUnprovenWhitespaceLock()
  verifyPartialWriteDoesNotUnlink()
  verifyPublicationFailureDoesNotUnlinkSuccessor()
  verifyFsyncFailureDoesNotUnlink()
  verifyConcurrentClaimants()
  verifyConcurrentStaleTakeover()
  verifyReverseMutations()
  console.log('PASS instance-lock hardening')
}

export function runPrintTaskTempCleanupTests(): void {
  verifyStartupOrderingSource()
  verifyRegularCleanupAndPreservation()
  verifySymlinkRejection()
  verifyDeletionFailure()
  verifyTempDirSymlinkFailClosed()
  verifyMissingTempDirIsOk()
  console.log('PASS print-task temp leftover cleanup')
}

if (process.argv.includes('--lock-claim-worker')) {
  runClaimWorker()
} else if (process.argv.includes('--concurrent-lock-race')) {
  try {
    assertExactlyOneAcquirer()
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
} else if (process.argv.includes('--successor-release')) {
  try {
    verifySuccessorSafeRelease()
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
} else if (process.argv.includes('--tasklist-fail-closed')) {
  try {
    verifyTasklistFailClosed()
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
} else if (process.argv.includes('--unproven-pid')) {
  try {
    verifyUnprovenEmptyLock()
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
} else if (process.argv.includes('--corrupt-pid')) {
  try {
    verifyUnprovenCorruptLock()
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
} else if (process.argv.includes('--publication-failure')) {
  try {
    verifyPublicationFailureDoesNotUnlinkSuccessor()
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
