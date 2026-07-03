import { BadRequestException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { countPdfPages, isSinglePageImage } from '../files/file-page-count.util'
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

type InspectionMessage = {
  code: string
  severity: 'info' | 'warning'
  text: string
}

type InspectionSummary = {
  pageCount: number | null
  pageCountSource: 'image_single_page' | 'pdf_lightweight_scan' | 'unsupported' | 'unavailable'
  canPrint: boolean
  warnings: string[]
  messages: InspectionMessage[]
  imageQuality?: ImageQualitySummary
}

type NormalizeA4Summary = InspectionSummary & {
  targetPaperSize: 'A4'
  canNormalize: boolean
  normalizedFileId: string | null
}

type ImageQualitySummary = {
  widthPx: number
  heightPx: number
  estimatedDpiForA4: number
  minRecommendedDpi: number
  quality: 'ok' | 'low'
}

type PiiRedactionSummary = {
  canRedact: boolean
  redactedFileId: string | null
  resultFileCreated: boolean
  decisionTaskId: string | null
  findingCount: number
  redactedCount: number
  keptCount: number
  pendingCount: number
  warnings: string[]
  messages: InspectionMessage[]
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
    const params = sanitizeParams(dto.params ?? {}, kind)
    assertSupportedTaskParams(kind, params)
    const paramsJson = JSON.stringify(params)
    const result = await this.initialResult(kind, sourceFile, params, requester)
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
    params: Record<string, unknown>,
    requester: MaterialsRequester,
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
            canPrint: inspection.canPrint,
            imageQuality: inspection.imageQuality,
            warnings: inspection.warnings,
            messages: inspection.messages,
          },
        },
      }
    }
    if (kind === 'normalize_a4') {
      const normalize = await this.evaluateNormalizeA4(sourceFile)
      return {
        status: 'completed',
        result: {
          mode: 'a4_normalization_evaluation',
          checks: {
            targetPaperSize: normalize.targetPaperSize,
            canNormalize: normalize.canNormalize,
            normalizedFileId: normalize.normalizedFileId,
            mimeType: sourceFile.mimeType,
            sizeBytes: sourceFile.sizeBytes,
            pageCount: normalize.pageCount,
            pageCountSource: normalize.pageCountSource,
            imageQuality: normalize.imageQuality,
            warnings: normalize.warnings,
            messages: normalize.messages,
          },
        },
      }
    }
    if (kind === 'pii_scan') {
      return { status: 'completed', result: { mode: 'simulated', findingCount: 0 } }
    }
    if (kind === 'pii_redact') {
      const redaction = await this.evaluatePiiRedaction(sourceFile, params, requester)
      return {
        status: 'completed',
        result: {
          mode: 'pii_redaction_evaluation',
          checks: redaction,
        },
      }
    }
    return { status: 'pending', result: { mode: 'skeleton', queued: false } }
  }

  private async inspectSourceFile(sourceFile: SourceFileRecord): Promise<InspectionSummary> {
    if (isSinglePageImage(sourceFile.mimeType)) {
      return this.inspectImageSourceFile(sourceFile)
    }
    if (sourceFile.mimeType !== 'application/pdf') {
      return {
        pageCount: null,
        pageCountSource: 'unsupported',
        canPrint: false,
        warnings: ['PRINT_MIME_UNSUPPORTED'],
        messages: [{ code: 'PRINT_MIME_UNSUPPORTED', severity: 'warning', text: '当前文件格式暂不支持打印前体检' }],
      }
    }
    try {
      const buffer = await this.storage.getObject(sourceFile.storageKey, sourceFile.bucket)
      const pageCount = countPdfPages(buffer)
      const warnings = pageCount === null ? ['PDF_PAGE_COUNT_NOT_DETECTED'] : []
      return {
        pageCount,
        pageCountSource: 'pdf_lightweight_scan',
        canPrint: true,
        warnings,
        messages: pageCount === null
          ? [{ code: 'PDF_PAGE_COUNT_NOT_DETECTED', severity: 'warning', text: '暂未识别 PDF 页数，以实际打印为准' }]
          : [{ code: 'PDF_PAGE_COUNT_DETECTED', severity: 'info', text: 'PDF 页数已完成基础识别' }],
      }
    } catch {
      return {
        pageCount: null,
        pageCountSource: 'unavailable',
        canPrint: false,
        warnings: ['SOURCE_FILE_BYTES_UNAVAILABLE'],
        messages: [{ code: 'SOURCE_FILE_BYTES_UNAVAILABLE', severity: 'warning', text: '暂未读取到文件内容，请重新上传文件' }],
      }
    }
  }

  private async inspectImageSourceFile(sourceFile: SourceFileRecord): Promise<InspectionSummary> {
    const baseMessage: InspectionMessage = {
      code: 'IMAGE_SINGLE_PAGE',
      severity: 'info',
      text: '图片将按 1 页参与打印设置',
    }
    try {
      const buffer = await this.storage.getObject(sourceFile.storageKey, sourceFile.bucket)
      const dimensions = readImageDimensions(buffer, sourceFile.mimeType)
      if (!dimensions) {
        return {
          pageCount: 1,
          pageCountSource: 'image_single_page',
          canPrint: true,
          warnings: ['IMAGE_DIMENSIONS_NOT_DETECTED'],
          messages: [
            baseMessage,
            { code: 'IMAGE_DIMENSIONS_NOT_DETECTED', severity: 'warning', text: '暂未识别图片像素尺寸，请核对打印效果' },
          ],
        }
      }
      const estimatedDpiForA4 = estimateA4Dpi(dimensions.widthPx, dimensions.heightPx)
      const imageQuality: ImageQualitySummary = {
        ...dimensions,
        estimatedDpiForA4,
        minRecommendedDpi: 150,
        quality: estimatedDpiForA4 >= 150 ? 'ok' : 'low',
      }
      const lowResolution = imageQuality.quality === 'low'
      return {
        pageCount: 1,
        pageCountSource: 'image_single_page',
        canPrint: true,
        imageQuality,
        warnings: lowResolution ? ['IMAGE_RESOLUTION_LOW_FOR_A4'] : [],
        messages: [
          baseMessage,
          lowResolution
            ? {
                code: 'IMAGE_RESOLUTION_LOW_FOR_A4',
                severity: 'warning',
                text: `图片像素 ${dimensions.widthPx}×${dimensions.heightPx}，按 A4 打印估算约 ${estimatedDpiForA4} DPI，清晰度可能不足`,
              }
            : {
                code: 'IMAGE_RESOLUTION_OK_FOR_A4',
                severity: 'info',
                text: `图片像素 ${dimensions.widthPx}×${dimensions.heightPx}，按 A4 打印估算约 ${estimatedDpiForA4} DPI`,
              },
        ],
      }
    } catch {
      return {
        pageCount: 1,
        pageCountSource: 'image_single_page',
        canPrint: true,
        warnings: ['IMAGE_BYTES_UNAVAILABLE'],
        messages: [
          baseMessage,
          { code: 'IMAGE_BYTES_UNAVAILABLE', severity: 'warning', text: '暂未读取到图片内容，请核对打印效果' },
        ],
      }
    }
  }

  private async evaluateNormalizeA4(sourceFile: SourceFileRecord): Promise<NormalizeA4Summary> {
    const inspection = await this.inspectSourceFile(sourceFile)
    const canNormalize = inspection.pageCountSource === 'image_single_page' ||
      (inspection.pageCountSource === 'pdf_lightweight_scan' && typeof inspection.pageCount === 'number' && inspection.pageCount > 0)
    const statusMessage: InspectionMessage = canNormalize
      ? {
          code: 'A4_NORMALIZE_EVALUATED',
          severity: 'info',
          text: '已完成 A4 规范化评估，当前版本不生成新文件，打印仍使用原文件',
        }
      : {
          code: 'A4_NORMALIZE_UNAVAILABLE',
          severity: 'warning',
          text: '当前文件暂不支持 A4 规范化评估，请重新上传或继续核对打印参数',
        }
    return {
      ...inspection,
      targetPaperSize: 'A4',
      canNormalize,
      normalizedFileId: null,
      messages: [statusMessage, ...inspection.messages],
    }
  }

  private async evaluatePiiRedaction(
    sourceFile: SourceFileRecord,
    params: Record<string, unknown>,
    requester: MaterialsRequester,
  ): Promise<PiiRedactionSummary> {
    const decisionTaskId = typeof params['decisionTaskId'] === 'string' ? params['decisionTaskId'] : null
    if (!decisionTaskId) {
      return buildPiiRedactionSummary({
        decisionTaskId: null,
        findings: [],
        warnings: ['PII_DECISION_TASK_REQUIRED'],
        message: { code: 'PII_DECISION_TASK_REQUIRED', severity: 'warning', text: '缺少隐私检查决策任务，暂不能评估遮挡产物' },
      })
    }

    const decisionTask = await this.prisma.documentProcessTask.findUnique({
      where: { id: decisionTaskId },
      include: { findings: true },
    })
    if (!decisionTask || decisionTask.sourceFileId !== sourceFile.id || decisionTask.kind !== 'pii_scan') {
      return buildPiiRedactionSummary({
        decisionTaskId,
        findings: [],
        warnings: ['PII_DECISION_TASK_INVALID'],
        message: { code: 'PII_DECISION_TASK_INVALID', severity: 'warning', text: '隐私检查决策任务不可用，请重新完成隐私检查' },
      })
    }

    this.assertNotExpired(decisionTask)
    this.assertCanAccessTask(decisionTask, requester)
    return buildPiiRedactionSummary({
      decisionTaskId,
      findings: decisionTask.findings,
      warnings: [],
      message: {
        code: 'PII_REDACTION_EVALUATED',
        severity: 'info',
        text: '已完成遮挡产物评估，当前版本不生成新文件，打印仍使用原文件',
      },
    })
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
    snippet: maskPiiSnippet('phone', value),
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
    snippet: maskPiiSnippet('email', value),
    confidence: 0.93,
    action: 'pending' as const,
  })).forEach((finding) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  })

  collectMatches(text, /\b([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])\b/g, (value) => ({
    type: 'id_card',
    label: '身份证号',
    pageNumber: null,
    snippet: maskPiiSnippet('id_card', value),
    confidence: 0.9,
    action: 'pending' as const,
  })).forEach((finding) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  })

  collectMatches(text, /([\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|街道|路|街|巷)[\u4e00-\u9fa5A-Za-z0-9\s-]{0,24}号?)/g, (value) => ({
    type: 'address',
    label: '地址',
    pageNumber: null,
    snippet: maskPiiSnippet('address', value),
    confidence: 0.78,
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

function buildPiiRedactionSummary(args: {
  decisionTaskId: string | null
  findings: Array<{ action: string }>
  warnings: string[]
  message: InspectionMessage
}): PiiRedactionSummary {
  const findingCount = args.findings.length
  const redactedCount = args.findings.filter((finding) => finding.action === 'redact').length
  const keptCount = args.findings.filter((finding) => finding.action === 'keep').length
  const pendingCount = args.findings.filter((finding) => finding.action === 'pending').length
  const pendingWarnings = pendingCount > 0 ? ['PII_DECISIONS_PENDING'] : []
  const warnings = [...args.warnings, ...pendingWarnings]
  const messages = [
    args.message,
    ...(pendingCount > 0
      ? [{ code: 'PII_DECISIONS_PENDING', severity: 'warning' as const, text: '仍有隐私片段未选择保留或遮挡，暂不能生成遮挡评估' }]
      : []),
  ]
  return {
    canRedact: warnings.length === 0,
    redactedFileId: null,
    resultFileCreated: false,
    decisionTaskId: args.decisionTaskId,
    findingCount,
    redactedCount,
    keptCount,
    pendingCount,
    warnings,
    messages,
  }
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

function assertSupportedTaskParams(kind: MaterialTaskKind, params: Record<string, unknown>): void {
  if (kind !== 'normalize_a4') return
  const targetPaperSize = params['targetPaperSize']
  if (targetPaperSize === undefined || targetPaperSize === 'A4') return
  throw new BadRequestException({ error: { code: 'MATERIAL_TARGET_PAPER_UNSUPPORTED', message: '本期仅支持 A4 规范化评估' } })
}

function readStringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key]
  return typeof value === 'string' ? value : undefined
}

function readImageDimensions(buffer: Buffer, mimeType: string): { widthPx: number; heightPx: number } | null {
  if (mimeType === 'image/png') return readPngDimensions(buffer)
  if (mimeType === 'image/jpeg') return readJpegDimensions(buffer)
  return null
}

function readPngDimensions(buffer: Buffer): { widthPx: number; heightPx: number } | null {
  if (buffer.length < 24) return null
  const pngSignature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== pngSignature) return null
  return {
    widthPx: buffer.readUInt32BE(16),
    heightPx: buffer.readUInt32BE(20),
  }
}

function readJpegDimensions(buffer: Buffer): { widthPx: number; heightPx: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 2 > buffer.length) return null
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null
    if (isJpegStartOfFrame(marker)) {
      return {
        heightPx: buffer.readUInt16BE(offset + 3),
        widthPx: buffer.readUInt16BE(offset + 5),
      }
    }
    offset += segmentLength
  }
  return null
}

function isJpegStartOfFrame(marker: number | undefined): boolean {
  return marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
    marker === 0xc5 || marker === 0xc6 || marker === 0xc7 ||
    marker === 0xc9 || marker === 0xca || marker === 0xcb ||
    marker === 0xcd || marker === 0xce || marker === 0xcf
}

function estimateA4Dpi(widthPx: number, heightPx: number): number {
  const portraitDpi = Math.min(widthPx / 8.27, heightPx / 11.69)
  const landscapeDpi = Math.min(widthPx / 11.69, heightPx / 8.27)
  return Math.max(1, Math.round(Math.max(portraitDpi, landscapeDpi)))
}

function limitSnippet(value: string): string {
  return value.length > MAX_SNIPPET_CHARS ? value.slice(0, MAX_SNIPPET_CHARS) : value
}

/**
 * 服务端落库前掩码 PII 片段（M1）。
 *
 * DB 与 API 返回的 snippet 不再包含完整手机号 / 邮箱 / 身份证号 / 地址原文，
 * 仅保留供用户辨识类型的最小片段。前端 maskSnippet 作为二次防护，但不依赖前端。
 */
function maskPiiSnippet(type: string, raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  let masked: string
  if (type === 'phone') masked = maskPhone(value)
  else if (type === 'email') masked = maskEmail(value)
  else if (type === 'id_card') masked = maskIdCard(value)
  else if (type === 'address') masked = maskAddress(value)
  else masked = maskGeneric(value)
  return limitSnippet(masked)
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  const core = digits.length > 11 ? digits.slice(-11) : digits
  if (core.length < 7) return `${core.slice(0, 1)}****`
  return `${core.slice(0, 3)}****${core.slice(-4)}`
}

function maskEmail(value: string): string {
  const at = value.indexOf('@')
  if (at <= 0) return maskGeneric(value)
  const domain = value.slice(at + 1)
  return `${value.slice(0, 1)}***@${domain}`
}

function maskIdCard(value: string): string {
  const v = value.toUpperCase()
  if (v.length <= 6) return `${v.slice(0, 1)}****`
  return `${v.slice(0, 3)}****${v.slice(-2)}`
}

function maskAddress(value: string): string {
  // 保留到第一个行政级别字（省/市/区/县）为止，遮住后续街道、门牌等详细段。
  const match = value.match(/[省市区县]/)
  if (match && match.index !== undefined) return `${value.slice(0, match.index + 1)}****`
  return `${value.slice(0, 2)}****`
}

function maskGeneric(value: string): string {
  if (value.length <= 4) return `${value.slice(0, 1)}**`
  return `${value.slice(0, 2)}***${value.slice(-2)}`
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
