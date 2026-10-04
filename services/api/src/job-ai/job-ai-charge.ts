import { createHash } from 'node:crypto'
import { runWithAiQuota } from '../ai/quota/ai-quota-run'
import type { AiQuotaService } from '../ai/quota/ai-quota.service'
import type {
  JobAiExplanationPayload,
  JobAiRecommendationDTO,
  JobAiSessionDTO,
  JobAiSessionWithRecommendations,
  JobRecommendationInput,
  TargetJobContext,
} from './job-ai.types'

/** 岗位推荐 / 解读 / 匹配共用的一次助手计次。缓存命中由 loadStored 在预占前返回。 */
export interface JobAiChargeRunInput<T> {
  endUserId?: string | null
  operationKey: string
  loadStored?: () => Promise<T | null>
  failureOf?: (value: T) => 'provider_error' | 'content_rejected' | 'server_timeout' | null
  work: () => Promise<T>
  saveResult: (value: T) => Promise<string>
}

type RunWithAiQuota = typeof runWithAiQuota

type SessionFindMany = (args: {
  where: Record<string, unknown>
  orderBy?: Record<string, unknown>
  take?: number
  include?: Record<string, unknown>
}) => Promise<RecommendSessionRow[]>

interface RecommendSessionRow {
  id: string
  resumeTaskId: string | null
  operation: string
  status: string
  provider: string | null
  terminalId: string | null
  intentJson: string
  createdAt: Date
  expiresAt: Date | null
  recommendations?: RecommendRow[]
}

interface RecommendRow {
  rank: number
  fitLevel: string
  summary: string | null
  matchPointsJson: string
  gapPointsJson: string
  actionChecklistJson: string
  createdAt: Date
  job?: {
    id: string
    title: string
    company: string
    sourceName: string
    sourceUrl: string
    externalId: string
    description: string | null
    requirements: string | null
    skillsJson: string
    city: string
    category: string | null
  } | null
}

/**
 * 没有账本或没有登录身份时不预占，仍执行并保存。
 * 有身份时交给 runWithAiQuota。调用方必须先把终端与 IP 的旧计数扣完。
 */
export function executeJobAiCharge<T>(
  quota: AiQuotaService | undefined,
  input: JobAiChargeRunInput<T>,
  gate: { bucket: 'ai_assistant'; runWithAiQuota: RunWithAiQuota },
): Promise<T> {
  if (!quota || !input.endUserId) {
    return input.work().then(async (value) => {
      await input.saveResult(value)
      return value
    })
  }
  return gate.runWithAiQuota({
    quota,
    bucket: gate.bucket,
    operationKey: input.operationKey,
    endUserId: input.endUserId,
    loadStored: input.loadStored,
    failureOf: input.failureOf,
  }, input.work, input.saveResult)
}

export function recommendationQuotaKey(endUserId: string, resumeTaskId: string, input: Pick<JobRecommendationInput, 'intent' | 'filters' | 'limit'>): string {
  return `rec:${digest(`${endUserId}\n${resumeTaskId}\n${canonicalRecommend(input)}`)}`
}

export function explainQuotaKey(endUserId: string, jobId: string): string {
  return `exp:${digest(`${endUserId}\n${jobId}`)}`
}

export function matchQuotaKey(endUserId: string, resumeTaskId: string, jobId: string): string {
  return `mat:${digest(`${endUserId}\n${resumeTaskId}\n${jobId}`)}`
}

export async function loadCachedRecommendation(
  prisma: { jobAiSession?: { findMany?: SessionFindMany } },
  endUserId: string | null,
  resumeTaskId: string,
  quotaKey: string,
): Promise<JobAiSessionWithRecommendations | null> {
  if (!endUserId) return null
  const findMany = prisma.jobAiSession?.findMany
  if (typeof findMany !== 'function') return null
  const rows = await findMany({
    where: { endUserId, resumeTaskId, operation: 'recommend', status: 'completed', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { recommendations: { orderBy: { rank: 'asc' }, include: { job: true } } },
  })
  for (const row of rows) {
    if (keyFromStoredRecommend(endUserId, resumeTaskId, row.intentJson) !== quotaKey) continue
    const recommendations = (row.recommendations ?? [])
      .filter((item) => item.job)
      .map((item) => recommendationDto(item, jobContext(item.job!)))
    if (recommendations.length === 0) continue
    return { session: sessionDto(row), recommendations, disclaimer: '仅供参考' }
  }
  return null
}

export async function loadCachedExplanation(
  prisma: { jobAiSession?: { findMany?: SessionFindMany } },
  endUserId: string,
  jobId: string,
): Promise<{ session: JobAiSessionDTO; explanation: JobAiExplanationPayload } | null> {
  const findMany = prisma.jobAiSession?.findMany
  if (typeof findMany !== 'function') return null
  const rows = await findMany({
    where: { endUserId, operation: 'explain', status: 'completed', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  for (const row of rows) {
    const parsed = parseExplainIntent(row.intentJson)
    if (!parsed || parsed.jobId !== jobId) continue
    return { session: sessionDto(row), explanation: parsed.explanation }
  }
  return null
}

function canonicalRecommend(input: Pick<JobRecommendationInput, 'intent' | 'filters' | 'limit'>): string {
  return JSON.stringify({
    intent: input.intent ?? {},
    filters: input.filters ?? {},
    limit: input.limit ?? null,
  })
}

function keyFromStoredRecommend(endUserId: string, resumeTaskId: string, intentJson: string): string | null {
  try {
    const parsed = JSON.parse(intentJson) as Pick<JobRecommendationInput, 'intent' | 'filters' | 'limit'>
    return recommendationQuotaKey(endUserId, resumeTaskId, parsed)
  } catch {
    return null
  }
}

function parseExplainIntent(intentJson: string): { jobId: string; explanation: JobAiExplanationPayload } | null {
  try {
    const parsed = JSON.parse(intentJson) as { jobId?: unknown; explanation?: JobAiExplanationPayload }
    if (typeof parsed.jobId !== 'string' || !parsed.jobId.trim()) return null
    const explanation = parsed.explanation
    if (!explanation || !Array.isArray(explanation.responsibilities) || !Array.isArray(explanation.mustHaveRequirements)) return null
    return { jobId: parsed.jobId, explanation }
  } catch {
    return null
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)
}

function sessionDto(row: RecommendSessionRow): JobAiSessionDTO {
  return {
    id: row.id,
    resumeTaskId: row.resumeTaskId,
    operation: row.operation as JobAiSessionDTO['operation'],
    status: row.status as JobAiSessionDTO['status'],
    provider: row.provider,
    terminalId: row.terminalId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  }
}

function recommendationDto(row: RecommendRow, job: TargetJobContext): JobAiRecommendationDTO {
  return {
    job,
    rank: row.rank,
    fitLevel: row.fitLevel as JobAiRecommendationDTO['fitLevel'],
    summary: row.summary ?? '仅供参考，请结合岗位来源信息自行判断。',
    matchPoints: safeJsonList(row.matchPointsJson),
    gapPoints: safeJsonList(row.gapPointsJson),
    actionChecklist: safeJsonList(row.actionChecklistJson),
    createdAt: row.createdAt.toISOString(),
  }
}

function jobContext(row: NonNullable<RecommendRow['job']>): TargetJobContext {
  return {
    jobId: row.id,
    title: row.title,
    company: row.company,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    externalId: row.externalId,
    description: row.description ?? undefined,
    requirements: row.requirements ?? undefined,
    skills: safeJsonList(row.skillsJson),
    city: row.city,
    category: row.category ?? undefined,
  }
}

function safeJsonList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 10)
      : []
  } catch {
    return []
  }
}
