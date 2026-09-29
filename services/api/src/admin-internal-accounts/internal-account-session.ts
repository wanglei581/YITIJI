import type { Logger } from '@nestjs/common'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../common/constants/internal-session.constants'
import type { RedisService } from '../common/redis/redis.service'

/**
 * 启停后把新会话状态镜像进 Redis（同 auth.service 的 publishCredentialChangeSessionState）。
 *
 * 鉴权真源是数据库（common/auth/optional-internal-user 每次回源 User 表）：tokenVersion 在
 * 事务里已经 +1，旧登录凭证在下一次请求就失效。这里写的是「更高版本屏障」，防止晚到的旧快照
 * 把缓存写回可用状态；写失败只删缓存并告警，不把已提交的启停打成失败。
 */
export async function publishInternalSessionState(
  redis: RedisService,
  logger: Logger,
  user: { id: string; role: string; orgId: string | null; enabled: boolean; tokenVersion: number; deletedAt: Date | null },
): Promise<'ok' | 'failed'> {
  const key = `internal:session-state:${user.id}`
  try {
    await redis.setJsonIfVersionNotOlder(
      key,
      INTERNAL_SESSION_CACHE_TTL_SECONDS,
      JSON.stringify({
        userId: user.id,
        role: user.role,
        orgId: user.orgId,
        enabled: user.enabled,
        tokenVersion: user.tokenVersion,
        deletedAt: user.deletedAt?.toISOString() ?? null,
        orgEnabled: null,
      }),
      user.tokenVersion,
    )
    return 'ok'
  } catch {
    await redis.del(key).catch(() => undefined)
    logger.warn(`账号状态已更新，但会话状态缓存同步失败；鉴权以数据库版本为准 userId=${user.id}`)
    return 'failed'
  }
}
