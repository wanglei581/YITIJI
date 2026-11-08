import { Injectable } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'node:crypto'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { RedisService } from '../common/redis/redis.service'
import { evaluateCopyCapabilities } from '../terminals/terminal-capabilities.types'
import { quoteCopy } from '../payment/copy-pricing'
import { COPY_ENDED, copyError } from './copy-job.policy'
import type { CopyJobView, CopyPriceInput, CopyPriceQuote } from './copy-job.types'

export type CopyRow = NonNullable<Awaited<ReturnType<PrismaService['copyJob']['findUnique']>>>
export type CopyDb = Pick<PrismaTransactionClient, 'copyJob' | 'terminal' | 'terminalCapability' | 'priceConfig' | 'order'>
export const copyDigest = (value: string) => createHash('sha256').update(value).digest('hex')

@Injectable()
export class CopyJobStore {
  constructor(readonly prisma: PrismaService, readonly redis: RedisService, readonly audit: AuditService) {}

  async find(id: string, terminalId?: string, db: CopyDb = this.prisma): Promise<CopyRow> {
    const job = await db.copyJob.findUnique({ where: { id } })
    if (!job || (terminalId && job.terminalId !== terminalId)) copyError(404, 'COPY_NOT_FOUND')
    return job
  }

  async control(id: string, terminalId: string, endUserId: string | null, token?: string) {
    const job = await this.find(id, terminalId)
    const hash = await this.redis.get(`copy:control:${id}`)
    if (!token || !hash || !/^[a-f0-9]{64}$/.test(hash)
      || !timingSafeEqual(Buffer.from(copyDigest(token), 'hex'), Buffer.from(hash, 'hex'))
      || (endUserId !== null && job.endUserId !== endUserId)) copyError(403, 'COPY_UNAUTHORIZED')
    return job
  }

  assertActive(job: CopyRow) {
    if (job.expiresAt.getTime() <= Date.now()) copyError(410, 'COPY_EXPIRED')
    if (COPY_ENDED.includes(job.state)) copyError(409, 'COPY_STATE_CONFLICT')
  }

  async capable(job: { terminalId: string } & Pick<CopyPriceInput, 'colorMode' | 'duplex'>, db: CopyDb = this.prisma) {
    const terminal = await db.terminal.findUnique({ where: { id: job.terminalId } })
    const rows = await db.terminalCapability.findMany({ where: { terminalId: job.terminalId } })
    const decision = evaluateCopyCapabilities(job, rows)
    if (!terminal?.enabled || terminal.lifecycleStatus !== 'active' || !terminal.orgId || !decision.allowed) {
      copyError(409, 'COPY_CAPABILITY_REVOKED', decision)
    }
    return terminal
  }

  async quote(job: CopyRow, db: CopyDb = this.prisma) {
    return quoteCopy({ ...job, colorMode: job.colorMode as CopyPriceInput['colorMode'],
      duplex: job.duplex as CopyPriceInput['duplex'] }, db)
  }

  async view(job: CopyRow, db: CopyDb = this.prisma): Promise<CopyJobView> {
    let quote: CopyPriceQuote | null = null
    let quoteError: string | null = null
    if (job.quoteSnapshot) quote = JSON.parse(job.quoteSnapshot) as CopyPriceQuote
    else if (job.pageCount > 0) {
      const result = await this.quote(job, db)
      if (result.quotable) quote = result.quote
      else quoteError = result.code
    }
    return {
      copyId: job.id, terminalId: job.terminalId, state: job.state as CopyJobView['state'],
      source: job.source as CopyJobView['source'], colorMode: job.colorMode as CopyJobView['colorMode'],
      duplex: job.duplex as CopyJobView['duplex'], copies: job.copies, pageCount: job.pageCount,
      generation: job.generation, authorizationVersion: job.authorizationVersion,
      expiresAt: job.expiresAt.toISOString(), orderId: job.orderId, resultCode: job.resultCode,
      quote, quoteVersion: quote ? copyDigest(JSON.stringify(quote)) : null, quoteError,
    }
  }

  async record(action: string, job: CopyRow, payload: Record<string, unknown> = {}) {
    await this.audit.write({ actorId: null, actorRole: 'system', action: `copy.${action}`,
      targetType: 'copy_job', targetId: job.id,
      payload: { terminalId: job.terminalId, generation: job.generation, ...payload } })
  }
}
