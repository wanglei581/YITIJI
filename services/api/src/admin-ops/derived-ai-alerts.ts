/**
 * AI 不可用的三条派生告警（N-6）。现场无人值守，模型挂了要进告警中心并走现有企业微信推送。
 *
 * 数据从哪来（2026-10-06 对候选核对）：
 *   - 用 `AiUsageRecord`（ai-usage-meter.ts）。每次真的发出的模型请求一行。
 *     判定用到的列只有 `createdAt`、`status`、`httpStatus`。
 *     `status` ∈ ok / upstream_error / busy / timeout / network_error / aborted / blocked。
 *     401 / 402 / 403 由 statusFromHttp 记成 `upstream_error`，HTTP 码留在 `httpStatus`。
 *   - 不用 `AiServiceLog`。它有 `errorCode`，没有 `httpStatus`。
 *     `AI_PROVIDER_ACCOUNT_UNAVAILABLE` 与 `AI_PROVIDER_MODEL_INVALID` 在本候选里没有任何写入点
 *     （llm-failure.ts 对 4xx 统一记 `AI_PROVIDER_REQUEST_ERROR`），两张表都读不到这两个码。
 *     账户不可用只认 `httpStatus` ∈ {401, 402, 403}。
 *   - 本表不存提示词、文件名、用户原文。查询也不取会员、终端、厂商、型号、功能名。
 *
 * 口径：
 *   1. `ai_provider_unavailable`（error）
 *      最近 15 分钟内，账户级失败（httpStatus 401 / 402 / 403，且 status 不是 ok）至少 1 次，
 *      并且这些失败里、最后一次成功（ok）之后仍有失败。
 *      之后出现成功即消失。回合 = 这一轮第一次未恢复失败所在的 15 分钟窗口。全站一条。
 *   2. `ai_consecutive_failures`（warning；这 10 分钟内没有成功则为 error）
 *      最近 10 分钟内，去掉 aborted / blocked 之后，末尾连续 ≥ 5 次都是
 *      upstream_error / timeout / network_error / busy，中间没有 ok。
 *      aborted / blocked 不计入次数，也不把连续段打断。
 *      「全部功能都失败」= 计入判定的请求里一次 ok 都没有（没发出去的功能不算成功，也不算失败）。
 *      与第 1 种同时成立时只报第 1 种。
 *   3. `ai_budget_exhausted`（error）
 *      全局当天已花 ≥ 全站上限。已花与上限都走 AiBudgetService.spent / limits.globalCny，不另算。
 *      单终端、单会员到顶不报（量大，是正常限流）。回合 = 北京时间当天日期。
 *
 * 查询边界：模型请求只扫最近 15 分钟，列只有上面三列，走 `AiUsageRecord.@@index([createdAt])`。
 * 费用只按 `dayKey` 做 groupBy，走 `@@index([dayKey])`。不新增索引。
 *
 * 推送：admin-alert-push.service.ts 对「上一轮有、这一轮没有」的 subjectKey 一律推「已恢复」，
 * 不按类型过滤，也没有「终端类才推已恢复 / 终端类被筛掉」的分支。这三条不是终端类，消失时同样会推。
 * 推送正文只用标题，不带 detail。
 */
import type { PrismaService } from '../prisma/prisma.service'
import { formatBeijingMinute } from '../common/beijing-display-time'
import { AiBudgetService } from '../ai/usage/ai-budget.service'
import { beijingDayKey } from '../ai/usage/ai-usage-meter'
import {
  AI_ALERT_SUBJECT_ID,
  AI_PROVIDER_UNAVAILABLE_WINDOW_MS,
  aiBudgetExhaustedEpisodeToken,
  aiConsecutiveFailuresEpisodeToken,
  aiProviderUnavailableEpisodeToken,
  buildSubjectKey,
  type DerivedAlertType,
} from './derived-alert-identity'

export const AI_CONSECUTIVE_FAILURE_WINDOW_MS = 10 * 60 * 1000
/** 末尾连续失败达到这个次数才告警。反向变异时改这个数，门禁里「4 次不报」必须变红。 */
export const AI_CONSECUTIVE_FAILURE_MIN = 5

const ACCOUNT_HTTP_STATUSES = [401, 402, 403] as const
const COUNTED_FAILURE_STATUSES = new Set(['upstream_error', 'timeout', 'network_error', 'busy'])

const ACCOUNT_HTTP_LABEL: Record<number, string> = {
  401: '未授权',
  402: '余额不足',
  403: '拒绝访问',
}

const FAILURE_STATUS_LABEL: Record<string, string> = {
  upstream_error: '上游错误',
  timeout: '超时',
  network_error: '网络错误',
  busy: '繁忙',
}

export const AI_PROVIDER_UNAVAILABLE_TITLE = 'AI 服务账户不可用（余额或密钥问题），用户只能用手动方式'
export const AI_BUDGET_EXHAUSTED_TITLE = '今天的 AI 费用上限已用完，AI 功能暂停到明天 0 点'

export interface AiDerivedAlert {
  id: string
  subjectKey: string
  subjectId: string
  episodeToken: string
  type: DerivedAlertType
  severity: 'error' | 'warning'
  title: string
  detail: string
  terminalCode: null
  occurredAt: string
}

interface UsageProbe {
  createdAt: Date
  status: string
  httpStatus: number | null
}

function isAccountFailure(row: UsageProbe): boolean {
  return row.status !== 'ok'
    && row.httpStatus !== null
    && (ACCOUNT_HTTP_STATUSES as readonly number[]).includes(row.httpStatus)
}

function isCountedFailure(row: UsageProbe): boolean {
  return COUNTED_FAILURE_STATUSES.has(row.status)
}

/** aborted / blocked 不参加连续失败判定。 */
function isIgnoredStatus(status: string): boolean {
  return status === 'aborted' || status === 'blocked'
}

function buildAlert(
  type: 'ai_provider_unavailable' | 'ai_consecutive_failures' | 'ai_budget_exhausted',
  episodeToken: string,
  severity: 'error' | 'warning',
  title: string,
  detail: string,
  occurredAt: Date,
): AiDerivedAlert {
  const subjectKey = buildSubjectKey(type, AI_ALERT_SUBJECT_ID)
  return {
    id: subjectKey,
    subjectKey,
    subjectId: AI_ALERT_SUBJECT_ID,
    episodeToken,
    type,
    severity,
    title,
    detail,
    terminalCode: null,
    occurredAt: occurredAt.toISOString(),
  }
}

function providerAlert(rows: UsageProbe[]): AiDerivedAlert | null {
  let lastOkAt = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    if (row.status === 'ok') lastOkAt = row.createdAt.getTime()
  }
  const unresolved = rows.filter((row) => isAccountFailure(row) && row.createdAt.getTime() > lastOkAt)
  if (unresolved.length === 0) return null
  const first = unresolved[0]
  const latest = unresolved[unresolved.length - 1]
  const label = ACCOUNT_HTTP_LABEL[latest.httpStatus ?? 0] ?? '账户不可用'
  return buildAlert(
    'ai_provider_unavailable',
    aiProviderUnavailableEpisodeToken(first.createdAt),
    'error',
    AI_PROVIDER_UNAVAILABLE_TITLE,
    `最近 15 分钟内账户级失败 ${unresolved.length} 次，最近一次是${label}，最早一次在 ${formatBeijingMinute(first.createdAt)}，之后没有成功`,
    first.createdAt,
  )
}

function consecutiveAlert(rows: UsageProbe[], nowMs: number): AiDerivedAlert | null {
  const since = nowMs - AI_CONSECUTIVE_FAILURE_WINDOW_MS
  const countable = rows.filter((row) => row.createdAt.getTime() >= since && !isIgnoredStatus(row.status))
  const streak: UsageProbe[] = []
  for (let i = countable.length - 1; i >= 0; i -= 1) {
    const row = countable[i]
    if (row.status === 'ok') break
    if (!isCountedFailure(row)) break
    streak.push(row)
  }
  streak.reverse()
  if (streak.length < AI_CONSECUTIVE_FAILURE_MIN) return null
  const latest = streak[streak.length - 1]
  const first = streak[0]
  const label = FAILURE_STATUS_LABEL[latest.status] ?? '失败'
  const anyOk = countable.some((row) => row.status === 'ok')
  return buildAlert(
    'ai_consecutive_failures',
    aiConsecutiveFailuresEpisodeToken(first.createdAt),
    anyOk ? 'warning' : 'error',
    `AI 连续失败 ${streak.length} 次，最近一次是${label}`,
    anyOk
      ? `最近 10 分钟内连续失败 ${streak.length} 次，最近一次是${label}，发生在 ${formatBeijingMinute(latest.createdAt)}`
      : `最近 10 分钟内连续失败 ${streak.length} 次，最近一次是${label}，发生在 ${formatBeijingMinute(latest.createdAt)}，这段时间内没有成功的调用`,
    latest.createdAt,
  )
}

/**
 * 全局当天已花是否到顶。每次新开一个 AiBudgetService：spent() 的 10 秒缓存和本进程叠加
 * 挂在实例上，告警要的是已经落库的数，公式仍是 spent()（实测金额 + 未计量次数 × 保守单价）。
 * 入口闸门在缓存窗口里可能比这里略高，那部分还没落库。
 */
async function budgetAlert(prisma: PrismaService, now: Date): Promise<AiDerivedAlert | null> {
  const budget = new AiBudgetService(prisma)
  const dayKey = beijingDayKey(now)
  const spent = await budget.spent(dayKey, { kind: 'global', id: null })
  if (spent < budget.limits.globalCny) return null
  const start = beijingDayStart(dayKey)
  return buildAlert(
    'ai_budget_exhausted',
    aiBudgetExhaustedEpisodeToken(dayKey),
    'error',
    AI_BUDGET_EXHAUSTED_TITLE,
    `全局当天的费用上限已用完，日期 ${dayKey}（北京时间），次日 0 点恢复`,
    start,
  )
}

/** dayKey 是北京时间 YYYY-MM-DD。当天 0 点对应的 UTC 时刻，只用于排序，不参与额度计算。 */
function beijingDayStart(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map((part) => Number(part))
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000)
}

export async function collectAiDerivedAlerts(prisma: PrismaService, now: Date): Promise<AiDerivedAlert[]> {
  const since = new Date(now.getTime() - AI_PROVIDER_UNAVAILABLE_WINDOW_MS)
  const [rows, budget] = await Promise.all([
    prisma.aiUsageRecord.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, status: true, httpStatus: true },
      orderBy: { createdAt: 'asc' },
    }),
    budgetAlert(prisma, now),
  ])
  const provider = providerAlert(rows)
  const consecutive = provider ? null : consecutiveAlert(rows, now.getTime())
  return [provider, consecutive, budget].filter((alert): alert is AiDerivedAlert => alert !== null)
}

export async function resolveAiDerivedAlert(
  prisma: PrismaService,
  type: DerivedAlertType,
  subjectId: string,
  now: Date,
): Promise<AiDerivedAlert | null> {
  if (subjectId !== AI_ALERT_SUBJECT_ID) return null
  if (type !== 'ai_provider_unavailable' && type !== 'ai_consecutive_failures' && type !== 'ai_budget_exhausted') {
    return null
  }
  const alerts = await collectAiDerivedAlerts(prisma, now)
  return alerts.find((alert) => alert.type === type) ?? null
}
