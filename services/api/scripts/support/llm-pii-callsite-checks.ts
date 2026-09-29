/**
 * 送模型前遮盖 —— 按调用点断言（verify-llm-input-pii-mask 的运行时部分）。
 *
 * 为什么单独一个文件：主门禁 verify-llm-input-pii-mask.ts 是同步的纯函数 / 静态检查，
 * 已 400+ 行；这里要起本机假模型服务、真跑三个服务类，逻辑独立且是异步的，
 * 塞进主文件会把它推过 500 行评估线。主门禁在末尾 await 本文件导出的函数并合并计数。
 *
 * 判据只有一条：**真正发出去的请求体**里没有原文。不看代码里有没有写遮盖调用 ——
 * 那种检查在「写了调用但喂的还是原文」时照样是绿的。
 *
 * 覆盖三个调用点：
 *   1. 模拟面试：建会话时摘要落库前就遮盖；出题、报告两次送模型都遮盖；
 *      报告里「你的回答」来自库里本人原话，不来自模型。
 *   2. 小青文字对话：本轮与历史都遮高置信项；姓名不遮；会话里存的仍是原话。
 *   3. 简历生成：自由文本可还原遮盖；产物里是真值不是占位符；模型编造的占位符不进简历。
 *
 * 全部为构造数据，不是真实个人信息。不触网（只连 127.0.0.1 上的假模型），不碰真实库。
 */
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { MockInterviewLlmService } from '../../src/mock-interview/mock-interview-llm.service'
import { MockInterviewService } from '../../src/mock-interview/mock-interview.service'
import { LlmChatService } from '../../src/ai/llm/llm-chat.service'
import { LlmResumeGenerateService } from '../../src/ai/resume/llm-resume-generate.service'
import type { ResumeGenerateInput } from '../../src/ai/interfaces/ai-provider.interface'
import { maskUserTextForLlmText } from '../../src/common/pii/llm-input-mask'

export interface CallsiteCheckResult { pass: number; fail: number }

const PII = {
  phone: '13800138000',
  idNumber: '11010119900307461X',
  email: 'zhangsan.demo@example.com',
} as const
/** 与号码类不同，姓名只在「姓名：」标签后才会被识别；小青对话要求它**不被**遮。 */
const NAME = '张三'
/** 未带标签的称呼：任何模式都不该遮它。 */
const PLAIN_NAME = '李四'

const PLACEHOLDER = /\[(?:劳动者|用人单位|身份证|手机号|银行卡|邮箱|详细地址|统一社会信用代码)_\d+\]/u

type ReplyFn = (body: string) => string

export async function runLlmPiiCallsiteChecks(): Promise<CallsiteCheckResult> {
  let pass = 0
  let fail = 0
  const ok = (cond: boolean, label: string): void => {
    if (cond) { pass += 1; console.log(`  PASS ${label}`) } else { fail += 1; console.error(`  FAIL ${label}`) }
  }
  const leaked = (body: string): string[] => Object.entries(PII).filter(([, raw]) => body.includes(raw)).map(([k]) => k)

  const bodies: string[] = []
  let replyFn: ReplyFn = () => ''
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      bodies.push(raw)
      // 取出真正发给模型的 user 消息，供回包复读（模拟模型把占位符抄回来的真实形态）
      let userText = ''
      try {
        const parsed = JSON.parse(raw) as { messages?: Array<{ role: string; content: string }> }
        userText = (parsed.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content).join('\n')
      } catch { /* 非 JSON 就留空 */ }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: replyFn(userText) } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const cfg = { vendor: 'deepseek', model: 'stub', baseURL, systemPrompt: '', roleScope: '', forbiddenWords: [] as string[], temperature: 0.3, enabled: true }
  const config = { getApiKey: () => 'stub-key', getConfig: () => ({ ...cfg }), isReady: () => true }
  const lastBody = (): string => bodies[bodies.length - 1] ?? ''

  try {
    await mockInterviewChecks(config, bodies, (fn) => { replyFn = fn }, lastBody, ok, leaked)
    await assistantChatChecks(config, (fn) => { replyFn = fn }, lastBody, ok, leaked)
    await resumeGenerateChecks(config, (fn) => { replyFn = fn }, lastBody, ok, leaked)
  } catch (error) {
    ok(false, `调用点: 运行时检查异常 ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    server.close()
  }
  return { pass, fail }
}

type Ok = (cond: boolean, label: string) => void
type Leaked = (body: string) => string[]
type SetReply = (fn: ReplyFn) => void

// ─── 1. 模拟面试 ─────────────────────────────────────────────────────────────

const ANSWER = `我负责订单结算服务，有问题可以打我电话 ${PII.phone} 或发邮件 ${PII.email}`
const RESUME_TEXT = [
  `姓名：${NAME}`, `手机号：${PII.phone}`, `电子邮箱：${PII.email}`, `身份证号：${PII.idNumber}`,
  '工作经历', '2022.07-2024.03  某科技有限公司  后端开发工程师', '负责订单结算服务的重构。',
].join('\n')

const VALID_REPORT = JSON.stringify({
  overall: { level: 'pass', summary: '表达基本清楚，可以再多讲结果。' },
  expression: ['回答结构清楚'], positionFit: ['提到了订单结算'], credibility: ['经历有细节'],
  professional: ['讲清了重构目标'], adaptability: ['能接住追问'], risks: ['补充量化结果'],
  predictedQuestions: [{ question: '重构带来了什么变化？', why: '考察结果', approach: '先讲数字' }],
  starAdvice: { s: '说背景', t: '说任务', a: '说行动', r: '说结果', reminder: '带上数字' },
  checklist: ['准备自我介绍', '准备代表性经历', '准备反问问题'],
})

async function mockInterviewChecks(
  config: object, bodies: string[], setReply: SetReply, lastBody: () => string, ok: Ok, leaked: Leaked,
): Promise<void> {
  const llm = new MockInterviewLlmService(config as never)
  const created: Array<Record<string, unknown>> = []
  const turnCreates: Array<Record<string, unknown>> = []
  const sessionRow = {
    id: 'sess-1', endUserId: 'user-1', accessTokenHash: null, interviewerType: 'hr', industry: 'IT',
    position: '后端开发', experience: 'y1_3', difficulty: 'standard', durationMin: 5, questionTarget: 5,
    resumeFileId: 'file-1',
    // 存量会话：改造前建的，库里仍是摘要原文。送模型时也必须遮住。
    resumeDigest: RESUME_TEXT,
    interactionMode: 'text', status: 'in_progress', startedAt: new Date(), endedAt: null,
    createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
  }
  const turns: Array<Record<string, unknown>> = [
    { idx: 0, role: 'interviewer', qType: 'intro', content: '请先做个自我介绍。', skipped: false, inputMode: 'text', answerDurationSec: null },
  ]
  const prisma = {
    mockInterviewSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { ...sessionRow, ...data, id: 'sess-new' } },
      findUnique: async () => ({ ...sessionRow }),
      updateMany: async () => ({ count: 1 }),
    },
    mockInterviewTurn: {
      findMany: async () => turns.map((t) => ({ ...t })),
      create: async ({ data }: { data: Record<string, unknown> }) => { turnCreates.push(data); turns.push({ skipped: false, ...data }); return data },
    },
    mockInterviewReport: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    $transaction: async (fn: unknown) => (typeof fn === 'function' ? (fn as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(fn as unknown[])),
  }
  const service = new MockInterviewService(
    prisma as never, llm, {} as never, {} as never, {} as never,
    { extractResumeText: async () => ({ ok: true, text: RESUME_TEXT }) } as never,
    { write: async () => undefined } as never,
    { record: () => undefined } as never,
  )

  // 1a. 建会话：摘要落库前就遮盖
  await service.createSession(
    { interviewerType: 'hr', industry: 'IT', position: '后端开发', experience: 'y1_3', difficulty: 'standard', durationMin: 5, resumeFileId: 'file-1' },
    { endUserId: 'user-1', accessToken: null },
  )
  const storedDigest = String(created[0]?.['resumeDigest'] ?? '')
  ok(storedDigest.includes('订单结算服务'), '模拟面试: 落库摘要仍保留非敏感正文（阳性对照，证明摘要确实生成了）')
  ok(leaked(storedDigest).length === 0, `模拟面试: 落库摘要不含手机/证件/邮箱原文（残留: ${leaked(storedDigest).join(',') || '无'}）`)
  ok(!storedDigest.includes(NAME), '模拟面试: 落库摘要不含「姓名：」后的姓名原文')

  // 1b. 作答 → 出下一题：送模型的请求体遮盖，库里存的是本人原话
  setReply(() => JSON.stringify({ question: '订单结算重构里你最难的一步是什么？', qType: 'experience' }))
  const before = bodies.length
  await service.answer('sess-1', { answer: ANSWER }, { endUserId: 'user-1', accessToken: null })
  ok(bodies.length === before + 1, '模拟面试: 作答后确实向模型发了一次出题请求')
  const questionBody = lastBody()
  ok(questionBody.includes('订单结算服务'), '模拟面试: 出题请求带着本人作答正文（阳性对照）')
  ok(leaked(questionBody).length === 0, `模拟面试: 出题请求体不含作答/摘要里的原文 PII（残留: ${leaked(questionBody).join(',') || '无'}）`)
  ok(!questionBody.includes(NAME), '模拟面试: 出题请求体不含存量摘要里的姓名原文')
  const storedAnswer = turnCreates.find((t) => t['role'] === 'candidate')
  ok(storedAnswer?.['content'] === ANSWER, '模拟面试: 库里存的是本人原话（遮盖只作用于送模型的那份）')

  // 1c. 生成报告：送模型遮盖；报告里「你的回答」取自库里原话
  setReply(() => VALID_REPORT)
  const report = await service.end('sess-1', { endUserId: 'user-1', accessToken: null }) as {
    qaExcerpts?: Array<{ answerExcerpt: string | null }>
  }
  const reportBody = lastBody()
  ok(reportBody.includes('订单结算服务'), '模拟面试: 报告请求带着完整对话（阳性对照）')
  ok(leaked(reportBody).length === 0, `模拟面试: 报告请求体不含原文 PII（残留: ${leaked(reportBody).join(',') || '无'}）`)
  const excerpt = report.qaExcerpts?.find((q) => q.answerExcerpt)?.answerExcerpt ?? ''
  ok(excerpt.includes(PII.phone), '模拟面试: 报告里展示的「你的回答」是库里本人原话，不是遮盖后的送模型文本')
}

// ─── 2. 小青文字对话 ─────────────────────────────────────────────────────────

async function assistantChatChecks(
  config: object, setReply: SetReply, lastBody: () => string, ok: Ok, leaked: Leaked,
): Promise<void> {
  const chat = new LlmChatService(config as never)
  setReply(() => '好的，我记下了。')
  // 「姓名：张三。」这种写法默认档（简历链）一定会遮；用它才测得出「小青档没遮姓名」。
  // 写成「姓名：张三，大家…」默认档也不遮，断言就分不出两档，变异不会红。
  const first = `姓名：${NAME}。大家都叫我${PLAIN_NAME}。手机 ${PII.phone}，邮箱 ${PII.email}，身份证号：${PII.idNumber}`
  ok(!maskUserTextForLlmText(first, 'verify-chat-control').includes(NAME),
    '小青: 对照 —— 同一句话在默认档（遮姓名）下姓名会被遮，下面「姓名不遮」的断言才有区分力')
  const turn1 = await chat.chat({ message: first }, undefined, 'owner-a')
  const body1 = lastBody()
  ok(leaked(body1).length === 0, `小青: 本轮请求体不含手机/证件/邮箱原文（残留: ${leaked(body1).join(',') || '无'}）`)
  ok(body1.includes(NAME) && body1.includes(PLAIN_NAME), '小青: 姓名不遮（带标签的和不带标签的称呼都原样送出）')

  await chat.chat({ message: '那我下一步该准备什么？', sessionId: turn1.sessionId }, undefined, 'owner-a')
  const body2 = lastBody()
  ok(body2.includes('那我下一步该准备什么'), '小青: 第二轮请求带着本轮原话（阳性对照）')
  ok(body2.includes(NAME), '小青: 第二轮请求带着历史（历史里的称呼仍在）')
  ok(leaked(body2).length === 0, `小青: 第二轮请求体里的历史也已遮盖（残留: ${leaked(body2).join(',') || '无'}）`)

  const transcript = chat.getOwnedTranscript(turn1.sessionId, 'owner-a') ?? []
  ok(transcript[0]?.content === first, '小青: 会话里存的是本人原话（本人读回要点时看到的不是占位符）')
}

// ─── 3. 简历生成 ─────────────────────────────────────────────────────────────

const GEN_INPUT: ResumeGenerateInput = {
  basic: { name: '王小明', phone: '13900001111', email: 'wxm.demo@example.com', city: '青岛' },
  intention: { position: '客服主管' },
  education: [{ school: '验证大学', major: '市场营销', description: `学生会外联，对接电话 ${PII.phone}` }],
  experience: [{ company: '验证科技公司', role: '客服专员', description: `负责售后热线 ${PII.phone}，工单邮箱 ${PII.email}` }],
  projects: [{ name: '客服知识库', description: '整理 200 条常见问题' }],
  skills: ['沟通'],
  certificates: [],
  selfIntro: `身份证号：${PII.idNumber}，做事细致。`,
}

async function resumeGenerateChecks(
  config: object, setReply: SetReply, lastBody: () => string, ok: Ok, leaked: Leaked,
): Promise<void> {
  const gen = new LlmResumeGenerateService(config as never)
  // 模型把它看到的占位符原样抄回润色文本 —— 这是占位符进入产物的真实形态
  const tokensIn = (text: string): string[] => text.match(new RegExp(PLACEHOLDER.source, 'gu')) ?? []
  setReply((userText) => {
    const tokens = tokensIn(userText)
    const phoneToken = tokens.find((t) => t.startsWith('[手机号_')) ?? '[手机号_1]'
    const emailToken = tokens.find((t) => t.startsWith('[邮箱_')) ?? '[邮箱_1]'
    const idToken = tokens.find((t) => t.startsWith('[身份证_')) ?? '[身份证_1]'
    return JSON.stringify({
      summary: `做事细致，证件 ${idToken}。`,
      educationDesc: [`负责学生会外联（${phoneToken}）。`],
      experienceDesc: [`负责售后热线 ${phoneToken} 与工单邮箱 ${emailToken} 的日常处理。`],
      projectDesc: ['整理 200 条常见问题，沉淀为客服知识库。'],
      skillsPolished: ['沟通'],
    })
  })
  const resume = await gen.generate(GEN_INPUT)
  const body = lastBody()
  ok(body.includes('售后热线'), '简历生成: 请求带着经历描述（阳性对照）')
  ok(leaked(body).length === 0, `简历生成: 请求体不含自由文本里的原文 PII（残留: ${leaked(body).join(',') || '无'}）`)
  ok(!body.includes('王小明') && !body.includes('13900001111') && !body.includes('wxm.demo@example.com'),
    '简历生成: 身份字段（姓名/电话/邮箱）不进请求体')
  const productText = JSON.stringify(resume)
  ok(resume.experience[0]?.description.includes(PII.phone) === true && resume.experience[0]?.description.includes(PII.email) === true,
    '简历生成: 产物里是真值（占位符已还原成用户写的号码和邮箱）')
  ok(resume.summary.includes(PII.idNumber), '简历生成: 个人简介里的占位符也已还原')
  ok(!PLACEHOLDER.test(productText), '简历生成: 产物任何字段都不含占位符')

  // 模型编造了一个不存在的编号：不能印到简历上，回退用户原文
  setReply(() => JSON.stringify({
    summary: '做事细致。',
    educationDesc: ['负责学生会外联。'],
    experienceDesc: ['负责售后热线 [手机号_99] 的日常处理。'],
    projectDesc: ['整理 200 条常见问题。'],
    skillsPolished: ['沟通'],
  }))
  const fabricated = await gen.generate(GEN_INPUT)
  ok(fabricated.experience[0]?.description === GEN_INPUT.experience[0]!.description,
    '简历生成: 模型编造的占位符不进简历，该条回退用户原文')
  ok(!PLACEHOLDER.test(JSON.stringify(fabricated)), '简历生成: 编造占位符场景下产物仍不含占位符')
}
