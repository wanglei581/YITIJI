/**
 * agent/scan-device/wia-runner.ts — 起 PowerShell 跑 WIA 扫描：逐行解析、超时、取消、强杀、结果归一
 *
 * 分层：
 *   runJob()         通用：起进程 → 逐行喂给 onLine → 空闲 / 总超时 → 软停（写取消标记）→
 *                    宽限期后 taskkill /T /F → 进程结束或强杀后兜底放行。
 *   startWiaScan()   扫描：脚本参数、逐页核实、HRESULT → 对外错误码、预热重试、卡纸删页。
 *   runWiaProbe()    探测：只连一次扫描仪，回 ready / busy / not_found / error。
 *   composeScanPdf() 合 PDF：A4 等比适配，按页数与字节数上限，不二次压缩。
 *
 * 本批（A1）只提供底座和单测：不拿设备锁（A2 在外层拿）、不碰心跳 / 本机 HTTP / task-runner，
 * 没有任何调用方。所有外部依赖（起进程、时钟、强杀、文件）都可注入，Mac 上用假执行器测。
 *
 * 日志只写计数、错误码、HRESULT 和毫秒数，不写路径、不写文件名。
 */

import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import fs from 'fs'
import path from 'path'
import { log, warn } from '../../logger'
import { ImagesToPdfError, imagesToPdf } from '../../printer/image-to-pdf'
import {
  LineBuffer,
  SCAN_MAX_PAGES_DEFAULT,
  WIA_HRESULT,
  WiaParamError,
  buildWiaPowerShellArgs,
  buildWiaProbeScript,
  buildWiaScanScript,
  encodeWiaCommand,
  mapWiaHresult,
  parseWiaLine,
  resolvePowerShellPath,
  type ScanDeviceErrorCode,
  type WiaColor,
  type WiaLine,
  type WiaSource,
} from './wia-script'
import {
  SCAN_PAGE_FILE_PATTERN,
  assertScanTaskDir,
  getScanDeviceRoot,
  scanCancelFlagPath,
  scanResultPdfPath,
} from './scan-temp-dir'

export const WIA_ABORT_GRACE_MS = 45_000
export const WIA_FORCE_KILL_WAIT_MS = 10_000
export const WIA_WARMING_UP_RETRY_DELAY_MS = 10_000
export const WIA_IDLE_TIMEOUT_MS = 120_000
export const WIA_TOTAL_TIMEOUT_MS = 12 * 60_000
export const WIA_PROBE_TIMEOUT_MS = 20_000
/** 后端 deliver 单文件上限 20 MiB，留出 multipart 开销，合成后超过 18 MiB 直接报 too_large。 */
export const SCAN_PDF_MAX_BYTES = 18 * 1024 * 1024

// ── 可注入的外部依赖 ──────────────────────────────────────────────────────

export interface RunnerClock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface WiaRunnerDeps {
  spawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcess
  killProcessTree(pid: number): Promise<void>
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

// ── 通用：起进程并盯住它 ───────────────────────────────────────────────────

interface JobSpec {
  args: string[]
  idleTimeoutMs: number
  totalTimeoutMs: number
  /** 软停：写取消标记。没有就不等宽限期，直接强杀。 */
  softStop?: () => void
  graceMs: number
  onLine(line: string): void
}

interface JobExit {
  timedOut: boolean
  stopRequested: boolean
  forceKilled: boolean
  spawnFailed: boolean
  exitCode: number | null
}

interface JobHandle {
  stop(): void
  done: Promise<JobExit>
}

function runJob(spec: JobSpec, deps: WiaRunnerDeps): JobHandle {
  let closed = false
  let stopRequested = false
  let timedOut = false
  let forceKilled = false
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
    resolveDone({ timedOut, stopRequested, forceKilled, spawnFailed, exitCode })
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
      warn(`wia-runner: process still running ${spec.softStop ? `after ${spec.graceMs}ms grace` : 'after stop request'}; force-killing process tree`)
      if (child.pid !== undefined) deps.killProcessTree(child.pid).catch(() => undefined)
      timers.guard = deps.clock.setTimeout(() => {
        if (closed) return
        warn('wia-runner: process did not exit after force kill; giving up waiting')
        finish(null)
      }, WIA_FORCE_KILL_WAIT_MS)
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
  /** 本次运行整页收到并核实过的图，按页序。卡纸时已删除并清空。 */
  pages: WiaScannedPage[]
  errorCode?: ScanDeviceErrorCode
  hresult?: string
  /** 因卡纸而删除的页数。 */
  discardedPages: number
  /** 是否对 PowerShell 进程树用过 taskkill /T /F。A2 据此决定下次开始前先探测。 */
  forceKilled: boolean
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
  const args = buildWiaPowerShellArgs(encodeWiaCommand(script))

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

  const discard = (pages: WiaScannedPage[]): void => {
    for (const page of pages) {
      try {
        deps.removeFile(page.file)
      } catch {
        warn('wia-runner: could not delete a discarded scan page; the task directory purge will retry')
      }
    }
  }

  const finalize = (outcome: AttemptOutcome): WiaScanResult => {
    const { pages, final, exit } = outcome
    const result = (fields: Partial<WiaScanResult> & Pick<WiaScanResult, 'ok' | 'endedBy'>): WiaScanResult => ({
      pages,
      discardedPages: 0,
      forceKilled,
      attempts,
      setFailed: final?.setFailed ?? [],
      elapsedMs: deps.clock.now() - startedAt,
      ...fields,
    })
    const error = (errorCode: ScanDeviceErrorCode, hresult?: string): WiaScanResult =>
      result({ ok: false, endedBy: 'error', errorCode, hresult })

    if (abortRequested) return result({ ok: false, endedBy: 'aborted' })
    if (exit.timedOut) return error('timeout')
    if (exit.spawnFailed || outcome.integrityError || !final) return error('unknown')

    if (final.kind === 'done') {
      if (final.probe || final.pages !== pages.length) return error('unknown')
      if (final.canceled) return result({ ok: false, endedBy: 'canceled' })
      if (pages.length === 0) return error('unknown')
      return result({ ok: true, endedBy: request.source === 'flatbed' ? 'single_page' : 'page_limit' })
    }

    // 脚本报了失败
    if (final.stage === 'device_not_found') return error('not_ready')
    const hresult = final.hresult
    if (hresult === WIA_HRESULT.PAPER_EMPTY) {
      if (request.source !== 'feeder') return error('unknown', hresult)
      // 首页就无纸 = 没放纸；已有 ≥1 页后无纸 = 进纸器扫空了，正常结束。
      if (pages.length === 0) return error('feeder_empty', hresult)
      return result({ ok: true, endedBy: 'feeder_emptied' })
    }
    if (hresult === WIA_HRESULT.PAPER_JAM) {
      // 一期不做「只交已扫部分」：卡纸时已扫的页全部删除，用户重来。
      const discarded = pages.length
      discard(pages)
      return {
        ...error('paper_jam', hresult),
        pages: [],
        discardedPages: discarded,
      }
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
      if (!abortRequested) outcome = await attempt()
    }
    const finalResult = finalize(outcome)
    log(
      `wia-runner: scan finished ok=${finalResult.ok} ended=${finalResult.endedBy} pages=${finalResult.pages.length} ` +
        `attempts=${finalResult.attempts} forceKilled=${finalResult.forceKilled} elapsedMs=${finalResult.elapsedMs}` +
        `${finalResult.errorCode ? ` code=${finalResult.errorCode}` : ''}${finalResult.hresult ? ` hresult=${finalResult.hresult}` : ''}`,
    )
    return finalResult
  })()

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

// ── 探测 ─────────────────────────────────────────────────────────────────

export interface WiaProbeResult {
  state: 'ready' | 'busy' | 'not_found' | 'error'
  hresult?: string
  forceKilled: boolean
  elapsedMs: number
}

/** 即时连一次扫描仪：不设属性、不扫描、不写文件。调用方负责先拿设备锁。 */
export async function runWiaProbe(
  options: { deviceName?: string; timeoutMs?: number } = {},
  overrides: Partial<WiaRunnerDeps> = {},
): Promise<WiaProbeResult> {
  const deps: WiaRunnerDeps = { ...createDefaultWiaRunnerDeps(), ...overrides }
  const args = buildWiaPowerShellArgs(encodeWiaCommand(buildWiaProbeScript(options.deviceName ?? '')))
  const startedAt = deps.clock.now()
  let final: Extract<WiaLine, { kind: 'done' | 'failed' }> | undefined
  const timeoutMs = options.timeoutMs ?? WIA_PROBE_TIMEOUT_MS
  const job = runJob(
    {
      args,
      idleTimeoutMs: timeoutMs,
      totalTimeoutMs: timeoutMs,
      graceMs: 0,
      onLine: (line) => {
        const parsed = parseWiaLine(line)
        if (parsed && parsed.kind !== 'page') final ??= parsed
      },
    },
    deps,
  )
  const exit = await job.done
  const base = { forceKilled: exit.forceKilled, elapsedMs: deps.clock.now() - startedAt }
  let probe: WiaProbeResult
  if (exit.timedOut || exit.spawnFailed || !final) {
    probe = { state: 'error', ...base }
  } else if (final.kind === 'done') {
    probe = { state: final.probe ? 'ready' : 'error', ...base }
  } else if (final.stage === 'device_not_found') {
    probe = { state: 'not_found', ...base }
  } else {
    probe = { state: final.hresult === WIA_HRESULT.BUSY ? 'busy' : 'error', hresult: final.hresult, ...base }
  }
  log(`wia-runner: probe state=${probe.state}${probe.hresult ? ` hresult=${probe.hresult}` : ''} forceKilled=${probe.forceKilled} elapsedMs=${probe.elapsedMs}`)
  return probe
}

// ── 合 PDF ───────────────────────────────────────────────────────────────

export type ComposeScanPdfResult =
  | { ok: true; path: string; pageCount: number; bytes: number }
  | { ok: false; errorCode: Extract<ScanDeviceErrorCode, 'too_large' | 'unknown'>; reason: string }

/**
 * 把一个任务目录里的扫描页合成 <taskDir>\scan.pdf：A4、等比适配、页序同输入。
 * 页数超过上限（默认 20）或合成后超过 18 MiB 都报 too_large，不做二次压缩，不留半成品。
 * 输入必须恰好是该任务目录下的 page-NNN.jpg，其它文件一律拒绝，免得把别处的文件塞进 PDF。
 */
export async function composeScanPdf(
  taskDir: string,
  pageFiles: readonly string[],
  options: { maxPages?: number; maxBytes?: number; root?: string } = {},
): Promise<ComposeScanPdfResult> {
  try {
    const dir = path.resolve(taskDir)
    assertScanTaskDir(dir, options.root ?? getScanDeviceRoot())
    for (const file of pageFiles) {
      const resolved = path.resolve(file)
      if (path.dirname(resolved) !== dir || !SCAN_PAGE_FILE_PATTERN.test(path.basename(resolved))) {
        return { ok: false, errorCode: 'unknown', reason: 'page_outside_task_dir' }
      }
    }
    const output = await imagesToPdf(pageFiles, {
      outputPath: scanResultPdfPath(dir),
      scale: 'fit',
      maxPages: options.maxPages ?? SCAN_MAX_PAGES_DEFAULT,
      maxBytes: options.maxBytes ?? SCAN_PDF_MAX_BYTES,
    })
    return { ok: true, ...output }
  } catch (error) {
    if (error instanceof ImagesToPdfError) {
      // 页数太多与体积太大，屏上都是同一句「页数太多，请分两次扫」。
      const tooLarge = error.code === 'too_large' || error.code === 'too_many_pages'
      return { ok: false, errorCode: tooLarge ? 'too_large' : 'unknown', reason: error.code }
    }
    return { ok: false, errorCode: 'unknown', reason: 'unexpected' }
  }
}
