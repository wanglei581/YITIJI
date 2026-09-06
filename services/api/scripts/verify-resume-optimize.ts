/**
 * 阶段2B — AI 简历优化真实化验证。
 *
 * 覆盖(对应需求验收点):
 *   1.  全链路:上传文本提取(受控桩) → 诊断(parse) → 优化(optimize) → 结构化优化版简历 + 新旧对比。
 *   2.  防编造(事实串):优化版中的学校/公司/证书必须出现在简历原文;LLM 返回原文不存在的
 *       学校 → 判非法重试,两次仍坏 → 诚实失败,且**失败不缓存**(下次可重试成功)。
 *   3.  防编造(对比稻草人):modules.before 不在原文 → 该条丢弃;在原文 → 保留。
 *   4.  承诺类拦截:after/描述命中"保录用"类词 → 判非法重试,第二次干净输出成功(2 次调用)。
 *   5.  联系方式防篡改:LLM 改写电话/邮箱(它根本没见过的值) → 该字段置空,不出错号简历。
 *   6.  归属门禁:优化行继承 parse 行 hash;正确 token 可读缓存,错 token → AI_TASK_NOT_FOUND。
 *   7.  缓存:成功结果落库(kind='optimize'),再读不再调 LLM。
 *   8.  原文清理后:提取失败 → 诚实失败(引导重新上传),不缓存。
 *   9.  未配置 → 诚实失败文案(不 fallback mock)。
 *   10. 优化版导出 PDF:真实 %PDF + FileObject(resume_upload,短 TTL)。
 *   11. 去程(#646):送模型的 prompt 不得含简历原始联系方式,只能是可还原占位符。
 *   12. 回程(#646):没被篡改的联系方式必须原样保留并还原为真值,产物无占位符残留。
 *
 * ── 桩模型必须只见得到「实际送出去的那一份」 ─────────────────────────────
 * #646 之后 optimize() 会先遮盖简历原文再拼 prompt,parseAndValidate 的事实串基线
 * 也换成了**送出去的那一份**(masked)。桩若继续硬编码一份未遮盖的简历(真手机号、
 * 真邮箱),那两个值在 masked 基线里已经是 [手机号_1] / [邮箱_1],inText() 恒判假 →
 * phone/email 被无条件置空。于是第 5 条「篡改电话应置空」与「是否篡改」完全无关:
 * 填编造号码会过,把用户本人真号原样填回去也会过 —— 断言空转。
 *
 * 所以桩改为:解析收到的 prompt,联系方式一律回抄它**实际看到的那个 token**
 * (正常情况下就是占位符),硬编码的其余事实串也逐条核对确实在它看到的文本里。
 * 这样负例被置空的唯一原因就是用例注入的那处篡改,正例才谈得上「原样保留」。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:resume-optimize
 */
import 'dotenv/config'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { randomUUID } from 'crypto'
import { Logger } from '@nestjs/common'

if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-optimize-test-secret-0123456789'
}
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['AI_PROVIDER'] = 'llm'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiService } from '../src/ai/ai.service'
import { LlmResumeProvider } from '../src/ai/providers/llm.provider'
import { LlmResumeService } from '../src/ai/resume/llm-resume.service'
import { LlmResumeGenerateService } from '../src/ai/resume/llm-resume-generate.service'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

const jw = (...parts: string[]) => parts.join('')

// 用户本人的真实联系方式:遮盖后模型见不到它们,还原后用户必须原样拿回它们
const REAL_PHONE = '13800000000'
const REAL_EMAIL = 'test@example.com'

// 受控简历原文(提取桩返回):事实串都在这里
const RESUME_TEXT = [
  `姓名 王验证  电话 ${REAL_PHONE}  邮箱 ${REAL_EMAIL}`,
  '求职意向 前端开发工程师',
  '教育经历 验证大学 计算机科学与技术 本科 2021-2025',
  '工作经历 验证科技公司 前端实习生 2024.07-2024.12 参与官网开发 维护组件库 首屏加载时间从4秒降到1.8秒',
  '技能 JavaScript React',
  '证书 英语六级',
].join('\n')

// LLM 桩
/** 遮盖占位符形态,与 pii-masker 的 placeholderFor 输出一致。 */
const PLACEHOLDER_TOKEN = /\[(?:劳动者|用人单位|身份证|手机号|银行卡|邮箱|详细地址|统一社会信用代码)_\d+\]/u

/** 注入到「模型看到的那一份」之上的编造点;不传 = 老老实实回抄。 */
type StubMutate = (o: Record<string, unknown>) => void
type StubEntry =
  /** 固定回包(诊断):不含被遮盖字段,无需按 prompt 派生 */
  | { kind: 'raw'; content: string }
  /** 优化回包:必须由桩收到的 prompt 派生 */
  | { kind: 'optimize'; mutate?: StubMutate }

const rawReply = (content: string): StubEntry => ({ kind: 'raw', content })
const optimizeReply = (mutate?: StubMutate): StubEntry => ({ kind: 'optimize', mutate })

let responseQueue: StubEntry[] = []
let llmCallCount = 0
let stubDelayMs = 0
/** 桩自身出问题(队列耗尽 / prompt 里找不到该有的东西)时记在这里,必须显性红。 */
let stubFault = ''
let lastUserPrompt = ''
const setResponses = (arr: StubEntry[]) => { responseQueue = arr.slice(); llmCallCount = 0; stubFault = '' }
const assertStubHealthy = () => { if (stubFault) fail(stubFault) }

function validDiagnosis(): string {
  return JSON.stringify({
    sections: [
      { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
      { key: 'objective', label: '求职目标清晰度', score: 6, maxScore: 10 },
      { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
      { key: 'quantification', label: '成果量化程度', score: 5, maxScore: 10 },
      { key: 'keyword', label: '岗位关键词覆盖', score: 5, maxScore: 10 },
      { key: 'readability', label: '版式与可读性', score: 7, maxScore: 10 },
    ],
    suggestions: ['经历描述建议动词开头并量化成果'],
  })
}

/**
 * 桩硬编码的事实串必须确实出现在它看到的那份文本里。
 * 将来遮盖范围一旦扩大(例如姓名也被遮),这里会立刻显性红,
 * 而不是让所有防编造负例因为「同一个字段恒判假」而集体假通过。
 */
const STUB_FACT_STRINGS = [
  '王验证', '前端开发工程师', '验证大学', '计算机科学与技术', '本科',
  '验证科技公司', '前端实习生', '英语六级', 'JavaScript', 'React',
  '参与官网开发 维护组件库',
]

/** 取桩实际看到的联系方式:遮盖正常时是占位符,遮盖被摘掉时才会命中真值分支。 */
const seenPhone = (prompt: string): string =>
  prompt.match(/\[手机号_\d+\]/u)?.[0] ?? prompt.match(/(?<!\d)1[3-9]\d{9}(?!\d)/u)?.[0] ?? ''
const seenEmail = (prompt: string): string =>
  prompt.match(/\[邮箱_\d+\]/u)?.[0] ?? prompt.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u)?.[0] ?? ''

/**
 * 模拟一个守规矩的模型:它只见过服务端送出去的那一份,所以回包必须由 prompt 派生。
 * 联系方式一律回抄它看到的 token(不自行还原),modules.after 里也刻意回抄一次手机号
 * token,用来验证服务端回程还原覆盖到对比文本。
 * 返回 null = 桩自身与服务端脱节,调用方应当让门禁红,而不是继续发一份「干净回包」。
 */
function buildOptimize(prompt: string, mut?: StubMutate): string | null {
  const phone = seenPhone(prompt)
  const email = seenEmail(prompt)
  if (!phone || !email) {
    stubFault ||= '桩无法从 prompt 中取出服务端实际送模型的联系方式(手机号/邮箱)'
    return null
  }
  for (const factStr of STUB_FACT_STRINGS) {
    if (!prompt.includes(factStr)) {
      stubFault ||= `桩回包里的事实串「${factStr}」不在它实际看到的那份文本里,桩基线已与服务端脱节`
      return null
    }
  }
  const o: Record<string, unknown> = {
    resume: {
      basic: { name: '王验证', phone, email, city: '' },
      intention: { position: '前端开发工程师', city: '' },
      summary: '具备前端开发实习经验,熟悉 React 组件化开发,注重性能优化。',
      education: [{ school: '验证大学', major: '计算机科学与技术', degree: '本科', period: '2021-2025', description: '主修计算机核心课程。' }],
      experience: [{ company: '验证科技公司', role: '前端实习生', period: '2024.07-2024.12', description: '负责官网改版前端开发与组件库维护,将首屏加载时间从4秒优化至1.8秒。' }],
      projects: [],
      skills: ['JavaScript', 'React'],
      certificates: ['英语六级'],
    },
    modules: [
      { title: '经历表达优化', before: '参与官网开发 维护组件库', after: `负责官网改版前端开发,持续维护组件库并优化首屏性能。联系方式 ${phone} 不变。` },
    ],
  }
  if (mut) mut(o)
  return JSON.stringify(o)
}

async function main(): Promise<void> {
  console.log('\n=== 阶段2B AI 简历优化真实化验证 ===')

  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const finish = () => {
      llmCallCount++
      const reject = (fault: string) => {
        stubFault ||= fault
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end('{"error":"stub"}')
      }
      // 队列耗尽说明真实调用次数超出用例预置(例如重试次数被改动)。
      // 这里必须让门禁红,不能像旧实现那样兜底回一份「干净优化结果」,把负例变成假通过。
      if (responseQueue.length === 0) return reject(`桩队列耗尽:第 ${llmCallCount} 次 LLM 调用超出用例预置`)
      const entry = responseQueue.shift() as StubEntry
      let content: string | null
      if (entry.kind === 'raw') {
        content = entry.content
      } else {
        let prompt = ''
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
            messages?: Array<{ role?: string; content?: string }>
          }
          prompt = body.messages?.find((m) => m.role === 'user')?.content ?? ''
        } catch { /* 下面按「取不到 prompt」统一处理 */ }
        lastUserPrompt = prompt
        if (!prompt) return reject('桩无法从请求体中取出 user prompt(服务端实际送模型的那一份)')
        content = buildOptimize(prompt, entry.mutate)
        if (content === null) return reject(stubFault)
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
      }
      if (stubDelayMs > 0) setTimeout(finish, stubDelayMs)
      else finish()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`

  const cfgBase = {
    vendor: 'deepseek', model: 'stub', baseURL, systemPrompt: '', roleScope: '',
    forbiddenWords: [] as string[], temperature: 0.3, enabled: true,
  }
  const onFeatures = (features: string[]) => ({
    getApiKey: (f?: string) => (features.includes(f ?? '') ? 'stub-key' : null),
    getConfig: (f?: string) => ({ ...cfgBase, enabled: features.includes(f ?? '') }),
    isReady: (f?: string) => features.includes(f ?? ''),
  })
  const bothCfg = onFeatures(['resume_diagnosis', 'resume_optimize'])
  const diagOnlyCfg = onFeatures(['resume_diagnosis'])

  const makeProvider = (cfg: unknown) =>
    new LlmResumeProvider(
      new LlmResumeService(cfg as never),
      new LlmResumeGenerateService(cfg as never),
      new LlmResumeOptimizeService(cfg as never),
    )

  // 提取桩:默认成功返回受控原文;可按 fileId 注入失败,并校验调用方 endUserId 透传。
  const extractionByFileId = new Map<string, unknown>()
  const fileOwners = new Map<string, string | null>()
  const fakeExtraction = {
    extractResumeText: async ({ fileId, endUserId }: { fileId: string; endUserId?: string | null }) => {
      const expectedOwner = fileOwners.get(fileId) ?? null
      if ((endUserId ?? null) !== expectedOwner) {
        return { ok: false, fileId, errorCode: 'FILE_NOT_FOUND', errorMessage: '文件不存在' }
      }
      return extractionByFileId.get(fileId) ?? {
        ok: true, fileId, text: RESUME_TEXT, textSource: 'docx', confidence: 'high', charCount: RESUME_TEXT.length,
      }
    },
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const files = new FilesService(prisma, audit, storage)
  const pdf = new ResumePdfService()
  const emptyStub = {} as never
  const logStub = { record: () => {} } as never

  const build = (cfg: unknown) =>
    new AiService(
      emptyStub, emptyStub, emptyStub, emptyStub, emptyStub, emptyStub,
      makeProvider(cfg) as never, // llmResumeProvider（AI_PROVIDER=llm → this.provider）
      logStub,
      emptyStub, // llmConfig
      emptyStub, // llmChat
      fakeExtraction as never, // resumeExtraction
      pdf,
      files,
      prisma,
      audit as never,
    )
  const ai = build(bothCfg)
  const aiOptimizeOff = build(diagOnlyCfg)

  const createdTaskIds: string[] = []
  const createdFileIds: string[] = []
  const createdEndUserIds: string[] = []
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
  const endUserA = `vro_member_${suffix}`

  const submitParseForOwner = async (svc: AiService, fileId: string, endUserId: string | null) => {
    fileOwners.set(fileId, endUserId)
    setResponses([rawReply(validDiagnosis())])
    const out = await svc.submitResumeParse({ fileId, fileName: 'r.docx', fileFormat: 'docx', source: 'upload' } as never, endUserId)
    createdTaskIds.push(out.taskId)
    if (out.status !== 'completed') fail(`parse 失败: ${out.failReason}`)
    return { taskId: out.taskId, accessToken: out.accessToken }
  }
  const submitParse = (svc: AiService, fileId: string) => submitParseForOwner(svc, fileId, null)

  try {
    await prisma.endUser.create({ data: { id: endUserA, phoneHash: `h_${endUserA}`, phoneEnc: `e_${endUserA}` } })
    createdEndUserIds.push(endUserA)

    // ── 1+2+6+7. 全链路 + 事实串保留 + 门禁 + 缓存 ───────────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_a_${suffix}`)
      const parseRow = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'parse' } } })
      if (!parseRow || !parseRow.payloadJson.includes(`file_opt_a_${suffix}`)) fail('1. parse 行未落 fileId(优化重提原文依赖)')
      pass('1a. 上传→提取→诊断落库,parse 行含 fileId')

      setResponses([optimizeReply()])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      assertStubHealthy()
      if (opt.status !== 'completed' || !opt.optimizedResume) fail(`1. 优化失败: ${opt.failReason}`)
      if (opt.providerName !== 'llm') fail('1. providerName 应为 llm')
      const r = opt.optimizedResume
      if (r.education[0]?.school !== '验证大学' || r.experience[0]?.company !== '验证科技公司' || r.certificates[0] !== '英语六级') {
        fail('2. 事实串与原文不一致')
      }
      if (!r.experience[0].description.includes('1.8秒')) fail('2. 原文数字未保留')
      if ((opt.modules ?? []).length < 1) fail('1. 对比模块缺失')
      pass('1b+2a. 优化完成:学校/公司/证书与原文一致,数字保留,对比模块输出')

      // ── 11/12 守 #646:去程只出占位符,回程必须换回真值。任一侧被摘掉都必须红 ──
      if (lastUserPrompt.includes(REAL_PHONE)) fail('11. 出站 prompt 泄漏简历原始手机号')
      if (lastUserPrompt.includes(REAL_EMAIL)) fail('11. 出站 prompt 泄漏简历原始邮箱')
      if (!/\[手机号_\d+\]/u.test(lastUserPrompt) || !/\[邮箱_\d+\]/u.test(lastUserPrompt)) {
        fail('11. 出站 prompt 未按可还原占位符形态遮盖联系方式')
      }
      pass('11. 去程:简历原始联系方式不出境,prompt 只含可还原占位符')

      // 正例:模型原样回抄它看到的那个 token → 必须被保留并还原成用户真值。
      // 这条与第 5 条(篡改 → 置空)成对,缺了它「置空」就分不清是防篡改还是恒置空。
      if (r.basic.phone !== REAL_PHONE) fail(`12. 未篡改的电话应原样保留并还原为真值,实际 ${r.basic.phone}`)
      if (r.basic.email !== REAL_EMAIL) fail(`12. 未篡改的邮箱应原样保留并还原为真值,实际 ${r.basic.email}`)
      // 模型自己写出来的对比文本里的占位符也必须还原,否则用户简历上会印着 [手机号_1]
      if (!(opt.modules ?? []).some((m) => m.after.includes(REAL_PHONE))) {
        fail('12. 对比模块文本中的占位符未被还原为真值')
      }
      if (PLACEHOLDER_TOKEN.test(JSON.stringify(opt))) fail('12. 产物残留遮盖占位符,用户会看到 [手机号_1] 这类文本')
      pass('12. 回程:未篡改的联系方式原样保留并还原为真值,产物无占位符残留')

      const optRow = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'optimize' } } })
      if (!optRow || optRow.accessTokenHash !== parseRow.accessTokenHash) fail('6. optimize 行未继承 parse 行 hash')
      pass('6a. optimize 行落库且继承 parse 行 accessTokenHash')

      // 缓存:再读不调 LLM
      setResponses([])
      llmCallCount = 0
      const again = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (again.status !== 'completed' || llmCallCount !== 0) fail('7. 成功结果应走缓存,不再调 LLM')
      pass('7. 成功结果缓存,再次读取不调 LLM')

      try {
        await ai.getResumeOptimize(taskId, { endUserId: null, accessToken: 'wrong-token' })
        fail('6. 错 token 应拒绝')
      } catch (e) {
        if (errCode(e) !== 'AI_TASK_NOT_FOUND') fail(`6. 期望 AI_TASK_NOT_FOUND,实际 ${errCode(e)}`)
      }
      pass('6b. 错 token → AI_TASK_NOT_FOUND')
    }

    // ── 6c. 会员优化路径必须把 parse 行 endUserId 传入提取层 ───────────────
    {
      const { taskId } = await submitParseForOwner(ai, `file_opt_member_${suffix}`, endUserA)
      setResponses([optimizeReply()])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: endUserA, accessToken: null })
      assertStubHealthy()
      if (opt.status !== 'completed') fail(`6c. 会员本人优化应成功: ${opt.failReason}`)
      try {
        await ai.getResumeOptimize(taskId, { endUserId: `${endUserA}_other`, accessToken: null })
        fail('6c. 其他会员不应读取会员优化结果')
      } catch (e) {
        if (errCode(e) !== 'AI_TASK_NOT_FOUND') fail(`6c. 期望 AI_TASK_NOT_FOUND,实际 ${errCode(e)}`)
      }
      pass('6c. 会员优化路径按 parse 行 endUserId 提取原文,他人会员被拒')
    }

    // ── 2b. 编造学校 → 重试仍坏 → 诚实失败,且失败不缓存 ───────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_b_${suffix}`)
      const fabricateSchool: StubMutate = (o) => {
        const resume = o['resume'] as Record<string, unknown>
        resume['education'] = [{ school: '编造大学', major: '', degree: '', period: '', description: '' }]
      }
      setResponses([optimizeReply(fabricateSchool), optimizeReply(fabricateSchool)])
      const bad = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      assertStubHealthy()
      if (bad.status !== 'failed') fail('2b. 编造学校应失败')
      if (llmCallCount !== 2) fail(`2b. 应重试一次(2 次调用),实际 ${llmCallCount}`)
      const cached = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'optimize' } } })
      if (cached) fail('2b. 失败结果不应缓存')
      pass('2b. LLM 编造学校 → 重试仍坏 → 诚实失败,失败不落库')

      // 失败后重试可成功(证明无失败缓存)
      setResponses([optimizeReply()])
      const retry = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      assertStubHealthy()
      if (retry.status !== 'completed') fail('2b. 失败后重试应可成功')
      pass('2c. 失败后再次请求成功(无失败缓存粘滞)')
    }

    // ── 2d. 学历/专业篡改(2B 收口补强):原文"本科"被改"硕士" → 拦截 ────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_b2_${suffix}`)
      const degreeTampered: StubMutate = (o) => {
        const resume = o['resume'] as Record<string, unknown>
        ;(resume['education'] as Record<string, unknown>[])[0]['degree'] = '硕士'
      }
      setResponses([optimizeReply(degreeTampered), optimizeReply(degreeTampered)])
      const bad = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      assertStubHealthy()
      if (bad.status !== 'failed') fail('2d. 学历篡改应被拦截')
      if (!(bad.failReason ?? '').includes('已拦截')) fail(`2d. 应返回明确拦截文案: ${bad.failReason}`)
      pass('2d. 学历篡改(本科→硕士) → 防编造拦截,返回明确拦截文案')
    }

    // ── 3. 稻草人对比 before 不在原文 → 丢弃 ─────────────────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_c_${suffix}`)
      const strawman: StubMutate = (o) => {
        o['modules'] = [
          { title: '编的对比', before: '我从没写过这句话的原文', after: '看起来提升很大' },
          { title: '真实对比', before: '参与官网开发 维护组件库', after: '负责官网前端开发与组件库维护。' },
        ]
      }
      setResponses([optimizeReply(strawman)])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      assertStubHealthy()
      if (opt.status !== 'completed') fail(`3. 优化失败: ${opt.failReason}`)
      if ((opt.modules ?? []).length !== 1 || opt.modules![0].title !== '真实对比') {
        fail(`3. 稻草人模块未被丢弃: ${JSON.stringify(opt.modules)}`)
      }
      pass('3. before 不在原文的对比模块被丢弃,真实片段保留')
    }

    // ── 4. 承诺类拦截词 → 判非法重试,第二次干净输出成功 ───────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_d_${suffix}`)
      const promising: StubMutate = (o) => {
        const resume = o['resume'] as Record<string, unknown>
        resume['summary'] = `优秀候选人,${jw('保', '录用')}没问题`
      }
      setResponses([optimizeReply(promising), optimizeReply()])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      assertStubHealthy()
      if (opt.status !== 'completed') fail(`4. 第二次干净输出应成功: ${opt.failReason}`)
      if (llmCallCount !== 2) fail(`4. 应重试一次(2 次调用),实际 ${llmCallCount}`)
      if (opt.optimizedResume!.summary.includes(jw('保', '录用'))) fail('4. 承诺词进入简历')
      pass('4. 承诺类表述 → 判非法重试,干净输出成功,简历无承诺词')
    }

    // ── 5. 联系方式被篡改(模型没见过的值) → 置空 ──────────────────────────
    // 与上面第 12 条成对:那边证明「原样回抄 → 保留并还原」,这边证明「改一个字 → 置空」。
    // 桩的联系方式来自它实际看到的 prompt,所以这里唯一的变量就是下面这处篡改。
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_e_${suffix}`)
      const TAMPERED_PHONE = '13900009999'
      const TAMPERED_EMAIL = 'tampered@example.com'
      const tampered: StubMutate = (o) => {
        const basic = (o['resume'] as Record<string, unknown>)['basic'] as Record<string, unknown>
        basic['phone'] = TAMPERED_PHONE
        basic['email'] = TAMPERED_EMAIL
      }
      setResponses([optimizeReply(tampered)])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      assertStubHealthy()
      if (opt.status !== 'completed') fail(`5. 优化失败: ${opt.failReason}`)

      // 自检:注入的必须是一处真正的编造 —— 既不是模型看到的那个 token(否则本条变成
      // 「未篡改也置空」),也不是用户本人真值(#646 之后模型根本没见过真值,把真值填回去
      // 同样会被置空,断言就退回空转形态)。少了这道自检,悄悄改注入值不会让门禁红。
      const seenPhoneToken = seenPhone(lastUserPrompt)
      const seenEmailToken = seenEmail(lastUserPrompt)
      if (TAMPERED_PHONE === seenPhoneToken || TAMPERED_PHONE === REAL_PHONE) {
        fail('5. 注入电话必须既非模型所见、也非用户真值,否则本条退化为空转')
      }
      if (TAMPERED_EMAIL === seenEmailToken || TAMPERED_EMAIL === REAL_EMAIL) {
        fail('5. 注入邮箱必须既非模型所见、也非用户真值,否则本条退化为空转')
      }

      if (opt.optimizedResume!.basic.phone) fail(`5. 篡改电话应置空,实际 ${opt.optimizedResume!.basic.phone}`)
      if (opt.optimizedResume!.basic.email) fail(`5. 篡改邮箱应置空,实际 ${opt.optimizedResume!.basic.email}`)
      pass('5. LLM 篡改电话/邮箱 → 字段置空,不输出错号简历')
    }

    // ── 8. 原文已清理 → 诚实失败,不缓存 ──────────────────────────────────
    {
      const fileId = `file_opt_f_${suffix}`
      const { taskId, accessToken } = await submitParse(ai, fileId)
      extractionByFileId.set(fileId, { ok: false, fileId, errorCode: 'FILE_NOT_FOUND', errorMessage: '文件不存在' })
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (opt.status !== 'failed' || !(opt.failReason ?? '').includes('重新上传')) {
        fail(`8. 应诚实失败并引导重新上传: ${opt.failReason}`)
      }
      const cached = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'optimize' } } })
      if (cached) fail('8. 提取失败不应缓存')
      pass('8. 原文已清理 → 诚实失败(引导重新上传),不缓存')
    }

    // ── 9. 未配置 resume_optimize → 诚实失败 ─────────────────────────────
    {
      const { taskId, accessToken } = await submitParse(aiOptimizeOff, `file_opt_g_${suffix}`)
      setResponses([])
      const opt = await aiOptimizeOff.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (opt.status !== 'failed' || !(opt.failReason ?? '').includes('尚未配置')) {
        fail(`9. 未配置应诚实失败: ${opt.failReason}`)
      }
      pass('9. 未配置 → 诚实失败(不 fallback mock)')
    }

    // ── 10. 优化版导出 PDF(真实文件链路) ─────────────────────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_h_${suffix}`)
      setResponses([optimizeReply()])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      assertStubHealthy()
      const exported = await ai.exportGeneratedResume(opt.optimizedResume!, null)
      createdFileIds.push(exported.fileId)
      const fileRow = await prisma.fileObject.findUnique({ where: { id: exported.fileId } })
      if (!fileRow || fileRow.purpose !== 'resume_upload') fail('10. FileObject 异常')
      const buf = await storage.getObject(fileRow.storageKey)
      if (!buf.subarray(0, 4).equals(Buffer.from('%PDF', 'latin1'))) fail('10. 产物不是 PDF')
      if (exported.filename.includes(REAL_PHONE)) fail('10. 文件名泄露手机号')
      pass(`10. 优化版导出真实 PDF(${exported.pageCount} 页,${Math.round(buf.length / 1024)}KB),FileObject 短 TTL,文件名无手机号`)
    }

    // ── 13. LLM 延迟 20s 时解析仍成功 ────────────────────────────────────
    {
      stubDelayMs = 20_000
      const t0 = Date.now()
      const { taskId } = await submitParse(ai, `file_opt_delay_${suffix}`)
      stubDelayMs = 0
      const waited = Date.now() - t0
      if (waited < 19_000) fail(`13. 解析未等到 20s 延迟，实际 ${waited}ms`)
      if (!taskId) fail('13. 延迟 20s 后应拿到 taskId')
      pass(`13. LLM 延迟 20s 时解析成功（${waited}ms）`)
    }

    // ── 14. 重复提交 optimize 只打一次模型 ───────────────────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_lock_${suffix}`)
      setResponses([optimizeReply()])
      stubDelayMs = 400
      const started = llmCallCount
      const [a, b] = await Promise.all([
        ai.getResumeOptimize(taskId, { endUserId: null, accessToken }),
        ai.getResumeOptimize(taskId, { endUserId: null, accessToken }),
      ])
      stubDelayMs = 0
      const calls = llmCallCount - started
      if (calls !== 1) fail(`14. 并发 optimize 应只调一次 LLM，实际 ${calls}`)
      if (a.status !== 'completed' || b.status !== 'completed') fail('14. 两次都应拿到完成结果')
      if (a.taskId !== b.taskId) fail('14. 两次应合并为同一份结果')
      pass('14. 重复提交 optimize 只扣一次（单次 LLM）')
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    for (const fid of createdFileIds) {
      const row = await prisma.fileObject.findUnique({ where: { id: fid } })
      if (row) {
        await storage.deleteObject(row.storageKey).catch(() => undefined)
        await prisma.fileObject.delete({ where: { id: fid } }).catch(() => undefined)
      }
    }
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: createdTaskIds } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: createdEndUserIds } } }).catch(() => undefined)
    server.close()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})
