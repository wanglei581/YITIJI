import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { AuthedUser } from '../decorators/current-user.decorator'
import type { UserRole } from '../decorators/roles.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'

interface JwtPayload {
  sub:   string
  role:  UserRole
  orgId: string | null
  ver?:  number
  /** C 端求职者 token 带 aud='enduser';内部接口必须拒绝(双向隔离)。 */
  aud?:  string
}

interface CachedSessionState {
  userId: string
  role: string
  orgId: string | null
  enabled: boolean
  tokenVersion: number
  orgEnabled: boolean | null
}

const INTERNAL_SESSION_CACHE_TTL_SECONDS = 60

/**
 * 解析请求头 `Authorization: Bearer <token>`,验证 JWT,
 * 把解码后的用户写入 `req.user`(类型 AuthedUser)。
 *
 * 配合 RolesGuard 使用:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('admin')
 *
 * 不主动检查角色 — 单独使用时表示"任意已登录用户"。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
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

    const token = header.slice(7).trim()
    let payload: JwtPayload
    try {
      payload = this.jwtService.verify<JwtPayload>(token)
    } catch {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' },
      })
    }

    // 隔离:C 端求职者 token(aud='enduser')不得访问内部运营接口。
    if (payload.aud === 'enduser') {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' },
      })
    }

    const state = await this.loadSessionState(payload.sub)
    if (!state || !state.enabled || payload.ver !== state.tokenVersion) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' },
      })
    }
    const role = state.role as UserRole
    if (role !== 'admin' && role !== 'partner' && role !== 'kiosk') {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' },
      })
    }
    if (role === 'partner') {
      if (!state.orgId || !state.orgEnabled) {
        throw new UnauthorizedException({
          error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' },
        })
      }
    }

    req.user = { userId: state.userId, role, orgId: state.orgId }
    return true
  }

  private async loadSessionState(userId: string): Promise<CachedSessionState | null> {
    const cacheKey = `internal:session-state:${userId}`
    const cached = await this.redis.get(cacheKey)
    if (cached) {
      try {
        return JSON.parse(cached) as CachedSessionState
      } catch {
        await this.redis.del(cacheKey)
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, orgId: true, enabled: true, tokenVersion: true },
    })
    if (!user) return null

    let orgEnabled: boolean | null = null
    if (user.role === 'partner' && user.orgId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { enabled: true },
      })
      orgEnabled = org?.enabled ?? false
    }

    const state: CachedSessionState = {
      userId: user.id,
      role: user.role,
      orgId: user.orgId,
      enabled: user.enabled,
      tokenVersion: user.tokenVersion,
      orgEnabled,
    }
    await this.redis.setEx(cacheKey, INTERNAL_SESSION_CACHE_TTL_SECONDS, JSON.stringify(state))
    return state
  }
}
