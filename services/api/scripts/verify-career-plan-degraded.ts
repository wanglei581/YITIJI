/**
 * 职业规划「降级态可打印」门禁（S3-DEGRADE-PRINT）。
 *
 * 背景：`printPlan` 此前要求存在已落库的 AI plan，否则抛 CAREER_PLAN_NOT_FOUND ——
 * AI 挂掉时用户在一台**打印终端**上一张纸也拿不走。本门禁守住放宽后的行为不回退。
 *
 *  1. 无 AI plan → 真出 PDF（不抛 CAREER_PLAN_NOT_FOUND），variant=degraded
 *  2. 降级版自我标识：标题/正文/文件名都写明「未含 AI 规划」，一眼看得出是降级版
 *  3. 不编造 AI 内容：库里存着的 LLM 解读（self_assessment note/summary）绝不进降级纸；
 *     确定性记分（label + strength）照常印
 *  4. 证据分级：E1（本人作答）+ E2（确定性聚合）；**整张纸不得出现 E3**
 *  5. 岗位要求计数端口缺席 → 如实印「本次未取到」，不编空表
 *  6. 端口在场（stub）→ 印样本量与分布；整批样本量不足 → 只印样本量、不给分布
 *  7. 正常路径无回归：有 AI plan → variant=ai + 文件名不变 + 不含降级口径
 *  8. 已过期 plan → 走降级，且原因如实写成「到期清理」
 *  9. 归属门禁不变：放宽前置条件不得成为绕过归属的后门（错/无凭证仍 AI_TASK_NOT_FOUND）
 * 10. 元数据诚实：降级件不得标 AIGenerated=true（这张纸没有一个字来自模型）
 * 11. **产物真能进打印队列**：降级件的 printFileUrl 交给真实 PrintJobsService.create()
 *     建出 PrintTask —— 只证明"文件生成了"不算数（PR #635 就是响应缺 printFileUrl 断了链路）
 *
 * 运行：pnpm --filter @ai-job-print/api verify:career-plan-degraded
 */
require('dotenv').config()

import { Logger } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'

process.env['FILE_SIGNING_SECRET'] ||= 'verify-degrade-file-signing-secret-0123456789abcd'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { CareerPlanService } from '../src/ai/resume/career-plan.service'
import { CareerPlanPdfService } from '../src/ai/resume/career-plan-pdf.service'
import { CareerPlanDegradedPdfService } from '../src/ai/resume/career-plan-degraded-pdf.service'
import type {
  CareerPlanJobRequirementStatsPort,
  DegradedJobRequirementStats,
} from '../src/ai/resume/career-plan-degraded'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PricingService } from '../src/payment/pricing.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const unpdf = require('unpdf') as {
  getDocumentProxy: (data: Uint8Array) => Promise<unknown>
  extractText: (pdf: unknown, options: { mergePages: boolean }) => Promise<{ text: string }>
}

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

/**
 * PDF 抽取出的文字会在折行处插入空白，直接 includes 会漏判。
 * 全部去空白后再比对，断言才稳。
 */
function squash(s: string): string { return s.replace(/\s+/gu, '') }

async function pdfText(prisma: PrismaService, fileId: string, storage: StorageService): Promise<string> {
  const file = await prisma.fileObject.findUnique({ where: { id: fileId } })
  if (!file) fail(`读不到 FileObject ${fileId}`)
  const buffer = await storage.getObject(file.storageKey, file.bucket)
  if (buffer.subarray(0, 4).toString('latin1') !== '%PDF') fail('产物不是 PDF')
  const doc = await unpdf.getDocumentProxy(new Uint8Array(buffer))
  const { text } = await unpdf.extractText(doc, { mergePages: true })
  return text
}

/** LLM 生成过的自我探索解读；带唯一标记，出现在纸上即为编造 AI 内容。 */
const AI_NOTE_MARK = 'LLM解读标记DEGRADEDNOTE'
const AI_SUMMARY_MARK = 'LLM总述标记DEGRADEDSUM'
/** AI 版规划正文标记，用于确认正常路径未回归。 */
const AI_PLAN_MARK = 'AI规划标记DEGRADEDPLAN'

function statsFixture(sufficient: boolean): DegradedJobRequirementStats {
  return {
    rulesVersion: 'jrs-v1-test',
    evidenceLevel: 'E2',
    sample: {
      matchedTotal: 48, countedTotal: sufficient ? 32 : 3, titleOnlyTotal: 16, truncated: false,
      scanLimit: 500, sourceOrgCount: 6, latestSyncTime: '2026-08-15T02:00:00.000Z',
      sufficient, minSampleSize: 10, issue: sufficient ? null : 'below_min_sample',
    },
    dimensions: [
      {
        dimension: 'education', label: '学历要求', statedCount: 21, sampleSize: 32,
        sufficient: true, minStatedCount: 5,
        items: [{ key: 'college', label: '大专', count: 13 }, { key: 'bachelor', label: '本科', count: 8 }],
        note: '按来源平台结构化字段与岗位正文统计',
      },
      {
        dimension: 'certificate', label: '证书要求', statedCount: 2, sampleSize: 32,
        sufficient: false, minStatedCount: 5, items: [],
        note: '按证书词典命中统计',
      },
    ],
    boundaryNotes: ['条数只代表本机看到的岗位数量，不代表市场需求或前景排名'],
  }
}

async function main() {
  assertIsolatedVerificationDatabase()
  console.log('\n=== 职业规划降级态可打印验证（S3-DEGRADE-PRINT）===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const aiLog = new AiLogService(prisma)
  const pdf = new CareerPlanPdfService()
  const degradedPdf = new CareerPlanDegradedPdfService()
  const stubExtraction = {
    extractResumeText: () => Promise.resolve({ ok: false, errorCode: 'FILE_NOT_FOUND', errorMessage: 'unused' }),
  }
  const stubLlm = { build: () => { throw new Error('本门禁不应触发 LLM') } }

  /** 端口缺席（PR #636 未合入 main 时的真实形态）。 */
  const svcNoStats = new CareerPlanService(
    prisma, stubLlm as never, stubExtraction as never, files, pdf, audit, aiLog, degradedPdf,
  )
  /** 端口在场（#636 合入后的形态，用 stub 提前守住版式）。 */
  const makeSvcWithStats = (sufficient: boolean) => {
    const port: CareerPlanJobRequirementStatsPort = {
      getStats: () => Promise.resolve({ data: statsFixture(sufficient) }),
    }
    return new CareerPlanService(
      prisma, stubLlm as never, stubExtraction as never, files, pdf, audit, aiLog, degradedPdf, port,
    )
  }

  const printJobs = new PrintJobsService(
    prisma, audit,
    new PrintPageCountService(prisma, storage),
    new PricingService(prisma),
    new OrderStatusService(prisma, audit),
    new TerminalCapabilitiesService(prisma),
  )

  const suffix = randomBytes(5).toString('hex')
  const taskDegraded = `vcpd_deg_${suffix}`
  const taskWithPlan = `vcpd_ai_${suffix}`
  const taskExpired = `vcpd_exp_${suffix}`
  const accessToken = 'cc'.repeat(24)
  const tokenHash = createHash('sha256').update(accessToken, 'utf8').digest('hex')
  const req = { endUserId: null, accessToken }
  const allTasks = [taskDegraded, taskWithPlan, taskExpired]
  const createdFileIds: string[] = []
  const createdTaskIds: string[] = []
  /** 打印任务必须绑定目标终端（PRINT_TERMINAL_REQUIRED），所以要真建一台终端夹具。 */
  const terminalId = `term_vcpd_${suffix}`

  const parseRow = (taskId: string) => ({
    taskId, kind: 'parse', status: 'completed', provider: 'llm',
    payloadJson: JSON.stringify({ taskId, status: 'completed', fileId: `vcpd_src_${suffix}` }),
    endUserId: null, accessTokenHash: tokenHash, expiresAt: new Date(Date.now() + 3600_000),
  })

  async function cleanup() {
    if (createdTaskIds.length) {
      const orders = await prisma.order.findMany({ where: { printTaskId: { in: createdTaskIds } }, select: { id: true } })
      await prisma.auditLog.deleteMany({ where: { targetType: 'order', targetId: { in: orders.map((o: { id: string }) => o.id) } } })
      await prisma.order.deleteMany({ where: { printTaskId: { in: createdTaskIds } } })
      await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: createdTaskIds } } })
      await prisma.auditLog.deleteMany({ where: { targetType: 'print_task', targetId: { in: createdTaskIds } } })
      await prisma.printTask.deleteMany({ where: { id: { in: createdTaskIds } } })
    }
    for (const id of createdFileIds) {
      const f = await prisma.fileObject.findUnique({ where: { id } }).catch(() => null)
      if (f) await storage.deleteObject(f.storageKey, f.bucket).catch(() => undefined)
    }
    await prisma.fileObject.deleteMany({ where: { id: { in: createdFileIds } } }).catch(() => undefined)
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: allTasks } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: allTasks } } }).catch(() => undefined)
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
  }

  try {
    await cleanup()
    await seedDevDefaultPriceConfig(prisma)
    await prisma.terminal.create({
      data: {
        id: terminalId, terminalCode: `VCPD-${suffix}`,
        agentToken: `vcpd-agent-token-${suffix}`, deviceFingerprint: `fp-${suffix}`,
      },
    })
    await prisma.aiResumeResult.createMany({ data: allTasks.map(parseRow) })

    // 库里存着 LLM 写下的解读（AI 正常时留下的）——降级纸绝不能把它印出来。
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskDegraded, kind: 'self_assessment', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({
          version: 'v1', answersHash: 'h', completedAt: new Date().toISOString(),
          summary: AI_SUMMARY_MARK,
          dimensions: [
            { key: 'exec', label: '执行落地', strength: 4, note: AI_NOTE_MARK, evidenceQuestionIdx: [1, 2] },
            { key: 'comm', label: '沟通协作', strength: 2, note: AI_NOTE_MARK, evidenceQuestionIdx: [3] },
          ],
        }),
        endUserId: null, accessTokenHash: tokenHash, expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    // ── 1 + 2 + 3 + 4 + 5：端口缺席时的降级件 ────────────────────────────────
    const deg = await svcNoStats.printPlan(taskDegraded, req)
    createdFileIds.push(deg.fileId)
    if (deg.variant !== 'degraded') fail(`1. 无 AI plan 应产出 degraded，实际 ${deg.variant}`)
    if (!deg.pageCount || deg.pageCount < 1) fail('1. 降级件页数不合法')
    if (!/^\/api\/v1\/files\/[^/]+\/content\?expires=\d+&sig=[0-9a-f]+$/.test(deg.printFileUrl)) {
      fail(`1. printFileUrl 不是内部 HMAC URL: ${deg.printFileUrl}`)
    }
    pass('1. 无 AI plan → 不抛 CAREER_PLAN_NOT_FOUND，真出 PDF + 内部 HMAC printFileUrl')

    const degText = squash(await pdfText(prisma, deg.fileId, storage))
    for (const mark of ['未含AI规划建议', '本单不含AI规划建议', '没有任何一段来自AI判断']) {
      if (!degText.includes(mark)) fail(`2. 降级件缺少自我标识口径：${mark}`)
    }
    if (!squash(deg.filename).includes('未含AI规划')) fail(`2. 文件名未体现降级口径：${deg.filename}`)
    pass('2. 降级件自我标识：标题 + 正文 + 文件名都写明「未含 AI 规划」')

    for (const leak of [AI_NOTE_MARK, AI_SUMMARY_MARK]) {
      if (degText.includes(squash(leak))) fail(`3. 降级件印出了 LLM 生成内容：${leak}`)
    }
    if (!degText.includes('执行落地：4/5') || !degText.includes('沟通协作：2/5')) {
      fail('3. 降级件缺少确定性记分（label + strength）')
    }
    pass('3. 不编造 AI 内容：LLM 解读/总述被挡在纸外，确定性记分照常印')

    if (!degText.includes('E1') || !degText.includes('E2')) fail('4. 降级件缺少 E1/E2 证据分级')
    if (/E3/u.test(degText)) fail('4. 降级件出现 E3 —— 确定性聚合不得标成 AI 判断')
    pass('4. 证据分级：E1（本人作答）+ E2（确定性聚合），全篇无 E3')

    if (!degText.includes('本次未取到岗位要求计数')) fail('5. 端口缺席时未如实说明')
    if (degText.includes('计入分母的0条')) fail('5. 端口缺席时不得编造 0 条统计')
    pass('5. 岗位要求计数端口缺席 → 如实印「本次未取到」，不编空表')

    // ── 6：端口在场（样本量足够 / 不足） ─────────────────────────────────────
    const degOk = await makeSvcWithStats(true).printPlan(taskDegraded, req)
    createdFileIds.push(degOk.fileId)
    const okText = squash(await pdfText(prisma, degOk.fileId, storage))
    if (!okText.includes('计入分母的32条')) fail('6a. 缺样本量口径（分母）')
    if (!okText.includes('大专：13条') || !okText.includes('本科：8条')) fail('6a. 缺要求分布计数')
    if (!okText.includes('数据不足')) fail('6a. 维度样本不足时应显示「数据不足」而不是给分布')
    if (/E3/u.test(okText)) fail('6a. 计数表不得标 E3')
    pass('6a. 端口在场 → 样本量 + 分布计数如实上纸；维度不足只说「数据不足」')

    const degLow = await makeSvcWithStats(false).printPlan(taskDegraded, req)
    createdFileIds.push(degLow.fileId)
    const lowText = squash(await pdfText(prisma, degLow.fileId, storage))
    if (!lowText.includes('样本量不足')) fail('6b. 整批样本量不足时应明说')
    if (lowText.includes('大专：13条')) fail('6b. 整批样本量不足时不得给出任何分布数字')
    pass('6b. 整批样本量不足 → 只印样本量与原因，一个分布数字都不给')

    // ── 7：正常路径无回归 ────────────────────────────────────────────────────
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskWithPlan, kind: 'career_plan', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({
          payload: {
            summary: `${AI_PLAN_MARK}：基于你的经历给出以下发展参考。`,
            currentSnapshot: [{ point: '具备行政执行经验', evidence: '负责档案管理' }],
            directions: [{ title: '行政管理深耕', why: '现有经验是直接基础', firstStep: '整理工作流程文档' }],
            skillPlan: [{ skill: '办公自动化', action: '掌握数据透视', timeframe: '1-3 个月' }],
            actionChecklist: ['更新简历量化表述'],
          },
          basedOn: { resume: true, jobFit: null, interview: null, selfAssessment: null },
          providerName: 'llm',
        }),
        endUserId: null, accessTokenHash: tokenHash, expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const ai = await svcNoStats.printPlan(taskWithPlan, req)
    createdFileIds.push(ai.fileId)
    if (ai.variant !== 'ai') fail(`7. 有 AI plan 应产出 ai，实际 ${ai.variant}`)
    if (ai.filename !== '职业规划建议单.pdf') fail(`7. AI 版文件名被改动：${ai.filename}`)
    const aiText = squash(await pdfText(prisma, ai.fileId, storage))
    if (!aiText.includes('职业规划建议单')) fail('7. AI 版标题缺失')
    if (!aiText.includes(squash(AI_PLAN_MARK))) fail('7. AI 版正文缺失')
    if (aiText.includes('未含AI规划')) fail('7. AI 版被混入降级口径')
    if (aiText.includes('通用求职自检')) fail('7. AI 版被混入降级版通用自检节')
    pass('7. 正常路径无回归：variant=ai + 文件名不变 + 版式内容不变 + 无降级口径混入')

    // ── 8：过期 plan 走降级，原因如实 ────────────────────────────────────────
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskExpired, kind: 'career_plan', status: 'completed', provider: 'llm',
        payloadJson: JSON.stringify({ payload: { summary: AI_PLAN_MARK }, basedOn: {}, providerName: 'llm' }),
        endUserId: null, accessTokenHash: tokenHash, expiresAt: new Date(Date.now() - 1000),
      },
    })
    const exp = await svcNoStats.printPlan(taskExpired, req)
    createdFileIds.push(exp.fileId)
    if (exp.variant !== 'degraded') fail('8. 已过期 plan 应走降级而不是抛错')
    const expText = squash(await pdfText(prisma, exp.fileId, storage))
    if (!expText.includes('到期清理')) fail('8. 过期原因未如实写在纸上')
    if (expText.includes(squash(AI_PLAN_MARK))) fail('8. 过期 plan 的正文不得被印进降级件')
    pass('8. 已过期 plan → 降级件如实写「到期清理」，绝不复用过期正文')

    // ── 9：归属门禁不变（放宽前置条件不得成为后门） ──────────────────────────
    for (const bad of [
      { endUserId: null, accessToken: null },
      { endUserId: null, accessToken: 'ff'.repeat(24) },
      { endUserId: 'someone_else', accessToken: null },
    ]) {
      try {
        await svcNoStats.printPlan(taskDegraded, bad)
        fail('9. 错误凭证不应产出降级件')
      } catch (e) {
        const resp = JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? '')
        if (!resp.includes('AI_TASK_NOT_FOUND')) fail(`9. 失败码不符: ${resp}`)
      }
    }
    pass('9. 归属门禁不变：无/错 token 与他人会员仍 AI_TASK_NOT_FOUND')

    // ── 10：元数据诚实 ───────────────────────────────────────────────────────
    const degFile = await prisma.fileObject.findUnique({ where: { id: deg.fileId } })
    const degRaw = (await storage.getObject(degFile!.storageKey, degFile!.bucket)).toString('latin1')
    if (/\/AIGenerated\s*\(true\)/u.test(degRaw)) fail('10. 降级件不得标 AIGenerated=true（纸上没有模型生成内容）')
    if (!degRaw.includes('zyd-careerplan-degraded-v1')) fail('10. 降级件缺少独立产物标识')
    pass('10. 元数据诚实：AIGenerated=false + 独立 ServiceProviderCode')

    // ── 11：产物真能进打印队列 ───────────────────────────────────────────────
    const created = await printJobs.create({
      fileUrl: deg.printFileUrl,
      fileName: deg.filename,
      params: {
        copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4',
        orientation: 'auto', quality: 'standard', scale: 'fit', pagesPerSheet: 1,
      },
    }, { ipAddress: '127.0.0.1', userAgent: 'verify', endUserId: null, terminalId })
    createdTaskIds.push(created.taskId)
    const task = await prisma.printTask.findUnique({ where: { id: created.taskId } })
    if (!task) fail('11. 降级件未能建出 PrintTask')
    if (task.status !== 'pending') fail(`11. PrintTask 状态异常: ${task.status}`)
    if (!task.fileUrl.includes(deg.fileId)) fail('11. PrintTask 指向的文件与降级件不一致')
    pass(`11. 降级件真的进了打印队列：PrintTask ${created.taskId} status=pending`)

    // ── 日志脱敏 ─────────────────────────────────────────────────────────────
    const joined = capturedLogs.join('\n')
    for (const secret of [AI_NOTE_MARK, AI_SUMMARY_MARK, AI_PLAN_MARK]) {
      if (joined.includes(secret)) fail(`12. 日志泄露内容: ${secret}`)
    }
    pass('12. 日志脱敏：规划/解读文本不出现在日志')

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    const resp = (err as { getResponse?: () => unknown }).getResponse?.()
    console.error(err instanceof Error ? err.message : err)
    if (resp) console.error(`  详情: ${JSON.stringify(resp)}`)
  } finally {
    await cleanup().catch(() => undefined)
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
