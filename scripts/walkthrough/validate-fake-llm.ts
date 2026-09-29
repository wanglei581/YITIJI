// ============================================================
// 走查假模型 / 假 OCR 的契约自检：用 services/api 里**真实的服务类**（真实 fetch、
// 真实并发闸门、真实内容检查、真实解析与防编造校验）去打正在运行的假服务，
// 确认每条调用链都能拿到被接受的结果，以及几种故障模式会落到预期的错误码。
//
// 先启动两个假服务，再在 services/api 目录下运行：
//   FAKE_LLM_PORT=4340 FAKE_OCR_PORT=4341 FAKE_LLM_STATE_DIR=... FAKE_OCR_STATE_DIR=... \
//     node -r @swc-node/register ../../scripts/walkthrough/validate-fake-llm.ts
//
// 只做本机走查自检，不进 CI、不连任何真实厂商。
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// 超时读在模块加载期：必须在 import 服务之前设好（下限 5 秒）。
process.env['AI_LLM_TIMEOUT_MS'] = process.env['AI_LLM_TIMEOUT_MS'] ?? '6000'
process.env['AI_LLM_LONG_TIMEOUT_MS'] = process.env['AI_LLM_LONG_TIMEOUT_MS'] ?? '6000'
process.env['AI_JOB_LLM_TIMEOUT_MS'] = process.env['AI_JOB_LLM_TIMEOUT_MS'] ?? '6000'
process.env['BAIDU_OCR_TIMEOUT_MS'] = process.env['BAIDU_OCR_TIMEOUT_MS'] ?? '3000'

const LLM_PORT = Number(process.env['FAKE_LLM_PORT'] || 4340)
const OCR_PORT = Number(process.env['FAKE_OCR_PORT'] || 4341)
const LLM_STATE = process.env['FAKE_LLM_STATE_DIR'] || join(homedir(), '.cache', 'walk0929', 'fake-llm')
const OCR_STATE = process.env['FAKE_OCR_STATE_DIR'] || join(homedir(), '.cache', 'walk0929', 'fake-ocr')
process.env['BAIDU_OCR_BASE_URL'] = `http://127.0.0.1:${OCR_PORT}`
process.env['BAIDU_OCR_API_KEY'] = 'walk-fake-ocr-key'
process.env['BAIDU_OCR_SECRET_KEY'] = 'walk-fake-ocr-secret'

type Row = { name: string; ok: boolean; detail: string }
const rows: Row[] = []
const record = (name: string, ok: boolean, detail: string) => {
  rows.push({ name, ok, detail })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}\n`)
}

function errorCode(error: unknown): string {
  const e = error as { getResponse?: () => unknown; message?: string }
  const resp = typeof e?.getResponse === 'function' ? e.getResponse() as { error?: { code?: string }; message?: unknown } : undefined
  return resp?.error?.code ?? (typeof resp?.message === 'string' ? resp.message : '') ?? e?.message ?? String(error)
}

async function expectOk<T>(name: string, run: () => Promise<T>, check: (value: T) => string | null): Promise<T | null> {
  try {
    const value = await run()
    const problem = check(value)
    record(name, problem === null, problem ?? 'accepted')
    return value
  } catch (error) {
    record(name, false, `threw ${errorCode(error) || (error as Error)?.message}`)
    return null
  }
}

async function expectError(name: string, run: () => Promise<unknown>, expected: RegExp): Promise<void> {
  try {
    await run()
    record(name, false, 'expected an error, got success')
  } catch (error) {
    const code = errorCode(error) || String((error as Error)?.message)
    record(name, expected.test(code), `code=${code}`)
  }
}

function setMode(dir: string, mode: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'mode'), `${mode}\n`)
}

async function main() {
  const { DEFAULT_FORBIDDEN_WORDS, DEFAULT_ROLE_SCOPE } = await import('../../services/api/src/ai/llm/llm-guard')
  const { DEFAULT_SYSTEM_PROMPT } = await import('../../services/api/src/ai/llm/llm-config.service')
  const cfg = {
    vendor: 'deepseek', model: 'deepseek-v4-flash', baseURL: `http://127.0.0.1:${LLM_PORT}/v1`,
    systemPrompt: DEFAULT_SYSTEM_PROMPT, roleScope: DEFAULT_ROLE_SCOPE, forbiddenWords: [...DEFAULT_FORBIDDEN_WORDS],
    temperature: 0.3, enabled: true,
  }
  const config = { getApiKey: () => 'walk-fake-llm-key', getConfig: () => cfg, isReady: () => true } as never

  const { BaiduOcrProvider } = await import('../../services/api/src/ai/resume/ocr/baidu-ocr.provider')
  const { LlmResumeService } = await import('../../services/api/src/ai/resume/llm-resume.service')
  const { LlmResumeOptimizeService } = await import('../../services/api/src/ai/resume/llm-resume-optimize.service')
  const { LlmResumeGenerateService } = await import('../../services/api/src/ai/resume/llm-resume-generate.service')
  const { LlmJobFitService } = await import('../../services/api/src/ai/resume/llm-job-fit.service')
  const { LlmCareerPlanService } = await import('../../services/api/src/ai/resume/llm-career-plan.service')
  const { LlmSelfAssessmentService } = await import('../../services/api/src/ai/resume/llm-self-assessment.service')
  const { LlmFairVisitPlanService } = await import('../../services/api/src/ai/resume/llm-fair-visit-plan.service')
  const { JobAiLlmService } = await import('../../services/api/src/job-ai/job-ai-llm.service')
  const { MockInterviewLlmService } = await import('../../services/api/src/mock-interview/mock-interview-llm.service')
  const { LlmAdvisorService } = await import('../../services/api/src/advisor/llm-advisor.service')
  const { AssistantSummaryService } = await import('../../services/api/src/advisor/assistant-summary.service')
  const { LlmChatService } = await import('../../services/api/src/ai/llm/llm-chat.service')
  const { ContractReviewProviderService } = await import('../../services/api/src/contract-review/contract-review-provider.service')

  setMode(LLM_STATE, 'ok')
  setMode(OCR_STATE, 'ok')

  // ── OCR ───────────────────────────────────────────────────
  const ocr = new BaiduOcrProvider()
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const ocrOk = await ocr.recognize({ buffer: png, mimeType: 'image/png' } as never)
  const resumeText = ocrOk.ok ? ocrOk.text : ''
  record('ocr.ok', ocrOk.ok && ocrOk.confidence === 'high' && resumeText.split('\n').length >= 20,
    ocrOk.ok ? `lines=${resumeText.split('\n').length} confidence=${ocrOk.confidence}` : JSON.stringify(ocrOk))
  for (const [mode, expect] of [
    ['lowconf', (r: any) => r.ok && r.confidence === 'low'],
    ['empty', (r: any) => r.ok && r.text === ''],
    ['error17', (r: any) => !r.ok && /额度|繁忙/.test(r.errorMessage)],
    ['error18', (r: any) => !r.ok && /额度|繁忙/.test(r.errorMessage)],
    ['timeout', (r: any) => !r.ok && /超时/.test(r.errorMessage)],
  ] as const) {
    setMode(OCR_STATE, mode)
    const r = await ocr.recognize({ buffer: png, mimeType: 'image/png' } as never)
    record(`ocr.${mode}`, expect(r), JSON.stringify(r).slice(0, 160))
  }
  setMode(OCR_STATE, 'ok')

  // ── 简历诊断 → 优化 → 排版 ────────────────────────────────
  const diag = new LlmResumeService(config)
  const report = await expectOk('resume_diagnosis', () => diag.diagnose(resumeText), (r) =>
    r.sections.length === 6 && (r.contentBlocks?.length ?? 0) >= 4 && (r.issues?.length ?? 0) >= 1 && (r.priorities?.length ?? 0) >= 2
      ? null : `sections=${r.sections.length} blocks=${r.contentBlocks?.length} issues=${r.issues?.length} priorities=${r.priorities?.length}`)
  if (report) record('resume_diagnosis.detail', true, `blocks=${report.contentBlocks!.map((b) => `${b.key}:${b.lines.length}`).join(',')} issues=${report.issues!.length}`)

  const opt = new LlmResumeOptimizeService(config)
  const optimized = report ? await expectOk('resume_optimize', () => opt.optimize(resumeText, report), (r) =>
    r.optimizedResume.experience.length >= 1 && r.optimizedResume.education.length >= 1 && r.modules.length >= 2
      ? null : `exp=${r.optimizedResume.experience.length} edu=${r.optimizedResume.education.length} modules=${r.modules.length}`) : null
  if (optimized) {
    const b = optimized.optimizedResume.basic
    record('resume_optimize.facts', Boolean(b.name && b.phone && b.email), `name=${b.name} phone=${b.phone} email=${b.email} certs=${optimized.optimizedResume.certificates.join('|')}`)
    await expectOk('resume_layout_adjust.condense', () => opt.adjustLayoutDraft({ currentResume: optimized.optimizedResume, originalText: resumeText, action: 'condense' }),
      (r) => (r.warnings.length >= 1 ? null : 'no warnings'))
    await expectOk('resume_layout_adjust.reformat', () => opt.adjustLayoutDraft({ currentResume: optimized.optimizedResume, originalText: resumeText, action: 'reformat', layout: { fontScale: 'md' } as never }),
      (r) => (r.resume.experience.length === optimized.optimizedResume.experience.length ? null : 'entry count changed'))
  }

  const gen = new LlmResumeGenerateService(config)
  await expectOk('resume_generate', () => gen.generate({
    basic: { name: '测试·李梅', phone: '13800000002' },
    intention: { position: '行政文员' },
    education: [{ school: '测试职业学院', major: '文秘', degree: '大专', description: '学习办公软件与公文写作' }],
    experience: [{ company: '测试商贸有限公司', role: '前台', description: '接待来访客户，整理快递和文件' }],
    projects: [],
    skills: ['word', 'Excel'],
    certificates: [],
  }), (r) => (r.experience[0]!.description.includes('负责') ? null : 'experience not polished'))

  // ── 岗位对照 / 规划 / 自我探索 / 招聘会 / 岗位 AI ─────────
  const jobCtx = {
    title: '仓库管理员', company: '测试物流有限公司',
    description: '负责仓库货物出入库登记\n定期盘点库存并整理报表',
    requirements: '1. 中专及以上学历\n2. 熟悉ERP系统出入库操作\n3. 会用Excel制作报表\n4. 持叉车操作证者优先\n5. 能接受倒班',
  }
  await expectOk('job_fit', () => new LlmJobFitService(config).analyze(resumeText, jobCtx), (r) =>
    r.payload.matchPoints.length >= 1 && r.payload.decisionSupport?.analysisVersion === 'job_fit_m1_5' ? null : JSON.stringify(r.payload).slice(0, 200))
  await expectOk('career_plan', () => new LlmCareerPlanService(config).build({ resumeText }), (r) =>
    r.currentSnapshot.length >= 1 && r.directions.length >= 1 ? null : JSON.stringify(r).slice(0, 200))
  const dims = [['interest', '兴趣偏好', 4], ['style', '工作风格', 3], ['team', '团队偏向', 2], ['value', '价值取向', 5], ['motivation', '求职动机', 1]]
    .map(([key, label, strength]) => ({ key, label, strength, note: null, evidenceQuestionIdx: [] })) as never[]
  await expectOk('self_assessment', () => new LlmSelfAssessmentService(config).summarize({ scored: { dimensions: dims, summary: null }, consent: { nonSensitive: true, sensitive: false } }),
    (r) => (r.status === 'completed' && r.summary && (r.dimensions as Array<{ note: string | null }>).every((d) => d.note) ? null : JSON.stringify(r).slice(0, 200)))
  const fairCtx = (mode: 'preparation' | 'review') => ({
    resumeText, mode,
    fair: { id: 'walk-fair', title: '走查测试招聘会', sourceName: '测试人社局', sourceUrl: 'https://example.com/fair', startAt: '', endAt: '', venue: '测试会展中心', city: '青岛' },
    fairCompanies: [
      { companyName: '测试物流有限公司', industry: '物流', sourceUrl: 'https://example.com/c1', positions: [{ title: '仓库管理员', requirements: '熟悉出入库', education: '中专', location: '青岛' }] },
      { companyName: '测试装备制造有限公司', industry: '制造', sourceUrl: null, positions: [{ title: '装配班组长', requirements: null, education: null, location: null }] },
    ],
  })
  await expectOk('fair_visit_plan.preparation', () => new LlmFairVisitPlanService(config).build(fairCtx('preparation')), (r) =>
    r.mode === 'preparation' && r.priorityCompanies.length === 2 ? null : JSON.stringify(r).slice(0, 200))
  await expectOk('fair_visit_plan.review', () => new LlmFairVisitPlanService(config).build(fairCtx('review')), (r) =>
    r.mode === 'review' && r.followUpActions.length >= 1 ? null : JSON.stringify(r).slice(0, 200))
  const jobs = ['walk-job-1', 'walk-job-2'].map((jobId, i) => ({
    jobId, title: i ? '装配工' : '仓库管理员', company: '测试物流有限公司', sourceName: '测试来源', sourceUrl: 'https://example.com',
    externalId: `ext-${i}`, description: jobCtx.description, requirements: jobCtx.requirements, skills: ['Excel'], city: '青岛',
  }))
  const jobAi = new JobAiLlmService(config)
  await expectOk('job_recommend', () => jobAi.recommend(resumeText, jobs), (r) => (r.items.length === 2 ? null : `items=${r.items.length}`))
  await expectOk('job_explain', () => jobAi.explain(jobs[0]!), (r) => (r.payload.responsibilities.length >= 1 && r.payload.mustHaveRequirements.length >= 1 ? null : JSON.stringify(r.payload)))

  // ── 模拟面试 ──────────────────────────────────────────────
  const mock = new MockInterviewLlmService(config)
  const persona = { interviewerType: 'hr', industry: '物流', position: '仓库管理员', experience: 'gt5', difficulty: 'standard' }
  await expectOk('mock_interview.first_question', () => mock.nextQuestion({ ...persona, questionTarget: 5, askedCount: 0, resumeDigest: null, transcript: [] }),
    (r) => (r.greeting && r.qType === 'intro' ? null : JSON.stringify(r)))
  await expectOk('mock_interview.middle_question', () => mock.nextQuestion({ ...persona, questionTarget: 5, askedCount: 2, resumeDigest: null, transcript: [{ role: 'interviewer', content: '请自我介绍' }, { role: 'candidate', content: '我做了二十多年装配工作' }] }),
    (r) => (r.question && !r.greeting ? null : JSON.stringify(r)))
  await expectOk('mock_interview.report', () => mock.buildReport({ ...persona, resumeDigest: null, transcript: [{ role: 'interviewer', content: '请自我介绍' }, { role: 'candidate', content: '我做了二十多年装配工作', durationSec: 40 }] }),
    (r) => (r.overall.level && r.checklist.length >= 3 ? null : JSON.stringify(r).slice(0, 200)))

  // ── 顾问作业面 / 小青 ─────────────────────────────────────
  const advisor = new LlmAdvisorService(config)
  await expectOk('advisor.classify', () => advisor.classify('我的简历够不够格去应聘仓库管理员'), (r) => (r.source === 'llm' && r.skill === 'compare' ? null : JSON.stringify(r)))
  await expectOk('advisor.qa', () => advisor.answer('四十五岁了还要不要换行业', []), (r) => (r.answer && r.evidenceLevel === 'E3' ? null : JSON.stringify(r)))
  await expectOk('advisor.draft', () => advisor.draft({ intro: { value: '做了二十年装配，带过12人班组', filledAt: '' }, target: { value: '仓库管理员', filledAt: '' } }, ['intro', 'target']),
    (r) => (r.draft.includes('____') ? null : r.draft))
  await expectOk('advisor.compare', () => advisor.compare(resumeText, jobCtx.requirements), (r) =>
    (r.items.some((i) => i.verdict === 'covered') ? null : JSON.stringify(r.items).slice(0, 200)))

  const chat = new LlmChatService(config)
  const chatOut = await expectOk('assistant_chat', () => chat.chat({ message: '我想改一下简历，从哪里开始？' } as never, undefined, 'walk-owner'),
    (r) => (r.reply.includes('简历') && r.actions.length >= 1 ? null : JSON.stringify(r)))
  await expectOk('assistant_chat.admin_test', () => chat.test('assistant_chat'), (r) => (r.ok ? null : JSON.stringify(r)))
  if (chatOut) {
    const summary = new AssistantSummaryService(null as never, chat, config, null as never, null as never, null as never)
    const turns = chat.getOwnedTranscript(chatOut.sessionId, 'walk-owner') ?? []
    await expectOk('assistant_summary', () => (summary as never as { condense: (t: unknown) => Promise<{ highlights: string[]; todos: string[] }> }).condense(turns),
      (r) => (r.highlights.length >= 1 ? null : JSON.stringify(r)))
  }

  // ── 合同审查：生产配置只认 https://api.deepseek.com/，这里用自定义 transport 直打假服务 ──
  const contract = new ContractReviewProviderService({
    env: () => ({ CONTRACT_REVIEW_PROVIDER: 'deepseek', CONTRACT_REVIEW_BASE_URL: 'https://api.deepseek.com/', CONTRACT_REVIEW_MODEL: 'deepseek-v4-pro', CONTRACT_REVIEW_API_KEY: 'walk-fake-contract-key-0001' }),
    approvalGate: { assertApproved: () => undefined },
    transport: {
      async send(request) {
        const res = await fetch(`http://127.0.0.1:${LLM_PORT}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}` }, body: JSON.stringify(request.payload),
        })
        return { status: res.status, redirected: false, body: await res.text() }
      },
    },
  })
  await expectOk('contract_review', () => contract.reviewWithIdentity({
    pages: [{ pageNumber: 1, text: '甲方：[用人单位_1]\n乙方：[劳动者_1]\n第三条 试用期为三个月。\n第七条 甲方依法为乙方缴纳社会保险。' }],
    partyFacts: { hasPartyA: true, hasPartyB: true, hasEmployer: false, hasWorker: false, hasUscc: false, hasBankAccount: false },
  }), (r) => (r.draft.findings.length >= 1 && r.usage ? null : JSON.stringify(r).slice(0, 200)))

  // ── 故障模式（真实服务的错误分流）───────────────────────
  const failText = (marker: string) => `${resumeText}\n【走查故障:${marker}】`
  await expectError('fault.marker.http500 → diagnosis', () => diag.diagnose(failText('http500')), /^AI_PROVIDER_ERROR$/)
  await expectError('fault.marker.blocked → diagnosis', () => diag.diagnose(failText('blocked')), /^AI_PROVIDER_REQUEST_ERROR$/)
  await expectError('fault.marker.badjson → diagnosis', () => diag.diagnose(failText('badjson')), /AI_DIAGNOSIS_INVALID_OUTPUT/)
  await expectError('fault.marker.timeout → diagnosis', () => diag.diagnose(failText('timeout')), /AI_DIAGNOSIS_TIMEOUT/)
  await expectError('fault.marker.badjson → chat', () => chat.chat({ message: '你好【走查故障:badjson】' } as never, undefined, 'walk-owner-2'), /未返回内容/)
  setMode(LLM_STATE, 'http500')
  await expectError('fault.file.http500 → job_fit', () => new LlmJobFitService(config).analyze(resumeText, jobCtx), /^AI_PROVIDER_ERROR$/)
  setMode(LLM_STATE, 'badjson')
  await expectError('fault.file.badjson → job_recommend', () => jobAi.recommend(resumeText, jobs), /AI_OUTPUT_INVALID/)
  setMode(LLM_STATE, 'ok')

  const failed = rows.filter((r) => !r.ok)
  process.stdout.write(`\n${rows.length - failed.length}/${rows.length} passed\n`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => {
  process.stderr.write(`validate-fake-llm crashed: ${error?.stack ?? error}\n`)
  process.exitCode = 2
})
