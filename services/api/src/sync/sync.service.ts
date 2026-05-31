import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { JobsService } from '../jobs/jobs.service'
import { AuditService } from '../audit/audit.service'
import { decryptSecret } from '../common/crypto/secret-cipher'
import { ReplayGuard } from './replay-guard'
import type { WebhookPayloadDto } from './dto/webhook-payload.dto'

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000

/**
 * 同步服务(BE-8)。
 *
 * 处理企业 Webhook 推送:验签 → 防重放 → 落 Job → 写审计。
 *
 * 签名算法:HMAC-SHA256(webhookSecret, `${timestampSec}.${rawBody}`)
 * 头部:
 *   X-Webhook-Timestamp:unix 秒(±5min 窗口)
 *   X-Webhook-Nonce:8-128 字符的随机串,5min 内 sourceId+nonce 唯一
 *   X-Webhook-Signature:hex(...)
 *
 * 任何 401 一律返回同一错误码 `WEBHOOK_UNAUTHORIZED`,不区分(防探测攻击):
 *   - sourceId 不存在
 *   - 数据源未启用
 *   - 数据源 accessMode 不是 webhook
 *   - webhookSecret 未配置
 *   - 时间戳过期 / 越界
 *   - 签名不匹配
 *   - nonce 重放
 *
 * 写入路径:JobsService.importJobsFromWebhook(orgId, sourceName, items)
 * 状态机:落 pending+draft,必须 admin 审核才能上 Kiosk。
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)
  private readonly replay = new ReplayGuard()

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  async handleWebhook(args: {
    sourceId: string
    timestampHeader: string | undefined
    nonceHeader: string | undefined
    signatureHeader: string | undefined
    rawBody: string
    parsed: WebhookPayloadDto
    ip: string | null
    userAgent: string | null
    requestId: string | null
  }): Promise<{ imported: number; receivedRequestId: string }> {
    const denied = (): never => {
      throw new UnauthorizedException({
        error: { code: 'WEBHOOK_UNAUTHORIZED', message: '签名无效或已过期' },
      })
    }

    // 0) 头部齐备性
    const ts = Number(args.timestampHeader)
    if (!Number.isFinite(ts) || ts <= 0) denied()
    if (!args.signatureHeader || args.signatureHeader.length < 8) denied()
    if (!args.nonceHeader || args.nonceHeader.length < 8) denied()

    // 1) 时间戳窗口(±5min)
    const tsMs = ts * 1000
    if (Math.abs(Date.now() - tsMs) > TIMESTAMP_WINDOW_MS) denied()

    // 2) 取 JobSource 并校验启用 + accessMode=webhook
    const source = await this.prisma.jobSource.findUnique({ where: { id: args.sourceId } })
    if (!source || !source.enabled || source.accessMode !== 'webhook' || !source.webhookSecret) {
      denied()
    }
    // 此时 source 必非空,TS narrowing
    const src = source!

    // 3) 签名校验
    const webhookSecret = (() => {
      try {
        return decryptSecret(src.webhookSecret!)
      } catch {
        return denied()
      }
    })()

    const expected = createHmac('sha256', webhookSecret)
      .update(`${ts}.${args.rawBody}`)
      .digest('hex')
    const got = args.signatureHeader!.toLowerCase()
    if (got.length !== expected.length) denied()
    let sigMatch = false
    try {
      sigMatch = timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'))
    } catch {
      denied()
    }
    if (!sigMatch) denied()

    // 4) 防重放(nonce 在 sourceId 下 5min 唯一)
    if (!this.replay.register(args.nonceHeader!, args.sourceId, tsMs)) denied()

    // 5) 落库(走 JobsService.importJobsFromWebhook,与 Partner 手动导入共用 upsert 逻辑)
    const receivedRequestId = randomUUID()
    const result = await this.jobs.importJobsFromWebhook(src.orgId, src.id, args.parsed.items)

    // 6) 更新 JobSource.lastSyncAt + lastSyncStatus
    await this.prisma.jobSource.update({
      where: { id: src.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: 'success' },
    })

    // 7) 审计 — 同步落库不可篡改
    await this.audit.write({
      actorId: null,
      actorRole: 'partner',  // 用 partner 角色记入,代表"代表机构 X 的自动化推送"
      action: 'job.import',
      targetType: 'job_source',
      targetId: src.id,
      payload: {
        source: 'webhook',
        sourceOrgId: src.orgId,
        sourceName: src.name,
        count: result.imported,
        receivedRequestId,
      },
      ipAddress: args.ip,
      userAgent: args.userAgent,
      requestId: args.requestId,
    })

    this.logger.log(`webhook: sourceId=${src.id} count=${result.imported} reqId=${receivedRequestId}`)
    return { imported: result.imported, receivedRequestId }
  }
}
