import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { AuthedUser } from '../decorators/current-user.decorator'
import type { UserRole } from '../decorators/roles.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../constants/internal-session.constants'
import { tryRedis } from '../redis/redis-degradation'
import { RedisService } from '../redis/redis.service'

export { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../constants/internal-session.constants'

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
  deletedAt: string | null
  orgEnabled: boolean | null
}

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
 * ── Redis 在本守卫里到底是什么（决定了它挂掉时该怎么办）──────────────────────
 *
 * `internal:session-state:{userId}` 是**数据库行的只读缓存**，不是登出黑名单：
 * 会话是否仍然有效，唯一真源是 `User` 表的 `tokenVersion / enabled / deletedAt`
 * 与 `Organization.enabled`。全部撤销动作（改密、禁用账号、删除账号、机构停用、
 * 手机号换绑）都是先提交数据库，再把新状态**镜像**进 Redis；
 * `POST /auth/logout` 在源码注释里已明确声明「本端点不声称在服务端撤销已签发 JWT」。
 *
 * 因此 Redis 不可用时绕过缓存直接回源数据库，**不是放松鉴权**：
 * 它得到的是与缓存命中时同一个判据的、更新鲜的版本，
 * 反而消掉了缓存最多 60s 的陈旧窗口。真正危险的做法是相反方向 ——
 * 「Redis 挂了就放行」或「缓存写失败就当鉴权失败」，两者本仓都不采用。
 *
 * 缓存写入失败同理不影响判定：下次请求读不到缓存就再回源一次。
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
    if (!state || state.deletedAt !== null || !state.enabled || payload.ver !== state.tokenVersion) {
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

    req.user = {
      userId: state.userId,
      role,
      orgId: state.orgId,
      sessionId: createHash('sha256').update(token).digest('hex'),
    }
    return true
  }

  private async loadSessionState(userId: string): Promise<CachedSessionState | null> {
    const cacheKey = `internal:session-state:${userId}`
    // 缓存读取有界且绝不抛出：读不到（超时/故障/未命中）一律按未命中处理，回源数据库。
    const cached = await tryRedis('session-state:get', () => this.redis.get(cacheKey), this.logger)
    if (cached.ok && cached.value) {
      const parsed = this.parseSessionState(cached.value)
      if (parsed) {
        if (parsed.role !== 'partner') return parsed
        // Partner 缓存命中也必须回源，避免 Redis 残留把已删除账号短暂复活。
        return this.loadSessionStateFromDatabase(userId, cacheKey)
      }
      await tryRedis('session-state:del', () => this.redis.del(cacheKey), this.logger)
    }

    return this.loadSessionStateFromDatabase(userId, cacheKey)
  }

  private async loadSessionStateFromDatabase(
    userId: string,
    cacheKey: string,
  ): Promise<CachedSessionState | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, orgId: true, enabled: true, tokenVersion: true, deletedAt: true },
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
      deletedAt: user.deletedAt?.toISOString() ?? null,
      orgEnabled,
    }
    // 回写只是加速下一次请求。写失败不改变本次判定 —— state 已经是数据库真源。
    const writeResult = await tryRedis(
      'session-state:set',
      () => this.redis.setJsonIfVersionNotOlder(
        cacheKey,
        INTERNAL_SESSION_CACHE_TTL_SECONDS,
        JSON.stringify(state),
        state.tokenVersion,
      ),
      this.logger,
    )
    if (writeResult.ok && writeResult.value === 'stale') {
      // 缓存里有更高的 tokenVersion（并发撤销已经先落缓存）——以那份更新的为准。
      // 读不回来时退回本次数据库快照，不会因此放行更旧的版本。
      const latest = await tryRedis('session-state:get', () => this.redis.get(cacheKey), this.logger)
      const parsed = latest.ok && latest.value ? this.parseSessionState(latest.value) : null
      return parsed ?? state
    }
    return state
  }

  private parseSessionState(raw: string): CachedSessionState | null {
    try {
      const parsed = JSON.parse(raw) as Partial<CachedSessionState>
      if (
        typeof parsed.userId !== 'string'
        || typeof parsed.tokenVersion !== 'number'
        || typeof parsed.enabled !== 'boolean'
        || (typeof parsed.deletedAt !== 'string' && parsed.deletedAt !== null)
      ) return null
      return parsed as CachedSessionState
    } catch {
      return null
    }
  }
}
