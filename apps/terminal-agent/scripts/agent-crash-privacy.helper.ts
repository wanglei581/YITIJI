import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupKnownLegacyResidue, getAgentDataDir } from '../src/agent/legacy-residue-cleanup'
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
  assert.ok(cleanup > db, 'temp cleanup runs after database open, still before claim')
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

const legacySourcePath = join(__dirname, '../src/agent/legacy-residue-cleanup.ts')

function placeDirectoryLink(target: string, linkPath: string): void {
  if (process.platform === 'win32') {
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
    const command = `New-Item -ItemType Junction -Path ${quote(linkPath)} -Target ${quote(target)}`
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    return
  }
  symlinkSync(target, linkPath, 'dir')
}

function verifyLegacySourceShape(): void {
  const source = readFileSync(legacySourcePath, 'utf8')
  assert.match(source, /lstatSync/)
  assert.doesNotMatch(source, /\bstatSync\s*\(/)
  assert.doesNotMatch(source, /\brmSync\s*\(/)
  assert.doesNotMatch(source, /\*\.log/)
  assert.match(source, /isSymbolicLink\(/)
  const index = readFileSync(indexSourcePath, 'utf8')
  const acquire = index.indexOf('await acquireLock()')
  const temp = index.indexOf('cleanupCrashLeftoverPrintTaskTemps()')
  const queue = index.indexOf('cleanupStaleOwnPrintJobs(')
  const legacy = index.indexOf('cleanupKnownLegacyResidue()')
  const tempExit = index.indexOf('if (printTempCleanupError)')
  const queueExit = index.indexOf('if (printQueueCleanupError)')
  const runner = index.indexOf('startTaskRunner(')
  assert.ok(acquire >= 0 && temp > acquire && queue > temp && legacy > queue)
  assert.ok(tempExit > legacy, 'W-85 fail-closed exit is after queue cleanup and legacy cleanup have been called')
  assert.ok(queueExit > tempExit && runner > queueExit)
  assert.equal(
    index.slice(temp, legacy).includes('failStartup'),
    false,
    'a cleanup throw must not exit before the other two cleanups run',
  )
  assert.equal(index.slice(legacy, tempExit).includes('failStartup'), false)
}

function verifyDataDirMatchesProgramData(): void {
  const previous = process.env['PROGRAMDATA']
  const root = join(tmpdir(), 'programdata-legacy-test')
  process.env['PROGRAMDATA'] = root
  try {
    assert.equal(getAgentDataDir(), join(root, 'AIJobPrintAgent'))
  } finally {
    if (previous === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previous
  }
}

function verifyExactLegacyRemoval(): void {
  const parent = isolatedRoot()
  const dataDir = join(parent, 'AIJobPrintAgent')
  const logsDir = join(dataDir, 'logs')
  const backup = join(dataDir, 'scan-test-backup')
  mkdirSync(join(backup, 'nested', 'inner'), { recursive: true })
  mkdirSync(logsDir, { recursive: true })
  const outsideDir = join(parent, 'outside-real')
  mkdirSync(outsideDir)
  const outsideFile = join(outsideDir, 'outside-marker.txt')
  writeFileSync(outsideFile, 'OUTSIDE_MARKER')
  placeDirectoryLink(outsideDir, join(backup, 'escape-link'))

  const debugBody = Buffer.alloc(48, 1)
  const outBody = Buffer.alloc(38, 2)
  const exeBody = Buffer.alloc(43, 3)
  const nestedBody = Buffer.alloc(10, 4)
  const markerBody = Buffer.alloc(7, 5)
  writeFileSync(join(dataDir, 'agent-debug.log'), debugBody)
  writeFileSync(join(dataDir, 'agent-out.log'), outBody)
  writeFileSync(join(logsDir, 'AIJobPrintTerminalSetup.exe'), exeBody)
  writeFileSync(join(backup, 'nested', 'inner', 'nested-scan-marker.bin'), nestedBody)
  writeFileSync(join(backup, 'marker-file.dat'), markerBody)
  writeFileSync(join(dataDir, 'agent.db'), 'db-bytes')
  writeFileSync(join(logsDir, 'aijobprintagent.out.log'), 'rolling-log')
  writeFileSync(join(dataDir, 'agent-debug.log.keep'), 'keep-me')
  writeFileSync(join(logsDir, 'OtherSetup.exe'), 'other-exe')
  mkdirSync(join(dataDir, 'keep'))
  writeFileSync(join(dataDir, 'keep', 'agent-debug.log'), 'not-the-root-log')

  const expectedBytes = debugBody.length + outBody.length + exeBody.length + nestedBody.length + markerBody.length
  const logs = captureStdio(() => {
    const result = cleanupKnownLegacyResidue({ dataDir })
    assert.equal(result.removed, 4)
    assert.equal(result.bytes, expectedBytes)
    assert.equal(result.skipped, 0)
  })
  assert.equal(existsSync(join(dataDir, 'agent-debug.log')), false)
  assert.equal(existsSync(join(dataDir, 'agent-out.log')), false)
  assert.equal(existsSync(join(logsDir, 'AIJobPrintTerminalSetup.exe')), false)
  assert.equal(existsSync(backup), false)
  assert.equal(existsSync(join(dataDir, 'agent.db')), true)
  assert.equal(readFileSync(join(logsDir, 'aijobprintagent.out.log'), 'utf8'), 'rolling-log')
  assert.equal(existsSync(join(dataDir, 'agent-debug.log.keep')), true)
  assert.equal(existsSync(join(logsDir, 'OtherSetup.exe')), true)
  assert.equal(readFileSync(join(dataDir, 'keep', 'agent-debug.log'), 'utf8'), 'not-the-root-log')
  assert.equal(existsSync(outsideDir), true)
  assert.equal(readFileSync(outsideFile, 'utf8'), 'OUTSIDE_MARKER')
  assert.doesNotMatch(logs, /agent-debug|agent-out|AIJobPrintTerminalSetup|scan-test-backup|nested-scan-marker|aijobprintagent|OtherSetup|OUTSIDE_MARKER|escape-link/)
  assert.match(logs, new RegExp(`legacy-residue-cleanup: removed=4 bytes=${expectedBytes} skipped=0`))
  const second = captureStdio(() => {
    const again = cleanupKnownLegacyResidue({ dataDir })
    assert.equal(again.removed, 0)
    assert.equal(again.skipped, 0)
  })
  assert.doesNotMatch(second, /legacy-residue-cleanup/)
  rmSync(parent, { recursive: true, force: true })
}

function verifyTopLevelSymlinkSkipped(): void {
  const parent = isolatedRoot()
  const dataDir = join(parent, 'data')
  mkdirSync(dataDir)
  const outsideDir = join(parent, 'outside-debug')
  mkdirSync(outsideDir)
  const outsideFile = join(outsideDir, 'payload.txt')
  writeFileSync(outsideFile, 'SENSITIVE_DEBUG')
  placeDirectoryLink(outsideDir, join(dataDir, 'agent-debug.log'))
  const logs = captureStdio(() => {
    const result = cleanupKnownLegacyResidue({ dataDir })
    assert.equal(result.removed, 0)
    assert.ok(result.skipped >= 1)
  })
  assert.equal(existsSync(join(dataDir, 'agent-debug.log')), true)
  assert.equal(readFileSync(outsideFile, 'utf8'), 'SENSITIVE_DEBUG')
  assert.doesNotMatch(logs, /agent-debug|SENSITIVE_DEBUG|payload/)
  rmSync(parent, { recursive: true, force: true })
}

function verifyIntermediateLinkSkipped(): void {
  const parent = isolatedRoot()
  const dataDir = join(parent, 'data')
  mkdirSync(dataDir)
  const outsideDir = join(parent, 'outside-logs')
  mkdirSync(outsideDir)
  const exe = join(outsideDir, 'AIJobPrintTerminalSetup.exe')
  writeFileSync(exe, 'OLD_SETUP')
  placeDirectoryLink(outsideDir, join(dataDir, 'logs'))
  const logs = captureStdio(() => {
    const result = cleanupKnownLegacyResidue({ dataDir })
    assert.equal(result.removed, 0)
    assert.ok(result.skipped >= 1)
  })
  assert.equal(readFileSync(exe, 'utf8'), 'OLD_SETUP')
  assert.equal(existsSync(join(dataDir, 'logs')), true)
  assert.doesNotMatch(logs, /AIJobPrintTerminalSetup|OLD_SETUP/)
  rmSync(parent, { recursive: true, force: true })
}

function verifyDotDotIsSkipped(): void {
  const parent = isolatedRoot()
  const dataDir = join(parent, 'data')
  mkdirSync(dataDir)
  const outside = join(parent, 'outside-secret.txt')
  writeFileSync(outside, 'keep-outside')
  writeFileSync(join(dataDir, 'agent.db'), 'db')
  const logs = captureStdio(() => {
    const result = cleanupKnownLegacyResidue({
      dataDir,
      entries: [['..', 'outside-secret.txt']],
    })
    assert.equal(result.removed, 0)
    assert.equal(result.skipped, 1)
  })
  assert.equal(existsSync(outside), true)
  assert.equal(readFileSync(outside, 'utf8'), 'keep-outside')
  assert.equal(existsSync(join(dataDir, 'agent.db')), true)
  assert.doesNotMatch(logs, /outside-secret|keep-outside/)
  rmSync(parent, { recursive: true, force: true })
}

function verifyLegacyDeleteFailureDoesNotThrow(): void {
  const parent = isolatedRoot()
  const dataDir = join(parent, 'data')
  mkdirSync(dataDir)
  const file = join(dataDir, 'agent-debug.log')
  writeFileSync(file, 'secret-name-debug')
  const logs = captureStdio(() => {
    const result = cleanupKnownLegacyResidue({
      dataDir,
      unlinkSync: () => {
        throw new Error('EACCES')
      },
    })
    assert.equal(result.removed, 0)
    assert.equal(result.skipped, 1)
  })
  assert.equal(existsSync(file), true)
  assert.doesNotMatch(logs, /agent-debug|secret-name-debug|EACCES/)
  assert.match(logs, /skipped=1/)
  rmSync(parent, { recursive: true, force: true })
}

const legacyRealRunChild = `
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { cleanupKnownLegacyResidue } = require('./src/agent/legacy-residue-cleanup')
function place(target, linkPath) {
  if (process.platform === 'win32') {
    const q = (value) => "'" + value.replace(/'/g, "''") + "'"
    const command = 'New-Item -ItemType Junction -Path ' + q(linkPath) + ' -Target ' + q(target)
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
    if (result.status !== 0) {
      console.error(result.stdout || '')
      console.error(result.stderr || '')
      process.exit(1)
    }
    return
  }
  fs.symlinkSync(target, linkPath, 'dir')
}
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-real-'))
const dataDir = path.join(parent, 'AIJobPrintAgent')
const logsDir = path.join(dataDir, 'logs')
const backup = path.join(dataDir, 'scan-test-backup')
fs.mkdirSync(path.join(backup, 'nested', 'inner'), { recursive: true })
fs.mkdirSync(logsDir, { recursive: true })
const outsideDir = path.join(parent, 'outside-real')
fs.mkdirSync(outsideDir)
const outsideFile = path.join(outsideDir, 'outside-marker.txt')
fs.writeFileSync(outsideFile, 'OUTSIDE_MARKER')
place(outsideDir, path.join(backup, 'escape-link'))
fs.writeFileSync(path.join(dataDir, 'agent-debug.log'), 'd')
fs.writeFileSync(path.join(dataDir, 'agent-out.log'), 'o')
fs.writeFileSync(path.join(logsDir, 'AIJobPrintTerminalSetup.exe'), 'e')
fs.writeFileSync(path.join(backup, 'nested', 'inner', 'nested-scan-marker.bin'), 'n')
fs.writeFileSync(path.join(dataDir, 'agent.db'), 'db')
fs.writeFileSync(path.join(logsDir, 'aijobprintagent.out.log'), 'rolling')
fs.writeFileSync(path.join(dataDir, 'agent-debug.log.keep'), 'keep')
fs.writeFileSync(path.join(logsDir, 'OtherSetup.exe'), 'other')
let failed = false
try {
  cleanupKnownLegacyResidue({ dataDir })
  if (fs.existsSync(path.join(dataDir, 'agent-debug.log'))) failed = true
  if (fs.existsSync(path.join(dataDir, 'agent-out.log'))) failed = true
  if (fs.existsSync(path.join(logsDir, 'AIJobPrintTerminalSetup.exe'))) failed = true
  if (fs.existsSync(backup)) failed = true
  if (!fs.existsSync(path.join(dataDir, 'agent.db'))) failed = true
  if (!fs.existsSync(path.join(logsDir, 'aijobprintagent.out.log'))) failed = true
  if (!fs.existsSync(path.join(dataDir, 'agent-debug.log.keep'))) failed = true
  if (!fs.existsSync(path.join(logsDir, 'OtherSetup.exe'))) failed = true
  if (!fs.existsSync(outsideFile) || fs.readFileSync(outsideFile, 'utf8') !== 'OUTSIDE_MARKER') failed = true
  if (fs.existsSync(path.join(backup, 'escape-link'))) failed = true
} finally {
  fs.rmSync(parent, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
`

const legacyBoundaryChild = `
const fs = require('fs')
const os = require('os')
const path = require('path')
const { cleanupKnownLegacyResidue } = require('./src/agent/legacy-residue-cleanup')
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-boundary-'))
const dataDir = path.join(parent, 'data')
fs.mkdirSync(dataDir)
const outside = path.join(parent, 'outside-secret.txt')
fs.writeFileSync(outside, 'keep-outside')
fs.writeFileSync(path.join(dataDir, 'agent.db'), 'db')
let failed = false
try {
  cleanupKnownLegacyResidue({ dataDir, entries: [['..', 'outside-secret.txt']] })
  if (!fs.existsSync(outside) || fs.readFileSync(outside, 'utf8') !== 'keep-outside') failed = true
  if (!fs.existsSync(path.join(dataDir, 'agent.db'))) failed = true
} finally {
  fs.rmSync(parent, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
`

const legacyOrderChild = `
const fs = require('fs')
const index = fs.readFileSync('./src/index.ts', 'utf8')
const acquire = index.indexOf('await acquireLock()')
const temp = index.indexOf('cleanupCrashLeftoverPrintTaskTemps()')
const queue = index.indexOf('cleanupStaleOwnPrintJobs(')
const legacy = index.indexOf('cleanupKnownLegacyResidue()')
const tempExit = index.indexOf('if (printTempCleanupError)')
const runner = index.indexOf('startTaskRunner(')
if (!(acquire >= 0 && temp > acquire && queue > temp && legacy > queue && tempExit > legacy && runner > tempExit)) process.exit(1)
if (index.slice(temp, legacy).includes('failStartup')) process.exit(1)
if (index.slice(legacy, tempExit).includes('failStartup')) process.exit(1)
process.exit(0)
`

function verifyLegacyMutations(): void {
  const cleanupSource = readFileSync(legacySourcePath, 'utf8')
  const indexSource = readFileSync(indexSourcePath, 'utf8')
  const entriesAnchor = '  const entries = hooks.entries ?? KNOWN_LEGACY_RESIDUE_ENTRIES'
  const followAnchor = `  try {
    unlinkSync(linkPath)
  } catch {
    // Windows 目录联接点有时 unlink 会 EPERM。不带 recursive 的 rmdir 只拆联接点本身。
    rmdirSync(linkPath)
  }`
  const boundaryAnchor =
    '  const rel = path.relative(root, candidate)\n' +
    '  if (rel === \'\' || rel === \'..\' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false\n' +
    '  return true'
  const callAnchor = 'cleanupKnownLegacyResidue()'
  const earlyExitAnchor = '      printTempCleanupError = error'
  assert.ok(cleanupSource.includes(entriesAnchor), 'exact entry anchor must exist')
  assert.ok(cleanupSource.includes(followAnchor), 'link removal anchor must exist')
  assert.ok(cleanupSource.includes(boundaryAnchor), 'path boundary anchor must exist')
  assert.ok(indexSource.includes(callAnchor), 'legacy cleanup call anchor must exist')
  assert.ok(indexSource.includes(earlyExitAnchor), 'temp cleanup error anchor must exist')

  const baseline = runNodeEval(legacyRealRunChild)
  assert.equal(baseline.status, 0, `${baseline.stdout ?? ''}\n${baseline.stderr ?? ''}`)
  const boundaryOk = runNodeEval(legacyBoundaryChild)
  assert.equal(boundaryOk.status, 0, `${boundaryOk.stdout ?? ''}\n${boundaryOk.stderr ?? ''}`)
  const orderOk = runNodeEval(legacyOrderChild)
  assert.equal(orderOk.status, 0, `${orderOk.stdout ?? ''}\n${orderOk.stderr ?? ''}`)

  const wildcard = `  const entries = hooks.entries ?? (() => {
    const found: string[][] = []
    const walk = (dir: string, prefix: string[]): void => {
      for (const ent of fs.readdirSync(dir)) {
        const full = path.join(dir, ent)
        const st = fs.lstatSync(full)
        if (st.isSymbolicLink()) continue
        if (st.isDirectory()) walk(full, prefix.concat(ent))
        else if (ent.endsWith('.log')) found.push(prefix.concat(ent))
      }
    }
    walk(dataDir, [])
    return found
  })()`
  writeFileSync(legacySourcePath, cleanupSource.replace(entriesAnchor, wildcard))
  try {
    const widened = runNodeEval(legacyRealRunChild)
    assert.notEqual(widened.status, 0, 'deleting by *.log must fail because aijobprintagent.out.log would be removed')
  } finally {
    writeFileSync(legacySourcePath, cleanupSource)
  }

  writeFileSync(
    legacySourcePath,
    cleanupSource.replace(
      followAnchor,
      '  fs.rmSync(fs.realpathSync(linkPath), { recursive: true, force: true })',
    ),
  )
  try {
    const followed = runNodeEval(legacyRealRunChild)
    assert.notEqual(followed.status, 0, 'following a directory link must fail because the outside file would be removed')
  } finally {
    writeFileSync(legacySourcePath, cleanupSource)
  }

  writeFileSync(legacySourcePath, cleanupSource.replace(boundaryAnchor, 'return true'))
  try {
    const escaped = runNodeEval(legacyBoundaryChild)
    assert.notEqual(escaped.status, 0, 'removing the path boundary check must fail for a .. entry')
  } finally {
    writeFileSync(legacySourcePath, cleanupSource)
  }

  writeFileSync(indexSourcePath, indexSource.replace(callAnchor, '/* mutation: legacy residue call removed */'))
  try {
    const removedCall = runNodeEval(legacyOrderChild)
    assert.notEqual(removedCall.status, 0, 'removing the legacy cleanup call must fail the gate')
  } finally {
    writeFileSync(indexSourcePath, indexSource)
  }

  writeFileSync(
    indexSourcePath,
    indexSource.replace(earlyExitAnchor, `${earlyExitAnchor}\n      failStartup(error, 'AGENT_STARTUP_FAILED')`),
  )
  try {
    const earlyExit = runNodeEval(legacyOrderChild)
    assert.notEqual(earlyExit.status, 0, 'W-85 fail-closed before the other cleanups must fail the gate')
  } finally {
    writeFileSync(indexSourcePath, indexSource)
  }
}

export function runKnownLegacyResidueCleanupTests(): void {
  verifyLegacySourceShape()
  verifyDataDirMatchesProgramData()
  verifyExactLegacyRemoval()
  verifyTopLevelSymlinkSkipped()
  verifyIntermediateLinkSkipped()
  verifyDotDotIsSkipped()
  verifyLegacyDeleteFailureDoesNotThrow()
  verifyLegacyMutations()
  console.log('PASS known legacy residue cleanup')
}

function isDirectHelperRun(): boolean {
  const entry = (process.argv[1] ?? '').replace(/\\/g, '/')
  return entry.endsWith('scripts/agent-crash-privacy.helper.ts')
}

if (isDirectHelperRun()) {
  try {
    runKnownLegacyResidueCleanupTests()
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
