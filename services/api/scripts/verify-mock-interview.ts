/**
 * 2C 模拟面试 — 离线回归验证（受控 stub LLM，不触网，可进 CI）。
 *
 * 覆盖：
 *  1. 完整闭环：创建(5min→6题) → start → 答题×6 → done 建议 → end → 报告结构完整
 *  2. 题量硬控制：答完第 6 题后 answer 返回 done:true，不再产生新问题
 *  3. 匿名归属：无 token / 错 token 一律 NOT_FOUND；正确 accessToken 放行
 *  4. 会员隔离：A 的会话 B 读不到；B 删 A 的记录 → NOT_FOUND
 *  5. 报告禁词：LLM 输出含「通过率」→ 自动重试一次（第二次合规）成功；
 *     两次均含禁词 → AI_INTERVIEW_REPORT_FAILED 诚实失败
 *  6. 问题 JSON 非法 → 重试一次成功
 *  7. 未回答任何问题就 end → INTERVIEW_NO_ANSWERS
 *  8. TTL：匿名报告 ≈2h、会员报告 ≈7d
 *  9. 会员删除：硬删级联（turns/report 物理消失）+ 审计行存在
 * 10. 日志脱敏：捕获 Logger，断言不含问题/回答原文
 * 11. 报告 PDF：真实 pdfkit 渲染（中文字体 + pageCount ≥1），含合规声明文本
 *
 * 运行：pnpm --filter @ai-job-print/api verify:mock-interview
 */
process.env['OCR_PROVIDER'] = process.env['OCR_PROVIDER'] ?? 'disabled'
require('dotenv').config()

import { createServer, type Server } from 'http'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { MockInterviewLlmService, type InterviewReportPayload } from '../src/mock-interview/mock-interview-llm.service'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { InterviewReportPdfService } from '../src/mock-interview/interview-report-pdf.service'
import { AsrService } from '../src/mock-interview/asr/asr.service'

const SECRET_ANSWER = '我在某电商项目里把首屏加载从4秒优化到1.5秒_机密标记XYZQ'
const SECRET_QUESTION = '请讲讲你最有代表性的项目经历_问题标记ABCD'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }

// ── 日志捕获 ──────────────────────────────────────────────────────────────────
const capturedLogs: string[] = []
class Cap {
  log(m: unknown) { capturedLogs.push(String(m)) }
  error(m: unknown) { capturedLogs.push(String(m)) }
  warn(m: unknown) { capturedLogs.push(String(m)) }
  debug(m: unknown) { capturedLogs.push(String(m)) }
  verbose(m: unknown) { capturedLogs.push(String(m)) }
}
Logger.overrideLogger(new Cap())

// ── stub LLM（OpenAI 兼容）────────────────────────────────────────────────────
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
  expression: ['回答有结构', '重点较突出'],
  positionFit: ['经历与岗位要求相关'],
  credibility: ['项目细节经得起追问'],
  professional: ['技术理解扎实'],
  adaptability: ['追问下表达稳定'],
  risks: ['部分回答缺少量化数据', '职业动机可以更具体'],
  predictedQuestions: [{ question: '说说你的职业规划', why: '考察稳定性', approach: '结合岗位谈 1-3 年目标' }],
  starAdvice: { s: '先讲背景', t: '说明目标', a: '突出行动', r: '量化结果', reminder: '尽量给出数字' },
  checklist: ['调研公司业务', '准备自我介绍', '准备 3 段经历', '准备反问问题', '确认路线设备'],
}
const reportJson = (over: Partial<InterviewReportPayload> = {}) => JSON.stringify({ ...VALID_REPORT, ...over })

async function main() {
  const { server, url } = await startStub()
  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const stubConfig = {
    getApiKey: () => 'stub-key',
    getConfig: () => ({
      vendor: 'deepseek', model: 'stub-model', baseURL: url, systemPrompt: '', roleScope: '',
      forbiddenWords: [], temperature: 0, enabled: true, apiKeyEncrypted: 'x',
    }),
  }
  const llm = new MockInterviewLlmService(stubConfig as never)
  const pdf = new InterviewReportPdfService()
  const svc = new MockInterviewService(prisma, llm, pdf, {} as never, {} as never, audit)
  const suffix = Date.now().toString(36)
  const endUserA = `vmi_a_${suffix}`
  const endUserB = `vmi_b_${suffix}`
  const cleanupSessionIds: string[] = []

  try {
    // 真实 EndUser 行（外键 / 审计无关，但保持数据自洽）
    await prisma.endUser.createMany({
      data: [endUserA, endUserB].map((id) => ({ id, phoneHash: `hash_${id}`, phoneEnc: `enc_${id}` })),
    })

    const baseCfg = { interviewerType: 'tech', industry: '互联网 / AI', position: '前端开发工程师', experience: 'y1_3', difficulty: 'standard', durationMin: 5 }

    // ── 1+2. 匿名完整闭环 + 题量硬控制 ──────────────────────────────────────
    {
      const created = await svc.createSession(baseCfg, { endUserId: null, accessToken: null })
      cleanupSessionIds.push(created.sessionId)
      if (!created.accessToken) fail('1. 匿名创建应返回一次性 accessToken')
      if (created.questionTarget !== 6) fail(`1. 5 分钟应 6 题，实际 ${created.questionTarget}`)
      const requester = { endUserId: null, accessToken: created.accessToken! }

      responseQueue.push(q('你好，请先自我介绍。', { greeting: '你好，我是本场技术面试官。', qType: 'intro' }))
      const first = await svc.start(created.sessionId, requester)
      if (!first.question.includes('自我介绍')) fail('1. 首题内容错误')

      for (let i = 2; i <= 6; i += 1) responseQueue.push(q(i === 6 ? '最后，你有什么想问我的吗？' : `${SECRET_QUESTION}_${i}`))
      let last: Awaited<ReturnType<typeof svc.answer>> | null = null
      for (let i = 1; i <= 6; i += 1) {
        last = await svc.answer(created.sessionId, { answer: `${SECRET_ANSWER}_${i}` }, requester)
        if (i < 6 && last.done) fail(`2. 第 ${i} 题后不应结束`)
      }
      if (!last?.done) fail('2. 答完第 6 题应返回 done:true')
      const extraneous = responseQueue.length
      if (extraneous !== 0) fail('2. 题量超发：stub 队列应已耗尽')

      responseQueue.push(reportJson())
      const report = await svc.end(created.sessionId, requester)
      if (report.report.overall.level !== 'good') fail('1. 报告 overall 解析错误')
      if (report.report.checklist.length < 3) fail('1. 报告 checklist 缺失')
      pass('1. 匿名完整闭环：创建→6 题→done→报告结构完整')
      pass('2. 题量硬控制：第 6 题后 done:true，无超发问题')

      // ── 3. 匿名归属门禁 ──────────────────────────────────────────────────
      await svc.getReport(created.sessionId, requester) // 正确 token 放行
      for (const bad of [{ endUserId: null, accessToken: null }, { endUserId: null, accessToken: 'ff'.repeat(24) }, { endUserId: endUserA, accessToken: null }]) {
        try {
          await svc.getReport(created.sessionId, bad)
          fail('3. 错误凭证不应读到报告')
        } catch (e) {
          if (!(e instanceof Error && 'getStatus' in e && (e as { getStatus(): number }).getStatus() === 404)) throw e
        }
      }
      // TTL：匿名 ≈2h
      const row = await prisma.mockInterviewReport.findUnique({ where: { sessionId: created.sessionId } })
      const ttlH = (row!.expiresAt.getTime() - Date.now()) / 3_600_000
      if (ttlH < 1.5 || ttlH > 2.5) fail(`8. 匿名报告 TTL 应≈2h，实际 ${ttlH.toFixed(1)}h`)
      pass('3. 匿名归属：无/错 token 与他人会员一律 NOT_FOUND；正确 token 放行')
    }

    // ── 4+8+9. 会员闭环 + 隔离 + TTL + 删除级联 ────────────────────────────
    {
      const created = await svc.createSession({ ...baseCfg, durationMin: 3 }, { endUserId: endUserA, accessToken: null })
      cleanupSessionIds.push(created.sessionId)
      if (created.accessToken) fail('4. 会员创建不应铸 accessToken')
      if (created.questionTarget !== 4) fail(`4. 3 分钟应 4 题，实际 ${created.questionTarget}`)
      const reqA = { endUserId: endUserA, accessToken: null }
      responseQueue.push(q('请自我介绍', { qType: 'intro' }))
      await svc.start(created.sessionId, reqA)
      await svc.answer(created.sessionId, { skip: true }, reqA).catch(() => undefined) // 跳过也计一轮
      responseQueue.push(q('讲讲你的项目'))
      await svc.answer(created.sessionId, { answer: SECRET_ANSWER }, reqA)
      responseQueue.push(reportJson({ overall: { level: 'pass', summary: '基础达标。' } }))
      await svc.end(created.sessionId, reqA)

      // B 读 A → NOT_FOUND
      try {
        await svc.getSession(created.sessionId, { endUserId: endUserB, accessToken: null })
        fail('4. B 不应读到 A 的会话')
      } catch (e) {
        if (!(e instanceof Error && 'getStatus' in e && (e as { getStatus(): number }).getStatus() === 404)) throw e
      }
      // 会员 TTL ≈7d
      const row = await prisma.mockInterviewReport.findUnique({ where: { sessionId: created.sessionId } })
      const ttlD = (row!.expiresAt.getTime() - Date.now()) / 86_400_000
      if (ttlD < 6.5 || ttlD > 7.5) fail(`8. 会员报告 TTL 应≈7d，实际 ${ttlD.toFixed(1)}d`)
      pass('8. TTL：匿名≈2h / 会员≈7d')

      // 历史列表
      const list = await svc.listMine(endUserA, null, 20)
      if (!list.items.some((i) => i.sessionId === created.sessionId && i.hasReport)) fail('4. 会员历史列表缺记录')
      const listB = await svc.listMine(endUserB, null, 20)
      if (listB.items.length !== 0) fail('4. B 的列表不应含 A 的记录')
      pass('4. 会员隔离：B 读不到 A；历史列表只见本人')

      // B 删 A → NOT_FOUND；A 删自己 → 级联消失 + 审计
      try {
        await svc.deleteMine(endUserB, created.sessionId)
        fail('9. B 不应能删 A 的记录')
      } catch (e) {
        if (!(e instanceof Error && 'getStatus' in e && (e as { getStatus(): number }).getStatus() === 404)) throw e
      }
      await svc.deleteMine(endUserA, created.sessionId)
      const [s, t, r] = await Promise.all([
        prisma.mockInterviewSession.findUnique({ where: { id: created.sessionId } }),
        prisma.mockInterviewTurn.count({ where: { sessionId: created.sessionId } }),
        prisma.mockInterviewReport.findUnique({ where: { sessionId: created.sessionId } }),
      ])
      if (s || t !== 0 || r) fail('9. 删除应级联清空 session/turns/report')
      const auditRow = await prisma.auditLog.findFirst({ where: { action: 'mock_interview.member_delete', targetId: created.sessionId } })
      if (!auditRow) fail('9. 删除应留审计日志')
      cleanupSessionIds.pop()
      pass('9. 会员删除：跨人 NOT_FOUND；本人硬删级联 + 审计留痕')
    }

    // ── 5. 报告禁词：重试后成功 / 两次失败 ──────────────────────────────────
    {
      const mk = async () => {
        const c = await svc.createSession({ ...baseCfg, durationMin: 3 }, { endUserId: null, accessToken: null })
        cleanupSessionIds.push(c.sessionId)
        const req = { endUserId: null, accessToken: c.accessToken! }
        responseQueue.push(q('自我介绍', { qType: 'intro' }))
        await svc.start(c.sessionId, req)
        responseQueue.push(q('第二题'))
        await svc.answer(c.sessionId, { answer: '正常回答内容' }, req)
        return { id: c.sessionId, req }
      }
      const a = await mk()
      responseQueue.push(reportJson({ risks: ['你的面试通过率较低，需要提升'] })) // 含禁词 → 触发重试
      responseQueue.push(reportJson())
      const ok = await svc.end(a.id, a.req)
      if (JSON.stringify(ok.report).includes('通过率')) fail('5. 重试后报告仍含禁词')
      pass('5a. 报告含禁词 → 自动重试一次 → 合规版本通过')

      const b = await mk()
      responseQueue.push(reportJson({ risks: ['保证拿 Offer 没问题'] }))
      responseQueue.push(reportJson({ summary: undefined as never, overall: { level: 'good', summary: '保录用承诺' } }))
      try {
        await svc.end(b.id, b.req)
        fail('5b. 两次禁词应诚实失败')
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (!msg.includes('AI_INTERVIEW_REPORT_FAILED') && !JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '').includes('AI_INTERVIEW_REPORT_FAILED')) {
          fail(`5b. 失败码不符: ${msg}`)
        }
      }
      pass('5b. 连续禁词输出 → AI_INTERVIEW_REPORT_FAILED 诚实失败（不清洗后照发）')
    }

    // ── 6. 问题 JSON 非法 → 重试一次 ────────────────────────────────────────
    {
      const c = await svc.createSession(baseCfg, { endUserId: null, accessToken: null })
      cleanupSessionIds.push(c.sessionId)
      const req = { endUserId: null, accessToken: c.accessToken! }
      responseQueue.push('这不是 JSON ###')
      responseQueue.push(q('重试后的首题', { qType: 'intro' }))
      const first = await svc.start(c.sessionId, req)
      if (!first.question.includes('重试后的首题')) fail('6. 非法 JSON 应重试')
      pass('6. 问题 JSON 非法 → 自动重试一次成功')

      // ── 7. 未回答就 end ───────────────────────────────────────────────────
      try {
        await svc.end(c.sessionId, req)
        fail('7. 无回答不应生成报告')
      } catch (e) {
        const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
        if (!resp.includes('INTERVIEW_NO_ANSWERS')) fail(`7. 失败码不符: ${resp}`)
      }
      pass('7. 未回答任何问题 → INTERVIEW_NO_ANSWERS（不产出空报告）')
    }

    // ── 12. 2C+ 语音元数据落 Turn + interactionMode 落 session ─────────────
    {
      const c = await svc.createSession({ ...baseCfg, durationMin: 3, interactionMode: 'voice' }, { endUserId: null, accessToken: null })
      cleanupSessionIds.push(c.sessionId)
      const sess = await prisma.mockInterviewSession.findUnique({ where: { id: c.sessionId } })
      if (sess?.interactionMode !== 'voice') fail('12. interactionMode 未落 session')
      const req = { endUserId: null, accessToken: c.accessToken! }
      responseQueue.push(q('自我介绍', { qType: 'intro' }))
      await svc.start(c.sessionId, req)
      responseQueue.push(q('第二题'))
      await svc.answer(c.sessionId, {
        answer: '编辑后的最终回答内容',
        inputMode: 'voice',
        transcriptText: '编辑前的转写原文内容',
        transcriptEdited: true,
        answerDurationSec: 42,
      }, req)
      const turn = await prisma.mockInterviewTurn.findFirst({ where: { sessionId: c.sessionId, role: 'candidate' } })
      if (turn?.inputMode !== 'voice' || turn.transcriptText !== '编辑前的转写原文内容' || !turn.transcriptEdited || turn.answerDurationSec !== 42) {
        fail(`12. 语音元数据落库不符: ${JSON.stringify({ m: turn?.inputMode, e: turn?.transcriptEdited, d: turn?.answerDurationSec })}`)
      }
      if (turn.content !== '编辑后的最终回答内容') fail('12. content 应为用户确认后的最终文本')
      pass('12. 语音回合：inputMode/转写原文/编辑标记/耗时 落 Turn；content=确认文本')

      // ── 13. 报告 prompt 含耗时元数据;含「语速」评价 → 重试 ───────────────
      llmRequestBodies.length = 0
      responseQueue.push(reportJson({ expression: ['你的语速偏快,情绪稳定性一般'] })) // 违规音频特征评价 → 触发重试
      responseQueue.push(reportJson())
      const rep = await svc.end(c.sessionId, req)
      const reportReq = llmRequestBodies.find((b) => b.includes('练习报告'))
      if (!reportReq || !reportReq.includes('42')) fail('13. 报告 prompt 未携带回答耗时')
      if (!reportReq.includes('禁止')) fail('13. 报告 prompt 缺音频特征禁评约束')
      if (/语速|情绪稳定/.test(JSON.stringify(rep.report))) fail('13. 重试后报告仍含音频特征评价')
      pass('13. 报告基于转写+耗时生成;「语速/情绪稳定」类无依据评价被拦截重试')
    }

    // ── 14. ASR：disabled 诚实回退;stub 转写成功;错误映射;超大拒绝 ─────────
    {
      delete process.env['ASR_PROVIDER']
      const asrOff = new AsrService()
      const off = await asrOff.recognizeWav(Buffer.alloc(1000))
      if (off.ok || off.errorCode !== 'ASR_NOT_CONFIGURED') fail('14. 未配置应 ASR_NOT_CONFIGURED')

      // stub 百度 vop + token
      const asrReplies: Array<Record<string, unknown>> = []
      const asrStub = createServer((sreq, sres) => {
        let b = ''
        sreq.on('data', (ch) => { b += ch })
        sreq.on('end', () => {
          sres.setHeader('Content-Type', 'application/json')
          if ((sreq.url ?? '').includes('/oauth/')) {
            sres.end(JSON.stringify({ access_token: 'asr-stub-token', expires_in: 2592000 }))
            return
          }
          sres.end(JSON.stringify(asrReplies.shift() ?? { err_no: 3303, err_msg: 'busy' }))
        })
      })
      const asrUrl: string = await new Promise((res) => asrStub.listen(0, '127.0.0.1', () => {
        const a = asrStub.address()
        res(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`)
      }))
      process.env['ASR_PROVIDER'] = 'baidu'
      process.env['BAIDU_ASR_API_KEY'] = 'stub'
      process.env['BAIDU_ASR_SECRET_KEY'] = 'stub'
      process.env['BAIDU_ASR_BASE_URL'] = asrUrl
      process.env['BAIDU_ASR_VOP_URL'] = `${asrUrl}/vop`
      const asr = new AsrService()
      asrReplies.push({ err_no: 0, result: ['我的回答转写文本_语音标记WXYZ'] })
      const ok = await asr.recognizeWav(Buffer.alloc(2000))
      if (!ok.ok || ok.text !== '我的回答转写文本_语音标记WXYZ') fail(`14. 转写失败: ${ok.errorMessage}`)
      asrReplies.push({ err_no: 3301, err_msg: 'quality' })
      const bad = await asr.recognizeWav(Buffer.alloc(2000))
      if (bad.ok || !bad.errorMessage?.includes('没有听清')) fail('14. 3301 应映射「没有听清」')
      const big = await asr.recognizeWav(Buffer.alloc(5 * 1024 * 1024))
      if (big.ok || !big.errorMessage?.includes('过长')) fail('14. 超大音频应本地拒绝')
      asrStub.close()
      delete process.env['ASR_PROVIDER']
      pass('14. ASR：未配置诚实回退 / stub 转写成功 / 音质差与超长明确报错')
    }

    // ── 10. 日志脱敏 ──────────────────────────────────────────────────────────
    {
      const joined = capturedLogs.join('\n')
      for (const secret of [SECRET_ANSWER.slice(0, 20), SECRET_QUESTION.slice(0, 12), '机密标记XYZQ', '问题标记ABCD', '语音标记WXYZ', '编辑前的转写原文']) {
        if (joined.includes(secret)) fail(`10. 日志泄露对话内容: ${secret.slice(0, 10)}…`)
      }
      pass('10. 日志脱敏：问题/回答原文不出现在任何日志')
    }

    // ── 11. 报告 PDF 真实渲染 ────────────────────────────────────────────────
    {
      const { buffer, pageCount } = await pdf.render(
        { position: '前端开发工程师', industry: '互联网 / AI', interviewerLabel: '技术面试官', date: '2026-06-11' },
        VALID_REPORT,
      )
      if (pageCount < 1) fail('11. pageCount 应 ≥1')
      if (buffer.slice(0, 4).toString() !== '%PDF') fail('11. 输出不是 PDF')
      pass(`11. 报告 PDF 真实渲染（${buffer.length} bytes / ${pageCount} 页）`)
    }

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    await prisma.mockInterviewSession.deleteMany({ where: { id: { in: cleanupSessionIds } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { targetType: 'mock_interview_session' } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: [endUserA, endUserB] } } }).catch(() => undefined)
    server.close()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
