/**
 * agent/scan-device/wia-runner.ts — 起 PowerShell 跑 WIA 扫描：逐行解析、超时、取消、强杀、结果归一
 *
 * 分层：
 *   runJob()         通用：起进程 → 逐行喂给 onLine → 空闲 / 总超时 → 软停（写取消标记）→
 *                    宽限期后 taskkill /T /F → 进程结束或强杀后兜底放行。
 *   startWiaScan()   扫描：脚本参数、逐页核实、HRESULT → 对外错误码、预热重试。
 *                    卡纸保留页文件，由调用方整目录清理。强杀没确认退出时如实标出。
 * 同目录另有两块建在它之上：wia-probe.ts（健康探测）、scan-pdf-compose.ts（合 PDF）。
 *
 * 本批（A1）只提供底座和单测：不拿设备锁（A2 在外层拿）、不碰心跳 / 本机 HTTP / task-runner，
 * 没有任何调用方。所有外部依赖（起进程、时钟、强杀、文件）都可注入，Mac 上用假执行器测。
 *
 * 日志只写计数、错误码、HRESULT 和毫秒数，不写路径、不写文件名。
 */

import type { ChildProcess } from 'child_process'
import { prepareWiaDeskew, logWiaDeskewLine } from '../scan-deskew/wia-integration'
import path from 'path'
import { log, warn } from '../../logger'
import {
  LineBuffer,
  SCAN_MAX_PAGES_DEFAULT,
  WIA_HRESULT,
  buildWiaPowerShellArgs,
  buildWiaScanScript,
  encodeWiaCommand,
  mapWiaHresult,
  parseWiaLine,
  requiredWiaPropertiesFailed,
  type ScanDeviceErrorCode,
  type WiaColor,
  type WiaLine,
  type WiaSource,
} from './wia-script'
import { scanCancelFlagPath } from './scan-temp-dir'
import { createDefaultWiaRunnerDeps, type WiaRunnerDeps } from './wia-runner-deps'
export { createDefaultWiaRunnerDeps, buildTaskkillArgs } from './wia-runner-deps'
export type { WiaRunnerDeps, RunnerClock } from './wia-runner-deps'

export const WIA_ABORT_GRACE_MS = 45_000
export const WIA_FORCE_KILL_WAIT_MS = 10_000
export const WIA_WARMING_UP_RETRY_DELAY_MS = 10_000
export const WIA_IDLE_TIMEOUT_MS = 120_000
export const WIA_TOTAL_TIMEOUT_MS = 12 * 60_000

// ── 通用：起进程并盯住它 ───────────────────────────────────────────────────

export interface JobSpec {
  args: string[]
  idleTimeoutMs: number
  totalTimeoutMs: number
  /** 软停：写取消标记。没有就不等宽限期，直接强杀。 */
  softStop?: () => void
  graceMs: number
  onLine(line: string): void
}

export interface JobExit {
  timedOut: boolean
  stopRequested: boolean
  forceKilled: boolean
  spawnFailed: boolean
  exitCode: number | null
  /** 强杀没发出去，或发出去之后进程在等待窗口内仍没退出。 */
  stopUnconfirmed: boolean
  processId?: number
}

export interface JobHandle {
  stop(): void
  done: Promise<JobExit>
}

export function runJob(spec: JobSpec, deps: WiaRunnerDeps): JobHandle {
  let closed = false
  let stopRequested = false
  let timedOut = false
  let forceKilled = false
  let stopUnconfirmed = false
  let processId: number | undefined
  let spawnFailed = false
  const timers: { idle?: unknown; total?: unknown; grace?: unknown; guard?: unknown } = {}
  const lineBuffer = new LineBuffer()
  let resolveDone!: (exit: JobExit) => void
  const done = new Promise<JobExit>((resolve) => {
    resolveDone = resolve
  })

  const finish = (exitCode: number | null): void => {
    if (closed) return
    closed = true
    for (const timer of Object.values(timers)) {
      if (timer !== undefined) deps.clock.clearTimeout(timer)
    }
    for (const line of lineBuffer.flush()) spec.onLine(line)
    resolveDone({ timedOut, stopRequested, forceKilled, spawnFailed, exitCode, stopUnconfirmed, processId })
  }

  let child: ChildProcess
  try {
    child = deps.spawnProcess(deps.powershellPath, spec.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    warn(`wia-runner: PowerShell could not be started — ${(error as NodeJS.ErrnoException).code ?? 'SPAWN_FAILED'}`)
    spawnFailed = true
    finish(null)
    return { stop: () => undefined, done }
  }

  const stop = (): void => {
    if (closed || stopRequested) return
    stopRequested = true
    if (spec.softStop) {
      try {
        spec.softStop()
      } catch {
        warn('wia-runner: could not write the cancel marker; relying on force kill')
      }
    }
    timers.grace = deps.clock.setTimeout(() => {
      if (closed) return
      forceKilled = true
      processId = child.pid
      warn(`wia-runner: process still running ${spec.softStop ? `after ${spec.graceMs}ms grace` : 'after stop request'}; force-killing process tree`)
      const pid = child.pid
      const kill = pid === undefined
        ? Promise.resolve(false)
        : Promise.resolve()
            .then(() => deps.killProcessTree(pid))
            .then((value) => value !== false, () => false)
      void kill.then((confirmed) => {
        if (closed) return
        if (!confirmed) {
          stopUnconfirmed = true
          warn('wia-runner: force kill did not confirm the process stopped')
          finish(null)
          return
        }
        timers.guard = deps.clock.setTimeout(() => {
          if (closed) return
          stopUnconfirmed = true
          warn('wia-runner: process did not exit after force kill; stop is unconfirmed')
          finish(null)
        }, WIA_FORCE_KILL_WAIT_MS)
      })
    }, spec.softStop ? spec.graceMs : 0)
  }

  const onTimeout = (what: string): void => {
    if (closed) return
    timedOut = true
    warn(`wia-runner: ${what}`)
    stop()
  }
  const armIdle = (): void => {
    if (timers.idle !== undefined) deps.clock.clearTimeout(timers.idle)
    timers.idle = deps.clock.setTimeout(() => onTimeout(`no output for ${spec.idleTimeoutMs}ms`), spec.idleTimeoutMs)
  }
  armIdle()
  timers.total = deps.clock.setTimeout(() => onTimeout(`total time exceeded ${spec.totalTimeoutMs}ms`), spec.totalTimeoutMs)

  child.stdout?.on('data', (chunk: Buffer | string) => {
    if (closed) return
    for (const line of lineBuffer.push(chunk)) spec.onLine(line)
    armIdle()
  })
  // 必须把 stderr 读空，否则管道写满会把 PowerShell 堵住；内容不记录。
  child.stderr?.on('data', () => undefined)
  child.on('error', (error: Error) => {
    const code = (error as NodeJS.ErrnoException).code ?? 'CHILD_ERROR'
    if (child.pid === undefined) {
      warn(`wia-runner: PowerShell could not be started — ${code}`)
      spawnFailed = true
      finish(null)
    } else {
      warn(`wia-runner: child process error — ${code}`)
    }
  })
  child.on('close', (code: number | null) => finish(code))

  return { stop, done }
}

// ── 扫描 ─────────────────────────────────────────────────────────────────

export interface WiaScanRequest {
  scanAutoDeskewEnabled?: boolean
  deviceName?: string
  source: WiaSource
  color: WiaColor
  /** 本次最多扫几页。默认：玻璃台 1，进纸器 SCAN_MAX_PAGES_DEFAULT。 */
  maxPages?: number
  /** 本次第一页的页序号，默认 1。 */
  startIndex?: number
  /** 必须是 <私有根>\<taskId>。 */
  outDir: string
  idleTimeoutMs?: number
  totalTimeoutMs?: number
  /** 软停后等进程自己退出的时长，默认 45 秒。只有单测会改它。 */
  abortGraceMs?: number
  /**
   * 一页已被核实并计入 pages 之后调用。不传则行为与以前相同。
   * 调用方可以返回 Promise；本运行器不等待它（不能让网络回报堵住 stdout）。
   */
  onPage?: (page: WiaScannedPage) => void | Promise<void>
  /** 自动预热重试也会再次动作硬件，调用方可在这里重取在线许可；拒绝则不起第二进程。 */
  beforeRetry?: () => Promise<void>
}

export interface WiaScannedPage {
  index: number
  /** 绝对路径，已核实是私有目录里的普通文件且不为空。 */
  file: string
  bytes: number
}

export type WiaScanEnd =
  | 'single_page'
  | 'feeder_emptied'
  | 'page_limit'
  | 'canceled'
  | 'aborted'
  | 'error'

export interface WiaScanResult {
  /** 至少拿到一页整页图，且没有任何需要丢弃结果的错误。 */
  ok: boolean
  endedBy: WiaScanEnd
  /** 本次运行整页收到并核实过的图，按页序。卡纸也留着，交给调用方整目录清理。 */
  pages: WiaScannedPage[]
  errorCode?: ScanDeviceErrorCode
  hresult?: string
  /** 运行器自己删掉的页数。卡纸不再逐页删，这里是 0，页文件留给调用方。 */
  discardedPages: number
  /** 是否对 PowerShell 进程树用过 taskkill /T /F。A2 据此决定下次开始前先探测。 */
  forceKilled: boolean
  /** 强杀没确认进程已经退出。调用方不得宣称清理完成。 */
  stopUnconfirmed: boolean
  /** 被强杀的进程号。只有强杀过才有。 */
  processId?: number
  attempts: number
  setFailed: number[]
  elapsedMs: number
}

export interface WiaScanHandle {
  /** 请求中止：写取消标记（当前页扫完即停）；宽限期内进程没退就强杀。幂等。 */
  abort(): void
  readonly result: Promise<WiaScanResult>
}

interface AttemptOutcome {
  pages: WiaScannedPage[]
  final: Extract<WiaLine, { kind: 'done' | 'failed' }> | undefined
  integrityError: boolean
  exit: JobExit
}

export function startWiaScan(request: WiaScanRequest, overrides: Partial<WiaRunnerDeps> = {}): WiaScanHandle {
  const deps: WiaRunnerDeps = { ...createDefaultWiaRunnerDeps(), ...overrides }
  const maxPages = request.maxPages ?? (request.source === 'flatbed' ? 1 : SCAN_MAX_PAGES_DEFAULT)
  const startIndex = request.startIndex ?? 1
  const outDir = path.resolve(request.outDir)
  const cancelFlag = scanCancelFlagPath(outDir)
  // 参数白名单与路径校验在这里同步抛出（WiaParamError），不会起进程。
  const script = buildWiaScanScript(
    {
      deviceName: request.deviceName ?? '',
      source: request.source,
      color: request.color,
      dpi: 300,
      maxPages,
      startIndex,
      outDir,
      cancelFlagPath: cancelFlag,
    },
    { root: deps.root },
  )
  const deskew = prepareWiaDeskew(script, { enabled: request.scanAutoDeskewEnabled, taskDir: outDir, root: deps.root })
  const args = buildWiaPowerShellArgs(encodeWiaCommand(deskew.script))

  const startedAt = deps.clock.now()
  let attempts = 0
  let abortRequested = false
  let forceKilled = false
  let stopCurrent: (() => void) | undefined
  let wakeSleeper: (() => void) | undefined

  const attempt = async (): Promise<AttemptOutcome> => {
    attempts += 1
    const pages: WiaScannedPage[] = []
    let final: AttemptOutcome['final']
    let integrityError = false
    let ignoredLines = 0
    const job = runJob(
      {
        args,
        idleTimeoutMs: request.idleTimeoutMs ?? WIA_IDLE_TIMEOUT_MS,
        totalTimeoutMs: request.totalTimeoutMs ?? WIA_TOTAL_TIMEOUT_MS,
        softStop: () => deps.writeCancelFlag(cancelFlag),
        graceMs: request.abortGraceMs ?? WIA_ABORT_GRACE_MS,
        onLine: (line) => {
          if (request.scanAutoDeskewEnabled === true && logWiaDeskewLine(line)) return
          const parsed = parseWiaLine(line)
          if (!parsed) {
            ignoredLines += 1
            return
          }
          if (parsed.kind !== 'page') {
            final ??= parsed
            return
          }
          // 只数整页收到的图：页序连续、没超上限、文件真实存在且不为空，才算一页。
          const file = path.join(outDir, parsed.file)
          const stat = deps.statFile(file)
          if (parsed.page !== startIndex + pages.length || pages.length >= maxPages || !stat || stat.size <= 0) {
            integrityError = true
            stopCurrent?.()
            return
          }
          pages.push({ index: parsed.page, file, bytes: stat.size })
          const notified = request.onPage?.(pages[pages.length - 1]!)
          if (notified) {
            void Promise.resolve(notified).catch(() => {
              warn('wia-runner: onPage callback failed')
            })
          }
        },
      },
      deps,
    )
    stopCurrent = job.stop
    if (abortRequested) job.stop()
    const exit = await job.done
    stopCurrent = undefined
    if (exit.forceKilled) forceKilled = true
    if (ignoredLines > 0) log(`wia-runner: ignored ${ignoredLines} non-protocol stdout line(s)`)
    return { pages, final, integrityError, exit }
  }

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = deps.clock.setTimeout(resolve, ms)
      wakeSleeper = () => {
        deps.clock.clearTimeout(timer)
        resolve()
      }
    })

  const finalize = (outcome: AttemptOutcome): WiaScanResult => {
    const { pages, final, exit } = outcome
    const result = (fields: Partial<WiaScanResult> & Pick<WiaScanResult, 'ok' | 'endedBy'>): WiaScanResult => ({
      pages,
      discardedPages: 0,
      forceKilled,
      stopUnconfirmed: exit.stopUnconfirmed,
      ...(exit.processId !== undefined ? { processId: exit.processId } : {}),
      attempts,
      setFailed: final?.setFailed ?? [],
      elapsedMs: deps.clock.now() - startedAt,
      ...fields,
    })
    const error = (errorCode: ScanDeviceErrorCode, hresult?: string): WiaScanResult =>
      result({ ok: false, endedBy: 'error', errorCode, hresult })
    const blockedByProperty = (): WiaScanResult | undefined => {
      const failed = requiredWiaPropertiesFailed(final?.setFailed ?? [])
      if (failed.length === 0) {
        const optional = (final?.setFailed ?? []).filter((id) => !failed.includes(id))
        if (optional.length > 0) log(`wia-runner: optional WIA property failed ids=${optional.join(',')}`)
        return undefined
      }
      warn(`wia-runner: required WIA property failed ids=${failed.join(',')}`)
      return error('not_ready')
    }

    if (abortRequested) return result({ ok: false, endedBy: 'aborted' })
    if (exit.timedOut) return error('timeout')
    if (exit.spawnFailed || outcome.integrityError || !final) return error('unknown')

    if (final.kind === 'done') {
      if (final.probe || final.pages !== pages.length) return error('unknown')
      if (final.canceled) return result({ ok: false, endedBy: 'canceled' })
      if (pages.length === 0) return error('unknown')
      const blocked = blockedByProperty()
      if (blocked) return blocked
      return result({ ok: true, endedBy: request.source === 'flatbed' ? 'single_page' : 'page_limit' })
    }

    // 脚本报了失败
    if (final.stage === 'device_not_found') return error('not_ready')
    const hresult = final.hresult
    if (hresult === WIA_HRESULT.PAPER_EMPTY) {
      if (request.source !== 'feeder') return error('unknown', hresult)
      // 首页就无纸 = 没放纸；已有 ≥1 页后无纸 = 进纸器扫空了，正常结束。
      if (pages.length === 0) return error('feeder_empty', hresult)
      const blocked = blockedByProperty()
      if (blocked) return blocked
      return result({ ok: true, endedBy: 'feeder_emptied' })
    }
    if (hresult === WIA_HRESULT.PAPER_JAM) {
      // 页文件留在任务目录里。调用方用 SCAN_DEVICE_FAILED 整目录清理并写审计。
      return error('paper_jam', hresult)
    }
    return error(mapWiaHresult(hresult), hresult)
  }

  const result = (async (): Promise<WiaScanResult> => {
    try {
      deps.removeFile(cancelFlag) // 清掉上一次遗留的取消标记，免得一开始就被叫停
    } catch {
      // 目录里本来就没有
    }
    let outcome = await attempt()
    // 预热中：首页都还没出时，等 10 秒自动重试一次；再失败才报 warming_up。
    if (
      !abortRequested &&
      !outcome.exit.timedOut &&
      !outcome.integrityError &&
      outcome.pages.length === 0 &&
      outcome.final?.kind === 'failed' &&
      mapWiaHresult(outcome.final.hresult) === 'warming_up'
    ) {
      log('wia-runner: scanner is warming up; retrying once after delay')
      await sleep(WIA_WARMING_UP_RETRY_DELAY_MS)
      wakeSleeper = undefined
      if (!abortRequested) {
        await request.beforeRetry?.()
        if (!abortRequested) outcome = await attempt()
      }
    }
    const finalResult = finalize(outcome)
    log(
      `wia-runner: scan finished ok=${finalResult.ok} ended=${finalResult.endedBy} pages=${finalResult.pages.length} ` +
        `attempts=${finalResult.attempts} forceKilled=${finalResult.forceKilled} stopUnconfirmed=${finalResult.stopUnconfirmed} elapsedMs=${finalResult.elapsedMs}` +
        `${finalResult.errorCode ? ` code=${finalResult.errorCode}` : ''}${finalResult.hresult ? ` hresult=${finalResult.hresult}` : ''}`,
    )
    return finalResult
  })().finally(deskew.cleanup)

  return {
    abort: () => {
      if (abortRequested) return
      abortRequested = true
      stopCurrent?.()
      wakeSleeper?.()
    },
    result,
  }
}
