import { Injectable, type ExecutionContext, type OnModuleInit } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { resolveClientIpOrUnknown } from '../common/client-ip'
import { resolveVerifiedTerminalOrIpTracker } from '../common/throttler/terminal-throttle'
import { TerminalSessionService } from '../terminals/terminal-session.service'

/**
 * GET /public/kiosk-profile 的每分钟限流：**验签通过才按终端号计数，没验过的一律按 IP 计数**。
 *
 * 为什么不用 TerminalScopedThrottle：它按请求头里客户端自己填的 x-terminal-id 分桶，
 * 没验签的请求换一个终端号就换一份 30 次额度，等于限流可以被伪造的编号拆掉。
 * 这里先用 TerminalSessionService.validate 验过 (x-terminal-id, x-terminal-session-token)，
 * 验过的按终端摘要计数（同一台机器换出口地址不换额度），验不过的退回纯 IP——伪造编号拆不了桶。
 * （共享的 TerminalScopedThrottle 在别的路由上有同样的问题，不在本次改动范围，已记为后续。）
 */

export const KIOSK_PROFILE_MINUTE_LIMIT = 30
export const KIOSK_PROFILE_WINDOW_MS = 60_000

/**
 * 验签**之前**的廉价总量限流：按 IP、进程内计数、不碰 Redis。
 * 为什么要有：验签要查一次 Redis，伪造请求即使最后被 429，也会先把 Redis 查询花掉；一个 IP 狂发就能放大成对 Redis 的压力。
 * 这一层按 IP 每分钟总量卡住：超过后不再验签（当作未验签，落进 IP 桶），一次 Redis 都不查。
 * 额度要容得下同一出口 IP 下一个大厅里所有终端各自 30 次的验签请求（600 ≈ 20 台），再多的只可能是刷。
 */
export const KIOSK_PROFILE_PRE_VERIFY_IP_LIMIT = 600
/**
 * 计数表的内存上限：来源 IP 只认 Express 在 trust proxy 配置后填的 req.ip（不信 X-Forwarded-For），所以不同 IP 的数量受真实来源限制；
 * 但 IPv6 能一个人换出海量地址，表不能因此无限长。条数到 PURGE_AT 才扫一次过期项（且至少隔 5 秒一次，不是每个新来源都扫整张表），
 * 到 MAX_IPS 直接清空——这一层放宽一阵子，后面还有按 IP 的 30 次/分钟桶和全局 ip-wide 桶，不会因此无设防。
 */
export const KIOSK_PROFILE_PRE_VERIFY_MAX_IPS = 50_000
const PRE_VERIFY_PURGE_AT = 10_000
const PRE_VERIFY_PURGE_EVERY_MS = 5_000
const preVerifyHits = new Map<string, { windowStart: number; count: number }>()
let preVerifyLastPurge = 0

function preVerifyExceeded(ip: string, now: number): boolean {
  let entry = preVerifyHits.get(ip)
  if (!entry || now - entry.windowStart >= KIOSK_PROFILE_WINDOW_MS) {
    if (!entry) {
      if (preVerifyHits.size >= KIOSK_PROFILE_PRE_VERIFY_MAX_IPS) {
        preVerifyHits.clear()
      } else if (preVerifyHits.size >= PRE_VERIFY_PURGE_AT && now - preVerifyLastPurge >= PRE_VERIFY_PURGE_EVERY_MS) {
        preVerifyLastPurge = now
        for (const [key, value] of preVerifyHits) if (now - value.windowStart >= KIOSK_PROFILE_WINDOW_MS) preVerifyHits.delete(key)
      }
    }
    entry = { windowStart: now, count: 0 }
    preVerifyHits.set(ip, entry)
  }
  entry.count += 1
  return entry.count > KIOSK_PROFILE_PRE_VERIFY_IP_LIMIT
}

/** 门禁里清空验签前的计数，免得前一个场景的请求算进后一个场景。 */
export function resetKioskProfilePreVerifyForTests(): void {
  preVerifyHits.clear()
  preVerifyLastPurge = 0
}

/** 门禁里看计数表现在有多少个来源（测内存上限）。 */
export function kioskProfilePreVerifySizeForTests(): number {
  return preVerifyHits.size
}
const PREP = Symbol('kioskProfileThrottlePrep')

type Proof = (terminalId: string, sessionToken: string | undefined) => Promise<boolean>
type Req = Record<string, unknown>

let proof: Proof | null = null

/** 模块启动与门禁共用。未绑定时一律按 IP，避免验签还没接上就把伪造编号拆成独立额度。 */
export function bindKioskProfileTerminalProof(fn: Proof | null): void {
  proof = fn
}

function headerOf(req: Req, name: string): string | undefined {
  const headerFn = req['header']
  if (typeof headerFn === 'function') {
    const value = (headerFn as (this: unknown, name: string) => unknown).call(req, name)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const headers = req['headers']
  if (!headers || typeof headers !== 'object') return undefined
  const raw = (headers as Record<string, unknown>)[name.toLowerCase()]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function verifiedTerminalId(req: Req): Promise<string | null> {
  const bag = req as Req & Record<symbol, { id: string | null } | undefined>
  const cached = bag[PREP]
  if (cached) return cached.id
  const terminalId = headerOf(req, 'x-terminal-id')
  let id: string | null = null
  // 先过廉价的 IP 总量闸：超了就不验签（不查 Redis），按未验签处理 → 落进 IP 桶 → 很快 429。
  const overBudget = preVerifyExceeded(resolveClientIpOrUnknown(req), Date.now())
  if (terminalId && proof && !overBudget) {
    try {
      if (await proof(terminalId, headerOf(req, 'x-terminal-session-token'))) id = terminalId
    } catch {
      id = null
    }
  }
  bag[PREP] = { id }
  return id
}

export async function kioskProfileGetTracker(req: Req, _context: ExecutionContext): Promise<string> {
  return resolveVerifiedTerminalOrIpTracker(req, await verifiedTerminalId(req))
}

/** 每分钟 30 次：已验签终端按终端计，其余按 IP 计。 */
export function KioskProfileThrottle(): MethodDecorator {
  return Throttle({
    default: {
      ttl: KIOSK_PROFILE_WINDOW_MS,
      limit: KIOSK_PROFILE_MINUTE_LIMIT,
      getTracker: kioskProfileGetTracker,
    },
  })
}

@Injectable()
export class KioskProfileThrottleBinder implements OnModuleInit {
  constructor(private readonly sessions: TerminalSessionService) {}

  onModuleInit(): void {
    bindKioskProfileTerminalProof(async (terminalId, sessionToken) => {
      try {
        await this.sessions.validate(terminalId, sessionToken)
        return true
      } catch {
        return false
      }
    })
  }
}
