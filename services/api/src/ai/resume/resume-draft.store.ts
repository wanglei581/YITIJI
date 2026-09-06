import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import type { GeneratedResume, OptimizeResumeOutput, ParseResumeOutput, ResumeLayoutSettings } from '../interfaces/ai-provider.interface'
import type { ResumeExtractionService } from './resume-extraction.service'
import { matchResumeFacts, type ResumeFactMatch } from './resume-fact-match'

/** 与 AiService.AiResultRequester 结构相同，不回引 ai.service 以免循环依赖。 */
interface ResumeResultRequester {
  endUserId: string | null
  accessToken: string | null
}

/** AiResumeResult.kind：最新 AI 优化结果（既有）。 */
export const KIND_OPTIMIZE = 'optimize'
/** 登录用户编辑草稿；不单独出现在资产列表。 */
export const KIND_OPTIMIZE_DRAFT = 'optimize_draft'
/** 导出时的确认快照；重新生成 optimize 不得覆盖本行。 */
export const KIND_OPTIMIZE_CONFIRMED = 'optimize_confirmed'
/** 列表不得单独成行的 kind。 */
export const HIDDEN_RESUME_RESULT_KINDS = [KIND_OPTIMIZE_DRAFT, KIND_OPTIMIZE_CONFIRMED] as const

const DECISIONS_JSON_MAX_CHARS = 16_384

export interface ResumeDraftPayload {
  resume: GeneratedResume
  layout?: ResumeLayoutSettings
  decisions?: Record<string, unknown>
  updatedAt: string
}

export interface ResumeConfirmedSnapshot {
  version: number
  confirmedAt: string
  fileId: string
  factsConfirmedAt?: string
}

export interface ResumeDraftView {
  taskId: string
  draft: ResumeDraftPayload | null
}

export interface ResumeVersionsView {
  taskId: string
  latestVersion: number | null
  items: ResumeConfirmedSnapshot[]
}

export interface ResumeFactCheckView {
  taskId: string
  originalAvailable: true
  items: ResumeFactMatch[]
}

interface DraftStoreDeps {
  prisma: PrismaService
  extraction: ResumeExtractionService
  loadAuthorized: <T>(taskId: string, kind: string, requester: ResumeResultRequester) => Promise<T | null>
  persist: (
    taskId: string,
    kind: string,
    status: string,
    payload: unknown,
    endUserId: string | null,
    accessTokenHash?: string | null,
  ) => Promise<void>
}

function notFound(): never {
  throw new NotFoundException({
    error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请先提交简历解析' },
  })
}

function requireLogin(requester: ResumeResultRequester): string {
  if (!requester.endUserId) notFound()
  return requester.endUserId
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseDraftPayload(raw: string): ResumeDraftPayload | null {
  try {
    const parsed = asRecord(JSON.parse(raw))
    if (!parsed) return null
    const resume = asRecord(parsed['resume']) as GeneratedResume | null
    if (!resume || typeof resume !== 'object') return null
    const updatedAt = typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'] : ''
    if (!updatedAt) return null
    const layout = asRecord(parsed['layout']) as ResumeLayoutSettings | undefined
    const decisions = asRecord(parsed['decisions']) ?? undefined
    return { resume, layout, decisions, updatedAt }
  } catch {
    return null
  }
}

export function parseConfirmedPayload(raw: string): ResumeConfirmedSnapshot | null {
  try {
    const parsed = asRecord(JSON.parse(raw))
    if (!parsed) return null
    const version = Number(parsed['version'])
    const confirmedAt = typeof parsed['confirmedAt'] === 'string' ? parsed['confirmedAt'] : ''
    const fileId = typeof parsed['fileId'] === 'string' ? parsed['fileId'] : ''
    if (!Number.isInteger(version) || version < 1 || !confirmedAt || !fileId) return null
    const factsConfirmedAt = typeof parsed['factsConfirmedAt'] === 'string' ? parsed['factsConfirmedAt'] : undefined
    return { version, confirmedAt, fileId, ...(factsConfirmedAt ? { factsConfirmedAt } : {}) }
  } catch {
    return null
  }
}

function sanitizeDecisions(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined
  const json = JSON.stringify(input)
  if (json.length > DECISIONS_JSON_MAX_CHARS) {
    throw new BadRequestException({
      error: { code: 'RESUME_DRAFT_TOO_LARGE', message: '草稿裁决内容过长，请精简后再保存' },
    })
  }
  return input
}

/**
 * 登录用户草稿 / 确认版本 / 事实核对。不改 Prisma 模型，复用 AiResumeResult.kind。
 *
 * persistResult 仍只写 parse/optimize/generate；本 store 写 optimize_draft /
 * optimize_confirmed，因此重新生成 optimize 覆盖不了已确认快照。
 */
export class ResumeDraftStore {
  constructor(private readonly deps: DraftStoreDeps) {}

  async saveDraft(
    taskId: string,
    input: { resume: GeneratedResume; layout?: ResumeLayoutSettings; decisions?: Record<string, unknown> },
    requester: ResumeResultRequester,
  ): Promise<{ taskId: string; updatedAt: string; saved: true }> {
    const endUserId = requireLogin(requester)
    const parse = await this.deps.loadAuthorized<ParseResumeOutput>(taskId, 'parse', requester)
    if (!parse) notFound()
    const owner = await this.deps.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: 'parse' } },
      select: { endUserId: true, accessTokenHash: true },
    })
    if (!owner || owner.endUserId !== endUserId) notFound()
    const updatedAt = new Date().toISOString()
    const payload: ResumeDraftPayload = {
      resume: input.resume,
      layout: input.layout,
      decisions: sanitizeDecisions(input.decisions),
      updatedAt,
    }
    await this.deps.persist(
      taskId,
      KIND_OPTIMIZE_DRAFT,
      'completed',
      payload,
      owner.endUserId,
      owner.accessTokenHash,
    )
    return { taskId, updatedAt, saved: true }
  }

  async getDraft(taskId: string, requester: ResumeResultRequester): Promise<ResumeDraftView> {
    requireLogin(requester)
    const parse = await this.deps.loadAuthorized<ParseResumeOutput>(taskId, 'parse', requester)
    if (!parse) notFound()
    const row = await this.deps.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: KIND_OPTIMIZE_DRAFT } },
    })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      return { taskId, draft: null }
    }
    return { taskId, draft: parseDraftPayload(row.payloadJson) }
  }

  async listVersions(taskId: string, requester: ResumeResultRequester): Promise<ResumeVersionsView> {
    requireLogin(requester)
    const parse = await this.deps.loadAuthorized<ParseResumeOutput>(taskId, 'parse', requester)
    if (!parse) notFound()
    const row = await this.deps.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: KIND_OPTIMIZE_CONFIRMED } },
    })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      return { taskId, latestVersion: null, items: [] }
    }
    const snapshot = parseConfirmedPayload(row.payloadJson)
    if (!snapshot) return { taskId, latestVersion: null, items: [] }
    return { taskId, latestVersion: snapshot.version, items: [snapshot] }
  }

  async factCheck(taskId: string, requester: ResumeResultRequester): Promise<ResumeFactCheckView> {
    const parse = await this.deps.loadAuthorized<ParseResumeOutput>(taskId, 'parse', requester)
    if (!parse) notFound()
    const resume = await this.resolveFactCheckResume(taskId, requester)
    if (!resume) {
      throw new BadRequestException({
        error: { code: 'AI_RESULT_NOT_READY', message: '还没有可核对的优化稿，请先生成或保存草稿' },
      })
    }
    const fileId = parse.fileId
    if (!fileId) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_RESUME_SOURCE_UNAVAILABLE', message: '简历原文已按隐私策略自动清理，无法核对事实' },
      })
    }
    const owner = await this.deps.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: 'parse' } },
      select: { endUserId: true },
    })
    const extraction = await this.deps.extraction.extractResumeText({
      fileId,
      endUserId: owner?.endUserId ?? null,
    })
    if (!extraction.ok || !extraction.text?.trim()) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_RESUME_SOURCE_UNAVAILABLE', message: '简历原文已按隐私策略自动清理，无法核对事实' },
      })
    }
    return {
      taskId,
      originalAvailable: true,
      items: matchResumeFacts(resume, extraction.text),
    }
  }

  async assertFactsConfirmed(input: {
    endUserId: string | null
    taskId?: string | null
    factsConfirmedAt?: string
    draft?: boolean
  }): Promise<void> {
    if (input.draft === true) return
    if (!input.endUserId || !input.taskId) return
    const optimize = await this.deps.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: input.taskId, kind: KIND_OPTIMIZE } },
      select: { id: true, expiresAt: true },
    })
    if (!optimize || !optimize.expiresAt || optimize.expiresAt.getTime() < Date.now()) return
    const confirmedAt = parseFactsConfirmedAt(input.factsConfirmedAt)
    if (!confirmedAt) {
      throw new BadRequestException({
        error: {
          code: 'RESUME_FACTS_NOT_CONFIRMED',
          message: '导出前请先核对优化稿中的学校、公司、时间、证书和联系方式',
        },
      })
    }
  }

  async persistConfirmed(input: {
    taskId: string
    endUserId: string | null
    fileId: string
    factsConfirmedAt?: string
  }): Promise<void> {
    const parse = await this.deps.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: input.taskId, kind: 'parse' } },
      select: { endUserId: true, accessTokenHash: true, expiresAt: true },
    })
    if (!parse || !parse.expiresAt || parse.expiresAt.getTime() < Date.now()) return
    if (input.endUserId && parse.endUserId && parse.endUserId !== input.endUserId) return
    const existing = await this.deps.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: input.taskId, kind: KIND_OPTIMIZE_CONFIRMED } },
      select: { payloadJson: true, expiresAt: true },
    })
    const prev = existing && existing.expiresAt && existing.expiresAt.getTime() >= Date.now()
      ? parseConfirmedPayload(existing.payloadJson)
      : null
    const snapshot: ResumeConfirmedSnapshot = {
      version: (prev?.version ?? 0) + 1,
      confirmedAt: new Date().toISOString(),
      fileId: input.fileId,
      ...(input.factsConfirmedAt ? { factsConfirmedAt: input.factsConfirmedAt } : {}),
    }
    await this.deps.persist(
      input.taskId,
      KIND_OPTIMIZE_CONFIRMED,
      'completed',
      snapshot,
      parse.endUserId,
      parse.accessTokenHash,
    )
  }

  private async resolveFactCheckResume(
    taskId: string,
    requester: ResumeResultRequester,
  ): Promise<GeneratedResume | null> {
    const draftRow = await this.deps.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: KIND_OPTIMIZE_DRAFT } },
    })
    if (draftRow && draftRow.expiresAt && draftRow.expiresAt.getTime() >= Date.now()) {
      const draft = parseDraftPayload(draftRow.payloadJson)
      if (draft?.resume) return draft.resume
    }
    const optimize = await this.deps.loadAuthorized<OptimizeResumeOutput>(taskId, KIND_OPTIMIZE, requester)
    return optimize?.optimizedResume ?? null
  }
}

export function parseFactsConfirmedAt(raw: string | undefined): Date | null {
  if (!raw || !raw.trim()) return null
  const value = new Date(raw)
  if (Number.isNaN(value.getTime())) return null
  const now = Date.now()
  if (value.getTime() > now + 60_000) return null
  if (value.getTime() < now - 24 * 60 * 60 * 1000) return null
  return value
}
