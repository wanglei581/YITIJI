// ============================================================
// 自我探索 · 倾向参考 —— 服务端业务编排（v1）
//
// 合规口径（与 docs/compliance/compliance-boundary.md §4.5 同档）：
// - 复用 AiResumeResult 表，kind='self_assessment'；零 Prisma migration。
// - 答案原文不入库：payloadJson.persist 仅含 answersHash + dimensions + summary + note；
//   答案原文在评分后立即丢弃（不写日志 / 不送 LLM prompt / 不写监控）。
// - LLM 仅生成自然语言解读（note / summary），禁用"适合 / 不适合 / 推荐岗位"等指令性词。
// - 命中 LLM 合规词 → 丢弃该条 note；命中"适合 / 不适合"级 → 整体拒答。
// - 仅本人 / 匿名 token 持有者可访问；匿名结果不留库（仅会话状态）。
// - 撤回 = 物理删除 answersHash / 维度 / summary；保留行用于删除审计。
// - 打印文件名带 -self-assessment 前缀；不进分享用途的 FileObject。
// ============================================================

import { Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FilesService } from '../../files/files.service'
import { signFileUrl } from '../../files/signing'
import { SELF_ASSESSMENT_QUESTIONS_V1 } from './self-assessment-questions'
import type { SelfAssessmentAnswerV1, SelfAssessmentDimensionResult } from './self-assessment.types'
import { LlmSelfAssessmentService } from './llm-self-assessment.service'
import { SelfAssessmentPdfService } from './self-assessment-pdf.service'
import { scoreSelfAssessment } from './self-assessment-scoring'
import { AiLogService } from '../ai-log.service'

const RESULT_TTL_HOURS = (() => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

export interface SelfAssessmentRequester {
  endUserId: string | null
  accessToken: string | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function tokenMatches(token: string | null, expectedHash: string | null): boolean {
  if (!token || !expectedHash) return false
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

interface StoredSelfAssessment {
  version: 'v1'
  answersHash: string
  dimensions: SelfAssessmentDimensionResult[]
  summary: string | null
  aiProvider?: string | null
  completedAt: string
  /** 撤回时间戳；存在则视为已删除（payload 字段已物理清空）。 */
  deletedAt?: string
}

export interface SelfAssessmentSubmitInput {
  answers: SelfAssessmentAnswerV1[]
  consent: { nonSensitive: boolean; sensitive: boolean }
}

export interface SelfAssessmentSubmitOutput {
  taskId: string
  status: 'completed' | 'rejected'
  failReason?: string
  dimensions: SelfAssessmentDimensionResult[]
  summary: string | null
  providerName?: string
  /** 匿名结果一次性访问令牌（仅匿名提交响应返回一次）。 */
  accessToken?: string
  expiresAt: string | null
}

@Injectable()
export class SelfAssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmSelfAssessmentService,
    private readonly pdf: SelfAssessmentPdfService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly log: AiLogService,
  ) {}

  /**
   * 提交答案 → 纯函数评分 → LLM 解读 → 落库 → 审计。
   * 匿名用户铸造一次性 accessTokenHash（明文仅返回一次）。
   */
  async submit(requester: SelfAssessmentRequester, input: SelfAssessmentSubmitInput): Promise<SelfAssessmentSubmitOutput> {
    if (!input.consent.nonSensitive) {
      throw new NotFoundException({
        error: { code: 'SELF_ASSESSMENT_CONSENT_REQUIRED', message: '请勾选非敏感题作答同意后再提交' },
      })
    }
    const t0 = Date.now()
    const consent = {
      nonSensitive: true,
      sensitive: input.consent.sensitive === true,
    }

    // 1) 纯函数评分（不可逆、原文不入库）
    const scored = scoreSelfAssessment({ answers: input.answers, questions: SELF_ASSESSMENT_QUESTIONS_V1 })

    // 2) 匿名 session 模式 / 会员模式 → accessToken 决策（仅匿名铸造；明文仅返回一次）
    const isAnonymous = !requester.endUserId
    const accessToken = isAnonymous ? `sa-${randomBytes(20).toString('hex')}` : null

    // 3) LLM 解读（仅本人作答 + 维度分；不附答案原文）
    let dimensions: SelfAssessmentDimensionResult[] = scored.dimensions
    let summary: string | null = null
    let providerName: string | null = null
    let overallRejectReason: string | null = null
    let llmErrorCode: string | undefined

    try {
      const llmResult = await this.llm.summarize({
        scored: { dimensions: scored.dimensions, summary: null },
        consent,
      })
      if (llmResult.status === 'rejected') {
        overallRejectReason = llmResult.failReason ?? 'LLM 解读命中合规词'
        llmErrorCode = 'COMPLIANCE_REJECT'
      } else {
        dimensions = llmResult.dimensions
        summary = llmResult.summary
        providerName = llmResult.providerName
      }
    } catch (err) {
      overallRejectReason = err instanceof Error ? err.message : 'LLM 调用失败'
      llmErrorCode = 'LLM_ERROR'
    }
    this.log.record({
      taskId: `sa-${Date.now()}-${randomBytes(4).toString('hex')}`,
      provider: providerName ?? 'llm',
      operation: 'selfAssessment',
      latencyMs: Date.now() - t0,
      status: overallRejectReason ? 'failed' : 'success',
      ...(llmErrorCode ? { errorCode: llmErrorCode } : {}),
    })

    // 4) 落库（仅会员：endUserId 归属；匿名不留库，会话由 token 持有）
    const taskId = `sa-${randomBytes(12).toString('hex')}`
    const expiresAt = new Date(Date.now() + RESULT_TTL_HOURS * 60 * 60 * 1000)
    const completedAt = new Date().toISOString()

    const persisted: StoredSelfAssessment = {
      version: 'v1',
      answersHash: scored.answersHash,
      dimensions,
      summary,
      aiProvider: providerName,
      completedAt,
    }

    if (!isAnonymous && !overallRejectReason) {
      await this.prisma.aiResumeResult.create({
        data: {
          taskId,
          kind: 'self_assessment',
          status: 'completed',
          provider: providerName ?? 'llm',
          payloadJson: JSON.stringify(persisted),
          endUserId: requester.endUserId,
          accessTokenHash: null,
          expiresAt,
        },
      })
    }

    await this.audit.write({
      actorId: null,
      actorRole: requester.endUserId ? 'enduser' : 'kiosk',
      action: 'resume.self_assessment_create',
      targetType: 'ai_task',
      targetId: taskId,
      payload: {
        hasEndUser: !!requester.endUserId,
        isAnonymous,
        dimensionCount: scored.dimensions.length,
        unmatchedCount: scored.unmatched.length,
        status: overallRejectReason ? 'rejected' : 'completed',
      },
      ipAddress: null, userAgent: null, requestId: null,
    })

    if (overallRejectReason) {
      return {
        taskId,
        status: 'rejected',
        failReason: overallRejectReason,
        dimensions: scored.dimensions.map((d) => ({ ...d, note: null })),
        summary: null,
        expiresAt: null,
      }
    }

    return {
      taskId,
      status: 'completed',
      dimensions,
      summary,
      providerName: providerName ?? undefined,
      ...(accessToken ? { accessToken } : {}),
      expiresAt: expiresAt.toISOString(),
    }
  }

  /** 读回本人历史结果（仅会员；匿名不留库）。 */
  async getLatest(taskId: string, requester: SelfAssessmentRequester) {
    const row = await this.loadAuthorizedRow(taskId, requester)
    const stored = JSON.parse(row.payloadJson) as StoredSelfAssessment
    if (stored.deletedAt) {
      throw new NotFoundException({
        error: { code: 'SELF_ASSESSMENT_WITHDRAWN', message: '本次自我探索已撤回' },
      })
    }
    await this.audit.write({
      actorId: null,
      actorRole: requester.endUserId ? 'enduser' : 'kiosk',
      action: 'resume.self_assessment_view',
      targetType: 'ai_task',
      targetId: taskId,
      payload: { hasEndUser: !!requester.endUserId },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return {
      taskId,
      status: 'completed' as const,
      dimensions: stored.dimensions,
      summary: stored.summary,
      providerName: stored.aiProvider ?? undefined,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    }
  }

  /** 物理删除 payload 字段（保留行用于审计）；返回 { deleted: true }。 */
  async withdraw(taskId: string, requester: SelfAssessmentRequester) {
    const row = await this.loadAuthorizedRow(taskId, requester)
    const empty: StoredSelfAssessment = {
      version: 'v1',
      answersHash: '',
      dimensions: [],
      summary: null,
      aiProvider: null,
      completedAt: '',
      deletedAt: new Date().toISOString(),
    }
    await this.prisma.aiResumeResult.update({
      where: { id: row.id },
      data: { payloadJson: JSON.stringify(empty), status: 'completed' },
    })
    await this.audit.write({
      actorId: null,
      actorRole: requester.endUserId ? 'enduser' : 'kiosk',
      action: 'resume.self_assessment_withdraw',
      targetType: 'ai_task',
      targetId: taskId,
      payload: { hasEndUser: !!requester.endUserId },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return { deleted: true }
  }

  /**
   * 自我探索报告 PDF（不附加到简历；append 模式由 print.service 提供）。
   */
  async printReport(taskId: string, requester: SelfAssessmentRequester) {
    const row = await this.loadAuthorizedRow(taskId, requester)
    const stored = JSON.parse(row.payloadJson) as StoredSelfAssessment
    if (stored.deletedAt) {
      throw new NotFoundException({
        error: { code: 'SELF_ASSESSMENT_WITHDRAWN', message: '本次自我探索已撤回，无法打印' },
      })
    }
    const { buffer, pageCount } = await this.renderReportForAppend({
      date: stored.completedAt.slice(0, 10),
      dimensions: stored.dimensions,
      summary: stored.summary,
      appendixDisclaimer: undefined,
    })
    const uploaded = await this.files.upload({
      buffer,
      filename: `self-assessment-${taskId}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: requester.endUserId,
      createdBy: 'self_assessment',
    })
    await this.audit.write({
      actorId: null,
      actorRole: requester.endUserId ? 'enduser' : 'kiosk',
      action: 'resume.self_assessment_print',
      targetType: 'ai_task',
      targetId: taskId,
      payload: { fileId: uploaded.fileId, pageCount },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return {
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
   * 渲染自我探索报告 PDF（独立报告 / 附加到简历场景共用）。
   * appendixDisclaimer = 附加场景下追加的「本附录基于本人作答」免责。
   */
  async renderReportForAppend(meta: {
    date: string
    dimensions: SelfAssessmentDimensionResult[]
    summary: string | null
    appendixDisclaimer: string | undefined
  }): Promise<{ buffer: Buffer; pageCount: number }> {
    return this.pdf.render(meta)
  }

  /** 归属门禁：会员按 endUserId；匿名按 accessTokenHash。 */
  private async loadAuthorizedRow(taskId: string, requester: SelfAssessmentRequester) {
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
    return row
  }
}
