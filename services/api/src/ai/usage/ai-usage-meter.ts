// ============================================================================
// AI 逐次计量：每次**真的发出**的大模型请求，落 AiUsageRecord 一行
//
// 为什么独立成文件：ai/llm/llm-http.ts 是全站 LLM 调用的主出口，后面 P1-2b（主备切换）
// 还要改它；那里只留「开始 / 收到响应 / 结束」几行调用，计量逻辑全在这里。
// 另一个出口是合同审查（contract-review-provider.service.ts 的 StrictFetchContractProviderTransport），
// 它不经 llmFetchJson，同样只在 send 里调这几行。
//
// 记什么（只有元数据）：功能、厂商（按请求 URL 主机映射）、型号（请求体 model）、状态、
// HTTP 状态码、tokens、折算金额、已验签终端、终端所属机构、会员。
// 不记什么：请求 / 响应正文、提示词、文件名、URL 路径与查询串、未验签的终端号。
//
// 什么时候记：
//   - 记：请求已经发出去之后的所有结局 —— 成功、上游非 2xx（429 记 busy）、超时、
//     网络错误、客户端断开（aborted）、输出被内容检查拦下（blocked，钱已经花了）。
//   - 不记：出站白名单拒绝、输入内容检查拦下、并发闸门拒绝、请求在发出前已被取消 ——
//     这几种一个上游请求都没发，没花钱。
//
// 金额：有 usage 才按 ai-pricing.ts 的同一份价目折算；取不到用量或定不了价，
// costCny = null、costMeasured = false，**绝不写 0**。额度汇总时这类调用按保守单价计入。
//
// 写账失败绝不影响本次 AI 结果：计量是异步落库的，失败只记一条 warn（不带正文与会员号）。
// ============================================================================

import { Logger } from '@nestjs/common'
import { normalizeLlmUsage } from '../ai-log.service'
import { priceTokens } from './ai-pricing'
import { ANONYMOUS_AI_CALLER, currentAiRequestContext, type AiRequestContext } from './ai-usage-context'

export type AiUsageStatus = 'ok' | 'upstream_error' | 'busy' | 'timeout' | 'network_error' | 'aborted' | 'blocked'

export interface AiUsageRow {
  createdAt: Date
  dayKey: string
  featureKey: string
  vendor: string
  model: string | null
  status: AiUsageStatus
  httpStatus: number | null
  promptTokens: number | null
  completionTokens: number | null
  costCny: number | null
  costMeasured: boolean
  terminalId: string | null
  terminalVerified: boolean
  orgId: string | null
  endUserId: string | null
}

/** 落账去处。生产由 AiBudgetService 在模块初始化时注册（写库 + 叠加本进程额度）。 */
export interface AiUsageSink {
  persist(row: AiUsageRow): Promise<void>
}

const logger = new Logger('AiUsageMeter')
let sink: AiUsageSink | null = null
let warnedNoSink = false
const pendingWrites = new Set<Promise<void>>()

/** 注册落账去处；返回注销函数（只注销自己，防止后注册的被先注销的清掉）。 */
export function registerAiUsageSink(next: AiUsageSink): () => void {
  sink = next
  warnedNoSink = false
  return () => { if (sink === next) sink = null }
}

/** 等已结算的计量全部落库。只给门禁与需要立刻回读的地方用。 */
export async function flushAiUsageMeter(): Promise<void> {
  while (pendingWrites.size > 0) await Promise.allSettled([...pendingWrites])
}

// ── 时钟：门禁要能跨北京时间零点，所以集中成一个可替换的 now ───────────────────
let clock: () => Date = () => new Date()
export function aiUsageNow(): Date { return clock() }
/** 仅供门禁。传 null 恢复真实时钟。 */
export function setAiUsageClockForTests(next: (() => Date) | null): void { clock = next ?? (() => new Date()) }

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
/** 北京时间自然日 YYYY-MM-DD（中国不实行夏令时，固定 +8）。 */
export function beijingDayKey(at: Date): string {
  return new Date(at.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

/** 北京时间自然月 YYYY-MM。与 beijingDayKey 同一时差，月份边界跟自然日走。 */
export function beijingMonthKey(at: Date): string {
  return new Date(at.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 7)
}

const VENDOR_BY_HOST: Record<string, string> = {
  'api.deepseek.com': 'deepseek',
  'dashscope.aliyuncs.com': 'qwen',
  'tokenhub.tencentmaas.com': 'hunyuan',
  'tokenhub.tencentmaas.cn': 'hunyuan',
}

/** 按请求 URL 主机名映射厂商；认不出的记主机名（不记路径与查询串）。 */
export function vendorFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return VENDOR_BY_HOST[host] ?? (host.slice(0, 120) || 'unknown')
  } catch {
    return 'unknown'
  }
}

/** 只取请求体里的 model 字段；取不到为 null。其余字段（含提示词）一概不碰。 */
export function modelFromBody(body: string): string | null {
  try {
    const model = (JSON.parse(body) as { model?: unknown }).model
    return typeof model === 'string' && model.trim() ? model.trim().slice(0, 80) : null
  } catch {
    return null
  }
}

function statusFromHttp(httpStatus: number): AiUsageStatus {
  if (httpStatus >= 200 && httpStatus < 300) return 'ok'
  if (httpStatus === 429) return 'busy'
  return 'upstream_error'
}

/**
 * 一次已发出请求的计量。只结算一次：先到的结局为准，后面的调用忽略。
 * llm-http.ts 在请求发出前 start、拿到响应体后 responded、成功返回前 completed、catch 里 failed。
 */
export class LlmUsageMeter {
  private readonly startedAt = aiUsageNow()
  private readonly vendor: string
  private readonly model: string | null
  private httpStatus: number | null = null
  private data: unknown = null
  private settled = false

  constructor(url: string, body: string, private readonly featureKey: string, private readonly context: AiRequestContext | undefined) {
    this.vendor = vendorFromUrl(url)
    this.model = modelFromBody(body)
  }

  responded(httpStatus: number, data: unknown): void {
    this.httpStatus = httpStatus
    this.data = data
  }

  completed(): void {
    this.settle(this.httpStatus === null ? 'network_error' : statusFromHttp(this.httpStatus))
  }

  failed(status: AiUsageStatus): void {
    this.settle(status)
  }

  private settle(status: AiUsageStatus): void {
    if (this.settled) return
    this.settled = true
    const write = this.write(status).catch((error: unknown) => {
      // 只记错误类型，不记 message：Prisma 的报错可能带上写入的字段值。
      logger.warn(`AI usage record write failed (${(error as { code?: string })?.code ?? (error as Error)?.name ?? 'unknown'}); AI result unaffected`)
    })
    pendingWrites.add(write)
    void write.finally(() => pendingWrites.delete(write))
  }

  private async write(status: AiUsageStatus): Promise<void> {
    const target = sink
    if (!target) {
      if (!warnedNoSink) {
        warnedNoSink = true
        logger.warn('AI usage sink not registered; LLM calls are NOT being metered')
      }
      return
    }
    const identity = this.context ? await this.context.identity() : ANONYMOUS_AI_CALLER
    const rawUsage = (this.data as { usage?: Parameters<typeof normalizeLlmUsage>[0] } | null)?.usage
    const usage = normalizeLlmUsage(rawUsage)
    const cost = priceTokens(`${this.vendor}:${this.model ?? ''}`, usage)
    await target.persist({
      createdAt: this.startedAt,
      dayKey: beijingDayKey(this.startedAt),
      featureKey: this.featureKey,
      vendor: this.vendor,
      model: this.model,
      status,
      httpStatus: this.httpStatus,
      promptTokens: usage ? usage.promptTokens : null,
      completionTokens: usage ? usage.completionTokens : null,
      costCny: cost ?? null,
      costMeasured: cost !== undefined,
      terminalId: identity.terminalVerified ? identity.terminalId : null,
      terminalVerified: identity.terminalVerified && identity.terminalId !== null,
      orgId: identity.terminalVerified ? identity.orgId : null,
      endUserId: identity.endUserId,
    })
  }
}

/** 请求即将发出时调用。功能取 contentModeration.feature，取不到记 'unknown'。 */
export function startLlmUsageMeter(url: string, body: string, feature: string | undefined): LlmUsageMeter {
  const featureKey = typeof feature === 'string' && feature.trim() ? feature.trim().slice(0, 64) : 'unknown'
  return new LlmUsageMeter(url, body, featureKey, currentAiRequestContext())
}
