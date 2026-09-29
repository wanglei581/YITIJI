import { Injectable, type ExecutionContext, type OnModuleInit } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { resolveClientIpOrUnknown } from '../../common/client-ip'
import { resolveVerifiedTerminalOrIpTracker } from '../../common/throttler/terminal-throttle'
import { TerminalSessionService } from '../../terminals/terminal-session.service'
import { currentSmsTrustedEgressConfig, matchTrustedEgress } from './sms-egress-config'

/**
 * 只给「发送会员验证码」这一条路由用的每分钟限流。
 *
 * 为什么不放进 terminal-throttle.ts：那个文件明确拒绝按可伪造的终端编号全局换桶。
 * 本路由是唯一「验签通过才按终端计」的入口，还要读取受信出口的每分钟上限。
 */

export const SMS_CODE_IP_MINUTE_LIMIT = 5

const PREP = Symbol('smsCodeThrottlePrep')

type Proof = (terminalId: string, sessionToken: string | undefined) => Promise<boolean>
type Prep = { verifiedId: string | null }
type Req = Record<string, unknown>

let proof: Proof | null = null

/** 门禁与模块启动共用。未绑定时一律按 IP，避免验签还没接上就把伪造编号拆成独立额度。 */
export function bindSmsCodeTerminalProof(fn: Proof | null): void {
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

async function classify(req: Req): Promise<Prep> {
  const bag = req as Req & Record<symbol, Prep | undefined>
  const cached = bag[PREP]
  if (cached) return cached
  const terminalId = headerOf(req, 'x-terminal-id')
  let verifiedId: string | null = null
  if (terminalId && proof) {
    try {
      if (await proof(terminalId, headerOf(req, 'x-terminal-session-token'))) verifiedId = terminalId
    } catch {
      verifiedId = null
    }
  }
  const result: Prep = { verifiedId }
  bag[PREP] = result
  return result
}

export async function smsCodeMinuteLimit(context: ExecutionContext): Promise<number> {
  const req = context.switchToHttp().getRequest<Req>()
  const prep = await classify(req)
  if (prep.verifiedId) return SMS_CODE_IP_MINUTE_LIMIT
  if (matchTrustedEgress(resolveClientIpOrUnknown(req))) return currentSmsTrustedEgressConfig().minuteLimit
  return SMS_CODE_IP_MINUTE_LIMIT
}

export async function smsCodeGetTracker(req: Record<string, unknown>, _context: ExecutionContext): Promise<string> {
  const prep = await classify(req)
  return resolveVerifiedTerminalOrIpTracker(req, prep.verifiedId)
}

/** 每分钟限流：已验签终端按终端计 5 次；没有终端时，受信地址用配置的上限，其余仍是 5 次。 */
export function SmsCodeThrottle(): MethodDecorator {
  return Throttle({
    default: {
      ttl: 60_000,
      limit: smsCodeMinuteLimit,
      getTracker: smsCodeGetTracker,
    },
  })
}

@Injectable()
export class SmsCodeThrottleBinder implements OnModuleInit {
  constructor(private readonly sessions: TerminalSessionService) {}

  onModuleInit(): void {
    bindSmsCodeTerminalProof(async (terminalId, sessionToken) => {
      try {
        await this.sessions.validate(terminalId, sessionToken)
        return true
      } catch {
        return false
      }
    })
  }
}
