// ============================================================
// 自我探索 · 倾向参考 —— 服务端业务编排（v1）
//
// 合规口径（与 docs/compliance/compliance-boundary.md §4.5 同档）：
// - 复用 AiResumeResult 表，kind='self_assessment'；零 Prisma migration。
// - 答案原文不入库：payloadJson.persist 仅含 answersHash + dimensions + summary + note；
//   答案原文在评分后立即丢弃（不写日志 / 不送 LLM prompt / 不写监控）。
// - LLM 仅生成自然语言解读（note / summary），禁用"适合 / 不适合 / 推荐岗位"等指令性词。
// - 命中 LLM 合规词 → 丢弃该条 note；模型整体拒答时只回打分，原因码 COMPLIANCE_REJECT，不要求重新作答。
// - 仅本人 / 匿名 token 持有者可访问；匿名结果按 TTL 短期保存，不存答案原文。
// - 撤回 = 物理删除 answersHash / 维度 / summary；保留行用于删除审计。
// - 打印文件名带 -self-assessment 前缀；不进分享用途的 FileObject。
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FilesService } from '../../files/files.service'
import { PRINT_ARTIFACT_URL_TTL_MS, signFileUrl } from '../../files/signing'
import { SELF_ASSESSMENT_QUESTIONS_V1 } from './self-assessment-questions'
import type { SelfAssessmentAnswerV1, SelfAssessmentDimensionResult } from './self-assessment.types'
import { isAcceptedSelfAssessmentConsentVersion, SELF_ASSESSMENT_CONSENT_VERSION } from './self-assessment.types'
import { LlmSelfAssessmentService } from './llm-self-assessment.service'
import { SelfAssessmentPdfService } from './self-assessment-pdf.service'
import { scoreSelfAssessment } from './self-assessment-scoring'
import { formatBeijingDate } from '../../common/beijing-display-time'
import { AiLogService, AiUsageAccumulator } from '../ai-log.service'
import {
  LLM_UNAVAILABLE_PROVIDER,
  hasAiInterpretation,
  interpretationStateOf,
  type SelfAssessmentAiGates,
  type SelfAssessmentInterpretationState,
} from './self-assessment-interpretation'

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

/** 自我探索报告印在纸上的日期。completedAt 存的是 UTC ISO，纸上按北京时间自然日。 */
export function selfAssessmentReportDate(completedAtIso: string): string {
  return formatBeijingDate(new Date(completedAtIso))
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
  /** 解读缺席的原因码（AI 闸门拦下 / 模型调不通）；有解读时缺省。只存码，不存 message。 */
  aiUnavailableReason?: string | null
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

export interface SelfAssessmentSubmitOutput extends SelfAssessmentInterpretationState {
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
   * 提交答案 → 纯函数评分 → （AI 闸门放行才）LLM 解读 → 落库 → 审计。
   * 闸门拦下时打分照常落库返回，解读如实缺席（见 self-assessment-interpretation.ts）。
   * 匿名用户铸造一次性 accessTokenHash（明文仅返回一次）。
   */
  async submit(
    requester: SelfAssessmentRequester,
    input: SelfAssessmentSubmitInput,
    ctx: AuditContext = EMPTY_AUDIT_CONTEXT,
    gates: SelfAssessmentAiGates = {},
  ): Promise<SelfAssessmentSubmitOutput> {
    if (!input.consent.nonSensitive) {
      throw new NotFoundException({
        error: { code: 'SELF_ASSESSMENT_CONSENT_REQUIRED', message: '请勾选非敏感题作答同意后再提交' },
      })
    }

    // ── 版本化同意门禁 ────────────────────────────────────────────────
    // 只接受当前版本，原样逐字比对（不 trim、不大小写归一）。没有过渡期，也没有旧版本清单。
    // 缺版本号、空字符串、带首尾空格、旧版本、未知版本一律 400（合规 9/29 终裁：年龄说明是法定告知前提，
    // 必须证明用户看到的就是当前这一版）。
    const suppliedVersion = input.consent.consentVersion
    if (typeof suppliedVersion !== 'string' || !isAcceptedSelfAssessmentConsentVersion(suppliedVersion)) {
      throw new BadRequestException({
        error: {
          code: 'SELF_ASSESSMENT_CONSENT_VERSION_STALE',
          message: '知情同意说明已更新，请重新阅读并确认后再提交',
        },
      })
    }
    const consentVersion: string | null = suppliedVersion
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
    let aiUnavailableReason: string | null = null
    // 模型回 status=rejected：打分照常完成，不把用户赶回重答。与抛错路径分开。
    let complianceRejected = false

    // selfAssessment 是**付费**的 token 计费调用。此前这里不收集 token usage，
    // 落账恒为「无 token」，estimateCostCny 返回 undefined → 库里 estimatedCostCny=null，
    // 而 Admin 把 selfAssessment 当 token 计费能力渲染成 ¥0.0000 + 「按 token 用量」，
    // 等于对一次真实花钱的调用谎称免费。这里改为与 careerPlan / fairVisitPlan 同一套
    // AiUsageAccumulator 口径：真实 token 落账，成本按 provider 单价估算。
    const usage = new AiUsageAccumulator()
    // AI 闸门（暂停 / 额度 / 未开通 / 声明 / 登录档位）拦下 ⇒ 不调模型，只回打分。
    const gateRefusal = gates.interpretation ? await gates.interpretation() : null
    if (gateRefusal) {
      providerName = LLM_UNAVAILABLE_PROVIDER
      aiUnavailableReason = gateRefusal
    } else {
      try {
        const llmResult = await this.llm.summarize({
          scored: { dimensions: scored.dimensions, summary: null },
          consent,
          onLlmCall: usage.add,
        })
        if (llmResult.status === 'rejected') {
          dimensions = scored.dimensions.map((d) => ({ ...d, note: null }))
          summary = llmResult.summary
          providerName = LLM_UNAVAILABLE_PROVIDER
          aiUnavailableReason = 'COMPLIANCE_REJECT'
          llmErrorCode = 'COMPLIANCE_REJECT'
          complianceRejected = true
        } else {
          dimensions = llmResult.dimensions
          summary = llmResult.summary
          providerName = llmResult.providerName
          aiUnavailableReason = llmResult.unavailableReason ?? null
        }
      } catch (err) {
        overallRejectReason = err instanceof Error ? err.message : 'LLM 调用失败'
        llmErrorCode = 'LLM_ERROR'
      }
    }
    const interpretation = interpretationStateOf(dimensions, summary, aiUnavailableReason)
    // callCount === 0 → 一次都没真的打到模型（未配置 / 已降级），不落账，
    // 免得用一堆零成本行把「分能力成本」稀释成看起来很便宜。
    if (usage.callCount > 0) {
      this.log.record({
        taskId,
        provider: usage.provider ?? providerName ?? 'llm',
        operation: 'selfAssessment',
        latencyMs: Date.now() - t0,
        status: overallRejectReason || complianceRejected ? 'failed' : 'success',
        tokenUsage: usage.tokenUsage,
        ...(llmErrorCode ? { errorCode: llmErrorCode } : {}),
      })
    }

    // 4) 落库（会员归属本人；匿名结果按 TTL 短期保存，不存答案原文）
    const expiresAt = new Date(Date.now() + RESULT_TTL_HOURS * 60 * 60 * 1000)
    const completedAt = new Date().toISOString()

    const persisted: StoredSelfAssessment = {
      version: 'v1',
      answersHash: scored.answersHash,
      dimensions,
      summary,
      aiProvider: providerName,
      aiUnavailableReason: interpretation.aiUnavailableReason,
      completedAt,
      consentVersion,
      consentedAt,
    }

    if (!overallRejectReason) {
      // 匿名结果按 TTL 短期保存（accessTokenHash 持有），不存答案原文。
      // 模型抛错不走这里。整体合规拒答走这里：打分落完成行。
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
      // 模型抛错时匿名保留最小拒答行。整体合规拒答不进这个分支。
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
        // 只记码：解读有没有、没有的原因（闸门码 / 模型失败码），不记任何文字。
        aiInterpretation: interpretation.interpretationAvailable ? 'generated' : 'unavailable',
        aiUnavailableReason: overallRejectReason ? llmErrorCode ?? null : interpretation.aiUnavailableReason,
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
        interpretationAvailable: false,
        aiUnavailableReason: llmErrorCode ?? 'COMPLIANCE_REJECT',
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
      ...interpretation,
      providerName: providerName ?? undefined,
      ...(accessToken ? { accessToken } : {}),
      expiresAt: expiresAt.toISOString(),
      consentVersion,
      consentedAt,
      consentCurrent: isConsentCurrent(consentVersion),
    }
  }

  /** 读回本人或持有匿名凭证的结果（匿名结果按 TTL 短期保存，不存答案原文）。 */
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
      ...interpretationStateOf(stored.dimensions, stored.summary, stored.aiUnavailableReason),
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
   * 含 AI 解读才过 AI 闸门（gates.aiContentExport，拦下原样抛）；只有打分的报告不含 AI 内容，照常出。
   */
  async printReport(
    taskId: string,
    requester: SelfAssessmentRequester,
    ctx: AuditContext = EMPTY_AUDIT_CONTEXT,
    gates: SelfAssessmentAiGates = {},
  ) {
    const row = await this.loadAuthorizedRow(taskId, requester)
    const stored = JSON.parse(row.payloadJson) as StoredSelfAssessment
    if (stored.deletedAt) {
      throw new NotFoundException({
        error: { code: 'SELF_ASSESSMENT_WITHDRAWN', message: '本次自我探索已撤回，无法打印' },
      })
    }
    if (hasAiInterpretation(stored.dimensions, stored.summary)) await gates.aiContentExport?.()
    const { buffer, pageCount } = await this.renderReportForAppend({
      date: selfAssessmentReportDate(stored.completedAt),
      dimensions: stored.dimensions,
      summary: stored.summary,
      appendixDisclaimer: undefined,
      contentId: taskId,
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
      printFileUrl: signFileUrl(uploaded.fileId, PRINT_ARTIFACT_URL_TTL_MS).url,
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
    contentId: string
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
