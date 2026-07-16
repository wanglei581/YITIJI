import { Body, Controller, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { ApiResponse } from '../common/dto/api-response.dto'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityService } from './activity.service'

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
}

function headerOf(req: ReqLike, name: string): string | null {
  const v = req.headers?.[name]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (Array.isArray(v) && v[0]) return v[0].trim()
  return null
}

interface RecordBrowseDto {
  targetType?: string
  targetId?: string
  terminalId?: string
}

interface RecordJumpDto extends RecordBrowseDto {
  action?: string
}

function cleanStr(v: unknown, max = 128): string | null {
  return typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null
}

/**
 * 浏览 / 外部跳转行为上报（/api/v1/activity/*，P1 闭环）。
 *
 * - 可选登录（resolveOptionalEndUser）：登录会员落库归本人；匿名诚实返回
 *   recorded:false，不落服务端、不留影子记录（共享一体机隐私）。
 * - 前端约定 fire-and-forget：上报失败绝不阻断页面访问 / 打开来源平台。
 * - 来源字段全部由服务端从已发布目标补齐，body 里只收 targetType/targetId/action，
 *   前端无法伪造 sourceName/sourceUrl。
 * - 只记录「打开入口」行为本身；投递/预约结果以来源平台为准，本系统不记录。
 */
@Controller('activity')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private async endUserIdOf(req: ReqLike): Promise<string | null> {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization') ?? undefined, this.jwt, this.redis, this.prisma)
    return member?.endUserId ?? null
  }

  @Post('browse')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async browse(@Body() body: RecordBrowseDto, @Req() req: ReqLike) {
    const endUserId = await this.endUserIdOf(req)
    if (!endUserId) return ApiResponse.ok({ recorded: false as const, reason: 'LOGIN_REQUIRED' })
    const result = await this.activity.recordBrowse(
      endUserId,
      cleanStr(body.targetType) ?? '',
      cleanStr(body.targetId) ?? '',
      cleanStr(body.terminalId),
    )
    return ApiResponse.ok(result)
  }

  @Post('external-jump')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async externalJump(@Body() body: RecordJumpDto, @Req() req: ReqLike) {
    const endUserId = await this.endUserIdOf(req)
    if (!endUserId) return ApiResponse.ok({ recorded: false as const, reason: 'LOGIN_REQUIRED' })
    const result = await this.activity.recordJump(
      endUserId,
      cleanStr(body.targetType) ?? '',
      cleanStr(body.targetId) ?? '',
      cleanStr(body.action) ?? '',
      cleanStr(body.terminalId),
    )
    return ApiResponse.ok(result)
  }
}
