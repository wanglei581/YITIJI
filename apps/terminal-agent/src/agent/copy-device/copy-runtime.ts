import { globalDeviceLock } from '../device-lock'
import type { AgentConfig } from '../types'
import { composeScanPdf } from '../scan-device/scan-pdf-compose'
import { startWiaScan } from '../scan-device/wia-runner'
import { runWiaProbe } from '../scan-device/wia-probe'
import { sharedScanDeviceHealth, defaultListResidualProcesses, defaultScanProcessAlive } from '../scan-device/scan-device-health'
import { commandLineIsOurWiaProcess } from '../scan-device/wia-script'
import { copyBackend } from './copy-backend'
import { createCopyPrintLedger, printRecordView } from './copy-print-ledger'
import { createCopyPrint } from './copy-print'
import { createCopyEngine } from './copy-engine'
import { copyDirId, createCopyStorage, getCopyDeviceRoot } from './copy-storage'
import { CopyError, copyView, type CopyAction, type CopyCommand, type CopyDeps,
  type CopyDeletionReason, type CopyRuntime, type CopySession, type CopyView } from './copy-types'

export const COPY_SESSION_TTL_MS = 180_000

export function createCopyRuntime(config: AgentConfig, overrides: Partial<CopyDeps> = {}): CopyRuntime {
  const deps: CopyDeps = {
    config, clock: { now: Date.now, setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) },
    lock: globalDeviceLock, root: getCopyDeviceRoot(), tempHooks: {}, startScan: startWiaScan,
    compose: composeScanPdf, runProbe: runWiaProbe, ...copyBackend(config),
    processGone: (pid) => {
      if (pid !== undefined) return !defaultScanProcessAlive(pid)
      const list = defaultListResidualProcesses()
      return list.kind === 'ok' && !list.processes.some((p) => commandLineIsOurWiaProcess(p.commandLine))
    }, ...overrides,
  }
  const storage = createCopyStorage(deps)
  const health = sharedScanDeviceHealth({ clock: deps.clock, lock: deps.lock,
    runProbe: deps.runProbe, deviceName: () => config.scanDeviceName ?? '', getPhase: () => 'idle',
    isProcessAlive: (pid) => !deps.processGone(pid),
    listResiduals: () => deps.processGone() ? { kind: 'ok', processes: [] } : { kind: 'unknown' },
  })
  const engine = createCopyEngine(deps, storage, health)
  const ledger = createCopyPrintLedger(deps, copyDirId)
  const printing = createCopyPrint(deps, storage, ledger)
  const recoveredDirs = new Set<string>()
  // sweep 会跳过仍在隔离中的复印材料，后续 tick 继续删除。
  const sessions = new Map<string, CopySession>()
  const operations = new Map<string, { fingerprint: string; result: Promise<CopyView> }>()
  let active: CopySession | undefined
  let stopped = false
  let startupSafe = false
  let timer: unknown
  const key = (c: CopyCommand) => `${c.copyId}:${c.generation}`
  const cleanup = (s: CopySession): void => {
    if (s.work || !s.cleanupReason || s.purged === true) return
    if (s.printReaderPending) { s.purged = false; return }
    if (s.stopUnconfirmed) {
      if ((s.suspectPid === undefined && health.unidentifiedSuspect()) || !deps.processGone(s.suspectPid)) { s.purged = false; return }
      s.stopUnconfirmed = false
    }
    s.purged = storage.purge(s.dirId, s.cleanupReason)
  }
  const revoke = (s: CopySession, reason: CopyDeletionReason, state: CopyView['state']): void => {
    s.revoked = true
    if (!s.printDispatched) s.state = state
    s.cleanupReason ??= reason
    s.handle?.abort()
    cleanup(s)
  }
  const tick = async (): Promise<void> => {
    if (!startupSafe) {
      try { storage.sweep(ledger.hasDir, (id) => {
        if (!ledger.pendingDir(id)) return false
        recoveredDirs.add(id); return true
      }); startupSafe = true } catch { /* 隔离复印；其它功能继续运行。 */ }
    }
    for (const s of sessions.values()) {
      if (!s.revoked && deps.clock.now() >= s.expiresAt) revoke(s, 'COPY_EXPIRED', 'expired')
      if (!s.revoked && config.copyDeviceEnabled !== true) revoke(s, 'COPY_SESSION_CLEAR', 'cleared')
      if (s.revoked) {
        if (s.stopUnconfirmed && deps.processGone(s.suspectPid) && health.hasSuspect()) await health.probe()
        cleanup(s)
      }
    }
    await ledger.retryCleanup()
    // 重启时保留的材料在执行器退出、队列清理后再交给同一删除重试。
    for (const id of recoveredDirs) if (!ledger.pendingDir(id)) {
      if (storage.purge(id, 'COPY_PRINT_TERMINAL')) recoveredDirs.delete(id)
    }
    storage.retry()
    await ledger.retry().catch(() => { /* 耐久回报失败不会改变终态。 */ })
  }
  const launch = (s: CopySession, work: () => Promise<void>): void => {
    s.work = Promise.resolve().then(work).catch((error: unknown) => {
      if (!s.revoked) {
        s.errorCode = error instanceof CopyError ? error.code : 'unknown'
        revoke(s, deps.clock.now() >= s.expiresAt ? 'COPY_EXPIRED' : 'COPY_SCAN_FAILED',
          deps.clock.now() >= s.expiresAt ? 'expired' : 'failed')
      }
    }).finally(() => { s.work = undefined; if (s.revoked) cleanup(s) })
  }
  const requireSession = (c: CopyCommand, owner: string): CopySession => {
    const s = sessions.get(key(c))
    if (!s || s.owner !== owner) throw new CopyError(404, 'COPY_NOT_FOUND')
    return s
  }
  const mutate = async (action: CopyAction, c: CopyCommand, owner: string): Promise<CopyView> => {
    if (action === 'start') {
      if (ledger.get(c.copyId, c.generation)) throw new CopyError(409, 'COPY_ALREADY_DISPATCHED')
      if (!c.source || !c.scanColor) throw new CopyError(400, 'COPY_BAD_REQUEST')
      if (sessions.has(key(c))) throw new CopyError(409, 'COPY_STATE_CONFLICT')
      const prior = [...sessions.values()].filter((s) => s.command.copyId === c.copyId)
      if (prior.some((s) => s.command.generation >= c.generation || s.owner !== owner)) throw new CopyError(409, 'COPY_STATE_CONFLICT')
      const old = active && !active.revoked ? active : undefined
      if (old && (old.command.copyId !== c.copyId || old.owner !== owner)) throw new CopyError(409, 'COPY_STATE_CONFLICT')
      const s: CopySession = { command: { ...c }, owner, dirId: copyDirId(c.copyId, c.generation), dir: '',
        state: 'starting', errorCode: null, pages: [], expiresAt: deps.clock.now() + COPY_SESSION_TTL_MS,
        revoked: false, byteBudget: 0, pageCap: 0 }
      // 首次异步等待前先占下新代，clear/abort 可立即撤权，不会等旧代删完后迟开扫描。
      active = s
      sessions.set(key(c), s)
      if (old) revoke(old, 'COPY_RESCAN', 'cleared')
      launch(s, async () => {
        if (old) {
          await old.work
          cleanup(old)
          if (!old.purged) throw new CopyError(503, 'COPY_CLEANUP_FAILED')
        }
        await engine.scan(s)
      })
      return copyView(s)
    }
    const s = requireSession(c, owner)
    if (action === 'print') {
      if (s.printRequested || ledger.get(c.copyId, c.generation)) return copyView(s)
      if (s.revoked || s.state !== 'scanned' || s.work || !s.pdfReady) throw new CopyError(409, 'COPY_STATE_CONFLICT')
      if (!ledger.isSafe()) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
      s.printRequested = true
      s.state = 'printing'
      s.expiresAt = deps.clock.now() + COPY_SESSION_TTL_MS
      launch(s, () => printing.run(s))
      return copyView(s)
    }
    if (action === 'abort' || action === 'clear') {
      revoke(s, action === 'abort' ? 'COPY_USER_CANCEL' : 'COPY_SESSION_CLEAR', action === 'abort' ? 'cancelled' : 'cleared')
      if (s.printRequested && s.work) return { ...copyView(s), purged: false }
      await s.work
      cleanup(s)
      if (!s.purged && !s.stopUnconfirmed) throw new CopyError(503, 'COPY_CLEANUP_FAILED', copyView(s))
      return copyView(s)
    }
    if (s.revoked) throw new CopyError(410, 'COPY_EXPIRED', copyView(s))
    if (s.state !== 'page_ready' || s.work) throw new CopyError(409, 'COPY_STATE_CONFLICT')
    if (action === 'next-page') {
      if (s.command.source !== 'flatbed' || s.pdfReady) throw new CopyError(409, 'COPY_STATE_CONFLICT')
      s.expiresAt = deps.clock.now() + COPY_SESSION_TTL_MS
      s.state = 'starting'
      launch(s, () => engine.scan(s))
    } else if (action === 'finish') {
      s.expiresAt = deps.clock.now() + COPY_SESSION_TTL_MS
      s.state = 'composing'
      launch(s, () => engine.finish(s))
    } else throw new CopyError(400, 'COPY_BAD_REQUEST')
    return copyView(s)
  }
  const command: CopyRuntime['command'] = async (action, c, owner) => {
    await tick()
    if (stopped || config.copyDeviceEnabled !== true) throw new CopyError(403, 'COPY_DISABLED')
    if (!startupSafe) throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
    const recovered = ledger.get(c.copyId, c.generation)
    if (recovered && !sessions.has(key(c)) && ['status', 'print', 'clear', 'abort'].includes(action)) {
      if (recovered.owner !== owner || recovered.terminalId !== config.terminalId) throw new CopyError(404, 'COPY_NOT_FOUND')
      return { ...printRecordView(recovered), purged: !recovered.queueCleanupPending && storage.purge(copyDirId(c.copyId, c.generation), 'COPY_PRINT_TERMINAL') }
    }
    if (action === 'status' || action === 'preview') {
      const s = requireSession(c, owner)
      if (action === 'status') return copyView(s)
      if (s.revoked || !['page_ready', 'scanned'].includes(s.state)) throw new CopyError(410, 'COPY_EXPIRED')
      const bytes = storage.read(s, c.page!)
      s.expiresAt = deps.clock.now() + COPY_SESSION_TTL_MS
      return bytes
    }
    const opKey = `${owner}:${c.operationId}`
    const fingerprint = JSON.stringify([action, c.copyId, c.generation, c.source, c.scanColor])
    const previous = operations.get(opKey)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new CopyError(409, 'COPY_OPERATION_CONFLICT')
      if (action === 'print') return copyView(requireSession(c, owner))
      return previous.result
    }
    if (operations.size >= 4096) throw new CopyError(503, 'COPY_OPERATION_LIMIT')
    const result = mutate(action, c, owner)
    operations.set(opKey, { fingerprint, result })
    return result
  }
  void tick()
  const arm = (): void => {
    timer = deps.clock.setTimeout(() => {
      void tick().finally(() => { if (!stopped) arm() })
    }, 1000)
    ;(timer as NodeJS.Timeout | undefined)?.unref?.()
  }
  arm()
  return { command, tick,
    whenIdle: async () => { await Promise.all([...sessions.values()].map((s) => s.work)); await ledger.retry() },
    stop: () => {
      stopped = true
      deps.clock.clearTimeout(timer)
      for (const s of sessions.values()) if (!s.revoked) revoke(s, 'COPY_SESSION_CLEAR', 'cleared')
    },
  }
}
