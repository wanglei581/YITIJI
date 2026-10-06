import { BadRequestException } from '@nestjs/common'
import { AiUsageAccumulator, aiErrorCodeOf, type AiLlmCallSink } from '../ai/ai-log.service'
import { runWithAiQuota } from '../ai/quota/ai-quota-run'
import type { AiQuotaService } from '../ai/quota/ai-quota.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { MockInterviewLlmService, NextQuestionInput, NextQuestionOutput } from './mock-interview-llm.service'

export interface InterviewChargeRequester {
  endUserId: string | null
  accessToken: string | null
}

/** 一场面试只在首题下发时计一次。从 MockInterviewService 拆出，避免服务文件变长。 */
export interface InterviewChargeRunInput<T> {
  endUserId?: string | null
  operationKey: string
  loadStored?: () => Promise<T | null>
  work: () => Promise<T>
  saveResult: (value: T) => Promise<string>
}

export interface InterviewFirstQuestion {
  question: string
  qType: string
  questionIndex: number
  questionTarget: number
  done: false
}

export interface InterviewChargeSession {
  id: string
  endUserId: string | null
  questionTarget: number
  interviewerType: string
  industry: string
  position: string
  experience: string
  difficulty: string
  resumeDigest: string | null
}

type RunWithAiQuota = typeof runWithAiQuota

export interface InterviewStartDeps {
  prisma: PrismaService
  llm: Pick<MockInterviewLlmService, 'nextQuestion'>
  loadAuthorized(sessionId: string, requester: InterviewChargeRequester): Promise<InterviewChargeSession>
  llmCtx(session: InterviewChargeSession): Omit<NextQuestionInput, 'askedCount' | 'transcript'>
  recordAiLog(
    sessionId: string,
    operation: 'interviewQuestion',
    usage: Pick<AiUsageAccumulator, 'callCount' | 'provider' | 'tokenUsage'>,
    startedAt: number,
    status: 'success' | 'failed',
    endUserId: string | null,
    errorCode?: string,
  ): void
}

interface AnswerTurn {
  idx: number
  role: string
  qType: string | null
  content: string
  skipped: boolean
}

export interface InterviewAnswerDraft {
  answer?: string
  skip?: boolean
  inputMode?: string
  transcriptText?: string
  transcriptEdited?: boolean
  answerDurationSec?: number
}

/**
 * 没有账本或没有登录身份时不预占，仍执行并保存。
 * 有身份时交给 runWithAiQuota：先读已下发的首题，再预占。
 */
export function executeInterviewCharge<T>(
  quota: AiQuotaService | undefined,
  input: InterviewChargeRunInput<T>,
  gate: { bucket: 'ai_interview'; runWithAiQuota: RunWithAiQuota },
): Promise<T> {
  if (!quota || !input.endUserId) {
    return input.work().then(async (value) => {
      await input.saveResult(value)
      return value
    })
  }
  return gate.runWithAiQuota({
    quota,
    bucket: gate.bucket,
    operationKey: input.operationKey,
    endUserId: input.endUserId,
    loadStored: input.loadStored,
  }, input.work, input.saveResult)
}

export async function loadFirstQuestion(
  prisma: PrismaService,
  session: Pick<InterviewChargeSession, 'id' | 'questionTarget'>,
): Promise<InterviewFirstQuestion | null> {
  const turn = await prisma.mockInterviewTurn.findFirst({
    where: { sessionId: session.id, role: 'interviewer' },
    orderBy: { idx: 'asc' },
  })
  if (!turn) return null
  return {
    question: turn.content,
    qType: turn.qType ?? 'intro',
    questionIndex: 1,
    questionTarget: session.questionTarget,
    done: false,
  }
}

/** 首题成功下发才结算。已有首题直接返回。失败沿用回滚到 configured 的路径。 */
export async function executeInterviewStart(
  deps: InterviewStartDeps,
  sessionId: string,
  requester: InterviewChargeRequester,
  runCharge: <T>(input: InterviewChargeRunInput<T>) => Promise<T>,
): Promise<InterviewFirstQuestion> {
  const session = await deps.loadAuthorized(sessionId, requester)
  const stored = await loadFirstQuestion(deps.prisma, session)
  if (stored) return stored
  return runCharge({
    endUserId: session.endUserId,
    operationKey: `interview:${session.id}`,
    loadStored: () => loadFirstQuestion(deps.prisma, session),
    work: () => askFirstQuestion(deps, session),
    saveResult: async () => session.id,
  })
}

async function askFirstQuestion(deps: InterviewStartDeps, session: InterviewChargeSession): Promise<InterviewFirstQuestion> {
  const claimed = await deps.prisma.mockInterviewSession.updateMany({
    where: { id: session.id, status: 'configured' },
    data: { status: 'in_progress', startedAt: new Date() },
  })
  if (claimed.count === 0) {
    throw new BadRequestException({ error: { code: 'INTERVIEW_ALREADY_STARTED', message: '本场练习已开始或已结束' } })
  }
  const usage = new AiUsageAccumulator()
  const startedAt = Date.now()
  try {
    const q = await deps.llm.nextQuestion({ ...deps.llmCtx(session), askedCount: 0, transcript: [] }, usage.add)
    deps.recordAiLog(session.id, 'interviewQuestion', usage, startedAt, 'success', session.endUserId)
    const content = q.greeting ? `${q.greeting}\n${q.question}` : q.question
    await deps.prisma.mockInterviewTurn.create({
      data: { sessionId: session.id, idx: 0, role: 'interviewer', qType: q.qType, content },
    })
    return { question: content, qType: q.qType, questionIndex: 1, questionTarget: session.questionTarget, done: false }
  } catch (error) {
    deps.recordAiLog(session.id, 'interviewQuestion', usage, startedAt, 'failed', session.endUserId, aiErrorCodeOf(error, 'AI_INTERVIEW_QUESTION_FAILED'))
    await deps.prisma.$transaction([
      deps.prisma.mockInterviewTurn.deleteMany({ where: { sessionId: session.id } }),
      deps.prisma.mockInterviewSession.updateMany({
        where: { id: session.id, status: 'in_progress' },
        data: { status: 'configured', startedAt: null },
      }),
    ])
    throw error
  }
}

export interface InterviewAnswerDeps {
  prisma: PrismaService
  llm: Pick<MockInterviewLlmService, 'nextQuestion'>
  llmCtx(session: InterviewChargeSession): Omit<NextQuestionInput, 'askedCount' | 'transcript'>
  recordAiLog: InterviewStartDeps['recordAiLog']
}

/** 同一道未完成的题只向模型要一次下一题。已落库的下一题直接返回。 */
export async function deliverNextInterviewQuestion(
  deps: InterviewAnswerDeps,
  input: {
    session: InterviewChargeSession
    turns: AnswerTurn[]
    asked: number
    lastIsCandidate: boolean
    lastIdx: number
    draft: InterviewAnswerDraft
    transcript: NextQuestionInput['transcript']
  },
): Promise<InterviewFirstQuestion> {
  const stored = await storedNextQuestion(deps.prisma, input)
  if (stored) return stored
  const qUsage = new AiUsageAccumulator()
  const qStartedAt = Date.now()
  let q: NextQuestionOutput
  try {
    q = await deps.llm.nextQuestion(
      { ...deps.llmCtx(input.session), askedCount: input.asked, transcript: input.transcript },
      qUsage.add as AiLlmCallSink,
    )
  } catch (error) {
    deps.recordAiLog(input.session.id, 'interviewQuestion', qUsage, qStartedAt, 'failed', input.session.endUserId, aiErrorCodeOf(error, 'AI_INTERVIEW_QUESTION_FAILED'))
    throw error
  }
  deps.recordAiLog(input.session.id, 'interviewQuestion', qUsage, qStartedAt, 'success', input.session.endUserId)
  try {
    await deps.prisma.$transaction(async (tx) => {
      if (!input.lastIsCandidate) {
        await tx.mockInterviewTurn.create({ data: candidateTurn(input) })
      }
      await tx.mockInterviewTurn.create({
        data: {
          sessionId: input.session.id,
          idx: input.lastIsCandidate ? input.turns.length : input.turns.length + 1,
          role: 'interviewer',
          qType: q.qType,
          content: q.question,
        },
      })
    })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const again = await storedNextQuestion(deps.prisma, input)
    if (again) return again
    throw new BadRequestException({ error: { code: 'INTERVIEW_TURN_CONFLICT', message: '本题已提交，请刷新后继续' } })
  }
  return {
    done: false,
    question: q.question,
    qType: q.qType,
    questionIndex: input.asked + 1,
    questionTarget: input.session.questionTarget,
  }
}

async function storedNextQuestion(
  prisma: PrismaService,
  input: { session: InterviewChargeSession; turns: AnswerTurn[]; lastIsCandidate: boolean; lastIdx: number },
): Promise<InterviewFirstQuestion | null> {
  const fresh = await prisma.mockInterviewTurn.findMany({
    where: { sessionId: input.session.id },
    orderBy: { idx: 'asc' },
  })
  const openIdx = input.lastIsCandidate
    ? input.turns.reduce((open, turn) => (turn.role === 'interviewer' && turn.idx < input.lastIdx ? turn.idx : open), -1)
    : input.lastIdx
  const next = fresh.find((turn) => turn.role === 'interviewer' && turn.idx > openIdx)
  if (!next) return null
  const asked = fresh.filter((turn) => turn.role === 'interviewer').length
  return {
    question: next.content,
    qType: next.qType ?? 'experience',
    questionIndex: asked,
    questionTarget: input.session.questionTarget,
    done: false,
  }
}

function candidateTurn(input: {
  session: InterviewChargeSession
  turns: AnswerTurn[]
  draft: InterviewAnswerDraft
}): {
  sessionId: string
  idx: number
  role: 'candidate'
  content: string
  skipped: boolean
  inputMode: string
  transcriptText: string | null
  transcriptEdited: boolean
  answerDurationSec: number | null
} {
  const draft = input.draft
  return {
    sessionId: input.session.id,
    idx: input.turns.length,
    role: 'candidate',
    content: draft.skip ? '（跳过）' : (draft.answer ?? '').trim().slice(0, 2000),
    skipped: !!draft.skip,
    inputMode: draft.inputMode === 'voice' ? 'voice' : 'text',
    transcriptText: draft.transcriptText?.slice(0, 2000) ?? null,
    transcriptEdited: draft.transcriptEdited === true,
    answerDurationSec: typeof draft.answerDurationSec === 'number' ? Math.max(0, Math.min(600, Math.round(draft.answerDurationSec))) : null,
  }
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002')
}
