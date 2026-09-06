import { Body, Controller, Post, HttpCode, HttpStatus, Headers, Req, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { randomBytes } from 'node:crypto'
import type { Request } from 'express'
import { TrtcService } from './trtc.service'
import { RedisService } from '../common/redis/redis.service'

// 对外 taskId 是每会话随机停止能力令牌，Redis 值才是真实腾讯 TaskId。
// 同厅终端即使 IP/UA 相同，也无法猜到或复用其他会话的停止令牌。
const OWNER_KEY_PREFIX = 'trtc:owner:'
const OWNER_TTL_SECONDS = 30 * 60

@Controller('trtc')
// 严格限流：每 IP 每分钟最多 5 次，防止匿名方无限触发腾讯云计费接口。
// 全局 Throttler 默认 60次/min；显式覆盖为更严格的 5次/min。
@Throttle({ default: { ttl: 60_000, limit: 5 } })
export class TrtcController {
  constructor(
    private readonly trtcService: TrtcService,
    private readonly redis: RedisService,
  ) {}

  /**
   * POST /api/v1/trtc/session
   * 启动对话式 AI 会话，返回前端进房凭证 + taskId。
   * SecretKey 全程留在服务端。
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  async startSession(
    @Body() body: { userId?: string },
    @Req() _req: Request,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ) {
    // 必须携带终端 ID，防止未配置终端的外部请求触发腾讯云计费
    if (!terminalId?.trim()) {
      throw new UnauthorizedException({ error: { code: 'TERMINAL_ID_REQUIRED', message: '需要 X-Terminal-Id 标头' } })
    }
    const rawUserId = body.userId?.trim() ?? ''
    // userId 只允许字母/数字/下划线，防止特殊字符嵌入 HMAC payload
    if (rawUserId && !/^[\w-]{1,64}$/.test(rawUserId)) {
      throw new BadRequestException({ error: { code: 'INVALID_USER_ID', message: 'userId 只允许字母、数字、下划线，最长 64 字符' } })
    }
    const userId = rawUserId || `user_${Date.now()}`
    const result = await this.trtcService.startSession(userId)
    const stopSecret = randomBytes(32).toString('base64url')
    await this.redis.setEx(`${OWNER_KEY_PREFIX}${stopSecret}`, OWNER_TTL_SECONDS, result.taskId)
    return { ...result, taskId: stopSecret }
  }

  /**
   * POST /api/v1/trtc/session/stop
   * 结束对话式 AI 会话，校验 taskId 归属防止跨会话终止。
   */
  // stop 是「止损」操作：绝不能被限流挡掉，否则机器人留在房间持续计费。
  // 放宽到 60 次/分钟（仍防恶意刷腾讯 StopAIConversation 接口），覆盖 start 的 5/min。
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('session/stop')
  @HttpCode(HttpStatus.OK)
  async stopSession(
    @Body() body: { taskId: string },
    @Req() _req: Request,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ) {
    if (!terminalId?.trim()) {
      throw new UnauthorizedException({ error: { code: 'TERMINAL_ID_REQUIRED', message: '需要 X-Terminal-Id 标头' } })
    }
    if (!body.taskId?.trim()) {
      throw new BadRequestException({ error: { code: 'MISSING_TASK_ID', message: 'taskId 不能为空' } })
    }

    const ownerKey = `${OWNER_KEY_PREFIX}${body.taskId}`
    const realTaskId = await this.redis.get(ownerKey)
    if (realTaskId === null) return { ok: true }
    await this.trtcService.stopSession(realTaskId)
    await this.redis.del(ownerKey)
    return { ok: true }
  }
}
