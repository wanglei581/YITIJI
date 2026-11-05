import fs from 'fs'
import path from 'path'
import { DeviceLockTimeoutError } from '../device-lock'
import { printTempFileName } from '../print-correlation'
import { printLocalDocument } from '../print-local-document'
import { CopyError, type CopyDeps, type CopyPermit, type CopySession } from './copy-types'
import type { createCopyPrintLedger } from './copy-print-ledger'
import type { createCopyStorage } from './copy-storage'

/** C1 confirm 会将扫描时的 authorizationVersion 加一，页数则必须等于本机完整实扫页数。 */
export function assertCopyPrintPermit(p: CopyPermit, s: CopySession, deps: CopyDeps, requestedAt: number): void {
  const v = p?.parameters
  const prior = s.permit
  const expiry = Date.parse(p?.expiresAt)
  const now = deps.clock.now()
  if (p?.allowed !== true) throw new CopyError(403,
    p?.reason === 'COPY_ALREADY_DISPATCHED' ? 'COPY_ALREADY_DISPATCHED' : 'COPY_UNAUTHORIZED')
  if (!deps.config.terminalId || p.copyId !== s.command.copyId || p.generation !== s.command.generation ||
    p.op !== 'print' || (p.terminalId !== undefined && p.terminalId !== deps.config.terminalId) ||
    !Number.isFinite(expiry) || expiry <= now || expiry > now + 30_000 || now - requestedAt > 30_000 ||
    !prior || !Number.isSafeInteger(p.authorizationVersion) || p.authorizationVersion !== prior.authorizationVersion + 1 ||
    !v || v.pageCount !== s.pages.length || v.pageCount < 1 ||
    JSON.stringify({ ...v, pageCount: 0 }) !== JSON.stringify(prior.parameters) ||
    // 未取得逐份分页真机证据前拒绝奇数页、多份双面的组合。
    (v.duplex !== 'simplex' && v.pageCount % 2 === 1 && v.copies > 1)) {
    throw new CopyError(403, 'COPY_UNAUTHORIZED')
  }
}
export function createCopyPrint(deps: CopyDeps, storage: ReturnType<typeof createCopyStorage>,
  ledger: ReturnType<typeof createCopyPrintLedger>) {
  const live = (s: CopySession): void => {
    if (s.revoked || deps.clock.now() >= s.expiresAt) throw new CopyError(410, 'COPY_EXPIRED')
    if (deps.config.copyDeviceEnabled !== true) throw new CopyError(403, 'COPY_CAPABILITY_REVOKED')
  }
  const run = async (s: CopySession): Promise<void> => {
    let lock
    try {
      lock = await deps.lock.acquire('copy-print')
      live(s)
      const terminalId = deps.config.terminalId
      const requestedAt = deps.clock.now()
      const permit = await deps.permit(s.command.copyId, 'print')
      live(s)
      if (terminalId !== deps.config.terminalId) throw new CopyError(403, 'COPY_UNAUTHORIZED')
      assertCopyPrintPermit(permit, s, deps, requestedAt)
      storage.prepareCompose(s)
      const source = path.join(s.dir, 'scan.pdf')
      const stat = fs.lstatSync(source)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 5 || stat.size > s.byteBudget) {
        throw new CopyError(503, 'COPY_STORAGE_UNSAFE')
      }
      // 文档名符合现有队列相关性与开机/SID 残留清理约定，文件仍留在同一私有复印目录。
      const correlationId = `copy_${s.dirId}`
      const file = path.join(s.dir, printTempFileName(correlationId, 0, '.pdf'))
      fs.renameSync(source, file)
      ledger.begin(s) // durable dispatching: 驱动调用前、任何崩溃窗口均保留墓碑。
      s.printDispatched = true
      s.state = 'dispatching'
      const v = permit.parameters
      const result = await printLocalDocument({ file, correlationId, printerName: deps.config.printerName,
        pageCount: v.pageCount, holdEnabled: deps.config.holdPrinterQueueWhenIdle === true,
        params: { colorMode: v.colorMode, duplex: v.duplex, copies: v.copies, paperSize: 'A4', scale: 'fit' },
        beforeDispatch() {
          live(s)
          if (terminalId !== deps.config.terminalId) throw new CopyError(403, 'COPY_UNAUTHORIZED')
          assertCopyPrintPermit(permit, s, deps, requestedAt)
        },
        spooled() {
          // 写失败时 dispatching 仍耐久；继续监控能获得的真实证据，不触发驱动重试。
          try { ledger.update(s.command.copyId, s.command.generation, 'spooled') } catch { /* fail closed on next dispatch */ }
          s.state = 'spooled'
        },
        readerPending(pending) { s.printReaderPending = pending },
      }, deps.printDependencies)
      s.state = result.state
      s.errorCode = result.errorCode ?? null
      s.revoked = true
      s.cleanupReason = 'COPY_PRINT_TERMINAL'
      try { ledger.update(s.command.copyId, s.command.generation, result.state, result.errorCode) } catch { /* 保留已观测终态；耐久意图阻止重打。 */ }
    } catch (error) {
      if (s.printDispatched) {
        s.state = 'unconfirmed'
        s.errorCode = 'PRINT_JOB_UNCONFIRMED'
        s.revoked = true
        s.cleanupReason = 'COPY_PRINT_TERMINAL'
        try { ledger.update(s.command.copyId, s.command.generation, 'unconfirmed', s.errorCode) } catch { /* 重启恢复意图 */ }
      } else if (!s.revoked) {
        s.state = 'scanned'
        s.errorCode = error instanceof DeviceLockTimeoutError ? 'COPY_DEVICE_BUSY' :
          error instanceof CopyError ? error.code : 'COPY_BACKEND_UNAVAILABLE'
        s.printRequested = false // 未取得许可且未调用驱动；新操作允许重新查询在线许可。
      }
    } finally { lock?.release() }
  }
  return { run }
}
