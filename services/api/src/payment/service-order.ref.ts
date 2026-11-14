import { ConflictException, HttpException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import {
  SERVICE_REFUND_REASON_DISPLACED,
  SERVICE_SCAN_PENDING_LIMIT_MS,
  type ServiceOrderKey,
} from './service-order.policy'

type Db = PrismaService

/** 没结案、还占着这个任务的状态。退款中及之后不再占唯一索引。 */
export const SERVICE_OPEN_ORDER_STATUSES = ['pending', 'paid', 'consumed'] as const

type OpenOrder = NonNullable<Awaited<ReturnType<Db['serviceOrder']['findFirst']>>>

export interface OpenRefDeps {
  prisma: Db
  now: Date
  refund(orderId: string, reason: string): Promise<unknown>
  releaseInterview?(sessionId: string): Promise<void>
}

/**
 * 同一服务、同一 consumedRef，同一时刻最多一张没结案的单。
 * 旧单能判没做成就当场退掉，让新单接手；判不了就 409，新单保持已付未用。
 */
export function serviceOrderRefOccupied(existingOrderId: string): HttpException {
  return new ConflictException({
    error: {
      code: 'SERVICE_ORDER_REF_OCCUPIED',
      message: '这一趟已经有一张没结案的付款单',
      existingOrderId,
    },
  })
}

export function isServiceOrderOpenRefConflict(error: unknown): boolean {
  const seen = new Set<unknown>()
  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    const record = value as {
      code?: unknown
      message?: unknown
      meta?: { message?: unknown }
      cause?: unknown
    }
    const message = `${typeof record.message === 'string' ? record.message : ''} ${typeof record.meta?.message === 'string' ? record.meta.message : ''}`
    if (/ServiceOrder_open_consumed_ref_key|UNIQUE constraint failed|duplicate key value violates unique constraint/i.test(message)) {
      return true
    }
    if (record.code === 'P2002' && /consumedRef|ServiceOrder_open_consumed_ref/i.test(message)) return true
    return walk(record.cause)
  }
  return walk(error)
}

export async function anotherOpenOrderHoldsRef(
  prisma: Db,
  orderId: string,
  serviceKey: string,
  consumedRef: string | null,
): Promise<boolean> {
  if (!consumedRef || consumedRef === 'pending') return false
  const other = await prisma.serviceOrder.findFirst({
    where: {
      id: { not: orderId },
      serviceKey,
      consumedRef,
      status: { in: [...SERVICE_OPEN_ORDER_STATUSES] },
    },
    select: { id: true },
  })
  return Boolean(other)
}

/** 认领前处理同一任务上还没结案的旧单。pending 占位不参与。 */
export async function displaceOrBlockOpenRef(
  deps: OpenRefDeps,
  input: { serviceKey: ServiceOrderKey; consumedRef: string; incomingOrderId: string },
): Promise<void> {
  if (!input.consumedRef || input.consumedRef === 'pending') return
  const siblings = await deps.prisma.serviceOrder.findMany({
    where: {
      serviceKey: input.serviceKey,
      consumedRef: input.consumedRef,
      id: { not: input.incomingOrderId },
      status: { in: [...SERVICE_OPEN_ORDER_STATUSES] },
    },
    orderBy: { id: 'asc' },
  })
  for (const sibling of siblings) {
    const verdict = await judgeOpenSibling(deps, sibling)
    if (verdict === 'block') throw serviceOrderRefOccupied(sibling.id)
    if (sibling.serviceKey === 'mock_interview' && sibling.consumedRef && deps.releaseInterview) {
      await deps.releaseInterview(sibling.consumedRef)
    }
    await deps.refund(sibling.id, SERVICE_REFUND_REASON_DISPLACED)
    const fresh = await deps.prisma.serviceOrder.findUnique({
      where: { id: sibling.id },
      select: { status: true },
    })
    if (fresh && (SERVICE_OPEN_ORDER_STATUSES as readonly string[]).includes(fresh.status)) {
      throw serviceOrderRefOccupied(sibling.id)
    }
  }
}

/**
 * 一个扫描任务只能挂在一张还没结案的单上。
 * 唯一索引挡住并发两条都写上；冲突当没挂上，调用方退回这一次占用。
 */
export async function attachServiceOrderConsumedRef(db: Db, orderId: string, consumedRef: string): Promise<boolean> {
  if (!consumedRef || consumedRef === 'pending') return false
  const mine = await db.serviceOrder.findUnique({ where: { id: orderId }, select: { serviceKey: true, status: true } })
  if (!mine || mine.status !== 'consumed') return false
  try {
    const changed = await db.$transaction((tx) => tx.$executeRaw`
      UPDATE "ServiceOrder"
      SET "consumedRef" = ${consumedRef}, "updatedAt" = ${new Date()}
      WHERE "id" = ${orderId}
        AND "status" = 'consumed'
        AND ("consumedRef" IS NULL OR "consumedRef" = 'pending' OR "consumedRef" = ${consumedRef})
        AND NOT EXISTS (
          SELECT 1 FROM "ServiceOrder" AS other
          WHERE other."serviceKey" = ${mine.serviceKey}
            AND other."consumedRef" = ${consumedRef}
            AND other."id" <> ${orderId}
            AND other."status" IN ('pending', 'paid', 'consumed')
        )
    `)
    return Number(changed) === 1
  } catch (error) {
    if (isServiceOrderOpenRefConflict(error)) return false
    throw error
  }
}

async function judgeOpenSibling(deps: OpenRefDeps, sibling: OpenOrder): Promise<'yield' | 'block'> {
  const ref = sibling.consumedRef
  if (!ref || ref === 'pending') return 'block'
  if (sibling.serviceKey === 'resume_optimize') return judgeResumeSibling(deps.prisma, ref)
  if (sibling.serviceKey === 'mock_interview') return judgeInterviewSibling(deps.prisma, ref)
  if (sibling.serviceKey === 'scan') return judgeScanSibling(deps, sibling, ref)
  return 'block'
}

/** 没有优化稿，或稿是失败：旧单没做成。做成了或还在写：不能把旧单退掉再收一笔。 */
async function judgeResumeSibling(prisma: Db, taskId: string): Promise<'yield' | 'block'> {
  const saved = await prisma.aiResumeResult.findUnique({
    where: { taskId_kind: { taskId, kind: 'optimize' } },
    select: { status: true },
  })
  if (!saved || saved.status === 'failed') return 'yield'
  return 'block'
}

/** 没有面试官第一题：这场没开起来，可以退掉并让新单重新开始。 */
async function judgeInterviewSibling(prisma: Db, sessionId: string): Promise<'yield' | 'block'> {
  const opened = await prisma.mockInterviewTurn.findFirst({
    where: { sessionId, role: 'interviewer' },
    select: { id: true },
  })
  return opened ? 'block' : 'yield'
}

/**
 * 有文件，或会话还活着且没过期：判不了，新单不能再占。
 * 失败、取消、过期，或任务不在了且已过判定期：旧单没做成。
 */
async function judgeScanSibling(deps: OpenRefDeps, sibling: OpenOrder, ref: string): Promise<'yield' | 'block'> {
  const task = await deps.prisma.scanTask.findUnique({
    where: { id: ref },
    select: { fileId: true, status: true, expiresAt: true },
  })
  if (task?.fileId) return 'block'
  if (!task) {
    const age = sibling.consumedAt ? deps.now.getTime() - sibling.consumedAt.getTime() : SERVICE_SCAN_PENDING_LIMIT_MS
    return age >= SERVICE_SCAN_PENDING_LIMIT_MS ? 'yield' : 'block'
  }
  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') return 'yield'
  if (task.expiresAt.getTime() <= deps.now.getTime()) return 'yield'
  return 'block'
}
