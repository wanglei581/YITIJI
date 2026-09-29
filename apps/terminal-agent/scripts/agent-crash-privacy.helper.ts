import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupCrashLeftoverPrintTaskTemps } from '../src/agent/print-task-temp-cleanup'

const lockSourcePath = join(__dirname, '../src/agent/instance-lock.ts')
const indexSourcePath = join(__dirname, '../src/index.ts')
const taskRunnerSourcePath = join(__dirname, '../src/agent/task-runner.ts')
const cleanupSourcePath = join(__dirname, '../src/agent/print-task-temp-cleanup.ts')
const singletonScript = join(__dirname, 'verify-singleton-process.mjs')

function isolatedRoot(): string { return mkdtempSync(join(tmpdir(), 'agent-crash-privacy-')) }
function source(): string { return readFileSync(lockSourcePath, 'utf8') }

function verifyStartupOrderingSource(): void {
  const index = readFileSync(indexSourcePath, 'utf8')
  const acquire = index.indexOf('await acquireLock()')
  const cleanup = index.indexOf('cleanupCrashLeftoverPrintTaskTemps()')
  const db = index.indexOf('openDatabase()')
  const runner = index.indexOf('startTaskRunner(')
  assert.ok(acquire >= 0, 'index must acquire the instance lock')
  assert.ok(cleanup > acquire, 'cleanup must run after acquireLock')
  assert.ok(db > cleanup, 'database open must run after leftover cleanup')
  assert.ok(runner > cleanup, 'claim/print must start after leftover cleanup')
  // 与锁的实现无关，换锁时不能跟着删：领取循环重建时若清扫临时目录，会删掉正在下载的打印件。
  const runnerSource = readFileSync(taskRunnerSourcePath, 'utf8')
  assert.equal(
    runnerSource.includes('cleanupCrashLeftoverPrintTaskTemps'),
    false,
    'claim loop rebuild must never sweep temp files (would delete live downloads)',
  )
  const lock = source()
  assert.match(lock, /createServer\(/)
  assert.match(lock, /server\.listen\(/)
  assert.match(lock, /EADDRINUSE/)
  assert.match(lock, /ECONNREFUSED/)
  assert.match(lock, /agent\.pid/)
  assert.doesNotMatch(lock, /stale_lock_requires_operator|renameSync|tasklist/)
  assert.match(lock, /machine_identity_unavailable/)
  assert.match(lock, /do not delete agent\.pid/)
  const cleanupSource = readFileSync(cleanupSourcePath, 'utf8')
  assert.match(cleanupSource, /lstatSync/)
  assert.doesNotMatch(cleanupSource, /\bstatSync\s*\(/)
}

function runProcessSingletonVerification(): void {
  const result = spawnSync(process.execPath, [singletonScript], { cwd: join(__dirname, '..'), encoding: 'utf8', timeout: 120_000 })
  assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}

function verifyReverseMutations(): void {
  const original = source()
  const mutations: Array<[string, string, string, RegExp]> = [
    [
      // 真实的回退：把正在被监听的端点当残留删掉抢占。探测「有人在听」与监听时 EADDRINUSE
      // 互为备份，单改其中一处不会破坏不变式，所以变异取「抢占活端点」这一整条错误路径。
      'live-endpoint-stolen',
      "if (probe === 'live') return { status: 'duplicate', lockPath: endpoint, existingPid: 0 }",
      "if (probe === 'live') { try { fs.unlinkSync(endpoint) } catch { /* mutation: steal a live endpoint */ } }",
      /second instance|contender/,
    ],
    [
      // 回令牌前对方已断开时写入报 EPIPE；不接住就冒成 uncaughtException，把持有锁的 Agent 带崩。
      'probe-crashes-holder',
      "socket.on('error', () => { /* client left before reading the token */ })",
      '/* mutation: accepted sockets have no error handler */',
      /disconnect early|must not crash the holder/,
    ],
    [
      'stale-socket-not-removed',
      'try { fs.unlinkSync(endpoint) }',
      'try { /* mutation: stale socket remains */ }',
      /after SIGKILL|singleton/,
    ],
  ]
  for (const [label, from, to, expected] of mutations) {
    assert.ok(original.includes(from), `${label}: mutation anchor must exist`)
    writeFileSync(lockSourcePath, original.replace(from, to))
    try {
      const result = spawnSync(process.execPath, [singletonScript], { cwd: join(__dirname, '..'), encoding: 'utf8', timeout: 120_000 })
      assert.notEqual(result.status, 0, `${label}: reversed safety behavior must make the process check fail`)
      assert.match(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, expected, `${label}: failure must identify the broken singleton invariant`)
    } finally {
      writeFileSync(lockSourcePath, original)
    }
  }
}

export function runInstanceLockHardeningTests(): void {
  verifyStartupOrderingSource()
  runProcessSingletonVerification()
  verifyReverseMutations()
  console.log('PASS instance-lock process-lifetime tests')
}

function captureStdio(fn: () => void): string {
  const chunks: string[] = []
  const stdout = process.stdout.write.bind(process.stdout)
  const stderr = process.stderr.write.bind(process.stderr)
  const collect = ((chunk: string | Uint8Array) => { chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')); return true }) as typeof process.stdout.write
  process.stdout.write = collect; process.stderr.write = collect
  try { fn(); return chunks.join('') } finally { process.stdout.write = stdout; process.stderr.write = stderr }
}
function verifyRegularCleanupAndPreservation(): void {
  const root = isolatedRoot()
  const tempDir = join(root, 'temp')
  mkdirSync(tempDir, { recursive: true })
  const secret = 'SENSITIVE_RESUME_CONTENT_XYZ'
  const leftover = join(tempDir, 'task_ptask_kiosk_deadbeef.pdf')
  const leftoverJpg = join(tempDir, 'task_abc123.jpg')
  const unrelatedPrint = join(tempDir, 'print_uuid.pdf')
  const imageTemp = join(tempDir, 'print_x_12345678-1234-1234-1234-123456789abc.pdf')
  const bareImageTemp = join(tempDir, 'print_12345678-1234-1234-1234-123456789abc.pdf')
  const notes = join(tempDir, 'notes.txt')
  const wrongExt = join(tempDir, 'task_abc.doc')
  const bak = join(tempDir, 'task_abc.pdf.bak')
  const nestedDir = join(tempDir, 'nested')
  mkdirSync(nestedDir)
  const nestedLeftover = join(nestedDir, 'task_nested.pdf')
  const nestedPrint = join(nestedDir, 'print_x_12345678-1234-1234-1234-123456789abc.pdf')
  const matchingDir = join(tempDir, 'task_dironly.pdf')
  mkdirSync(matchingDir)
  writeFileSync(join(matchingDir, 'inside.pdf'), secret)
  writeFileSync(leftover, secret)
  writeFileSync(leftoverJpg, 'jpg')
  writeFileSync(unrelatedPrint, 'print leftover')
  writeFileSync(imageTemp, secret)
  writeFileSync(bareImageTemp, secret)
  writeFileSync(notes, 'notes')
  writeFileSync(wrongExt, 'doc')
  writeFileSync(bak, secret)
  writeFileSync(nestedLeftover, secret)
  writeFileSync(nestedPrint, secret)
  const outsidePrint = join(root, 'outside-print.pdf')
  const printLink = join(tempDir, 'print_abcdef01-2345-6789-abcd-ef0123456789.pdf')
  let printLinked = false
  if (process.platform !== 'win32') {
    writeFileSync(outsidePrint, secret)
    try {
      symlinkSync(outsidePrint, printLink)
      printLinked = true
    } catch {
      printLinked = false
    }
  }

  const logs = captureStdio(() => {
    cleanupCrashLeftoverPrintTaskTemps({ tempDir })
  })
  assert.equal(existsSync(leftover), false, 'matching pdf leftover must be removed')
  assert.equal(existsSync(leftoverJpg), false, 'matching jpg leftover must be removed')
  assert.equal(existsSync(imageTemp), false, 'image temp pdf must be removed')
  assert.equal(existsSync(bareImageTemp), false, 'bare image temp pdf must be removed')
  assert.equal(existsSync(unrelatedPrint), true, 'unrelated print_ names must be preserved')
  assert.equal(existsSync(notes), true)
  assert.equal(existsSync(wrongExt), true)
  assert.equal(existsSync(bak), true)
  assert.equal(existsSync(nestedLeftover), true, 'files in subdirectories must not be touched')
  assert.equal(existsSync(nestedPrint), true, 'print_ pdf inside a subdirectory must be preserved')
  assert.equal(existsSync(join(matchingDir, 'inside.pdf')), true, 'matching-name directories must be rejected')
  if (printLinked) {
    assert.equal(existsSync(printLink), true, 'print_ symlink must not be unlinked')
    assert.equal(existsSync(outsidePrint), true, 'print_ symlink target outside the temp dir must stay')
    assert.equal(readFileSync(outsidePrint, 'utf8'), secret)
  }
  assert.doesNotMatch(logs, /task_ptask_kiosk_deadbeef/)
  assert.doesNotMatch(logs, /print_x_12345678/)
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

function verifyPrintImageDeletionFailure(): void {
  const root = isolatedRoot()
  const tempDir = join(root, 'temp')
  mkdirSync(tempDir, { recursive: true })
  const leftover = join(tempDir, 'print_x_12345678-1234-1234-1234-123456789abc.pdf')
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
  assert.equal(existsSync(leftover), true, 'eligible image temp must remain when unlink fails')
  assert.doesNotMatch(logs, /print_x_12345678/)
  assert.doesNotMatch(logs, /SENSITIVE_RESUME_CONTENT_XYZ/)
  rmSync(root, { recursive: true, force: true })
}

function runNodeEval(code: string) {
  return spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', code], {
    cwd: join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  })
}

const printImageCleanupChild = `
const fs = require('fs')
const os = require('os')
const path = require('path')
const { cleanupCrashLeftoverPrintTaskTemps } = require('./src/agent/print-task-temp-cleanup')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'print-temp-mutation-'))
const tempDir = path.join(root, 'temp')
fs.mkdirSync(tempDir)
const file = path.join(tempDir, 'print_x_12345678-1234-1234-1234-123456789abc.pdf')
fs.writeFileSync(file, 'secret')
cleanupCrashLeftoverPrintTaskTemps({ tempDir })
if (fs.existsSync(file)) process.exit(1)
fs.rmSync(root, { recursive: true, force: true })
process.exit(0)
`

const bootCleanupCallChild = `
const fs = require('fs')
const index = fs.readFileSync('./src/index.ts', 'utf8')
const acquire = index.indexOf('await acquireLock()')
const cleanup = index.indexOf('cleanupCrashLeftoverPrintTaskTemps()')
if (!(acquire >= 0 && cleanup > acquire)) process.exit(1)
process.exit(0)
`

function verifyPrintTempBootMutations(): void {
  const cleanupSource = readFileSync(cleanupSourcePath, 'utf8')
  const indexSource = readFileSync(indexSourcePath, 'utf8')
  const ruleAnchor = 'isEligibleTaskTempName(name) || isEligiblePrintImageTempName(name)'
  const callAnchor = 'cleanupCrashLeftoverPrintTaskTemps()'
  assert.ok(cleanupSource.includes(ruleAnchor), 'print_ eligibility anchor must exist')
  assert.ok(indexSource.includes(callAnchor), 'boot cleanup call anchor must exist')

  const originalChild = runNodeEval(printImageCleanupChild)
  assert.equal(originalChild.status, 0, `${originalChild.stdout ?? ''}\n${originalChild.stderr ?? ''}`)
  const originalOrder = runNodeEval(bootCleanupCallChild)
  assert.equal(originalOrder.status, 0, `${originalOrder.stdout ?? ''}\n${originalOrder.stderr ?? ''}`)

  writeFileSync(cleanupSourcePath, cleanupSource.replace(ruleAnchor, 'isEligibleTaskTempName(name)'))
  try {
    const removedRule = runNodeEval(printImageCleanupChild)
    assert.notEqual(removedRule.status, 0, 'removing the print_ rule must fail the boot cleanup gate')
  } finally {
    writeFileSync(cleanupSourcePath, cleanupSource)
  }

  writeFileSync(indexSourcePath, indexSource.replace(callAnchor, '/* mutation: boot cleanup call removed */'))
  try {
    const removedCall = runNodeEval(bootCleanupCallChild)
    assert.notEqual(removedCall.status, 0, 'removing the index.ts boot cleanup call must fail the gate')
  } finally {
    writeFileSync(indexSourcePath, indexSource)
  }
}

export function runPrintTaskTempCleanupTests(): void {
  verifyStartupOrderingSource()
  verifyRegularCleanupAndPreservation()
  verifySymlinkRejection()
  verifyDeletionFailure()
  verifyPrintImageDeletionFailure()
  verifyTempDirSymlinkFailClosed()
  verifyMissingTempDirIsOk()
  verifyPrintTempBootMutations()
  console.log('PASS print-task temp leftover cleanup')
}
