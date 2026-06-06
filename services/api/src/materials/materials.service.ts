import { BadRequestException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import type { CreateMaterialTaskDto } from './dto/create-material-task.dto'
import type { DecidePiiFindingsDto, PiiDecisionAction } from './dto/decide-pii-findings.dto'
import type {
  DocumentProcessTaskView,
  MaterialTaskKind,
  MaterialTaskStatus,
  MaterialsRequester,
  PiiFindingAction,
  PiiFindingView,
} from './materials.types'

const TASK_TTL_HOURS = 24
const MAX_SNIPPET_CHARS = 32
const RAW_TEXT_PARAM_KEYS = new Set(['textsample', 'text', 'rawtext', 'fulltext', 'content', 'documenttext'])

type TaskRecord = {
  id: string
  kind: string
  status: string
  requesterMode: string
  accessTokenHash: string | null
  sourceFileId: string
  resultFileId: string | null
  endUserId: string | null
  paramsJson: string
  resultJson: string | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  findings?: FindingRecord[]
}

type FindingRecord = {
  id: string
  taskId: string
  type: string
  label: string
  pageNumber: number | null
  snippet: string | null
  confidence: number | null
  action: string
  createdAt: Date
}

type SourceFileRecord = {
  id: string
  storageKey: string
  bucket: string
  filename: string
  mimeType: string
  sizeBytes: number
  purpose: string
  endUserId: string | null
  uploaderId: string | null
  ownerType: string | null
  ownerId: string | null
  status: string
  deletedAt: Date | null
}

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createTask(dto: CreateMaterialTaskDto, requester: MaterialsRequester): Promise<DocumentProcessTaskView> {
    const sourceFile = await this.requireUsableSourceFile(dto.sourceFileId)
    this.assertCanUseSourceFile(sourceFile, requester)

    const kind = dto.kind as MaterialTaskKind
    const now = new Date()
    const requesterMode = requester.kind === 'member' ? 'member' : 'anonymous'
    const accessToken = requesterMode === 'anonymous' ? randomBytes(24).toString('hex') : undefined
    const paramsJson = JSON.stringify(sanitizeParams(dto.params ?? {}, kind))
    const result = await this.initialResult(kind, sourceFile)
    const task = await this.prisma.documentProcessTask.create({
      data: {
        kind,
        status: result.status,
        requesterMode,
        accessTokenHash: accessToken ? hashAccessToken(accessToken) : null,
        sourceFileId: sourceFile.id,
        resultFileId: null,
        endUserId: sourceFile.endUserId,
        paramsJson,
        resultJson: JSON.stringify(result.result),
        expiresAt: new Date(now.getTime() + TASK_TTL_HOURS * 60 * 60 * 1000),
      },
    })

    if (kind === 'pii_scan') {
      const findings = buildSimulatedPiiFindings({
        filename: sourceFile.filename,
        textSample: readStringParam(dto.params, 'textSample'),
      })
      if (findings.length > 0) {
        await this.prisma.piiFinding.createMany({
          data: findings.map((finding) => ({ ...finding, taskId: task.id })),
        })
      }
      await this.prisma.documentProcessTask.update({
        where: { id: task.id },
        data: { resultJson: JSON.stringify({ mode: 'simulated', findingCount: findings.length }) },
      })
    }

    const view = await this.getTask(task.id, accessToken ? { ...requester, accessToken } : requester)
    return accessToken ? { ...view, accessToken } : view
  }

  async getTask(id: string, requester: MaterialsRequester): Promise<DocumentProcessTaskView> {
    const task = await this.prisma.documentProcessTask.findUnique({
      where: { id },
      include: { findings: { orderBy: { createdAt: 'asc' } } },
    })
    if (!task) {
      throw new NotFoundException({ error: { code: 'MATERIAL_TASK_NOT_FOUND', message: '材料处理任务不存在' } })
    }
    this.assertNotExpired(task)
    this.assertCanAccessTask(task, requester)
    return toTaskView(task)
  }

  async decidePiiFindings(
    taskId: string,
    dto: DecidePiiFindingsDto,
    requester: MaterialsRequester,
  ): Promise<DocumentProcessTaskView> {
    const task = await this.prisma.documentProcessTask.findUnique({
      where: { id: taskId },
      include: { findings: true },
    })
    if (!task) {
      throw new NotFoundException({ error: { code: 'MATERIAL_TASK_NOT_FOUND', message: '材料处理任务不存在' } })
    }
    this.assertNotExpired(task)
    this.assertCanAccessTask(task, requester)
    if (task.kind !== 'pii_scan' && task.kind !== 'pii_redact') {
      throw new BadRequestException({ error: { code: 'MATERIAL_TASK_KIND_INVALID', message: '该任务不支持 PII 决策' } })
    }

    const decisionsById = new Map<string, PiiDecisionAction>()
    for (const decision of dto.decisions) decisionsById.set(decision.findingId, decision.action)
    const findingIds = [...decisionsById.keys()]
    const ownedFindings = await this.prisma.piiFinding.findMany({
      where: { taskId, id: { in: findingIds } },
      select: { id: true },
    })
    if (ownedFindings.length !== findingIds.length) {
      throw new BadRequestException({ error: { code: 'PII_FINDING_NOT_FOUND', message: '存在不属于该任务的 PII 命中项' } })
    }

    for (const findingId of findingIds) {
      await this.prisma.piiFinding.update({
        where: { id: findingId },
        data: { action: decisionsById.get(findingId)! },
      })
    }
    return this.getTask(taskId, requester)
  }

  async cleanupExpired(now = new Date()): Promise<{ deletedTasks: number }> {
    const result = await this.prisma.documentProcessTask.deleteMany({
      where: { expiresAt: { lte: now } },
    })
    return { deletedTasks: result.count }
  }

  private async initialResult(
    kind: MaterialTaskKind,
    sourceFile: SourceFileRecord,
  ): Promise<{ status: MaterialTaskStatus; result: Record<string, unknown> }> {
    if (kind === 'inspection') {
      const inspection = await this.inspectSourceFile(sourceFile)
      return {
        status: 'completed',
        result: {
          mode: 'basic_inspection',
          checks: {
            filePresent: true,
            mimeType: sourceFile.mimeType,
            sizeBytes: sourceFile.sizeBytes,
            purpose: sourceFile.purpose,
            pageCount: inspection.pageCount,
            pageCountSource: inspection.pageCountSource,
            warnings: inspection.warnings,
          },
        },
      }
    }
    if (kind === 'normalize_a4') {
      return {
        status: 'completed',
        result: { mode: 'skeleton', output: 'a4_ready_placeholder', resultFileCreated: false },
      }
    }
    if (kind === 'pii_scan') {
      return { status: 'completed', result: { mode: 'simulated', findingCount: 0 } }
    }
    return { status: 'pending', result: { mode: 'skeleton', queued: false } }
  }

  private async inspectSourceFile(sourceFile: SourceFileRecord): Promise<{
    pageCount: number | null
    pageCountSource: 'image_single_page' | 'pdf_lightweight_scan' | 'unsupported' | 'unavailable'
    warnings: string[]
  }> {
    if (isSinglePageImage(sourceFile.mimeType)) {
      return { pageCount: 1, pageCountSource: 'image_single_page', warnings: [] }
    }
    if (sourceFile.mimeType !== 'application/pdf') {
      return { pageCount: null, pageCountSource: 'unsupported', warnings: ['PAGE_COUNT_UNSUPPORTED_MIME'] }
    }
    try {
      const buffer = await this.storage.getObject(sourceFile.storageKey, sourceFile.bucket)
      const pageCount = countPdfPages(buffer)
      return {
        pageCount,
        pageCountSource: 'pdf_lightweight_scan',
        warnings: pageCount === null ? ['PDF_PAGE_COUNT_NOT_DETECTED'] : [],
      }
    } catch {
      return { pageCount: null, pageCountSource: 'unavailable', warnings: ['SOURCE_FILE_BYTES_UNAVAILABLE'] }
    }
  }

  private async requireUsableSourceFile(sourceFileId: string): Promise<SourceFileRecord> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: sourceFileId } })
    if (!file || file.deletedAt || file.status !== 'active') {
      throw new NotFoundException({ error: { code: 'SOURCE_FILE_NOT_FOUND', message: '源文件不存在或不可用' } })
    }
    return file
  }

  private assertCanUseSourceFile(file: SourceFileRecord, requester: MaterialsRequester): void {
    if (file.endUserId) {
      if (requester.kind === 'member' && requester.endUserId === file.endUserId) return
      throw new ForbiddenException({ error: { code: 'SOURCE_FILE_ACCESS_DENIED', message: '无权基于该文件创建材料任务' } })
    }
    const isAnonymousFile = !file.uploaderId && (!file.ownerType || file.ownerType === 'system') && !file.ownerId
    if (isAnonymousFile) return
    throw new ForbiddenException({ error: { code: 'SOURCE_FILE_OWNER_UNSUPPORTED', message: '本期暂不支持该来源文件创建材料任务' } })
  }

  private assertCanAccessTask(task: { endUserId: string | null }, requester: MaterialsRequester): void {
    if (!task.endUserId) {
      if (requester.kind !== 'anonymous') {
        throw new ForbiddenException({ error: { code: 'MATERIAL_TASK_ACCESS_DENIED', message: '无权访问该材料处理任务' } })
      }
      const tokenHash = (task as { accessTokenHash?: string | null }).accessTokenHash
      if (tokenHash && requester.accessToken && verifyAccessToken(requester.accessToken, tokenHash)) return
      throw new ForbiddenException({ error: { code: 'MATERIAL_TASK_TOKEN_REQUIRED', message: '缺少或无效的材料任务访问凭证' } })
    }
    if (requester.kind === 'member' && requester.endUserId === task.endUserId) return
    throw new ForbiddenException({ error: { code: 'MATERIAL_TASK_ACCESS_DENIED', message: '无权访问该材料处理任务' } })
  }

  private assertNotExpired(task: { expiresAt: Date }): void {
    if (task.expiresAt.getTime() > Date.now()) return
    throw new GoneException({ error: { code: 'MATERIAL_TASK_EXPIRED', message: '材料处理任务已过期' } })
  }
}

function buildSimulatedPiiFindings(args: { filename: string; textSample?: string }): Array<{
  type: string
  label: string
  pageNumber: number | null
  snippet: string | null
  confidence: number
  action: PiiFindingAction
}> {
  const text = [args.filename, args.textSample ?? ''].filter(Boolean).join('\n')
  const findings: Array<{
    type: string
    label: string
    pageNumber: number | null
    snippet: string | null
    confidence: number
    action: PiiFindingAction
  }> = []
  const seen = new Set<string>()

  collectMatches(text, /(?:^|[^\d])((?:\+?86[- ]?)?1[3-9]\d{9})(?!\d)/g, (value) => ({
    type: 'phone',
    label: '手机号',
    pageNumber: null,
    snippet: limitSnippet(value),
    confidence: 0.95,
    action: 'pending' as const,
  })).forEach((finding) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  })

  collectMatches(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, (value) => ({
    type: 'email',
    label: '邮箱',
    pageNumber: null,
    snippet: limitSnippet(value),
    confidence: 0.93,
    action: 'pending' as const,
  })).forEach((finding) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  })

  return findings
}

function collectMatches<T>(text: string, regex: RegExp, toFinding: (value: string) => T): T[] {
  const findings: T[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const value = match[1]
    if (value) findings.push(toFinding(value))
  }
  return findings
}

function sanitizeParams(value: unknown, kind: MaterialTaskKind): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const safeKeys = allowedParamKeys(kind)
  for (const key of safeKeys) {
    if (!(key in input)) continue
    const sanitized = sanitizeParamValue(input[key], key)
    if (sanitized !== undefined) out[key] = sanitized
  }
  return out
}

function sanitizeParamValue(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeParamValue(item, key))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = sanitizeParamValue(childValue, childKey)
    }
    return out
  }
  if (typeof value !== 'string') return value

  const normalizedKey = key.toLowerCase()
  if (RAW_TEXT_PARAM_KEYS.has(normalizedKey)) {
    return {
      omitted: true,
      reason: 'raw_text_not_persisted',
      length: value.length,
      sha256: createHash('sha256').update(value).digest('hex'),
    }
  }
  if (value.length > 128) {
    return { omitted: true, reason: 'long_string_not_persisted', length: value.length }
  }
  return value
}

function allowedParamKeys(kind: MaterialTaskKind): string[] {
  switch (kind) {
    case 'inspection':
      return ['expectedPaperSize', 'source']
    case 'normalize_a4':
      return ['targetPaperSize', 'source']
    case 'pii_scan':
      return ['textSample', 'scanScope']
    case 'pii_redact':
      return ['decisionTaskId']
    case 'bundle_render':
      return ['fileIds', 'order']
    default:
      return []
  }
}

function readStringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key]
  return typeof value === 'string' ? value : undefined
}

function isSinglePageImage(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp'
}

function countPdfPages(buffer: Buffer): number | null {
  const text = buffer.toString('latin1')
  const matches = text.match(/\/Type\s*\/Page\b/g)
  if (!matches?.length) return null
  return matches.length
}

function limitSnippet(value: string): string {
  return value.length > MAX_SNIPPET_CHARS ? value.slice(0, MAX_SNIPPET_CHARS) : value
}

function toTaskView(task: TaskRecord): DocumentProcessTaskView {
  return {
    id: task.id,
    kind: task.kind as MaterialTaskKind,
    status: task.status as MaterialTaskStatus,
    requesterMode: task.requesterMode as 'anonymous' | 'member',
    sourceFileId: task.sourceFileId,
    resultFileId: task.resultFileId,
    endUserId: task.endUserId,
    params: parseJsonObject(task.paramsJson),
    result: task.resultJson ? parseJsonObject(task.resultJson) : null,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    expiresAt: task.expiresAt.toISOString(),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    piiFindings: task.findings?.map(toFindingView),
  }
}

function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function verifyAccessToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashAccessToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function toFindingView(finding: FindingRecord): PiiFindingView {
  return {
    id: finding.id,
    taskId: finding.taskId,
    type: finding.type,
    label: finding.label,
    pageNumber: finding.pageNumber,
    snippet: finding.snippet,
    confidence: finding.confidence,
    action: finding.action as PiiFindingAction,
    createdAt: finding.createdAt.toISOString(),
  }
}

function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
