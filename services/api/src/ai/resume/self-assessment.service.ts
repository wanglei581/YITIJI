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

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FilesService } from '../../files/files.service'
import { signFileUrl } from '../../files/signing'
import { SELF_ASSESSMENT_QUESTIONS_V1 } from './self-assessment-questions'
import type { SelfAssessmentAnswerV1, SelfAssessmentDimensionResult } from './self-assessment.types'
import { SELF_ASSESSMENT_CONSENT_VERSION } from './self-assessment.types'
import { LlmSelfAssessmentService } from './llm-self-assessment.service'
import { SelfAssessmentPdfService } from './self-assessment-pdf.service'
import { scoreSelfAssessment } from './self-assessment-scoring'
import { AiLogService, AiUsageAccumulator } from '../ai-log.service'

const RESULT_TTL_HOURS = (() => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

const ANON_TOKEN_BYTES = 20
const ANON_TASKID_BYTES = 12

export interface AuditContext {
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
}

export const EMPTY_AUDIT_CONTEXT: AuditContext = {
  ipAddress: null,
  userAgent: null,
  requestId: null,
}

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
  /**
   * 本次作答同意的**说明版本号**。`null` = 未版本化同意（旧前端未上报版本）。
   * 存的是「同意了哪个版本」而不是「同意过」：改版之后，靠 `=== 当前版本` 判定，
   * 旧版本同意不会被当成新版本同意。
   */
  consentVersion?: string | null
  /** 勾选时刻（ISO8601）；未版本化同意时缺省。 */
  consentedAt?: string | null
  /** 撤回时间戳；存在则视为已删除（payload 字段已物理清空）。 */
  deletedAt?: string
}

export interface SelfAssessmentSubmitInput {
  answers: SelfAssessmentAnswerV1[]
  consent: { nonSensitive: boolean; sensitive: boolean; consentVersion?: string }
}

/**
 * 判定一条已存同意在**当前**说明版本下是否仍然有效。
 *
 * 这是整条版本化同意链路的判定点，口径与 `member-privacy.service.ts`
 * 的 `consentStatus()` 完全一致：**严格相等，不做前缀 / 大小写 / 语义化版本兼容**。
 * 任何「旧版本也算数」的放宽，都会让改版后的同意书自动继承旧同意。
 * `null`（未版本化）同样判 false —— 没有版本的同意无法证明它覆盖当前说明。
 */
export function isConsentCurrent(storedVersion: string | null | undefined): boolean {
  return storedVersion === SELF_ASSESSMENT_CONSENT_VERSION
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
  /** 实际存下的同意版本；null = 未版本化同意（不冒充当前版本）。 */
  consentVersion: string | null
  /** 勾选时刻（ISO8601）；未版本化同意时为 null。 */
  consentedAt: string | null
  /** 存下的版本是否仍等于当前版本；false ⇒ 前端必须请用户重新确认。 */
  consentCurrent: boolean
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
  async submit(
    requester: SelfAssessmentRequester,
    input: SelfAssessmentSubmitInput,
    ctx: AuditContext = EMPTY_AUDIT_CONTEXT,
  ): Promise<SelfAssessmentSubmitOutput> {
    if (!input.consent.nonSensitive) {
      throw new NotFoundException({
        error: { code: 'SELF_ASSESSMENT_CONSENT_REQUIRED', message: '请勾选非敏感题作答同意后再提交' },
      })
    }

    // ── 版本化同意门禁 ────────────────────────────────────────────────
    // 客户端**显式**带上一个非当前版本 ⇒ 它同意的是另一份说明，直接拒绝并要求
    // 重新确认。这里绝不能「就近升级成当前版本」放行 —— 那正是把旧同意当成
    // 新同意的实现方式。
    //
    // 版本号**缺省**（现网 S2-7 前端只发两个布尔）⇒ 如实记为 null「未版本化同意」，
    // 同样**不补写当前版本**。null 在 `isConsentCurrent()` 下判 false，
    // 读回时 `consentCurrent:false`，前端据此请用户重新确认。
    const suppliedVersion =
      typeof input.consent.consentVersion === 'string' ? input.consent.consentVersion.trim() : ''
    if (suppliedVersion && suppliedVersion !== SELF_ASSESSMENT_CONSENT_VERSION) {
      throw new BadRequestException({
        error: {
          code: 'SELF_ASSESSMENT_CONSENT_VERSION_STALE',
          message: '知情同意说明已更新，请重新阅读并确认后再提交',
        },
      })
    }
    const consentVersion: string | null = suppliedVersion || null
    const consentedAt: string | null = consentVersion ? new Date().toISOString() : null

    const t0 = Date.now()

    // taskId 在 t0 之后立刻提取,保证 ai_service_log / audit_log / ai_resume_result 三方一致
    const isAnonymous = !requester.endUserId
    const taskId = `sa-${randomBytes(ANON_TASKID_BYTES).toString('hex')}`
    const accessToken = isAnonymous ? `sa-${randomBytes(ANON_TOKEN_BYTES).toString('hex')}` : null

    const consent = {
      nonSensitive: true,
      sensitive: input.consent.sensitive === true,
    }

    // 1) 纯函数评分（不可逆、原文不入库）
    const scored = scoreSelfAssessment({ answers: input.answers, questions: SELF_ASSESSMENT_QUESTIONS_V1 })

    // 2) 匿名 session 模式 / 会员模式 → accessToken 决策（仅匿名铸造；明文仅返回一次）

    // 3) LLM 解读（仅本人作答 + 维度分；不附答案原文）
    let dimensions: SelfAssessmentDimensionResult[] = scored.dimensions
    let summary: string | null = null
    let providerName: string | null = null
    let overallRejectReason: string | null = null
    let llmErrorCode: string | undefined

    // selfAssessment 是**付费**的 token 计费调用。此前这里不收集 token usage，
    // 落账恒为「无 token」，estimateCostCny 返回 undefined → 库里 estimatedCostCny=null，
    // 而 Admin 把 selfAssessment 当 token 计费能力渲染成 ¥0.0000 + 「按 token 用量」，
    // 等于对一次真实花钱的调用谎称免费。这里改为与 careerPlan / fairVisitPlan 同一套
    // AiUsageAccumulator 口径：真实 token 落账，成本按 provider 单价估算。
    const usage = new AiUsageAccumulator()
    try {
      const llmResult = await this.llm.summarize({
        scored: { dimensions: scored.dimensions, summary: null },
        consent,
        onLlmCall: usage.add,
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
    // callCount === 0 → 一次都没真的打到模型（未配置 / 已降级），不落账，
    // 免得用一堆零成本行把「分能力成本」稀释成看起来很便宜。
    if (usage.callCount > 0) {
      this.log.record({
        taskId,
        provider: usage.provider ?? providerName ?? 'llm',
        operation: 'selfAssessment',
        latencyMs: Date.now() - t0,
        status: overallRejectReason ? 'failed' : 'success',
        tokenUsage: usage.tokenUsage,
        ...(llmErrorCode ? { errorCode: llmErrorCode } : {}),
      })
    }

    // 4) 落库（仅会员：endUserId 归属；匿名不留库，会话由 token 持有）
    const expiresAt = new Date(Date.now() + RESULT_TTL_HOURS * 60 * 60 * 1000)
    const completedAt = new Date().toISOString()

    const persisted: StoredSelfAssessment = {
      version: 'v1',
      answersHash: scored.answersHash,
      dimensions,
      summary,
      aiProvider: providerName,
      completedAt,
      consentVersion,
      consentedAt,
    }

    if (!overallRejectReason) {
      // §1.3: 匿名用户的 self-assessment 也落 aiResumeResult(用 accessTokenHash 持有),
      //       这样 MyAiRecords(本人 endUserId 查询)能正确反映;匿名用户升级到本人后还能
      //       据 taskId 回溯。会话级持久:同 parse 类的匿名模式。
      //       拒答场景保留最小行(answersHash + 拒答状态 + accessTokenHash),方便未来查阅。
      await this.prisma.aiResumeResult.create({
        data: {
          taskId,
          kind: 'self_assessment',
          status: 'completed',
          provider: providerName ?? 'llm',
          payloadJson: JSON.stringify(persisted),
          endUserId: requester.endUserId,
          accessTokenHash: accessToken ? hashToken(accessToken) : null,
          expiresAt,
        },
      })
    } else if (isAnonymous && accessToken) {
      // 拒答也保留最小行,用于未来本人端"拒答历史"展示;带 accessTokenHash 满足 read 校验。
      const rejectedMinimal: StoredSelfAssessment = {
        version: 'v1',
        answersHash: scored.answersHash,
        dimensions: [],
        summary: null,
        aiProvider: providerName,
        completedAt,
        consentVersion,
        consentedAt,
      }
      await this.prisma.aiResumeResult.create({
        data: {
          taskId,
          kind: 'self_assessment',
          status: 'rejected',
          provider: providerName ?? 'llm',
          payloadJson: JSON.stringify(rejectedMinimal),
          endUserId: null,
          accessTokenHash: hashToken(accessToken),
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
        // 只记「同意了哪个版本」这一事实；作答内容 / 选项 / 原文一律不进审计正文。
        consentVersion,
        consentVersioned: consentVersion !== null,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    if (overallRejectReason) {
      return {
        taskId,
        status: 'rejected',
        failReason: overallRejectReason,
        dimensions: scored.dimensions.map((d) => ({ ...d, note: null })),
        summary: null,
        expiresAt: null,
        consentVersion,
        consentedAt,
        consentCurrent: isConsentCurrent(consentVersion),
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
      consentVersion,
      consentedAt,
      consentCurrent: isConsentCurrent(consentVersion),
    }
  }

  /** 读回本人历史结果（仅会员；匿名不留库）。 */
  async getLatest(
    taskId: string,
    requester: SelfAssessmentRequester,
    ctx: AuditContext = EMPTY_AUDIT_CONTEXT,
  ) {
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
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })
    // 回读只回**存下来的事实**：存的是哪个版本就回哪个版本，null 就回 null。
    // 绝不用「当前版本」填充空值 —— 那等于把一条没有版本的旧同意
    // 伪装成对当前说明的同意。consentCurrent 由严格相等判定，供前端决定是否重新确认。
    const storedConsentVersion = stored.consentVersion ?? null
    return {
      taskId,
      status: 'completed' as const,
      dimensions: stored.dimensions,
      summary: stored.summary,
      providerName: stored.aiProvider ?? undefined,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      consentVersion: storedConsentVersion,
      consentedAt: stored.consentedAt ?? null,
      consentCurrent: isConsentCurrent(storedConsentVersion),
    }
  }

  /** 物理删除 payload 字段（保留行用于审计）；返回 { deleted: true }。 */
  async withdraw(
    taskId: string,
    requester: SelfAssessmentRequester,
    ctx: AuditContext = EMPTY_AUDIT_CONTEXT,
  ) {
    const row = await this.loadAuthorizedRow(taskId, requester)
    // 撤回 = 物理清空 payload 字段（含同意版本）。
    // 「这个人在哪个版本下同意过」的审计证据不依赖本行：它在撤回前就已经写进
    // `resume.self_assessment_create` 审计事件，撤回不会把它一起抹掉。
    const empty: StoredSelfAssessment = {
      version: 'v1',
      answersHash: '',
      dimensions: [],
      summary: null,
      aiProvider: null,
      completedAt: '',
      consentVersion: null,
      consentedAt: null,
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
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })
    return { deleted: true }
  }

  /**
   * 自我探索报告 PDF（不附加到简历；append 模式由 print.service 提供）。
   */
  async printReport(
    taskId: string,
    requester: SelfAssessmentRequester,
    ctx: AuditContext = EMPTY_AUDIT_CONTEXT,
  ) {
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
      // §1.2: 报告 PDF 走 self_assessment_report 用途,触发 sensitive 留存/标签;
      //      不再用 print_doc (normal),否则审计/Cron 会误聚合普通打印件。
      purpose: 'self_assessment_report',
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
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
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
