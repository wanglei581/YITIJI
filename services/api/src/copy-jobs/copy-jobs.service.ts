import { Injectable } from '@nestjs/common'
import { randomBytes, randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { OrderStatusService } from '../payment/order-status.service'
import { assertFreePrintQuota } from '../print-jobs/free-print-quota.decide'
import { PrismaService } from '../prisma/prisma.service'
import { COPY_COLOR_MODES, COPY_DUPLEX_MODES, COPY_SOURCES, type CreateCopyJobInput } from './copy-job.types'
import { assertCopyCombination, assertCopyLimits, COPY_LIFETIME_MS, copyError } from './copy-job.policy'
import { CopyJobStore, copyDigest } from './copy-job-store.service'

@Injectable()
export class CopyJobsService {
  constructor(private readonly store: CopyJobStore) {}

  async create(input: CreateCopyJobInput, endUserId: string | null) {
    assertCopyLimits({ copies: input.copies, pageCount: 1 })
    if (!COPY_COLOR_MODES.includes(input.colorMode) || !COPY_DUPLEX_MODES.includes(input.duplex)
      || !COPY_SOURCES.includes(input.source) || !/^[\w-]{16,128}$/.test(input.requestKey)) {
      copyError(400, 'COPY_BAD_REQUEST')
    }
    const prisma = this.store.prisma
    const prior = await prisma.copyJob.findUnique({
      where: { terminalId_requestKey: { terminalId: input.terminalId, requestKey: input.requestKey } },
    })
    if (prior) return this.replay(prior.id, input, endUserId)
    const terminal = await this.store.capable(input)
    const id = randomUUID()
    const controlToken = randomBytes(32).toString('hex')
    // 先存秘密的哈希，失败时不能建出无控制凭证的单；数据库失败只遗留短 TTL 的随机孤键。
    await this.store.redis.set(`copy:control:${id}`, copyDigest(controlToken), COPY_LIFETIME_MS / 1000 + 60)
    try {
      const job = await prisma.copyJob.create({ data: { ...input, id, endUserId,
        organizationId: terminal.orgId!, generation: 1, expiresAt: new Date(Date.now() + COPY_LIFETIME_MS) } })
      await this.store.record('create', job)
      return { ...await this.store.view(job), controlToken }
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      const winner = await prisma.copyJob.findUniqueOrThrow({
        where: { terminalId_requestKey: { terminalId: input.terminalId, requestKey: input.requestKey } },
      })
      return this.replay(winner.id, input, endUserId)
    }
  }

  private async replay(id: string, input: CreateCopyJobInput, endUserId: string | null) {
    const job = await this.store.find(id, input.terminalId)
    if (job.source !== input.source || job.copies !== input.copies || job.colorMode !== input.colorMode
      || job.duplex !== input.duplex || job.endUserId !== endUserId) copyError(409, 'COPY_IDEMPOTENCY_CONFLICT')
    // 建单重试只返回同一单的元数据，永不重发或轮换控制令牌。
    return this.store.view(job)
  }

  async get(id: string, terminalId: string, user: string | null, token?: string) {
    return this.store.view(await this.store.control(id, terminalId, user, token))
  }

  async cancel(id: string, terminalId: string, user: string | null, token: string | undefined, generation: number) {
    const job = await this.store.control(id, terminalId, user, token)
    if (job.generation !== generation) copyError(409, 'COPY_STALE_GENERATION')
    // 派发后只读实际状态，不承诺能够停止打印。
    const changed = await this.store.prisma.copyJob.updateMany({ where: { id, generation,
      state: { in: ['ready', 'scanning', 'scanned', 'confirmed'] } },
    data: { state: 'cancelled', authorizationVersion: { increment: 1 } } })
    if (changed.count) await this.store.record('cancel', job)
    return this.store.view(await this.store.find(id))
  }

  async confirm(id: string, terminalId: string, user: string | null, token: string | undefined, quoteVersion: string) {
    await this.store.control(id, terminalId, user, token)
    // 事务中的 CAS 先占住 CopyJob，之后建单、免费入账与关联一起提交；落空者重读原订单。
    return this.store.prisma.$transaction(async (tx) => {
      const job = await this.store.find(id, terminalId, tx)
      const params = { ...job, colorMode: job.colorMode as CreateCopyJobInput['colorMode'],
        duplex: job.duplex as CreateCopyJobInput['duplex'] }
      if (job.orderId) return this.store.view(job, tx)
      this.store.assertActive(job)
      await this.store.capable(params, tx)
      if (job.state !== 'scanned') copyError(409, 'COPY_STATE_CONFLICT')
      assertCopyCombination(params)
      const result = await this.store.quote(job, tx)
      if (!result.quotable) copyError(409, result.code)
      if (result.quote.amountCents !== 0) copyError(409, 'COPY_PAID_NOT_SUPPORTED')
      if (copyDigest(JSON.stringify(result.quote)) !== quoteVersion) {
        copyError(409, 'COPY_QUOTE_CHANGED', { quote: result.quote,
          quoteVersion: copyDigest(JSON.stringify(result.quote)) })
      }
      // 复印与打印共用三条免费额度，占单建单前判；超额与打印同一 429 错误码，提示语换成复印的说法。
      await assertFreePrintQuota(tx, { terminalId: job.terminalId, endUserId: job.endUserId,
        requestedSides: result.quote.billableSides, payableCents: result.quote.amountCents, subject: 'copy' })
      const claimed = await tx.copyJob.updateMany({ where: { id, state: 'scanned', orderId: null,
        generation: job.generation, pageCount: job.pageCount, expiresAt: { gt: new Date() } },
      data: { state: 'confirmed', authorizationVersion: { increment: 1 } } })
      if (!claimed.count) {
        const fresh = await this.store.find(id, terminalId, tx)
        if (fresh.orderId) return this.store.view(fresh, tx)
        copyError(409, 'COPY_STATE_CONFLICT')
      }
      const order = await tx.order.create({ data: {
        orderNo: `COPY-${randomUUID()}`, type: 'copy', terminalId: job.terminalId,
        endUserId: job.endUserId, amountCents: 0,
        billablePages: job.pageCount, billingPageSource: 'terminal_scan', itemsJson: JSON.stringify([result.quote]),
      } })
      // 同一个既有状态机绑定当前事务。markPaid 在此路径仅访问订单/审计，绝无文件或新支付体系。
      const scopedPrisma = tx as unknown as PrismaService
      await new OrderStatusService(scopedPrisma, new AuditService(scopedPrisma))
        .markPaid(order.id, { paymentSource: 'free' })
      const updated = await tx.copyJob.update({ where: { id }, data: { orderId: order.id,
        billableSides: result.quote.billableSides, quoteSnapshot: JSON.stringify(result.quote) } })
      await this.store.audit.writeRequired(tx, { actorId: null, actorRole: 'system', action: 'copy.confirm',
        targetType: 'copy_job', targetId: id, payload: { orderId: order.id, generation: job.generation } })
      return this.store.view(updated, tx)
    })
  }
}
