import { Injectable, Optional } from '@nestjs/common'
import { currentAiRequestContext } from '../ai/usage/ai-usage-context'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalSessionService } from '../terminals/terminal-session.service'
import { kioskJobBoardTerminalRef, type KioskJobBoardRequest } from '../terminals/kiosk-job-board.service'
import { policyScopeMode, type PolicyPublicScope } from './policy-public-visibility'

/** 公开政策相关接口共用的、已验明身份的终端机构解析。 */
@Injectable()
export class PolicyScopeService {
  constructor(
    @Optional() private readonly terminalSessions?: TerminalSessionService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async resolve(req?: KioskJobBoardRequest | { headers?: Record<string, string | string[] | undefined> }): Promise<PolicyPublicScope> {
    if (policyScopeMode() === 'all') return { mode: 'all' }
    const ref = kioskJobBoardTerminalRef(req ?? {})
    const terminalId = ref
    const token = req?.headers?.['x-terminal-session-token']
    if (!terminalId || typeof token !== 'string' || !this.terminalSessions || !this.prisma) {
      return { mode: 'org', orgId: null, state: 'missing' }
    }
    try { await this.terminalSessions.validate(terminalId, token) } catch { return { mode: 'org', orgId: null, state: 'missing' } }
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId }, select: { orgId: true } })
    return scopeForVerifiedCaller({ terminalVerified: true, orgId: terminal?.orgId ?? null })
  }
}

/**
 * 会话已经验过之后的范围，和 resolve() 验过令牌后的那一档相同。
 * 缺省 all 时不看终端。org 下：没验过是认不出，验过但没有机构是未绑定，有机构只看该机构。
 */
export function scopeForVerifiedCaller(
  caller: { terminalVerified: boolean; orgId: string | null } | null | undefined,
): PolicyPublicScope {
  if (policyScopeMode() === 'all') return { mode: 'all' }
  if (!caller?.terminalVerified) return { mode: 'org', orgId: null, state: 'missing' }
  return caller.orgId
    ? { mode: 'org', orgId: caller.orgId, state: 'bound' }
    : { mode: 'org', orgId: null, state: 'unbound' }
}

/**
 * 小青读政策和打印办事清单再核对：这次 HTTP 上中间件已经验过终端。
 * 没有请求上下文时（门禁直接调函数）保持 all，与 resolvePolicyScope(undefined) 同一口径。
 * 一旦有上下文，org 下按已验终端切开，不再退回 all。
 */
export async function scopeForAmbientPolicyRead(): Promise<PolicyPublicScope> {
  if (policyScopeMode() === 'all') return { mode: 'all' }
  const context = currentAiRequestContext()
  if (!context) return { mode: 'all' }
  return scopeForVerifiedCaller(await context.identity())
}

/**
 * 控制器上的 PolicyScopeService 是可选注入（与同文件的 jobBoard 一样，方便门禁按旧签名手动构造）：
 * 缺省时按 all 处理，即合入前的行为。生产装配里四个模块都提供了它（verify:policy-scope 有断言）。
 */
export function resolvePolicyScope(
  service: PolicyScopeService | undefined,
  req?: KioskJobBoardRequest | { headers?: Record<string, string | string[] | undefined> },
): Promise<PolicyPublicScope> {
  return service ? service.resolve(req) : Promise.resolve({ mode: 'all' })
}
