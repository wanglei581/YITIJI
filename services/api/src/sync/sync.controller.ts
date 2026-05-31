import { Body, Controller, Headers, Post, Query, Req, UnauthorizedException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiResponse } from '../common/dto/api-response.dto'
import { SyncService } from './sync.service'
import { WebhookPayloadDto } from './dto/webhook-payload.dto'

interface RawReq {
  rawBody?: Buffer
  requestId?: string
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
}

function ipOf(req: RawReq): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]?.trim() ?? null
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0] ?? null
  return req.ip ?? req.socket?.remoteAddress ?? null
}

function uaOf(req: RawReq): string | null {
  const ua = req.headers['user-agent']
  if (typeof ua === 'string') return ua.slice(0, 256)
  if (Array.isArray(ua) && ua[0]) return ua[0].slice(0, 256)
  return null
}

/**
 * 路由:
 *   POST /api/v1/sync/webhook?source=<jobSourceId>
 *
 * 防滥用:30 req/60s/IP(比默认 60/60 略严,业务上单源每分钟不会超过几次推送)。
 * 鉴权:不挂 JwtAuthGuard;完全靠 webhookSecret + HMAC + 时间窗口 + nonce。
 *
 * Body 必须严格匹配 WebhookPayloadDto。任何超出 items[].whitelist 的字段
 * (候选人邮箱 / 简历 URL / 面试时间槽 等)直接 400 拒收,合规守住。
 */
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('webhook')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async webhook(
    @Query('source') sourceId: string,
    @Headers('x-webhook-timestamp') timestamp: string | undefined,
    @Headers('x-webhook-nonce') nonce: string | undefined,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Body() body: WebhookPayloadDto,
    @Req() req: RawReq,
  ): Promise<ApiResponse<{ imported: number; receivedRequestId: string }>> {
    // class-validator 已经把 body parse + 校验过;
    // 但 HMAC 必须算 raw bytes,不能算 parsed 后的对象。
    // raw body 由 main.ts 的 rawBody hook 写到 req.rawBody。
    if (!req.rawBody) {
      throw new UnauthorizedException({
        error: { code: 'WEBHOOK_UNAUTHORIZED', message: '签名无效或已过期' },
      })
    }
    const rawBody = req.rawBody.toString('utf-8')
    const result = await this.sync.handleWebhook({
      sourceId,
      timestampHeader: timestamp,
      nonceHeader: nonce,
      signatureHeader: signature,
      rawBody,
      parsed: body,
      ip: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }
}
