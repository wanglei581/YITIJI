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
import type { RoundHost, RoundSession } from './scan-device-round'
import type { ScanDeviceDeliveryInput, ScanDeviceView } from './scan-device-types'
import type { ScanDeviceErrorCode } from './wia-script'

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
  const current = host.state.session
  if (!current || current.generation !== currentGen) return show(current)
  await host.flushReports()
  if (current.abortRequested) return hooks.finishAbort()
  if (current.stopCode) return hooks.finishStop()
  current.phase = 'composing'
  host.note('composing')
  const composing = await host.sendReport({ state: 'composing', pageCount: current.pageCount })
  if (composing === 'stop') return hooks.finishStop()
  if (composing === 'dead') {
    host.purge(current.taskId, 'SCAN_DEVICE_FAILED')
    current.phase = 'error'
    current.errorCode = 'unknown'
    return show(current)
  }
  const composedAt = host.deps.clock.now()
  const composed = await host.deps.compose(
    current.outDir,
    current.pages.map((page) => page.file),
    { maxPages: host.maxPages, ...(host.root ? { root: host.root } : {}) },
  )
  const after = host.state.session
  if (!after || after.generation !== currentGen) return show(after)
  if (!composed.ok) return hooks.fail(composed.errorCode)
  if (after.abortRequested) return hooks.finishAbort()
  if (after.stopCode) return hooks.finishStop()
  after.phase = 'delivering'
  host.note('delivering')
  const delivering = await host.sendReport({ state: 'delivering', pageCount: after.pageCount })
  if (delivering === 'stop') return hooks.finishStop()
  if (delivering === 'dead') {
    host.purge(after.taskId, 'SCAN_DEVICE_FAILED')
    after.phase = 'error'
    after.errorCode = 'unknown'
    return show(after)
  }
  let bytes: Buffer
  try {
    bytes = await host.deps.readFile(composed.path)
  } catch {
    return hooks.fail('unknown')
  }
  const fetched = await host.deps.fetchLease(host.deps.clock.now())
  if (fetched.kind === 'unauthorized') {
    after.unauthorized = true
    host.purge(after.taskId, 'SCAN_DEVICE_FAILED')
    after.phase = 'error'
    after.errorCode = 'unknown'
    return show(after)
  }
  if (fetched.kind !== 'lease' || fetched.lease.scanTaskId !== after.taskId) return hooks.fail('unknown')
  let snapshotMs = composedAt
  const notBefore = Date.parse(fetched.lease.notBefore)
  if (Number.isFinite(notBefore) && snapshotMs <= notBefore) snapshotMs = notBefore + 1
  const delivery: ScanDeviceDeliveryInput = {
    scanTaskId: after.taskId,
    bytes,
    deliveryLease: fetched.lease.deliveryLease,
    candidateSnapshotAt: new Date(snapshotMs).toISOString(),
    origin: 'device',
  }
  try {
    await host.deps.deliver(delivery)
  } catch (error) {
    if (isUnauthorizedHttpError(error)) {
      markUnauthorized()
      after.unauthorized = true
      host.purge(after.taskId, 'SCAN_DEVICE_FAILED')
      after.phase = 'error'
      after.errorCode = 'unknown'
      return show(after)
    }
    const failure = classifyScanDeliveryFailure(error)
    const code = failure.kind === 'refused' ? failure.code : failure.code ?? 'NETWORK'
    warn(`scan-device: deliver failed task=${after.taskId} code=${code}`)
    return hooks.fail('unknown')
  }
  host.purge(after.taskId, 'SCAN_DEVICE_DELIVERED')
  const done: ScanDeviceView = { state: 'delivering', pageCount: after.pageCount, errorCode: null }
  after.phase = 'idle'
  after.errorCode = null
  host.note('delivering')
  return done
}
