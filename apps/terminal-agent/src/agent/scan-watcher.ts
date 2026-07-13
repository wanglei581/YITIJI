/**
 * agent/scan-watcher.ts — 首期真实扫描
 *
 * 监听打印机"扫描到 SMB 共享目录"产生的文件：
 *   1. 新文件出现 → 等待文件大小稳定（避免读到还没写完的文件）
 *   2. 整体读取 → POST /terminals/:id/scan-sessions/deliver
 *   3. 投递成功 → 删除源文件
 *   4. 投递失败因为没有匹配的等待中任务（409/NO_WAITING_SCAN_TASK）→ 移入 _unclaimed 子目录，不重试
 *   5. 其它网络/5xx 错误 → 文件保留原地，交给下一轮周期性清点重试
 *
 * 启动时 + 之后每 5 分钟做一次目录清点，处理 Agent 重启期间到达、
 * 或此前投递失败但文件本身未再变化的文件（不会有新的 chokidar change 事件）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import FormData from 'form-data'
import type { AgentConfig } from './types'
import { createApiClient, axiosErrorMessage } from './api-client'
import { log, warn, err } from '../logger'

const STABILITY_CHECK_INTERVAL_MS = 500
const STABILITY_MAX_CHECKS = 10
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const UNCLAIMED_DIRNAME = '_unclaimed'
/**
 * `_unclaimed` 隔离目录里的文件超过这个时长（按文件 mtime 计算）就会被周期清理
 * 删除。24 小时——给现场人工核查留出一个完整工作日的窗口，同时不让身份证/简历
 * 这类高敏原始扫描件在本地磁盘无限期堆积。
 */
export const UNCLAIMED_MAX_AGE_MS = 24 * 60 * 60 * 1000
/**
 * 网络/5xx 等非"无匹配任务"错误导致投递失败时，最多允许重试这么久（按文件自身
 * mtime 计算，Agent 是无状态 sweep 循环，没有额外状态记录"已经重试几次"）。
 * 2 小时——覆盖正常的网络抖动/短暂后端不可用，同时不让真正投递不了的文件无限期
 * 占着"待投递"状态。超过后移入 _unclaimed，与"无等待任务"走同一隔离归宿，但日志
 * 措辞不同，避免混淆两种不同的原因。
 */
export const DELIVERY_RETRY_MAX_MS = 2 * 60 * 60 * 1000

/** 把毫秒时长格式化成人类可读的小时/分钟，用于日志——不掺入任何文件内容。 */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}分钟`
  return `${hours}小时${minutes}分钟`
}

export interface ScanWatcherHandle {
  stop: () => Promise<void>
}

/** 等待文件大小连续两次读取一致，判定为"写入完成"。超时仍返回 false。 */
async function waitForStableFile(filePath: string): Promise<boolean> {
  let lastSize = -1
  for (let i = 0; i < STABILITY_MAX_CHECKS; i++) {
    if (!existsSync(filePath)) return false
    const { size } = statSync(filePath)
    if (size > 0 && size === lastSize) return true
    lastSize = size
    await new Promise((resolve) => setTimeout(resolve, STABILITY_CHECK_INTERVAL_MS))
  }
  return false
}

function ensureUnclaimedDir(scanWatchFolder: string): string {
  const dir = join(scanWatchFolder, UNCLAIMED_DIRNAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

/**
 * 正在处理中的文件路径集合，用于防止 chokidar 实时 `add` 事件与周期性
 * `sweepFolder` 清点并发处理同一个文件（否则会出现两次投递抢占两个不同
 * 等待中任务、把同一份扫描件误发给另一个用户的严重问题）。
 */
const inFlightPaths = new Set<string>()

/** 处理单个候选文件：稳定性检查 → 投递 → 成功删除 / 未匹配隔离 / 其它错误留原地重试。 */
export async function processCandidate(
  filePath: string,
  filename: string,
  config: AgentConfig,
): Promise<void> {
  if (inFlightPaths.has(filePath)) {
    // 已经在被实时监听或另一轮清点处理，跳过，避免同一文件并发投递两次。
    return
  }
  inFlightPaths.add(filePath)
  try {
    const stable = await waitForStableFile(filePath)
    if (!stable) {
      warn(`scan-watcher: file did not stabilize in time, skipping this round — ${filename}`)
      return
    }

    // 重新确认文件仍存在:稳定性检查通过后、真正处理前,文件有可能已被
    // 另一条并发路径处理完删除(理论上 inFlightPaths 已经防住了这种情况,
    // 但双重确认更安全,尤其是应对本模块之外的原因导致文件消失,例如
    // 杀毒软件锁定后又释放并删除、SMB 短暂断连等)。
    if (!existsSync(filePath)) {
      warn(`scan-watcher: file disappeared before processing, skipping — ${filename}`)
      return
    }

    const buffer = readFileSync(filePath)
    const form = new FormData()
    form.append('file', buffer, { filename, contentType: guessMimeType(filename) })

    const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)

    try {
      await client.post(`/terminals/${config.terminalId}/scan-sessions/deliver`, form, {
        headers: form.getHeaders(),
      })
      unlinkSync(filePath)
      log(`scan-watcher: delivered and removed source file — ${filename}`)
    } catch (e) {
      const code = (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
      if (code === 'NO_WAITING_SCAN_TASK') {
        const unclaimedDir = ensureUnclaimedDir(config.scanWatchFolder!)
        renameSync(filePath, join(unclaimedDir, filename))
        warn(`scan-watcher: no waiting scan task, moved to _unclaimed — ${filename}`)
        return
      }

      // 网络/5xx 等其它错误：默认留在原地交给下一轮 sweep 重试，但重试时长不能
      // 无限——用文件自身 mtime（不是"第一次尝试投递的时间"，Agent 没有额外状态
      // 记录重试次数）判断是否已经超过 DELIVERY_RETRY_MAX_MS。超过后放弃重试，
      // 移入 _unclaimed（与 NO_WAITING_SCAN_TASK 同一归宿，但日志措辞明确区分为
      // "重试超时放弃"，避免和真正的"无等待任务"语义混淆）。
      let mtimeMs: number | undefined
      try {
        mtimeMs = statSync(filePath).mtime.getTime()
      } catch {
        // 文件在此期间消失（已被其它路径处理/删除）——无需再决定去留。
      }
      if (mtimeMs !== undefined && Date.now() - mtimeMs > DELIVERY_RETRY_MAX_MS) {
        try {
          const unclaimedDir = ensureUnclaimedDir(config.scanWatchFolder!)
          renameSync(filePath, join(unclaimedDir, filename))
          warn(
            `scan-watcher: delivery retry timeout exceeded (idle ${formatDuration(Date.now() - mtimeMs)}), ` +
              `abandoning retries and moved to _unclaimed — ${filename}`,
          )
        } catch (moveErr) {
          err(`scan-watcher: failed to quarantine file after retry timeout — ${filename}: ${axiosErrorMessage(moveErr)}`)
        }
        return
      }

      err(`scan-watcher: delivery failed, leaving file for next sweep — ${filename}: ${axiosErrorMessage(e)}`)
    }
  } catch (e) {
    // 兜底:任何其它未预料到的文件系统错误(锁定、权限、竞态残留等)都不能
    // 逃逸成 unhandled rejection——本 Agent 进程有全局 process.exit(1) 兜底,
    // 这里崩了会把心跳/领任务等其它功能一起打挂。
    err(`scan-watcher: unexpected error processing candidate, leaving file in place for retry — ${filename}: ${axiosErrorMessage(e)}`)
  } finally {
    inFlightPaths.delete(filePath)
  }
}

/**
 * 清理 _unclaimed 隔离目录：删除 mtime 早于 UNCLAIMED_MAX_AGE_MS 的文件。
 * 只删文件本身，不产生审计记录——这些文件从未成功建档，不在 FileObject
 * 审计范围内；日志只记录文件名 + 滞留时长，绝不记录文件内容。
 */
export function sweepUnclaimedDir(scanWatchFolder: string): void {
  const dir = join(scanWatchFolder, UNCLAIMED_DIRNAME)
  if (!existsSync(dir)) return

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (e) {
    warn(`scan-watcher: failed to read _unclaimed dir for cleanup — ${axiosErrorMessage(e)}`)
    return
  }

  const now = Date.now()
  for (const name of entries) {
    const fullPath = join(dir, name)
    let mtimeMs: number
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) continue
      mtimeMs = stat.mtime.getTime()
    } catch {
      continue
    }

    const ageMs = now - mtimeMs
    if (ageMs <= UNCLAIMED_MAX_AGE_MS) continue

    try {
      unlinkSync(fullPath)
      warn(`scan-watcher: deleted stale _unclaimed file after ${formatDuration(ageMs)} idle — ${name}`)
    } catch (e) {
      err(`scan-watcher: failed to delete stale _unclaimed file — ${name}: ${axiosErrorMessage(e)}`)
    }
  }
}

/** 目录清点：处理当前已存在、不在 _unclaimed 子目录里的文件；同时清理 _unclaimed 里的过期文件。 */
export async function sweepFolder(scanWatchFolder: string, config: AgentConfig): Promise<void> {
  sweepUnclaimedDir(scanWatchFolder)

  let entries: string[]
  try {
    entries = readdirSync(scanWatchFolder)
  } catch (e) {
    warn(`scan-watcher: failed to read scanWatchFolder — ${axiosErrorMessage(e)}`)
    return
  }
  for (const name of entries) {
    if (name === UNCLAIMED_DIRNAME) continue
    const fullPath = join(scanWatchFolder, name)
    try {
      if (statSync(fullPath).isDirectory()) continue
    } catch {
      continue
    }
    try {
      await processCandidate(fullPath, name, config)
    } catch (e) {
      err(`scan-watcher: sweep failed to process ${name}, continuing with remaining files: ${axiosErrorMessage(e)}`)
    }
  }
}

/**
 * 启动扫描监听。未配置 config.scanWatchFolder 时直接返回 undefined，
 * 不影响心跳 / claim 等其余 Agent 功能。
 */
export function startScanWatcher(config: AgentConfig): ScanWatcherHandle | undefined {
  const folder = config.scanWatchFolder?.trim()
  if (!folder) {
    log('scan-watcher: scanWatchFolder 未配置，跳过扫描监听')
    return undefined
  }

  log(`scan-watcher: watching ${folder}`)

  const watcher: FSWatcher = chokidar.watch(folder, {
    ignoreInitial: true,
    depth: 0,
    ignored: (path: string) => path.includes(UNCLAIMED_DIRNAME),
  })

  watcher.on('add', (filePath: string) => {
    const filename = filePath.split(/[\\/]/).pop() ?? filePath
    processCandidate(filePath, filename, config).catch((e) => {
      err(`scan-watcher: processCandidate threw unexpectedly for ${filename}: ${axiosErrorMessage(e)}`)
    })
  })

  watcher.on('error', (error: unknown) => {
    err(`scan-watcher: watcher error — ${axiosErrorMessage(error)}`)
  })

  // 启动时清点一次（处理 Agent 重启期间到达、被 ignoreInitial 跳过的文件）
  void sweepFolder(folder, config)

  const sweepTimer = setInterval(() => void sweepFolder(folder, config), SWEEP_INTERVAL_MS)

  return {
    stop: async () => {
      clearInterval(sweepTimer)
      await watcher.close()
    },
  }
}
