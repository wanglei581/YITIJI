import { BadRequestException, ConflictException } from '@nestjs/common'
import type { AuditService } from '../audit/audit.service'
import { AiUsageAccumulator, aiErrorCodeOf } from '../ai/ai-log.service'
import { SERVICE_ERROR_ORDER_REFUNDED_MESSAGE } from '../payment/service-order.policy'
import type { PrismaService } from '../prisma/prisma.service'
import type { InterviewReportPayload, MockInterviewLlmService, NextQuestionInput } from './mock-interview-llm.service'
import { serializeInterviewReport } from './interview-qa-excerpt'
import type { InterviewChargeRequester, InterviewChargeSession } from './mock-interview-charge'

/** 模拟面试报告生成的收费准入与结果结算钩子（免费机器或测试替身为空）。 */
export interface InterviewReportChargeHooks {
  /** 返回受本次报告保护的活跃服务单 ID（无服务单或免费机器返回 null/void）。 */
  beforeReportGenerate?: () => Promise<string | null | void>
  onReportMade?: () => Promise<void>
  onReportFailed?: () => Promise<void>
}

export interface InterviewReportSession extends InterviewChargeSession {
  status: string
  endedAt: Date | null
}

export interface InterviewReportEndDeps<TSession extends InterviewReportSession, TReport> {
  prisma: PrismaService
  llm: Pick<MockInterviewLlmService, 'buildReport'>
  audit: Pick<AuditService, 'write'>
  anonTtlMs: number
  memberTtlMs: number
  loadAuthorized(sessionId: string, requester: InterviewChargeRequester): Promise<TSession>
  llmCtx(session: InterviewChargeSession): Omit<NextQuestionInput, 'askedCount' | 'transcript'>
  requireResumeConsent(session: InterviewChargeSession): Promise<void>
  recordAiLog(
    sessionId: string,
    operation: 'interviewReport',
    usage: Pick<AiUsageAccumulator, 'callCount' | 'provider' | 'tokenUsage'>,
    startedAt: number,
    status: 'success' | 'failed',
    endUserId: string | null,
    errorCode?: string,
  ): void
  reportDto(session: TSession, payloadJson: string): Promise<TReport>
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002')
}

/**
 * 结束模拟面试并生成练习报告（含收费服务单前置准入与单事务原子胜负落库）：
 * - 已有报告直接幂等返回，不调模型、不改已完成单；
 * - 调模型前先核服务单（再试过期当场原路退并 409、退款态直接 409，0 次调模型）；
 * - 收费单保护场次：模型返回后在同一 prisma.$transaction 内原子抢占 reportState='done' 并落报告；
 *   仅 claimed.count===1 才写报告，否则绝不落库并按当前单态回 409（或返回并发胜出报告）。
 */
export async function executeInterviewReportEnd<TSession extends InterviewReportSession, TReport>(
  deps: InterviewReportEndDeps<TSession, TReport>,
  input: {
    sessionId: string
    requester: InterviewChargeRequester
    includeAnswersInPrint: boolean
    hooks?: InterviewReportChargeHooks
  },
): Promise<TReport> {
  const { sessionId, requester, includeAnswersInPrint, hooks } = input
  const session = await deps.loadAuthorized(sessionId, requester)
  const existing = await deps.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
  if (existing) {
    await hooks?.onReportMade?.()
    return deps.reportDto(session, existing.payloadJson)
  }
  if (session.status === 'configured') {
    throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_STARTED', message: '尚未开始面试，无法生成报告' } })
  }
  // 收费场次调模型前必须先核服务单状态与免费再试期限，禁止过期翻 done 或退款后再次调模型。
  const paidOrderId = (await hooks?.beforeReportGenerate?.()) ?? null

  const claimed = await deps.prisma.mockInterviewSession.updateMany({
    where: { id: session.id, status: 'in_progress' },
    data: { status: 'completed', endedAt: new Date() },
  })
  if (claimed.count === 0) {
    const raced = await deps.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
    if (raced) {
      await hooks?.onReportMade?.()
      const latest = await deps.loadAuthorized(sessionId, requester)
      return deps.reportDto(latest, raced.payloadJson)
    }
    const latest = await deps.prisma.mockInterviewSession.findUnique({ where: { id: session.id } })
    if (!latest || latest.status !== 'completed') {
      throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_ACTIVE', message: '本场练习未在进行中' } })
    }
  }

  const turns = await deps.prisma.mockInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { idx: 'asc' } })
  const answered = turns.filter((t) => t.role === 'candidate' && !t.skipped).length
  if (answered === 0) {
    await rollbackCompleted(deps.prisma, session.id)
    throw new BadRequestException({ error: { code: 'INTERVIEW_NO_ANSWERS', message: '本场练习还没有任何回答，请至少回答一个问题后再生成报告' } })
  }
  try {
    await deps.requireResumeConsent(session)
  } catch (error) {
    await rollbackCompleted(deps.prisma, session.id)
    throw error
  }

  const usage = new AiUsageAccumulator()
  const startedAt = Date.now()
  let payload: InterviewReportPayload
  try {
    payload = await deps.llm.buildReport({
      ...deps.llmCtx(session),
      transcript: turns.map((t) => ({
        role: t.role as 'interviewer' | 'candidate',
        content: t.content,
        skipped: t.skipped,
        ...(t.role === 'candidate' && t.answerDurationSec != null ? { durationSec: t.answerDurationSec } : {}),
        ...(t.role === 'candidate' ? { inputMode: t.inputMode } : {}),
      })),
    }, usage.add)
  } catch (error) {
    deps.recordAiLog(session.id, 'interviewReport', usage, startedAt, 'failed', session.endUserId, aiErrorCodeOf(error, 'AI_INTERVIEW_REPORT_FAILED'))
    await rollbackCompleted(deps.prisma, session.id)
    await hooks?.onReportFailed?.()
    throw error
  }
  deps.recordAiLog(session.id, 'interviewReport', usage, startedAt, 'success', session.endUserId)

  const ttl = session.endUserId ? deps.memberTtlMs : deps.anonTtlMs
  const serialized = serializeInterviewReport(payload, includeAnswersInPrint)
  let endedAt = new Date()

  if (paidOrderId) {
    const outcome = await commitPaidReportAtomic(deps, session, paidOrderId, serialized, ttl, hooks)
    if (outcome.racedReport) return deps.reportDto(session, outcome.racedReport)
    if (outcome.endedAt) endedAt = outcome.endedAt
  } else {
    const raced = await persistFreeReport(deps, session.id, serialized, ttl, hooks)
    if (raced) return deps.reportDto(session, raced)
    await hooks?.onReportMade?.()
  }

  await deps.audit.write({
    actorId: null,
    actorRole: session.endUserId ? 'enduser' : 'kiosk',
    action: 'mock_interview.report_generated',
    targetType: 'mock_interview_session',
    targetId: session.id,
    payload: { answered, level: payload.overall.level },
    ipAddress: null, userAgent: null, requestId: null,
  })
  return deps.reportDto({ ...session, status: 'completed', endedAt }, serialized)
}

async function commitPaidReportAtomic<TSession extends InterviewReportSession, TReport>(
  deps: InterviewReportEndDeps<TSession, TReport>,
  session: TSession,
  paidOrderId: string,
  serialized: string,
  ttl: number,
  hooks?: InterviewReportChargeHooks,
): Promise<{ racedReport?: string; endedAt?: Date }> {
  let committedAt: Date | null = null
  try {
    committedAt = await deps.prisma.$transaction(async (tx) => {
      const now = new Date()
      const claimed = await tx.serviceOrder.updateMany({
        where: {
          id: paidOrderId,
          status: 'consumed',
          OR: [{ reportState: null }, { reportState: 'retry', retryUntil: { gt: now } }],
        },
        data: { reportState: 'done', failureReason: null, retryUntil: null, settledAt: now },
      })
      if (claimed.count !== 1) return null
      await tx.mockInterviewReport.create({
        data: { sessionId: session.id, payloadJson: serialized, expiresAt: new Date(now.getTime() + ttl) },
      })
      await tx.mockInterviewSession.updateMany({
        where: { id: session.id },
        data: { status: 'completed', endedAt: now },
      })
      return now
    })
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await deps.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
      if (raced) {
        await hooks?.onReportMade?.()
        return { racedReport: raced.payloadJson }
      }
    }
    await rollbackCompleted(deps.prisma, session.id)
    await hooks?.onReportFailed?.()
    throw error
  }
  if (committedAt) return { endedAt: committedAt }
  const raced = await deps.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
  if (raced) return { racedReport: raced.payloadJson }
  await rollbackCompleted(deps.prisma, session.id)
  await hooks?.beforeReportGenerate?.()
  const racedAfter = await deps.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
  if (racedAfter) return { racedReport: racedAfter.payloadJson }
  throw new ConflictException({
    error: { code: 'SERVICE_ORDER_REFUNDED', message: SERVICE_ERROR_ORDER_REFUNDED_MESSAGE },
  })
}

async function persistFreeReport<TSession extends InterviewReportSession, TReport>(
  deps: InterviewReportEndDeps<TSession, TReport>,
  sessionId: string,
  serialized: string,
  ttl: number,
  hooks?: InterviewReportChargeHooks,
): Promise<string | null> {
  try {
    await deps.prisma.mockInterviewReport.create({
      data: { sessionId, payloadJson: serialized, expiresAt: new Date(Date.now() + ttl) },
    })
    return null
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await deps.prisma.mockInterviewReport.findUnique({ where: { sessionId } })
      if (raced) {
        await hooks?.onReportMade?.()
        return raced.payloadJson
      }
    }
    await rollbackCompleted(deps.prisma, sessionId)
    await hooks?.onReportFailed?.()
    throw error
  }
}

async function rollbackCompleted(prisma: PrismaService, sessionId: string): Promise<void> {
  await prisma.mockInterviewSession.updateMany({
    where: { id: sessionId, status: 'completed' },
    data: { status: 'in_progress', endedAt: null },
  })
}
