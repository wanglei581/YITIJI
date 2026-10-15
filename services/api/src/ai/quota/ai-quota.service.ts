import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { AiQuotaReservation } from '../../generated/prisma/client'
import type { AiQuotaBucket } from '../../member-benefits/member-benefits.types'
import { PrismaService, type PrismaTransactionClient } from '../../prisma/prisma.service'
import { isSerializationConflict, waitBeforeSerializationRetry } from '../../common/prisma/serialization-conflict'
import { currentAiRequestContext } from '../usage/ai-usage-context'
import { activeGrants, AI_QUOTA_BUCKETS, dailyLimit, exhausted, hashQuotaOperation, quotaDay, quotaEnv, quotaResetsAt, RELEASE_REASONS, type ReleaseReason } from './ai-quota.policy'

export interface ReserveQuotaParams {
  bucket: AiQuotaBucket
  /** 原始操作号，仅作长度/字符校验；Q2 调用方负责签发并保证缓存重放语义。 */
  operationKey: string
  endUserId?: string | null
  terminalId?: string | null
  now?: Date
  allowCommittedReplay?: boolean
}
export interface QuotaReceipt {
  reservationId: string
  source: 'daily' | 'grant' | 'guest'
  replay: boolean
  day: string
}

@Injectable()
export class AiQuotaService {
  private readonly logger = new Logger(AiQuotaService.name)
  constructor(private readonly prisma: PrismaService) {}

  async reserve(params: ReserveQuotaParams): Promise<QuotaReceipt> {
    const now = params.now ?? new Date()
    const day = quotaDay(now)
    const operationKey = hashQuotaOperation(params.bucket, params.operationKey)
    const endUserId = params.endUserId || null
    const identity = await currentAiRequestContext()?.identity()
    // 即使调用方传 terminalId，也必须和上下文内已验签身份一致。无 HTTP 上下文的会员作业仍可用。
    const terminalId = identity?.terminalVerified && identity.terminalId
      && (!params.terminalId || params.terminalId === identity.terminalId) ? identity.terminalId : null
    if (!endUserId && !terminalId) exhausted(params.bucket, now)
    const limit = endUserId ? dailyLimit(params.bucket) : quotaEnv('AI_QUOTA_GUEST_TERMINAL_DAILY', 0)
    if (!endUserId && limit === 0) exhausted(params.bucket, now)
    const key = this.dailyKey(endUserId, terminalId, params.bucket, day)
    // 在事务外确保行存在。PG 事务中捕获唯一冲突后继续 SQL 会得到 25P02。
    try {
      await this.prisma.aiQuotaDaily.create({ data: { ...key, used: 0 } })
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
    }
    return this.transaction(async (tx) => {
      const existing = await tx.aiQuotaReservation.findUnique({ where: { operationKey } })
      if (existing) {
        if (existing.endUserId !== endUserId || (!endUserId && existing.terminalId !== terminalId)) {
          throw new ConflictException('AI_QUOTA_OPERATION_OWNER_MISMATCH')
        }
        if (existing.status === 'reserved' || (existing.status === 'committed' && params.allowCommittedReplay === true && existing.resultRef)) {
          return this.receipt(existing, true)
        }
        throw new ConflictException({ error: { code: 'AI_QUOTA_OPERATION_SETTLED', message: '该操作已结算，请使用新的操作号' } })
      }
      const charged = await tx.aiQuotaDaily.updateMany({
        where: { ...key, used: { lt: limit } }, data: { used: { increment: 1 } },
      })
      let source: QuotaReceipt['source'] = endUserId ? 'daily' : 'guest'
      let benefitGrantId: string | null = null
      if (!charged.count && endUserId) {
        const where = activeGrants(endUserId, params.bucket, now)
        const grants = await tx.benefitGrant.findMany({ where,
          orderBy: [{ validUntil: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }],
        })
        for (const grant of grants) {
          const changed = await tx.benefitGrant.updateMany({ where: { ...where, id: grant.id }, data: { quantityRemaining: { decrement: 1 } } })
          if (changed.count) { benefitGrantId = grant.id; source = 'grant'; break }
        }
      }
      if (!charged.count && !benefitGrantId) exhausted(params.bucket, now)
      const row = await tx.aiQuotaReservation.create({ data: {
        operationKey, endUserId, terminalId, bucket: params.bucket, source, day, benefitGrantId, status: 'reserved', reservedAt: now,
      } })
      return this.receipt(row, false)
    })
  }

  async commit(reservationId: string, options: { resultRef: string }): Promise<void> {
    if (typeof options?.resultRef !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(options.resultRef)) {
      throw new BadRequestException({ error: { code: 'AI_QUOTA_RESULT_REQUIRED', message: '请先保存 AI 服务记录，再提交结果号' } })
    }
    await this.transaction(async (tx) => {
      const row = await this.find(tx, reservationId)
      if (row.status === 'committed' && row.resultRef === options.resultRef) return
      if (row.status !== 'reserved') throw new ConflictException('AI_QUOTA_NOT_RESERVED')
      await tx.aiQuotaReservation.update({ where: { id: row.id }, data: { status: 'committed', resultRef: options.resultRef, settledAt: new Date() } })
      await this.recordGrant(tx, row)
    })
  }

  async release(reservationId: string, reason: ReleaseReason, now = new Date()): Promise<void> {
    if (!RELEASE_REASONS.includes(reason)) throw new BadRequestException('AI_QUOTA_RELEASE_REASON_INVALID')
    quotaDay(now)
    const capped = await this.transaction(async (tx) => {
      const row = await this.find(tx, reservationId)
      if (row.status === 'released') return false
      if (row.status !== 'reserved') throw new ConflictException('AI_QUOTA_COMMITTED_CANNOT_RELEASE')
      // 跨桶共用每天归还上限，按预占日统计；Serializable 防多个释放同时越过上限。
      const owner = row.endUserId ? { endUserId: row.endUserId } : { endUserId: null, terminalId: row.terminalId }
      const releases = await tx.aiQuotaReservation.count({ where: { ...owner, day: row.day, status: 'released' } })
      const capped = releases >= quotaEnv('AI_QUOTA_AUTO_RELEASE_DAILY_CAP', 5)
      let refunded = false
      if (!capped) {
        if (row.source === 'grant') {
          refunded = Boolean((await tx.benefitGrant.updateMany({ where: {
            id: row.benefitGrantId!, status: 'active',
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          }, data: { quantityRemaining: { increment: 1 } } })).count)
        } else {
          const key = this.dailyKey(row.endUserId, row.terminalId, row.bucket as AiQuotaBucket, row.day)
          refunded = Boolean((await tx.aiQuotaDaily.updateMany({ where: { ...key, used: { gt: 0 } }, data: { used: { decrement: 1 } } })).count)
        }
      }
      // 失败超限属于惩罚性扣次，无成功结果可引用。只此内部路径允许 committed/resultRef=null。
      await tx.aiQuotaReservation.update({ where: { id: row.id }, data: { status: capped ? 'committed' : 'released', settledAt: now } })
      if (capped) await this.recordGrant(tx, row)
      await tx.auditLog.create({ data: {
        actorId: null, actorRole: 'system', action: capped ? 'ai_quota.release_cap_exceeded' : 'ai_quota.released',
        targetType: 'AiQuotaReservation', targetId: row.id,
        payloadJson: JSON.stringify({ endUserId: row.endUserId, terminalId: row.terminalId, bucket: row.bucket, day: row.day, reason, refunded, releases }),
      } })
      return capped
    })
    if (capped) this.logger.warn(`AI_QUOTA_AUTO_RELEASE_CAP_EXCEEDED reservationId=${reservationId}`)
  }

  async sweepStale(now = new Date()): Promise<{ releasedCount: number }> {
    let releasedCount = 0
    for (;;) {
      const rows = await this.prisma.aiQuotaReservation.findMany({ where: { status: 'reserved', reservedAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, take: 500, orderBy: { reservedAt: 'asc' } })
      for (const row of rows) {
        try { await this.release(row.id, 'stale', now); releasedCount++ } catch (error) {
          if (!(error instanceof ConflictException)) throw error
        }
      }
      if (rows.length < 500) break
    }
    return { releasedCount }
  }

  async remaining({ endUserId, now = new Date() }: { endUserId: string; now?: Date }) {
    if (!endUserId) throw new BadRequestException('AI_QUOTA_MEMBER_REQUIRED')
    const day = quotaDay(now)
    return Promise.all(AI_QUOTA_BUCKETS.map(async (bucket) => {
      const row = await this.prisma.aiQuotaDaily.findUnique({ where: { endUserId_bucket_day: this.dailyKey(endUserId, null, bucket, day) } })
      const grants = await this.prisma.benefitGrant.findMany({ where: activeGrants(endUserId, bucket, now), select: { quantityRemaining: true, validUntil: true } })
      const expiries = grants.flatMap((g) => g.validUntil ? [g.validUntil.getTime()] : [])
      const limit = dailyLimit(bucket)
      return { bucket, dailyLimit: limit, dailyUsed: row?.used ?? 0, dailyRemaining: Math.max(0, limit - (row?.used ?? 0)),
        extraRemaining: grants.reduce((sum, g) => sum + (g.quantityRemaining ?? 0), 0),
        extraEarliestExpiry: expiries.length ? new Date(Math.min(...expiries)).toISOString() : null, resetsAt: quotaResetsAt(now) }
    }))
  }

  private dailyKey(endUserId: string | null, terminalId: string | null, bucket: AiQuotaBucket, day: string) {
    return { endUserId: endUserId ? `member:${endUserId}` : `terminal:${terminalId}`, bucket: endUserId ? bucket : 'guest', day }
  }
  private receipt(row: AiQuotaReservation, replay: boolean): QuotaReceipt {
    return { reservationId: row.id, source: row.source as QuotaReceipt['source'], replay, day: row.day }
  }
  private async find(tx: PrismaTransactionClient, id: string) {
    const row = await tx.aiQuotaReservation.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('AI_QUOTA_RESERVATION_NOT_FOUND')
    return row
  }
  private async recordGrant(tx: PrismaTransactionClient, row: AiQuotaReservation): Promise<void> {
    if (row.source !== 'grant') return
    // 沿用 free_quota 合规核销类型；ai_quota 不加入旧 redeem() 白名单，避免 AI 次数被拿去抵打印等服务。
    await tx.redemptionRecord.create({ data: {
      endUserId: row.endUserId, kind: 'free_quota', benefitRef: row.benefitGrantId!, serviceType: row.bucket, serviceRefId: row.operationKey,
      quantity: 1, amountCents: 0, idempotencyKey: createHash('sha256').update(`${row.benefitGrantId}:${row.bucket}:${row.operationKey}`).digest('hex'),
    } })
  }
  private async transaction<T>(fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(fn, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 10_000 }) } catch (error) {
        // 唯一冲突（同 operationKey）回滚整个扣次后重试，重新检查归属与重放状态。
        const code = (error as { code?: string }).code
        if (attempt >= 11 || !(isSerializationConflict(error) || code === 'P2002' || /SQLITE_BUSY|database is locked/.test(String(error)))) throw error
        await waitBeforeSerializationRetry(attempt + 1)
      }
    }
  }
}
