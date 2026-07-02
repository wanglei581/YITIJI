import { Injectable, Logger, Optional } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { PrismaService } from '../prisma/prisma.service'
import { decryptSecret } from '../common/crypto/secret-cipher'
import { isSensitiveColumn } from '../jobs/dto/excel-import.dto'
import { JobQualityService } from '../job-ai/job-quality.service'
import { mapJobWorkTypeToCategory } from '../jobs/work-type'
import {
  JOB_SYNC_QUEUE,
  JOB_SYNC_JOB_NAME,
  SYNC_FREQ_THRESHOLD_MS,
  type ApiSyncJobData,
  type JobSourceResponseConfig,
  type SyncStats,
} from './job-sync.types'

const FETCH_TIMEOUT_MS = 30_000

// ── Internal mapped types ─────────────────────────────────────────────────────

interface MappedJob {
  externalId: string
  title: string
  company: string
  city: string
  sourceUrl: string
  salary?: string
  description?: string
  requirements?: string
  industry?: string
  category?: string  // fulltime/parttime/intern/campus
  tags: string[]
  educationRequirement?: string
  experienceRequirement?: string
  skills: string[]
  benefits: string[]
  salaryMin?: number
  salaryMax?: number
  salaryUnit?: string
  validThrough?: Date
}

interface MappedFair {
  externalId: string
  title: string
  startAt: Date
  endAt: Date
  venue: string
  city: string
  sourceUrl: string
  description?: string
  companyCount?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapCategory(raw: string | undefined): string | undefined {
  return mapJobWorkTypeToCategory(raw)
}

function getStr(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = raw[k]
    if (v != null) {
      const s = String(v).trim()
      if (s) return s
    }
  }
  return undefined
}

function resolveKeys(stdKey: string, fields?: Record<string, string>, ...fallbacks: string[]): string[] {
  if (fields?.[stdKey]) return [fields[stdKey]!]
  return [stdKey, ...fallbacks]
}

function getStringList(raw: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = raw[key]
    if (Array.isArray(value)) {
      const list = value.map((item) => String(item).trim()).filter(Boolean)
      if (list.length > 0) return list.slice(0, 30)
    }
    if (value != null) {
      const list = String(value).split(/[，,;；、\n]/).map((item) => item.trim()).filter(Boolean)
      if (list.length > 0) return list.slice(0, 30)
    }
  }
  return []
}

function buildJobIndustryTag(industry: string): string {
  return `行业:${industry.trim()}`
}

function buildJobTags(tags: string[] | undefined, industry?: string): string[] {
  const result = [...(tags ?? [])].map((tag) => tag.trim()).filter(Boolean)
  if (industry?.trim()) result.push(buildJobIndustryTag(industry))
  return [...new Set(result)]
}

function getNumber(raw: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (value == null || String(value).trim() === '') continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function getDate(raw: Record<string, unknown>, keys: string[]): Date | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (value == null || String(value).trim() === '') continue
    const parsed = new Date(String(value))
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class JobSyncService {
  private readonly logger = new Logger(JobSyncService.name)
  /** Track in-progress sourceIds when running without Redis (dev mode) */
  private readonly inProgress = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQuality: JobQualityService,
    @Optional() @InjectQueue(JOB_SYNC_QUEUE) private readonly queue?: Queue,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Enqueue a sourceId. If Redis/BullMQ available, adds to queue (idempotent
   * by jobId). Otherwise executes inline via setImmediate.
   */
  async enqueue(sourceId: string, manual: boolean): Promise<string | null> {
    if (this.queue) {
      const jobId = manual ? `${sourceId}_manual` : sourceId
      const bullJob = await this.queue.add(
        JOB_SYNC_JOB_NAME,
        { sourceId, manual } satisfies ApiSyncJobData,
        {
          jobId,
          attempts: manual ? 1 : 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 86_400 },
          removeOnFail: { age: 7 * 86_400 },
        },
      )
      return bullJob.id ?? null
    }
    // No Redis: run inline (dev convenience)
    if (!this.inProgress.has(sourceId)) {
      this.inProgress.add(sourceId)
      setImmediate(() =>
        this.pullApiSource(sourceId)
          .catch((e) => this.logger.error(`inline pull ${sourceId}: ${(e as Error).message}`))
          .finally(() => this.inProgress.delete(sourceId)),
      )
    }
    return null
  }

  /**
   * Called by the Cron scheduler: find all API sources whose syncFreq is due.
   */
  async enqueueDueSources(): Promise<number> {
    const sources = await this.prisma.jobSource.findMany({
      where: { enabled: true, accessMode: 'api' },
      select: { id: true, syncFreq: true, lastSyncAt: true },
    })
    const now = Date.now()
    let enqueued = 0
    for (const s of sources) {
      const threshold = SYNC_FREQ_THRESHOLD_MS[s.syncFreq]
      if (threshold === undefined) continue   // manual / realtime: skip auto-schedule
      const lastMs = s.lastSyncAt ? s.lastSyncAt.getTime() : 0
      if (now - lastMs >= threshold) {
        await this.enqueue(s.id, false)
        enqueued++
      }
    }
    if (enqueued > 0) this.logger.log(`Scheduled ${enqueued} API source(s) for sync`)
    return enqueued
  }

  /**
   * Validate a source is pull-ready and return its basic info for trigger.
   */
  async getSourceForTrigger(sourceId: string): Promise<{ name: string; syncFreq: string; lastSyncAt: Date | null }> {
    const source = await this.prisma.jobSource.findUnique({
      where: { id: sourceId },
      select: { name: true, syncFreq: true, lastSyncAt: true, enabled: true, accessMode: true, endpoint: true },
    })
    if (!source) throw new Error('SOURCE_NOT_FOUND')
    if (!source.enabled) throw new Error('SOURCE_DISABLED')
    if (source.accessMode !== 'api') throw new Error('SOURCE_NOT_API')
    if (!source.endpoint) throw new Error('SOURCE_NO_ENDPOINT')
    return source
  }

  // ── Core pull logic ────────────────────────────────────────────────────────

  async pullApiSource(sourceId: string): Promise<SyncStats> {
    const source = await this.prisma.jobSource.findUnique({ where: { id: sourceId } })
    if (!source || !source.enabled || source.accessMode !== 'api' || !source.endpoint) {
      throw new Error(`Source ${sourceId}: not a valid enabled API source with endpoint`)
    }

    // 1. Decrypt credential (allowed to be absent for public APIs)
    let credential = ''
    if (source.encryptedCredential) {
      try {
        credential = decryptSecret(source.encryptedCredential)
      } catch {
        await this.markStatus(sourceId, 'failed')
        await this.writeSyncLog(sourceId, source.orgId, 'job', 0, 0, 0, 0, 'failed', 'CREDENTIAL_DECRYPT_FAILED')
        throw new Error('CREDENTIAL_DECRYPT_FAILED')
      }
    }

    // 2. HTTP fetch
    let rawData: unknown
    try {
      rawData = await this.fetchJson(source.endpoint, source.authType ?? null, credential)
    } catch (e) {
      const msg = (e as Error).message
      await this.markStatus(sourceId, 'failed')
      await this.writeSyncLog(sourceId, source.orgId, 'job', 0, 0, 0, 0, 'failed', msg)
      throw e
    }

    // 3. Parse responseConfig
    const config = this.parseResponseConfig(source.responseConfig)

    // 4. Extract raw items array from response
    const rawItems = this.extractArray(rawData, config.rootPath)
    this.logger.log(`Source ${sourceId}: ${rawItems.length} raw items (dataType=${config.dataType})`)

    // 5. Upsert
    let stats: SyncStats
    try {
      stats = config.dataType === 'fair'
        ? await this.upsertFairs(source, rawItems, config)
        : await this.upsertJobs(source, rawItems, config)
    } catch (e) {
      await this.markStatus(sourceId, 'failed')
      await this.writeSyncLog(sourceId, source.orgId, config.dataType, 0, 0, 0, rawItems.length, 'failed', (e as Error).message)
      throw e
    }

    // 6. Finalize
    const result: 'success' | 'partial' | 'failed' =
      stats.error === 0 ? 'success' :
      (stats.added > 0 || stats.updated > 0) ? 'partial' : 'failed'

    await this.markStatus(sourceId, result === 'failed' ? 'failed' : 'success')
    await this.writeSyncLog(
      sourceId, source.orgId, config.dataType,
      stats.added, stats.updated, stats.dup, stats.error,
      result, stats.errorSummary,
    )
    this.logger.log(`Source ${sourceId}: added=${stats.added} updated=${stats.updated} dup=${stats.dup} error=${stats.error} result=${result}`)
    return stats
  }

  // ── Private: HTTP ──────────────────────────────────────────────────────────

  private async fetchJson(
    endpoint: string,
    authType: string | null,
    credential: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    switch (authType) {
      case 'bearer':   headers['Authorization'] = `Bearer ${credential}`;                              break
      case 'api_key':  headers['X-API-Key'] = credential;                                              break
      case 'basic':    headers['Authorization'] = `Basic ${Buffer.from(credential).toString('base64')}`; break
    }

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(endpoint, { headers, signal: ac.signal })
    } catch (e) {
      clearTimeout(timer)
      throw new Error((e as Error).name === 'AbortError' ? 'REQUEST_TIMEOUT' : `NETWORK_ERROR: ${(e as Error).message}`)
    }
    clearTimeout(timer)

    if (!res.ok) {
      throw new Error(`HTTP_${res.status}: ${res.statusText.slice(0, 80)}`)
    }
    return res.json() as Promise<unknown>
  }

  // ── Private: parsing ───────────────────────────────────────────────────────

  private parseResponseConfig(raw: string | null): JobSourceResponseConfig {
    if (!raw) return { dataType: 'job' }
    try {
      const c = JSON.parse(raw) as JobSourceResponseConfig
      return { dataType: c.dataType ?? 'job', rootPath: c.rootPath, fields: c.fields }
    } catch {
      return { dataType: 'job' }
    }
  }

  private extractArray(data: unknown, rootPath?: string): Record<string, unknown>[] {
    let target: unknown = data
    if (rootPath) {
      for (const key of rootPath.split('.')) {
        target = target && typeof target === 'object' ? (target as Record<string, unknown>)[key] : undefined
      }
    }
    if (Array.isArray(target)) return target as Record<string, unknown>[]
    // auto-detect
    if (data && typeof data === 'object') {
      for (const key of ['jobs', 'items', 'data', 'results', 'list', 'records']) {
        const val = (data as Record<string, unknown>)[key]
        if (Array.isArray(val)) return val as Record<string, unknown>[]
      }
    }
    return []
  }

  private mapJob(
    raw: Record<string, unknown>,
    fields?: Record<string, string>,
  ): { ok: true; item: MappedJob } | { ok: false; reason: string } {
    // Log (don't reject) if source exposes sensitive field names — we simply won't read them
    for (const key of Object.keys(raw)) {
      if (isSensitiveColumn(key)) {
        this.logger.warn(`API source field "${key}" matches sensitive pattern — skipped`)
      }
    }

    const r = (std: string, ...fb: string[]) => getStr(raw, resolveKeys(std, fields, ...fb))

    const externalId = r('externalId', 'id', 'job_id', 'jobId')
    const title      = r('title', 'position', 'jobTitle', 'job_title')
    const company    = r('company', 'companyName', 'company_name', 'employer')
    const city       = r('city', 'location', 'area')
    const sourceUrl  = r('sourceUrl', 'url', 'link', 'apply_url', 'job_url')

    const missing = ['externalId', 'title', 'company', 'city', 'sourceUrl']
      .filter((f) => !([externalId, title, company, city, sourceUrl][['externalId', 'title', 'company', 'city', 'sourceUrl'].indexOf(f)]))
    if (missing.length) return { ok: false, reason: `missing: ${missing.join(',')}` }

    const tagsRaw = raw[fields?.['tags'] ?? 'tags']
    const tags = Array.isArray(tagsRaw) ? (tagsRaw as unknown[]).map(String).slice(0, 20) : []
    const workType = r('workType', 'work_type', 'jobType', 'employment_type')

    return {
      ok: true,
      item: {
        externalId: externalId!, title: title!, company: company!, city: city!, sourceUrl: sourceUrl!,
        salary:       r('salary', 'salaryRange', 'salary_range', 'pay'),
        description:  r('description', 'job_description', 'jobDescription', 'detail'),
        requirements: r('requirements', 'qualifications', 'requirement'),
        industry: r('industry', 'industryName', 'industry_name', '行业'),
        category:     mapCategory(workType),
        tags,
        educationRequirement: r('educationRequirement', 'education', 'degree', '学历'),
        experienceRequirement: r('experienceRequirement', 'experience', 'workExperience', '经验'),
        skills: getStringList(raw, resolveKeys('skills', fields, 'skillTags', 'requiredSkills', '技能')),
        benefits: getStringList(raw, resolveKeys('benefits', fields, 'welfare', 'perks', '福利')),
        salaryMin: getNumber(raw, resolveKeys('salaryMin', fields, 'minSalary', 'salary_min')),
        salaryMax: getNumber(raw, resolveKeys('salaryMax', fields, 'maxSalary', 'salary_max')),
        salaryUnit: r('salaryUnit', 'salary_unit', 'payPeriod'),
        validThrough: getDate(raw, resolveKeys('validThrough', fields, 'expireAt', 'valid_until', 'deadline')),
      },
    }
  }

  private mapFair(
    raw: Record<string, unknown>,
    fields?: Record<string, string>,
  ): { ok: true; item: MappedFair } | { ok: false; reason: string } {
    const r = (std: string, ...fb: string[]) => getStr(raw, resolveKeys(std, fields, ...fb))

    const externalId = r('externalId', 'id', 'fair_id')
    const title      = r('title', 'name', 'fair_name', 'fairTitle')
    const startStr   = r('startAt', 'startTime', 'start_time', 'start_date', 'beginDate')
    const endStr     = r('endAt', 'endTime', 'end_time', 'end_date', 'endDate')
    const venue      = r('venue', 'address', 'location', 'place')
    const city       = r('city', 'location', 'area') ?? venue
    const sourceUrl  = r('sourceUrl', 'url', 'link')

    const missing = ['externalId', 'title', 'startAt', 'endAt', 'venue', 'sourceUrl']
      .filter((_k, i) => !([externalId, title, startStr, endStr, venue, sourceUrl][i]))
    if (missing.length) return { ok: false, reason: `missing: ${missing.join(',')}` }

    const startAt = new Date(startStr!)
    const endAt   = new Date(endStr!)
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      return { ok: false, reason: 'invalid date format for startAt/endAt' }
    }
    if (endAt <= startAt) {
      return { ok: false, reason: 'endAt must be after startAt' }
    }

    const countRaw = raw[fields?.['companyCount'] ?? 'companyCount']
    return {
      ok: true,
      item: {
        externalId: externalId!, title: title!,
        startAt, endAt, venue: venue!, city: city!,
        sourceUrl: sourceUrl!,
        description: r('description', 'detail'),
        companyCount: countRaw ? Number(countRaw) || undefined : undefined,
      },
    }
  }

  // ── Private: upsert ────────────────────────────────────────────────────────

  private async upsertJobs(
    source: { id: string; orgId: string; name: string },
    rawItems: Record<string, unknown>[],
    config: JobSourceResponseConfig,
  ): Promise<SyncStats> {
    const stats: SyncStats = { added: 0, updated: 0, dup: 0, error: 0 }
    const seen = new Set<string>()
    const errors: string[] = []
    const sync = new Date()

    type Valid = { externalId: string; item: MappedJob }
    const valid: Valid[] = []

    for (const raw of rawItems) {
      const mapped = this.mapJob(raw, config.fields)
      if (!mapped.ok) { stats.error++; errors.push(mapped.reason); continue }
      if (seen.has(mapped.item.externalId)) { stats.dup++; continue }
      seen.add(mapped.item.externalId)
      valid.push({ externalId: mapped.item.externalId, item: mapped.item })
    }

    if (valid.length === 0) {
      stats.errorSummary = errors.length ? `All ${rawItems.length} items failed: ${errors[0]}` : 'Empty response'
      return stats
    }

    const touchedJobIds: string[] = []
    await this.prisma.$transaction(async (tx) => {
      for (const { item } of valid) {
        const existing = await tx.job.findUnique({
          where: { sourceOrgId_externalId: { sourceOrgId: source.orgId, externalId: item.externalId } },
          select: { id: true },
        })
        const job = await tx.job.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId: source.orgId, externalId: item.externalId } },
          create: {
            sourceOrgId: source.orgId, sourceId: source.id, externalId: item.externalId,
            sourceName: source.name, sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            salary: item.salary, description: item.description,
            requirements: item.requirements,
            category: item.category, tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills),
            benefitsJson: JSON.stringify(item.benefits),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough,
            reviewStatus: 'pending', publishStatus: 'draft', syncTime: sync,
          },
          update: {
            sourceId: source.id, sourceName: source.name, sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            salary: item.salary, description: item.description,
            requirements: item.requirements,
            category: item.category, tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills),
            benefitsJson: JSON.stringify(item.benefits),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough,
            syncTime: sync,
            // reviewStatus/publishStatus 不覆写，防绕过审核
          },
        })
        touchedJobIds.push(job.id)
        if (existing) { stats.updated++ } else { stats.added++ }
      }
    })
    await this.refreshJobQualitySnapshots(touchedJobIds)

    if (errors.length) stats.errorSummary = `${errors.length} item(s) skipped: ${errors.slice(0, 3).join('; ')}`
    return stats
  }

  private async refreshJobQualitySnapshots(jobIds: string[]): Promise<void> {
    try {
      await this.jobQuality.refreshJobQualitySnapshots(jobIds)
    } catch (error) {
      this.logger.warn(`refresh job quality snapshots failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  private async upsertFairs(
    source: { id: string; orgId: string; name: string },
    rawItems: Record<string, unknown>[],
    config: JobSourceResponseConfig,
  ): Promise<SyncStats> {
    const stats: SyncStats = { added: 0, updated: 0, dup: 0, error: 0 }
    const seen = new Set<string>()
    const errors: string[] = []
    const sync = new Date()

    type Valid = { item: MappedFair }
    const valid: Valid[] = []

    for (const raw of rawItems) {
      const mapped = this.mapFair(raw, config.fields)
      if (!mapped.ok) { stats.error++; errors.push(mapped.reason); continue }
      if (seen.has(mapped.item.externalId)) { stats.dup++; continue }
      seen.add(mapped.item.externalId)
      valid.push({ item: mapped.item })
    }

    if (valid.length === 0) {
      stats.errorSummary = errors.length ? `All ${rawItems.length} items failed: ${errors[0]}` : 'Empty response'
      return stats
    }

    await this.prisma.$transaction(async (tx) => {
      for (const { item } of valid) {
        const existing = await tx.jobFair.findUnique({
          where: { sourceOrgId_externalId: { sourceOrgId: source.orgId, externalId: item.externalId } },
          select: { id: true },
        })
        await tx.jobFair.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId: source.orgId, externalId: item.externalId } },
          create: {
            sourceOrgId: source.orgId, externalId: item.externalId,
            sourceName: source.name, sourceUrl: item.sourceUrl,
            title: item.title, theme: 'general',
            startAt: item.startAt, endAt: item.endAt,
            venue: item.venue, city: item.city,
            description: item.description, companyCount: item.companyCount ?? 0,
            reviewStatus: 'pending', publishStatus: 'draft', syncTime: sync,
          },
          update: {
            sourceName: source.name, sourceUrl: item.sourceUrl,
            title: item.title,
            startAt: item.startAt, endAt: item.endAt,
            venue: item.venue, city: item.city,
            description: item.description,
            companyCount: item.companyCount ?? undefined,
            syncTime: sync,
          },
        })
        if (existing) { stats.updated++ } else { stats.added++ }
      }
    })

    if (errors.length) stats.errorSummary = `${errors.length} item(s) skipped: ${errors.slice(0, 3).join('; ')}`
    return stats
  }

  // ── Private: DB helpers ────────────────────────────────────────────────────

  private async markStatus(sourceId: string, status: 'success' | 'failed'): Promise<void> {
    try {
      await this.prisma.jobSource.update({
        where: { id: sourceId },
        data: { lastSyncAt: new Date(), lastSyncStatus: status },
      })
    } catch (e) {
      this.logger.warn(`markStatus failed for ${sourceId}: ${(e as Error).message}`)
    }
  }

  private async writeSyncLog(
    sourceId: string, orgId: string,
    dataType: 'job' | 'fair',
    added: number, updated: number, dup: number, error: number,
    result: 'success' | 'partial' | 'failed',
    errorDetail?: string,
  ): Promise<void> {
    try {
      await this.prisma.syncLog.create({
        data: {
          sourceId, orgId, dataType, syncMode: 'api',
          totalCount: added + updated + dup + error,
          addedCount: added, updatedCount: updated,
          dupCount: dup, errorCount: error,
          errorFields: '[]',
          errorDetail: errorDetail?.slice(0, 500) ?? null,
          result,
        },
      })
    } catch (e) {
      this.logger.warn(`writeSyncLog failed: ${(e as Error).message}`)
    }
  }
}
