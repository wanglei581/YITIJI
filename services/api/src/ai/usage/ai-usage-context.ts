// ============================================================================
// AI 计量与额度用的「本次请求是谁」：会员 / 已验签终端 / 终端所属机构
//
// 为什么独立成文件（不塞进 client-declaration.ts 或 ai-access.service.ts）：
//   - 计量点在 ai/llm/llm-http.ts 的 llmFetchJson 里，那是个纯函数，拿不到 Nest 注入，
//     也拿不到 req；12 个 LLM 调用点不许改签名。唯一能把「谁」送到那里的是
//     AsyncLocalStorage（与 client-declaration.ts 同一种写法）。
//   - 额度拦截在 AiAccessService.enforce，而 AiAccessModule 被 TerminalsModule 导入，
//     AiAccessService 若直接注入 TerminalSessionService 就成了循环依赖。所以由挂在
//     app.module 的中间件（能拿到 TerminalSessionService）往 ALS 里放一个**惰性解析器**，
//     两处都从这里取。
//
// 惰性：中间件只放一个闭包，不做任何 I/O。第一次有人问「是谁」时才解析，本请求内缓存。
// 不需要记账、不需要查额度的请求（打印、扫描、后台……）零额外开销。
//
// 口径：
//   - 会员：与现有做法一致，走 resolveOptionalEndUser（令牌无效 / 过期 / Redis 故障一律当匿名）。
//   - 终端：只认 x-terminal-id + x-terminal-session-token 经 TerminalSessionService.validate
//     验过的；没带、验不过、Redis 故障一律当「无终端」（terminalId=null），**绝不**把
//     请求头里自称的终端号记进账或拿去算单机额度——那个头谁都能伪造。
//   - 机构：该终端当时所属 orgId（Terminal.orgId），查不到为 null。
//   - 解析永不抛错：它服务于计量与额度，身份解析失败不能把一次 AI 请求变成 500。
// ============================================================================

import { AsyncLocalStorage } from 'node:async_hooks'
import type { JwtService } from '@nestjs/jwt'
import { resolveOptionalEndUser } from '../../common/auth/optional-end-user'
import type { RedisService } from '../../common/redis/redis.service'
import type { PrismaService } from '../../prisma/prisma.service'

export interface AiCallerIdentity {
  endUserId: string | null
  /** 只有验签通过才非空。 */
  terminalId: string | null
  terminalVerified: boolean
  orgId: string | null
}

export const ANONYMOUS_AI_CALLER: Readonly<AiCallerIdentity> = Object.freeze({
  endUserId: null,
  terminalId: null,
  terminalVerified: false,
  orgId: null,
})

export interface AiRequestContext {
  /** 本请求的调用方身份；第一次调用时解析，之后返回同一个结果。永不 reject。 */
  identity(): Promise<AiCallerIdentity>
}

const store = new AsyncLocalStorage<AiRequestContext>()

export function runWithAiRequestContext<T>(context: AiRequestContext, fn: () => T): T {
  return store.run(context, fn)
}

export function currentAiRequestContext(): AiRequestContext | undefined {
  return store.getStore()
}

/** 把一个解析函数包成「只解析一次、失败当匿名」的上下文。 */
export function lazyAiRequestContext(resolve: () => Promise<AiCallerIdentity>): AiRequestContext {
  let pending: Promise<AiCallerIdentity> | null = null
  return {
    identity() {
      pending ??= resolve().catch(() => ({ ...ANONYMOUS_AI_CALLER }))
      return pending
    },
  }
}

/**
 * 队列作业（没有 HTTP 请求）里的调用方身份：只有作业自己知道的会员号，终端与机构如实为空。
 *
 * 为什么不能直接沿用「当前上下文」：BullMQ 的回调跑在 Redis 连接的事件里，而 ALS 会随
 * 「谁先建的连接 / 谁先注册的回调」漏进来 —— 作业可能碰巧带着某个无关 HTTP 请求的会员与终端。
 * 作业里的计量必须显式用这个上下文覆盖，账才记在任务属主名下，而不是记给碰巧的那个请求。
 *
 * 终端 / 机构为什么是 null：作业里没有终端会话令牌可验，按口径未验签一律不记（见文件头）。
 */
export function backgroundJobAiContext(endUserId: string | null): AiRequestContext {
  const identity: AiCallerIdentity = { ...ANONYMOUS_AI_CALLER, endUserId }
  return { identity: () => Promise.resolve({ ...identity }) }
}

/** 终端验签只需要这一个方法；用接口而不是类，避免 ai/ 反向 import terminals/。 */
export interface TerminalSessionValidator {
  validate(terminalId: string | undefined, sessionToken: string | undefined): Promise<void>
}

export interface AiCallerResolverDeps {
  jwt: JwtService
  redis: RedisService
  prisma: PrismaService
  terminalSessions: TerminalSessionValidator
}

type HeaderBag = Record<string, string | string[] | undefined> | undefined

function header(headers: HeaderBag, name: string): string | undefined {
  const raw = headers?.[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function resolveVerifiedTerminal(headers: HeaderBag, deps: AiCallerResolverDeps): Promise<Pick<AiCallerIdentity, 'terminalId' | 'terminalVerified' | 'orgId'>> {
  const terminalId = header(headers, 'x-terminal-id')
  const sessionToken = header(headers, 'x-terminal-session-token')
  if (!terminalId || !sessionToken) return { terminalId: null, terminalVerified: false, orgId: null }
  try {
    await deps.terminalSessions.validate(terminalId, sessionToken)
  } catch {
    return { terminalId: null, terminalVerified: false, orgId: null }
  }
  let orgId: string | null = null
  try {
    const terminal = await deps.prisma.terminal.findUnique({ where: { id: terminalId }, select: { orgId: true } })
    orgId = terminal?.orgId ?? null
  } catch {
    orgId = null
  }
  return { terminalId, terminalVerified: true, orgId }
}

/** 按请求头解析调用方。会员与终端并行解析；任一失败只影响它自己那一项。 */
export async function resolveAiCaller(headers: HeaderBag, deps: AiCallerResolverDeps): Promise<AiCallerIdentity> {
  const [member, terminal] = await Promise.all([
    resolveOptionalEndUser(header(headers, 'authorization'), deps.jwt, deps.redis, deps.prisma).catch(() => null),
    resolveVerifiedTerminal(headers, deps),
  ])
  return { endUserId: member?.endUserId ?? null, ...terminal }
}
