import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { randomBytes, randomUUID } from 'crypto'
import { RedisService } from '../common/redis/redis.service'
import { assessInvoiceEligibility, INVOICE_BLOCK_MESSAGES } from './invoice-eligibility'
import { InvoiceRequestsService, type SubmitInvoiceInput } from './invoice-requests.service'
import {
  INVOICE_SESSION_TTL_SECONDS,
  deriveInvoiceSubmitToken,
  hashInvoiceToken,
  invoiceCodeUrl,
  invoiceSceneIndexKey,
  invoiceSessionKey,
  invoiceSubmitLockKey,
  invoiceTokensEqual,
  isWellFormedInvoiceScene,
  mintInvoiceSceneToken,
  type InvoiceRedis,
} from './invoice-scene'

export const INVOICE_POLL_STATUS = {
  waiting: '等手机填写',
  submitted: '已提交',
  expired: '已过期',
} as const

export type InvoicePollStatus = (typeof INVOICE_POLL_STATUS)[keyof typeof INVOICE_POLL_STATUS]

const SUBMITTED_MESSAGE = '已提交。开好后，电子发票发到你填的邮箱。'
const EXPIRED_MESSAGE = '这个二维码已经过期。请回到一体机，重新扫码。'
const ALREADY_SUBMITTED_MESSAGE = '这份开票信息已经提交过了。请回到一体机查看。'

interface StoredInvoiceSession {
  sessionId: string
  orderKind: 'print' | 'service'
  orderId: string
  endUserId: string
  terminalId: string
  amountCents: number
  status: 'waiting' | 'submitted' | 'expired'
  sceneTokenHash: string
  submitTokenHash: string
  controlTokenHash: string
  invoiceRequestId: string | null
  expiresAt: string
}

export interface InvoiceSessionCreateResult {
  sessionId: string
  sceneToken: string
  codeUrl: string
  controlToken: string
  expiresAt: string
  status: typeof INVOICE_POLL_STATUS.waiting
}

export interface InvoiceSceneResolveResult {
  sessionId: string
  submitToken: string
  orderKind: 'print' | 'service'
  expiresAt: string
  status: typeof INVOICE_POLL_STATUS.waiting
}

export interface InvoicePollResult {
  status: InvoicePollStatus
}

function bad(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

@Injectable()
export class InvoiceSessionsService {
  constructor(
    @Inject(RedisService) private readonly redis: InvoiceRedis,
    private readonly requests: InvoiceRequestsService,
  ) {}

  async create(input: {
    terminalId: string
    endUserId: string
    orderKind: 'print' | 'service'
    orderId: string
    origin: string
  }): Promise<InvoiceSessionCreateResult> {
    const facts = await this.requests.loadFacts(input.orderKind, input.orderId)
    const decision = facts ? assessInvoiceEligibility(facts, input.endUserId) : null
    if (!facts || !decision?.ok) {
      // 与会员提交口（invoice-requests.service.ts）同一个状态码：挡单是状态冲突，不是参数错。
      throw new ConflictException({
        error: { code: 'INVOICE_NOT_ALLOWED', message: decision?.message || INVOICE_BLOCK_MESSAGES.not_owner },
      })
    }
    const sessionId = randomUUID().replace(/-/g, '')
    const sceneToken = mintInvoiceSceneToken()
    const controlToken = randomBytes(32).toString('base64url')
    const submitToken = deriveInvoiceSubmitToken(sessionId, sceneToken)
    const expiresAt = new Date(Date.now() + INVOICE_SESSION_TTL_SECONDS * 1000).toISOString()
    const record: StoredInvoiceSession = {
      sessionId,
      orderKind: input.orderKind,
      orderId: input.orderId,
      endUserId: input.endUserId,
      terminalId: input.terminalId,
      amountCents: decision.amountCents,
      status: 'waiting',
      sceneTokenHash: hashInvoiceToken(sceneToken),
      submitTokenHash: hashInvoiceToken(submitToken),
      controlTokenHash: hashInvoiceToken(controlToken),
      invoiceRequestId: null,
      expiresAt,
    }
    const ttl = INVOICE_SESSION_TTL_SECONDS
    await this.redis.setEx(invoiceSessionKey(sessionId), ttl, JSON.stringify(record))
    await this.redis.setEx(invoiceSceneIndexKey(sceneToken), ttl, sessionId)
    return {
      sessionId,
      sceneToken,
      codeUrl: invoiceCodeUrl(input.origin, sceneToken),
      controlToken,
      expiresAt,
      status: INVOICE_POLL_STATUS.waiting,
    }
  }

  async resolveScene(scene: string): Promise<InvoiceSceneResolveResult> {
    const record = await this.recordForScene(scene)
    if (record.status === 'submitted') throw bad('INVOICE_ALREADY_SUBMITTED', ALREADY_SUBMITTED_MESSAGE)
    if (record.status !== 'waiting' || Date.parse(record.expiresAt) <= Date.now()) {
      throw bad('INVOICE_SCENE_UNUSABLE', EXPIRED_MESSAGE)
    }
    return {
      sessionId: record.sessionId,
      submitToken: deriveInvoiceSubmitToken(record.sessionId, scene),
      orderKind: record.orderKind,
      expiresAt: record.expiresAt,
      status: INVOICE_POLL_STATUS.waiting,
    }
  }

  /** 一体机轮询。只有三种状态，不返回抬头、税号或邮箱。 */
  async poll(sessionId: string, controlToken: string | undefined): Promise<InvoicePollResult> {
    const record = await this.readSession(sessionId)
    if (!record || !controlToken || !invoiceTokensEqual(record.controlTokenHash, hashInvoiceToken(controlToken))) {
      if (record && controlToken) throw new UnauthorizedException({ error: { code: 'INVOICE_CONTROL_INVALID', message: EXPIRED_MESSAGE } })
      return { status: INVOICE_POLL_STATUS.expired }
    }
    if (record.status === 'submitted') return { status: INVOICE_POLL_STATUS.submitted }
    if (record.status === 'expired' || Date.parse(record.expiresAt) <= Date.now()) {
      return { status: INVOICE_POLL_STATUS.expired }
    }
    return { status: INVOICE_POLL_STATUS.waiting }
  }

  async submit(sessionId: string, input: Omit<SubmitInvoiceInput, 'orderKind' | 'orderId'> & { submitToken?: string }): Promise<{
    status: typeof INVOICE_POLL_STATUS.submitted
    message: string
    requestId: string
  }> {
    const lockToken = randomUUID()
    const locked = await this.redis.setIfAbsent(invoiceSubmitLockKey(sessionId), lockToken, 15)
    if (!locked) throw bad('INVOICE_ALREADY_SUBMITTED', ALREADY_SUBMITTED_MESSAGE)
    try {
      const record = await this.readSession(sessionId)
      if (!record || !input.submitToken || !invoiceTokensEqual(record.submitTokenHash, hashInvoiceToken(input.submitToken))) {
        throw bad('INVOICE_SCENE_UNUSABLE', EXPIRED_MESSAGE)
      }
      if (record.status === 'submitted') throw bad('INVOICE_ALREADY_SUBMITTED', ALREADY_SUBMITTED_MESSAGE)
      if (record.status !== 'waiting' || Date.parse(record.expiresAt) <= Date.now()) {
        throw bad('INVOICE_SCENE_UNUSABLE', EXPIRED_MESSAGE)
      }
      const row = await this.requests.submit(record.endUserId, {
        orderKind: record.orderKind,
        orderId: record.orderId,
        titleType: input.titleType,
        title: input.title,
        taxId: input.taxId,
        email: input.email,
      })
      record.status = 'submitted'
      record.invoiceRequestId = row.id
      // 只续到原来的到期时刻：场景码索引按原时刻过期，会话若重置成 10 分钟，过了原时刻再扫码会说「已过期」而一体机还显示「已提交」。
      const remaining = Math.max(1, Math.ceil((Date.parse(record.expiresAt) - Date.now()) / 1000))
      await this.redis.setEx(invoiceSessionKey(sessionId), Math.min(remaining, INVOICE_SESSION_TTL_SECONDS), JSON.stringify(record))
      return { status: INVOICE_POLL_STATUS.submitted, message: SUBMITTED_MESSAGE, requestId: row.id }
    } finally {
      const current = await this.redis.get(invoiceSubmitLockKey(sessionId))
      if (current === lockToken) await this.redis.del(invoiceSubmitLockKey(sessionId))
    }
  }

  private async recordForScene(scene: string): Promise<StoredInvoiceSession> {
    if (!isWellFormedInvoiceScene(scene)) throw bad('INVOICE_SCENE_UNUSABLE', EXPIRED_MESSAGE)
    const sessionId = await this.redis.get(invoiceSceneIndexKey(scene))
    const record = sessionId ? await this.readSession(sessionId) : null
    if (!record || !invoiceTokensEqual(record.sceneTokenHash, hashInvoiceToken(scene))) {
      throw bad('INVOICE_SCENE_UNUSABLE', EXPIRED_MESSAGE)
    }
    return record
  }

  private async readSession(sessionId: string): Promise<StoredInvoiceSession | null> {
    const raw = await this.redis.get(invoiceSessionKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredInvoiceSession
    if (!parsed || typeof parsed.sessionId !== 'string' || typeof parsed.controlTokenHash !== 'string') return null
    return parsed
  }
}
