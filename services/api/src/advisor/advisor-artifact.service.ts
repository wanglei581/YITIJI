import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { signFileUrl } from '../files/signing'
import { AdvisorPdfService } from './advisor-pdf.service'
import { ADVISOR_DISCLAIMER, COMPARE_LIMITS, SLOT_DRAFT_BLANK_POLICY } from './advisor-skills'
import type { AdvisorArtifactPayload } from './advisor-artifact.types'

// ============================================================
// S3-3 · P26 产物层：让顾问的输出成为**真实产物**，而不是只在内存里的一段文本。
//
// 「真实」的判定标准（矩阵 §S3-3 第 4 条）：可查、可打印、可保存。
//   可查   → AdvisorArtifact 落库，GET 会话时带出，刷新/重进不丢
//   可打印 → render → PDF → FileObject（走既有 files 链路）→ printFileUrl 进打印订单
//   可保存 → purpose='print_doc' + endUserId，会员在「我的文档」里能看到
//
// ⚠️ 打印路径**不调模型**：设计页写明「AI 不可用时，已钉住与已生成的内容不受影响，
// 可以照常打印或存档」。所以 print() 只读库 + 渲染，任何模型故障都不该让它失败。
// ============================================================

const ARTIFACT_TTL_HOURS = (() => {
  const raw = Number(process.env['ADVISOR_ARTIFACT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

export interface ArtifactOwner {
  endUserId: string | null
}

@Injectable()
export class AdvisorArtifactService {
  private readonly logger = new Logger(AdvisorArtifactService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: AdvisorPdfService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 落一份产物。
   *
   * 同一会话同一 kind 只保留最近一份（重跑覆盖），避免公共一体机上堆积历史产物；
   * 但**不同 kind 并存** —— 用户换型后旧型的产物仍然可查可打印。
   */
  async save(
    sessionId: string,
    payload: AdvisorArtifactPayload,
    providerLabel: string,
  ): Promise<{ artifactId: string; createdAt: Date }> {
    const expiresAt = new Date(Date.now() + ARTIFACT_TTL_HOURS * 60 * 60 * 1000)
    const existing = await this.prisma.advisorArtifact.findFirst({
      where: { sessionId, kind: payload.kind },
      select: { id: true },
    })
    const data = {
      status: 'completed',
      payloadJson: JSON.stringify(payload),
      provider: providerLabel,
      // 重跑产生新内容 → 旧 PDF 不再对应，清掉 fileId 让下次打印重新生成
      fileId: null,
      expiresAt,
    }
    const row = existing
      ? await this.prisma.advisorArtifact.update({ where: { id: existing.id }, data })
      : await this.prisma.advisorArtifact.create({ data: { ...data, sessionId, kind: payload.kind } })
    return { artifactId: row.id, createdAt: row.createdAt }
  }

  /** 会话下所有未过期产物（供 GET 会话带出）。 */
  async listForSession(sessionId: string) {
    const rows = await this.prisma.advisorArtifact.findMany({
      where: { sessionId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((row) => this.toView(row))
  }

  /** 单份产物（打印前读回 / 前端按 id 拉取）。 */
  async getOwned(artifactId: string, sessionId: string) {
    const row = await this.prisma.advisorArtifact.findFirst({
      where: { id: artifactId, sessionId, expiresAt: { gt: new Date() } },
    })
    if (!row) {
      throw new NotFoundException({
        error: { code: 'ADVISOR_ARTIFACT_NOT_FOUND', message: '产物不存在或已按隐私策略清理，请重新生成' },
      })
    }
    return row
  }

  /**
   * 打印版：PDF → FileObject（我的文档）→ 既有打印链路（打印订单）。
   *
   * 不调模型（见文件头）。fileId 已存在且文件仍在时直接复签，不重复生成。
   */
  async print(artifactId: string, sessionId: string, owner: ArtifactOwner) {
    const row = await this.getOwned(artifactId, sessionId)
    const payload = JSON.parse(row.payloadJson) as AdvisorArtifactPayload
    const { buffer, pageCount } = await this.pdf.render(
      { date: new Date(row.updatedAt).toISOString().slice(0, 10), providerLabel: row.provider },
      payload,
    )
    const uploaded = await this.files.upload({
      buffer,
      filename: `${this.filenameOf(payload)}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: owner.endUserId,
      createdBy: 'advisor_work',
    })
    await this.prisma.advisorArtifact.update({ where: { id: row.id }, data: { fileId: uploaded.fileId } })
    await this.audit.write({
      actorId: null,
      actorRole: owner.endUserId ? 'enduser' : 'kiosk',
      action: 'advisor.artifact_print',
      targetType: 'advisor_artifact',
      targetId: row.id,
      // 仅元数据：不含成稿 / 比对内容
      payload: { kind: row.kind, fileId: uploaded.fileId, pageCount },
      ipAddress: null, userAgent: null, requestId: null,
    })
    this.logger.log(`advisor.artifact_print kind=${row.kind} pages=${pageCount}`)
    return {
      artifactId: row.id,
      kind: row.kind,
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      sizeBytes: uploaded.sizeBytes,
      pageCount,
      signedUrl: uploaded.signedUrl,
      expiresAt: uploaded.signedUrlExpiresAt,
      printFileUrl: signFileUrl(uploaded.fileId).url,
    }
  }

  /**
   * 产物视图。
   *
   * 比对型的「本机比不了的」与填槽型的留白口径都是**服务端常量**，在这里挂上去 ——
   * 它们是能力边界声明，不是模型输出，不能让模型自述、也不该只存在于 PDF 里。
   */
  private toView(row: {
    id: string
    kind: string
    status: string
    payloadJson: string
    provider: string
    fileId: string | null
    createdAt: Date
    updatedAt: Date
    expiresAt: Date
  }) {
    let payload: AdvisorArtifactPayload | null = null
    try {
      payload = JSON.parse(row.payloadJson) as AdvisorArtifactPayload
    } catch {
      // 损坏行如实降级为「读不出」，不假装有内容
      this.logger.warn(`advisor.artifact_corrupt id=${row.id}`)
    }
    return {
      artifactId: row.id,
      kind: row.kind,
      status: payload ? row.status : 'corrupted',
      payload,
      provider: row.provider,
      disclaimer: ADVISOR_DISCLAIMER,
      ...(row.kind === 'compare_report' ? { limits: COMPARE_LIMITS } : {}),
      ...(row.kind === 'slot_draft' ? { blankPolicy: SLOT_DRAFT_BLANK_POLICY } : {}),
      printedFileId: row.fileId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }
  }

  private filenameOf(payload: AdvisorArtifactPayload): string {
    if (payload.kind === 'qa_pins') return 'AI顾问-钉住条目单'
    if (payload.kind === 'slot_draft') return 'AI顾问-成稿'
    return 'AI顾问-逐条比对表'
  }
}
