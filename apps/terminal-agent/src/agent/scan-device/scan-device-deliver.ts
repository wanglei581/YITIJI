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
import type { DeviceReportResult, FetchDeviceLeaseResult } from './scan-device-backend'
import type { RoundHost, RoundSession } from './scan-device-round'
import { LocalScanError, SCAN_PDF_COMPOSE_MARGIN_BYTES, scanPagesAligned, type ScanDeviceDeliveryInput, type ScanDeviceView } from './scan-device-types'
import type { ScanDeviceErrorCode } from './wia-script'

export type DeliveryVerdict = 'received' | 'rejected' | 'uncertain'

/** 上传抛错时先看服务端有没有把结果说死。网络错误和没有响应体都算不确定。 */
export function verdictFromUploadError(error: unknown): DeliveryVerdict {
  const failure = classifyScanDeliveryFailure(error)
  if (failure.kind === 'refused') {
    return failure.refusal === 'file_already_delivered' ? 'received' : 'rejected'
  }
  return 'uncertain'
}

/**
 * 上传结果不确定时，用租约和回报的 409 原因把三态定下来。
 * 还在等这一场 = 文件没被收下。任务已经 matched（SCAN_DEVICE_TASK_DELIVERING）或租约没了且同状态回报被原样收下 = 已经收下。
 * 两边都说不清就保持不确定，调用方不能报已中止或已投递。
 */
export async function confirmUncertainDelivery(input: {
  taskId: string
  pageCount: number
  now: number
  fetchLease: (now: number) => Promise<FetchDeviceLeaseResult>
  report: (taskId: string, body: { state: 'delivering'; pageCount: number }) => Promise<DeviceReportResult>
}): Promise<DeliveryVerdict> {
  let fetched: FetchDeviceLeaseResult
  try {
    fetched = await input.fetchLease(input.now)
  } catch {
    fetched = { kind: 'unavailable' }
  }
  if (fetched.kind === 'lease' && fetched.lease.scanTaskId === input.taskId) return 'rejected'
  if (fetched.kind === 'none' && fetched.stopCode) return 'rejected'
  if (fetched.kind === 'unauthorized') return 'uncertain'
  const leaseGone = fetched.kind === 'none'
  let reported: DeviceReportResult
  try {
    reported = await input.report(input.taskId, { state: 'delivering', pageCount: input.pageCount })
  } catch {
    reported = { kind: 'unavailable' }
  }
  if (reported.kind === 'rejected' && reported.code === 'SCAN_DEVICE_TASK_DELIVERING') return 'received'
  if (reported.kind === 'ok' && leaseGone) return 'received'
  if (reported.kind === 'stop') {
    if (reported.code === 'SCAN_DEVICE_TASK_ENDED' || reported.code === 'TASK_ENDED') return 'uncertain'
    return 'rejected'
  }
  return 'uncertain'
}

function unconfirmedError(session: RoundSession): LocalScanError {
  return new LocalScanError(
    409,
    'LOCAL_SCAN_DELIVERY_UNCONFIRMED',
    { state: 'delivering', pageCount: session.pageCount, errorCode: null },
    '投递结果还没确认',
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
  let snapshotMs = composedAt
  const notBefore = Date.parse(fetched.lease.notBefore)
  if (Number.isFinite(notBefore) && snapshotMs <= notBefore) snapshotMs = notBefore + 1
  const delivery: ScanDeviceDeliveryInput = {
    scanTaskId: afterLease.taskId,
    bytes,
    deliveryLease: fetched.lease.deliveryLease,
    candidateSnapshotAt: new Date(snapshotMs).toISOString(),
    origin: 'device',
  }
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
    if (verdict === 'uncertain') {
      verdict = await confirmUncertainDelivery({
        taskId: failed.taskId,
        pageCount: failed.pageCount,
        now: host.deps.clock.now(),
        fetchLease: (now) => host.deps.fetchLease(now),
        report: (taskId, body) => host.deps.report(taskId, body),
      })
    }
    const confirmed = sameRound() ?? failed
    if (confirmed.generation !== currentGen) return show(host.state.session)
    if (verdict === 'received') return acceptDelivery(confirmed)
    if (verdict === 'rejected') {
      confirmed.deliveryOutcome = 'rejected'
      if (confirmed.abortRequested) return hooks.finishAbort()
      return hooks.fail('unknown')
    }
    confirmed.deliveryOutcome = 'uncertain'
    confirmed.phase = 'delivering'
    throw unconfirmedError(confirmed)
  }
  const uploaded = host.state.session
  if (!uploaded || uploaded.generation !== currentGen) {
    return { state: 'delivering', pageCount: beforeUpload.pageCount, errorCode: null, purged: false }
  }
  return acceptDelivery(uploaded)
}
