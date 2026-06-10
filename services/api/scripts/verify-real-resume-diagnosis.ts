/**
 * Phase 1B — 真实 LLM 简历诊断闭环验证。
 *
 * 目的（离线、零外部费用：用本地 stub HTTP LLM 端点）：
 *   验证 AiService.submitResumeParse 在 AI_PROVIDER=llm 下的真实闭环——
 *   先经 ResumeExtractionService 提取，提取失败直接返回明确原因且不调 LLM；
 *   提取成功则调真实大模型（OpenAI 兼容协议，走 LlmResumeService）生成结构化报告；
 *   非法 JSON 重试一次、仍失败明确报错；未配置模型明确失败、绝不 fallback mock；
 *   payloadJson / 日志不泄漏简历原文；会员/匿名 accessToken 门禁不被破坏。
 *
 * 运行：
 *   pnpm --filter @ai-job-print/api verify-real-resume-diagnosis
 */
import 'dotenv/config'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AiService } from '../src/ai/ai.service'
import { LlmResumeService } from '../src/ai/resume/llm-resume.service'
import { LlmResumeGenerateService } from '../src/ai/resume/llm-resume-generate.service'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { LlmResumeProvider } from '../src/ai/providers/llm.provider'

const SENTINEL = 'ZZ_DIAG_SENTINEL_77'

function pass(message: string) {
  console.log(`  PASS ${message}`)
}
function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}
function assert(cond: unknown, message: string): void {
  if (cond) pass(message)
  else fail(message)
}

// Phase 1.1：6 评分维度 + riskNotes + priorities。
function validReportJson(): string {
  return JSON.stringify({
    sections: [
      { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
      { key: 'objective', label: '求职目标清晰度', score: 6, maxScore: 10 },
      { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
      { key: 'quantification', label: '成果量化程度', score: 5, maxScore: 10 },
      { key: 'keyword', label: '岗位关键词覆盖', score: 5, maxScore: 10 },
      { key: 'readability', label: '版式与可读性', score: 7, maxScore: 10 },
    ],
    suggestions: ['项目描述建议量化成果', '技能区补充岗位相关关键词', '个人简介精简至 2-3 句'],
    riskNotes: ['经历缺少量化描述', '求职目标表述偏笼统'],
    priorities: [
      { focus: '补充成果量化', reason: '职责描述缺少可衡量结果' },
      { focus: '明确求职目标', reason: '意向方向不清晰' },
    ],
  })
}

// 诊断专属合规拦截词测试输入（字符串拼接，避免源码出现完整违禁词）。
const jw = (...p: string[]): string => p.join('')
const GUARD_TERM_HIRE = jw('录用', '概率')
const GUARD_TERM_MATCH = jw('企业', '匹配度')

// 6 个合法评分维度（可用 mut 注入坏分值做拒绝测试）。
function sixSections(mut) {
  const s = [
    { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
    { key: 'objective', label: '求职目标清晰度', score: 6, maxScore: 10 },
    { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
    { key: 'quantification', label: '成果量化程度', score: 5, maxScore: 10 },
    { key: 'keyword', label: '岗位关键词覆盖', score: 5, maxScore: 10 },
    { key: 'readability', label: '版式与可读性', score: 7, maxScore: 10 },
  ]
  if (mut) mut(s)
  return s
}

// 本地 stub LLM 端点：按 responseQueue 顺序返回，空则默认合法报告。
type StubResponse = { status: number; content?: string }
let responseQueue: StubResponse[] = []
let llmCallCount = 0
function setResponses(arr: StubResponse[]): void {
  responseQueue = arr.slice()
}

async function main(): Promise<void> {
  console.log('\n=== Phase 1B 真实 LLM 简历诊断闭环验证 ===')

  // 捕获我方 Logger 输出（断言不泄漏原文）
  const loggerLines: string[] = []
  Logger.overrideLogger({
    log: (m: unknown) => loggerLines.push(String(m)),
    error: (m: unknown) => loggerLines.push(String(m)),
    warn: (m: unknown) => loggerLines.push(String(m)),
    debug: () => {},
    verbose: () => {},
    fatal: () => {},
  })

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      llmCallCount++
      const next = responseQueue.shift() ?? { status: 200, content: validReportJson() }
      res.statusCode = next.status
      res.setHeader('Content-Type', 'application/json')
      if (next.status !== 200) {
        res.end('{"error":"stub-error"}')
        return
      }
      res.end(JSON.stringify({ choices: [{ message: { content: next.content } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  const baseURL = `http://127.0.0.1:${port}/v1`

  const baseConfig = {
    vendor: 'deepseek',
    model: 'stub-model',
    baseURL,
    systemPrompt: '',
    roleScope: '',
    forbiddenWords: [] as string[],
    temperature: 0.2,
    enabled: true,
  }
  const configuredConfig = {
    getApiKey: (feature?: string) => feature === 'resume_diagnosis' ? 'stub-key' : null,
    getConfig: (feature?: string) => ({ ...baseConfig, enabled: feature === 'resume_diagnosis' }),
    isReady: (feature?: string) => feature === 'resume_diagnosis',
  }
  const unconfiguredConfig = {
    getApiKey: () => null,
    getConfig: () => ({ ...baseConfig, enabled: false }),
    isReady: () => false,
  }

  // 阶段2A:LlmResumeProvider 增加生成服务依赖;本脚本只测诊断,生成服务用未配置实例即可
  const llmProvider = new LlmResumeProvider(new LlmResumeService(configuredConfig as never), new LlmResumeGenerateService(unconfiguredConfig as never), new LlmResumeOptimizeService(unconfiguredConfig as never))
  const unconfiguredProvider = new LlmResumeProvider(new LlmResumeService(unconfiguredConfig as never), new LlmResumeGenerateService(unconfiguredConfig as never), new LlmResumeOptimizeService(unconfiguredConfig as never))

  // 受控提取桩：按 fileId 返回提取结果（默认成功，文本含哨兵）
  const defaultText = `姓名 张三 ${SENTINEL}\n求职意向 前端工程师\n工作经历 2019-2024 ABC 高级前端\n技能 TypeScript React NestJS`
  const extractionByFileId = new Map<string, unknown>()
  const fakeExtraction = {
    extractResumeText: async ({ fileId }: { fileId: string }) =>
      extractionByFileId.get(fileId) ?? {
        ok: true,
        fileId,
        text: defaultText,
        textSource: 'docx',
        confidence: 'high',
        charCount: defaultText.length,
      },
  }

  const logEntries: Array<Record<string, unknown>> = []
  const logServiceStub = { record: (e: Record<string, unknown>) => logEntries.push(e) }
  const emptyStub = {} as never

  process.env['AI_PROVIDER'] = 'llm'
  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const build = (provider: LlmResumeProvider) =>
    new AiService(
      emptyStub, // mock
      emptyStub, // openai
      emptyStub, // claude
      emptyStub, // local
      emptyStub, // qwen
      emptyStub, // zhipu
      provider as never, // llmResumeProvider ← this.provider（AI_PROVIDER=llm）
      logServiceStub as never, // logService
      emptyStub, // llmConfig
      emptyStub, // llmChat
      fakeExtraction as never, // resumeExtraction
      emptyStub, // resumePdf（阶段2A,本脚本不导出 PDF）
      emptyStub, // files（阶段2A,本脚本不导出 PDF）
      prisma,
      emptyStub, // audit
    )
  const ai = build(llmProvider)
  const aiUnconfigured = build(unconfiguredProvider)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userId = `eu_diag_${suffix}`
  const createdTaskIds: string[] = []
  const submit = async (fileId: string, endUserId: string | null) => {
    const r = await ai.submitResumeParse(
      { fileId, fileName: 'r.docx', fileFormat: 'docx', source: 'upload' },
      endUserId,
    )
    createdTaskIds.push(r.taskId)
    return r
  }

  // 提取失败用例
  extractionByFileId.set('img-file', {
    ok: false,
    fileId: 'img-file',
    errorCode: 'OCR_NOT_CONFIGURED',
    errorMessage: '图片 / 扫描件简历的文字识别（OCR）尚未配置，请上传带文字层的 PDF 或 DOCX',
  })

  try {
    // ── 1. 提取失败 → 返回失败，不调用 LLM ───────────────────────────────────
    setResponses([])
    const before1 = llmCallCount
    const r1 = await submit('img-file', null)
    assert(
      r1.status === 'failed' && !r1.report && !!r1.failReason && llmCallCount === before1,
      '1. 提取失败时 submitResumeParse 返回失败、不调用 LLM',
    )

    // ── 2. 提取成功 → 调用 LLM → 结构化报告 ───────────────────────────────────
    setResponses([{ status: 200, content: validReportJson() }])
    const before2 = llmCallCount
    const r2 = await submit('docx-file', null)
    assert(
      r2.status === 'completed' &&
        !!r2.report &&
        r2.report.sections.length === 6 &&
        r2.report.sections.every((s) => s.maxScore === 10) &&
        r2.report.suggestions.length > 0 &&
        (r2.report.riskNotes?.length ?? 0) > 0 &&
        (r2.report.priorities?.length ?? 0) > 0 &&
        r2.report.priorities!.every((p) => typeof p.focus === 'string' && p.focus.length > 0) &&
        llmCallCount === before2 + 1,
      '2. DOCX 提取成功后调用 LLM 并生成 6 维度 + riskNotes + priorities 结构化报告',
    )

    // ── 3. LLM 返回非法 JSON → 重试一次后成功 ─────────────────────────────────
    setResponses([{ status: 200, content: '抱歉，这不是 JSON：result ok' }, { status: 200, content: validReportJson() }])
    const before3 = llmCallCount
    const r3 = await submit('docx-file', null)
    assert(
      r3.status === 'completed' && !!r3.report && llmCallCount === before3 + 2,
      '3. LLM 返回非法 JSON 时重试一次（共 2 次调用）后成功',
    )

    // ── 4. 重试仍失败 → 明确错误，不返回半截报告 ──────────────────────────────
    setResponses([{ status: 200, content: 'still not json' }, { status: 200, content: 'still not json again' }])
    const before4 = llmCallCount
    const r4 = await submit('docx-file', null)
    assert(
      r4.status === 'failed' && !r4.report && !!r4.failReason && llmCallCount === before4 + 2,
      '4. 重试仍失败时返回明确错误（status=failed，无 report）',
    )

    // ── 4b. 维度结构漂移 → 不接受半结构化报告（6 维度中混入未知 key）──────────
    const driftedReport = JSON.stringify({
      sections: [
        { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
        { key: 'objective', label: '求职目标清晰度', score: 6, maxScore: 10 },
        { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
        { key: 'quantification', label: '成果量化程度', score: 5, maxScore: 10 },
        { key: 'keyword', label: '岗位关键词覆盖', score: 5, maxScore: 10 },
        { key: 'extra', label: '非固定维度', score: 10, maxScore: 10 },
      ],
      suggestions: ['项目描述建议量化成果', '技能区补充岗位相关关键词', '个人简介精简至 2-3 句'],
    })
    setResponses([{ status: 200, content: driftedReport }, { status: 200, content: driftedReport }])
    const before4b = llmCallCount
    const r4b = await submit('docx-file', null)
    assert(
      r4b.status === 'failed' && !r4b.report && !!r4b.failReason && llmCallCount === before4b + 2,
      '4b. LLM 维度结构漂移时拒绝结果（只能返回固定 6 维度，未知 key 被拒）',
    )

    // ── 5. providerName !== mock ─────────────────────────────────────────────
    assert(r2.providerName === 'llm' && r2.providerName !== 'mock', '5. 成功结果 providerName=llm（非 mock，前端横幅自动消失）')

    // ── 6. AiResumeResult payloadJson 不含简历原文哨兵 ────────────────────────
    setResponses([{ status: 200, content: validReportJson() }])
    const r6 = await submit('docx-file', null)
    const row6 = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId: r6.taskId, kind: 'parse' } } })
    assert(
      !!row6 && row6.provider === 'llm' && !row6.payloadJson.includes(SENTINEL),
      '6. AiResumeResult.payloadJson 只存派生报告、不含简历原文哨兵',
    )

    // ── 7. 我方日志（logService + Logger）不含简历原文哨兵 ────────────────────
    const logsJoined = JSON.stringify(logEntries) + '\n' + loggerLines.join('\n')
    assert(
      !logsJoined.includes(SENTINEL) && logEntries.some((e) => e['operation'] === 'parseResume'),
      '7. 日志只含元数据、不含简历原文哨兵',
    )

    // ── 8. 未配置 LLM → 明确失败，不 fallback mock ───────────────────────────
    const before8 = llmCallCount
    const r8 = await aiUnconfigured.submitResumeParse(
      { fileId: 'docx-file', fileName: 'r.docx', fileFormat: 'docx', source: 'upload' },
      null,
    )
    createdTaskIds.push(r8.taskId)
    assert(
      r8.status === 'failed' &&
        !r8.report &&
        r8.providerName === 'llm' &&
        !!r8.failReason &&
        llmCallCount === before8,
      '8. 未配置 LLM 时明确失败（providerName=llm，无 report，未调用 LLM、不 fallback mock）',
    )

    // ── 9. 会员 / 匿名 accessToken 门禁未被破坏 ───────────────────────────────
    setResponses([{ status: 200, content: validReportJson() }])
    const anonRes = await submit('docx-file', null)
    const token = anonRes.accessToken
    if (!token) fail('9. 匿名 parse 未返回一次性 accessToken')
    const readOk = await ai.getResumeRecord(anonRes.taskId, { endUserId: null, accessToken: token })
    if (!readOk?.report) fail('9. 正确 token 读匿名结果失败')
    let wrongDenied = false
    try {
      await ai.getResumeRecord(anonRes.taskId, { endUserId: null, accessToken: 'deadbeef'.repeat(6) })
    } catch (e) {
      wrongDenied = (e as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()?.error?.code === 'AI_TASK_NOT_FOUND'
    }
    assert(!!token && !!readOk?.report && wrongDenied, '9. 匿名结果：正确 token 可读、错 token → AI_TASK_NOT_FOUND')

    await prisma.endUser.create({
      data: { id: userId, phoneHash: `diag-h-${suffix}`, phoneEnc: `diag-e-${suffix}`, nickname: '诊断会员' },
    })
    setResponses([{ status: 200, content: validReportJson() }])
    const memberRes = await submit('docx-file', userId)
    if (memberRes.accessToken) fail('9b. 会员 parse 不应铸造 accessToken')
    const memberRead = await ai.getResumeRecord(memberRes.taskId, { endUserId: userId, accessToken: null })
    let crossDenied = false
    try {
      await ai.getResumeRecord(memberRes.taskId, { endUserId: `other_${suffix}`, accessToken: null })
    } catch (e) {
      crossDenied = (e as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()?.error?.code === 'AI_TASK_NOT_FOUND'
    }
    assert(
      !memberRes.accessToken && !!memberRead?.report && crossDenied,
      '9b. 会员结果：本人可读、不铸 token、跨会员 → AI_TASK_NOT_FOUND',
    )

    // ── 10. 合规词过滤：suggestions/riskNotes/priorities 含拦截词的条目被丢弃 ──
    const dirtyReport = JSON.stringify({
      sections: [
        { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
        { key: 'objective', label: '求职目标清晰度', score: 6, maxScore: 10 },
        { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
        { key: 'quantification', label: '成果量化程度', score: 5, maxScore: 10 },
        { key: 'keyword', label: '岗位关键词覆盖', score: 5, maxScore: 10 },
        { key: 'readability', label: '版式与可读性', score: 7, maxScore: 10 },
      ],
      suggestions: [`该简历${GUARD_TERM_HIRE}较低`, '个人简介精简至 2-3 句'],
      riskNotes: [`${GUARD_TERM_MATCH}不高`, '经历缺少量化描述'],
      priorities: [
        { focus: '补充成果量化', reason: '缺少可衡量结果' },
        { focus: `提升${GUARD_TERM_MATCH}`, reason: GUARD_TERM_HIRE },
      ],
    })
    setResponses([{ status: 200, content: dirtyReport }])
    const r10 = await submit('docx-file', null)
    const rep10 = r10.report
    const flat10 = JSON.stringify(rep10 ?? {})
    assert(
      r10.status === 'completed' &&
        !!rep10 &&
        !flat10.includes(GUARD_TERM_HIRE) &&
        !flat10.includes(GUARD_TERM_MATCH) &&
        // 干净条目保留：suggestions 仍有「个人简介」、riskNotes 仍有「经历缺少量化」、priorities 仍有「补充成果量化」
        rep10.suggestions.some((s) => s.includes('个人简介')) &&
        (rep10.riskNotes ?? []).some((s) => s.includes('经历缺少量化')) &&
        (rep10.priorities ?? []).some((p) => p.focus.includes('补充成果量化')),
      '10. 合规词过滤：含拦截词条目被丢弃、干净条目保留（录用概率/企业匹配度未进报告）',
    )

    // ── 11. 旧 5-section 报告向后兼容：直接落库旧结构，读回不崩、字段照常 ──────
    const legacyTaskId = `legacy5_${suffix}`
    createdTaskIds.push(legacyTaskId)
    const legacyToken = 'feedface'.repeat(6)
    await prisma.aiResumeResult.create({
      data: {
        taskId: legacyTaskId,
        kind: 'parse',
        status: 'completed',
        provider: 'llm',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        endUserId: null,
        accessTokenHash: createHash('sha256').update(legacyToken).digest('hex'),
        payloadJson: JSON.stringify({
          taskId: legacyTaskId,
          status: 'completed',
          providerName: 'llm',
          report: {
            sections: [
              { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
              { key: 'education', label: '教育经历完整度', score: 9, maxScore: 10 },
              { key: 'experience', label: '实习/项目经历表达', score: 6, maxScore: 10 },
              { key: 'skills', label: '技能关键词覆盖', score: 5, maxScore: 10 },
              { key: 'layout', label: '排版可读性', score: 7, maxScore: 10 },
            ],
            suggestions: ['旧报告建议一', '旧报告建议二'],
          },
        }),
      },
    })
    const legacyRead = await ai.getResumeRecord(legacyTaskId, { endUserId: null, accessToken: legacyToken })
    assert(
      !!legacyRead?.report &&
        legacyRead.report.sections.length === 5 &&
        legacyRead.report.suggestions.length === 2 &&
        legacyRead.report.riskNotes === undefined &&
        legacyRead.report.priorities === undefined,
      '11. 旧 5-section 报告（无 riskNotes/priorities）仍可正常读回、不报错',
    )

    // ── 12. priorities 缺 reason 的条目被丢弃（report 仍 completed，只保留完整条目）──
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      priorities: [
        { focus: '补充成果量化', reason: '缺少可衡量结果' },
        { focus: '明确求职目标', reason: '意向方向不清晰' },
        { focus: '缺 reason 的条目' }, // 无 reason → 应被丢弃
      ],
    }) }])
    const r12 = await submit('docx-file', null)
    assert(
      r12.status === 'completed' &&
        (r12.report?.priorities?.length ?? 0) === 2 &&
        (r12.report?.priorities ?? []).every((p) => typeof p.reason === 'string' && p.reason.length > 0),
      '12. priorities 缺 reason 条目被丢弃，完整条目保留（report 仍 completed）',
    )

    // ── 13. priorities 清洗后恰好 1 条 → 视为无效、触发 retry，最终失败 ──────────
    const onePriorityReport = JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      priorities: [{ focus: '补充成果量化', reason: '缺少可衡量结果' }],
    })
    setResponses([{ status: 200, content: onePriorityReport }, { status: 200, content: onePriorityReport }])
    const before13 = llmCallCount
    const r13 = await submit('docx-file', null)
    assert(
      r13.status === 'failed' && !r13.report && llmCallCount === before13 + 2,
      '13. priorities 恰好 1 条 → 无效、重试一次后失败（不接受半截）',
    )

    // ── 14. 超长 suggestions/riskNotes/priorities 被截断 ────────────────────────
    const longS = '改'.repeat(200)
    const longR = '险'.repeat(200)
    const longFocus = '点'.repeat(60)
    const longReason = '因'.repeat(200)
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: [longS, '正常建议'],
      riskNotes: [longR],
      priorities: [
        { focus: longFocus, reason: longReason },
        { focus: '明确求职目标', reason: '意向方向不清晰' },
      ],
    }) }])
    const r14 = await submit('docx-file', null)
    const rep14 = r14.report
    assert(
      r14.status === 'completed' &&
        !!rep14 &&
        rep14.suggestions[0].length === 120 &&
        (rep14.riskNotes ?? [])[0]?.length === 120 &&
        (rep14.priorities ?? [])[0]?.focus.length === 40 &&
        (rep14.priorities ?? [])[0]?.reason.length === 120,
      '14. 超长 suggestions/riskNotes/priority.focus(≤40)/priority.reason(≤120) 被截断',
    )

    // ── 15. 小数 / 越界分值被拒绝（maxScore=9.6、score=7.5 均不放行）─────────────
    const badMax = JSON.stringify({ sections: sixSections((s) => { s[0].maxScore = 9.6 }), suggestions: ['x 建议'] })
    setResponses([{ status: 200, content: badMax }, { status: 200, content: badMax }])
    const before15a = llmCallCount
    const r15a = await submit('docx-file', null)
    assert(
      r15a.status === 'failed' && !r15a.report && llmCallCount === before15a + 2,
      '15a. maxScore=9.6 被拒绝（严格 ===10，不四舍五入放行）',
    )
    const badScore = JSON.stringify({ sections: sixSections((s) => { s[1].score = 7.5 }), suggestions: ['x 建议'] })
    setResponses([{ status: 200, content: badScore }, { status: 200, content: badScore }])
    const before15b = llmCallCount
    const r15b = await submit('docx-file', null)
    assert(
      r15b.status === 'failed' && !r15b.report && llmCallCount === before15b + 2,
      '15b. score=7.5 被拒绝（必须 0~10 整数）',
    )
  } finally {
    if (createdTaskIds.length) {
      await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: createdTaskIds } } })
    }
    await prisma.endUser.deleteMany({ where: { id: userId } })
    await prisma.onModuleDestroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  console.log('\n=== ALL PASS ===\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
