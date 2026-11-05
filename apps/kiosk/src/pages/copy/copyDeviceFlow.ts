import { cancelCopyJob, confirmCopyJob, getCopyJob, type CopyJobView } from '../../services/api/copyJobs'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { fetchCopyPreview, LocalCopyError, postLocalCopy, type LocalCopyView } from '../../services/copy/localCopyApi'
import { canConfirmCopy, copyPhaseFromLocal, validCopyJob, type CopyDevicePhase } from './copyCheckModel'
import { CopyPreview } from './copyPreview'
import { copyFault, copyPrintPhase, type CopyPrintStage } from './copyPrintModel'
import { clearCopySession, markCopyConfirmed, onCopySessionClear, type CopySession } from './copySession'

interface DeviceSnapshot {
  phase: CopyDevicePhase
  pages: number | null
  started: boolean
  busy: boolean
  job: CopyJobView | null
  notice: string | null
  errorCode: string | null
  printStage: CopyPrintStage
}
const initial = (): DeviceSnapshot => ({ phase: 'starting', pages: null, started: false, busy: false, job: null, notice: null, errorCode: null, printStage: 'received' })
const UNKNOWN = '状态未知。这一步的结果还没确认，请先停止操作，不要重新开始。'
let snapshot = initial()
let current: CopyDeviceFlow | null = null
const listeners = new Set<() => void>()
export const readCopyDevice = () => snapshot
export const subscribeCopyDevice = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const publish = (patch: Partial<DeviceSnapshot>) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener() }

/** 单会话执行器；重挂载、超时及重复确认都不能再次派发。 */
export class CopyDeviceFlow {
  readonly preview = new CopyPreview()
  private controller = new AbortController()
  private disposed = false
  private polling = false
  private revision = 0
  private timer: number | undefined
  private expiry: number | undefined
  private watchdog: number | undefined
  private progressAt = Date.now()
  private signature = ''
  private misses = 0
  private printOperationId = crypto.randomUUID()
  private printRequested = false
  private recovering = false
  private cancellation: Promise<CopyJobView> | null = null
  constructor(readonly session: CopySession) {}
  private live(signal = this.controller.signal) { return !this.disposed && !signal.aborted && current === this }
  private unknown(notice = UNKNOWN) {
    this.preview.clear()
    publish({ phase: 'unknown', busy: false, notice })
  }
  async start(): Promise<void> {
    this.expiry = window.setTimeout(() => this.expire(), Math.min(2_147_483_647, Math.max(0, Date.parse(this.session.expiresAt) - Date.now())))
    this.watchdog = window.setInterval(() => {
      if (this.live() && ['starting', 'scan', 'finishing'].includes(snapshot.phase) && Date.now() - this.progressAt >= 60_000) {
        this.controller.abort()
        this.unknown('状态未知。等太久还没收到新的扫描结果，请先停止操作，不要重新开始。')
      }
      if (this.live() && snapshot.phase === 'printing' && Date.now() - this.progressAt >= 60_000) void this.recoverPrint(this.controller.signal)
    }, 1000)
    await this.command('start')
    if (this.live()) this.schedule()
  }
  private expire() {
    if (!this.live()) return
    clearCopySession()
  }
  private schedule() {
    if (!this.live() || ['done', 'unconfirmed', 'error', 'off', 'stopped', 'unknown'].includes(snapshot.phase)) return
    this.timer = window.setTimeout(() => { void this.poll().finally(() => this.schedule()) }, 3000)
  }
  private async acceptLocal(view: LocalCopyView, signal: AbortSignal) {
    if (!this.live(signal)) return
    if (view.errorCode || view.state === 'failed') { this.deviceError(view.errorCode); return }
    if (['cancelled', 'cleared', 'expired'].includes(view.state)) { this.unknown(); return }
    const signature = `${view.state}:${view.pageCount}`
    if (signature !== this.signature) { this.signature = signature; this.progressAt = Date.now() }
    publish({ phase: copyPhaseFromLocal(view.state, this.session.input.source), pages: view.pageCount,
      started: view.state !== 'starting', notice: null })
    // 3f2a65fa7 的进纸器 scan() 自己 await finish()；page_ready 是它合成前的瞬态，不能再发一次 finish。
    if (view.state === 'scanned') await this.refreshQuote(signal)
  }
  private async poll() {
    if (this.polling || snapshot.busy || ['done', 'unconfirmed', 'error', 'off', 'stopped', 'unknown'].includes(snapshot.phase)) return
    this.polling = true
    const revision = this.revision
    const signal = this.controller.signal
    try {
      const view = await postLocalCopy('status', this.session, {}, signal)
      if (!this.live(signal) || revision !== this.revision) return
      this.misses = 0
      if (this.printRequested) { await this.acceptPrint(view, signal); return }
      if (view.errorCode || view.state === 'failed') { this.deviceError(view.errorCode); return }
      if (snapshot.phase === 'check') {
        if (view.state !== 'scanned' || view.errorCode || view.pageCount !== snapshot.job?.pageCount) this.unknown()
        return
      }
      await this.acceptLocal(view, signal)
    } catch (error) {
      if (this.live(signal) && revision === this.revision && !this.printRequested && error instanceof LocalCopyError) {
        this.deviceError(error.code); return
      }
      if (this.live(signal) && revision === this.revision && ++this.misses >= 2) {
        if (this.printRequested) await this.recoverPrint(signal)
        else this.unknown()
      }
    } finally { this.polling = false }
  }
  async command(action: 'start' | 'next-page' | 'finish'): Promise<void> {
    if (!this.live() || snapshot.busy) return
    if (action === 'next-page' && snapshot.phase !== 'more') return
    if (action === 'finish' && !['more', 'finishing'].includes(snapshot.phase)) return
    this.revision += 1
    publish({ busy: true, notice: null })
    const signal = this.controller.signal
    try {
      const extra = action === 'start' ? { source: this.session.input.source, scanColor: 'color' as const } : {}
      const view = await postLocalCopy(action, this.session, extra, signal)
      if (!this.live(signal)) return
      publish({ busy: false })
      await this.acceptLocal(view, signal)
    } catch (error) { if (this.live(signal)) {
      if (error instanceof LocalCopyError) this.deviceError(error.code)
      else this.unknown()
    } }
    finally { if (this.live(signal)) publish({ busy: false }) }
  }
  private async refreshQuote(signal: AbortSignal) {
    const job = await getCopyJob(this.session.copyId, this.session.controlToken!, null, signal)
    if (!this.live(signal)) return
    if (!validCopyJob(job, this.session) || job.state !== 'scanned' || job.pageCount !== snapshot.pages) { this.unknown(); return }
    publish({ job, phase: 'check', notice: null })
  }
  loadPreview(pages: number[]): Promise<string[]> {
    if (!this.live() || snapshot.phase !== 'check') return Promise.reject(new Error('COPY_PREVIEW_ABORTED'))
    return this.preview.load(pages, (page, signal) => fetchCopyPreview(this.session, page, signal))
  }
  async confirm(): Promise<void> {
    const job = snapshot.job
    if (!this.live() || snapshot.busy || snapshot.phase !== 'check' || !canConfirmCopy(job)) return
    this.revision += 1
    publish({ busy: true, notice: null })
    const signal = this.controller.signal
    try {
      const result = await confirmCopyJob(this.session.copyId, this.session.controlToken!, job!.quoteVersion!, signal)
      if (!this.live(signal)) return
      if (!validCopyJob(result, this.session) || result.state !== 'confirmed' || !result.orderId) { this.unknown(); return }
      this.preview.clear()
      publish({ phase: 'confirmed', job: result, notice: null })
      markCopyConfirmed(result)
      await this.print()
    } catch (error) {
      if (!this.live(signal)) return
      if (error instanceof ApiHttpError && error.code === 'COPY_QUOTE_CHANGED') {
        publish({ job: null })
        try {
          await this.refreshQuote(signal)
          if (this.live(signal) && snapshot.phase === 'check') publish({ notice: '报价已更新，请重新核对后再开始打印。' })
        } catch { if (this.live(signal)) this.unknown() }
      } else if (error instanceof ApiHttpError && ['COPY_PAID_NOT_SUPPORTED', 'COPY_ODD_DUPLEX_MULTICOPY_DISABLED'].includes(error.code ?? '')) {
        publish({ job: { ...job!, quoteError: error.code! }, notice: error.code === 'COPY_PAID_NOT_SUPPORTED' ? '这台机器暂不支持付费复印，请重扫或返回。' : '这次奇数页多份双面暂未开通，请返回修改设置。' })
      } else this.unknown()
    } finally { if (this.live(signal)) publish({ busy: false }) }
  }
  private deviceError(errorCode: string | null) {
    this.preview.clear()
    publish({ phase: !this.printRequested && copyFault(errorCode) === 'off' ? 'off' : 'error', errorCode, busy: false, notice: null })
  }
  private async acceptPrint(view: LocalCopyView, signal: AbortSignal) {
    if (!this.live(signal) || ['done', 'unconfirmed', 'error'].includes(snapshot.phase)) return
    const phase = view.errorCode && view.state !== 'unconfirmed' ? 'error' : copyPrintPhase(view.state)
    publish({ phase, printStage: 'handing', busy: false, errorCode: view.errorCode, notice: null })
    // 本机结果用于屏幕；云端订单仍只接受 GET 的真实回包，不能自己改写成成功。
    if (phase !== 'printing') {
      try {
        const job = await getCopyJob(this.session.copyId, this.session.controlToken!, null, signal)
        if (this.live(signal) && validCopyJob(job, this.session)) publish({ job })
      } catch { /* 不改变本机已明确给出的结果。 */ }
    }
  }
  private async recoverPrint(signal: AbortSignal) {
    if (!this.live(signal) || this.recovering || snapshot.phase !== 'printing') return
    this.recovering = true
    try {
      const job = await getCopyJob(this.session.copyId, this.session.controlToken!, null, signal)
      if (!this.live(signal) || snapshot.phase !== 'printing') return
      if (validCopyJob(job, this.session) && ['handed', 'unconfirmed', 'failed'].includes(job.state)) {
        publish({ job, phase: copyPrintPhase(job.state), busy: false, notice: null })
        return
      }
    } catch { /* 查询仍拿不准，保守结束，不重派。 */ }
    finally { this.recovering = false }
    if (this.live(signal) && snapshot.phase === 'printing') publish({ phase: 'unconfirmed', busy: false, notice: null })
  }
  async print(): Promise<void> {
    if (!this.live()) return
    if (this.printRequested) { await this.poll(); return }
    if (snapshot.phase !== 'confirmed') return
    this.printRequested = true
    this.revision += 1
    this.progressAt = Date.now()
    publish({ phase: 'printing', printStage: 'received', busy: false })
    const signal = this.controller.signal
    try {
      const view = await postLocalCopy('print', this.session, { operationId: this.printOperationId }, signal)
      await this.acceptPrint(view, signal)
    } catch { if (this.live(signal)) await this.recoverPrint(signal) }
  }
  async stop(): Promise<void> {
    if (this.disposed || this.printRequested || snapshot.busy || ['confirmed', 'stopped'].includes(snapshot.phase)) return
    this.revision += 1
    this.controller.abort()
    this.controller = new AbortController()
    this.preview.clear()
    publish({ busy: true })
    const signal = this.controller.signal
    const [local, cloud] = await Promise.allSettled([
      postLocalCopy('abort', this.session, {}, signal),
      this.cancelCloud(),
    ])
    if (!this.live(signal)) return
    if (local.status === 'fulfilled' && local.value.state === 'cancelled' && local.value.purged === true
      && cloud.status === 'fulfilled' && cloud.value.state === 'cancelled' && cloud.value.copyId === this.session.copyId
      && cloud.value.generation === this.session.generation && cloud.value.terminalId === this.session.input.terminalId) {
      publish({ phase: 'stopped', busy: false, job: null, notice: '已停止复印，已扫的页已从这台机器删除。' })
    } else this.unknown('状态未知。这次停止的结果还没确认，请不要重新开始。')
  }
  async clearForRescan(): Promise<boolean> {
    if (!this.live() || this.printRequested || snapshot.busy || !['check', 'error'].includes(snapshot.phase)) return false
    this.revision += 1
    publish({ busy: true })
    this.preview.clear()
    const signal = this.controller.signal
    const [local, cloud] = await Promise.allSettled([
      postLocalCopy('clear', this.session, {}, signal),
      this.cancelCloud(),
    ])
    if (!this.live(signal)) return false
    if (local.status === 'fulfilled' && local.value.state === 'cleared' && local.value.purged === true
      && cloud.status === 'fulfilled' && cloud.value.state === 'cancelled' && cloud.value.copyId === this.session.copyId
      && cloud.value.generation === this.session.generation && cloud.value.terminalId === this.session.input.terminalId) { publish({ busy: false }); return true }
    this.unknown('状态未知。旧扫描件的清理结果还没确认，请不要重扫。')
    return false
  }
  private cancelCloud(controlToken = this.session.controlToken!): Promise<CopyJobView> {
    // 停止、重扫和离场共用同一次请求；不受前台中止影响，成功后也不重复撤销。
    return this.cancellation ??= cancelCopyJob(this.session.copyId, controlToken, this.session.generation)
      .then((job) => {
        if (job.state !== 'cancelled' || job.copyId !== this.session.copyId || job.generation !== this.session.generation
          || job.terminalId !== this.session.input.terminalId) throw new Error('COPY_CANCEL_UNKNOWN')
        return job
      }).catch((error) => { this.cancellation = null; throw error })
  }
  private async cancelAfterDispose(controlToken: string): Promise<void> {
    // 仅闭包保留撤销所需凭证，不进存储；最多三次，每次请求另有 API 超时。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { await this.cancelCloud(controlToken); return } catch { /* 清场不能等待网络恢复。 */ }
      if (attempt < 2) await new Promise<void>((resolve) => window.setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.controller.abort()
    this.preview.clear()
    window.clearTimeout(this.timer)
    window.clearTimeout(this.expiry)
    window.clearInterval(this.watchdog)
    void postLocalCopy('clear', this.session).catch(() => {})
    if (!this.printRequested && this.session.controlToken) void this.cancelAfterDispose(this.session.controlToken)
    this.session.controlToken = null
  }
}
export function ensureCopyDevice(session: CopySession): CopyDeviceFlow | null {
  if (!session.controlToken) return null
  if (current?.session.copyId === session.copyId && current.session.generation === session.generation) return current
  current?.dispose()
  snapshot = initial()
  current = new CopyDeviceFlow(session)
  void current.start()
  return current
}
export const readCopyDeviceFlow = () => current
onCopySessionClear(() => {
  current?.dispose()
  current = null
  publish(initial())
})
