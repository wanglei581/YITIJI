/** 第六轮：签名到期后同 PDF 重投、兼容后端的投递截止。由 runner 主门禁调用。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { getScanDeletionAudits, type AgentDatabase } from '../src/agent/db'
import type { DeviceReportBody, DeviceReportResult, FetchDeviceLeaseResult } from '../src/agent/scan-device/scan-device-backend'
import { noteDeliveryDeadline, SCAN_DEVICE_DELIVERY_RECHECK_MS } from '../src/agent/scan-device/scan-device-deliver'
import type { RoundSession } from '../src/agent/scan-device/scan-device-round'
import { createScanDeviceRuntime } from '../src/agent/scan-device/scan-device-runner'
import { LocalScanError, type ScanDeviceDeliveryInput } from '../src/agent/scan-device/scan-device-types'
import { agentConfig, axiosStatus, createHarness, deviceLease, flush, probeResult, pushScript } from './verify-scan-device-runner.helper'

let sequence = 0
const PDF = Buffer.from('%PDF-r6-original-bytes')
const iso = (ms: number): string => new Date(ms).toISOString()

function fixture(root: string, patch: {
  hardMs?: number
  leaseMs?: number
  deliver: (input: ScanDeviceDeliveryInput) => Promise<void>
  fetchLease?: () => Promise<FetchDeviceLeaseResult | undefined>
  report?: (body: DeviceReportBody) => DeviceReportResult
}) {
  const taskId = `taskR6${++sequence}`
  const h = createHarness({ root, config: agentConfig(), reportDelaysMs: [0, 0] })
  const started = h.clock.now()
  const counts = { leases: 0, compose: 0, read: 0 }
  const events: string[] = []
  const runtime = createScanDeviceRuntime(agentConfig(), {
    startScan: h.scanner.start,
    runProbe: async () => probeResult('ready'),
    compose: async (dir, files) => {
      counts.compose += 1
      const file = path.join(dir, 'scan.pdf')
      fs.writeFileSync(file, PDF)
      return { ok: true, path: file, pageCount: files.length, bytes: PDF.length }
    },
    readFile: async (file) => {
      counts.read += 1
      return fs.readFileSync(file)
    },
    deliver: async (input) => {
      events.push('upload')
      h.deliveries.push(input)
      await patch.deliver(input)
    },
    fetchLease: async () => {
      counts.leases += 1
      events.push('lease')
      const custom = await patch.fetchLease?.()
      return custom ?? {
        kind: 'lease',
        lease: deviceLease(taskId, h.clock.now(), {
          device: { source: 'flatbed', colorMode: 'gray' },
          expiresAt: iso(h.clock.now() + (patch.leaseMs ?? 60_000)),
          deliveryLease: `signature-${counts.leases}`,
          ...(patch.hardMs !== undefined ? { hardExpiresAt: iso(started + patch.hardMs) } : {}),
        }),
      }
    },
    report: async (_task, body) => {
      events.push('report')
      h.reports.push(body)
      return patch.report?.(body) ?? { kind: 'ok', deviceRound: 7 }
    },
    clock: h.clock,
    lock: h.lock,
    root,
    reportDelaysMs: [0, 0],
  })
  return {
    ...h, runtime, counts, events, started, taskId,
    dir: path.join(root, taskId),
    async ready() {
      pushScript(h.scanner, { pages: [{ bytes: 40 }] })
      await runtime.start(taskId)
      await runtime.whenIdle()
    },
  }
}

async function unconfirmed(work: Promise<unknown>): Promise<void> {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof LocalScanError)
    assert.equal(error.httpStatus, 409)
    assert.equal(error.code, 'LOCAL_SCAN_DELIVERY_UNCONFIRMED')
    assert.equal(error.message, '投递结果不确定')
    return true
  })
}

function auditSnapshot(db: AgentDatabase): Set<string> {
  return new Set(getScanDeletionAudits(db).map((row) => row.eventId))
}

function assertPurged(f: ReturnType<typeof fixture>, db: AgentDatabase, before: Set<string>, reason: string): void {
  assert.equal(fs.existsSync(f.dir), false, '页和 PDF 必须一起删除')
  assert.ok(getScanDeletionAudits(db).some((row) => !before.has(row.eventId) && row.reasonCode === reason))
}

/** 断网 90 秒后，先探 waiting，再取新签名；文件、快照、轮次不变。 */
export async function verifyDeliveryRefreshesExpiredLeaseSamePdf(root: string, db: AgentDatabase): Promise<void> {
  let online = false
  const before = auditSnapshot(db)
  const f = fixture(root, {
    hardMs: 180_000,
    deliver: async (input) => {
      if (!online) throw new Error('offline')
      if (input.deliveryLease === f.deliveries[0]?.deliveryLease) throw axiosStatus(409, 'SCAN_LEASE_EXPIRED')
    },
    report: () => online ? { kind: 'ok', deviceRound: 7 } : (
      f.deliveries.length ? { kind: 'unavailable' } : { kind: 'ok', deviceRound: 7 }
    ),
  })
  try {
    await f.ready()
    await unconfirmed(f.runtime.finish(f.taskId))
    for (let i = 0; i < 2; i += 1) {
      f.clock.advance(SCAN_DEVICE_DELIVERY_RECHECK_MS)
      await flush()
    }
    assert.equal(f.deliveries.length, 1)
    assert.equal(fs.existsSync(path.join(f.dir, 'scan.pdf')), true)
    online = true
    const leasesBefore = f.counts.leases
    f.events.length = 0
    f.clock.advance(SCAN_DEVICE_DELIVERY_RECHECK_MS)
    await flush()
    assert.equal(f.counts.leases, leasesBefore + 1)
    assert.equal(f.deliveries.length, 2)
    const [first, second] = f.deliveries
    assert.ok(first && second)
    assert.notEqual(second.deliveryLease, first.deliveryLease, '重投不能复用过期签名')
    assert.deepEqual(f.events, ['report', 'lease', 'upload'])
    assert.equal(first.bytes, second.bytes, '重投复用同一 Buffer')
    assert.deepEqual(second.bytes, PDF)
    assert.equal(second.candidateSnapshotAt, first.candidateSnapshotAt)
    assert.equal(second.deviceRound, 7)
    assert.equal(second.deviceRound, first.deviceRound)
    assert.equal(second.scanTaskId, first.scanTaskId)
    assert.equal(f.counts.compose, 1)
    assert.equal(f.counts.read, 1)
    assertPurged(f, db, before, 'SCAN_DEVICE_DELIVERED')
    assert.equal((await f.runtime.abort(f.taskId)).state, 'delivering')
  } finally { f.runtime.stop() }
}

/** 即使新签名在上传时又过期，也回探查，分别验证 completed / fileDelivered。 */
export async function verifyExpiredRetryProbesDeliveryResult(root: string, db: AgentDatabase): Promise<void> {
  for (const background of [false, true]) {
    for (const details of [{ taskStatus: 'completed' }, { taskStatus: 'matched', fileDelivered: true }]) {
      const before = auditSnapshot(db)
      let retryReady = !background
      const f = fixture(path.join(root, String(background), details.taskStatus), {
        deliver: async () => {
          if (f.deliveries.length === 1) throw new Error('response lost')
          throw axiosStatus(409, 'SCAN_LEASE_EXPIRED')
        },
        report: () => f.deliveries.length === 1 && !retryReady ? { kind: 'unavailable' } : f.deliveries.length >= 2
          ? { kind: 'stop', code: 'SCAN_DEVICE_TASK_ENDED', details }
          : { kind: 'ok', deviceRound: 7 },
      })
      try {
        await f.ready()
        if (background) {
          await unconfirmed(f.runtime.finish(f.taskId))
          retryReady = true
          f.clock.advance(SCAN_DEVICE_DELIVERY_RECHECK_MS)
          await flush()
        }
        const result = background ? await f.runtime.abort(f.taskId) : await f.runtime.finish(f.taskId)
        assert.equal(result.state, 'delivering')
        assert.equal(f.deliveries.length, 2)
        assert.equal(f.events[f.events.length - 1], 'report', '租约过期必须回探查')
        assertPurged(f, db, before, 'SCAN_DEVICE_DELIVERED')
      } finally { f.runtime.stop() }
    }
  }
}

/** 各类取租约失败都不能推断原上传失败；不重投，到原截止才清理。 */
export async function verifyLeaseRefreshFailureStaysUncertain(root: string, db: AgentDatabase): Promise<void> {
  const failures: Array<FetchDeviceLeaseResult | Error> = [
    { kind: 'unavailable' }, { kind: 'none' }, { kind: 'unauthorized' },
    { kind: 'rejected', code: 'SCAN_LEASE_EXPIRED' }, new Error('lease network failure'),
    { kind: 'lease', lease: deviceLease('anotherTask', 1_700_000_000_000) },
  ]
  for (const [index, failure] of failures.entries()) {
    const before = auditSnapshot(db)
    const f = fixture(path.join(root, String(index)), {
      deliver: async () => { throw new Error('upload failed') },
      fetchLease: async () => {
        if (!f.deliveries.length) return undefined
        if (failure instanceof Error) throw failure
        return failure
      },
      report: () => ({ kind: 'ok', expiresAt: iso(f.clock.now() + 3_600_000) }),
    })
    try {
      await f.ready()
      await unconfirmed(f.runtime.finish(f.taskId))
      f.clock.advance(30_000)
      await flush()
      assert.equal(fs.existsSync(f.dir), true)
      assert.equal(f.deliveries.length, 1, '取不到同任务有效租约不得上传')
      f.clock.advance(30_000)
      await flush()
      assertPurged(f, db, before, 'SCAN_DEVICE_FAILED')
      await unconfirmed(f.runtime.finish(f.taskId))
      await unconfirmed(f.runtime.abort(f.taskId))
    } finally { f.runtime.stop() }
  }
}

/** 普通回报与新租约持续续期，上传持续失败：仍在投递前 60 秒截止清理。 */
export async function verifySoftDeadlineSurvivesSuccessfulRenewals(root: string, db: AgentDatabase): Promise<void> {
  const before = auditSnapshot(db)
  const f = fixture(root, {
    deliver: async () => { throw new Error('upload down') },
    report: () => ({ kind: 'ok', expiresAt: iso(f.clock.now() + 3_600_000), deviceRound: 7 }),
  })
  try {
    await f.ready()
    await unconfirmed(f.runtime.finish(f.taskId))
    assert.equal(f.deliveries.length, 2)
    f.clock.advance(30_000)
    await flush()
    assert.equal(fs.existsSync(f.dir), true)
    assert.equal(f.deliveries.length, 3)
    f.clock.advance(30_000)
    await flush()
    assert.equal(f.clock.now(), f.started + 60_000)
    assertPurged(f, db, before, 'SCAN_DEVICE_FAILED')
    await unconfirmed(f.runtime.finish(f.taskId))
    await unconfirmed(f.runtime.abort(f.taskId))
    const tries = f.deliveries.length
    f.clock.advance(3_600_000)
    await flush()
    assert.equal(f.deliveries.length, tries, '到期后不再上传')
  } finally { f.runtime.stop() }
}

/** 直接核对截止值：早期回报不抢占兜底、100 次回报/重取均不延长、硬截止仍优先。 */
export function verifyDeliveryDeadlineNeverMoves(): void {
  const session = {} as RoundSession
  noteDeliveryDeadline(session, { expiresAt: iso(10_000) })
  noteDeliveryDeadline(session, { expiresAt: iso(60_000) }, true)
  assert.equal(session.confirmUntil, 60_000)
  session.pendingUpload = {} as ScanDeviceDeliveryInput
  for (let i = 1; i <= 100; i += 1) {
    noteDeliveryDeadline(session, { expiresAt: iso(60_000 + i * 36_000) })
    noteDeliveryDeadline(session, { expiresAt: iso(60_000 + i * 36_000) }, true)
    assert.equal(session.confirmUntil, 60_000, `第 ${i} 次续期不得推后截止`)
  }
  noteDeliveryDeadline(session, { hardExpiresAt: iso(180_000) })
  assert.equal(session.confirmUntil, 180_000)
  noteDeliveryDeadline(session, { expiresAt: iso(3_600_000) })
  assert.equal(session.confirmUntil, 180_000)
}

/** 硬截止比签名 TTL 短或长时，都照硬截止清理；续签、回报不会改用软截止。 */
export async function verifyHardDeadlineStillWins(root: string, db: AgentDatabase): Promise<void> {
  for (const hardMs of [30_000, 120_000]) {
    const before = auditSnapshot(db)
    const f = fixture(path.join(root, String(hardMs)), {
      hardMs,
      deliver: async () => { throw new Error('upload down') },
      report: () => ({ kind: 'ok', expiresAt: iso(f.clock.now() + 3_600_000), hardExpiresAt: iso(f.started + hardMs) }),
    })
    try {
      await f.ready()
      await unconfirmed(f.runtime.finish(f.taskId))
      for (let elapsed = 30_000; elapsed <= hardMs; elapsed += 30_000) {
        f.clock.advance(30_000)
        await flush()
        assert.equal(fs.existsSync(f.dir), elapsed < hardMs)
      }
      assertPurged(f, db, before, 'SCAN_DEVICE_FAILED')
      await unconfirmed(f.runtime.finish(f.taskId))
    } finally { f.runtime.stop() }
  }
}

export async function verifyRound6(root: string, db: AgentDatabase): Promise<void> {
  await verifyDeliveryRefreshesExpiredLeaseSamePdf(path.join(root, 'offline'), db)
  await verifyExpiredRetryProbesDeliveryResult(path.join(root, 'expired'), db)
  await verifySoftDeadlineSurvivesSuccessfulRenewals(path.join(root, 'soft'), db)
  await verifyLeaseRefreshFailureStaysUncertain(path.join(root, 'no-lease'), db)
  await verifyHardDeadlineStillWins(path.join(root, 'hard'), db)
  verifyDeliveryDeadlineNeverMoves()
  console.log('verify-scan-device-runner-r6: ok（6 组）')
}
