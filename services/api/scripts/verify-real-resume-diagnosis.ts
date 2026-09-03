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
/** 简历原文里的手机号；送模型前会被遮盖成 [手机号_N]，模型看不到它（用例 20）。 */
const PHONE_RAW = '13800001111'

// ── S25：内容结构 / 问题证据的固定素材（引文必须逐字出自 defaultText）────────
const LINE_TITLE = '姓名 张三 ZZ_DIAG_SENTINEL_77'
const LINE_OBJECTIVE = '求职意向 前端工程师'
const LINE_EXPERIENCE = '工作经历 2019-2024 ABC 高级前端'
const LINE_SKILL = '技能 TypeScript React NestJS'
/** 超过 80 字上限的真实行（用来验证截断后仍能回配成功）。 */
const LONG_LINE = '负责社群运营与用户增长，'.repeat(9)

/** 一份合法的 contentBlocks + issues（引文全部出自 defaultText）。 */
function structurePayload() {
  return {
    contentBlocks: [
      { key: 'basic', lines: [LINE_TITLE] },
      { key: 'objective', lines: [LINE_OBJECTIVE] },
      { key: 'experience', lines: [LINE_EXPERIENCE] },
      { key: 'skill', lines: [LINE_SKILL] },
    ],
    issues: [
      {
        id: '模型自拟的脏 id"><script>',
        dim: 'quantification',
        title: '经历没有交代结果',
        evidence: [{ blockKey: 'experience', quote: 'ABC 高级前端' }], // 片段引用 → 服务端回配整行
        impact: '读的人看不到你做成了什么。',
        fixIt: '每条后面补一句可核实的结果。',
      },
      {
        dim: 'keyword',
        title: '技能只列了名词',
        evidence: [{ blockKey: 'skill', quote: LINE_SKILL }],
        impact: '读的人看不出你到什么熟练度。',
        fixIt: '每项技能后面补一句你用它做过什么。',
      },
    ],
  }
}

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
  //
  // S25：文本里放了一个真实形态的手机号 PHONE_RAW。它在送模型前会被
  // maskUserTextForLlmText 换成 [手机号_N] 占位符，**模型永远看不到原号**。
  // 用例 20 用它证明「防编造校验的基准是送出去的那一份遮盖文本，不是原文」。
  const defaultText = `姓名 张三 ${SENTINEL}\n手机 ${PHONE_RAW}\n求职意向 前端工程师\n工作经历 2019-2024 ABC 高级前端\n技能 TypeScript React NestJS`
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

  // S25：内容结构用例的专用文本 = 默认文本 + 一条超 80 字的真实长行
  const structText = `${defaultText}\n${LONG_LINE}`
  extractionByFileId.set('struct-file', {
    ok: true,
    fileId: 'struct-file',
    text: structText,
    textSource: 'docx',
    confidence: 'high',
    charCount: structText.length,
  })

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

    // ── 16. 截断必须如实告知（不限 OCR 来源）────────────────────────────────────
    //
    // 回归背景：extractionNotice 此前只在 textSource 为 image_ocr / pdf_ocr 时下发，
    // 文字层 PDF / DOCX 的 warnings（其中包含「已截断至 N 字符」）被整条丢弃。
    // 结果是超长简历只有前一段进了诊断，用户却拿到一份看起来覆盖全文的报告。
    const longText = `${defaultText}\n${'工作职责描述补充。'.repeat(3000)}`
    extractionByFileId.set('long-pdf-file', {
      ok: true,
      fileId: 'long-pdf-file',
      text: longText,
      textSource: 'pdf_text',
      confidence: 'high',
      charCount: longText.length,
      warnings: ['简历文本较长，已截断至 20000 字符用于后续分析'],
    })
    setResponses([{ status: 200, content: validReportJson() }])
    const r16 = await submit('long-pdf-file', null)
    assert(
      r16.status === 'completed' && !!r16.extractionNotice,
      `16a. 文字层来源（pdf_text）的截断提示也必须下发 extractionNotice，got ${JSON.stringify(r16.extractionNotice ?? null)}`,
    )
    assert(
      (r16.extractionNotice?.warnings ?? []).some((w) => w.includes('截断')),
      '16b. extractionNotice 保留提取层的「已截断」告警',
    )
    assert(
      (r16.extractionNotice?.warnings ?? []).some((w) => w.includes('12000')),
      '16c. 诊断层二次截断（12000 字符）同样如实告知，不再无声',
    )
    assert(
      r16.extractionNotice?.textSource === 'pdf_text',
      '16d. textSource 如实透出为 pdf_text，供前端区分「OCR 识别」与「文字层提取」文案',
    )

    // 16e) 无任何 warning 的普通文字层简历不应凭空多出 extractionNotice（避免噪声）
    setResponses([{ status: 200, content: validReportJson() }])
    const r16e = await submit('docx-file', null)
    assert(
      r16e.status === 'completed' && !r16e.extractionNotice,
      `16e. 无警告的文字层简历不下发 extractionNotice，got ${JSON.stringify(r16e.extractionNotice ?? null)}`,
    )

    // ══════════════════════════════════════════════════════════════════════
    // S25 内容结构（contentBlocks）+ 问题证据（issues）
    // ══════════════════════════════════════════════════════════════════════

    // ── 17. 正常路径：内容结构与问题证据落进报告，label/顺序/id/lineIndex 由服务端定 ──
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      ...structurePayload(),
    }) }])
    const r17 = await submit('struct-file', null)
    const blocks17 = r17.report?.contentBlocks ?? []
    const issues17 = r17.report?.issues ?? []
    assert(
      r17.status === 'completed' &&
        blocks17.map((b) => b.key).join(',') === 'basic,objective,experience,skill' &&
        blocks17.every((b) => b.lines.length === 1),
      `17a. contentBlocks 按 canonical 顺序输出、只保留有内容的块，got ${blocks17.map((b) => b.key).join(',')}`,
    )
    assert(
      blocks17.find((b) => b.key === 'experience')?.label === '工作经历' &&
        blocks17.find((b) => b.key === 'skill')?.label === '技能',
      '17b. label 用服务端 canonical 值（模型未给 label 也不影响）',
    )
    assert(
      issues17.length === 2 &&
        issues17[0].id === 'I1' && issues17[1].id === 'I2' &&
        !JSON.stringify(issues17).includes('<script>'),
      `17c. issue id 由服务端分配为 I1/I2，模型自拟的脏 id 被丢弃，got ${issues17.map((i) => i.id).join(',')}`,
    )
    const ev17 = issues17[0]?.evidence?.[0]
    assert(
      issues17[0]?.dim === 'quantification' &&
        ev17?.blockKey === 'experience' &&
        ev17?.lineIndex === 0 &&
        ev17?.quote === LINE_EXPERIENCE,
      `17d. 模型只发 {blockKey,quote}（且只是片段），lineIndex 由服务端回配、quote 被整行覆盖，got ${JSON.stringify(ev17 ?? null)}`,
    )
    assert(
      issues17.every((i) => i.evidence.every((e) => {
        const blk = blocks17.find((b) => b.key === e.blockKey)
        return !!blk && e.lineIndex >= 0 && e.lineIndex < blk.lines.length && blk.lines[e.lineIndex] === e.quote
      })),
      '17e. 每条证据的 lineIndex 都落在同 key 块的 lines 范围内且与 quote 一致（无悬空下标）',
    )
    assert(
      r17.report?.sections.length === 6 && (r17.report?.suggestions.length ?? 0) > 0,
      '17f. 新字段不影响既有 sections / suggestions',
    )

    // ── 18. 防编造：不在简历文本里的行被丢弃；整块编造的块不出现 ──────────────
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      contentBlocks: [
        { key: 'experience', lines: ['我在字节跳动做过三年架构师', LINE_EXPERIENCE] },
        { key: 'project', lines: ['主导了一个百万级用户的中台项目'] },
        { key: 'nope_not_a_block', lines: [LINE_SKILL] },
      ],
    }) }])
    const r18 = await submit('struct-file', null)
    const blocks18 = r18.report?.contentBlocks ?? []
    assert(
      r18.status === 'completed' &&
        blocks18.length === 1 &&
        blocks18[0].key === 'experience' &&
        blocks18[0].lines.length === 1 &&
        blocks18[0].lines[0] === LINE_EXPERIENCE,
      `18. 编造行被丢弃、整块编造的块不出现、未知块 key 被忽略，got ${JSON.stringify(blocks18)}`,
    )

    // ── 19. 失败纪律：新字段非法**不得**让整份报告失败 ────────────────────────
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      priorities: [
        { focus: '补充成果量化', reason: '缺少可衡量结果' },
        { focus: '明确求职目标', reason: '意向方向不清晰' },
      ],
      contentBlocks: 'not-an-array',
      issues: 42,
    }) }])
    const before19 = llmCallCount
    const r19 = await submit('struct-file', null)
    assert(
      r19.status === 'completed' &&
        llmCallCount === before19 + 1 &&
        r19.report?.sections.length === 6 &&
        (r19.report?.suggestions.length ?? 0) > 0 &&
        (r19.report?.priorities?.length ?? 0) === 2 &&
        r19.report?.contentBlocks === undefined &&
        r19.report?.issues === undefined,
      '19a. contentBlocks/issues 非法时不重试、不失败：报告照常 completed，只是不附带这两个字段',
    )
    // issues 依赖 contentBlocks：块整体不合法时，问题也不能凭空存在
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      contentBlocks: [{ key: 'experience', lines: ['整段编造的经历'] }],
      issues: structurePayload().issues,
    }) }])
    const r19b = await submit('struct-file', null)
    assert(
      r19b.status === 'completed' &&
        r19b.report?.contentBlocks === undefined &&
        r19b.report?.issues === undefined,
      '19b. 所有块都被判编造时 issues 一并不附带（证据无处落脚，不做无证据的问题）',
    )

    // ── 20. 防编造基准是「送模型的那份遮盖文本」，不是简历原文 ────────────────
    //
    // 原文里有真实手机号，送模型前被换成 [手机号_N]。模型只可能抄到占位符那一版；
    // 拿原文当基准就会把原号引文也放行 —— 那等于自己放宽这条不变量。
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      contentBlocks: [{ key: 'basic', lines: [`手机 ${PHONE_RAW}`, '手机 [手机号_1]'] }],
    }) }])
    const r20 = await submit('struct-file', null)
    const lines20 = r20.report?.contentBlocks?.[0]?.lines ?? []
    assert(
      r20.status === 'completed' &&
        lines20.length === 1 &&
        lines20[0] === '手机 [手机号_1]' &&
        !JSON.stringify(r20.report ?? {}).includes(PHONE_RAW),
      `20a. 原文手机号引文被拒、遮盖后占位符引文被放行（校验基准=送出去的那一份），got ${JSON.stringify(lines20)}`,
    )
    const row20 = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId: r20.taskId, kind: 'parse' } } })
    assert(
      !!row20 && !row20.payloadJson.includes(PHONE_RAW) && row20.payloadJson.includes('[手机号_1]'),
      '20b. 落库 payloadJson 里只有遮盖后的片段，真实手机号不入库（内容结构新增的留存面已被遮盖收口）',
    )

    // ── 21. 上限二次强制（提示词写了，校验层也必须再强制一次）──────────────────
    const nineRealLines = [
      '姓名 张三', SENTINEL, '求职意向', '前端工程师', '工作经历',
      '2019-2024', 'ABC 高级前端', '技能 TypeScript', 'React NestJS',
    ]
    const manyIssues = Array.from({ length: 10 }, (_, i) => ({
      dim: 'experience',
      title: `问题标题 ${i}`,
      evidence: nineRealLines.slice(0, 5).map((quote) => ({ blockKey: 'experience', quote })),
      impact: '读的人看不出重点。',
      fixIt: '把这一行改写得更具体。',
    }))
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      contentBlocks: [
        { key: 'experience', lines: nineRealLines },
        { key: 'selfintro', lines: [LONG_LINE] },
      ],
      issues: manyIssues,
    }) }])
    const r21 = await submit('struct-file', null)
    const exp21 = r21.report?.contentBlocks?.find((b) => b.key === 'experience')
    const intro21 = r21.report?.contentBlocks?.find((b) => b.key === 'selfintro')
    assert(exp21?.lines.length === 6, `21a. 每块 lines ≤ 6 行，got ${exp21?.lines.length}`)
    assert(
      intro21?.lines[0]?.length === 80 && LONG_LINE.startsWith(intro21?.lines[0] ?? ''),
      `21b. 单行 ≤ 80 字（截断后仍是原文前缀、回配依然成立），got ${intro21?.lines[0]?.length}`,
    )
    assert((r21.report?.issues?.length ?? 0) === 8, `21c. issues ≤ 8 条，got ${r21.report?.issues?.length}`)
    assert(
      (r21.report?.issues ?? []).every((i) => i.evidence.length <= 3) &&
        (r21.report?.issues?.[0]?.evidence.length ?? 0) === 3,
      `21d. 每条 evidence ≤ 3 处，got ${r21.report?.issues?.[0]?.evidence.length}`,
    )
    assert(
      (r21.report?.issues ?? []).map((i) => i.id).join(',') === 'I1,I2,I3,I4,I5,I6,I7,I8',
      '21e. id 按输出顺序连续分配，不留空洞',
    )

    // ── 22. issues 的三段自撰文案必须过合规拦截词；维度不得漂移 ────────────────
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
      contentBlocks: structurePayload().contentBlocks,
      issues: [
        { dim: 'experience', title: `这会拉低${GUARD_TERM_HIRE}`, evidence: [{ blockKey: 'experience', quote: LINE_EXPERIENCE }], impact: '正常影响', fixIt: '正常改法' },
        { dim: 'experience', title: '正常标题', evidence: [{ blockKey: 'experience', quote: LINE_EXPERIENCE }], impact: `${GUARD_TERM_MATCH}偏低`, fixIt: '正常改法' },
        { dim: 'experience', title: '正常标题二', evidence: [{ blockKey: 'experience', quote: LINE_EXPERIENCE }], impact: '正常影响', fixIt: `建议${GUARD_TERM_HIRE}优化` },
        { dim: '生造维度', title: '维度漂移', evidence: [{ blockKey: 'experience', quote: LINE_EXPERIENCE }], impact: '正常影响', fixIt: '正常改法' },
        { dim: 'experience', title: '证据编造', evidence: [{ blockKey: 'experience', quote: '我拿过全国一等奖' }], impact: '正常影响', fixIt: '正常改法' },
        { dim: 'experience', title: '证据指错块', evidence: [{ blockKey: 'education', quote: LINE_EXPERIENCE }], impact: '正常影响', fixIt: '正常改法' },
        { dim: 'objective', title: '求职目标只写了愿望', evidence: [{ blockKey: 'objective', quote: LINE_OBJECTIVE }], impact: '读的人看不出你想去哪个岗位。', fixIt: '开头写明求职方向。' },
      ],
    }) }])
    const r22 = await submit('struct-file', null)
    const issues22 = r22.report?.issues ?? []
    const flat22 = JSON.stringify(issues22)
    assert(
      r22.status === 'completed' &&
        issues22.length === 1 &&
        issues22[0].dim === 'objective' &&
        !flat22.includes(GUARD_TERM_HIRE) &&
        !flat22.includes(GUARD_TERM_MATCH),
      `22. title/impact/fixIt 命中拦截词、dim 漂移、证据编造、证据指错块的条目全部丢弃，干净条目保留，got ${issues22.length} 条`,
    )

    // ── 23. truncatedInput：只送了前 12000 字符必须如实标记在报告体内 ──────────
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['个人简介精简至 2-3 句'],
    }) }])
    const r23 = await submit('long-pdf-file', null)
    assert(
      r23.status === 'completed' && r23.report?.truncatedInput === true,
      `23a. 输入被截断时 report.truncatedInput=true（否则用户会把「没送进模型」读成「简历里没有这几块」），got ${String(r23.report?.truncatedInput)}`,
    )
    setResponses([{ status: 200, content: validReportJson() }])
    const r23b = await submit('struct-file', null)
    assert(
      r23b.status === 'completed' && r23b.report?.truncatedInput === undefined,
      `23b. 未截断时不附带 truncatedInput（缺省即未截断），got ${String(r23b.report?.truncatedInput)}`,
    )

    // ── 24. 旧报告（无 contentBlocks/issues）仍合法：additive 可选未破坏兼容 ────
    setResponses([{ status: 200, content: validReportJson() }])
    const r24 = await submit('docx-file', null)
    assert(
      r24.status === 'completed' &&
        r24.report?.contentBlocks === undefined &&
        r24.report?.issues === undefined &&
        r24.report?.sections.length === 6,
      '24. 模型完全不返回新字段时报告照常成功（新结构是 additive，不是新的失败点）',
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
