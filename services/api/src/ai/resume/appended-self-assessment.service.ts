// ============================================================
// 自我探索 · 倾向参考 —— 附加到简历 PDF 合并服务（v1）
//
// 合规口径（与 docs/compliance/compliance-boundary.md §4.5 同档）：
// - 合并 PDF **仅本人查阅 / 打印**：不进分享用途的 FileObject（不上传分享桶）；
// - 文件名 self-assessment-append-<taskId>.pdf；
// - 合并 PDF 显著免责声明（附录段头部 / 维度卡片底部）。
// - 复用 print-sign.service / print-conversion.service 的 pdf-lib 合并逻辑；
//   这里直接走 pdf-lib appendPages。
// - 失败时抛 NotFoundException / BadRequestException，不静默回退。
// ============================================================

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PDFDocument } from 'pdf-lib'
import { PrismaService } from '../../prisma/prisma.service'
import { FilesService } from '../../files/files.service'
import { AuditService } from '../../audit/audit.service'
import {
  SelfAssessmentService,
  tokenMatches,
  type AuditContext,
  EMPTY_AUDIT_CONTEXT,
} from './self-assessment.service'
import {
  SELF_ASSESSMENT_DIMENSIONS,
  type SelfAssessmentDimensionKey,
  type SelfAssessmentDimensionResult,
} from './self-assessment.types'

const DISCLAIMER_TEXT =
  '本附录基于本人作答的自我探索倾向，仅作为自助参考；不含临床 / 心理 / 人格诊断；' +
  '不代任何招聘结果、能力证明或心理评估。'

@Injectable()
export class AppendedSelfAssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly selfAssessment: SelfAssessmentService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 把自我探索报告追加到主简历 PDF 之后，生成新的可打印 PDF。
   * 仅本人持有 taskId + accessToken（或 endUserId）时可调用。
   */
  async appendToResume(opts: {
    taskId: string
    requester: { endUserId: string | null; accessToken: string | null }
    resumeFileId: string
    auditCtx?: AuditContext
  }): Promise<{
    fileId: string
    filename: string
    sizeBytes: number
    pageCount: number
    signedUrl: string
    expiresAt: string
  }> {
    const ctx = opts.auditCtx ?? EMPTY_AUDIT_CONTEXT
    // 1) 读取自我探索结果（已含归属校验）
    const stored = await this.loadStored(opts.taskId, opts.requester)

    // 2) 读取主简历 PDF（由 PrintConfirmPage 提前验签后传入 fileId）
    const resumeRow = await this.prisma.fileObject.findUnique({
      where: { id: opts.resumeFileId },
      select: { id: true, filename: true, mimeType: true, endUserId: true, deletedAt: true },
    })
    if (!resumeRow || resumeRow.deletedAt) {
      throw new NotFoundException({
        error: { code: 'RESUME_FILE_NOT_FOUND', message: '简历文件不存在或已删除' },
      })
    }
    if (resumeRow.mimeType !== 'application/pdf') {
      throw new BadRequestException({
        error: { code: 'RESUME_FILE_NOT_PDF', message: '简历文件必须是 PDF 格式' },
      })
    }
    if (resumeRow.endUserId && opts.requester.endUserId !== resumeRow.endUserId) {
      throw new NotFoundException({
        error: { code: 'RESUME_FILE_NOT_FOUND', message: '简历文件不存在' },
      })
    }

    // 3) 加载主简历 PDF buffer（通过 FilesService 走对象存储下载通道）
    const resumeBundle = await this.files.readContent(opts.resumeFileId)

    // 4) 渲染自我探索报告 PDF → buffer
    const { buffer: saBuffer, pageCount: saPageCount } = await this.selfAssessment.renderReportForAppend({
      date: stored.completedAt.slice(0, 10),
      dimensions: stored.dimensions,
      summary: stored.summary,
      appendixDisclaimer: DISCLAIMER_TEXT,
    })

    // 5) pdf-lib 合并：resume + 自我探索
    const merged = await PDFDocument.load(resumeBundle.buffer, { ignoreEncryption: true })
    const assessment = await PDFDocument.load(saBuffer, { ignoreEncryption: true })
    const copied = await merged.copyPages(assessment, assessment.getPageIndices())
    copied.forEach((p) => merged.addPage(p))
    const out = await merged.save({ useObjectStreams: false })

    // 6) 上传合并后的 PDF（仅本人打印用途，不进分享用途）
    const filename = `self-assessment-append-${opts.taskId}.pdf`
    const uploaded = await this.files.upload({
      buffer: Buffer.from(out),
      filename,
      mimeType: 'application/pdf',
      // §1.2: 合并 PDF 走 self_assessment_report 用途,触发 sensitive 留存/标签,
      //       合并 PDF 含本人自助倾向摘要,不能挂普通 print_doc(normal)。
      purpose: 'self_assessment_report',
      uploaderId: null,
      endUserId: opts.requester.endUserId,
      createdBy: 'self_assessment_append',
    })

    // 7) 审计：本次合并是「打印前的合并动作」，含 taskId / fileId / saPageCount
    await this.audit.write({
      actorId: null,
      actorRole: opts.requester.endUserId ? 'enduser' : 'kiosk',
      action: 'resume.self_assessment_print',
      targetType: 'ai_task',
      targetId: opts.taskId,
      payload: {
        mode: 'append',
        resumeFileId: opts.resumeFileId,
        mergedFileId: uploaded.fileId,
        saPageCount,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    return {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      sizeBytes: uploaded.sizeBytes,
      pageCount: saPageCount,
      signedUrl: uploaded.signedUrl,
      expiresAt: uploaded.signedUrlExpiresAt,
    }
  }

  /** 读取自我探索已存数据（含归属校验）。 */
  private async loadStored(taskId: string, requester: { endUserId: string | null; accessToken: string | null }) {
    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: 'self_assessment' } },
      select: { id: true, endUserId: true, accessTokenHash: true, expiresAt: true, payloadJson: true },
    })
    const notFound = () =>
      new NotFoundException({ error: { code: 'SELF_ASSESSMENT_NOT_FOUND', message: '自我探索记录不存在或已过期' } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) throw notFound()
    if (row.endUserId) {
      if (requester.endUserId !== row.endUserId) throw notFound()
    } else {
      if (!row.accessTokenHash || !tokenMatches(requester.accessToken, row.accessTokenHash)) throw notFound()
    }
    const parsed = JSON.parse(row.payloadJson) as {
      answersHash?: string
      dimensions?: Array<{ key: string; label: string; strength: number; note: string | null; evidenceQuestionIdx?: number[] }>
      summary?: string | null
      completedAt?: string
      deletedAt?: string
    }
    if (parsed.deletedAt) throw notFound()
    const validKeys = new Set(SELF_ASSESSMENT_DIMENSIONS.map((d) => d.key))
    const dims = (parsed.dimensions ?? [])
      .filter((d) => validKeys.has(d.key as never))
      // §1.5: payloadJson 是不可信 JSON,strength 在落库前已 clamp 成 0..5 离散值;
      //       这里用 typeguard 拒越界 + 校验整型,不再做二次 round/clamp 兜底
      //       (round/clamp 会让上游 7.5 等异常值「默默降级」,破坏 SSOT)。
      //       任何越界 strength 一律丢弃整条 dimension。
      .map((d): SelfAssessmentDimensionResult | null => {
        const n = Number(d.strength)
        if (!Number.isInteger(n)) return null
        if (n < 0 || n > 5) return null
        const strength = n as 0 | 1 | 2 | 3 | 4 | 5
        return {
          key: d.key as SelfAssessmentDimensionKey,
          label: d.label,
          strength,
          note: d.note ?? null,
          evidenceQuestionIdx: d.evidenceQuestionIdx ?? [],
        }
      })
      .filter((d): d is SelfAssessmentDimensionResult => d !== null)
    return {
      answersHash: parsed.answersHash ?? '',
      dimensions: dims,
      summary: parsed.summary ?? null,
      completedAt: parsed.completedAt ?? new Date().toISOString(),
    }
  }
}
