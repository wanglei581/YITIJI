// ============================================================================
// AI 每日金额硬上限：全局 / 单台已验签终端 / 单个会员（北京时间自然日）
//
// 为什么独立成文件：feature-scope §七 #6、#25 —— AI 费用此前只有 ai-log.service.ts 里
// 「近 24 小时 ≥50 元标红」的告警，没有任何拦截。ai-log.service.ts 已 700 行且语义是
// 「每次操作一行、给后台统计」，额度要的是「每次上游调用一行、已验签身份」的另一本账
// （AiUsageRecord），所以额度与这本账的读写放在 ai/usage/ 下独立成服务。
//
// 规则（协调方已定）：
//   - 当日已花 = 该范围 costCny 之和 + 未计量调用数 × 保守单价（取不到用量绝不当 0）。
//   - 任一范围（全局 / 该终端 / 该会员）已花 ≥ 上限 → 503 AI_BUDGET_EXHAUSTED。
//   - 读不到当日花费（数据库故障）→ **失败关闭** 503 AI_BUDGET_UNAVAILABLE。
//   - 只拦 generate / voice（在 AiAccessService.enforce 里，与 AI 暂停同一层）；
//     只读、导出、删除、打印前材料检查（@AiUseExempt）一律不拦。
//   - 读库结果缓存 ≤10 秒；缓存期内本进程新记的金额叠加在缓存上，免得 10 秒内冲过上限太多。
//     多进程部署时，别的进程在这 10 秒内新记的金额看不到 —— 上限会被冲过最多「10 秒的量」。
//   - 首次触顶：每天每个范围记一条固定标记日志（会员范围不记会员号）。
// ============================================================================

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { roundMoney } from './ai-pricing'
import { ANONYMOUS_AI_CALLER, currentAiRequestContext, type AiCallerIdentity } from './ai-usage-context'
import { aiUsageNow, beijingDayKey, registerAiUsageSink, type AiUsageRow, type AiUsageSink } from './ai-usage-meter'

export interface AiBudgetLimits {
  /** 全站每日上限（元）。 */
  globalCny: number
  /** 单台已验签终端每日上限（元）。 */
  terminalCny: number
  /** 单个会员每日上限（元）。一体机与小程序同一会员合并计。 */
  memberCny: number
  /** 取不到用量的调用按每次多少元计入（保守计入，绝不当 0）。 */
  unmeasuredCallCostCny: number
}

export const AI_BUDGET_DEFAULTS: Readonly<AiBudgetLimits> = Object.freeze({
  globalCny: 100,
  terminalCny: 30,
  memberCny: 5,
  unmeasuredCallCostCny: 0.05,
})

/** 超过这个数当配错（例如多打了几个 0），回落默认 —— 不许因为配错变成「不限」。 */
const MAX_SANE_BUDGET_CNY = 1_000_000

/**
 * 额度类 env：空、非数字、负数、Infinity、超过 100 万一律回落默认。
 * 0 是合法值，意思是「今天一分钱也不许花」（AI 全停），不是「不限」。
 */
function readBudget(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw.trim())
  return Number.isFinite(value) && value >= 0 && value <= MAX_SANE_BUDGET_CNY ? value : fallback
}

/** 未计量单价必须 > 0：配成 0 就等于把取不到用量的调用当免费，回落默认。 */
function readUnitPrice(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw.trim())
  return Number.isFinite(value) && value > 0 && value <= MAX_SANE_BUDGET_CNY ? value : fallback
}

export function readAiBudgetLimits(env: NodeJS.ProcessEnv = process.env): AiBudgetLimits {
  return {
    globalCny: readBudget(env, 'AI_DAILY_BUDGET_CNY', AI_BUDGET_DEFAULTS.globalCny),
    terminalCny: readBudget(env, 'AI_TERMINAL_DAILY_BUDGET_CNY', AI_BUDGET_DEFAULTS.terminalCny),
    memberCny: readBudget(env, 'AI_MEMBER_DAILY_BUDGET_CNY', AI_BUDGET_DEFAULTS.memberCny),
    unmeasuredCallCostCny: readUnitPrice(env, 'AI_UNMEASURED_CALL_COST_CNY', AI_BUDGET_DEFAULTS.unmeasuredCallCostCny),
  }
}

export type AiBudgetScopeKind = 'global' | 'terminal' | 'member'

export const AI_BUDGET_EXHAUSTED = 'AI_BUDGET_EXHAUSTED'
export const AI_BUDGET_UNAVAILABLE = 'AI_BUDGET_UNAVAILABLE'

const EXHAUSTED_MESSAGE: Record<AiBudgetScopeKind, string> = {
  global: '今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常',
  terminal: '这台机器今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常',
  member: '你今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常',
}
const UNAVAILABLE_MESSAGE = '暂时核不了 AI 额度，为防超支先暂停 AI，打印扫描照常'

const CACHE_TTL_MS = 10_000

interface Scope { kind: AiBudgetScopeKind; id: string | null; limit: number }
interface CachedSpend { base: number; expiresAt: number }
/** persistedSeq：落库完成时的序号；null = 还没落库（或落库失败，宁多勿少一直叠加）。 */
interface OverlayEntry { amount: number; persistedSeq: number | null }

@Injectable()
export class AiBudgetService implements AiUsageSink, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiBudgetService.name)
  readonly limits: AiBudgetLimits = readAiBudgetLimits()
  private readonly cache = new Map<string, CachedSpend>()
  private readonly overlay = new Map<string, OverlayEntry[]>()
  private readonly reachedLogged = new Set<string>()
  private currentDay: string | null = null
  /** 本进程落库完成的单调序号。用序号不用时间戳：同一毫秒里「落库完成」与「开始查询」分不出先后。 */
  private persistSeq = 0
  private unregisterSink: (() => void) | null = null

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void { this.unregisterSink = registerAiUsageSink(this) }
  onModuleDestroy(): void { this.unregisterSink?.(); this.unregisterSink = null }

  /** 一次调用计入额度的金额：实测金额，取不到用量按保守单价。 */
  chargeOf(row: Pick<AiUsageRow, 'costCny' | 'costMeasured'>): number {
    return row.costMeasured && row.costCny !== null ? row.costCny : this.limits.unmeasuredCallCostCny
  }

  /** AiUsageSink：先叠加本进程额度，再落库。落库失败向上抛（由计量器记 warn），叠加保留（宁多勿少）。 */
  async persist(row: AiUsageRow): Promise<void> {
    this.rollDay(row.dayKey)
    const entry: OverlayEntry = { amount: this.chargeOf(row), persistedSeq: null }
    for (const key of this.keysOf(row.dayKey, row)) {
      const list = this.overlay.get(key) ?? []
      list.push(entry)
      this.overlay.set(key, list)
    }
    await this.prisma.aiUsageRecord.create({ data: row })
    entry.persistedSeq = ++this.persistSeq
  }

  /**
   * 生成 / 语音类 AI 开始前调用。超限抛 503 AI_BUDGET_EXHAUSTED，读不到花费抛 503 AI_BUDGET_UNAVAILABLE。
   * identity 省略时取本请求上下文（没有上下文 = 只按全局算）。
   */
  async assertWithinBudget(identity?: AiCallerIdentity): Promise<void> {
    const caller = identity ?? await currentAiRequestContext()?.identity() ?? ANONYMOUS_AI_CALLER
    const dayKey = beijingDayKey(aiUsageNow())
    this.rollDay(dayKey)
    for (const scope of this.scopesOf(caller)) {
      let spent: number
      try {
        spent = await this.spent(dayKey, scope)
      } catch (error) {
        this.logger.warn(`AI budget read failed (${(error as { code?: string })?.code ?? (error as Error)?.name ?? 'unknown'}); failing closed`)
        throw new ServiceUnavailableException({ error: { code: AI_BUDGET_UNAVAILABLE, message: UNAVAILABLE_MESSAGE } })
      }
      if (spent >= scope.limit) {
        this.logReached(dayKey, scope)
        // 范围放在 details：全局错误过滤器只透传字符串数组 details，error 里别的字段（如 scope）会被丢掉。
        throw new ServiceUnavailableException({ error: { code: AI_BUDGET_EXHAUSTED, details: [scope.kind], message: EXHAUSTED_MESSAGE[scope.kind] } })
      }
    }
  }

  /** 该范围当日已花（元，含保守计入的未计量调用）。读库失败向上抛。 */
  async spent(dayKey: string, scope: Pick<Scope, 'kind' | 'id'>): Promise<number> {
    const key = this.key(dayKey, scope.kind, scope.id)
    const now = Date.now()
    let cached = this.cache.get(key)
    if (!cached || cached.expiresAt <= now) {
      // 查询开始前已落库完成的，一定在查询结果里；之后才完成的可能在也可能不在，继续叠加（宁多勿少）。
      const queryStartSeq = this.persistSeq
      const where = { dayKey, ...(scope.kind === 'terminal' ? { terminalId: scope.id } : {}), ...(scope.kind === 'member' ? { endUserId: scope.id } : {}) }
      const groups = await this.prisma.aiUsageRecord.groupBy({ by: ['costMeasured'], where, _sum: { costCny: true }, _count: { _all: true } })
      let base = 0
      for (const group of groups) {
        base += group.costMeasured ? (group._sum.costCny ?? 0) : group._count._all * this.limits.unmeasuredCallCostCny
      }
      cached = { base, expiresAt: now + CACHE_TTL_MS }
      this.cache.set(key, cached)
      const list = this.overlay.get(key)
      if (list) this.overlay.set(key, list.filter((entry) => entry.persistedSeq === null || entry.persistedSeq > queryStartSeq))
    }
    const extra = (this.overlay.get(key) ?? []).reduce((sum, entry) => sum + entry.amount, 0)
    return roundMoney(cached.base + extra)
  }

  /** 清掉缓存与叠加（门禁在直接改库后调用）。 */
  resetForTests(): void { this.cache.clear(); this.overlay.clear(); this.reachedLogged.clear(); this.currentDay = null }

  private scopesOf(caller: AiCallerIdentity): Scope[] {
    const scopes: Scope[] = [{ kind: 'global', id: null, limit: this.limits.globalCny }]
    if (caller.terminalVerified && caller.terminalId) scopes.push({ kind: 'terminal', id: caller.terminalId, limit: this.limits.terminalCny })
    if (caller.endUserId) scopes.push({ kind: 'member', id: caller.endUserId, limit: this.limits.memberCny })
    return scopes
  }

  private keysOf(dayKey: string, row: Pick<AiUsageRow, 'terminalId' | 'terminalVerified' | 'endUserId'>): string[] {
    const keys = [this.key(dayKey, 'global', null)]
    if (row.terminalVerified && row.terminalId) keys.push(this.key(dayKey, 'terminal', row.terminalId))
    if (row.endUserId) keys.push(this.key(dayKey, 'member', row.endUserId))
    return keys
  }

  private key(dayKey: string, kind: AiBudgetScopeKind, id: string | null): string { return `${dayKey}|${kind}|${id ?? ''}` }

  /** 换日时丢掉前一天的缓存、叠加与触顶标记，内存不随天数增长。 */
  private rollDay(dayKey: string): void {
    if (this.currentDay === dayKey) return
    if (this.currentDay !== null && dayKey < this.currentDay) return
    this.currentDay = dayKey
    for (const map of [this.cache, this.overlay] as Array<Map<string, unknown>>) {
      for (const key of [...map.keys()]) if (!key.startsWith(`${dayKey}|`)) map.delete(key)
    }
    for (const key of [...this.reachedLogged]) if (!key.startsWith(`${dayKey}|`)) this.reachedLogged.delete(key)
  }

  private logReached(dayKey: string, scope: Scope): void {
    const key = this.key(dayKey, scope.kind, scope.id)
    if (this.reachedLogged.has(key)) return
    this.reachedLogged.add(key)
    // 固定标记，运维按 AI_DAILY_BUDGET_REACHED 检索。终端号可记；会员号不记。
    const who = scope.kind === 'terminal' ? ` terminal=${scope.id}` : ''
    this.logger.warn(`AI_DAILY_BUDGET_REACHED scope=${scope.kind}${who} limit=${scope.limit} day=${dayKey}`)
  }
}
