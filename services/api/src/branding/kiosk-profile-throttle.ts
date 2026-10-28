import { Injectable, type ExecutionContext, type OnModuleInit } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
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
  if (terminalId && proof) {
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
