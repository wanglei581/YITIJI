import { Injectable, Logger } from '@nestjs/common'
import type { AiProviderName, AiTokenUsage, AiUsageReport } from './interfaces/ai-provider.interface'
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
  // ── AI-COST-TRUTH（2026-08-17）：合同审查此前**完全不落 AiServiceLog**，
  //    即 deepseek/qwen 的付费调用在用量统计里根本不存在（比记错价更严重）──
  | 'contractReview'
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
  /** 缺省 = 未采集到 token（**不是 0**）。 */
  tokenUsage?: AiTokenUsage
  /**
   * 估算成本（元）。三态语义，落库映射到 AiServiceLog.estimatedCostCny：
   * - 数字（含 0）→ 已确定成本（0 = 确实没花钱，如 mock provider / 一次都没打到模型）
   * - undefined → **未采集**，落库为 null。绝不回落成 0：那等于谎称免费。
   */
  estimatedCostCny?: number
  errorCode?: string
  createdAt?: string            // ISO string; set by record() if omitted
  endUserId?: string | null
  terminalId?: string | null
  // ❌ 以下字段禁止记录：
  // 文件正文、履历正文、聊天原文、建议正文、文件标识、文件名
}

// ─── Admin 接口响应类型 ────────────────────────────────────────

/**
 * 单个能力的成本聚合（AI-COST-TRUTH）。
 *
 * 为什么不能是纯 number：纯 number 的 0 同时兼表「这个能力花了 0 元」和
 * 「这个能力的成本没采集到」，前端**就算想诚实也没数据可用**，只能一律渲染
 * ¥0.0000 —— 对真实付费调用少算成本，且运营看不出来。
 *
 * 三态由 calls / measuredCalls 组合判定（cny 只在 measuredCalls > 0 时有意义）：
 * - calls === 0                        → 窗口内无调用
 * - calls > 0 且 measuredCalls === 0   → **未采集**，UI 必须显示「未估算」，禁止显示 ¥0
 * - measuredCalls > 0                  → cny 为**已采集那部分**的成本合计；
 *                                        measuredCalls < calls 时属部分采集，
 *                                        UI 必须同时标注还有几笔未估算
 */
export interface AiOperationCost {
  /** 已采集到成本的那部分调用的成本合计（元）。measuredCalls === 0 时恒为 0 且无意义。 */
  cny: number
  /** 窗口内该能力的总调用数。 */
  calls: number
  /** 其中成本已采集（estimatedCostCny 非空）的调用数。 */
  measuredCalls: number
}

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
  /** 分能力成本三态。**不是纯 number** —— 见 AiOperationCost 的注释。 */
  costByOperation: Record<AiOperation, AiOperationCost>
  alerts: Array<{
    level: 'warning' | 'critical'
    code: string
    title: string
    detail: string
  }>
  /** 已采集部分的成本合计（元）。窗口内还有 unmeasuredCalls 笔未采集，未计入本数。 */
  estimatedCostCny: number
  /** 窗口内成本未采集的调用数。>0 时 estimatedCostCny 是**下限**，不是全部花费。 */
  unmeasuredCalls: number
  /**
   * token 用量开始采集的日期（YYYY-MM-DD）。
   *
   * 该日期之前的调用从未采集 token，少算部分**不可恢复**。按交付章程 D-2 决定
   * **不回填**：任何回填都是拿估算冒充实测，比承认数据不全更糟。Admin 必须据此
   * 如实展示「X 之前成本不完整」，不得把历史窗口渲染成完整成本。
   * 由 AI_COST_COLLECTION_SINCE 覆盖为真实上线日期（默认值为本修复的合入日期）。
   */
  costCollectionSince: string
}

export type AiLogStatus = AiLogEntry['status']

/** 分页上限。一次最多 500 行，禁止「拉全表」。 */
export const MAX_LOG_LIMIT = 500
export const DEFAULT_LOG_LIMIT = 100

/**
 * Admin 日志列表筛选条件。
 *
 * 时间用 Date 而不是 ISO 字符串：字符串解析与非法值 400 由 controller 边界负责，
 * service 只吃已经合法的值（与 assertValidFeatureKey 的「不静默回落」同一口径）。
 */
export interface AdminAiLogsQuery {
  operation?: AiOperation
  status?: AiLogStatus
  /** 含（createdAt >= startAt） */
  startAt?: Date
  /** 不含（createdAt < endAt） */
  endAt?: Date
  limit?: number
  offset?: number
}

export interface AdminAiLogsResult {
  /** 匹配筛选条件的**总行数**，不是本页条数。 */
  total: number
  entries: AiLogEntry[]         // safe — no content fields in AiLogEntry
  limit: number
  offset: number
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
  'contractReview',
]

/** 合法 operation 取值（只读快照，供 controller 校验筛选参数）。 */
export const AI_OPERATIONS: readonly AiOperation[] = OPERATIONS
export const AI_LOG_STATUSES: readonly AiLogStatus[] = ['success', 'failed']

export function isAiOperation(value: unknown): value is AiOperation {
  return typeof value === 'string' && OPERATIONS.includes(value as AiOperation)
}

export function isAiLogStatus(value: unknown): value is AiLogStatus {
  return value === 'success' || value === 'failed'
}

/**
 * AiServiceLog 行里**本服务真正读到的**字段（结构化声明，不 import Prisma 命名空间）。
 * 故意不含 endUserId —— 读取侧压根不该碰它。
 */
interface AiServiceLogRow {
  id: string
  provider: string | null
  operation: string
  latencyMs: number | null
  status: string
  tokenUsageJson: string | null
  estimatedCostCny: number | null
  errorCode: string | null
  createdAt: Date
  terminalId: string | null
}

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
  tokenUsage?: AiTokenUsage
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
  get tokenUsage(): AiTokenUsage | undefined {
    if (this.totalTokens <= 0 && this.promptTokens <= 0 && this.completionTokens <= 0) return undefined
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens > 0 ? this.totalTokens : this.promptTokens + this.completionTokens,
    }
  }

  /**
   * 打包成 provider → 调用方的用量回报（AI-COST-TRUTH）。
   *
   * @param fallbackLabel 一次都没打到模型时使用的标签（此时没有真实厂商信息）。
   */
  toReport(fallbackLabel: string): AiUsageReport {
    return {
      providerLabel: this.lastProvider ?? fallbackLabel,
      callCount: this.calls,
      ...(this.tokenUsage ? { tokenUsage: this.tokenUsage } : {}),
    }
  }
}

/**
 * 把 provider 的用量回报翻译成 AiLogService.record 的落账字段（AI-COST-TRUTH）。
 *
 * 这是「三态」在写入侧的唯一实现，禁止在调用点各写一份 —— 一旦有人在别处
 * 写成 `estimatedCostCny: 0`，那条付费调用就会在 Admin 上显示成免费。
 *
 * @param report 缺省表示 provider 尚未接用量管路 → 按未采集处理（成本留空）。
 * @param fallbackProvider report 缺省时的 provider 标签（通常是 AiProviderName）。
 */
export function aiLogFieldsFromUsageReport(
  report: AiUsageReport | undefined,
  fallbackProvider: string,
): { provider: string; tokenUsage?: AiTokenUsage; estimatedCostCny?: number } {
  // provider 没回报 → 我们对这次调用的花费一无所知。留空 = 未采集。
  if (!report) return { provider: fallbackProvider }

  const provider = report.providerLabel || fallbackProvider

  // 一次都没打到模型（未配置 / 参数校验就失败）→ 确实没花钱，0 是实测不是编造。
  if (report.callCount === 0) return { provider, estimatedCostCny: 0 }

  // 打到模型了：成本交给 estimateCostCny 按 provider 厂商名 + token 计算。
  // 拿不到 token 或匹配不到单价时它返回 undefined → 未采集，绝不回落成 0。
  return {
    provider,
    ...(report.tokenUsage ? { tokenUsage: report.tokenUsage } : {}),
  }
}

const AI_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * token 用量开始采集的日期（YYYY-MM-DD）。
 *
 * 默认值 = AI-COST-TRUTH 修复的合入日期。此日期之前的 AiServiceLog 行从未采集
 * token，少算部分不可恢复；按交付章程 D-2 **不回填**（回填 = 拿估算冒充实测）。
 * 部署时用 AI_COST_COLLECTION_SINCE 覆盖为真实上线日期。
 */
const AI_COST_COLLECTION_SINCE = (() => {
  const raw = process.env['AI_COST_COLLECTION_SINCE']
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '2026-08-17'
})()
const AI_COST_ALERT_CNY = (() => {
  const value = Number(process.env['AI_COST_ALERT_CNY'])
  return Number.isFinite(value) && value > 0 ? value : 50
})()

@Injectable()
export class AiLogService {
  private readonly logger = new Logger(AiLogService.name)
  private readonly logs: Array<AiLogRecordInput & { createdAt: string }> = []
  /** 已 record 但尚未落库的后台写入；见 flush()。 */
  private readonly pendingWrites = new Set<Promise<void>>()

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
    this.trackWrite(this.persist(full))
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

  /**
   * 等 record() 触发的后台写入全部落库。
   *
   * record() 故意不阻塞调用方（AI 日志写库失败不该拖慢用户请求），代价是
   * 「已 record」与「已落库」之间存在一段窗口。凡是 record 之后要立刻回读
   * AiServiceLog 的地方（verify 脚本）都必须 await 本方法。
   *
   * 不要改回「固定 sleep 一小段再回读」：那在 SQLite 下恰好总能过（进程内文件
   * 写，微秒级），在 PostgreSQL 下会偶发漏读——并发的几条 INSERT 各自可能要新建
   * 连接（TCP + SCRAM-SHA-256 握手），在 CI 这种 CPU 争用环境里耗时抖动很大；
   * 而回读往往能捡到连接池里已经暖好的连接直接返回，于是读跑到写前面去了。
   */
  async flush(): Promise<void> {
    // 循环：flush 期间可能又有新的 record() 进来。
    while (this.pendingWrites.size > 0) {
      await Promise.all([...this.pendingWrites])
    }
  }

  /** 把一次后台写入登记进 pendingWrites，完成后自动摘除。 */
  private trackWrite(write: Promise<void>): void {
    // persist() 内部已吞掉异常；这里再兜一层，确保 flush() 不会因写失败而 reject，
    // 也不会产生 unhandledRejection。
    const tracked: Promise<void> = write
      .catch(() => undefined)
      .finally(() => { this.pendingWrites.delete(tracked) })
    this.pendingWrites.add(tracked)
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
    const costByOperation = emptyOperationCosts()
    const tokenUsageTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const errorCounts: Record<string, number> = {}
    const callsByTerminal = new Map<string, number>()
    let unmeasuredCalls = 0
    for (const e of entries) {
      byOperation[e.operation] += 1
      // 三态聚合：成本为 null 的行只增加 calls，**不增加** measuredCalls/cny。
      // 旧实现在这里写 `+= e.estimatedCostCny ?? 0`，把「未采集」直接吞成 0，
      // 于是下游再也分不出「花了 0 元」和「没采集到」。
      const cost = costByOperation[e.operation]
      cost.calls += 1
      if (e.estimatedCostCny !== undefined && e.estimatedCostCny !== null) {
        cost.measuredCalls += 1
        cost.cny += e.estimatedCostCny
      } else {
        unmeasuredCalls += 1
      }
      tokenUsageTotals.promptTokens += e.tokenUsage?.promptTokens ?? 0
      tokenUsageTotals.completionTokens += e.tokenUsage?.completionTokens ?? 0
      tokenUsageTotals.totalTokens += e.tokenUsage?.totalTokens ?? 0
      if (e.status === 'failed' && e.errorCode) errorCounts[e.errorCode] = (errorCounts[e.errorCode] ?? 0) + 1
      if (e.terminalId) callsByTerminal.set(e.terminalId, (callsByTerminal.get(e.terminalId) ?? 0) + 1)
    }
    const errorDistribution = Object.entries(errorCounts).map(([code, count]) => ({ code, count }))
    // 只累计**已采集**的部分。unmeasuredCalls > 0 时这是下限，不是全部花费。
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
      alerts: buildAiUsageAlerts({ total, failCount: failList.length, estimatedCostCny, callsByTerminal, unmeasuredCalls }),
      estimatedCostCny,
      unmeasuredCalls,
      costCollectionSince: AI_COST_COLLECTION_SINCE,
    }
  }

  /**
   * Admin 日志列表：**服务端**按能力 / 状态 / 时间筛选并分页。
   *
   * 为什么必须在服务端筛：此前端点只认 limit，Admin 页固定拉最近 100 条再在浏览器里
   * 按能力过滤。contractReview 这类低频能力只要没挤进最近 100 条就显示为空 ——
   * 页面在对运营说「没有调用」，而库里其实有。这是「不伪造能力」的直接违反。
   *
   * 索引：where 用的是 Prisma schema 里已建好的 `@@index([operation, createdAt])`
   * 与 `@@index([status, createdAt])`，不新建索引。
   *
   * total 语义：**匹配筛选条件的总行数**，不是本页条数（旧实现返回的是本页条数，
   * 页面拿它当总数就会少报）。
   */
  async getLogs(query: AdminAiLogsQuery = {}): Promise<AdminAiLogsResult> {
    const limit = normalizeLogLimit(query.limit)
    const offset = normalizeLogOffset(query.offset)

    // 与 audit.service.ts list() 同款动态 where 构造。
    const where: Record<string, unknown> = {}
    if (query.operation) where['operation'] = query.operation
    if (query.status) where['status'] = query.status
    if (query.startAt || query.endAt) {
      const range: Record<string, Date> = {}
      if (query.startAt) range['gte'] = query.startAt
      if (query.endAt) range['lt'] = query.endAt
      where['createdAt'] = range
    }

    const [rows, total] = await Promise.all([
      this.prisma.aiServiceLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.aiServiceLog.count({ where }),
    ])
    return { total, entries: rows.map((row) => toLogEntry(row, 'unknown')), limit, offset }
  }

  private async loadRecentEntries(providerName: string): Promise<AiLogEntry[]> {
    const since = new Date(Date.now() - AI_USAGE_WINDOW_MS)
    const rows = await this.prisma.aiServiceLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    })
    return rows.map((row) => toLogEntry(row, providerName))
  }
}

/** AiServiceLog 行 → 对外条目。getLogs 与 loadRecentEntries 共用，避免两份漂移的映射。 */
function toLogEntry(row: AiServiceLogRow, providerFallback: string): AiLogEntry {
  return {
    taskId: row.id,
    provider: row.provider ?? providerFallback,
    operation: normalizeOperation(row.operation),
    latencyMs: row.latencyMs ?? 0,
    status: row.status === 'failed' ? 'failed' : 'success',
    tokenUsage: parseTokenUsage(row.tokenUsageJson),
    estimatedCostCny: row.estimatedCostCny ?? undefined,
    errorCode: row.errorCode ?? undefined,
    createdAt: row.createdAt.toISOString(),
    terminalId: row.terminalId ?? null,
    // ⚠️ endUserId 故意不映射：AI 日志对 Admin **不暴露调用者是谁**（合规设计）。
    // 想加之前先走合规决策，不要因为「运营想定位滥用账号」就顺手补上。
  }
}

function normalizeLogLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_LOG_LIMIT
  return Math.min(Math.round(value), MAX_LOG_LIMIT)
}

function normalizeLogOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}

function operationRecord(value: number): Record<AiOperation, number> {
  return Object.fromEntries(OPERATIONS.map((operation) => [operation, value])) as Record<AiOperation, number>
}

function emptyOperationCosts(): Record<AiOperation, AiOperationCost> {
  return Object.fromEntries(
    OPERATIONS.map((operation) => [operation, { cny: 0, calls: 0, measuredCalls: 0 }]),
  ) as Record<AiOperation, AiOperationCost>
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

/**
 * 按 provider 标签里的厂商名 + token 估算成本。
 *
 * 返回 undefined = **未采集/无法定价**，调用方必须如实留空，绝不回落成 0。
 * 注意：mock / stub 判定必须在「有没有 token」之前 —— 它们压根不打上游，
 * 没花钱是事实（0 是实测），不该被算成「未采集」。
 */
function estimateCostCny(provider: string, usage: AiLogEntry['tokenUsage']): number | undefined {
  const normalized = provider.toLowerCase()
  if (normalized.includes('mock') || normalized.includes('stub')) return 0
  if (!usage || usage.totalTokens <= 0) return undefined
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

function roundOperationCosts(costs: Record<AiOperation, AiOperationCost>): Record<AiOperation, AiOperationCost> {
  const out = emptyOperationCosts()
  for (const operation of OPERATIONS) {
    out[operation] = { ...costs[operation], cny: roundMoney(costs[operation].cny) }
  }
  return out
}

function buildAiUsageAlerts(input: {
  total: number
  failCount: number
  estimatedCostCny: number
  callsByTerminal: Map<string, number>
  unmeasuredCalls: number
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
  // 成本不完整必须主动说出来：否则运营看到的是一个偏小的数字，却以为它是全部花费。
  if (input.unmeasuredCalls > 0) {
    alerts.push({
      level: 'warning',
      code: 'ai_cost_incomplete',
      title: 'AI 成本统计不完整',
      detail:
        `近 24 小时有 ${input.unmeasuredCalls} 次调用未采集到用量，其花费未计入 ¥${input.estimatedCostCny.toFixed(2)}。` +
        '该金额是下限，不是全部花费。',
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
