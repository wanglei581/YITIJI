import type { PrismaService } from '../prisma/prisma.service'
import { KIOSK_SESSION_IDLE_EXPIRY_MS } from '../kiosk-session/kiosk-session.types'
import { anotherOpenOrderHoldsRef } from './service-order.ref'
import {
  SERVICE_CONSUMED_REVIEW_AFTER_MS,
  SERVICE_REFUND_REASON_DISPLACED,
  SERVICE_REFUND_REASON_LEFT,
  SERVICE_REFUND_REASON_RETRY_EXPIRED,
  SERVICE_REFUND_RETRY_CAP,
  SERVICE_SCAN_JUDGE_AFTER_MS,
  SERVICE_SCAN_PENDING_LIMIT_MS,
  SERVICE_SWEEP_BATCH,
  type ServiceTripEvent,
} from './service-order.policy'

type Db = PrismaService

export interface ServiceOrderSweepDeps {
  prisma: Db
  now: Date
  refund(orderId: string, reason: string): Promise<unknown>
  markNotMade(orderId: string, event: ServiceTripEvent): Promise<void>
  finishMade(orderId: string): Promise<void>
}

const SCAN_TERMINAL = ['failed', 'cancelled', 'expired'] as const

/**
 * 每一拍把能判定的单做完。
 * 扫描只取占用最早的一批还没结案的，做成的写下 settledAt 后离开队列。
 * 否则全站做成 30 张以后，新的没出文件的扫描永远轮不到，也不会退。
 */
export async function drainServiceOrderSweep(deps: ServiceOrderSweepDeps): Promise<void> {
  await sweepRetryExpired(deps)
  await sweepRefunding(deps)
  await sweepPaidUnused(deps)
  await sweepConsumedTrips(deps)
  await releaseStuckInterviews(deps)
  await sweepScans(deps)
}

async function sweepRetryExpired(deps: ServiceOrderSweepDeps): Promise<void> {
  await eachBatch(async (cursor) => {
    const rows = await deps.prisma.serviceOrder.findMany({
      where: {
        status: 'paid',
        attemptsUsed: { gte: 1 },
        retryUntil: { lt: deps.now },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: SERVICE_SWEEP_BATCH,
    })
    for (const row of rows) {
      await deps.refund(row.id, SERVICE_REFUND_REASON_RETRY_EXPIRED)
    }
    return rows.map((row) => row.id)
  })
}

async function sweepRefunding(deps: ServiceOrderSweepDeps): Promise<void> {
  await eachBatch(async (cursor) => {
    const rows = await deps.prisma.serviceOrder.findMany({
      where: {
        status: 'refunding',
        refundAttempts: { lt: SERVICE_REFUND_RETRY_CAP },
        OR: [{ nextRefundAt: null }, { nextRefundAt: { lte: deps.now } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, refundReason: true },
      orderBy: { id: 'asc' },
      take: SERVICE_SWEEP_BATCH,
    })
    for (const row of rows) {
      await deps.refund(row.id, row.refundReason ?? SERVICE_REFUND_REASON_LEFT)
    }
    return rows.map((row) => row.id)
  })
}

/** 已付还没用：人走了、会话过期、或付款后闲置超过上限，原路退。 */
async function sweepPaidUnused(deps: ServiceOrderSweepDeps): Promise<void> {
  const idleBefore = new Date(deps.now.getTime() - KIOSK_SESSION_IDLE_EXPIRY_MS)
  await eachBatch(async (cursor) => {
    const rows = await deps.prisma.serviceOrder.findMany({
      where: {
        status: 'paid',
        attemptsUsed: 0,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: SERVICE_SWEEP_BATCH,
    })
    for (const row of rows) {
      if (await paidUnusedLeft(deps, row, idleBefore)) {
        await deps.refund(row.id, SERVICE_REFUND_REASON_LEFT)
      }
    }
    return rows.map((row) => row.id)
  })
}

async function paidUnusedLeft(
  deps: ServiceOrderSweepDeps,
  row: { terminalId: string; kioskSessionId: string; paidAt: Date | null },
  idleBefore: Date,
): Promise<boolean> {
  if (row.paidAt && row.paidAt.getTime() < idleBefore.getTime()) return true
  const session = await deps.prisma.kioskSession.findUnique({
    where: { terminalId_clientSessionId: { terminalId: row.terminalId, clientSessionId: row.kioskSessionId } },
    select: { endedAt: true, expiresAt: true },
  })
  if (!session) return true
  if (session.endedAt) return true
  return session.expiresAt.getTime() < deps.now.getTime()
}

async function sweepConsumedTrips(deps: ServiceOrderSweepDeps): Promise<void> {
  const cutoff = new Date(deps.now.getTime() - SERVICE_CONSUMED_REVIEW_AFTER_MS)
  await eachBatch(async (cursor) => {
    const rows = await deps.prisma.serviceOrder.findMany({
      where: {
        status: 'consumed',
        settledAt: null,
        serviceKey: { in: ['resume_optimize', 'mock_interview'] },
        consumedAt: { lt: cutoff },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: SERVICE_SWEEP_BATCH,
    })
    for (const row of rows) {
      if (row.serviceKey === 'resume_optimize') await judgeResume(deps, row.id, row.consumedRef)
      else await judgeInterview(deps, row.id, row.consumedRef)
    }
    return rows.map((row) => row.id)
  })
}

async function judgeResume(deps: ServiceOrderSweepDeps, orderId: string, consumedRef: string | null): Promise<void> {
  if (await anotherOpenOrderHoldsRef(deps.prisma, orderId, 'resume_optimize', consumedRef)) {
    await deps.refund(orderId, SERVICE_REFUND_REASON_DISPLACED)
    return
  }
  if (!consumedRef) {
    await deps.markNotMade(orderId, 'optimize_failed')
    return
  }
  const saved = await deps.prisma.aiResumeResult.findUnique({
    where: { taskId_kind: { taskId: consumedRef, kind: 'optimize' } },
    select: { status: true },
  })
  if (saved?.status === 'completed') await deps.finishMade(orderId)
  else await deps.markNotMade(orderId, 'optimize_failed')
}

async function judgeInterview(deps: ServiceOrderSweepDeps, orderId: string, consumedRef: string | null): Promise<void> {
  if (await anotherOpenOrderHoldsRef(deps.prisma, orderId, 'mock_interview', consumedRef)) {
    await deps.refund(orderId, SERVICE_REFUND_REASON_DISPLACED)
    return
  }
  if (!consumedRef) {
    await deps.markNotMade(orderId, 'interview_not_opened')
    return
  }
  const opened = await deps.prisma.mockInterviewTurn.findFirst({
    where: { sessionId: consumedRef, role: 'interviewer' },
    select: { id: true },
  })
  if (opened) await deps.finishMade(orderId)
  else {
    await releaseInterviewSession(deps.prisma, consumedRef)
    await deps.markNotMade(orderId, 'interview_not_opened')
  }
}

/** 卡在进行中、又没有面试官第一题的场次，复位后才能重新开始。 */
async function releaseStuckInterviews(deps: ServiceOrderSweepDeps): Promise<void> {
  const cutoff = new Date(deps.now.getTime() - SERVICE_CONSUMED_REVIEW_AFTER_MS)
  await eachBatch(async (cursor) => {
    const rows = await deps.prisma.mockInterviewSession.findMany({
      where: {
        status: 'in_progress',
        turns: { none: { role: 'interviewer' } },
        OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, updatedAt: { lt: cutoff } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: SERVICE_SWEEP_BATCH,
    })
    for (const row of rows) await releaseInterviewSession(deps.prisma, row.id)
    return rows.map((row) => row.id)
  })
}

export async function releaseInterviewSession(prisma: Db, sessionId: string): Promise<void> {
  await prisma.mockInterviewSession.updateMany({
    where: { id: sessionId, status: 'in_progress', turns: { none: { role: 'interviewer' } } },
    data: { status: 'configured', startedAt: null, deadlineAt: null },
  })
}

/**
 * 只判占用最早的一批。做成的写下 settledAt，下一拍不再入选。
 * 调用方每一拍只走一批；做成的离开后，没出文件的才会轮到。
 * 排序必须是 consumedAt 升序，否则新的没出文件的单会被做成的单挡住。
 */
async function sweepScans(deps: ServiceOrderSweepDeps): Promise<void> {
  const cutoff = new Date(deps.now.getTime() - SERVICE_SCAN_JUDGE_AFTER_MS)
  const rows = await deps.prisma.serviceOrder.findMany({
    where: {
      status: 'consumed',
      serviceKey: 'scan',
      settledAt: null,
      consumedAt: { lt: cutoff },
    },
    orderBy: [{ consumedAt: 'asc' }, { id: 'asc' }],
    take: SERVICE_SWEEP_BATCH,
  })
  for (const row of rows) await judgeScan(deps, row)
}

async function judgeScan(
  deps: ServiceOrderSweepDeps,
  row: { id: string; consumedRef: string | null; consumedAt: Date | null },
): Promise<void> {
  const ref = row.consumedRef
  if (await anotherOpenOrderHoldsRef(deps.prisma, row.id, 'scan', ref)) {
    await deps.refund(row.id, SERVICE_REFUND_REASON_DISPLACED)
    return
  }
  if (!ref || ref === 'pending') {
    if (row.consumedAt && row.consumedAt.getTime() < deps.now.getTime() - SERVICE_SCAN_PENDING_LIMIT_MS) {
      await deps.markNotMade(row.id, 'scan_no_file')
    }
    return
  }
  const task = await deps.prisma.scanTask.findUnique({
    where: { id: ref },
    select: { fileId: true, status: true },
  })
  if (task?.fileId) {
    await deps.finishMade(row.id)
    return
  }
  const missing = !task
  const dead = Boolean(task && (SCAN_TERMINAL as readonly string[]).includes(task.status) && !task.fileId)
  const pendingTooLong = Boolean(
    row.consumedAt && row.consumedAt.getTime() < deps.now.getTime() - SERVICE_SCAN_PENDING_LIMIT_MS,
  )
  if (missing || dead || pendingTooLong) await deps.markNotMade(row.id, 'scan_no_file')
}

/** 游标只往前走。处理完的行会离开条件；没离开的也不会被反复选中。 */
async function eachBatch(load: (cursor: string | null) => Promise<string[]>): Promise<void> {
  let cursor: string | null = null
  for (;;) {
    const ids = await load(cursor)
    if (ids.length === 0) return
    const next = ids[ids.length - 1]
    if (!next || next === cursor) return
    cursor = next
    if (ids.length < SERVICE_SWEEP_BATCH) return
  }
}
