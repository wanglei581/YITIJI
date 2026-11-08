import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { performance } from 'perf_hooks'
import { spawn, execFile, type ChildProcess, type SpawnOptions } from 'child_process'
import { log } from '../../logger'
import { assertScanTaskDir, getScanDeviceRoot } from '../scan-device/scan-temp-dir'
import { buildDeskewScript, deskewCommand, DESKEW_TIMEOUT_MS, DESKEW_SOURCE, DESKEW_MIN_ANGLE, DESKEW_MAX_ANGLE } from './script'

export type DeskewReason = 'disabled' | 'unsupported' | 'uncertain' | 'corrected' | 'timeout' | 'process_failed' | 'invalid_output' | 'exception'
export interface DeskewResult { filePath: string; corrected: boolean; angleDeg: number | null; reason: DeskewReason }
export interface DeskewDeps {
  root: string
  platform: NodeJS.Platform
  now(): number
  spawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcess
  killTree(pid: number): Promise<boolean>
  setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimer(timer: ReturnType<typeof setTimeout>): void
  log(message: string): void
}

/** taskkill /T /F covers Add-Type's compiler as well as PowerShell. Bounded confirmation. */
export function killDeskewTree(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    const command = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    execFile(command, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 1000 }, (error) => resolve(!error))
  })
}

const defaults = (): DeskewDeps => ({
  root: getScanDeviceRoot(), platform: process.platform, now: () => performance.now(),
  spawnProcess: spawn, killTree: killDeskewTree, setTimer: setTimeout, clearTimer: clearTimeout, log,
})

function realDirectory(dir: string): void {
  const stat = fs.lstatSync(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== path.resolve(dir)) throw new Error('directory')
}
function readRegular(file: string, max: number): Buffer {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0 || stat.size > max) throw new Error('file')
  return fs.readFileSync(file)
}

function supervise(child: ChildProcess, deps: DeskewDeps, startedAt: number): Promise<{ reason: DeskewReason; stopped: boolean }> {
  return new Promise((resolve) => {
    let done = false, stopping = false
    const finish = (reason: DeskewReason, stopped = true) => {
      if (done) return
      done = true
      deps.clearTimer(timer)
      resolve({ reason, stopped })
    }
    const stop = (reason: DeskewReason) => {
      if (done || stopping) return
      stopping = true
      // Even if taskkill cannot confirm exit, the unique output directory stays isolated.
      Promise.resolve().then(() => child.pid ? deps.killTree(child.pid) : true)
        .catch(() => false).then((stopped) => finish(reason, stopped))
    }
    const timer = deps.setTimer(() => stop('timeout'), Math.max(0, DESKEW_TIMEOUT_MS - (deps.now() - startedAt)))
    child.on('error', () => stop('process_failed'))
    child.on('close', (code) => {
      if (stopping) return
      if (deps.now() - startedAt >= DESKEW_TIMEOUT_MS) stop('timeout')
      else if (code === 0) finish('uncertain')
      else stop('process_failed')
    })
  })
}

/** S4a standalone only. Caller owns task-dir lifecycle; no scan pipeline imports this yet. */
export async function runScanDeskew(
  input: { filePath: string; taskDir: string; scanAutoDeskewEnabled?: boolean },
  overrides: Partial<DeskewDeps> = {},
): Promise<DeskewResult> {
  let deps: DeskewDeps | undefined
  let runDir: string | undefined
  let cleanupSafe = true
  let result: DeskewResult = { filePath: input.filePath, corrected: false, angleDeg: null, reason: 'exception' }
  try {
    deps = { ...defaults(), ...overrides }
    if (input.scanAutoDeskewEnabled !== true) { result.reason = 'disabled'; return result }
    const extension = path.extname(input.filePath).toLowerCase()
    if (deps.platform !== 'win32' || !['.jpg', '.jpeg', '.png', '.bmp'].includes(extension)) {
      result.reason = 'unsupported'; return result
    }
    assertScanTaskDir(input.taskDir, deps.root)
    realDirectory(deps.root); realDirectory(input.taskDir)
    if (path.dirname(path.resolve(input.filePath)) !== path.resolve(input.taskDir)) throw new Error('input_directory')
    const bytes = readRegular(input.filePath, 100 * 1024 * 1024)
    runDir = fs.mkdtempSync(path.join(input.taskDir, 'deskew-'))
    realDirectory(runDir)
    const ext = (extension === '.jpeg' ? '.jpg' : extension) as '.jpg' | '.png' | '.bmp'
    fs.writeFileSync(path.join(runDir, `input${ext}`), bytes, { flag: 'wx', mode: 0o600 })
    fs.writeFileSync(path.join(runDir, 'processor.cs'), DESKEW_SOURCE, { flag: 'wx', mode: 0o600 })
    const command = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const startedAt = deps.now()
    const child = deps.spawnProcess(command, deskewCommand(buildDeskewScript(runDir, ext)), {
      windowsHide: true, shell: false, stdio: 'ignore',
    })
    cleanupSafe = false
    const outcome = await supervise(child, deps, startedAt)
    cleanupSafe = outcome.stopped
    result.reason = outcome.reason
    if (result.reason !== 'uncertain') return result
    const manifestPath = path.join(runDir, 'result.json')
    if (!fs.existsSync(manifestPath)) return result
    result.reason = 'invalid_output'
    const manifest = JSON.parse(readRegular(manifestPath, 1024).toString('utf8')) as Record<string, unknown>
    const output = path.join(runDir, ext === '.png' ? 'output.png' : 'output.jpg')
    const encoded = readRegular(output, 100 * 1024 * 1024)
    const signature = ext === '.png'
      ? encoded.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && encoded.subarray(-8).equals(Buffer.from('49454e44ae426082', 'hex'))
      : encoded[0] === 255 && encoded[1] === 216 && encoded[2] === 255 && encoded.subarray(-2).equals(Buffer.from('ffd9', 'hex'))
    if (!signature || manifest.corrected !== true || typeof manifest.angleDeg !== 'number' || !Number.isFinite(manifest.angleDeg) ||
        Math.abs(manifest.angleDeg) < DESKEW_MIN_ANGLE || Math.abs(manifest.angleDeg) > DESKEW_MAX_ANGLE ||
        manifest.size !== encoded.length || manifest.sha256 !== createHash('sha256').update(encoded).digest('hex')) return result
    result = { filePath: output, corrected: true, angleDeg: manifest.angleDeg, reason: 'corrected' }
    return result
  } catch {
    result = { filePath: input.filePath, corrected: false, angleDeg: null, reason: 'exception' }
    return result
  } finally {
    if (runDir && cleanupSafe) {
      try {
        if (result.corrected) {
          for (const name of fs.readdirSync(runDir)) if (path.join(runDir, name) !== result.filePath) fs.rmSync(path.join(runDir, name), { force: true })
        } else fs.rmSync(runDir, { recursive: true, force: true })
      } catch { /* task-dir cleanup retries; never interrupt scanning */ }
    }
    try { deps?.log(JSON.stringify({ angleDeg: result.angleDeg, corrected: result.corrected })) } catch { /* logging is optional */ }
  }
}
