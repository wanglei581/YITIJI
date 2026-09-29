// ============================================================================
// AI 用量账的到期清理与会员解绑。
//
// 为什么独立成文件：ai-result.cleanup.task.ts 已经是每小时 cron 的壳，负责简历结果、
// 岗位 AI 会话和 AI 服务日志。月汇总的唯一键 upsert、北京时间月份、分批标记与删除、
// 会员注销置空，是另一本金额账，不能再堆进那个壳。
//
// 保留期不在这里读。调用方传入与 AiServiceLog 相同的天数（AI_SERVICE_LOG_RETENTION_DAYS，
// 默认 90）。本文件不另立 AI_USAGE_*_RETENTION。
//
// 会员注销处置：置空 endUserId，不删行（MEMBER_AI_USAGE_ON_CLOSURE = 'set_null'）。
// 选择置空而不是删除：明细是金额账，注销当天删掉则还没到 90 天清理、也就还没滚进月汇总，
// 这笔花费从长期账消失；月汇总故意不存会员号，置空后明细里不再有这个人，到期清理时金额仍能进汇总；
// 外键已经是 ON DELETE SET NULL，和 AiServiceLog 一样，但注销执行器按既有设计不直接 delete EndUser
// （先匿名化），外键不会自己触发，所以执行器要调用 detachMemberAiUsageRecords。
// 账号注销入口仍然拒绝，这道函数不从那个拒绝路径调用。
// ============================================================================

import { PrismaService } from '../../prisma/prisma.service'
import { beijingMonthKey } from './ai-usage-meter'
import { roundMoney } from './ai-pricing'

export const AI_USAGE_CLEANUP_BATCH_SIZE = 100
export const MEMBER_AI_USAGE_ON_CLOSURE = 'set_null' as const

export interface AiUsageCleanupResult {
  summarizedCount: number
  deletedCount: number
  retentionDays: number
}

interface UsageSlice {
  id: string
  createdAt: Date
  featureKey: string
  vendor: string
  model: string | null
  status: string
  costCny: number | null
  costMeasured: boolean
}

interface SummaryBucket {
  monthKey: string
  featureKey: string
  vendor: string
  model: string
  status: string
  callCount: number
  measuredCostCny: number
  unmeasuredCount: number
}

function foldBuckets(rows: readonly UsageSlice[]): SummaryBucket[] {
  const groups = new Map<string, SummaryBucket>()
  for (const row of rows) {
    const model = row.model ?? ''
    const monthKey = beijingMonthKey(row.createdAt)
    const key = JSON.stringify([monthKey, row.featureKey, row.vendor, model, row.status])
    let bucket = groups.get(key)
    if (!bucket) {
      bucket = {
        monthKey,
        featureKey: row.featureKey,
        vendor: row.vendor,
        model,
        status: row.status,
        callCount: 0,
        measuredCostCny: 0,
        unmeasuredCount: 0,
      }
      groups.set(key, bucket)
    }
    bucket.callCount += 1
    if (row.costMeasured && typeof row.costCny === 'number') {
      bucket.measuredCostCny = roundMoney(bucket.measuredCostCny + row.costCny)
    } else {
      bucket.unmeasuredCount += 1
    }
  }
  return [...groups.values()]
}

function assertBatchSize(batchSize: number): void {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('AI_USAGE_CLEANUP_BATCH_SIZE_INVALID')
  }
}

/**
 * 先把即将过期、还没汇总过的行滚进月汇总，再分批删掉已汇总的过期行。
 * 同一批的汇总和打标在一个事务里：打标行数对不上就整批回滚，避免并发重跑把金额加两次。
 * 未到期的行不进汇总、也不删。
 */
export async function cleanupExpiredAiUsageRecords(
  prisma: PrismaService,
  options: { now?: Date; retentionDays: number; batchSize?: number },
): Promise<AiUsageCleanupResult> {
  const batchSize = options.batchSize ?? AI_USAGE_CLEANUP_BATCH_SIZE
  assertBatchSize(batchSize)
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000)
  let summarizedCount = 0

  for (;;) {
    const rows = await prisma.aiUsageRecord.findMany({
      where: { createdAt: { lt: cutoff }, summarizedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: {
        id: true,
        createdAt: true,
        featureKey: true,
        vendor: true,
        model: true,
        status: true,
        costCny: true,
        costMeasured: true,
      },
    })
    if (rows.length === 0) break
    const markedAt = now
    await prisma.$transaction(async (tx) => {
      for (const bucket of foldBuckets(rows)) {
        await tx.aiUsageMonthlySummary.upsert({
          where: {
            monthKey_featureKey_vendor_model_status: {
              monthKey: bucket.monthKey,
              featureKey: bucket.featureKey,
              vendor: bucket.vendor,
              model: bucket.model,
              status: bucket.status,
            },
          },
          create: {
            monthKey: bucket.monthKey,
            featureKey: bucket.featureKey,
            vendor: bucket.vendor,
            model: bucket.model,
            status: bucket.status,
            callCount: bucket.callCount,
            measuredCostCny: bucket.measuredCostCny,
            unmeasuredCount: bucket.unmeasuredCount,
          },
          update: {
            callCount: { increment: bucket.callCount },
            measuredCostCny: { increment: bucket.measuredCostCny },
            unmeasuredCount: { increment: bucket.unmeasuredCount },
          },
        })
      }
      const marked = await tx.aiUsageRecord.updateMany({
        where: {
          id: { in: rows.map((row) => row.id) },
          summarizedAt: null,
          createdAt: { lt: cutoff },
        },
        data: { summarizedAt: markedAt },
      })
      if (marked.count !== rows.length) {
        throw new Error('AI_USAGE_SUMMARY_OWNERSHIP_CHANGED')
      }
    })
    summarizedCount += rows.length
  }

  let deletedCount = 0
  for (;;) {
    const rows = await prisma.aiUsageRecord.findMany({
      where: { createdAt: { lt: cutoff }, summarizedAt: { not: null } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: { id: true },
    })
    if (rows.length === 0) break
    const deleted = await prisma.aiUsageRecord.deleteMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        createdAt: { lt: cutoff },
        summarizedAt: { not: null },
      },
    })
    if (deleted.count === 0) throw new Error('AI_USAGE_CLEANUP_DELETE_STALLED')
    deletedCount += deleted.count
  }

  return { summarizedCount, deletedCount, retentionDays: options.retentionDays }
}

/**
 * 会员注销或删除个人数据时，把这个人的用量明细解绑。不删行。
 * 空会员号直接拒绝，避免一次把 endUserId 已经为空的行再扫一遍，或误伤全表。
 */
export async function detachMemberAiUsageRecords(
  prisma: PrismaService,
  endUserId: string,
  options?: { batchSize?: number },
): Promise<number> {
  if (typeof endUserId !== 'string' || endUserId.length === 0) {
    throw new Error('AI_USAGE_DETACH_REQUIRES_MEMBER')
  }
  const batchSize = options?.batchSize ?? AI_USAGE_CLEANUP_BATCH_SIZE
  assertBatchSize(batchSize)
  let total = 0
  for (;;) {
    const rows = await prisma.aiUsageRecord.findMany({
      where: { endUserId },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true },
    })
    if (rows.length === 0) break
    const updated = await prisma.aiUsageRecord.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, endUserId },
      data: { endUserId: null },
    })
    if (updated.count === 0) throw new Error('AI_USAGE_DETACH_STALLED')
    total += updated.count
  }
  return total
}
