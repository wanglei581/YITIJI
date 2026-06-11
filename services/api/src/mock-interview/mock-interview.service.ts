import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { ResumeExtractionService } from '../ai/resume/resume-extraction.service'
import { MockInterviewLlmService, type InterviewReportPayload } from './mock-interview-llm.service'
import { InterviewReportPdfService } from './interview-report-pdf.service'

// ============================================================
// 2C 模拟面试会话服务。
//
// 归属（对齐 C-2A/C-1 范式）：
// - 登录会员行：endUserId 本人校验；其他会员/匿名一律 NOT_FOUND（不泄露存在性）。
// - 匿名行：创建时铸 192-bit accessToken，只回传一次；DB 只存 SHA-256；
//   后续凭 x-interview-access-token header + timingSafeEqual 校验。
// 留存：匿名会话/报告 2 小时、会员 7 天（expiresAt），每小时清理任务物理删除
//   过期行（级联 turns/report）。对话与报告原文不写日志、不进审计 payload。
// 合规：练习工具；报告只给本人；删除留审计。
// ============================================================

const ANON_TTL_MS = 2 * 60 * 60 * 1000
const MEMBER_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ANSWER_CHARS = 2000

const DURATION_TARGET: Record<number, number> = { 3: 4, 5: 6, 8: 8 }

export const INTERVIEWER_LABEL: Record<string, string> = {
  hr: 'HR 初筛', manager: '业务主管', tech: '技术面试官', campus: '校招面试官', final: '终面负责人',
}

export interface InterviewRequester {
  endUserId: string | null
  accessToken: string | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function verifyToken(token: string | null, expectedHash: string | null): boolean {
  if (!token || !expectedHash) return false
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

type SessionRow = NonNullable<Awaited<ReturnType<PrismaService['mockInterviewSession']['findUnique']>>>

@Injectable()
export class MockInterviewService {
  private readonly logger = new Logger(MockInterviewService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: MockInterviewLlmService,
    private readonly pdf: InterviewReportPdfService,
    private readonly files: FilesService,
    private readonly extraction: ResumeExtractionService,
    private readonly audit: AuditService,
  ) {}

  // ── 创建 / 开始 ────────────────────────────────────────────────────────────

  async createSession(
    dto: {
      interviewerType: string
      industry: string
      position: string
      experience: string
      difficulty: string
      durationMin: number
      resumeFileId?: string
    },
    requester: InterviewRequester,
  ) {
    // 可选简历：服务端真实提取（复用提取层，失败 → 明确报错，不静默忽略）
    let resumeDigest: string | null = null
    if (dto.resumeFileId) {
      const extraction = await this.extraction.extractResumeText({ fileId: dto.resumeFileId, endUserId: requester.endUserId })
      if (!extraction.ok) {
        throw new BadRequestException({
          error: { code: 'INTERVIEW_RESUME_EXTRACT_FAILED', message: extraction.errorMessage ?? '简历文件无法提取，请更换文件或选择「暂不使用简历」' },
        })
      }
      resumeDigest = extraction.text?.slice(0, 6000) ?? null
    }

    const isAnonymous = !requester.endUserId
    const accessToken = isAnonymous ? randomBytes(24).toString('hex') : undefined
    const ttl = isAnonymous ? ANON_TTL_MS : MEMBER_TTL_MS
    const row = await this.prisma.mockInterviewSession.create({
      data: {
        endUserId: requester.endUserId,
        accessTokenHash: accessToken ? hashToken(accessToken) : null,
        interviewerType: dto.interviewerType,
        industry: dto.industry,
        position: dto.position.trim().slice(0, 50),
        experience: dto.experience,
        difficulty: dto.difficulty,
        durationMin: dto.durationMin,
        questionTarget: DURATION_TARGET[dto.durationMin] ?? 6,
        resumeFileId: dto.resumeFileId ?? null,
        resumeDigest,
        expiresAt: new Date(Date.now() + ttl),
      },
    })
    await this.audit.write({
      actorId: null,
      actorRole: requester.endUserId ? 'enduser' : 'kiosk',
      action: 'mock_interview.create',
      targetType: 'mock_interview_session',
      targetId: row.id,
      // 仅元数据：绝不含简历摘要 / 对话内容
      payload: { interviewerType: row.interviewerType, durationMin: row.durationMin, hasResume: !!resumeDigest, hasEndUser: !!requester.endUserId },
      ipAddress: null, userAgent: null, requestId: null,
    })
    this.logger.log(`interview.create id=${row.id} target=${row.questionTarget}`)
    return { sessionId: row.id, questionTarget: row.questionTarget, ...(accessToken ? { accessToken } : {}) }
  }

  async start(sessionId: string, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    if (session.status !== 'configured') {
      throw new BadRequestException({ error: { code: 'INTERVIEW_ALREADY_STARTED', message: '本场练习已开始或已结束' } })
    }
    const q = await this.llm.nextQuestion({ ...this.llmCtx(session), askedCount: 0, transcript: [] })
    const content = q.greeting ? `${q.greeting}\n${q.question}` : q.question
    await this.prisma.$transaction(async (tx) => {
      await tx.mockInterviewSession.update({ where: { id: session.id }, data: { status: 'in_progress', startedAt: new Date() } })
      await tx.mockInterviewTurn.create({ data: { sessionId: session.id, idx: 0, role: 'interviewer', qType: q.qType, content } })
    })
    return { question: content, qType: q.qType, questionIndex: 1, questionTarget: session.questionTarget, done: false }
  }

  /** 提交回答（或跳过）→ 返回下一题或结束建议。 */
  async answer(sessionId: string, input: { answer?: string; skip?: boolean }, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    if (session.status !== 'in_progress') {
      throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_ACTIVE', message: '本场练习未在进行中' } })
    }
    const turns = await this.prisma.mockInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { idx: 'asc' } })
    const asked = turns.filter((t) => t.role === 'interviewer').length
    if (asked === 0) {
      throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_STARTED', message: '请先开始面试' } })
    }
    const answerText = input.skip ? '' : (input.answer ?? '').trim().slice(0, MAX_ANSWER_CHARS)
    if (!input.skip && answerText.length === 0) {
      throw new BadRequestException({ error: { code: 'INTERVIEW_ANSWER_EMPTY', message: '请输入回答内容，或选择跳过此题' } })
    }
    const nextIdx = turns.length
    await this.prisma.mockInterviewTurn.create({
      data: { sessionId: session.id, idx: nextIdx, role: 'candidate', content: input.skip ? '（跳过）' : answerText, skipped: !!input.skip },
    })

    if (asked >= session.questionTarget) {
      // 已答完最后一题 → 建议结束（前端调 /end 生成报告）
      return { done: true, questionIndex: asked, questionTarget: session.questionTarget }
    }
    const transcript = [...turns, { role: 'candidate' as const, content: input.skip ? '' : answerText, skipped: !!input.skip }]
      .map((t) => ({ role: t.role as 'interviewer' | 'candidate', content: t.content, skipped: 'skipped' in t ? !!t.skipped : false }))
    const q = await this.llm.nextQuestion({ ...this.llmCtx(session), askedCount: asked, transcript })
    await this.prisma.mockInterviewTurn.create({
      data: { sessionId: session.id, idx: nextIdx + 1, role: 'interviewer', qType: q.qType, content: q.question },
    })
    return { done: false, question: q.question, qType: q.qType, questionIndex: asked + 1, questionTarget: session.questionTarget }
  }

  /** 结束并生成练习报告（幂等：已有报告直接返回）。 */
  async end(sessionId: string, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    const existing = await this.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
    if (existing) return this.reportDto(session, existing.payloadJson)
    if (session.status === 'configured') {
      throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_STARTED', message: '尚未开始面试，无法生成报告' } })
    }
    const turns = await this.prisma.mockInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { idx: 'asc' } })
    const answered = turns.filter((t) => t.role === 'candidate' && !t.skipped).length
    if (answered === 0) {
      throw new BadRequestException({ error: { code: 'INTERVIEW_NO_ANSWERS', message: '本场练习还没有任何回答，请至少回答一个问题后再生成报告' } })
    }
    const payload = await this.llm.buildReport({
      ...this.llmCtx(session),
      transcript: turns.map((t) => ({ role: t.role as 'interviewer' | 'candidate', content: t.content, skipped: t.skipped })),
    })
    const ttl = session.endUserId ? MEMBER_TTL_MS : ANON_TTL_MS
    await this.prisma.$transaction(async (tx) => {
      await tx.mockInterviewSession.update({ where: { id: session.id }, data: { status: 'completed', endedAt: new Date() } })
      await tx.mockInterviewReport.create({
        data: { sessionId: session.id, payloadJson: JSON.stringify(payload), expiresAt: new Date(Date.now() + ttl) },
      })
    })
    await this.audit.write({
      actorId: null,
      actorRole: session.endUserId ? 'enduser' : 'kiosk',
      action: 'mock_interview.report_generated',
      targetType: 'mock_interview_session',
      targetId: session.id,
      payload: { answered, level: payload.overall.level },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return this.reportDto(session, JSON.stringify(payload))
  }

  // ── 读取 ──────────────────────────────────────────────────────────────────

  async getSession(sessionId: string, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    const turns = await this.prisma.mockInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { idx: 'asc' } })
    return {
      sessionId: session.id,
      status: session.status,
      interviewerType: session.interviewerType,
      industry: session.industry,
      position: session.position,
      experience: session.experience,
      difficulty: session.difficulty,
      durationMin: session.durationMin,
      questionTarget: session.questionTarget,
      turns: turns.map((t) => ({ idx: t.idx, role: t.role, qType: t.qType, content: t.content, skipped: t.skipped })),
    }
  }

  async getReport(sessionId: string, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    const report = await this.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
    if (!report || report.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({ error: { code: 'INTERVIEW_REPORT_NOT_FOUND', message: '报告不存在或已过期，请重新练习' } })
    }
    return this.reportDto(session, report.payloadJson)
  }

  /** 打印版：服务端渲染真实 PDF → FileObject + 短期签名 URL → 既有打印链路。 */
  async printReport(sessionId: string, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    const report = await this.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
    if (!report || report.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({ error: { code: 'INTERVIEW_REPORT_NOT_FOUND', message: '报告不存在或已过期，请重新练习' } })
    }
    const payload = JSON.parse(report.payloadJson) as InterviewReportPayload
    const { buffer, pageCount } = await this.pdf.render(
      {
        position: session.position,
        industry: session.industry,
        interviewerLabel: INTERVIEWER_LABEL[session.interviewerType] ?? session.interviewerType,
        date: (session.endedAt ?? session.createdAt).toISOString().slice(0, 10),
      },
      payload,
    )
    const uploaded = await this.files.upload({
      buffer,
      filename: `模拟面试练习报告_${session.position.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20) || '岗位'}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: session.endUserId,
      createdBy: 'mock_interview_report',
    })
    await this.audit.write({
      actorId: null,
      actorRole: session.endUserId ? 'enduser' : 'kiosk',
      action: 'mock_interview.report_print',
      targetType: 'mock_interview_session',
      targetId: session.id,
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
    }
  }

  // ── 会员历史（面试报告入口）──────────────────────────────────────────────

  async listMine(endUserId: string, cursor: string | null, pageSize: number) {
    const rows = await this.prisma.mockInterviewSession.findMany({
      where: { endUserId, status: 'completed', expiresAt: { gt: new Date() } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, interviewerType: true, industry: true, position: true,
        durationMin: true, createdAt: true, endedAt: true, expiresAt: true,
        report: { select: { id: true, expiresAt: true } },
      },
    })
    const hasMore = rows.length > pageSize
    const items = rows.slice(0, pageSize).map((r) => ({
      sessionId: r.id,
      interviewerType: r.interviewerType,
      interviewerLabel: INTERVIEWER_LABEL[r.interviewerType] ?? r.interviewerType,
      industry: r.industry,
      position: r.position,
      durationMin: r.durationMin,
      createdAt: r.createdAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      hasReport: !!r.report && r.report.expiresAt.getTime() > Date.now(),
    }))
    return { items, nextCursor: hasMore ? rows[pageSize - 1].id : null }
  }

  /** 会员删除本人练习记录（硬删，级联 turns/report；留审计）。 */
  async deleteMine(endUserId: string, sessionId: string) {
    const row = await this.prisma.mockInterviewSession.findFirst({ where: { id: sessionId, endUserId }, select: { id: true } })
    if (!row) {
      throw new NotFoundException({ error: { code: 'INTERVIEW_NOT_FOUND', message: '记录不存在' } })
    }
    await this.prisma.mockInterviewSession.delete({ where: { id: row.id } })
    await this.audit.write({
      actorId: null,
      actorRole: 'enduser',
      action: 'mock_interview.member_delete',
      targetType: 'mock_interview_session',
      targetId: sessionId,
      payload: { endUserId },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return { deleted: true }
  }

  // ── 留存清理（每小时；物理删除过期会话，级联 turns/report）─────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired(): Promise<void> {
    const res = await this.prisma.mockInterviewSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    if (res.count > 0) this.logger.log(`interview.cleanup removed=${res.count}`)
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  private llmCtx(session: SessionRow) {
    return {
      interviewerType: session.interviewerType,
      industry: session.industry,
      position: session.position,
      experience: session.experience,
      difficulty: session.difficulty,
      questionTarget: session.questionTarget,
      resumeDigest: session.resumeDigest,
    }
  }

  private reportDto(session: SessionRow, payloadJson: string) {
    return {
      sessionId: session.id,
      position: session.position,
      industry: session.industry,
      interviewerType: session.interviewerType,
      interviewerLabel: INTERVIEWER_LABEL[session.interviewerType] ?? session.interviewerType,
      durationMin: session.durationMin,
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      report: JSON.parse(payloadJson) as InterviewReportPayload,
    }
  }

  /**
   * 归属门禁：会员行只放行本人；匿名行须正确 accessToken；过期视为不存在。
   * 任何拒绝统一 NOT_FOUND，不泄露存在性。
   */
  private async loadAuthorized(sessionId: string, requester: InterviewRequester): Promise<SessionRow> {
    const row = await this.prisma.mockInterviewSession.findUnique({ where: { id: sessionId } })
    const notFound = () =>
      new NotFoundException({ error: { code: 'INTERVIEW_NOT_FOUND', message: '练习不存在或已过期，请重新开始' } })
    if (!row || row.expiresAt.getTime() < Date.now()) throw notFound()
    if (row.endUserId) {
      if (requester.endUserId !== row.endUserId) throw notFound()
      return row
    }
    if (!verifyToken(requester.accessToken, row.accessTokenHash)) throw notFound()
    return row
  }
}
