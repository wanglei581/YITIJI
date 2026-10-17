import { createHash, randomBytes } from 'node:crypto'
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Redis } from 'ioredis'
import { maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { decryptSecret, encryptSecret } from '../common/crypto/secret-cipher'
import { REDIS_CLIENT } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { MemberAuthService, type MemberLoginResult } from './member-auth.service'

/**
 * 同设备恢复凭证（FLOW1c）。
 *
 * 访问令牌仍是 30 分钟的 JWT，不延长。恢复凭证只用来在**同一台手机**上、访问令牌失效之后换一枚新的，
 * 让只用短信登录、没绑微信的账号不必每 30 分钟再收一次验证码。
 *
 * - 只在小程序显式登录、且服务端能确认请求来自本小程序时签发（见控制器 wantsRestore）；一体机拿不到。
 * - 明文是「组号.密钥」：组号 16 字节、密钥 32 字节，都是 base64url。服务端只存密钥的 SHA-256 摘要。
 * - 每用一次换一枚新的（轮换）。组里只认**当前**这一枚；刚被换下的上一枚在宽限期内再来，返回**同一个**后继
 *   （幂等，吸收「回复丢了再试一次」）。除此之外任何一枚旧的出现，都说明凭证被复制过：整组作废。
 *   组号写在凭证里，所以不论隔了多久、换过几轮，旧凭证一出现都认得出是哪一组。
 * - 期限：未使用 7 天失效；从显式登录算起 30 天必须重新认证。签发之后账号状态变过（停用、再启用、注销）也作废。
 *
 * Redis 键（每组只有一条记录）：
 *   member:restore:family:{组号}        {u, s: 签发毫秒, exp: 绝对到期毫秒, idleExp, cur, prev?, usedAt?, nextEnc?}
 *   member:restore:user-families:{会员}  这个会员所有组号，用来整户作废
 */
const FAMILY_PREFIX = 'member:restore:family:'
const USER_FAMILIES_PREFIX = 'member:restore:user-families:'
const DAY_SECONDS = 24 * 60 * 60

/** 恢复凭证的明文格式：组号（16 字节）. 密钥（32 字节），base64url 无填充。 */
export const RESTORE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/** 期限（秒）。环境变量可调，越界退回默认值；未使用期限不长于绝对期限。 */
export function memberRestoreLifetimes(): { idleSeconds: number; maxSeconds: number; graceSeconds: number } {
  const maxSeconds = envInt('MEMBER_RESTORE_MAX_DAYS', 30, 1, 90) * DAY_SECONDS
  const idleSeconds = Math.min(envInt('MEMBER_RESTORE_IDLE_DAYS', 7, 1, 30) * DAY_SECONDS, maxSeconds)
  const graceSeconds = envInt('MEMBER_RESTORE_GRACE_SECONDS', 30, 0, 60)
  return { idleSeconds, maxSeconds, graceSeconds }
}

const digest = (secret: string): string => createHash('sha256').update(secret).digest('hex')
const newSecret = (): string => randomBytes(32).toString('base64url')

function parseToken(token: string): { familyId: string; secret: string } | null {
  if (!RESTORE_TOKEN_PATTERN.test(token)) return null
  const [familyId, secret] = token.split('.')
  return { familyId, secret }
}

/** 作废一组：删组记录、从会员索引里移除。KEYS[1] = 组键，ARGV[1] = 组号，ARGV[2] = 索引前缀。 */
const REVOKE_FAMILY_LUA = `
local function revokeFamily(famKey, famId, userFamiliesPrefix)
  local famRaw = redis.call('GET', famKey)
  if famRaw then
    redis.call('SREM', userFamiliesPrefix .. cjson.decode(famRaw).u, famId)
  end
  redis.call('DEL', famKey)
end
`

const ISSUE_SCRIPT = `
local now = tonumber(ARGV[2])
local fam = {u = ARGV[1], s = now, exp = now + tonumber(ARGV[4]) * 1000, idleExp = now + tonumber(ARGV[3]) * 1000, cur = ARGV[5]}
-- 记录只活到「未使用期限」：一直不用就自己消失，不多留会员信息；每次换新再顺延，但不超过绝对期限。
redis.call('SET', KEYS[1], cjson.encode(fam), 'EX', tonumber(ARGV[3]))
redis.call('SADD', KEYS[2], ARGV[6])
if redis.call('TTL', KEYS[2]) < tonumber(ARGV[4]) then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4])) end
return 1
`

/**
 * 换新。KEYS[1] = 组键。ARGV：1 出示的摘要，2 候选后继摘要，3 候选后继密文，4 现在毫秒，5 未使用期限秒，
 * 6 宽限期秒，7 组号，8 索引前缀。返回：
 *   {'ok', 会员, 签发毫秒}            出示的是当前这一枚：已换成候选后继；
 *   {'retry', 会员, 签发毫秒, 后继密文} 出示的是刚换下的上一枚，且在宽限期内：返回同一个后继；
 *   {'reused', 会员}                  别的任何一枚：整组已作废；
 *   {'invalid'}                       组不存在或已过期。
 */
const ROTATE_SCRIPT = `${REVOKE_FAMILY_LUA}
local raw = redis.call('GET', KEYS[1])
if not raw then return {'invalid'} end
local fam = cjson.decode(raw)
local now = tonumber(ARGV[4])
if now >= fam.exp or now >= fam.idleExp then
  revokeFamily(KEYS[1], ARGV[7], ARGV[8])
  return {'invalid'}
end
if ARGV[1] == fam.cur then
  fam.prev = fam.cur
  fam.usedAt = now
  fam.nextEnc = ARGV[3]
  fam.cur = ARGV[2]
  fam.idleExp = math.min(now + tonumber(ARGV[5]) * 1000, fam.exp)
  local ttl = math.floor((fam.idleExp - now) / 1000)
  if ttl < 1 then
    revokeFamily(KEYS[1], ARGV[7], ARGV[8])
    return {'invalid'}
  end
  redis.call('SET', KEYS[1], cjson.encode(fam), 'EX', ttl)
  return {'ok', fam.u, tostring(fam.s)}
end
-- 上一枚在宽限期内再来：后继就是当前这一枚，而且一定还没被用过（用过的话上一枚早已换成它）。
if fam.prev and ARGV[1] == fam.prev and fam.usedAt and fam.nextEnc and (now - fam.usedAt) <= tonumber(ARGV[6]) * 1000 then
  return {'retry', fam.u, tostring(fam.s), fam.nextEnc}
end
revokeFamily(KEYS[1], ARGV[7], ARGV[8])
return {'reused', fam.u}
`

const REVOKE_ALL_SCRIPT = `
local families = redis.call('SMEMBERS', KEYS[1])
for _, famId in ipairs(families) do
  redis.call('DEL', ARGV[1] .. famId)
end
redis.call('DEL', KEYS[1])
return #families
`

/**
 * 整户作废恢复凭证（换绑手机、注销时调用）。做成独立函数，注销流程所在的模块不必依赖会员登录模块。
 * @returns 作废的组数
 */
export async function revokeAllMemberRestoreFamilies(client: Redis, endUserId: string): Promise<number> {
  const result = await client.eval(REVOKE_ALL_SCRIPT, 1, `${USER_FAMILIES_PREFIX}${endUserId}`, FAMILY_PREFIX)
  return Number(result)
}

type RotateOutcome =
  | { kind: 'ok' | 'retry'; endUserId: string; familyId: string; startedAtMs: number; successor: string }
  | { kind: 'invalid' }
  | { kind: 'reused'; endUserId: string; familyId: string }

export type MemberRestoreResult = MemberLoginResult & { restoreToken: string }

@Injectable()
export class MemberRestoreService {
  private readonly logger = new Logger(MemberRestoreService.name)

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly prisma: PrismaService,
    private readonly auth: MemberAuthService,
  ) {}

  /** 显式登录成功后签发一组恢复凭证，返回明文（只在这一次响应里出现）。 */
  async issue(endUserId: string): Promise<string> {
    const { idleSeconds, maxSeconds } = memberRestoreLifetimes()
    const familyId = randomBytes(16).toString('base64url')
    const secret = newSecret()
    await this.client.eval(
      ISSUE_SCRIPT, 2, `${FAMILY_PREFIX}${familyId}`, `${USER_FAMILIES_PREFIX}${endUserId}`,
      endUserId, String(Date.now()), String(idleSeconds), String(maxSeconds), digest(secret), familyId,
    )
    return `${familyId}.${secret}`
  }

  /**
   * 用恢复凭证换一枚新的访问令牌（同一位会员），并换新恢复凭证。
   * 失败：401 MEMBER_RESTORE_INVALID（无效、过期、签发后账号状态变过）、401 MEMBER_RESTORE_REUSED（旧凭证再现，整组已作废）、
   * 403 ACCOUNT_UNAVAILABLE、503 MEMBER_SESSION_STORE_UNAVAILABLE（Redis 不可用，可重试）。
   */
  async restore(token: string): Promise<MemberRestoreResult> {
    const outcome = await this.rotate(token)
    if (outcome.kind === 'invalid') throw this.invalid()
    if (outcome.kind === 'reused') {
      this.logger.warn(`恢复凭证旧的一枚再现，整组已作废 endUserId=${outcome.endUserId} family=${outcome.familyId}`)
      throw new UnauthorizedException({ error: { code: 'MEMBER_RESTORE_REUSED', message: '登录状态已失效，请重新登录' } })
    }

    const user = await this.prisma.endUser.findUnique({
      where: { id: outcome.endUserId },
      select: { id: true, enabled: true, status: true, statusChangedAt: true, phoneEnc: true, nickname: true },
    })
    if (!user) {
      await this.revokeFamily(outcome.familyId)
      throw this.invalid()
    }
    if (!user.enabled || user.status !== 'active') {
      await this.revokeFamily(outcome.familyId)
      throw new ForbiddenException({ error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号当前不可登录，请联系工作人员' } })
    }
    // 签发之后账号状态变过（停用后又启用、注销中途撤回等）：这一组不能再用，必须重新认证。严格大于，同一毫秒不算。
    if (user.statusChangedAt && user.statusChangedAt.getTime() > outcome.startedAtMs) {
      await this.revokeFamily(outcome.familyId)
      throw this.invalid()
    }

    await this.prisma.endUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    const login = await this.auth.issueLoginForUser({
      id: user.id,
      phoneMasked: maskPhoneFromEnc(user.phoneEnc),
      nickname: user.nickname,
    })
    return { ...login, restoreToken: outcome.successor }
  }

  /** 作废这一枚凭证所在的整组（主动退出时由小程序调用）。凭证格式不对、组不存在都算成功。 */
  async revokeByToken(token: string): Promise<void> {
    const parsed = parseToken(token)
    if (!parsed) return
    await this.revokeFamily(parsed.familyId)
  }

  /** 整户作废（同一模块里的调用方用，例如换绑手机）。 */
  async revokeAll(endUserId: string): Promise<number> {
    return revokeAllMemberRestoreFamilies(this.client, endUserId)
  }

  private async rotate(token: string): Promise<RotateOutcome> {
    const parsed = parseToken(token)
    if (!parsed) return { kind: 'invalid' }
    const { idleSeconds, graceSeconds } = memberRestoreLifetimes()
    const successor = `${parsed.familyId}.${newSecret()}`
    const reply = await this.run(() => this.client.eval(
      ROTATE_SCRIPT, 1, `${FAMILY_PREFIX}${parsed.familyId}`,
      digest(parsed.secret), digest(successor.split('.')[1]), encryptSecret(successor), String(Date.now()),
      String(idleSeconds), String(graceSeconds), parsed.familyId, USER_FAMILIES_PREFIX,
    )) as string[]
    const [kind, endUserId, startedAt, successorEnc] = reply
    if (kind === 'reused') return { kind, endUserId, familyId: parsed.familyId }
    if (kind !== 'ok' && kind !== 'retry') return { kind: 'invalid' }
    return {
      kind,
      endUserId,
      familyId: parsed.familyId,
      startedAtMs: Number(startedAt),
      // 宽限期内的重试返回第一次签出的那一个后继（幂等）：服务端与客户端对「现在是哪一枚」永远一致。
      successor: kind === 'ok' ? successor : decryptSecret(successorEnc),
    }
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.run(() => this.client.eval(
      `${REVOKE_FAMILY_LUA}\nrevokeFamily(KEYS[1], ARGV[1], ARGV[2])\nreturn 1`, 1, `${FAMILY_PREFIX}${familyId}`,
      familyId, USER_FAMILIES_PREFIX,
    ))
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      this.logger.error(`恢复凭证存储不可用：${(error as Error).message}`)
      throw new ServiceUnavailableException({
        error: { code: 'MEMBER_SESSION_STORE_UNAVAILABLE', message: '登录状态暂时无法核验，请稍后重试' },
      })
    }
  }

  private invalid(): UnauthorizedException {
    return new UnauthorizedException({ error: { code: 'MEMBER_RESTORE_INVALID', message: '登录已过期，请重新登录' } })
  }
}
