import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { AuthedEndUser } from '../decorators/current-end-user.decorator'
import { RedisService } from '../redis/redis.service'
import { tryRedis } from '../redis/redis-degradation'
import { PrismaService } from '../../prisma/prisma.service'

interface EndUserJwtPayload {
  sub: string
  jti?: string
  aud?: string
}

/** member:session:{jti} — C 端登录会话键。logout / idle logout 删除即失效。 */
export function memberSessionKey(sessionId: string): string {
  return `member:session:${sessionId}`
}

/** 与 member-auth.service SESSION_TTL 对齐；滑动续期刷新到这个窗口。 */
export const MEMBER_SESSION_TTL_SECONDS = 1800

/** 滑动续期：mock Redis 没有该方法时跳过，不得把 TypeError 当成 Redis 宕机。 */
export async function touchMemberSessionIfSupported(
  redis: RedisService,
  endUserId: string,
  sessionId: string,
  logger?: Logger,
): Promise<number | null> {
  if (typeof redis.touchMemberSession !== 'function') return null
  const touch = await tryRedis(
    'member-session:touch',
    () => redis.touchMemberSession(endUserId, sessionId, MEMBER_SESSION_TTL_SECONDS),
    logger,
  )
  return touch.ok ? touch.value : null
}

/**
 * C 端求职者鉴权(阶段 A)。与内部 JwtAuthGuard 完全隔离:
 *
 *   1. verify 时强制 audience='enduser' — 内部运营 token(无 aud)在此被拒。
 *   2. JWT 仅作"未篡改"证明;是否仍有效以 Redis 会话为准:
 *      jti 必须在 member:session:{jti} 存在且值 == sub,否则视为已登出/已失效。
 *
 * 这样 logout 与前端空闲超时登出都能让 token 立即失效(即使 JWT 本身未过期)。
 */
@Injectable()
export class EndUserAuthGuard implements CanActivate {
  private readonly logger = new Logger(EndUserAuthGuard.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { endUser?: AuthedEndUser }>()
    const header = req.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw this.unauthorized('MEMBER_MISSING_TOKEN', '缺少登录凭证')
    }

    const token = header.slice(7).trim()
    let payload: EndUserJwtPayload
    try {
      payload = this.jwtService.verify<EndUserJwtPayload>(token, { audience: 'enduser' })
    } catch {
      throw this.unauthorized('MEMBER_TOKEN_INVALID', '登录已失效,请重新登录')
    }

    const sessionId = payload.jti
    if (!sessionId) {
      throw this.unauthorized('MEMBER_TOKEN_INVALID', '登录已失效,请重新登录')
    }

    // 会员会话的 Redis 是唯一真源，不能像内部账号缓存那样回源放行；但外部
    // 依赖失联也不能把请求拖到 ioredis 重试耗尽后才以 500 结束。
    const session = await tryRedis(
      'member-session:get',
      () => this.redis.get(memberSessionKey(sessionId)),
      this.logger,
    )
    if (!session.ok && session.reason !== 'rejected') {
      throw new ServiceUnavailableException({
        error: {
          code: 'MEMBER_SESSION_STORE_UNAVAILABLE',
          message: '登录状态暂时无法核验，请稍后重试',
        },
      })
    }
    // ReplyError 表示 Redis 已经回复、只是该命令被拒；按既有 tryRedis 语义不把它
    // 扩散为连接故障，和会话不存在一样 fail-closed 为 401。
    const ownerId = session.ok ? session.value : null
    if (!ownerId || ownerId !== payload.sub) {
      throw this.unauthorized('MEMBER_SESSION_EXPIRED', '会话已失效,请重新登录')
    }

    const user = await this.prisma.endUser.findUnique({
      where: { id: payload.sub },
      select: { enabled: true, status: true },
    })
    if (!user || !user.enabled || user.status !== 'active') {
      await this.redis.unregisterMemberSession(payload.sub, sessionId)
      throw this.unauthorized(
        user ? 'ACCOUNT_UNAVAILABLE' : 'MEMBER_SESSION_EXPIRED',
        user ? '账号当前不可用，请重新登录或联系工作人员' : '会话已失效,请重新登录',
      )
    }

    req.endUser = { endUserId: payload.sub, sessionId }
    const touch = await touchMemberSessionIfSupported(
      this.redis,
      payload.sub,
      sessionId,
      this.logger,
    )
    if (touch === -1) {
      throw this.unauthorized('MEMBER_SESSION_EXPIRED', '会话已失效,请重新登录')
    }
    return true
  }

  private unauthorized(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ error: { code, message } })
  }
}
