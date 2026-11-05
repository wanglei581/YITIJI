import path from 'path'
import { DeviceLockTimeoutError, type DeviceLockHandle } from '../device-lock'
import { resolveScanDeviceLimits, scanPagesAligned } from '../scan-device/scan-device-types'
import { scanPageFileName } from '../scan-device/scan-temp-dir'
import type { ScanDeviceHealth } from '../scan-device/scan-device-health'
import type { WiaScannedPage } from '../scan-device/wia-runner'
import { assertCopyPermit } from './copy-backend'
import { CopyError, type CopyDeps, type CopySession } from './copy-types'
import type { createCopyStorage } from './copy-storage'

export function createCopyEngine(deps: CopyDeps, storage: ReturnType<typeof createCopyStorage>, health: ScanDeviceHealth,
  assertNotRevoked: (s: CopySession) => void) {
  const checkHealth = async (lock: DeviceLockHandle): Promise<void> => {
    if (health.knownProcessAlive()) throw new CopyError(503, 'COPY_PROCESS_STOP_UNCONFIRMED')
    if (!health.hasSuspect() && !health.hasForceKilled()) return
    const probed = await health.probe({ heldLock: lock })
    if (health.hasSuspect()) throw new CopyError(503, 'COPY_PROCESS_STOP_UNCONFIRMED')
    if (probed.health !== 'ready') throw new CopyError(503, 'COPY_DEVICE_UNAVAILABLE')
    health.clearForceKilled()
  }
  const live = (s: CopySession): void => {
    assertNotRevoked(s)
    if (s.revoked || deps.clock.now() >= s.expiresAt) throw new CopyError(410, 'COPY_EXPIRED')
    if (deps.config.copyDeviceEnabled !== true) throw new CopyError(403, 'COPY_CAPABILITY_REVOKED')
  }
  const finish = async (s: CopySession): Promise<void> => {
    live(s)
    if (!scanPagesAligned(s.pages.length, s.pages)) throw new CopyError(409, 'COPY_STATE_CONFLICT')
    s.state = 'composing'
    if (!s.pdfReady) {
      storage.prepareCompose(s)
      const composed = await deps.compose(s.dir, s.pages.map((p) => p.file), {
        root: deps.root, maxPages: s.pageCap,
      })
      live(s)
      if (!composed.ok) throw new CopyError(503, composed.errorCode)
      s.pdfReady = true
    }
    try {
      await deps.report(s.command.copyId, s.command.generation, s.pages.length)
    } catch {
      live(s)
      // 丢回报不能假称已收下。保留本机材料，finish 新操作只重报同代同页数。
      s.state = 'page_ready'
      s.errorCode = 'COPY_SCAN_RESULT_UNCONFIRMED'
      return
    }
    live(s)
    s.errorCode = null
    s.state = 'scanned'
  }
  const scan = async (s: CopySession): Promise<void> => {
    let lock
    try { lock = await deps.lock.acquire('copy-scan') } catch (error) {
      if (error instanceof DeviceLockTimeoutError) throw new CopyError(423, 'COPY_DEVICE_BUSY')
      throw error
    }
    try {
      live(s)
      const terminalId = deps.config.terminalId
      const requestedAt = deps.clock.now()
      const permit = await deps.permit(s.command.copyId)
      live(s)
      if (terminalId !== deps.config.terminalId) throw new CopyError(403, 'COPY_UNAUTHORIZED')
      assertCopyPermit(permit, s, deps.config, requestedAt, deps.clock.now())
      const limits = resolveScanDeviceLimits(deps.config.scanDeviceMaxPages ?? 20, { maxPages: permit.parameters.maxPages })
      s.pageCap = limits.pageCap
      s.byteBudget = limits.byteBudget
      if (s.pages.length >= s.pageCap) throw new CopyError(413, 'too_large')
      await checkHealth(lock)
      live(s)
      // 探测可能耗时，真正起 WIA 前再核验本次短许可。
      assertCopyPermit(permit, s, deps.config, requestedAt, deps.clock.now())
      s.permit = permit
      s.dir = storage.create(s.dirId)
      const first = s.pages.length + 1
      let invalid = false
      const accept = (page: WiaScannedPage): void => {
        if (s.revoked) return
        if (page.index !== s.pages.length + 1 || page.index > s.pageCap || page.bytes < 1 ||
          path.resolve(page.file) !== path.join(s.dir, scanPageFileName(page.index))) invalid = true
        else {
          s.pages.push(page)
          if (s.pages.reduce((sum, p) => sum + p.bytes, 0) > s.byteBudget) invalid = true
        }
        if (invalid) s.handle?.abort()
      }
      s.state = 'scanning'
      s.errorCode = null
      s.handle = deps.startScan({ source: s.command.source!, color: s.command.scanColor!,
        deviceName: deps.config.scanDeviceName || undefined, outDir: s.dir,
        startIndex: first, maxPages: s.command.source === 'flatbed' ? 1 : s.pageCap - first + 1,
        onPage: accept,
        beforeRetry: async () => {
          live(s)
          await checkHealth(lock)
          live(s)
          const retryAt = deps.clock.now()
          const retryPermit = await deps.permit(s.command.copyId)
          live(s)
          if (terminalId !== deps.config.terminalId) throw new CopyError(403, 'COPY_UNAUTHORIZED')
          assertCopyPermit(retryPermit, s, deps.config, retryAt, deps.clock.now())
          s.permit = retryPermit
        },
      }, { root: deps.root })
      if (invalid || s.revoked) s.handle.abort()
      const result = await s.handle.result
      s.handle = undefined
      if (result.forceKilled) health.noteForceKilled()
      if (result.stopUnconfirmed) {
        health.noteProcessStop(result)
        s.stopUnconfirmed = true
        s.suspectPid = result.processId
        throw new CopyError(503, 'COPY_PROCESS_STOP_UNCONFIRMED')
      }
      live(s)
      if (invalid) throw new CopyError(413, 'too_large')
      if (!result.ok) throw new CopyError(503, result.errorCode ?? 'unknown')
      const batch = s.pages.slice(first - 1)
      if (!batch.length || result.pages.length !== batch.length || result.pages.some((p, i) =>
        p.index !== batch[i]?.index || p.file !== batch[i]?.file || p.bytes !== batch[i]?.bytes)) {
        throw new CopyError(503, 'unknown')
      }
      s.state = 'page_ready'
    } finally {
      lock.release()
    }
    // 等用户核对和本机合成均不占扫描仪。进纸器自动收尾，绝不进入 A2 投递。
    if (s.command.source === 'feeder') await finish(s)
  }
  return { scan, finish }
}
