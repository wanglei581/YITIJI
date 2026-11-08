/** WIA 默认执行器依赖；从 wia-runner 等价抽出，保留原公开导出。 */
import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import fs from 'fs'
import path from 'path'
import { WiaParamError, resolvePowerShellPath } from './wia-script'
import { getScanDeviceRoot } from './scan-temp-dir'

// ── 可注入的外部依赖 ──────────────────────────────────────────────────────

export interface RunnerClock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface WiaRunnerDeps {
  spawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcess
  /**
   * 强杀进程树。返回 false，或抛错，表示没确认杀成。
   * 不返回值（void）视为已发出强杀，接着等进程自己退出。
   */
  killProcessTree(pid: number): Promise<unknown>
  clock: RunnerClock
  writeCancelFlag(filePath: string): void
  removeFile(filePath: string): void
  /** 只认普通文件（lstat，不跟随符号链接）。不存在或不是普通文件返回 undefined。 */
  statFile(filePath: string): { size: number } | undefined
  powershellPath: string
  /** 私有临时根目录。 */
  root: string
}

export function buildTaskkillArgs(pid: number): string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new WiaParamError('pid')
  return ['/PID', String(pid), '/T', '/F']
}

function defaultKillProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const systemRoot = process.env['SystemRoot'] ?? process.env['SYSTEMROOT']
      const taskkill = systemRoot ? path.win32.join(systemRoot, 'System32', 'taskkill.exe') : 'taskkill'
      execFile(taskkill, buildTaskkillArgs(pid), { windowsHide: true, timeout: 15_000 }, () => resolve())
      return
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 进程已经不在了
    }
    resolve()
  })
}

export function createDefaultWiaRunnerDeps(): WiaRunnerDeps {
  return {
    spawnProcess: (command, args, options) => spawn(command, args, options),
    killProcessTree: defaultKillProcessTree,
    clock: {
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    writeCancelFlag: (filePath) => fs.writeFileSync(filePath, '1', { flag: 'w' }),
    removeFile: (filePath) => fs.rmSync(filePath, { force: true }),
    statFile: (filePath) => {
      try {
        const meta = fs.lstatSync(filePath)
        return meta.isFile() ? { size: meta.size } : undefined
      } catch {
        return undefined
      }
    },
    powershellPath: resolvePowerShellPath(),
    root: getScanDeviceRoot(),
  }
}

