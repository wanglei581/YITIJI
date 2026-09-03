// ============================================================
// 隐私遮挡任务的编排层（决策文档 docs/product/pii-redaction-decision-2026-08.md §3）。
//
// 从 materials.service.ts 拆出来的原因：遮挡是这个模块里最重、判定分支最多的一条路径，
// 留在原文件会把它推过 CLAUDE.md §8 的 1000 行拆分阈值。这里只搬运，不改行为。
//
// 职责边界：
//   - 本文件：决策任务校验 → 坐标连接 → 调 pii-redaction.util 生成产物 → 复检 → 落派生件 → 组装 claim
//   - pii-redaction.util.ts：纯 PDF 处理（画黑条 / 栅格化 / 重组），不碰数据库与鉴权
//   - materials.service.ts：任务生命周期、鉴权、其它 kind
// ============================================================
import { Injectable } from '@nestjs/common'
import { OcrService } from '../ai/resume/ocr/ocr.service'
import { FilesService } from '../files/files.service'
import { signFileUrl } from '../files/signing'
import type { FileSensitiveLevel } from '../files/file.types'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { assertCanAccessTask, assertTaskNotExpired } from './materials.access'
import type {
  MaterialsRequester,
  PiiRedactionClaim,
  PiiRedactionItemView,
  PiiRedactionNotSupportedReason,
  PiiReverifyView,
} from './materials.types'
import { buildRedactedPdf, PII_REDACT_MAX_RASTER_PAGES } from './pii-redaction.util'
import { buildPiiFindingsWithValues, extractTextForPiiScan, type PiiBox, type PiiFindingWithValue } from './pii-scan.util'

type InspectionMessage = {
  code: string
  severity: 'info' | 'warning'
  text: string
}

/** pii_redact 任务 result.checks 的形状。 */
export type PiiRedactionSummary = {
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
  /**
   * 派生件的**可直接访问**链接（HMAC 签名 + TTL，不需要登录）。
   *
   * 为什么必须给 URL 而不是只给 id：一体机是匿名使用的，而 /files/:id/preview-url 挂了
   * JwtAuthGuard —— 匿名用户拿到 id 也取不到文件，遮挡功能在真实路径上整个不可用。
   * /files/:id/content?expires=&sig= 这条不挂 JwtAuthGuard，只认签名，正是为这种场景设计的。
   *
   * **不落库**：签名 URL 是 bearer capability，不该在 DB 里躺满任务 24 小时有效期，
   * 而且落库的那份很快就过期。build 阶段恒为 null，由 injectRedactedFileUrl 在每次读取任务时
   * 重新签发，所以创建响应和后续查询拿到的都是新鲜链接。
   */
  redactedFileUrl: string | null
  redactedFileUrlExpiresAt: string | null
  // ── 决策文档 §3.4：「能说什么」在 API 边界上强制，前端按 claim 选文案 ──────────
  claim: PiiRedactionClaim
  notSupportedReason?: PiiRedactionNotSupportedReason
  items: PiiRedactionItemView[]
  reverify: PiiReverifyView
  /** 实际被栅格化的页码（该页文字层已不可逆消失）；未受影响页仍是矢量文字。 */
  rasterizedPages: number[]
}

/** evaluate() 需要的源文件字段（与 materials.service 的 SourceFileRecord 结构兼容）。 */
export type RedactionSourceFile = {
  id: string
  storageKey: string
  bucket: string
  filename: string
  mimeType: string
  sensitiveLevel: string
  endUserId: string | null
}

@Injectable()
export class PiiRedactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly files: FilesService,
  ) {}

  async evaluate(
    sourceFile: RedactionSourceFile,
    params: Record<string, unknown>,
    requester: MaterialsRequester,
  ): Promise<PiiRedactionSummary> {
    const decisionTaskId = typeof params['decisionTaskId'] === 'string' ? params['decisionTaskId'] : null
    if (!decisionTaskId) {
      return buildPiiRedactionSummary({
        decisionTaskId: null,
        findings: [],
        warnings: ['PII_DECISION_TASK_REQUIRED'],
        message: { code: 'PII_DECISION_TASK_REQUIRED', severity: 'warning', text: '缺少隐私检查决策任务，暂不能生成遮挡文件' },
        notSupportedReason: 'decision_task_invalid',
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
        notSupportedReason: 'decision_task_invalid',
      })
    }

    assertTaskNotExpired(decisionTask)
    assertCanAccessTask(decisionTask, requester)

    const findings = decisionTask.findings
    if (findings.some((finding) => finding.action === 'pending')) {
      return buildPiiRedactionSummary({
        decisionTaskId,
        findings,
        warnings: [],
        message: {
          code: 'PII_REDACTION_BLOCKED',
          severity: 'warning',
          text: '仍有隐私片段未选择保留或遮挡，暂不能生成遮挡文件',
        },
        notSupportedReason: 'decisions_pending',
      })
    }

    const requested = findings.filter((finding) => finding.action === 'redact')
    if (requested.length === 0) {
      return buildPiiRedactionSummary({
        decisionTaskId,
        findings,
        warnings: [],
        message: { code: 'PII_REDACTION_NOTHING_TO_DO', severity: 'info', text: '你没有勾选任何需要遮挡的内容，打印将使用原文件' },
        claim: 'nothing_to_redact',
      })
    }

    /**
     * 做不到遮挡时的统一返回：claim='not_supported' + 具体 reason + **零文件产出**。
     *
     * 刻意不写进 warnings（warnings 空 ⇒ canRedact 仍为 true）：canRedact 的既有语义是
     * "前置条件齐备、流程可以继续"，而不是"已经遮挡"。做不到遮挡不该把用户卡死在这一步 ——
     * 决策文档 §五 要求的是"如实说明并给出路径"（改好再传 / 只打印不遮挡 / 换文字版），
     * 不是禁止打印。真正需要卡住的只有决策未完成 / 决策任务不可用两种前置条件问题。
     * 前端必须按 claim + notSupportedReason 选文案，不得因为 canRedact=true 就说"已遮挡"。
     */
    const notSupported = (
      reason: PiiRedactionNotSupportedReason,
      code: string,
      text: string,
    ): PiiRedactionSummary =>
      buildPiiRedactionSummary({
        decisionTaskId,
        findings,
        warnings: [],
        message: { code, severity: 'warning', text },
        notSupportedReason: reason,
      })

    if (sourceFile.mimeType !== 'application/pdf') {
      return notSupported(
        'unsupported_format',
        'PII_REDACT_FORMAT_UNSUPPORTED',
        '这份材料不是文字版 PDF，本机还不能在上面定位遮挡',
      )
    }

    const buffer = await this.storage.getObject(sourceFile.storageKey, sourceFile.bucket).catch(() => null)
    if (!buffer) {
      return notSupported('source_unavailable', 'PII_REDACT_SOURCE_UNAVAILABLE', '暂未读取到文件内容，请重新上传后再试')
    }

    // 重新抽取一次：既拿到与落库 boxes 同源的坐标，也拿到**只存在于内存里**的命中原文，
    // 用于遮挡后在派生件上做逐值复检（决策文档 §3.3 机器复检那一道）。
    const extraction = await extractTextForPiiScan(buffer, sourceFile.mimeType, this.ocr)
    if (extraction.outcome !== 'ok') {
      return notSupported('scanned_no_position', 'PII_REDACT_NO_POSITION', '这份是扫描件，本机还不能在上面定位遮挡')
    }
    const freshFindings = buildPiiFindingsWithValues(extraction.pages)

    // 用坐标做连接键：同一份文件的抽取是确定性的，坐标即身份，且不需要为此多存任何 PII 原文。
    const freshByKey = new Map<string, PiiFindingWithValue>()
    for (const fresh of freshFindings) freshByKey.set(findingJoinKey(fresh.type, fresh.boxes), fresh)

    const boxesToDraw: PiiBox[] = []
    const redactValues: string[] = []
    const items: PiiRedactionItemView[] = []
    let failedNoPosition = 0
    for (const finding of findings) {
      const storedBoxes = parseFindingBoxes(finding.boxesJson)
      if (finding.action !== 'redact') {
        items.push({ id: finding.id, type: finding.type, pageNumber: finding.pageNumber, requested: 'keep', applied: 'kept' })
        continue
      }
      const fresh = freshByKey.get(findingJoinKey(finding.type, storedBoxes))
      if (storedBoxes.length === 0 || !fresh) {
        failedNoPosition += 1
        items.push({
          id: finding.id,
          type: finding.type,
          pageNumber: finding.pageNumber,
          requested: 'redact',
          applied: 'failed_no_position',
        })
        continue
      }
      boxesToDraw.push(...storedBoxes)
      redactValues.push(fresh.value)
      items.push({ id: finding.id, type: finding.type, pageNumber: finding.pageNumber, requested: 'redact', applied: 'redacted' })
    }

    if (boxesToDraw.length === 0) {
      return notSupported('scanned_no_position', 'PII_REDACT_NO_POSITION', '这份材料上定位不到要遮挡的位置，本机还不能在上面遮挡')
    }

    const affectedPageCount = new Set(boxesToDraw.map((box) => box.pageNumber)).size
    if (affectedPageCount > PII_REDACT_MAX_RASTER_PAGES) {
      return notSupported(
        'too_many_pages',
        'PII_REDACT_TOO_MANY_PAGES',
        `需要遮挡的页数超过 ${PII_REDACT_MAX_RASTER_PAGES} 页，本机暂不能一次处理`,
      )
    }

    const pageTextLengths = new Map<number, number>()
    for (const page of extraction.pages) {
      if (page.pageNumber === null) continue
      pageTextLengths.set(page.pageNumber, page.text.replace(/\s/g, '').length)
    }

    const built = await buildRedactedPdf(buffer, boxesToDraw, pageTextLengths)
    if (!built.ok) {
      const map: Record<string, { reason: PiiRedactionNotSupportedReason; code: string; text: string }> = {
        encrypted: { reason: 'encrypted', code: 'PII_REDACT_ENCRYPTED', text: '这份 PDF 已加密，本机不能在上面遮挡' },
        too_many_pages: {
          reason: 'too_many_pages',
          code: 'PII_REDACT_TOO_MANY_PAGES',
          text: `需要遮挡的页数超过 ${PII_REDACT_MAX_RASTER_PAGES} 页，本机暂不能一次处理`,
        },
        render_unverified: {
          reason: 'render_unverified',
          code: 'PII_REDACT_RENDER_UNVERIFIED',
          text: '这份 PDF 的字体本机渲染不出来，继续处理会把内容弄丢，已停止并保留原文件',
        },
        output_too_large: {
          reason: 'output_too_large',
          code: 'PII_REDACT_OUTPUT_TOO_LARGE',
          text: '遮挡后的文件超出体积上限，请减少页数后再试',
        },
      }
      const mapped = map[built.reason] ?? {
        reason: 'redaction_failed' as const,
        code: 'PII_REDACT_FAILED',
        text: '遮挡处理失败，已保留原文件，请重试或换一份文字版 PDF',
      }
      return notSupported(mapped.reason, mapped.code, mapped.text)
    }

    // ── 复检：在**派生件**上重跑抽取，看这些值是否真的提不出来了（决策文档 §3.3）──────
    const reverifyExtraction = await extractTextForPiiScan(built.buffer, 'application/pdf', this.ocr)
    let reverify: PiiReverifyView
    if (reverifyExtraction.outcome === 'ok') {
      const derivedText = reverifyExtraction.pages.map((page) => page.text).join('\n')
      const remaining = redactValues.filter((value) => derivedText.includes(value)).length
      reverify = { ran: true, remainingCount: remaining, method: 'text_layer' }
    } else {
      reverify = { ran: false, remainingCount: 0, method: 'skipped' }
    }

    const uploaded = await this.files.upload({
      buffer: built.buffer,
      filename: `${sanitizeBaseName(sourceFile.filename)}-隐私遮挡.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      // 遮挡后仍是求职材料：敏感等级不低于原件，也不低于 sensitive
      // （print_doc 默认 normal，这里显式收紧，与 print-sign.service.ts 同口径）。
      sensitiveLevel: maxSensitiveLevel(sourceFile.sensitiveLevel as FileSensitiveLevel, 'sensitive'),
      uploaderId: null,
      endUserId: sourceFile.endUserId ?? undefined,
      assetCategory: 'derived',
      sourceFileId: sourceFile.id,
      createdBy: sourceFile.endUserId,
    })

    return buildPiiRedactionSummary({
      decisionTaskId,
      findings,
      warnings: reverify.ran && reverify.remainingCount > 0 ? ['PII_REDACT_RESIDUAL_DETECTED'] : [],
      message:
        reverify.ran && reverify.remainingCount > 0
          ? {
              code: 'PII_REDACT_RESIDUAL_DETECTED',
              severity: 'warning',
              text: `复检仍检出 ${reverify.remainingCount} 处未盖住，不建议直接打印`,
            }
          : {
              code: 'PII_REDACT_FILE_CREATED',
              severity: 'info',
              text: `已生成遮挡后的文件，第 ${built.rasterizedPages.join('、')} 页已转为图片，请核对预览`,
            },
      redactedFileId: uploaded.fileId,
      items,
      reverify,
      rasterizedPages: built.rasterizedPages,
      failedNoPosition,
    })
  }
}

function buildPiiRedactionSummary(args: {
  decisionTaskId: string | null
  findings: Array<{ id?: string; type?: string; pageNumber?: number | null; action: string }>
  warnings: string[]
  message: InspectionMessage
  /** 只有真正生成了派生件才传；不传即"没有产出任何文件"。 */
  redactedFileId?: string
  items?: PiiRedactionItemView[]
  reverify?: PiiReverifyView
  rasterizedPages?: number[]
  failedNoPosition?: number
  /** 显式指定 claim（目前只有 nothing_to_redact 用）；否则由下面按事实推导。 */
  claim?: PiiRedactionClaim
  notSupportedReason?: PiiRedactionNotSupportedReason
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
      ? [{ code: 'PII_DECISIONS_PENDING', severity: 'warning' as const, text: '仍有隐私片段未选择保留或遮挡，暂不能生成遮挡文件' }]
      : []),
  ]
  const reverify: PiiReverifyView = args.reverify ?? { ran: false, remainingCount: 0, method: 'skipped' }
  const items: PiiRedactionItemView[] =
    args.items ??
    // 尚未裁决的项不进 items：它既不是 redact 也不是 keep，硬塞任一取值都是在编造用户意图。
    args.findings
      .filter((finding) => finding.action === 'redact' || finding.action === 'keep')
      .map((finding) => ({
        id: finding.id ?? '',
        type: finding.type ?? '',
        pageNumber: finding.pageNumber ?? null,
        requested: finding.action === 'redact' ? ('redact' as const) : ('keep' as const),
        // 走到这里就没有生成任何文件 ⇒ 一处都没盖上。要求遮挡却没盖上，如实记为"没定位到"。
        applied: finding.action === 'redact' ? ('failed_no_position' as const) : ('kept' as const),
      }))
  const claim = args.claim ?? deriveClaim(args.redactedFileId, args.failedNoPosition ?? 0, reverify)
  return {
    // canRedact 保留原语义（前端既有分支仍在读它）：无阻塞警告即为可继续。
    canRedact: warnings.length === 0,
    redactedFileId: args.redactedFileId ?? null,
    // 见字段注释：URL 不落库，由 toTaskView 每次读取时重新签发。
    redactedFileUrl: null,
    redactedFileUrlExpiresAt: null,
    resultFileCreated: Boolean(args.redactedFileId),
    decisionTaskId: args.decisionTaskId,
    findingCount,
    redactedCount,
    keptCount,
    pendingCount,
    warnings,
    messages,
    claim,
    ...(claim === 'not_supported' && args.notSupportedReason ? { notSupportedReason: args.notSupportedReason } : {}),
    items,
    reverify,
    rasterizedPages: args.rasterizedPages ?? [],
  }
}

/**
 * claim 只由事实推导，不接受调用方自述（决策文档 §3.4：把"能说什么"强制在 API 边界上）。
 * 相对文档的取值扩展见 materials.types.ts PiiRedactionClaim 注释。
 */
function deriveClaim(
  redactedFileId: string | undefined,
  failedNoPosition: number,
  reverify: PiiReverifyView,
): PiiRedactionClaim {
  if (!redactedFileId) return 'not_supported'
  if (failedNoPosition > 0) return 'partial'
  if (!reverify.ran) return 'redacted_unverified'
  return reverify.remainingCount > 0 ? 'partial' : 'redacted_verified'
}

/** 按 (type + 坐标) 做连接键：抽取是确定性的，坐标即身份，无需为此多存任何 PII 原文。 */
function findingJoinKey(type: string, boxes: Array<Pick<PiiBox, 'pageNumber' | 'x' | 'y'>>): string {
  const parts = boxes.map((box) => `${box.pageNumber}:${box.x.toFixed(2)}:${box.y.toFixed(2)}`)
  return `${type}|${parts.join('|')}`
}

export function parseFindingBoxes(boxesJson: string | null): PiiBox[] {
  if (!boxesJson) return []
  try {
    const parsed = JSON.parse(boxesJson) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPiiBox)
  } catch {
    return []
  }
}

function isPiiBox(value: unknown): value is PiiBox {
  if (!value || typeof value !== 'object') return false
  const box = value as Record<string, unknown>
  return (
    Number.isInteger(box['pageNumber']) &&
    typeof box['x'] === 'number' &&
    typeof box['y'] === 'number' &&
    typeof box['width'] === 'number' &&
    typeof box['height'] === 'number' &&
    typeof box['pageWidth'] === 'number' &&
    typeof box['pageHeight'] === 'number'
  )
}

const SENSITIVE_ORDER: Record<FileSensitiveLevel, number> = { normal: 0, sensitive: 1, highly_sensitive: 2 }

function maxSensitiveLevel(a: FileSensitiveLevel, b: FileSensitiveLevel): FileSensitiveLevel {
  return (SENSITIVE_ORDER[a] ?? 0) >= SENSITIVE_ORDER[b] ? a : b
}

/** 派生件文件名基底：去掉扩展名与路径分隔符，避免把用户原始文件名原样拼进新文件名。 */
function sanitizeBaseName(filename: string): string {
  const withoutExt = filename.replace(/\.[^./\\]+$/, '')
  const cleaned = withoutExt.replace(/[/\\:*?"<>|]/g, '_').trim()
  return cleaned.slice(0, 60) || '材料'
}

/** 遮挡派生件签名 URL 的有效期（与 print-sign / print-conversion 输出链接同口径）。 */
const REDACTED_FILE_URL_TTL_MS = 30 * 60 * 1000

/**
 * 每次读取任务时为遮挡派生件重新签发访问链接。
 *
 * 调用点在 MaterialsService.getTask → toTaskView，鉴权（本人 / 匿名任务 token）已在上游断言过，
 * 这里只负责签发。签名 URL 不落库，所以不会出现任务仍在 24 小时有效期内、链接却早已过期的情况。
 */
export function injectRedactedFileUrl(
  kind: string,
  result: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (kind !== 'pii_redact' || !result) return result
  const checks = result['checks']
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) return result
  const record = checks as Record<string, unknown>
  const fileId = record['redactedFileId']
  if (typeof fileId !== 'string' || !fileId) {
    return { ...result, checks: { ...record, redactedFileUrl: null, redactedFileUrlExpiresAt: null } }
  }
  const signed = signFileUrl(fileId, REDACTED_FILE_URL_TTL_MS)
  return {
    ...result,
    checks: { ...record, redactedFileUrl: signed.url, redactedFileUrlExpiresAt: signed.expiresAt.toISOString() },
  }
}
