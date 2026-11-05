import { cancelCopyJob, confirmCopyJob, getCopyJob, type CopyJobView } from '../../services/api/copyJobs'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { fetchCopyPreview, postLocalCopy, type LocalCopyView } from '../../services/copy/localCopyApi'
import { canConfirmCopy, copyPhaseFromLocal, validCopyJob, type CopyDevicePhase } from './copyCheckModel'
import { CopyPreview } from './copyPreview'
import { markCopyConfirmed, onCopySessionClear, type CopySession } from './copySession'

interface DeviceSnapshot {
  phase: CopyDevicePhase
  pages: number | null
  started: boolean
  busy: boolean
  job: CopyJobView | null
  notice: string | null
}
const initial = (): DeviceSnapshot => ({ phase: 'starting', pages: null, started: false, busy: false, job: null, notice: null })
const UNKNOWN = '状态未知。这一步的结果还没确认，请先停止操作，不要重新开始。'
let snapshot = initial()
let current: CopyDeviceFlow | null = null
const listeners = new Set<() => void>()
export const readCopyDevice = () => snapshot
export const subscribeCopyDevice = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const publish = (patch: Partial<DeviceSnapshot>) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener() }

/** 单会话执行器。React 重挂载不能重复 start；C3b-2 可从这里接 confirmed 和真实 job。 */
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
    }, 1000)
    await this.command('start')
    if (this.live()) this.schedule()
  }
  private expire() {
    if (!this.live()) return
    this.controller.abort()
    this.preview.clear()
    publish({ phase: 'unknown', job: null, pages: null, busy: false, notice: '这次复印已过期，请返回后重新开始。' })
    void postLocalCopy('clear', this.session).catch(() => {})
  }
  private schedule() {
    if (!this.live() || ['confirmed', 'stopped', 'unknown'].includes(snapshot.phase)) return
    this.timer = window.setTimeout(() => { void this.poll().finally(() => this.schedule()) }, 3000)
  }
  private async acceptLocal(view: LocalCopyView, signal: AbortSignal) {
    if (!this.live(signal)) return
    if (view.errorCode || ['cancelled', 'cleared', 'failed', 'expired'].includes(view.state)) { this.unknown(); return }
    const signature = `${view.state}:${view.pageCount}`
    if (signature !== this.signature) { this.signature = signature; this.progressAt = Date.now() }
    publish({ phase: copyPhaseFromLocal(view.state, this.session.input.source), pages: view.pageCount,
      started: view.state !== 'starting', notice: null })
    // 3f2a65fa7 的进纸器 scan() 自己 await finish()；page_ready 是它合成前的瞬态，不能再发一次 finish。
    if (view.state === 'scanned') await this.refreshQuote(signal)
  }
  private async poll() {
    if (this.polling || snapshot.busy || ['confirmed', 'stopped', 'unknown'].includes(snapshot.phase)) return
    this.polling = true
    const revision = this.revision
    const signal = this.controller.signal
    try {
      const view = await postLocalCopy('status', this.session, {}, signal)
      if (!this.live(signal) || revision !== this.revision) return
      this.misses = 0
      if (snapshot.phase === 'check') {
        if (view.state !== 'scanned' || view.errorCode || view.pageCount !== snapshot.job?.pageCount) this.unknown()
        return
      }
      await this.acceptLocal(view, signal)
    } catch {
      if (this.live(signal) && revision === this.revision && ++this.misses >= 2) this.unknown()
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
    } catch { if (this.live(signal)) this.unknown() }
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
  async stop(): Promise<void> {
    if (this.disposed || snapshot.busy || ['confirmed', 'stopped'].includes(snapshot.phase)) return
    this.revision += 1
    this.controller.abort()
    this.controller = new AbortController()
    this.preview.clear()
    publish({ busy: true })
    const signal = this.controller.signal
    const [local, cloud] = await Promise.allSettled([
      postLocalCopy('abort', this.session, {}, signal),
      cancelCopyJob(this.session.copyId, this.session.controlToken!, this.session.generation, signal),
    ])
    if (!this.live(signal)) return
    if (local.status === 'fulfilled' && local.value.state === 'cancelled' && local.value.purged === true
      && cloud.status === 'fulfilled' && cloud.value.state === 'cancelled' && cloud.value.copyId === this.session.copyId
      && cloud.value.generation === this.session.generation && cloud.value.terminalId === this.session.input.terminalId) {
      publish({ phase: 'stopped', busy: false, job: null, notice: '已停止复印，已扫的页已从这台机器删除。' })
    } else this.unknown('状态未知。这次停止的结果还没确认，请不要重新开始。')
  }
  async clearForRescan(): Promise<boolean> {
    if (!this.live() || snapshot.busy || snapshot.phase !== 'check') return false
    this.revision += 1
    publish({ busy: true })
    this.preview.clear()
    const signal = this.controller.signal
    const [local, cloud] = await Promise.allSettled([
      postLocalCopy('clear', this.session, {}, signal),
      cancelCopyJob(this.session.copyId, this.session.controlToken!, this.session.generation, signal),
    ])
    if (!this.live(signal)) return false
    if (local.status === 'fulfilled' && local.value.state === 'cleared' && local.value.purged === true
      && cloud.status === 'fulfilled' && cloud.value.state === 'cancelled' && cloud.value.copyId === this.session.copyId
      && cloud.value.generation === this.session.generation && cloud.value.terminalId === this.session.input.terminalId) { publish({ busy: false }); return true }
    this.unknown('状态未知。旧扫描件的清理结果还没确认，请不要重扫。')
    return false
  }
  dispose() {
    this.disposed = true
    this.controller.abort()
    this.preview.clear()
    window.clearTimeout(this.timer)
    window.clearTimeout(this.expiry)
    window.clearInterval(this.watchdog)
    void postLocalCopy('clear', this.session).catch(() => {})
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
