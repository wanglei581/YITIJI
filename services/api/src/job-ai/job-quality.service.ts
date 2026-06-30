import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export type JobQualityLevel = 'ready' | 'partial' | 'insufficient'

export const JOB_QUALITY_REQUIRED_FIELDS = [
  'title',
  'company',
  'city',
  'sourceName',
  'sourceUrl',
  'externalId',
  'syncTime',
  'descriptionOrRequirements',
] as const

export const JOB_AI_READY_FIELDS = [
  'salary',
  'category',
  'industry',
  'skills',
  'educationRequirement',
  'experienceRequirement',
  'validThrough',
] as const

const INDUSTRY_TAG_PREFIX = '行业:'
const STALE_SYNC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const SOURCE_URL_TIMEOUT_MS = 3_000

type JobQualityField =
  | typeof JOB_QUALITY_REQUIRED_FIELDS[number]
  | typeof JOB_AI_READY_FIELDS[number]
  | 'sourceUrlFormat'
  | 'sourceUrlUnreachable'
  | 'syncTimeStale'
  | 'validThroughExpired'

export interface JobQualityInput {
  id?: string
  sourceOrgId: string
  externalId: string | null
  sourceName: string | null
  sourceUrl: string | null
  title: string | null
  company: string | null
  city: string | null
  category: string | null
  salary: string | null
  description: string | null
  requirements: string | null
  tagsJson: string | null
  educationRequirement: string | null
  experienceRequirement: string | null
  skillsJson: string | null
  benefitsJson: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryUnit: string | null
  validThrough: Date | null
  syncTime: Date | null
}

export interface JobQualityEvaluation {
  missingFields: JobQualityField[]
  qualityLevel: JobQualityLevel
  sourceUrlFormat: 'valid' | 'invalid' | 'missing'
  sourceUrlReachable: boolean | null
  isStale: boolean
  lastError: string | null
}

export interface SourceQualitySummaryItem {
  sourceOrgId: string
  sourceId: string | null
  totalJobs: number
  readyJobs: number
  partialJobs: number
  insufficientJobs: number
  staleJobs: number
  brokenSourceUrlJobs: number
  lastCheckedAt: string | null
}

@Injectable()
export class JobQualityService {
  private readonly logger = new Logger(JobQualityService.name)

  constructor(private readonly prisma: PrismaService) {}

  evaluateJobQuality(job: JobQualityInput, now = new Date()): JobQualityEvaluation {
    const missingFields: JobQualityField[] = []
    const sourceUrlFormat = this.getSourceUrlFormat(job.sourceUrl)

    if (!hasText(job.title)) missingFields.push('title')
    if (!hasText(job.company)) missingFields.push('company')
    if (!hasText(job.city)) missingFields.push('city')
    if (!hasText(job.sourceName)) missingFields.push('sourceName')
    if (!hasText(job.sourceUrl)) missingFields.push('sourceUrl')
    if (!hasText(job.externalId)) missingFields.push('externalId')
    if (!job.syncTime) missingFields.push('syncTime')
    if (!hasText(job.description) && !hasText(job.requirements)) missingFields.push('descriptionOrRequirements')
    if (sourceUrlFormat === 'invalid') missingFields.push('sourceUrlFormat')

    const validThroughExpired = job.validThrough ? job.validThrough.getTime() < now.getTime() : false
    const syncTimeStale = job.syncTime ? now.getTime() - job.syncTime.getTime() > STALE_SYNC_WINDOW_MS : false
    if (syncTimeStale) missingFields.push('syncTimeStale')
    if (validThroughExpired) missingFields.push('validThroughExpired')

    if (!hasSalary(job)) missingFields.push('salary')
    if (!hasText(job.category)) missingFields.push('category')
    if (!hasIndustry(job.tagsJson)) missingFields.push('industry')
    if (!hasJsonArrayValue(job.skillsJson)) missingFields.push('skills')
    if (!hasText(job.educationRequirement)) missingFields.push('educationRequirement')
    if (!hasText(job.experienceRequirement)) missingFields.push('experienceRequirement')
    if (!job.validThrough) missingFields.push('validThrough')

    const missingRequired = missingFields.some((field) =>
      (JOB_QUALITY_REQUIRED_FIELDS as readonly string[]).includes(field) ||
      field === 'sourceUrlFormat' ||
      field === 'syncTimeStale' ||
      field === 'validThroughExpired',
    )
    const missingAiReady = missingFields.some((field) => (JOB_AI_READY_FIELDS as readonly string[]).includes(field))

    return {
      missingFields,
      qualityLevel: missingRequired ? 'insufficient' : missingAiReady ? 'partial' : 'ready',
      sourceUrlFormat,
      sourceUrlReachable: null,
      isStale: syncTimeStale || validThroughExpired,
      lastError: sourceUrlFormat === 'invalid' ? 'INVALID_SOURCE_URL' : null,
    }
  }

  async refreshJobQualitySnapshots(
    jobIds: string[],
    options: { checkReachability?: boolean } = {},
  ): Promise<void> {
    const uniqueIds = [...new Set(jobIds.filter((id) => id.trim()))]
    if (uniqueIds.length === 0) return

    const jobs = await this.prisma.job.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        sourceOrgId: true,
        externalId: true,
        sourceName: true,
        sourceUrl: true,
        title: true,
        company: true,
        city: true,
        category: true,
        salary: true,
        description: true,
        requirements: true,
        tagsJson: true,
        educationRequirement: true,
        experienceRequirement: true,
        skillsJson: true,
        benefitsJson: true,
        salaryMin: true,
        salaryMax: true,
        salaryUnit: true,
        validThrough: true,
        syncTime: true,
      },
    })

    const snapshotRows = []
    for (const job of jobs) {
      const evaluated = this.evaluateJobQuality(job)
      const reachability = options.checkReachability && evaluated.sourceUrlFormat === 'valid'
        ? await this.checkSourceUrlReachable(job.sourceUrl)
        : { sourceUrlReachable: evaluated.sourceUrlReachable, lastError: evaluated.lastError }
      const finalMissingFields = reachability.sourceUrlReachable === false
        ? [...new Set([...evaluated.missingFields, 'sourceUrlUnreachable' as const])]
        : evaluated.missingFields
      const finalQualityLevel = reachability.sourceUrlReachable === false
        ? 'insufficient'
        : evaluated.qualityLevel

      // JobDataQualitySnapshot intentionally stores metadata only: no resume text,
      // no LLM input/output, no platform delivery/candidate/interview/offer state.
      snapshotRows.push({
        jobId: job.id,
        sourceOrgId: job.sourceOrgId,
        missingFieldsJson: JSON.stringify(finalMissingFields),
        qualityLevel: finalQualityLevel,
        sourceUrlReachable: reachability.sourceUrlReachable,
        lastError: reachability.lastError,
      })
    }

    if (snapshotRows.length > 0) {
      await this.prisma.jobDataQualitySnapshot.createMany({
        data: snapshotRows,
      })
    }
  }

  async getSourceQualitySummary(args: { sourceOrgId?: string; sourceId?: string } = {}): Promise<SourceQualitySummaryItem[]> {
    const latestGroups = await this.prisma.jobDataQualitySnapshot.groupBy({
      by: ['jobId'],
      where: args.sourceOrgId ? { sourceOrgId: args.sourceOrgId } : {},
      _max: { checkedAt: true },
    })

    const latestPairs = latestGroups
      .map((group) => ({ jobId: group.jobId, checkedAt: group._max.checkedAt }))
      .filter((pair): pair is { jobId: string; checkedAt: Date } => pair.checkedAt instanceof Date)
    if (latestPairs.length === 0) return []

    const snapshots = []
    for (const chunk of chunkArray(latestPairs, 500)) {
      const rows = await this.prisma.jobDataQualitySnapshot.findMany({
        where: {
          ...(args.sourceOrgId ? { sourceOrgId: args.sourceOrgId } : {}),
          OR: chunk.map((pair) => ({ jobId: pair.jobId, checkedAt: pair.checkedAt })),
        },
        include: { job: { select: { sourceId: true } } },
        orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      })
      snapshots.push(...rows)
    }

    const latestByJob = new Map<string, typeof snapshots[number]>()
    for (const snapshot of snapshots) {
      if (!latestByJob.has(snapshot.jobId)) latestByJob.set(snapshot.jobId, snapshot)
    }

    const groups = new Map<string, SourceQualitySummaryItem>()
    for (const snapshot of latestByJob.values()) {
      const sourceId = snapshot.job.sourceId
      if (args.sourceId && sourceId !== args.sourceId) continue
      const key = `${snapshot.sourceOrgId}:${sourceId ?? 'none'}`
      const current = groups.get(key) ?? {
        sourceOrgId: snapshot.sourceOrgId,
        sourceId,
        totalJobs: 0,
        readyJobs: 0,
        partialJobs: 0,
        insufficientJobs: 0,
        staleJobs: 0,
        brokenSourceUrlJobs: 0,
        lastCheckedAt: null,
      }
      current.totalJobs += 1
      if (snapshot.qualityLevel === 'ready') current.readyJobs += 1
      else if (snapshot.qualityLevel === 'partial') current.partialJobs += 1
      else current.insufficientJobs += 1
      if (snapshot.sourceUrlReachable === false) current.brokenSourceUrlJobs += 1
      if (snapshot.missingFieldsJson.includes('syncTimeStale') || snapshot.missingFieldsJson.includes('validThroughExpired')) {
        current.staleJobs += 1
      }
      const checkedAt = snapshot.checkedAt.toISOString()
      if (!current.lastCheckedAt || checkedAt > current.lastCheckedAt) current.lastCheckedAt = checkedAt
      groups.set(key, current)
    }
    return [...groups.values()]
  }

  async checkSourceUrlReachable(url: string | null): Promise<{ sourceUrlReachable: boolean | null; lastError: string | null }> {
    if (this.getSourceUrlFormat(url) !== 'valid' || !url) {
      return { sourceUrlReachable: false, lastError: 'INVALID_SOURCE_URL' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SOURCE_URL_TIMEOUT_MS)
    try {
      let response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'User-Agent': 'ai-job-print-job-quality-check/1.0' },
      })
      if (response.status === 405 || response.status === 403) {
        response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'User-Agent': 'ai-job-print-job-quality-check/1.0' },
        })
      }
      return { sourceUrlReachable: response.ok, lastError: response.ok ? null : `HTTP_${response.status}` }
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'SOURCE_URL_TIMEOUT'
        : `SOURCE_URL_CHECK_FAILED: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`
      this.logger.warn(`sourceUrl check failed: ${message}`)
      return { sourceUrlReachable: false, lastError: message }
    } finally {
      clearTimeout(timer)
    }
  }

  private getSourceUrlFormat(sourceUrl: string | null): 'valid' | 'invalid' | 'missing' {
    if (!hasText(sourceUrl)) return 'missing'
    try {
      const url = new URL(sourceUrl)
      return url.protocol === 'http:' || url.protocol === 'https:' ? 'valid' : 'invalid'
    } catch {
      return 'invalid'
    }
  }
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasSalary(job: JobQualityInput): boolean {
  return hasText(job.salary) || job.salaryMin !== null || job.salaryMax !== null
}

function hasIndustry(tagsJson: string | null): boolean {
  return parseJsonArray(tagsJson).some((tag) => tag.startsWith(INDUSTRY_TAG_PREFIX) && tag.length > INDUSTRY_TAG_PREFIX.length)
}

function hasJsonArrayValue(json: string | null): boolean {
  return parseJsonArray(json).length > 0
}

function parseJsonArray(json: string | null): string[] {
  if (!json) return []
  try {
    const value = JSON.parse(json) as unknown
    return Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
