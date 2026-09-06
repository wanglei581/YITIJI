import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { signFileUrl } from '../files/signing'
import { ResumeExtractionService } from '../ai/resume/resume-extraction.service'
import { MockInterviewLlmService, type InterviewReportPayload, type NextQuestionOutput } from './mock-interview-llm.service'
import { InterviewReportPdfService } from './interview-report-pdf.service'
import { InterviewPracticeSheetPdfService } from './interview-practice-sheet-pdf.service'
import {
  PRACTICE_SHEET_FILENAME_PREFIX,
  PRACTICE_SHEET_INTERVIEWER_LABEL,
  pickPracticeQuestions,
} from './interview-practice-sheet'
import { AiLogService, AiUsageAccumulator, aiErrorCodeOf } from '../ai/ai-log.service'
import { InflightCoalescer } from '../ai/ai-inflight'

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

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002')
}

@Injectable()
export class MockInterviewService {
  private readonly logger = new Logger(MockInterviewService.name)
  private readonly startInflight = new InflightCoalescer<{
    question: string
    qType: string
    questionIndex: number
    questionTarget: number
    done: false
  }>()
  private readonly endInflight = new InflightCoalescer<ReturnType<MockInterviewService['reportDto']>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: MockInterviewLlmService,
    private readonly pdf: InterviewReportPdfService,
    private readonly practiceSheetPdf: InterviewPracticeSheetPdfService,
    private readonly files: FilesService,
    private readonly extraction: ResumeExtractionService,
    private readonly audit: AuditService,
    private readonly aiLog: AiLogService,
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
      interactionMode?: string
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
        interactionMode: dto.interactionMode === 'voice' ? 'voice' : 'text',
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
    // 鉴权必须在合并之前：否则无权请求会复用已授权 worker 的 Promise。
    await this.loadAuthorized(sessionId, requester)
    return this.startInflight.run(this.coalesceKey(sessionId, requester), () => this.startOnce(sessionId, requester))
  }

  private async startOnce(sessionId: string, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    const claimed = await this.prisma.mockInterviewSession.updateMany({
      where: { id: session.id, status: 'configured' },
      data: { status: 'in_progress', startedAt: new Date() },
    })
    if (claimed.count === 0) {
      throw new BadRequestException({ error: { code: 'INTERVIEW_ALREADY_STARTED', message: '本场练习已开始或已结束' } })
    }
    const usage = new AiUsageAccumulator()
    const startedAt = Date.now()
    let q: NextQuestionOutput
    try {
      q = await this.llm.nextQuestion({ ...this.llmCtx(session), askedCount: 0, transcript: [] }, usage.add)
      this.recordAiLog(session.id, 'interviewQuestion', usage, startedAt, 'success', session.endUserId)
      const content = q.greeting ? `${q.greeting}\n${q.question}` : q.question
      await this.prisma.mockInterviewTurn.create({
        data: { sessionId: session.id, idx: 0, role: 'interviewer', qType: q.qType, content },
      })
      return { question: content, qType: q.qType, questionIndex: 1, questionTarget: session.questionTarget, done: false as const }
    } catch (error) {
      this.recordAiLog(session.id, 'interviewQuestion', usage, startedAt, 'failed', session.endUserId, aiErrorCodeOf(error, 'AI_INTERVIEW_QUESTION_FAILED'))
      await this.prisma.$transaction([
        this.prisma.mockInterviewTurn.deleteMany({ where: { sessionId: session.id } }),
        this.prisma.mockInterviewSession.updateMany({
          where: { id: session.id, status: 'in_progress' },
          data: { status: 'configured', startedAt: null },
        }),
      ])
      throw error
    }
  }

  /** 提交回答（或跳过）→ 返回下一题或结束建议。语音回合附转写元数据（2C+）。 */
  async answer(
    sessionId: string,
    input: {
      answer?: string
      skip?: boolean
      inputMode?: string
      transcriptText?: string
      transcriptEdited?: boolean
      answerDurationSec?: number
    },
    requester: InterviewRequester,
  ) {
    const session = await this.loadAuthorized(sessionId, requester)
    if (session.status !== 'in_progress') {
      throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_ACTIVE', message: '本场练习未在进行中' } })
    }
    const turns = await this.prisma.mockInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { idx: 'asc' } })
    const asked = turns.filter((t) => t.role === 'interviewer').length
    if (asked === 0) {
      throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_STARTED', message: '请先开始面试' } })
    }
    const last = turns[turns.length - 1]
    const lastIsCandidate = last?.role === 'candidate'
    if (asked >= session.questionTarget && lastIsCandidate) {
      throw new BadRequestException({ error: { code: 'INTERVIEW_ALREADY_COMPLETE', message: '本题已全部答完，请生成练习报告' } })
    }
    const answerText = input.skip ? '' : (input.answer ?? '').trim().slice(0, MAX_ANSWER_CHARS)
    if (!input.skip && !lastIsCandidate && answerText.length === 0) {
      throw new BadRequestException({ error: { code: 'INTERVIEW_ANSWER_EMPTY', message: '请输入回答内容，或选择跳过此题' } })
    }

    const candidateContent = lastIsCandidate ? last.content : (input.skip ? '（跳过）' : answerText)
    const candidateSkipped = lastIsCandidate ? last.skipped : !!input.skip
    const transcript = [
      ...turns.filter((t) => !(lastIsCandidate && t.idx === last.idx)),
      { role: 'candidate' as const, content: candidateSkipped ? '' : candidateContent.replace(/^（跳过）$/, ''), skipped: candidateSkipped },
    ].map((t) => ({
      role: t.role as 'interviewer' | 'candidate',
      content: t.content,
      skipped: 'skipped' in t ? !!t.skipped : false,
    }))

    if (asked >= session.questionTarget) {
      if (!lastIsCandidate) {
        try {
          await this.prisma.mockInterviewTurn.create({
            data: {
              sessionId: session.id,
              idx: turns.length,
              role: 'candidate',
              content: input.skip ? '（跳过）' : answerText,
              skipped: !!input.skip,
              inputMode: input.inputMode === 'voice' ? 'voice' : 'text',
              transcriptText: input.transcriptText?.slice(0, MAX_ANSWER_CHARS) ?? null,
              transcriptEdited: input.transcriptEdited === true,
              answerDurationSec: typeof input.answerDurationSec === 'number' ? Math.max(0, Math.min(600, Math.round(input.answerDurationSec))) : null,
            },
          })
        } catch (error) {
          if (!isUniqueConflict(error)) throw error
        }
      }
      return { done: true, questionIndex: asked, questionTarget: session.questionTarget }
    }

    const qUsage = new AiUsageAccumulator()
    const qStartedAt = Date.now()
    let q: NextQuestionOutput
    try {
      q = await this.llm.nextQuestion({ ...this.llmCtx(session), askedCount: asked, transcript }, qUsage.add)
    } catch (error) {
      this.recordAiLog(session.id, 'interviewQuestion', qUsage, qStartedAt, 'failed', session.endUserId, aiErrorCodeOf(error, 'AI_INTERVIEW_QUESTION_FAILED'))
      throw error
    }
    this.recordAiLog(session.id, 'interviewQuestion', qUsage, qStartedAt, 'success', session.endUserId)

    try {
      await this.prisma.$transaction(async (tx) => {
        if (!lastIsCandidate) {
          await tx.mockInterviewTurn.create({
            data: {
              sessionId: session.id,
              idx: turns.length,
              role: 'candidate',
              content: input.skip ? '（跳过）' : answerText,
              skipped: !!input.skip,
              inputMode: input.inputMode === 'voice' ? 'voice' : 'text',
              transcriptText: input.transcriptText?.slice(0, MAX_ANSWER_CHARS) ?? null,
              transcriptEdited: input.transcriptEdited === true,
              answerDurationSec: typeof input.answerDurationSec === 'number' ? Math.max(0, Math.min(600, Math.round(input.answerDurationSec))) : null,
            },
          })
        }
        await tx.mockInterviewTurn.create({
          data: {
            sessionId: session.id,
            idx: lastIsCandidate ? turns.length : turns.length + 1,
            role: 'interviewer',
            qType: q.qType,
            content: q.question,
          },
        })
      })
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new BadRequestException({ error: { code: 'INTERVIEW_TURN_CONFLICT', message: '本题已提交，请刷新后继续' } })
      }
      throw error
    }
    return { done: false, question: q.question, qType: q.qType, questionIndex: asked + 1, questionTarget: session.questionTarget }
  }

  /** 结束并生成练习报告（幂等：已有报告直接返回）。 */
  async end(sessionId: string, requester: InterviewRequester) {
    await this.loadAuthorized(sessionId, requester)
    return this.endInflight.run(this.coalesceKey(sessionId, requester), () => this.endOnce(sessionId, requester))
  }

  private async endOnce(sessionId: string, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    const existing = await this.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
    if (existing) return this.reportDto(session, existing.payloadJson)
    if (session.status === 'configured') {
      throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_STARTED', message: '尚未开始面试，无法生成报告' } })
    }
    const claimed = await this.prisma.mockInterviewSession.updateMany({
      where: { id: session.id, status: 'in_progress' },
      data: { status: 'completed', endedAt: new Date() },
    })
    if (claimed.count === 0) {
      const raced = await this.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
      if (raced) {
        const latest = await this.loadAuthorized(sessionId, requester)
        return this.reportDto(latest, raced.payloadJson)
      }
      // CAS 已把状态写成 completed，但进程在写报告前崩溃 → 无报告。
      // 不引入 completing（shared InterviewSessionStatus 无此值）；允许 completed 且无报告时重试生成。
      const latest = await this.prisma.mockInterviewSession.findUnique({ where: { id: session.id } })
      if (!latest || latest.status !== 'completed') {
        throw new BadRequestException({ error: { code: 'INTERVIEW_NOT_ACTIVE', message: '本场练习未在进行中' } })
      }
    }
    const turns = await this.prisma.mockInterviewTurn.findMany({ where: { sessionId: session.id }, orderBy: { idx: 'asc' } })
    const answered = turns.filter((t) => t.role === 'candidate' && !t.skipped).length
    if (answered === 0) {
      await this.prisma.mockInterviewSession.updateMany({
        where: { id: session.id, status: 'completed' },
        data: { status: 'in_progress', endedAt: null },
      })
      throw new BadRequestException({ error: { code: 'INTERVIEW_NO_ANSWERS', message: '本场练习还没有任何回答，请至少回答一个问题后再生成报告' } })
    }
    const rUsage = new AiUsageAccumulator()
    const rStartedAt = Date.now()
    let payload: InterviewReportPayload
    try {
      payload = await this.llm.buildReport({
        ...this.llmCtx(session),
        transcript: turns.map((t) => ({
          role: t.role as 'interviewer' | 'candidate',
          content: t.content,
          skipped: t.skipped,
          ...(t.role === 'candidate' && t.answerDurationSec != null ? { durationSec: t.answerDurationSec } : {}),
          ...(t.role === 'candidate' ? { inputMode: t.inputMode } : {}),
        })),
      }, rUsage.add)
    } catch (error) {
      this.recordAiLog(session.id, 'interviewReport', rUsage, rStartedAt, 'failed', session.endUserId, aiErrorCodeOf(error, 'AI_INTERVIEW_REPORT_FAILED'))
      await this.prisma.mockInterviewSession.updateMany({
        where: { id: session.id, status: 'completed' },
        data: { status: 'in_progress', endedAt: null },
      })
      throw error
    }
    this.recordAiLog(session.id, 'interviewReport', rUsage, rStartedAt, 'success', session.endUserId)
    const ttl = session.endUserId ? MEMBER_TTL_MS : ANON_TTL_MS
    try {
      await this.prisma.mockInterviewReport.create({
        data: { sessionId: session.id, payloadJson: JSON.stringify(payload), expiresAt: new Date(Date.now() + ttl) },
      })
    } catch (error) {
      if (isUniqueConflict(error)) {
        const raced = await this.prisma.mockInterviewReport.findUnique({ where: { sessionId: session.id } })
        if (raced) return this.reportDto(session, raced.payloadJson)
      }
      await this.prisma.mockInterviewSession.updateMany({
        where: { id: session.id, status: 'completed' },
        data: { status: 'in_progress', endedAt: null },
      })
      throw error
    }
    await this.audit.write({
      actorId: null,
      actorRole: session.endUserId ? 'enduser' : 'kiosk',
      action: 'mock_interview.report_generated',
      targetType: 'mock_interview_session',
      targetId: session.id,
      payload: { answered, level: payload.overall.level },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return this.reportDto({ ...session, status: 'completed', endedAt: new Date() }, JSON.stringify(payload))
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
      printFileUrl: signFileUrl(uploaded.fileId).url,
    }
  }

  /**
   * 通用题目与答案单（ai-down 支线）：服务端真实 PDF → FileObject → 既有打印链路。
   *
   * 为什么现有端点不够，必须新增这一条：
   *   - `POST :id/report/print` 要求已落库的 AI 报告，没有就 404。而这条路径存在的场景
   *     恰恰是**报告根本没机会产生** —— `start` 第一步就调 LLM 出题（本文件 `start` →
   *     `this.llm.nextQuestion`），模型 503 时会话永远停在 `configured`，既没有 turn 也没有
   *     report，`printReport` 只会再抛一次 404。
   *   - `POST /resume/generate/export` 是简历版式，跟面试题无关。
   *   - 让前端自己拼一张纸做不到：本机是打印终端，出纸必须走 FileObject + 签名 URL 链路。
   *
   *   所以这是「AI 挂了也得能带走一张纸」这条规则在面试链上唯一的落点，
   *   与 career-plan 的 `variant:'degraded'` 是同一套处置（PR #639 已立的先例）。
   *
   * 这条路径**不调用任何模型**：题目来自写死的通用题库，按用户自己选的面试官身份取。
   * 因此它在 AI 全挂时照常可用 —— 这正是它存在的意义。
   *
   * 允许在任何会话状态下调用（configured / in_progress / completed 都行）：
   * 用户中途 AI 挂了也该能把剩下的题带走用笔答。
   */
  async printPracticeSheet(sessionId: string, requester: InterviewRequester) {
    const session = await this.loadAuthorized(sessionId, requester)
    const questions = pickPracticeQuestions(session.interviewerType, session.questionTarget)
    const { buffer, pageCount } = await this.practiceSheetPdf.render({
      date: new Date().toISOString().slice(0, 10),
      position: session.position,
      industry: session.industry,
      interviewerLabel:
        PRACTICE_SHEET_INTERVIEWER_LABEL[session.interviewerType] ?? session.interviewerType,
      questions,
    })
    const safePosition = session.position.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20) || '岗位'
    const uploaded = await this.files.upload({
      buffer,
      filename: `${PRACTICE_SHEET_FILENAME_PREFIX}_${safePosition}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: session.endUserId,
      createdBy: 'mock_interview_practice_sheet',
    })
    await this.audit.write({
      actorId: null,
      actorRole: session.endUserId ? 'enduser' : 'kiosk',
      action: 'mock_interview.practice_sheet_print',
      targetType: 'mock_interview_session',
      targetId: session.id,
      // variant 让审计能区分「用户拿走的是 AI 报告还是通用题目单」——两张纸内容完全不同。
      payload: { fileId: uploaded.fileId, pageCount, questionCount: questions.length, variant: 'degraded' },
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
      /** 恒 'degraded'：本单不含任何模型生成内容，前端据此如实提示用户。 */
      variant: 'degraded' as const,
      questionCount: questions.length,
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

  /**
   * A-6：落 AiServiceLog（仅元数据）。
   * callCount === 0 时不落，避免把配置缺失记成"AI 调用失败"污染告警。
   */
  private recordAiLog(
    sessionId: string,
    operation: 'interviewQuestion' | 'interviewReport',
    usage: AiUsageAccumulator,
    startedAt: number,
    status: 'success' | 'failed',
    endUserId: string | null,
    errorCode?: string,
  ): void {
    if (usage.callCount === 0) return
    this.aiLog.record({
      taskId: sessionId,
      operation,
      provider: usage.provider ?? 'llm',
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      tokenUsage: usage.tokenUsage,
      errorCode,
      endUserId,
      terminalId: null,
    })
  }

  private coalesceKey(sessionId: string, requester: InterviewRequester): string {
    const owner = requester.endUserId
      ? `u:${requester.endUserId}`
      : `t:${hashToken(requester.accessToken ?? '')}`
    return `${sessionId}:${owner}`
  }

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
