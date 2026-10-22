// ============================================================================
// 报价 POST /orders/quote 的限流计数维度：按验签后的会员计数
//
// 为什么不是纯 IP
// ---------------------------------------------------------------------------
// 同一出口（场地 Wi-Fi、运营商 NAT）后面的所有人共用每分钟 10 次。小程序四条
// 报价路径（print-upload、print-store、print-pay、package-confirm）都打这一条
// 路由，10-19 实测约 40 秒 14 次报价就出现 4 次 429（B-01）。
//
// 为什么不用 TerminalScopedThrottle
// ---------------------------------------------------------------------------
// 它的 tracker 直接信 `x-terminal-id`，也信没验签的 Authorization 摘要：伪造一个
// 头就能开一个新桶。这里只认验签通过的会员令牌。
//
// 口径
// ---------------------------------------------------------------------------
//   - 会员令牌验签通过（audience=enduser，有 sub 和 jti）→ 按 sub 计数，不含 IP：
//     同一人换令牌（不同 jti）、换出口，都还是同一个桶；
//   - 其余一律纯 IP，与改动前完全一样，并和匿名请求共用同一份额度：没有令牌、
//     坏令牌、过期令牌、别的密钥签的、内部令牌、只有自报的终端号或 body 字段；
//   - 额度数值不变：每会员每分钟 10 次，未认证每 IP 每分钟 10 次；`ip-wide`
//     单 IP 天花板照旧。
//
// 限流身份不是鉴权
// ---------------------------------------------------------------------------
// 本路由仍是匿名路由，访问控制靠签名 fileUrl；这里的身份只决定额度算在谁头上，
// 所以不回 401。全局 ThrottlerGuard 先于路由守卫执行、先算 tracker 再计数，
// 超限和伪造请求也会走到这里，因此只做同步验签：不读写 Redis、不查库、不续期。
//
// 代价：登出或停用只删 Redis 会话，令牌本身最多还有 30 分钟有效期
// （member-auth.module.ts 的 signOptions）。这段时间里旧令牌仍按该会员单独计数，
// 只影响额度归属，不放行任何访问。以后报价若改成必须登录，这里要换回完整验签
// （EndUserAuthGuard），不能沿用本文件。
// ============================================================================

import { createHash } from 'node:crypto'
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { resolveIpTracker, THROTTLE_WINDOW_MS } from '../common/throttler/terminal-throttle'

/** 每个已验会员、每个未认证 IP 的每分钟报价次数。维持改动前的数值，不放宽。 */
export const ORDER_QUOTE_LIMIT_PER_MINUTE = 10

/** 返回验签通过的会员 sub；不通过返回 null 或抛错，调用方一律按 IP 计。 */
type MemberVerifier = (token: string) => string | null

let verifyMember: MemberVerifier | null = null

/** 门禁与模块启动共用。未绑定时一律按 IP：验签还没接上，就不能把令牌拆成独立额度。 */
export function bindOrderQuoteMemberVerifier(fn: MemberVerifier | null): void {
  verifyMember = fn
}

/** 与 resolveOptionalEndUser 同一前缀规则：大小写不敏感的 `Bearer `，取后面的令牌。 */
function bearerTokenOf(req: unknown): string | null {
  if (!req || typeof req !== 'object') return null
  const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers
  const raw = headers?.['authorization']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || !value.toLowerCase().startsWith('bearer ')) return null
  const token = value.slice(7).trim()
  return token || null
}

/** 摘要后再进 key：sub 是会员标识，不以明文进入任何存储 key。口径同 terminal-throttle.ts。 */
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)
}

/**
 * 报价的 tracker。只有验签通过的会员才拆出独立的桶；其余全部落回纯 IP。
 * body 里的 terminalId、会员号和 x-terminal-id 请求头都不参与计数。
 */
export function orderQuoteGetTracker(req: Record<string, unknown>): string {
  const token = bearerTokenOf(req)
  if (token && verifyMember) {
    let sub: string | null = null
    try {
      sub = verifyMember(token)
    } catch {
      sub = null
    }
    if (sub) return `m:${digest(sub)}`
  }
  return resolveIpTracker(req)
}

/** 只给 POST /orders/quote 用。其他路由要按会员计数，先评审，不要直接复用。 */
export function OrderQuoteThrottle(): MethodDecorator {
  return Throttle({
    default: {
      ttl: THROTTLE_WINDOW_MS,
      limit: ORDER_QUOTE_LIMIT_PER_MINUTE,
      getTracker: orderQuoteGetTracker,
    },
  })
}

/**
 * 启动时把同步验签绑进 tracker。只注入 JwtService：tracker 在计数之前执行，
 * 不能碰 Redis 或数据库（门禁会核构造参数只有 JwtService）。
 */
@Injectable()
export class OrderQuoteThrottleBinder implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly jwt: JwtService) {}

  onModuleInit(): void {
    bindOrderQuoteMemberVerifier((token) => {
      const payload = this.jwt.verify<{ sub?: unknown; jti?: unknown }>(token, { audience: 'enduser' })
      const sub = typeof payload.sub === 'string' ? payload.sub.trim() : ''
      const jti = typeof payload.jti === 'string' ? payload.jti.trim() : ''
      // jti 必须在，但不进 key：同一人重新登录换了 jti，也还是同一个桶。
      return sub && jti ? sub : null
    })
  }

  onModuleDestroy(): void {
    bindOrderQuoteMemberVerifier(null)
  }
}
