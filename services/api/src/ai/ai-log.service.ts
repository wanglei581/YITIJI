import { Injectable, Logger } from '@nestjs/common'
import type { AiProviderName } from './interfaces/ai-provider.interface'
import { PrismaService } from '../prisma/prisma.service'

// ============================================================
// AI 日志服务
//
// 严格合规约束：
// - 只记录元数据（taskId / provider / latency / tokenUsage / cost / status）
// - 禁止记录：简历文本、优化建议内容、聊天消息原文、文件名、fileId
// ============================================================

const MAX_IN_MEMORY_LOGS = 500

// ⚠️ 新增 operation 取值必须三处同步，否则 Admin 侧会静默错算：
//   1. 本文件的 AiOperation 联合类型 + OPERATIONS 数组（漏了会被 normalizeOperation
//      兜底成 'classifyIntent'，即错算到别的能力头上）
//   2. AdminAiUsage.byOperation 字段（Record 完整性由 TS 保证）
//   3. apps/admin/src/services/api/types.ts 的 AiOperation +
//      apps/admin/src/routes/ai-services/index.tsx 的 OPERATION_LABELS +
//      apps/admin/src/services/api/adminAiMockAdapter.ts
// 守卫：pnpm --filter @ai-job-print/api verify:ai-cost-coverage
export type AiOperation =
  | 'parseResume'
  | 'optimizeResume'
  | 'adjustResumeLayout'
  | 'generateResume'
  | 'chatAssistant'
  | 'classifyIntent'
  | 'jobRecommend'
  | 'jobExplain'
  | 'jobMatch'
  // ── A-6 成本可见性补齐（2026-07-31）：以下能力此前完全不落 AiServiceLog ──
  | 'careerPlan'
  | 'fairVisitPlan'
  | 'interviewQuestion'
  | 'interviewReport'
  | 'voiceTranscribe'
  | 'voiceSynthesize'
  // ── 自我探索 · 倾向参考（2026-08-01） ──
  | 'selfAssessment'
/**
 * 按时长/字符计费、不按 token 计费的 operation。
 *
 * 这些行的 tokenUsage 恒为空，estimatedCostCny 通常为 undefined（我们不编造单价）。
 * Admin 侧必须据此如实标注「按时长/字符计费，未估算成本」，
 * 不得把 undefined 当成 0 展示为「免费」。
 */
export const NON_TOKEN_BILLED_OPERATIONS: readonly AiOperation[] = [
  'voiceTranscribe',
  'voiceSynthesize',
]

export interface AiLogEntry {
  taskId: string
  // provider 标签：内置 provider 名，或真实大模型 `llm:<vendor>`
  provider: AiProviderName | string
  operation: AiOperation
  latencyMs: number
  status: 'success' | 'failed'
  tokenUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  estimatedCostCny?: number
  errorCode?: string
  createdAt?: string            // ISO string; set by record() if omitted
  endUserId?: string | null
  terminalId?: string | null
  // ❌ 以下字段禁止记录：
  // 文件正文、履历正文、聊天原文、建议正文、文件标识、文件名
}

// ─── Admin 接口响应类型 ────────────────────────────────────────

export interface AdminAiUsage {
  providerName: string
  totalCalls: number
  successCount: number
  failCount: number
  successRate: number           // 0–100, one decimal
  avgLatencyMs: number          // success-only average, rounded
  byOperation: Record<AiOperation, number>
  errorDistribution: Array<{ code: string; count: number }>
  tokenUsageTotals: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  costByOperation: Record<AiOperation, number>
  alerts: Array<{
    level: 'warning' | 'critical'
    code: string
    title: string
    detail: string
  }>
  estimatedCostCny: number
}

export interface AdminAiLogsResult {
  total: number
  entries: AiLogEntry[]         // safe — no content fields in AiLogEntry
}

/**
 * record() 的入参。
 *
 * 与 AiLogEntry 的唯一差别：taskId 允许为 null。
 * taskId 只是写入侧的关联标签（控制台排查用），并不落库；
 * Admin 读取侧（getLogs）一律用 AiServiceLog.id 回填，所以那边仍是必有 string。
 * 少数 AI 调用本身不挂在任何业务任务上（例如简历语音输入的匿名 ASR 端点），
 * 这时如实写 null，而不是编一个假任务号。
 */
export type AiLogRecordInput = Omit<AiLogEntry, 'createdAt' | 'taskId'> & {
  taskId: string | null
}

const OPERATIONS: AiOperation[] = [
  'parseResume',
  'optimizeResume',
  'adjustResumeLayout',
  'generateResume',
  'chatAssistant',
  'classifyIntent',
  'jobRecommend',
  'jobExplain',
  'jobMatch',
  'careerPlan',
  'fairVisitPlan',
  'interviewQuestion',
  'interviewReport',
  'voiceTranscribe',
  'voiceSynthesize',
  'selfAssessment',
]

// ─── 跨重试用量累计（A-6）────────────────────────────────────────
//
// 一次用户可见操作（生成职业规划 / 参会准备单 / 面试问题 / 面试报告）可能触发
// 多次 LLM 调用：输出结构不合法或命中禁词时服务内部会重试。每次调用都真实花钱，
// 所以成本必须累计，而不是只记最后一次成功调用。
//
// 用法：调用方 new 一个 accumulator 传给 LLM 服务的 onLlmCall；无论最终成功还是
// 抛错，调用方都能从 accumulator 取到累计用量并落一条 AiServiceLog。

export interface AiLlmCallMeta {
  provider: string
  tokenUsage?: AiLogEntry['tokenUsage']
}

export type AiLlmCallSink = (meta: AiLlmCallMeta) => void

/** OpenAI 兼容接口的 usage 字段（不同厂商 snake_case / camelCase 混用）。 */
export interface RawLlmUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * 从 Nest 异常里取业务错误码（如 AI_UNAVAILABLE / AI_NOT_CONFIGURED）。
 * 只取错误码，不取 message——message 可能带上游返回的细节。
 */
export function aiErrorCodeOf(error: unknown, fallback = 'AI_FAILED'): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { error?: { code?: string } } }).response
    if (response?.error?.code) return response.error.code
  }
  return error instanceof Error ? error.name : fallback
}

/** 归一化上游 usage；全 0 或缺失时返回 undefined（不伪造 0 成本）。 */
export function normalizeLlmUsage(usage: RawLlmUsage | undefined): AiLogEntry['tokenUsage'] {
  if (!usage) return undefined
  const promptTokens = toNonNegativeInt(usage.prompt_tokens ?? usage.promptTokens)
  const completionTokens = toNonNegativeInt(usage.completion_tokens ?? usage.completionTokens)
  const totalTokens = toNonNegativeInt(usage.total_tokens ?? usage.totalTokens) || promptTokens + completionTokens
  if (totalTokens <= 0) return undefined
  return { promptTokens, completionTokens, totalTokens }
}

export class AiUsageAccumulator {
  private promptTokens = 0
  private completionTokens = 0
  private totalTokens = 0
  private calls = 0
  private lastProvider: string | null = null

  readonly add: AiLlmCallSink = (meta) => {
    this.calls += 1
    this.lastProvider = meta.provider
    if (!meta.tokenUsage) return
    this.promptTokens += meta.tokenUsage.promptTokens
    this.completionTokens += meta.tokenUsage.completionTokens
    this.totalTokens += meta.tokenUsage.totalTokens
  }

  /** LLM 调用次数（含失败重试）；0 表示一次都没真的打到模型（如未配置直接抛错）。 */
  get callCount(): number {
    return this.calls
  }

  get provider(): string | null {
    return this.lastProvider
  }

  /** 累计 token；一次都没拿到 usage 时返回 undefined（不伪造 0）。 */
  get tokenUsage(): AiLogEntry['tokenUsage'] {
    if (this.totalTokens <= 0 && this.promptTokens <= 0 && this.completionTokens <= 0) return undefined
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens > 0 ? this.totalTokens : this.promptTokens + this.completionTokens,
    }
  }
}

const AI_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000
const AI_COST_ALERT_CNY = (() => {
  const value = Number(process.env['AI_COST_ALERT_CNY'])
  return Number.isFinite(value) && value > 0 ? value : 50
})()

@Injectable()
export class AiLogService {
  private readonly logger = new Logger(AiLogService.name)
  private readonly logs: Array<AiLogRecordInput & { createdAt: string }> = []

  constructor(private readonly prisma: PrismaService) {}

  record(entry: AiLogRecordInput): void {
    const full: AiLogRecordInput & { createdAt: string } = {
      ...entry,
      estimatedCostCny: entry.estimatedCostCny ?? estimateCostCny(entry.provider, entry.tokenUsage),
      createdAt: new Date().toISOString(),
    }
    this.logs.push(full)
    if (this.logs.length > MAX_IN_MEMORY_LOGS) {
      this.logs.splice(0, this.logs.length - MAX_IN_MEMORY_LOGS)
    }
    void this.persist(full)
    // Phase 7.6: 控制台结构化输出；后续接入 DB 时替换此处
    console.log('[AI-LOG]', JSON.stringify({
      taskId:           full.taskId,
      provider:         full.provider,
      operation:        full.operation,
      latencyMs:        full.latencyMs,
      status:           full.status,
      tokenUsage:       full.tokenUsage,
      estimatedCostCny: full.estimatedCostCny,
      errorCode:        full.errorCode,
      createdAt:        full.createdAt,
    }))
  }

  async persist(entry: AiLogRecordInput): Promise<void> {
    // AiServiceLog 仅保存调用元数据；不包含简历原文、完整 prompt/output、签名 URL 或文件名。
    // 注意：taskId 不落库（表里没有该列），只作为控制台关联标签使用。
    await this.prisma.aiServiceLog.create({
      data: {
        operation: entry.operation,
        provider: entry.provider,
        status: entry.status,
        latencyMs: entry.latencyMs,
        errorCode: entry.errorCode ?? null,
        tokenUsageJson: entry.tokenUsage ? JSON.stringify(entry.tokenUsage) : '{}',
        estimatedCostCny: entry.estimatedCostCny ?? null,
        endUserId: entry.endUserId ?? null,
        terminalId: entry.terminalId ?? null,
      },
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'unknown'
      this.logger.warn(`aiServiceLog.persist_failed operation=${entry.operation} status=${entry.status} reason=${reason}`)
    })
  }

  async getUsage(providerName: string): Promise<AdminAiUsage> {
    const entries = await this.loadRecentEntries(providerName)
    const total         = entries.length
    const successList   = entries.filter((e) => e.status === 'success')
    const failList      = entries.filter((e) => e.status === 'failed')
    const avgLatencyMs  = successList.length > 0
      ? Math.round(successList.reduce((s, e) => s + e.latencyMs, 0) / successList.length)
      : 0

    const byOperation = operationRecord(0)
    const costByOperation = operationRecord(0)
    const tokenUsageTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const errorCounts: Record<string, number> = {}
    const callsByTerminal = new Map<string, number>()
    for (const e of entries) {
      byOperation[e.operation] += 1
      costByOperation[e.operation] += e.estimatedCostCny ?? 0
      tokenUsageTotals.promptTokens += e.tokenUsage?.promptTokens ?? 0
      tokenUsageTotals.completionTokens += e.tokenUsage?.completionTokens ?? 0
      tokenUsageTotals.totalTokens += e.tokenUsage?.totalTokens ?? 0
      if (e.status === 'failed' && e.errorCode) errorCounts[e.errorCode] = (errorCounts[e.errorCode] ?? 0) + 1
      if (e.terminalId) callsByTerminal.set(e.terminalId, (callsByTerminal.get(e.terminalId) ?? 0) + 1)
    }
    const errorDistribution = Object.entries(errorCounts).map(([code, count]) => ({ code, count }))
    const estimatedCostCny = roundMoney(entries.reduce((sum, e) => sum + (e.estimatedCostCny ?? 0), 0))

    return {
      providerName,
      totalCalls:     total,
      successCount:   successList.length,
      failCount:      failList.length,
      successRate:    total > 0 ? Math.round((successList.length / total) * 1000) / 10 : 0,
      avgLatencyMs,
      byOperation,
      errorDistribution,
      tokenUsageTotals,
      costByOperation: roundOperationCosts(costByOperation),
      alerts: buildAiUsageAlerts({ total, failCount: failList.length, estimatedCostCny, callsByTerminal }),
      estimatedCostCny,
    }
  }

  async getLogs(limit = 100): Promise<AdminAiLogsResult> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.round(limit), 500) : 100
    const rows = await this.prisma.aiServiceLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    })
    const entries = rows.map((row): AiLogEntry => ({
      taskId: row.id,
      provider: row.provider ?? 'unknown',
      operation: normalizeOperation(row.operation),
      latencyMs: row.latencyMs ?? 0,
      status: row.status === 'failed' ? 'failed' : 'success',
      tokenUsage: parseTokenUsage(row.tokenUsageJson),
      estimatedCostCny: row.estimatedCostCny ?? undefined,
      errorCode: row.errorCode ?? undefined,
      createdAt: row.createdAt.toISOString(),
      terminalId: row.terminalId ?? null,
    }))
    return { total: entries.length, entries }
  }

  private async loadRecentEntries(providerName: string): Promise<AiLogEntry[]> {
    const since = new Date(Date.now() - AI_USAGE_WINDOW_MS)
    const rows = await this.prisma.aiServiceLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    })
    return rows.map((row): AiLogEntry => ({
      taskId: row.id,
      provider: row.provider ?? providerName,
      operation: normalizeOperation(row.operation),
      latencyMs: row.latencyMs ?? 0,
      status: row.status === 'failed' ? 'failed' : 'success',
      tokenUsage: parseTokenUsage(row.tokenUsageJson),
      estimatedCostCny: row.estimatedCostCny ?? undefined,
      errorCode: row.errorCode ?? undefined,
      createdAt: row.createdAt.toISOString(),
      terminalId: row.terminalId ?? null,
    }))
  }
}

function operationRecord(value: number): Record<AiOperation, number> {
  return Object.fromEntries(OPERATIONS.map((operation) => [operation, value])) as Record<AiOperation, number>
}

function normalizeOperation(value: string): AiOperation {
  return OPERATIONS.includes(value as AiOperation) ? value as AiOperation : 'classifyIntent'
}

function parseTokenUsage(value: string | null | undefined): AiLogEntry['tokenUsage'] {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as { promptTokens?: unknown; completionTokens?: unknown; totalTokens?: unknown }
    const promptTokens = toNonNegativeInt(parsed.promptTokens)
    const completionTokens = toNonNegativeInt(parsed.completionTokens)
    const totalTokens = toNonNegativeInt(parsed.totalTokens) || promptTokens + completionTokens
    return { promptTokens, completionTokens, totalTokens }
  } catch {
    return undefined
  }
}

function toNonNegativeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function estimateCostCny(provider: string, usage: AiLogEntry['tokenUsage']): number | undefined {
  if (!usage || usage.totalTokens <= 0) return undefined
  const normalized = provider.toLowerCase()
  if (normalized.includes('mock')) return 0
  const price = normalized.includes('qwen')
    ? { input: 20, output: 60 }
    : normalized.includes('deepseek')
      ? { input: 1, output: 2 }
      : normalized.includes('zhipu')
        ? { input: 5, output: 5 }
        : normalized.includes('openai')
          ? { input: 18, output: 54 }
          : null
  if (!price) return undefined
  return roundMoney(((usage.promptTokens * price.input) + (usage.completionTokens * price.output)) / 1_000_000)
}

function roundMoney(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function roundOperationCosts(costs: Record<AiOperation, number>): Record<AiOperation, number> {
  const out = operationRecord(0)
  for (const operation of OPERATIONS) out[operation] = roundMoney(costs[operation])
  return out
}

function buildAiUsageAlerts(input: {
  total: number
  failCount: number
  estimatedCostCny: number
  callsByTerminal: Map<string, number>
}): AdminAiUsage['alerts'] {
  const alerts: AdminAiUsage['alerts'] = []
  if (input.estimatedCostCny >= AI_COST_ALERT_CNY) {
    alerts.push({
      level: 'critical',
      code: 'ai_cost_watch',
      title: 'AI 成本告警',
      detail: `近 24 小时 AI 估算成本 ¥${input.estimatedCostCny.toFixed(2)}，已达到安全关注阈值 ¥${AI_COST_ALERT_CNY.toFixed(2)}。`,
    })
  }
  if (input.total >= 10 && input.failCount / input.total >= 0.3) {
    alerts.push({
      level: 'warning',
      code: 'ai_failure_rate_watch',
      title: 'AI 失败率偏高',
      detail: `近 24 小时失败 ${input.failCount} 次，请检查模型服务、密钥或网络。`,
    })
  }
  const hotTerminal = [...input.callsByTerminal.entries()].find(([, count]) => count >= 100)
  if (hotTerminal) {
    alerts.push({
      level: 'warning',
      code: 'ai_terminal_usage_watch',
      title: '终端 AI 调用偏高',
      detail: `终端 ${hotTerminal[0]} 近 24 小时 AI 调用 ${hotTerminal[1]} 次，请核查是否异常使用。`,
    })
  }
  return alerts
}
