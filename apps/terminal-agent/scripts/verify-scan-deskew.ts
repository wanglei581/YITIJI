/** Linux/Mac safe: real private temp files, fake child/clock, no PowerShell or hardware. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { runScanDeskew, type DeskewDeps } from '../src/agent/scan-deskew/runner'
import { buildDeskewScript, deskewCommand, DESKEW_TIMEOUT_MS, DESKEW_SOURCE } from '../src/agent/scan-deskew/script'
import { parseConfigText } from '../src/agent/config-manager'

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deskew-gate-')))
const taskDir = path.join(root, 'task-1')
fs.mkdirSync(taskDir)
const filePath = path.join(taskDir, 'private-person-name.jpg')
const original = Buffer.from('original must be preserved')
fs.writeFileSync(filePath, original)
const passed: string[] = []
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn(); passed.push(name); console.log(`PASS ${name}`)
}
function harness() {
  const child = Object.assign(new EventEmitter(), { pid: 1729 }) as ChildProcess
  const logs: string[] = [], kills: number[] = []
  let now = 0
  let calls = 0, timer: (() => void) | undefined, clearCount = 0
  const deps: Partial<DeskewDeps> = {
    root, platform: 'win32', now: () => now,
    spawnProcess(command, args, options) {
      calls++
      assert.match(command, /WindowsPowerShell.*powershell\.exe$/)
      assert.equal(options.shell, false); assert.equal(options.stdio, 'ignore')
      assert.equal(options.windowsHide, true)
      assert.equal(args.at(-2), '-EncodedCommand')
      assert.equal(fs.readFileSync(path.join(runDir(), 'processor.cs'), 'utf8'), DESKEW_SOURCE)
      return child
    },
    killTree: async (pid) => { kills.push(pid); return true },
    setTimer(callback, ms) { assert.equal(ms, DESKEW_TIMEOUT_MS); timer = callback; return 1 as unknown as NodeJS.Timeout },
    clearTimer() { clearCount++ },
    log(message) { logs.push(message) },
  }
  return { deps, child, logs, kills, calls: () => calls, timeout: () => timer!(), clears: () => clearCount, advance: (ms: number) => { now += ms } }
}
const request = { filePath, taskDir, scanAutoDeskewEnabled: true }
function runDir(): string {
  return path.join(taskDir, fs.readdirSync(taskDir).filter((n) => n.startsWith('deskew-')).at(-1)!)
}
function output(dir: string, bytes: Buffer, patch: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(dir, 'output.jpg'), bytes)
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({
    corrected: true, angleDeg: 1, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...patch,
  }))
}
function clearRuns() {
  for (const name of fs.readdirSync(taskDir)) if (name.startsWith('deskew-')) fs.rmSync(path.join(taskDir, name), { recursive: true })
}
async function main() {
  await check('config default / invalid false; only literal true enables; heartbeat allowlist', () => {
    const base = { apiBaseUrl: 'https://example.test', terminalCode: 'T', printerName: 'P', agentVersion: '0.4.19' }
    for (const value of [undefined, null, 'true', 1, {}, [], false, true]) {
      assert.equal(parseConfigText(JSON.stringify({ ...base, scanAutoDeskewEnabled: value })).scanAutoDeskewEnabled, value === true)
    }
    const index = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8')
    const callback = index.slice(index.indexOf('onConfigUpdate: (patch)'), index.indexOf('onObservation: (observation)'))
    assert.doesNotMatch(callback, /scanAutoDeskewEnabled|Object\.assign|\.\.\.patch/)
    assert.match(callback, /patch\.heartbeatIntervalMs/); assert.match(callback, /patch\.claimIntervalMs/)
  })
  await check('encoded script contract / private paths / closed validated output / no diagnostics', () => {
    const script = buildDeskewScript('C:\\private\\task\\deskew-abcdef', '.jpg')
    const args = deskewCommand(script)
    assert.equal(Buffer.from(args.at(-1)!, 'base64').toString('utf16le'), script)
    assert.ok(args.join(' ').length < 32767, 'Windows command-line limit; C# travels via private source file')
    for (const token of ['OutputEncoding', 'UTF8Encoding($false)', 'scan-device', 'private_acl', 'ReparsePoint', 'Get-FileHash', 'result.json', 'exit 1', 'Remove-Item', 'Add-Type']) assert.ok(script.includes(token), token)
    assert.ok(!script.includes('C:\\private')); assert.equal(DESKEW_TIMEOUT_MS, 2000)
    assert.match(DESKEW_SOURCE, /FileMode.CreateNew/); assert.match(DESKEW_SOURCE, /Image.FromFile\(output\)/)
    assert.doesNotMatch(DESKEW_SOURCE, /\$"|\?\.|=>|\bnameof\s*\(|\b(?:record|async|dynamic)\b/, 'C# 5 syntax guard')
    const workflow = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/windows-agent-installer.yml'), 'utf8')
    assert.ok(workflow.includes('shell: powershell'))
    assert.ok(workflow.indexOf('Verify scan deskew C# and synthetic images') < workflow.indexOf('Exercise EXE install, repair, and uninstall'))
    assert.ok(workflow.includes('-File apps/terminal-agent/scripts/verify-scan-deskew-windows.ps1'))
    assert.doesNotMatch(script, /Write-(Host|Output|Warning|Error)|Start-Transcript/)
    assert.match(fs.readFileSync(path.join(__dirname, '../src/agent/scan-deskew/runner.ts'), 'utf8'), /\['\/PID', String\(pid\), '\/T', '\/F'\]/)
  })
  await check('disabled never spawns and preserves original for absent / false / invalid', async () => {
    for (const value of [undefined, false, 'true', 1, null]) {
      const h = harness()
      const pending = runScanDeskew({ ...request, scanAutoDeskewEnabled: value as boolean }, h.deps)
      assert.equal(h.calls(), 0, 'disabled must not start a process before returning')
      const result = await pending
      assert.equal(result.filePath, filePath); assert.equal(result.corrected, false); assert.equal(result.reason, 'disabled')
      assert.equal(h.calls(), 0)
    }
  })
  await check('spawn exception returns original without throwing', async () => {
    const h = harness()
    h.deps.spawnProcess = () => { throw new Error(`sensitive ${filePath}`) }
    const result = await runScanDeskew(request, h.deps)
    assert.equal(result.filePath, filePath); assert.equal(result.corrected, false); assert.equal(result.reason, 'exception')
    assert.equal(h.logs.length, 1); assert.deepEqual(JSON.parse(h.logs[0]), { angleDeg: null, corrected: false })
  })
  await check('timeout kills entire child tree; ignores late success; kill rejection contained', async () => {
    for (const rejects of [false, true]) {
      const h = harness()
      if (rejects) h.deps.killTree = async (pid) => { h.kills.push(pid); throw new Error('kill') }
      const pending = runScanDeskew(request, h.deps)
      const dir = runDir(); output(dir, Buffer.from('partial'))
      h.timeout(); h.child.emit('close', 0)
      const result = await pending
      assert.equal(result.filePath, filePath); assert.equal(result.reason, 'timeout')
      assert.deepEqual(h.kills, [1729]); assert.equal(h.clears(), 1)
      assert.equal(fs.existsSync(dir), rejects, 'confirmed tree termination cleans partial output; unconfirmed stays isolated')
      clearRuns()
    }
  })
  await check('close at deadline cannot beat the timeout callback', async () => {
    const h = harness(), pending = runScanDeskew(request, h.deps)
    h.advance(DESKEW_TIMEOUT_MS); h.child.emit('close', 0)
    assert.equal((await pending).reason, 'timeout'); assert.deepEqual(h.kills, [1729]); clearRuns()
  })
  await check('nonzero / child error return original even with output', async () => {
    for (const error of [false, true]) {
      const h = harness(), pending = runScanDeskew(request, h.deps)
      output(runDir(), Buffer.from('corrupt'))
      if (error) h.child.emit('error', new Error(filePath)); else h.child.emit('close', 9)
      const result = await pending
      assert.equal(result.filePath, filePath); assert.equal(result.reason, 'process_failed')
      assert.deepEqual(h.kills, [1729]); clearRuns()
    }
  })
  await check('missing / empty / damaged / hash mismatch / malformed status use original', async () => {
    for (const kind of ['missing', 'empty', 'damaged', 'hash', 'json', 'zero-angle', 'out-of-range']) {
      const h = harness(), pending = runScanDeskew(request, h.deps), dir = runDir()
      if (kind !== 'missing') output(dir, kind === 'empty' ? Buffer.alloc(0) : Buffer.from('not a jpeg'), kind === 'hash' ? { sha256: 'wrong' } : {})
      if (['hash', 'zero-angle', 'out-of-range'].includes(kind)) output(dir, Buffer.from('ffd8ffe00000ffd9', 'hex'), kind === 'hash' ? { sha256: 'wrong' } : { angleDeg: kind === 'zero-angle' ? 0 : 90 })
      if (kind === 'json') fs.writeFileSync(path.join(dir, 'result.json'), '{')
      h.child.emit('close', 0)
      const result = await pending
      assert.equal(result.filePath, filePath); assert.equal(result.corrected, false)
    }
  })
  await check('success uses independent output; logs exactly angle and corrected', async () => {
    const h = harness(), pending = runScanDeskew(request, h.deps), dir = runDir()
    // The child contract guarantees full System.Drawing decode; this fake tests Node integrity only.
    output(dir, Buffer.from('ffd8ffe00000ffd9', 'hex'))
    h.child.emit('close', 0)
    const result = await pending
    assert.equal(result.corrected, true); assert.equal(result.filePath, path.join(dir, 'output.jpg'))
    assert.deepEqual(fs.readFileSync(filePath), original)
    assert.equal(h.logs.length, 1)
    assert.deepEqual(JSON.parse(h.logs[0]), { angleDeg: 1, corrected: true })
    for (const forbidden of [filePath, path.basename(filePath), original.toString(), 'sha256']) assert.ok(!h.logs[0].includes(forbidden))
    assert.deepEqual(fs.readdirSync(dir), ['output.jpg']); clearRuns()
  })
  await check('path escape / symlink / unsupported reject before spawn; logger errors contained', async () => {
    const h = harness()
    assert.equal((await runScanDeskew({ ...request, taskDir: root }, h.deps)).filePath, filePath)
    assert.equal((await runScanDeskew({ ...request, filePath: path.join(taskDir, 'x.pdf') }, h.deps)).reason, 'unsupported')
    const link = path.join(taskDir, 'link.jpg'); fs.symlinkSync(filePath, link)
    assert.equal((await runScanDeskew({ ...request, filePath: link }, h.deps)).corrected, false)
    assert.equal(h.calls(), 0)
    await runScanDeskew({ ...request, scanAutoDeskewEnabled: false }, { ...h.deps, log: () => { throw new Error('log') } })
  })
  console.log(`scan-deskew: ${passed.length} groups passed (no PowerShell / no hardware)`)
}
const watchdog = setTimeout(() => { console.error('FAIL deskew gate did not finish'); process.exit(1) }, 5000)
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => { clearTimeout(watchdog); fs.rmSync(root, { recursive: true, force: true }) })
