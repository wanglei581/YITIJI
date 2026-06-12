/**
 * 2E 职业规划 — 离线回归验证（受控 stub LLM，可进 CI）。
 *
 *  1. 闭环：parse → 生成 → completed + kind=career_plan 落库继承归属 + 会员 AI 记录可见
 *  2. 防编造：currentSnapshot evidence 不在简历原文 → 整体重试 → 连续命中诚实失败
 *  3. 禁词/薪资承诺/百分比 → 重试 → 合法版本通过；连续命中 AI_CAREER_PLAN_FAILED
 *  4. 建议级过滤：诱导编造/无依据示例数字 → 过滤 + 安全兜底（接口仍 completed）
 *  5. 上下文聚合：同任务 job_fit 行 → prompt 含岗位标题；会员最近面试报告 → prompt 含表现摘要；
 *     匿名任务绝不聚合面试（凭证独立不跨链）
 *  6. 越权（无/错 token、他人会员）→ AI_TASK_NOT_FOUND
 *  7. upsert 单行 + getLatest 读回
 *  8. 简历文件已清理 → 诚实 failed（不调 LLM）
 *  9. 建议单 PDF 真实渲染（%PDF + 免责声明 + 行动清单）
 * 10. 日志脱敏：简历/规划文本不出现在日志
 *
 * 运行：pnpm --filter @ai-job-print/api verify:career-plan
 */
require('dotenv').config()

import { createServer, type Server } from 'http'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { LlmCareerPlanService, type CareerPlanPayload } from '../src/ai/resume/llm-career-plan.service'
import { CareerPlanService } from '../src/ai/resume/career-plan.service'
import { CareerPlanPdfService } from '../src/ai/resume/career-plan-pdf.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'

const RESUME_TEXT = '李某某，大专，行政管理专业。曾任某商贸公司行政文员，负责档案管理与会议安排，整理合同文件300余份_简历标记CPRS。熟练使用Office办公软件。'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }

const capturedLogs: string[] = []
class Cap {
  log(m: unknown) { capturedLogs.push(String(m)) }
  error(m: unknown) { capturedLogs.push(String(m)) }
  warn(m: unknown) { capturedLogs.push(String(m)) }
  debug(m: unknown) { capturedLogs.push(String(m)) }
  verbose(m: unknown) { capturedLogs.push(String(m)) }
}
Logger.overrideLogger(new Cap())

const responseQueue: string[] = []
const llmRequestBodies: string[] = []
function startStub(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let b = ''
      req.on('data', (c) => { b += c })
      req.on('end', () => {
        llmRequestBodies.push(b)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: responseQueue.shift() ?? '{}' } }] }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const a = server.address()
      resolve({ server, url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` })
    })
  })
}

const VALID: CareerPlanPayload = {
  summary: '基于你的行政经历给出以下发展参考。',
  currentSnapshot: [
    { point: '具备扎实的行政事务执行经验', evidence: '负责档案管理与会议安排' },
    { point: '有量化的文档管理成果', evidence: '整理合同文件300余份' },
  ],
  directions: [
    { title: '行政管理深耕', why: '现有档案与会议管理经验是直接基础', firstStep: '系统整理现有工作流程文档，形成可展示的方法沉淀' },
    { title: '人事行政复合方向', why: '行政与人事在企业内高度协同', firstStep: '学习人事基础模块（考勤/入离职流程）' },
  ],
  skillPlan: [
    { skill: '办公自动化进阶', action: '掌握 Excel 数据透视与函数进阶用法', timeframe: '1-3 个月' },
    { skill: '流程管理能力', action: '梳理并优化一项现有行政流程并记录结果', timeframe: '3-6 个月' },
  ],
  actionChecklist: ['更新简历中量化成果表述', '完成一次模拟面试练习', '梳理一份个人工作流程文档'],
}
const vjson = (over: Partial<Record<keyof CareerPlanPayload, unknown>> = {}) => JSON.stringify({ ...VALID, ...over })

async function main() {
  const { server, url } = await startStub()
  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const stubConfig = {
    getApiKey: () => 'stub-key',
    getConfig: () => ({ vendor: 'deepseek', model: 'stub', baseURL: url, systemPrompt: '', roleScope: '', forbiddenWords: [], temperature: 0, enabled: true, apiKeyEncrypted: 'x' }),
  }
  const llm = new LlmCareerPlanService(stubConfig as never)
  const pdf = new CareerPlanPdfService()
  const fileStore = new Map<string, string>()
  const stubExtraction = {
    extractResumeText: ({ fileId }: { fileId: string }) => {
      const text = fileStore.get(fileId)
      return Promise.resolve(text ? { ok: true, text } : { ok: false, errorCode: 'FILE_NOT_FOUND', errorMessage: 'gone' })
    },
  }
  const stubFiles = {
    upload: (args: { buffer: Buffer; filename: string }) => Promise.resolve({
      fileId: `vcp_file_out`, filename: args.filename, sizeBytes: args.buffer.length,
      signedUrl: 'http://localhost/test', signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    }),
  }
  const svc = new CareerPlanService(prisma, llm, stubExtraction as never, stubFiles as never, pdf, audit)
  const assets = new MemberAssetsService(prisma)

  const suffix = Date.now().toString(36)
  const taskAnon = `vcp_anon_${suffix}`
  const taskMember = `vcp_member_${suffix}`
  const fileId = `vcp_file_${suffix}`
  const endUserA = `vcp_a_${suffix}`
  const accessToken = 'bb'.repeat(24)
  const { createHash } = await import('crypto')
  const tokenHash = createHash('sha256').update(accessToken, 'utf8').digest('hex')
  const sessionIds: string[] = []

  try {
    fileStore.set(fileId, RESUME_TEXT)
    await prisma.endUser.create({ data: { id: endUserA, phoneHash: `h_${endUserA}`, phoneEnc: `e_${endUserA}` } })
    // 匿名 parse 行（含同任务 job_fit 行供上下文聚合断言）
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskAnon, kind: 'parse', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({ taskId: taskAnon, status: 'completed', fileId }),
        endUserId: null, accessTokenHash: tokenHash, expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskAnon, kind: 'job_fit', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({ job: { title: '档案管理员_岗位标记JFCP' }, payload: { fitLevel: 'reference_medium', gapPoints: [{ gap: '缺少数字化档案经验' }] }, providerName: 'llm' }),
        endUserId: null, accessTokenHash: tokenHash, expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    // 会员 parse 行 + 最近完成的面试（含报告）
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskMember, kind: 'parse', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({ taskId: taskMember, status: 'completed', fileId }),
        endUserId: endUserA, accessTokenHash: null, expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const sess = await prisma.mockInterviewSession.create({
      data: {
        endUserId: endUserA, status: 'completed', interviewerType: 'hr', industry: '通用', position: '行政专员_面试标记IVCP',
        experience: 'y1_3', difficulty: 'standard', durationMin: 3, questionTarget: 4,
        endedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000),
        report: { create: { payloadJson: JSON.stringify({ overall: { level: 'pass' }, risks: ['回答缺少量化数据'] }), expiresAt: new Date(Date.now() + 3600_000) } },
      },
    })
    sessionIds.push(sess.id)
    const anonReq = { endUserId: null, accessToken }
    const memberReq = { endUserId: endUserA, accessToken: null }

    // ── 1+5a. 匿名闭环 + job_fit 上下文聚合（匿名不聚合面试） ────────────────
    llmRequestBodies.length = 0
    responseQueue.push(vjson())
    const r1 = await svc.generate(taskAnon, anonReq)
    if (r1.status !== 'completed' || !('directions' in r1)) fail('1. 应 completed')
    if (r1.basedOn?.jobFit !== '档案管理员_岗位标记JFCP') fail('1. basedOn 缺 job_fit 上下文')
    if (r1.basedOn?.interview !== null) fail('5a. 匿名任务不得聚合面试上下文')
    const req1 = llmRequestBodies[0] ?? ''
    if (!req1.includes('档案管理员_岗位标记JFCP')) fail('5a. prompt 未携带 job_fit 上下文')
    if (req1.includes('面试标记IVCP')) fail('5a. 匿名 prompt 不得含面试摘要')
    const row1 = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId: taskAnon, kind: 'career_plan' } } })
    if (!row1 || row1.accessTokenHash !== tokenHash) fail('1. career_plan 行未继承 parse 归属')
    pass('1. 匿名闭环：completed + kind=career_plan 落库继承归属 + basedOn 如实')
    pass('5a. 上下文聚合：同任务 job_fit 进 prompt；匿名绝不聚合面试')

    // ── 5b. 会员聚合最近面试摘要 + AI 记录可见 ────────────────────────────────
    llmRequestBodies.length = 0
    responseQueue.push(vjson())
    const r5 = await svc.generate(taskMember, memberReq)
    if (r5.status !== 'completed' || r5.basedOn?.interview !== '行政专员_面试标记IVCP') fail('5b. 会员应聚合最近面试摘要')
    if (!(llmRequestBodies[0] ?? '').includes('面试标记IVCP')) fail('5b. prompt 缺面试摘要')
    const records = await assets.listAiRecords(endUserA, { cursor: null, pageSize: 20 })
    if (!records.items.some((i) => i.taskId === taskMember && i.kind === 'career_plan')) fail('5b. 会员 AI 服务记录缺 career_plan')
    pass('5b. 会员聚合最近面试表现；kind=career_plan 进会员 AI 服务记录')

    // ── 2. 防编造 ─────────────────────────────────────────────────────────────
    responseQueue.push(vjson({ currentSnapshot: [{ point: '持有注册会计师证书', evidence: '注册会计师执业五年' }] }))
    responseQueue.push(vjson())
    const r2 = await svc.generate(taskAnon, anonReq)
    if (r2.status !== 'completed' || JSON.stringify(r2).includes('会计师')) fail('2. 编造现状未被拦截')
    pass('2. 防编造：evidence 不在原文 → 重试 → 合法版本通过')

    // ── 3. 禁词/薪资承诺/百分比 ──────────────────────────────────────────────
    responseQueue.push(vjson({ summary: '转型后月薪可达 15k。' }))
    responseQueue.push(vjson())
    const r3 = await svc.generate(taskAnon, anonReq)
    if (/月薪[^。]{0,12}可达/.test(JSON.stringify(r3))) fail('3. 薪资承诺未被拦截')
    responseQueue.push(vjson({ summary: '成功转型通过率约 80%。' }))
    responseQueue.push(vjson({ summary: '保录用没有问题。' }))
    try {
      await svc.generate(taskAnon, anonReq)
      fail('3. 连续违规应失败')
    } catch (e) {
      const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
      if (!resp.includes('AI_CAREER_PLAN_FAILED')) fail(`3. 失败码不符: ${resp}`)
    }
    pass('3. 薪资承诺/百分比/禁词 → 重试或 AI_CAREER_PLAN_FAILED 诚实失败')

    // ── 4. 建议级过滤 ─────────────────────────────────────────────────────────
    responseQueue.push(vjson({
      actionChecklist: ['删除行政经历，替换为 2-3 个数据分析项目', '比如每周完成3次复盘这样的频率'],
      skillPlan: [{ skill: '数据能力', action: '例如每月分析100份报表来练手', timeframe: '1-3 个月' }],
    }))
    const r4 = await svc.generate(taskAnon, anonReq)
    const r4s = JSON.stringify(r4)
    if (r4.status !== 'completed') fail('4. 过滤后应仍 completed')
    if (r4s.includes('替换为') || /(?:如|例如|比如)[^。；;，,]{0,40}\d/.test(r4s)) fail('4. 高风险建议未被过滤')
    if (!r4s.includes('不要虚构经历或数字')) fail('4. 缺安全兜底')
    pass('4. 诱导编造/示例数字 → 建议级过滤 + 安全兜底（completed 不失败）')

    // ── 6. 越权 ───────────────────────────────────────────────────────────────
    for (const bad of [{ endUserId: null, accessToken: null }, { endUserId: null, accessToken: 'ff'.repeat(24) }, { endUserId: 'someone', accessToken: null }]) {
      try {
        await svc.generate(taskAnon, bad)
        fail('6. 错误凭证不应通过')
      } catch (e) {
        const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
        if (!resp.includes('AI_TASK_NOT_FOUND')) fail(`6. 失败码不符: ${resp}`)
      }
    }
    pass('6. 无/错 token 与他人会员 → AI_TASK_NOT_FOUND（不泄露存在性）')

    // ── 7. upsert 单行 + getLatest ───────────────────────────────────────────
    const latest = await svc.getLatest(taskAnon, anonReq)
    if (latest.status !== 'completed') fail('7. getLatest 应返回最近一次')
    const count = await prisma.aiResumeResult.count({ where: { taskId: taskAnon, kind: 'career_plan' } })
    if (count !== 1) fail(`7. 同 taskId 应只有 1 行，实际 ${count}`)
    pass('7. getLatest 读回；upsert 单行覆盖')

    // ── 8. 文件清理 → 诚实失败 ────────────────────────────────────────────────
    fileStore.delete(fileId)
    const r8 = await svc.generate(taskAnon, anonReq)
    if (r8.status !== 'failed' || !r8.failReason?.includes('重新上传')) fail('8. 文件清理应诚实失败')
    fileStore.set(fileId, RESUME_TEXT)
    pass('8. 简历原文已清理 → 诚实 failed（不调 LLM、不编造）')

    // ── 9. 建议单 PDF ─────────────────────────────────────────────────────────
    const printed = await svc.printPlan(taskAnon, anonReq)
    if (printed.pageCount < 1 || printed.filename !== '职业规划建议单.pdf') fail('9. PDF 元数据不符')
    const { buffer } = await pdf.render({ date: '2026-06-12', basedOn: { resume: true, jobFit: null, interview: null } }, VALID)
    if (buffer.slice(0, 4).toString() !== '%PDF') fail('9. 输出不是 PDF')
    pass(`9. 建议单 PDF 真实渲染（${buffer.length} bytes）+ 打印链路返回 FileObject 元数据`)

    // ── 10. 日志脱敏 ──────────────────────────────────────────────────────────
    const joined = capturedLogs.join('\n')
    for (const secret of ['简历标记CPRS', '档案管理与会议安排', '行政管理深耕']) {
      if (joined.includes(secret)) fail(`10. 日志泄露内容: ${secret.slice(0, 10)}`)
    }
    pass('10. 日志脱敏：简历/规划文本不出现在日志')

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: [taskAnon, taskMember] } } }).catch(() => undefined)
    await prisma.mockInterviewSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [taskAnon, taskMember] } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: endUserA } }).catch(() => undefined)
    server.close()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
