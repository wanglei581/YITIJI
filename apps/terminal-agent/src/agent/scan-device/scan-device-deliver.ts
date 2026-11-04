/**
 * agent/scan-device/scan-device-deliver.ts — 把已扫的页合成 PDF 并投递给云端
 *
 * 合成和投递不占设备锁。投递前必须重新取 current-lease。
 * 成功后本场回到 idle，调用方拿到的返回值仍是 delivering（这一下已经交出文件）。
 */

import { warn } from '../../logger'
import { isUnauthorizedHttpError } from '../api-client'
import { markUnauthorized } from '../auth-state'
import { classifyScanDeliveryFailure } from '../scan-delivery'
import type { DeviceReportDetails, DeviceReportResult } from './scan-device-backend'
import type { RoundHost, RoundSession } from './scan-device-round'
import { LocalScanError, SCAN_PDF_COMPOSE_MARGIN_BYTES, scanPagesAligned, type ScanDeviceDeliveryInput, type ScanDeviceView } from './scan-device-types'
import type { ScanDeviceErrorCode } from './wia-script'

export type DeliveryVerdict = 'received' | 'rejected' | 'waiting' | 'uncertain'

/** 上传抛错之后隔多久再探一次。到会话硬截止为止。 */
export const SCAN_DEVICE_DELIVERY_RECHECK_MS = 30_000

const ENDED_NOT_DELIVERED = new Set(['cancelled', 'expired', 'failed'])

/** 上传抛错时先看服务端有没有把结果说死。网络错误和没有响应体都算不确定。 */
export function verdictFromUploadError(error: unknown): DeliveryVerdict {
  const failure = classifyScanDeliveryFailure(error)
  if (failure.kind === 'refused') {
    return failure.refusal === 'file_already_delivered' ? 'received' : 'rejected'
  }
  return 'uncertain'
}

function detailsOf(result: DeviceReportResult): DeviceReportDetails | undefined {
  if (result.kind === 'stop' || result.kind === 'rejected') return result.details
  return undefined
}

/**
 * 上传结果不确定时，只信 device-report 的 409 补充，不看租约还在不在。
 * completed 或 fileDelivered=true → 已投递。
 * cancelled / expired / failed 且没投递 → 未投递。
 * 仍是 waiting，或回报被原样收下（任务还没收场）→ 用同一份 PDF 再投一次。
 * 没有 taskStatus 的旧后端，以及断网，保持不确定。
 */
export function verdictFromDeliveryProbe(result: DeviceReportResult): DeliveryVerdict {
  const details = detailsOf(result)
  if (details?.fileDelivered === true || details?.taskStatus === 'completed') return 'received'
  if (details?.taskStatus === 'waiting') return 'waiting'
  if (details?.taskStatus !== undefined && ENDED_NOT_DELIVERED.has(details.taskStatus)) return 'rejected'
  if (result.kind === 'ok') return 'waiting'
  if (result.kind === 'stop' && (result.code === 'SCAN_DEVICE_TASK_ENDED' || result.code === 'TASK_ENDED')) {
    return 'uncertain'
  }
  if (result.kind === 'stop') return 'rejected'
  return 'uncertain'
}

function isoTime(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 硬截止优先。没有就用目前见过的最晚 expiresAt，不用租约在不在猜结果。 */
export function noteDeliveryDeadline(session: RoundSession, input: { hardExpiresAt?: string; expiresAt?: string }): void {
  const hard = isoTime(input.hardExpiresAt)
  if (hard !== undefined) {
    session.confirmUntil = hard
    session.deadlineIsHard = true
    return
  }
  if (session.deadlineIsHard) return
  const soft = isoTime(input.expiresAt)
  if (soft === undefined) return
  session.confirmUntil = Math.max(session.confirmUntil ?? 0, soft)
}

function noteProbeDeadline(session: RoundSession, result: DeviceReportResult): void {
  if (result.kind === 'ok') {
    noteDeliveryDeadline(session, { hardExpiresAt: result.hardExpiresAt, expiresAt: result.expiresAt })
    return
  }
  const details = detailsOf(result)
  if (details?.hardExpiresAt) noteDeliveryDeadline(session, { hardExpiresAt: details.hardExpiresAt })
}

async function probeDelivery(host: RoundHost, session: RoundSession): Promise<DeviceReportResult> {
  try {
    const result = await host.deps.report(session.taskId, { state: 'delivering', pageCount: session.pageCount })
    noteProbeDeadline(session, result)
    return result
  } catch {
    return { kind: 'unavailable' }
  }
}

function unconfirmedError(session: RoundSession): LocalScanError {
  return new LocalScanError(
    409,
    'LOCAL_SCAN_DELIVERY_UNCONFIRMED',
    { state: 'delivering', pageCount: session.pageCount, errorCode: null },
    '投递结果不确定',
  )
}

export async function deliverComposedRound(
  host: RoundHost,
  currentGen: number,
  hooks: {
    fail: (code: ScanDeviceErrorCode) => Promise<ScanDeviceView>
    finishStop: () => ScanDeviceView
    finishAbort: () => Promise<ScanDeviceView>
    viewOf: (session: RoundSession | undefined) => ScanDeviceView
  },
): Promise<ScanDeviceView> {
  const show = hooks.viewOf
  const sameRound = (): RoundSession | undefined => {
    const session = host.state.session
    if (!session || session.generation !== currentGen) return undefined
    return session
  }
  const stopOrAbort = (session: RoundSession): Promise<ScanDeviceView> | ScanDeviceView | undefined => {
    if (session.abortRequested) return hooks.finishAbort()
    if (session.stopCode) return hooks.finishStop()
    return undefined
  }
  const markDead = (session: RoundSession): ScanDeviceView => {
    host.commitPurge(session.taskId, 'SCAN_DEVICE_FAILED')
    session.phase = 'error'
    session.errorCode = 'unknown'
    return show(session)
  }

  host.disarmIdle()
  const current = sameRound()
  if (!current) return show(host.state.session)
  if (!scanPagesAligned(current.pageCount, current.pages)) return hooks.fail('unknown')
  await host.flushReports()
  const afterFlush = sameRound()
  if (!afterFlush) return show(host.state.session)
  const flushedStop = stopOrAbort(afterFlush)
  if (flushedStop) return flushedStop
  afterFlush.phase = 'composing'
  host.note('composing')
  const composing = await host.sendReport({ state: 'composing', pageCount: afterFlush.pageCount })
  const afterComposing = sameRound()
  if (!afterComposing) return show(host.state.session)
  if (composing === 'stop') return hooks.finishStop()
  if (composing === 'dead') return markDead(afterComposing)
  const composingStop = stopOrAbort(afterComposing)
  if (composingStop) return composingStop
  const composedAt = host.deps.clock.now()
  const composed = await host.deps.compose(
    afterComposing.outDir,
    afterComposing.pages.map((page) => page.file),
    {
      maxPages: afterComposing.pageCap,
      maxBytes: afterComposing.byteBudget + SCAN_PDF_COMPOSE_MARGIN_BYTES,
      ...(host.root ? { root: host.root } : {}),
    },
  )
  const afterCompose = sameRound()
  if (!afterCompose) return show(host.state.session)
  if (!composed.ok) return hooks.fail(composed.errorCode)
  const composeStop = stopOrAbort(afterCompose)
  if (composeStop) return composeStop
  afterCompose.phase = 'delivering'
  host.note('delivering')
  const delivering = await host.sendReport({ state: 'delivering', pageCount: afterCompose.pageCount })
  const afterDelivering = sameRound()
  if (!afterDelivering) return show(host.state.session)
  if (delivering === 'stop') return hooks.finishStop()
  if (delivering === 'dead') return markDead(afterDelivering)
  const deliveringStop = stopOrAbort(afterDelivering)
  if (deliveringStop) return deliveringStop
  let bytes: Buffer
  try {
    bytes = await host.deps.readFile(composed.path)
  } catch {
    const failed = sameRound()
    if (!failed) return show(host.state.session)
    return hooks.fail('unknown')
  }
  const afterRead = sameRound()
  if (!afterRead) return show(host.state.session)
  const readStop = stopOrAbort(afterRead)
  if (readStop) return readStop
  const fetched = await host.deps.fetchLease(host.deps.clock.now())
  const afterLease = sameRound()
  if (!afterLease) return show(host.state.session)
  if (fetched.kind === 'unauthorized') {
    afterLease.unauthorized = true
    return markDead(afterLease)
  }
  const leaseStop = stopOrAbort(afterLease)
  if (leaseStop) return leaseStop
  if (fetched.kind !== 'lease' || fetched.lease.scanTaskId !== afterLease.taskId) return hooks.fail('unknown')
  noteDeliveryDeadline(afterLease, { hardExpiresAt: fetched.lease.hardExpiresAt, expiresAt: fetched.lease.expiresAt })
  let snapshotMs = composedAt
  const notBefore = Date.parse(fetched.lease.notBefore)
  if (Number.isFinite(notBefore) && snapshotMs <= notBefore) snapshotMs = notBefore + 1
  const delivery: ScanDeviceDeliveryInput = {
    scanTaskId: afterLease.taskId,
    bytes,
    deliveryLease: fetched.lease.deliveryLease,
    candidateSnapshotAt: new Date(snapshotMs).toISOString(),
    origin: 'device',
    ...(afterLease.deviceRound !== undefined ? { deviceRound: afterLease.deviceRound } : {}),
  }
  afterLease.pendingUpload = delivery
  if (host.deps.beforeUpload) await host.deps.beforeUpload()
  const beforeUpload = sameRound()
  if (!beforeUpload) return show(host.state.session)
  const uploadStop = stopOrAbort(beforeUpload)
  if (uploadStop) return uploadStop
  const acceptDelivery = (session: RoundSession): ScanDeviceView => {
    session.delivered = true
    session.deliveryOutcome = 'received'
    const purged = host.commitPurge(session.taskId, 'SCAN_DEVICE_DELIVERED')
    session.phase = 'idle'
    session.errorCode = null
    host.note('delivering')
    return { state: 'delivering', pageCount: session.pageCount, errorCode: null, purged }
  }

  try {
    await host.deps.deliver(delivery)
    beforeUpload.delivered = true
    beforeUpload.deliveryOutcome = 'received'
  } catch (error) {
    const failed = sameRound() ?? beforeUpload
    if (failed.generation !== currentGen) return show(host.state.session)
    if (isUnauthorizedHttpError(error)) {
      markUnauthorized()
      failed.unauthorized = true
      return markDead(failed)
    }
    let verdict = verdictFromUploadError(error)
    const failure = classifyScanDeliveryFailure(error)
    const code = failure.kind === 'refused' ? failure.code : failure.code ?? 'NETWORK'
    warn(`scan-device: deliver failed task=${failed.taskId} code=${code} verdict=${verdict}`)
    if (verdict === 'uncertain') verdict = await settleUncertainUpload(host, failed, delivery)
    const confirmed = sameRound() ?? failed
    if (confirmed.generation !== currentGen) return show(host.state.session)
    if (verdict === 'received') return acceptDelivery(confirmed)
    if (verdict === 'rejected') {
      host.clearDeliveryRecheck()
      if (confirmed.unauthorized) return markDead(confirmed)
      if (confirmed.phase === 'aborted') {
        confirmed.deliveryOutcome = 'rejected'
        return hooks.viewOf(confirmed)
      }
      confirmed.deliveryOutcome = 'rejected'
      if (confirmed.abortRequested) return hooks.finishAbort()
      return hooks.fail('unknown')
    }
    confirmed.deliveryOutcome = 'uncertain'
    confirmed.phase = 'delivering'
    if (confirmed.confirmUntil !== undefined && host.deps.clock.now() >= confirmed.confirmUntil) {
      expireUncertain(host, confirmed)
      throw unconfirmedError(confirmed)
    }
    host.scheduleDeliveryRecheck(confirmed.generation)
    throw unconfirmedError(confirmed)
  }
  const uploaded = host.state.session
  if (!uploaded || uploaded.generation !== currentGen) {
    return { state: 'delivering', pageCount: beforeUpload.pageCount, errorCode: null, purged: false }
  }
  return acceptDelivery(uploaded)
}

function expireUncertain(host: RoundHost, session: RoundSession): void {
  host.clearDeliveryRecheck()
  host.commitPurge(session.taskId, 'SCAN_DEVICE_FAILED')
  session.deliveryOutcome = 'uncertain'
  session.phase = 'error'
  session.errorCode = null
  session.pendingUpload = undefined
}

function roundStill(host: RoundHost, generation: number): RoundSession | undefined {
  const session = host.state.session
  if (!session || session.generation !== generation || session.deliveryOutcome !== 'uncertain') return undefined
  return session
}

/** 仍在 waiting 时用记下的那一份 PDF 再投一次。重复内容回已投递也算收下。换了轮次就作废，不再传。 */
async function retrySamePdf(host: RoundHost, session: RoundSession): Promise<DeliveryVerdict> {
  const draft = session.pendingUpload
  if (!draft) return 'uncertain'
  if (draft.deviceRound !== undefined && session.deviceRound !== undefined && draft.deviceRound !== session.deviceRound) {
    host.clearDeliveryRecheck()
    host.commitPurge(session.taskId, 'SCAN_DEVICE_SESSION_CLEARED')
    session.deliveryOutcome = 'rejected'
    session.phase = 'aborted'
    session.errorCode = null
    session.pendingUpload = undefined
    return 'rejected'
  }
  try {
    await host.deps.deliver(draft)
    return 'received'
  } catch (error) {
    if (isUnauthorizedHttpError(error)) {
      markUnauthorized()
      session.unauthorized = true
      return 'rejected'
    }
    return verdictFromUploadError(error)
  }
}

async function settleUncertainUpload(
  host: RoundHost,
  session: RoundSession,
  delivery: ScanDeviceDeliveryInput,
): Promise<DeliveryVerdict> {
  session.pendingUpload = delivery
  const probe = await probeDelivery(host, session)
  let verdict = verdictFromDeliveryProbe(probe)
  if (verdict !== 'waiting') return verdict
  verdict = await retrySamePdf(host, session)
  if (verdict !== 'uncertain') return verdict
  const again = await probeDelivery(host, session)
  const follow = verdictFromDeliveryProbe(again)
  return follow === 'waiting' ? 'uncertain' : follow
}

/** 断网时隔一段再探。调用方保证这一场还停在不确定。到点仍不知道就删页。 */
export async function recheckUncertainDelivery(host: RoundHost, generation: number): Promise<void> {
  const session = roundStill(host, generation)
  if (!session) return
  if (session.confirmUntil !== undefined && host.deps.clock.now() >= session.confirmUntil) {
    expireUncertain(host, session)
    return
  }
  const probe = await probeDelivery(host, session)
  const current = roundStill(host, generation)
  if (!current) return
  let verdict = verdictFromDeliveryProbe(probe)
  if (verdict === 'waiting') {
    verdict = await retrySamePdf(host, current)
    if (verdict === 'uncertain') {
      const follow = verdictFromDeliveryProbe(await probeDelivery(host, current))
      verdict = follow === 'waiting' ? 'uncertain' : follow
    }
  }
  const latest = host.state.session
  if (!latest || latest.generation !== generation) return
  if (latest.deliveryOutcome === 'rejected' && latest.phase === 'aborted') return
  if (verdict === 'received') {
    host.clearDeliveryRecheck()
    latest.delivered = true
    latest.deliveryOutcome = 'received'
    const purged = host.commitPurge(latest.taskId, 'SCAN_DEVICE_DELIVERED')
    latest.phase = 'idle'
    latest.errorCode = null
    latest.pendingUpload = undefined
    latest.purgeSettled = true
    latest.purged = purged
    return
  }
  if (verdict === 'rejected') {
    host.clearDeliveryRecheck()
    latest.deliveryOutcome = 'rejected'
    host.commitPurge(latest.taskId, 'SCAN_DEVICE_FAILED')
    latest.phase = 'error'
    latest.errorCode = 'unknown'
    latest.pendingUpload = undefined
    return
  }
  if (latest.confirmUntil !== undefined && host.deps.clock.now() >= latest.confirmUntil) {
    expireUncertain(host, latest)
    return
  }
  host.scheduleDeliveryRecheck(generation)
}
