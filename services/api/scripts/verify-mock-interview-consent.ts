/**
 * 模拟面试的简历 AI 授权。从 verify-mock-interview.ts 拆出，原文件保持拆出前的行数与正向断言。
 *
 * 22   不带简历不核授权，模型照常调用
 * 22a  带简历、未同意 → 403，不调模型，状态回到 configured
 * 22g  游客带简历放行
 * 22b  已同意照常出题
 * 22c  撤回后，新的带简历会话再拒绝
 * 22d  已开始的带简历会话，撤回后：回答出下一题、结束出报告都 403；
 *      模型调用、AI 日志、计量都不增加；会话不被破坏，重新同意后能继续并结束
 *
 * 运行：pnpm --filter @ai-job-print/api verify:mock-interview-consent
 */
process.env['OCR_PROVIDER'] = process.env['OCR_PROVIDER'] ?? 'disabled'
require('dotenv').config()

import { createServer, type Server } from 'http'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { MockInterviewLlmService, type InterviewReportPayload } from '../src/mock-interview/mock-interview-llm.service'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { InterviewReportPdfService } from '../src/mock-interview/interview-report-pdf.service'
import { InterviewPracticeSheetPdfService } from '../src/mock-interview/interview-practice-sheet-pdf.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'
import { AiBudgetService } from '../src/ai/usage/ai-budget.service'
import { flushAiUsageMeter } from '../src/ai/usage/ai-usage-meter'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }

const responseQueue: string[] = []
const llmRequestBodies: string[] = []
function startStub(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        llmRequestBodies.push(body)
        const reply = responseQueue.shift() ?? '{"question":"stub 队列空了","qType":"experience"}'
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({ server, url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` })
    })
  })
}

const q = (question: string, extra: Record<string, unknown> = {}) => JSON.stringify({ question, qType: 'experience', ...extra })

const VALID_REPORT: InterviewReportPayload = {
  overall: { level: 'good', summary: '回答结构清晰，经历有量化支撑。' },
  expression: ['回答有结构'],
  positionFit: ['经历与岗位要求相关'],
  credibility: ['项目细节经得起追问'],
  professional: ['技术理解扎实'],
  adaptability: ['追问下表达稳定'],
  risks: ['部分回答缺少量化数据', '职业动机可以更具体'],
  predictedQuestions: [{ question: '说说你的职业规划', why: '考察稳定性', approach: '结合岗位谈 1-3 年目标' }],
  starAdvice: { s: '先讲背景', t: '说明目标', a: '突出行动', r: '量化结果', reminder: '尽量给出数字' },
  checklist: ['调研公司业务', '准备自我介绍', '准备 3 段经历', '准备反问问题', '确认路线设备'],
}
const reportJson = () => JSON.stringify(VALID_REPORT)

function consentError(e: unknown) {
  const ex = e as { getStatus?: () => number; getResponse?: () => { error?: { code?: string; message?: string } } }
  const body = ex.getResponse?.()
  return { status: ex.getStatus?.() ?? 0, code: body?.error?.code, message: body?.error?.message }
}

async function main() {
  const { server, url } = await startStub()
  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const aiLog = new AiLogService(prisma)
  const privacy = new MemberPrivacyService(prisma)
  const budget = new AiBudgetService(prisma)
  budget.onModuleInit()
  const llm = new MockInterviewLlmService({
    getApiKey: () => 'stub-key',
    getConfig: () => ({
      vendor: 'deepseek', model: 'stub-model', baseURL: url, systemPrompt: '', roleScope: '',
      forbiddenWords: [], temperature: 0, enabled: true, apiKeyEncrypted: 'x',
    }),
  } as never)
  const pdf = new InterviewReportPdfService()
  const practiceSheetPdf = new InterviewPracticeSheetPdfService()
  const inflightKeys = new Set<string>()
  const redis = {
    setNxPx: async (key: string) => {
      if (inflightKeys.has(key)) return false
      inflightKeys.add(key)
      return true
    },
    getAndDelIfEquals: async (key: string) => {
      inflightKeys.delete(key)
      return 'matched'
    },
  } as never
  let llmCalls = 0
  const counting = {
    nextQuestion: async (
      ctx: Parameters<MockInterviewLlmService['nextQuestion']>[0],
      sink?: Parameters<MockInterviewLlmService['nextQuestion']>[1],
    ) => {
      llmCalls += 1
      return llm.nextQuestion(ctx, sink)
    },
    buildReport: async (
      ctx: Parameters<MockInterviewLlmService['buildReport']>[0],
      sink?: Parameters<MockInterviewLlmService['buildReport']>[1],
    ) => {
      llmCalls += 1
      return llm.buildReport(ctx, sink)
    },
  }
  const extraction = {
    extractResumeText: async () => ({
      ok: true,
      text: '做过行政工作三年，熟悉档案整理与会议安排。',
      textSource: 'docx',
      confidence: 'high',
      charCount: 24,
    }),
  }
  const svc = new MockInterviewService(
    prisma, counting as never, pdf, practiceSheetPdf, {} as never, extraction as never, audit, aiLog, privacy, redis,
  )
  const suffix = Date.now().toString(36)
  const endUserA = `vmic_a_${suffix}`
  const cleanupSessionIds: string[] = []
  const baseCfg = { interviewerType: 'tech', industry: '互联网 / AI', position: '前端开发工程师', experience: 'y1_3', difficulty: 'standard', durationMin: 5 }
  const member = { endUserId: endUserA, accessToken: null }
  const startedAt = new Date()

  const snapshot = async () => {
    await aiLog.flush()
    await flushAiUsageMeter()
    const logs = await prisma.aiServiceLog.count({
      where: { endUserId: endUserA, operation: { in: ['interviewQuestion', 'interviewReport'] } },
    })
    const meters = await prisma.aiUsageRecord.count({
      where: { featureKey: 'mock_interview', createdAt: { gte: startedAt } },
    })
    return { llm: llmCalls, bodies: llmRequestBodies.length, logs, meters }
  }

  try {
    await prisma.endUser.create({ data: { id: endUserA, phoneHash: `hash_${endUserA}`, phoneEnc: `enc_${endUserA}` } })

    const bare = await svc.createSession(baseCfg, member)
    cleanupSessionIds.push(bare.sessionId)
    const beforeBare = await snapshot()
    responseQueue.push(q('请自我介绍', { qType: 'intro' }))
    await svc.start(bare.sessionId, member)
    const afterBare = await snapshot()
    if (afterBare.llm !== beforeBare.llm + 1 || afterBare.bodies !== beforeBare.bodies + 1) fail('22. 不带简历应照常出题')
    if (afterBare.logs !== beforeBare.logs + 1 || afterBare.meters !== beforeBare.meters + 1) fail('22. 不带简历的成功出题应留下日志和计量（后面的「不增加」才有对照）')
    pass('22. 不带简历的模拟面试不核授权，模型照常调用')

    const withResume = await svc.createSession({ ...baseCfg, resumeFileId: `resume_${suffix}` }, member)
    cleanupSessionIds.push(withResume.sessionId)
    const beforeDeny = await snapshot()
    try {
      await svc.start(withResume.sessionId, member)
      fail('22a. 未同意不应出题')
    } catch (e) {
      const info = consentError(e)
      if (info.status !== 403 || info.code !== 'USER_AI_CONSENT_REQUIRED' || info.message !== '请先确认简历 AI 服务授权') {
        fail(`22a. 拒绝形态不符: ${JSON.stringify(info)}`)
      }
    }
    const afterDeny = await snapshot()
    if (afterDeny.llm !== beforeDeny.llm || afterDeny.bodies !== beforeDeny.bodies || afterDeny.logs !== beforeDeny.logs || afterDeny.meters !== beforeDeny.meters) {
      fail('22a. 未同意时增加了模型、日志或计量')
    }
    const deniedRow = await prisma.mockInterviewSession.findUnique({ where: { id: withResume.sessionId } })
    if (deniedRow?.status !== 'configured') fail(`22a. 拒绝后状态应回到 configured，实际 ${deniedRow?.status}`)
    pass('22a. 带简历未同意 → 403，模型、日志、计量未增加，会话未停在进行中')

    const guestCreated = await svc.createSession(
      { ...baseCfg, resumeFileId: `resume_guest_${suffix}` },
      { endUserId: null, accessToken: null },
    )
    cleanupSessionIds.push(guestCreated.sessionId)
    responseQueue.push(q('请自我介绍', { qType: 'intro' }))
    const beforeGuest = llmCalls
    await svc.start(guestCreated.sessionId, { endUserId: null, accessToken: guestCreated.accessToken ?? null })
    if (llmCalls !== beforeGuest + 1) fail('22g. 游客带简历应照常出题')
    pass('22g. 游客带简历不拦截')

    await privacy.grantConsent(endUserA, 'resume_ai', null)
    responseQueue.push(q('请自我介绍', { qType: 'intro' }))
    const beforeOk = llmCalls
    const started = await svc.start(withResume.sessionId, member)
    if (!started.question || llmCalls !== beforeOk + 1) fail('22b. 已同意应出题')
    pass('22b. 带简历已同意 → 照常出题')

    await privacy.revokeConsent(endUserA, 'resume_ai')
    const again = await svc.createSession({ ...baseCfg, resumeFileId: `resume_revoked_${suffix}` }, member)
    cleanupSessionIds.push(again.sessionId)
    const beforeRevoke = await snapshot()
    try {
      await svc.start(again.sessionId, member)
      fail('22c. 撤回后不应出题')
    } catch (e) {
      const info = consentError(e)
      if (info.status !== 403 || info.code !== 'USER_AI_CONSENT_REQUIRED' || info.message !== '请先确认简历 AI 服务授权') {
        fail(`22c. 撤回后拒绝形态不符: ${JSON.stringify(info)}`)
      }
    }
    const afterRevoke = await snapshot()
    if (afterRevoke.llm !== beforeRevoke.llm || afterRevoke.bodies !== beforeRevoke.bodies || afterRevoke.logs !== beforeRevoke.logs || afterRevoke.meters !== beforeRevoke.meters) {
      fail('22c. 撤回后仍增加了模型、日志或计量')
    }
    pass('22c. 同意后撤回 → 带简历再次拒绝且未调模型')

    // 22d. 进行中再撤回：先在仍同意时答过一题，否则结束会先被「没有任何回答」挡住，到不了授权检查。
    await privacy.grantConsent(endUserA, 'resume_ai', null)
    const live = await svc.createSession({ ...baseCfg, resumeFileId: `resume_live_${suffix}` }, member)
    cleanupSessionIds.push(live.sessionId)
    const savedAnswer = '我做过会议记录和档案整理。'
    responseQueue.push(q('请自我介绍', { qType: 'intro' }))
    await svc.start(live.sessionId, member)
    responseQueue.push(q('第二题：说一件具体的事', { qType: 'experience' }))
    const firstAnswer = await svc.answer(live.sessionId, { answer: savedAnswer }, member)
    if (firstAnswer.done || !('question' in firstAnswer) || !firstAnswer.question) fail('22d. 同意期间应给出下一题，而不是结束')
    const granted = await snapshot()
    const turnsBefore = await prisma.mockInterviewTurn.count({ where: { sessionId: live.sessionId } })
    const liveRow = await prisma.mockInterviewSession.findUnique({ where: { id: live.sessionId } })
    if (liveRow?.status !== 'in_progress' || liveRow.endedAt !== null) fail(`22d. 撤回前应仍在进行中，实际 ${liveRow?.status}`)
    if (await prisma.mockInterviewReport.findUnique({ where: { sessionId: live.sessionId } })) fail('22d. 撤回前不应已有报告')

    await privacy.revokeConsent(endUserA, 'resume_ai')
    try {
      await svc.answer(live.sessionId, { answer: '撤回后不该被记下的回答' }, member)
      fail('22d. 撤回后回答不应出下一题')
    } catch (e) {
      const info = consentError(e)
      if (info.status !== 403 || info.code !== 'USER_AI_CONSENT_REQUIRED' || info.message !== '请先确认简历 AI 服务授权') {
        fail(`22d. 回答拒绝形态不符: ${JSON.stringify(info)}`)
      }
    }
    const afterAnswerDeny = await snapshot()
    if (afterAnswerDeny.llm !== granted.llm || afterAnswerDeny.bodies !== granted.bodies || afterAnswerDeny.logs !== granted.logs || afterAnswerDeny.meters !== granted.meters) {
      fail(`22d. 撤回后回答仍增加了模型、日志或计量 ${JSON.stringify(granted)} → ${JSON.stringify(afterAnswerDeny)}`)
    }
    if (await prisma.mockInterviewTurn.count({ where: { sessionId: live.sessionId } }) !== turnsBefore) fail('22d. 拒绝的回答被写进了会话')

    try {
      await svc.end(live.sessionId, member)
      fail('22d. 撤回后结束不应生成报告')
    } catch (e) {
      const info = consentError(e)
      if (info.status !== 403 || info.code !== 'USER_AI_CONSENT_REQUIRED' || info.message !== '请先确认简历 AI 服务授权') {
        fail(`22d. 结束拒绝形态不符: ${JSON.stringify(info)}`)
      }
    }
    const afterEndDeny = await snapshot()
    if (afterEndDeny.llm !== granted.llm || afterEndDeny.bodies !== granted.bodies || afterEndDeny.logs !== granted.logs || afterEndDeny.meters !== granted.meters) {
      fail(`22d. 撤回后结束仍增加了模型、日志或计量 ${JSON.stringify(granted)} → ${JSON.stringify(afterEndDeny)}`)
    }
    const held = await prisma.mockInterviewSession.findUnique({ where: { id: live.sessionId } })
    const kept = await prisma.mockInterviewTurn.findFirst({ where: { sessionId: live.sessionId, role: 'candidate' } })
    if (held?.status !== 'in_progress' || held.endedAt !== null) fail(`22d. 拒绝结束应把会话留在进行中，实际 ${held?.status} endedAt=${held?.endedAt?.toISOString() ?? 'null'}`)
    if (await prisma.mockInterviewReport.findUnique({ where: { sessionId: live.sessionId } })) fail('22d. 拒绝结束不应留下报告')
    if (kept?.content !== savedAnswer) fail('22d. 已保存的回答被改掉了')
    if (await prisma.mockInterviewTurn.count({ where: { sessionId: live.sessionId } }) !== turnsBefore) fail('22d. 拒绝结束改变了回合数')

    await privacy.grantConsent(endUserA, 'resume_ai', null)
    responseQueue.push(q('第三题：还可以怎么做', { qType: 'experience' }))
    const continued = await svc.answer(live.sessionId, { answer: '重新同意后继续作答。' }, member)
    if (continued.done || !('question' in continued) || !continued.question) fail('22d. 重新同意后应能继续出下一题')
    responseQueue.push(reportJson())
    const ended = await svc.end(live.sessionId, member)
    if (!ended.report) fail('22d. 重新同意后应能照现有逻辑结束并生成报告')
    const finished = await prisma.mockInterviewSession.findUnique({ where: { id: live.sessionId } })
    if (finished?.status !== 'completed' || !finished.endedAt) fail(`22d. 结束后状态应为 completed，实际 ${finished?.status}`)
    const resumed = await snapshot()
    if (resumed.llm !== granted.llm + 2 || resumed.logs !== granted.logs + 2 || resumed.meters !== granted.meters + 2) {
      fail(`22d. 重新同意后的继续与结束应各增加一次模型、日志和计量 ${JSON.stringify(granted)} → ${JSON.stringify(resumed)}`)
    }
    pass('22d. 进行中撤回：回答与结束都 403，模型、日志、计量不增加，重新同意后能继续并结束')

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    budget.onModuleDestroy()
    await prisma.mockInterviewSession.deleteMany({ where: { id: { in: cleanupSessionIds } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { targetType: 'mock_interview_session', targetId: { in: cleanupSessionIds } } }).catch(() => undefined)
    await prisma.aiServiceLog.deleteMany({ where: { endUserId: endUserA } }).catch(() => undefined)
    await prisma.aiUsageRecord.deleteMany({ where: { featureKey: 'mock_interview', createdAt: { gte: startedAt } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: endUserA } }).catch(() => undefined)
    server.close()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
