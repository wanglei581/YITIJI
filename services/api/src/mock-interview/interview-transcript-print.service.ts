import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { PRINT_ARTIFACT_URL_TTL_MS, signFileUrl } from '../files/signing'
import { interviewReportDisplayDate, type InterviewRequester } from './mock-interview.service'
import { PRACTICE_SHEET_INTERVIEWER_LABEL } from './interview-practice-sheet'
import { InterviewTranscriptPdfService } from './interview-transcript-pdf.service'

// ============================================================
// 打印本场题目和候选人自己的回答。不调用模型，所以 AI 挂了也能出纸。
//
// 不复用 POST :id/report/print：那条要求已经落库的 AI 报告。
// 不复用 POST :id/practice-sheet：那条印的是通用题库和空白行，不是这一场的回答。
//
// 归属校验与 MockInterviewService.printPracticeSheet → loadAuthorized 相同
// （会员本人 / 匿名令牌；过期与越权一律 NOT_FOUND）。这里照抄，是因为那两个方法
// 是 private，而 mock-interview.service.ts 同时有别的改动，本接口不改那个文件。
// ============================================================

export const INTERVIEW_NO_ANSWERS_MESSAGE = '这一场还没有作答，暂时没有可打印的内容'

const TRANSCRIPT_FILENAME_PREFIX = '本场面试作答记录'

export interface TranscriptTurn {
  role: string
  content: string
  skipped: boolean
}

export interface TranscriptItem {
  question: string
  answer: string | null
  skipped: boolean
}

/**
 * 把面试官回合和紧跟的候选人回合配成一题。
 *
 * 跳过的判定：候选人回合 `skipped === true`。
 * `answer()` 在 `input.skip` 时写入 `skipped: true`，content 为「（跳过）」；
 * `buildQaExcerpts` 同样只看 `candidate.skipped === true`，不靠文案猜。
 * 还没答的最后一题（后面没有候选人回合）既不是回答也不是跳过，不印。
 */
export function pairTranscript(turns: readonly TranscriptTurn[], includeSkipped: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i]
    if (!turn || turn.role !== 'interviewer') continue
    const next = turns[i + 1]
    if (!next || next.role !== 'candidate') continue
    if (next.skipped === true) {
      if (includeSkipped) items.push({ question: turn.content, answer: null, skipped: true })
      continue
    }
    const answer = next.content.trim()
    if (!answer) continue
    items.push({ question: turn.content, answer, skipped: false })
  }
  return items
}

export interface TranscriptPrintResult {
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
  printFileUrl: string
  variant: 'transcript'
  questionCount: number
  answerCount: number
}

type SessionRow = NonNullable<Awaited<ReturnType<PrismaService['mockInterviewSession']['findUnique']>>>

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function verifyToken(token: string | null, expectedHash: string | null): boolean {
  if (!token || !expectedHash) return false
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

@Injectable()
export class InterviewTranscriptPrintService {
  private readonly logger = new Logger(InterviewTranscriptPrintService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: InterviewTranscriptPdfService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async print(
    sessionId: string,
    requester: InterviewRequester,
    input: { includeSkipped?: boolean } = {},
  ): Promise<TranscriptPrintResult> {
    const session = await this.loadAuthorized(sessionId, requester)
    const includeSkipped = input.includeSkipped === true
    const turns = await this.prisma.mockInterviewTurn.findMany({
      where: { sessionId: session.id },
      orderBy: { idx: 'asc' },
      select: { role: true, content: true, skipped: true },
    })
    const items = pairTranscript(turns, includeSkipped)
    const answerCount = pairTranscript(turns, false).length
    if (answerCount === 0) {
      throw new BadRequestException({
        error: { code: 'INTERVIEW_NO_ANSWERS', message: INTERVIEW_NO_ANSWERS_MESSAGE },
      })
    }
    const { buffer, pageCount } = await this.pdf.render({
      date: interviewReportDisplayDate(new Date()),
      position: session.position,
      industry: session.industry,
      interviewerLabel: PRACTICE_SHEET_INTERVIEWER_LABEL[session.interviewerType] ?? session.interviewerType,
      items,
    })
    const safePosition = session.position.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20) || '岗位'
    const uploaded = await this.files.upload({
      buffer,
      filename: `${TRANSCRIPT_FILENAME_PREFIX}_${safePosition}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      // 与题目单同一口径：不调模型，也不是用户原件。生产隐私闸门只放行
      // derivationKind=ai_generated 的派生打印稿，否则一体机确认打印会被拒。
      assetCategory: 'derived',
      derivationKind: 'ai_generated',
      uploaderId: null,
      endUserId: session.endUserId,
      createdBy: 'mock_interview_transcript',
    })
    await this.audit.write({
      actorId: null,
      actorRole: session.endUserId ? 'enduser' : 'kiosk',
      action: 'mock_interview.transcript_print',
      targetType: 'mock_interview_session',
      targetId: session.id,
      payload: {
        sessionId: session.id,
        questionCount: items.length,
        answerCount,
        includeSkipped,
      },
      ipAddress: null,
      userAgent: null,
      requestId: null,
    })
    this.logger.log(`interview.transcript_print_ok bytes=${buffer.length} pages=${pageCount} questions=${items.length}`)
    return {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      sizeBytes: uploaded.sizeBytes,
      pageCount,
      signedUrl: uploaded.signedUrl,
      expiresAt: uploaded.signedUrlExpiresAt,
      printFileUrl: signFileUrl(uploaded.fileId, PRINT_ARTIFACT_URL_TTL_MS).url,
      variant: 'transcript',
      questionCount: items.length,
      answerCount,
    }
  }

  /**
   * 与 MockInterviewService.loadAuthorized 相同：会员行只放行本人；
   * 匿名行须正确 accessToken；过期视为不存在。任何拒绝统一 NOT_FOUND。
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
