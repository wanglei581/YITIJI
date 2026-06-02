import { Body, Controller, Post, HttpCode, HttpStatus, Req, Headers, ForbiddenException, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { TrtcService } from './trtc.service'

// taskId → 客户端特征（IP + UA）的运行时归属表。
// 无持久化：重启后归属清空，stop 请求会被拒绝（等 TRTC MaxIdleTime 自然超时）。
// 生产可换 Redis；Kiosk 单机场景内存足够。
const taskOwnerMap = new Map<string, string>()

function makeClientKey(req: Request): string {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.ip
    ?? 'unknown'
  const ua = ((req.headers['user-agent'] as string | undefined) ?? '').slice(0, 80)
  return `${ip}|${ua}`
}

@Controller('trtc')
// 严格限流：每 IP 每分钟最多 5 次，防止匿名方无限触发腾讯云计费接口。
// 全局 Throttler 默认 60次/min；显式覆盖为更严格的 5次/min。
@Throttle({ default: { ttl: 60_000, limit: 5 } })
export class TrtcController {
  constructor(private readonly trtcService: TrtcService) {}

  /**
   * POST /api/v1/trtc/session
   * 启动对话式 AI 会话，返回前端进房凭证 + taskId。
   * SecretKey 全程留在服务端。
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  async startSession(
    @Body() body: { userId?: string },
    @Req() req: Request,
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

    // 记录 taskId → 客户端特征，供 stopSession 校验归属
    taskOwnerMap.set(result.taskId, makeClientKey(req))
    // 30 分钟后自动清理（与 TRTC AgentConfig.MaxIdleTime 对齐）
    setTimeout(() => taskOwnerMap.delete(result.taskId), 30 * 60 * 1000)

    return result
  }

  /**
   * POST /api/v1/trtc/session/stop
   * 结束对话式 AI 会话，校验 taskId 归属防止跨会话终止。
   */
  @Post('session/stop')
  @HttpCode(HttpStatus.OK)
  async stopSession(
    @Body() body: { taskId: string },
    @Req() req: Request,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ) {
    if (!terminalId?.trim()) {
      throw new UnauthorizedException({ error: { code: 'TERMINAL_ID_REQUIRED', message: '需要 X-Terminal-Id 标头' } })
    }
    if (!body.taskId?.trim()) {
      throw new BadRequestException({ error: { code: 'MISSING_TASK_ID', message: 'taskId 不能为空' } })
    }

    const owner = taskOwnerMap.get(body.taskId)
    // owner 存在但与请求方不匹配时拒绝（重启后 owner 为 undefined，放行）
    if (owner !== undefined && owner !== makeClientKey(req)) {
      throw new ForbiddenException({ error: { code: 'TASK_NOT_OWNED', message: '无权终止该会话' } })
    }

    await this.trtcService.stopSession(body.taskId)
    taskOwnerMap.delete(body.taskId)
    return { ok: true }
  }
}
