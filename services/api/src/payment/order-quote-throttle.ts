// ============================================================================
// 报价 POST /orders/quote 的限流计数维度
//
//   - 会员令牌验签通过（audience=enduser，有 sub 和 jti）→ 按 sub 计数，不含 IP。
//     这一支保持同步：不读缓存、不调用终端验票、不读写 Redis、不查库、不续期。
//     同一人换令牌（不同 jti）、换出口，都还是同一个桶。
//   - 已验终端会话 → 按终端计数（t: + 终端号摘要）。必须走现有 TerminalSessionService
//     .validate。不信 body 里的 terminalId，也不信单独的 x-terminal-id。
//   - 其余一律纯 IP，与匿名请求共用同一份额度。
//
// 额度数值不变：每会员、每已验终端、每未认证 IP 都是每分钟 10 次。ip-wide 单 IP
// 天花板照旧，本装饰器只换 default 的 tracker。报价仍是匿名路由，不回 401。
//
// 终端验票是有界的，不是「任意超限请求永远 0 次存储读」：
//   - 这张票的正缓存未过期且未被淘汰：含即将 429 的那次，Redis get 与 Prisma 都是 0。
//   - 换票、自然过期、淘汰之后的下一跳最多再验一次（1 次 get，会话还在则再 1 次
//     findUnique）。桶仍是同一终端，不重置每分钟 10 次。
//   - 正缓存到期点 = 验票开始的单调时钟 + 60s，不是完成时刻 + 60s。
//     完成时刻已越过开始 + 60s 的结果整段丢弃。
//   - 调用方最多等 200ms，超时本请求按 IP 返回。底层调用不取消，同一键的在途槽
//     占到 Promise 结束，避免同键再开第二条 validate。
//   - 未知票每 IP 每 60s 最多 K=10 次验票。这些表都在本进程内存里。N 个进程时
//     未知票 Redis 读取上限是 N×K，不是全局 K。同一出口 1 分钟内 10 张不同伪造票
//     会占满 K，刚换票且不在正缓存里的真终端本分钟会落到匿名 IP 桶。
//   - 不因此取消 429，也不宣称共享出口的所有场景已经解决。
//
// 不打印原始票、终端号或缓存键。不调用 refresh / issue / 引导票交换。
// ============================================================================

import { createHash } from 'node:crypto'
import { Injectable, UnauthorizedException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { resolveIpTracker, resolveVerifiedTerminalOrIpTracker, THROTTLE_WINDOW_MS } from '../common/throttler/terminal-throttle'
import { TerminalSessionService } from '../terminals/terminal-session.service'

/** 每个已验会员、每个已验终端、每个未认证 IP 的每分钟报价次数。不放宽。 */
export const ORDER_QUOTE_LIMIT_PER_MINUTE = 10

/** 终端分支的内存上界。改数值必须同时改 verify:order-quote-throttle-identity。 */
export const ORDER_QUOTE_TERMINAL_LIMITS = {
  positiveTtlMs: 60_000,
  positiveCapacity: 256,
  negativeTtlMs: 30_000,
  negativeCapacity: 256,
  unknownPerIp: 10,
  unknownWindowMs: 60_000,
  unknownIpCapacity: 1024,
  callerWaitMs: 200,
  inflightCapacity: 1024,
} as const

const INVALID_CODE = 'TERMINAL_SESSION_INVALID'

type MemberVerifier = (token: string) => string | null
type Verdict = { ok: true; bucket: string } | { ok: false }
type PositiveEntry = { bucket: string; expiresAt: number }
type BudgetRow = { start: number; count: number }
type Inflight = { ready: Promise<Verdict> }

let verifyMember: MemberVerifier | null = null
let terminalSessions: TerminalSessionService | null = null

const positive = new Map<string, PositiveEntry>()
const negative = new Map<string, number>()
const budgets = new Map<string, BudgetRow>()
const inflight = new Map<string, Inflight>()

export function bindOrderQuoteMemberVerifier(fn: MemberVerifier | null): void {
  verifyMember = fn
}

function resetTerminalQuoteState(): void {
  positive.clear()
  negative.clear()
  budgets.clear()
  inflight.clear()
}

function bindTerminalSessions(sessions: TerminalSessionService | null): void {
  terminalSessions = sessions
  if (!sessions) resetTerminalQuoteState()
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)
}

function bearerTokenOf(req: unknown): string | null {
  if (!req || typeof req !== 'object') return null
  const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers
  const raw = headers?.['authorization']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || !value.toLowerCase().startsWith('bearer ')) return null
  const token = value.slice(7).trim()
  return token || null
}

function headerOf(req: unknown, name: string): string | null {
  if (!req || typeof req !== 'object') return null
  const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers
  if (!headers) return null
  const raw = headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function ticketCacheKey(terminalId: string, sessionToken: string): string {
  return digest(`${terminalId}\0${sessionToken}`)
}

function memberBucket(req: Record<string, unknown>): string | null {
  const token = bearerTokenOf(req)
  if (!token || !verifyMember) return null
  let sub: string | null = null
  try {
    sub = verifyMember(token)
  } catch {
    sub = null
  }
  return sub ? `m:${digest(sub)}` : null
}

function remember<T>(map: Map<string, T>, key: string, value: T, capacity: number): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
  while (map.size > capacity) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

function readPositive(key: string, now: number): string | null {
  const hit = positive.get(key)
  if (!hit) return null
  if (now >= hit.expiresAt) {
    positive.delete(key)
    return null
  }
  remember(positive, key, hit, ORDER_QUOTE_TERMINAL_LIMITS.positiveCapacity)
  return hit.bucket
}

function readNegative(key: string, now: number): boolean {
  const expiresAt = negative.get(key)
  if (expiresAt === undefined) return false
  if (now >= expiresAt) {
    negative.delete(key)
    return false
  }
  remember(negative, key, expiresAt, ORDER_QUOTE_TERMINAL_LIMITS.negativeCapacity)
  return true
}

function consumeUnknownBudget(ip: string, now: number): boolean {
  const windowMs = ORDER_QUOTE_TERMINAL_LIMITS.unknownWindowMs
  for (const [known, row] of budgets) {
    if (now >= row.start + windowMs) budgets.delete(known)
  }
  const row = budgets.get(ip)
  if (row) {
    if (row.count >= ORDER_QUOTE_TERMINAL_LIMITS.unknownPerIp) return false
    row.count += 1
    return true
  }
  if (budgets.size >= ORDER_QUOTE_TERMINAL_LIMITS.unknownIpCapacity) return false
  budgets.set(ip, { start: now, count: 1 })
  return true
}

function isDefiniteInvalid(error: unknown): boolean {
  if (!(error instanceof UnauthorizedException)) return false
  const body = error.getResponse()
  if (!body || typeof body !== 'object') return false
  const code = (body as { error?: { code?: unknown } }).error?.code
  return code === INVALID_CODE
}

function raceCaller(ready: Promise<Verdict>, ip: string): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(ip), ORDER_QUOTE_TERMINAL_LIMITS.callerWaitMs)
    ready.then(
      (verdict) => {
        clearTimeout(timer)
        resolve(verdict.ok ? verdict.bucket : ip)
      },
      () => {
        clearTimeout(timer)
        resolve(ip)
      },
    )
  })
}

/** 唯一允许 await 的函数。调用方超时不取消这条 Promise。 */
async function runTerminalValidation(
  terminalId: string,
  sessionToken: string,
  key: string,
  startMono: number,
  resolveReady: (verdict: Verdict) => void,
): Promise<void> {
  const sessions = terminalSessions
  try {
    if (!sessions) {
      resolveReady({ ok: false })
      return
    }
    await sessions.validate(terminalId, sessionToken)
    const settle = performance.now()
    if (settle >= startMono + ORDER_QUOTE_TERMINAL_LIMITS.positiveTtlMs) {
      resolveReady({ ok: false })
      return
    }
    const bucket = resolveVerifiedTerminalOrIpTracker({}, terminalId)
    remember(positive, key, { bucket, expiresAt: startMono + ORDER_QUOTE_TERMINAL_LIMITS.positiveTtlMs }, ORDER_QUOTE_TERMINAL_LIMITS.positiveCapacity)
    resolveReady({ ok: true, bucket })
  } catch (error) {
    const settle = performance.now()
    if (settle < startMono + ORDER_QUOTE_TERMINAL_LIMITS.positiveTtlMs && isDefiniteInvalid(error)) {
      remember(negative, key, startMono + ORDER_QUOTE_TERMINAL_LIMITS.negativeTtlMs, ORDER_QUOTE_TERMINAL_LIMITS.negativeCapacity)
    }
    resolveReady({ ok: false })
  } finally {
    inflight.delete(key)
  }
}

function startTerminalValidation(req: Record<string, unknown>, terminalId: string, sessionToken: string, key: string): Promise<string> {
  const ip = resolveIpTracker(req)
  const existing = inflight.get(key)
  if (existing) return raceCaller(existing.ready, ip)
  if (inflight.size >= ORDER_QUOTE_TERMINAL_LIMITS.inflightCapacity) return Promise.resolve(ip)
  if (!consumeUnknownBudget(ip, performance.now())) return Promise.resolve(ip)
  const startMono = performance.now()
  let resolveReady: (verdict: Verdict) => void = () => {}
  const ready = new Promise<Verdict>((resolve) => {
    resolveReady = resolve
  })
  inflight.set(key, { ready })
  void runTerminalValidation(terminalId, sessionToken, key, startMono, resolveReady)
  return raceCaller(ready, ip)
}

/**
 * 会员与匿名分支同步返回字符串。终端未命中返回 Promise。
 * 函数体自身不写 await。
 */
export function orderQuoteGetTracker(req: Record<string, unknown>): string | Promise<string> {
  const member = memberBucket(req)
  if (member) return member
  if (!terminalSessions) return resolveIpTracker(req)
  const terminalId = headerOf(req, 'x-terminal-id')
  const sessionToken = headerOf(req, 'x-terminal-session-token')
  if (!terminalId || !sessionToken) return resolveIpTracker(req)
  const now = performance.now()
  const key = ticketCacheKey(terminalId, sessionToken)
  const cached = readPositive(key, now)
  if (cached) return cached
  if (readNegative(key, now)) return resolveIpTracker(req)
  return startTerminalValidation(req, terminalId, sessionToken, key)
}

/** 只给 POST /orders/quote 用。其他路由要按会员或终端计数，先评审，不要直接复用。 */
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
 * 会员验签只使用 JwtService。终端验票只使用已有的 TerminalSessionService。
 * 本类不注入 Redis 或 Prisma，也不续期。
 */
@Injectable()
export class OrderQuoteThrottleBinder implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: TerminalSessionService,
  ) {}

  onModuleInit(): void {
    resetTerminalQuoteState()
    bindOrderQuoteMemberVerifier((token) => {
      const payload = this.jwt.verify<{ sub?: unknown; jti?: unknown }>(token, { audience: 'enduser' })
      const sub = typeof payload.sub === 'string' ? payload.sub.trim() : ''
      const jti = typeof payload.jti === 'string' ? payload.jti.trim() : ''
      // jti 必须在，但不进 key：同一人重新登录换了 jti，也还是同一个桶。
      return sub && jti ? sub : null
    })
    bindTerminalSessions(this.sessions)
  }

  onModuleDestroy(): void {
    bindOrderQuoteMemberVerifier(null)
    bindTerminalSessions(null)
  }
}
