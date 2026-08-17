import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { AuthedUser } from '../decorators/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { resolveOptionalInternalUser } from '../auth/optional-internal-user'

export { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../constants/internal-session.constants'

/**
 * 解析请求头 `Authorization: Bearer <token>`,验证 JWT,
 * 把解码后的用户写入 `req.user`(类型 AuthedUser)。
 *
 * 配合 RolesGuard 使用:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('admin')
 *
 * 不主动检查角色 — 单独使用时表示"任意已登录用户"。
 *
 * 身份判定本体在 `../auth/optional-internal-user`:回源数据库 +
 * `internal:session-state` 缓存 + `tryRedis` 有界降级。**Redis 在本守卫里
 * 是什么、挂掉时为什么回源数据库不等于放松鉴权,那段口径写在该文件的头注释里**,
 * 不要只改一处。抽出来是为了让混合鉴权路由(FilesController 同时接受会员与内部
 * 账号 token)复用同一份判定,而不是各写一套 —— 两份副本必然漂移。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>()
    const header = req.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_MISSING_TOKEN', message: '缺少 Bearer Token' },
      })
    }

    const user = await resolveOptionalInternalUser(
      header,
      this.jwtService,
      this.redis,
      this.prisma,
      this.logger,
    )
    if (!user) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' },
      })
    }

    req.user = user
    return true
  }
}
