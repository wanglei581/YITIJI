/**
 * 模拟面试到点硬截止 — 离线回归（本机假模型，不触网）。
 *
 * 时间流逝只改库里的 deadlineAt，不 sleep。
 * 挂起假模型时的 3 秒上限只用来发现「请求没到假模型」的卡死，不拿来消耗面试时间。
 *
 * 运行：接在 verify:mock-interview 后面（同一条 npm 脚本）。
 */
process.env['OCR_PROVIDER'] = process.env['OCR_PROVIDER'] ?? 'disabled'
require('dotenv').config()

import { createServer, type Server } from 'http'
import { writeSync } from 'fs'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { BadRequestException, Logger, Module, ValidationPipe, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { APP_GUARD } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { RedisService } from '../src/common/redis/redis.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { AiAccessGuard } from '../src/ai-access/ai-access.guard'
import { AiAccessService } from '../src/ai-access/ai-access.service'
import { MockInterviewLlmService } from '../src/mock-interview/mock-interview-llm.service'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { MockInterviewController } from '../src/mock-interview/mock-interview.controller'
import { AsrService } from '../src/mock-interview/asr/asr.service'
import { TtsService } from '../src/mock-interview/asr/tts.service'
import { InterviewTranscriptPrintService } from '../src/mock-interview/interview-transcript-print.service'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import {
  INTERVIEW_ANSWER_GRACE_MS,
  INTERVIEW_DEADLINE_REACHED_CODE,
  INTERVIEW_DEADLINE_REACHED_MESSAGE,
  interviewDeadlineFields,
  isPastDeadline,
} from '../src/mock-interview/mock-interview-deadline'

/** 约定原文拆开写，避免本脚本自己变成第二处字面量。 */
const EXPECTED_MESSAGE = '本场练习时间已到。' + '已提交的回答都在，可以生成报告。'
const EXPECTED_CODE = 'INTERVIEW_DEADLINE_' + 'REACHED'
const DEFAULT_QUESTION = '请做一个简短的自我介绍'
const DEFAULT_Q = JSON.stringify({ question: DEFAULT_QUESTION, qType: 'intro' })
const BASE = {
  interviewerType: 'tech',
  industry: '互联网',
  position: '前端工程师',
  experience: 'y1_3',
  difficulty: 'standard',
} as const

let passCount = 0
function pass(msg: string): void { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }
function check(cond: boolean, msg: string): void { if (!cond) fail(msg); pass(msg) }

class SilentLogger {
  log(): void { /* 验证输出只留 PASS/FAIL */ }
  error(): void { /* 预期中的 503 也会走这里，不刷屏 */ }
  warn(): void { /* 同上 */ }
  debug(): void { /* 同上 */ }
  verbose(): void { /* 同上 */ }
}
Logger.overrideLogger(new SilentLogger())

interface LlmHold { markArrived: () => void; gate: Promise<void> }
interface LlmJob { status: number; content: string; hold: LlmHold | null }
const llmQueue: LlmJob[] = []
const llmBodies: string[] = []
let llmRequests = 0

function enqueue(status: number, content: string): void {
  llmQueue.push({ status, content, hold: null })
}

function enqueueHold(status: number, content: string): { arrived: Promise<void>; release: () => void } {
  let markArrived: () => void = () => undefined
  let open: () => void = () => undefined
  let released = false
  const arrived = new Promise<void>((resolve) => { markArrived = resolve })
  const gate = new Promise<void>((resolve) => { open = resolve })
  const release = () => { if (!released) { released = true; open() } }
  llmQueue.push({ status, content, hold: { markArrived, gate } })
  return { arrived, release }
}

function startStub(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
      req.on('end', () => {
        llmRequests += 1
        llmBodies.push(Buffer.concat(chunks).toString('utf8'))
        const job = llmQueue.shift() ?? { status: 200, content: DEFAULT_Q, hold: null }
        const send = () => {
          if (res.writableEnded) return
          if (job.status !== 200) {
            res.writeHead(job.status, { 'Content-Type': 'text/plain' })
            res.end('upstream')
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: job.content } }] }))
        }
        if (job.hold) {
          job.hold.markArrived()
          job.hold.gate.then(send, send)
        } else {
          send()
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({ server, url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` })
    })
  })
}

const REPORT_JSON = JSON.stringify({
  overall: { level: 'good', summary: '回答结构清晰。' },
  expression: ['有结构'],
  positionFit: ['与岗位相关'],
  credibility: ['细节具体'],
  professional: ['理解扎实'],
  adaptability: ['追问稳定'],
  risks: ['量化不足'],
  predictedQuestions: [{ question: '说说规划', why: '看稳定性', approach: '谈一年目标' }],
  starAdvice: { s: '先讲背景', t: '说明目标', a: '突出行动', r: '给出结果', reminder: '尽量给数字' },
  checklist: ['准备介绍', '准备经历', '准备反问'],
})

type Auth = { kind: 'none' } | { kind: 'anon'; token: string } | { kind: 'member'; token: string }
const NONE: Auth = { kind: 'none' }

function authHeaders(auth: Auth): Record<string, string> {
  if (auth.kind === 'anon') return { 'x-interview-access-token': auth.token }
  if (auth.kind === 'member') return { authorization: `Bearer ${auth.token}` }
  return {}
}

interface HttpResult { status: number; body: Record<string, unknown> | null; text: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

let baseUrl = ''
const answerSuccesses: Array<Record<string, unknown>> = []

async function api(method: string, path: string, auth: Auth, json?: unknown): Promise<HttpResult> {
  const headers = authHeaders(auth)
  let body: string | undefined
  if (json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(json)
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body })
  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try { parsed = JSON.parse(text) } catch { parsed = null }
  }
  const root = asRecord(parsed)
  if (method === 'POST' && path.endsWith('/answer') && (res.status === 200 || res.status === 201) && root?.['success'] === true) {
    const data = asRecord(root['data'])
    if (data) answerSuccesses.push(data)
  }
  return { status: res.status, body: root, text }
}

async function transcribe(id: string, auth: Auth): Promise<HttpResult> {
  const form = new FormData()
  form.append('audio', new Blob([Buffer.from('RIFFstub-deadline')], { type: 'audio/wav' }), 'a.wav')
  const res = await fetch(`${baseUrl}/mock-interviews/${id}/transcribe`, {
    method: 'POST',
    headers: authHeaders(auth),
    body: form,
  })
  const text = await res.text()
  let parsed: unknown = null
  try { parsed = JSON.parse(text) } catch { parsed = null }
  return { status: res.status, body: asRecord(parsed), text }
}

function dataOf(res: HttpResult, label: string): Record<string, unknown> {
  if (res.status !== 200 && res.status !== 201) fail(`${label} HTTP ${res.status} ${res.text.slice(0, 300)}`)
  if (res.body?.['success'] !== true) fail(`${label} success 不是 true：${res.text.slice(0, 300)}`)
  const data = asRecord(res.body?.['data'])
  if (!data) fail(`${label} 没有 data：${res.text.slice(0, 300)}`)
  return data
}

function errorOf(res: HttpResult): { code: string; message: string } {
  const err = asRecord(res.body?.['error'])
  return {
    code: typeof err?.['code'] === 'string' ? err['code'] : '',
    message: typeof err?.['message'] === 'string' ? err['message'] : '',
  }
}

function assert409(res: HttpResult, label: string): void {
  const err = errorOf(res)
  check(res.status === 409 && res.body?.['success'] === false && err.code === EXPECTED_CODE && err.message === EXPECTED_MESSAGE,
    `${label} 到点是 409，code 与那句话逐字相同（实际 ${res.status} ${err.code} ${err.message}）`)
}

function assert404(res: HttpResult, label: string): void {
  const err = errorOf(res)
  check(res.status === 404 && err.code === 'INTERVIEW_NOT_FOUND' && !res.text.includes('deadlineAt') && !res.text.includes(EXPECTED_MESSAGE),
    `${label} 越权仍是 404，响应里没有截止时刻（实际 ${res.status} ${err.code}）`)
}

function assertIsoNow(value: unknown, label: string): void {
  check(typeof value === 'string' && new Date(value).toISOString() === value && Math.abs(Date.parse(value) - Date.now()) < 120_000,
    `${label} serverNow 是服务器当前的 ISO 时间（实际 ${String(value)}）`)
}

function keysOf(data: Record<string, unknown>): string {
  return Object.keys(data).sort().join(',')
}

function countQuoted(text: string, literal: string): number {
  let n = 0
  for (const q of ["'", '"', '`']) {
    const needle = q + literal + q
    let from = 0
    while (from <= text.length) {
      const at = text.indexOf(needle, from)
      if (at < 0) break
      n += 1
      from = at + needle.length
    }
  }
  return n
}

function scanLiterals(): void {
  const root = join(__dirname, '..', '..', '..')
  const skip = new Set(['node_modules', '.git', 'dist', '.tmp', 'coverage', '.turbo', '.next'])
  const hits: Array<{ file: string; message: number; code: number }> = []
  const scanned: string[] = []
  const walk = (dir: string): void => {
    const names = readdirSync(dir)
    for (const name of names) {
      if (skip.has(name)) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx|js|mjs|cjs|sql|prisma|md|json)$/.test(name)) continue
      const text = readFileSync(full, 'utf8')
      scanned.push(full)
      const message = countQuoted(text, EXPECTED_MESSAGE)
      const code = countQuoted(text, EXPECTED_CODE)
      if (message || code) hits.push({ file: full, message, code })
    }
  }
  walk(root)
  const deadlineFile = join('mock-interview', 'mock-interview-deadline.ts')
  check(scanned.length > 200, `文案扫描读到的文件数大于 200（实际 ${scanned.length}）`)
  check(scanned.some((file) => file.endsWith(deadlineFile)), '新文件 mock-interview-deadline.ts 在被扫描到的文件里')
  const only = hits.length === 1 ? hits[0] : undefined
  check(!!only && only.file.endsWith(deadlineFile) && only.message === 1 && only.code === 1,
    `409 的话和 code 只在新文件里各出现一处（实际 ${hits.map((h) => `${h.file}#m${h.message}c${h.code}`).join(' | ') || '零处'}）`)
}

async function untilArrived(arrived: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      arrived,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}：假模型没有收到请求`)), 3000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 先等假模型接到请求，再改库，再放行回包。失败也放行，避免请求挂死；失败仍然抛出。 */
async function withHold<T>(hold: { arrived: Promise<void>; release: () => void }, during: () => Promise<void>, request: Promise<T>, label: string): Promise<T> {
  let failed: unknown
  try {
    await untilArrived(hold.arrived, label)
    await during()
  } catch (error) {
    failed = error
  } finally {
    hold.release()
  }
  const result = await request
  if (failed) throw failed
  return result
}

async function main(): Promise<void> {
  const secret = process.env['JWT_SECRET']
  if (!secret || secret.length < 16) fail('JWT_SECRET 未配置或长度不足 16')
  if (!process.env['DATABASE_URL']) fail('DATABASE_URL 未配置')

  const at = new Date('2026-10-10T08:00:00.000Z')
  check(INTERVIEW_ANSWER_GRACE_MS === 3000, '回答宽限是 3000 毫秒')
  check(INTERVIEW_DEADLINE_REACHED_CODE === EXPECTED_CODE && INTERVIEW_DEADLINE_REACHED_MESSAGE === EXPECTED_MESSAGE,
    '错误码和那句话与约定逐字相同')
  check(!isPastDeadline(null, at, 3000) && !isPastDeadline(at, new Date(at.getTime() + 2999), 3000) && isPastDeadline(at, new Date(at.getTime() + 3000), 3000),
    '宽限内不过点，满 3 秒才过点')
  check(isPastDeadline(at, at, 0) && !isPastDeadline(at, new Date(at.getTime() - 1), 0),
    '不带宽限时，到点本身算过点，到点前一毫秒不算')
  const openFields = interviewDeadlineFields(null, at)
  const shutFields = interviewDeadlineFields(at, at)
  check(openFields.deadlineAt === null && openFields.timeUp === false && openFields.serverNow === at.toISOString()
    && shutFields.deadlineAt === at.toISOString() && shutFields.timeUp === true,
    '三个字段：没有截止时刻则 timeUp 为 false；到点则为 true')
  scanLiterals()

  const { server, url } = await startStub()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const aiLog = new AiLogService(prisma)
  const redisStore = new Map<string, string>()
  const redis = {
    get: async (key: string) => redisStore.get(key) ?? null,
    set: async (key: string, value: string) => { redisStore.set(key, value) },
    setEx: async (key: string, _ttl: number, value: string) => { redisStore.set(key, value) },
    del: async (key: string) => redisStore.delete(key) ? 1 : 0,
    setNxPx: async (key: string, value: string) => {
      if (redisStore.has(key)) return false
      redisStore.set(key, value)
      return true
    },
    getAndDelIfEquals: async (key: string, expected: string) => {
      if (!redisStore.has(key)) return 'missing'
      if (redisStore.get(key) !== expected) return 'mismatched'
      redisStore.delete(key)
      return 'matched'
    },
  }
  const jwt = new JwtService({ secret })
  const llm = new MockInterviewLlmService({
    getApiKey: () => 'stub-key',
    getConfig: () => ({
      vendor: 'deepseek', model: 'stub-model', baseURL: url, systemPrompt: '', roleScope: '',
      forbiddenWords: [], temperature: 0, enabled: true, apiKeyEncrypted: 'x',
    }),
  } as never)
  const svc = new MockInterviewService(prisma, llm, {} as never, {} as never, {} as never, {} as never, audit, aiLog, redis as never)
  const access = new AiAccessService(redis as never, audit, jwt, prisma)
  let asrCalls = 0
  let ttsCalls = 0
  const asr = {
    activeProviderName: 'stub-asr',
    recognizeWav: async () => { asrCalls += 1; return { ok: true, text: '转写对照句' } },
  }
  const tts = { synthesize: async () => { ttsCalls += 1; return { ok: true, audio: 'QQ==' } } }

  @Module({
    controllers: [MockInterviewController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      { provide: JwtService, useValue: jwt },
      { provide: AuditService, useValue: audit },
      { provide: AiLogService, useValue: aiLog },
      { provide: MockInterviewService, useValue: svc },
      { provide: AsrService, useValue: asr },
      { provide: TtsService, useValue: tts },
      { provide: InterviewTranscriptPrintService, useValue: {} },
      { provide: AiAccessService, useValue: access },
      AiAccessGuard,
      { provide: APP_GUARD, useExisting: AiAccessGuard },
    ],
  })
  class DeadlineHttpModule {}

  const app: INestApplication = await NestFactory.create(DeadlineHttpModule, { abortOnError: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  if (!address || typeof address === 'string') fail('无法取得监听地址')
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`
  const suffix = Date.now().toString(36)
  const userA = `ivd_a_${suffix}`
  const userB = `ivd_b_${suffix}`
  const sessionIds: string[] = []
  const scriptStarted = new Date()

  const sign = (userId: string): Auth => {
    const jti = randomUUID()
    redisStore.set(memberSessionKey(jti), userId)
    return { kind: 'member', token: jwt.sign({ sub: userId }, { jwtid: jti, audience: 'enduser', expiresIn: '2h' }) }
  }

  const setFlags = async (paused: boolean): Promise<void> => {
    redisStore.set('system:ai-access:loginGate', 'off')
    redisStore.set('system:ai-access:declarationEnforced', 'off')
    redisStore.set('system:ai-access:paused', paused ? 'on' : 'off')
    redisStore.set('system:ai-access:maintenance', 'off')
    access.clearCache()
  }

  const setDeadline = (id: string, msFromNow: number) => prisma.mockInterviewSession.update({
    where: { id },
    data: { deadlineAt: new Date(Date.now() + msFromNow) },
  })

  const loadTurns = (id: string) => prisma.mockInterviewTurn.findMany({ where: { sessionId: id }, orderBy: { idx: 'asc' } })

  const failedQuestionLogs = () => prisma.aiServiceLog.count({
    where: { operation: 'interviewQuestion', status: 'failed', createdAt: { gte: scriptStarted } },
  })

  async function create(auth: Auth, durationMin: number): Promise<{ id: string; auth: Auth; questionTarget: number }> {
    const res = await api('POST', '/mock-interviews', auth, { ...BASE, durationMin })
    const data = dataOf(res, `创建 ${durationMin} 分钟`)
    const id = String(data['sessionId'] ?? '')
    if (!id) fail('创建没有 sessionId')
    sessionIds.push(id)
    if (auth.kind === 'member') {
      check(keysOf(data) === 'questionTarget,sessionId' && data['accessToken'] === undefined,
        `会员创建只回会话号和题量（实际 ${keysOf(data)}）`)
      return { id, auth, questionTarget: Number(data['questionTarget']) }
    }
    const token = typeof data['accessToken'] === 'string' ? data['accessToken'] : ''
    check(keysOf(data) === 'accessToken,questionTarget,sessionId' && token.length > 0,
      `匿名创建多回一次令牌，没有别的新字段（实际 ${keysOf(data)}）`)
    return { id, auth: { kind: 'anon', token }, questionTarget: Number(data['questionTarget']) }
  }

  async function start(id: string, auth: Auth, json?: unknown): Promise<HttpResult> {
    if (json === undefined) return api('POST', `/mock-interviews/${id}/start`, auth)
    return api('POST', `/mock-interviews/${id}/start`, auth, json)
  }

  try {
    await setFlags(false)
    await prisma.endUser.createMany({
      data: [userA, userB].map((id) => ({ id, phoneHash: `hash_${id}`, phoneEnc: `enc_${id}` })),
    })
    const memberA = sign(userA)
    const memberB = sign(userB)

    // ── 不带标记：三种请求体，行为和多出来的三个字段 ─────────────────────────
    const unflaggedBodies: Array<{ label: string; json?: unknown }> = [
      { label: '没有请求体' },
      { label: '空对象', json: {} },
      { label: 'hardDeadline 为 false', json: { hardDeadline: false } },
    ]
    const unflaggedStarts: Record<string, unknown>[] = []
    const unflaggedOpen: Array<{ id: string; auth: Auth; label: string }> = []
    let openId = ''
    let openAuth: Auth = NONE
    for (const item of unflaggedBodies) {
      const created = await create(NONE, 5)
      const before = llmRequests
      const res = await start(created.id, created.auth, item.json)
      const data = dataOf(res, `不带标记开始（${item.label}）`)
      check(llmRequests === before + 1, `不带标记开始（${item.label}）会去问模型（对照：请求数 +1）`)
      check(data['deadlineAt'] === null && data['timeUp'] === false, `不带标记（${item.label}）deadlineAt 为 null、timeUp 为 false`)
      assertIsoNow(data['serverNow'], `不带标记（${item.label}）`)
      check(data['done'] === false && data['question'] === DEFAULT_QUESTION && data['qType'] === 'intro'
        && data['questionIndex'] === 1 && data['questionTarget'] === 6
        && keysOf(data) === 'deadlineAt,done,qType,question,questionIndex,questionTarget,serverNow,timeUp',
        `不带标记开始（${item.label}）原有字段与改动前一致，只多三个字段`)
      const row = await prisma.mockInterviewSession.findUnique({ where: { id: created.id } })
      check(row?.deadlineAt === null && row?.status === 'in_progress', `不带标记（${item.label}）库里截止时刻为空`)
      unflaggedStarts.push(data)
      unflaggedOpen.push({ id: created.id, auth: created.auth, label: item.label })
      openId = created.id
      openAuth = created.auth
    }
    check(unflaggedStarts.every((row) => row['question'] === unflaggedStarts[0]?.['question']
      && row['qType'] === unflaggedStarts[0]?.['qType']
      && row['done'] === unflaggedStarts[0]?.['done']
      && row['questionIndex'] === unflaggedStarts[0]?.['questionIndex']
      && row['questionTarget'] === unflaggedStarts[0]?.['questionTarget']
      && row['deadlineAt'] === null && row['timeUp'] === false),
      '三种不带标记的开始，原有字段彼此相同')

    for (const item of unflaggedOpen.slice(0, -1)) {
      enqueue(200, JSON.stringify({ question: `${item.label}的下一题`, qType: 'experience' }))
      const answered = dataOf(await api('POST', `/mock-interviews/${item.id}/answer`, item.auth, { answer: `${item.label}的回答` }), `不带标记回答（${item.label}）`)
      check(answered['done'] === false && answered['question'] === `${item.label}的下一题`
        && answered['deadlineAt'] === null && answered['timeUp'] === false,
        `不带标记（${item.label}）正常回答一题，拿到下一题，三个字段对`)
      assertIsoNow(answered['serverNow'], `不带标记回答（${item.label}）`)
    }

    await prisma.mockInterviewSession.update({
      where: { id: openId },
      data: { startedAt: new Date(Date.now() - 60 * 60 * 1000) },
    })
    const llmBeforeOpenAnswer = llmRequests
    const asrBeforeOpen = asrCalls
    const ttsBeforeOpen = ttsCalls
    enqueue(200, JSON.stringify({ question: '第二题对照', qType: 'experience' }))
    const openAnswer = dataOf(await api('POST', `/mock-interviews/${openId}/answer`, openAuth, { answer: '不限时的回答' }), '不限时回答')
    check(llmRequests === llmBeforeOpenAnswer + 1, '把开始时间改到一小时前，不带标记的回答仍然去问模型')
    check(openAnswer['done'] === false && openAnswer['question'] === '第二题对照' && openAnswer['qType'] === 'experience'
      && openAnswer['questionIndex'] === 2 && openAnswer['questionTarget'] === 6
      && openAnswer['deadlineAt'] === null && openAnswer['timeUp'] === false
      && keysOf(openAnswer) === 'deadlineAt,done,qType,question,questionIndex,questionTarget,serverNow,timeUp',
      '不限时回答的原有字段还在，截止三个字段是空和 false')
    assertIsoNow(openAnswer['serverNow'], '不限时回答')
    const openAsr = dataOf(await transcribe(openId, openAuth), '不限时转写')
    const openTts = dataOf(await api('POST', `/mock-interviews/${openId}/turns/0/audio`, openAuth), '不限时播报')
    check(openAsr['text'] === '转写对照句' && asrCalls === asrBeforeOpen + 1, '不限时场次转写照常，语音识别被调到')
    check(openTts['audio'] === 'QQ==' && openTts['format'] === 'mp3' && ttsCalls === ttsBeforeOpen + 1, '不限时场次播报照常，语音合成被调到')
    const openRow = await prisma.mockInterviewSession.findUnique({ where: { id: openId } })
    check(openRow?.deadlineAt === null, '改了开始时间也不会凭空写出截止时刻')

    // ── 带标记：3 / 5 / 8 分钟，再开始不延长 ─────────────────────────────────
    for (const minutes of [3, 5, 8] as const) {
      const created = await create(NONE, minutes)
      const before = Date.now()
      const data = dataOf(await start(created.id, created.auth, { hardDeadline: true }), `带标记开始 ${minutes} 分钟`)
      const after = Date.now()
      const deadlineMs = Date.parse(String(data['deadlineAt']))
      const span = minutes * 60_000
      check(deadlineMs >= before + span && deadlineMs <= after + span && data['timeUp'] === false,
        `${minutes} 分钟场次的截止时刻落在调用前后各加 ${minutes} 分钟的窗口里`)
      assertIsoNow(data['serverNow'], `${minutes} 分钟开始`)
      const againLlm = llmRequests
      const again = await start(created.id, created.auth, { hardDeadline: true })
      const againErr = errorOf(again)
      const row = await prisma.mockInterviewSession.findUnique({ where: { id: created.id } })
      const firstTurn = (await loadTurns(created.id)).find((t) => t.idx === 0)
      check(again.status === 400 && againErr.code === 'INTERVIEW_ALREADY_STARTED' && llmRequests === againLlm
        && row?.deadlineAt?.toISOString() === data['deadlineAt'],
        `再调开始仍是 400，不打模型，库里截止时刻不变（${minutes} 分钟）`)
      check(!!row?.deadlineAt && !!firstTurn && row.deadlineAt.getTime() - firstTurn.createdAt.getTime() === span,
        `${minutes} 分钟场次的截止时刻减去第 0 轮 createdAt 恰好等于 ${minutes} 分钟`)
      const got = dataOf(await api('GET', `/mock-interviews/${created.id}`, created.auth), `读取 ${minutes} 分钟`)
      check(got['deadlineAt'] === data['deadlineAt'] && got['timeUp'] === false, `GET 回的截止时刻和开始时是同一个（${minutes} 分钟）`)
      assertIsoNow(got['serverNow'], `${minutes} 分钟读取`)
    }

    // ── 开始时模型失败：回滚后重新算 ─────────────────────────────────────────
    {
      const created = await create(memberA, 5)
      enqueue(500, '')
      const llmBefore = llmRequests
      const failed = await start(created.id, created.auth, { hardDeadline: true })
      const failedErr = errorOf(failed)
      const row = await prisma.mockInterviewSession.findUnique({ where: { id: created.id } })
      const turns = await loadTurns(created.id)
      check(failed.status === 503 && failedErr.code === 'AI_PROVIDER_ERROR' && llmRequests === llmBefore + 1
        && row?.status === 'configured' && row?.startedAt === null && row?.deadlineAt === null && turns.length === 0,
        '开始时模型失败：状态回到 configured，开始时刻和截止时刻都空着，题目没留下')
      const before = Date.now()
      const again = dataOf(await start(created.id, created.auth, { hardDeadline: true }), '失败后重新开始')
      const after = Date.now()
      const deadlineMs = Date.parse(String(again['deadlineAt']))
      check(deadlineMs >= before + 5 * 60_000 && deadlineMs <= after + 5 * 60_000 && again['timeUp'] === false,
        '重新开始成功，截止时刻按这一次重新算')
    }

    async function mainLine(label: string, creator: Auth): Promise<{ id: string; auth: Auth }> {
      const created = await create(creator, 5)
      const { id, auth } = created
      const asrBefore = asrCalls
      const ttsBefore = ttsCalls
      const llmBefore = llmRequests
      const started = dataOf(await start(id, auth, { hardDeadline: true }), `${label} 主线开始`)
      check(started['timeUp'] === false && typeof started['deadlineAt'] === 'string', `${label} 开始时还没到点`)
      const heard = dataOf(await transcribe(id, auth), `${label} 到点前转写`)
      const spoken = dataOf(await api('POST', `/mock-interviews/${id}/turns/0/audio`, auth), `${label} 到点前播报`)
      check(heard['text'] === '转写对照句' && asrCalls === asrBefore + 1, `${label} 到点前转写调了语音识别（对照：次数 +1）`)
      check(spoken['format'] === 'mp3' && ttsCalls === ttsBefore + 1, `${label} 到点前播报调了语音合成（对照：次数 +1）`)
      const bodiesBeforeAnswer = llmBodies.length
      enqueue(200, JSON.stringify({ question: `${label}的下一题`, qType: 'experience' }))
      const answered = dataOf(await api('POST', `/mock-interviews/${id}/answer`, auth, { answer: `${label}到点前的回答` }), `${label} 到点前回答`)
      const midTurns = await loadTurns(id)
      check(llmRequests === llmBefore + 2 && answered['done'] === false && answered['question'] === `${label}的下一题`
        && answered['timeUp'] === false && answered['deadlineAt'] === started['deadlineAt']
        && midTurns.some((t) => t.role === 'interviewer' && t.content === `${label}的下一题`),
        `${label} 到点前回答正常出下一题，三个字段对，假模型请求数涨过`)
      check((llmBodies[bodiesBeforeAnswer] ?? '').includes(`${label}到点前的回答`),
        `${label} 出题请求正文里有刚交的这条回答`)
      assertIsoNow(answered['serverNow'], `${label} 到点前回答`)

      await setDeadline(id, -1)
      const asrAt = asrCalls
      const ttsAt = ttsCalls
      const llmAt = llmRequests
      assert409(await transcribe(id, auth), `${label} 截止前 1 毫秒转写`)
      assert409(await api('POST', `/mock-interviews/${id}/turns/0/audio`, auth), `${label} 截止前 1 毫秒播报`)
      check(asrCalls === asrAt && ttsCalls === ttsAt, `${label} 到点后转写和播报没有再调语音识别或合成`)

      const turnsBeforeGrace = (await loadTurns(id)).length
      const interviewerBefore = (await loadTurns(id)).filter((t) => t.role === 'interviewer').length
      const grace = dataOf(await api('POST', `/mock-interviews/${id}/answer`, auth, { answer: `${label}宽限内的回答` }), `${label} 宽限内回答`)
      const graceTurns = await loadTurns(id)
      check(llmRequests === llmAt && grace['done'] === true && grace['timeUp'] === true
        && !('question' in grace) && !('qType' in grace)
        && graceTurns.length === turnsBeforeGrace + 1
        && graceTurns.filter((t) => t.role === 'interviewer').length === interviewerBefore
        && graceTurns.some((t) => t.role === 'candidate' && t.content === `${label}宽限内的回答`),
        `${label} 截止前 1 毫秒的回答被收下，不调模型，没有新题`)
      assertIsoNow(grace['serverNow'], `${label} 宽限内回答`)

      const skipSession = await create(creator, 3)
      dataOf(await start(skipSession.id, skipSession.auth, { hardDeadline: true }), `${label} 跳过场开始`)
      await setDeadline(skipSession.id, -1000)
      const skipLlm = llmRequests
      const skipInterviewers = (await loadTurns(skipSession.id)).filter((t) => t.role === 'interviewer').length
      const skipped = dataOf(await api('POST', `/mock-interviews/${skipSession.id}/answer`, skipSession.auth, { skip: true }), `${label} 宽限内跳过`)
      const skipTurns = await loadTurns(skipSession.id)
      check(llmRequests === skipLlm && skipped['done'] === true && skipped['timeUp'] === true && !('question' in skipped)
        && skipTurns.some((t) => t.role === 'candidate' && t.skipped && t.content === '（跳过）')
        && skipTurns.filter((t) => t.role === 'interviewer').length === skipInterviewers,
        `${label} 截止前 1 秒的跳过同样收下，不调模型，不新增面试官轮次`)

      await setDeadline(id, -3500)
      const lateLlm = llmRequests
      const lateTurns = (await loadTurns(id)).length
      assert409(await api('POST', `/mock-interviews/${id}/answer`, auth, { answer: `${label}不该收下` }), `${label} 过点 3.5 秒回答`)
      assert409(await api('POST', `/mock-interviews/${id}/answer`, auth, { skip: true }), `${label} 过点 3.5 秒跳过`)
      check(llmRequests === lateLlm && (await loadTurns(id)).length === lateTurns,
        `${label} 过点 3.5 秒不打模型，库里轮次数不变`)

      const strangerAnswer = label === '匿名'
        ? await api('POST', `/mock-interviews/${id}/answer`, { kind: 'anon', token: 'wrong-token' }, { answer: '别人' })
        : await api('POST', `/mock-interviews/${id}/answer`, memberB, { answer: '别人' })
      const strangerAsr = label === '匿名'
        ? await transcribe(id, { kind: 'anon', token: 'wrong-token' })
        : await transcribe(id, memberB)
      const strangerAudio = label === '匿名'
        ? await api('POST', `/mock-interviews/${id}/turns/0/audio`, { kind: 'anon', token: 'wrong-token' })
        : await api('POST', `/mock-interviews/${id}/turns/0/audio`, memberB)
      const strangerGet = label === '匿名'
        ? await api('GET', `/mock-interviews/${id}`, { kind: 'anon', token: 'wrong-token' })
        : await api('GET', `/mock-interviews/${id}`, memberB)
      assert404(strangerAnswer, `${label} 过点后别人回答`)
      assert404(strangerAsr, `${label} 过点后别人转写`)
      assert404(strangerAudio, `${label} 过点后别人播报`)
      assert404(strangerGet, `${label} 过点后别人读取`)
      const ownerGet = dataOf(await api('GET', `/mock-interviews/${id}`, auth), `${label} 本人过点后读取`)
      check(ownerGet['timeUp'] === true && ownerGet['deadlineAt'] != null, `${label} 本人过点后读得到截止时刻（对照越权的 404）`)
      return { id, auth }
    }

    await mainLine('匿名', NONE)
    const memberSession = await mainLine('会员', memberA)

    // ── 模型出题途中过点 ──────────────────────────────────────────────────────
    {
      const created = await create(memberA, 5)
      dataOf(await start(created.id, created.auth, { hardDeadline: true }), '途中过点开始')
      const marker = '途中过点不该入库的题'
      const hold = enqueueHold(200, JSON.stringify({ question: marker, qType: 'experience' }))
      const llmBefore = llmRequests
      const pending = api('POST', `/mock-interviews/${created.id}/answer`, created.auth, { answer: '途中过点前交出的回答' })
      const res = await withHold(hold, () => setDeadline(created.id, -1000).then(() => undefined), pending, '途中过点')
      const data = dataOf(res, '途中过点回答')
      const turns = await loadTurns(created.id)
      check(llmRequests === llmBefore + 1 && data['done'] === true && data['timeUp'] === true && !('question' in data)
        && turns.some((t) => t.role === 'candidate' && t.content === '途中过点前交出的回答')
        && !turns.some((t) => t.content.includes(marker)),
        '模型出题途中过点：回答在库里，模型那道题不在库里，返回已结束')
    }

    // ── 模型失败：过点则收下，没过点则原样报错且不存 ─────────────────────────
    {
      const created = await create(memberA, 5)
      dataOf(await start(created.id, created.auth, { hardDeadline: true }), '失败且过点开始')
      const interviewerBefore = (await loadTurns(created.id)).filter((t) => t.role === 'interviewer').length
      const hold = enqueueHold(500, '')
      const logsBefore = await failedQuestionLogs()
      const llmBefore = llmRequests
      const pending = api('POST', `/mock-interviews/${created.id}/answer`, created.auth, { answer: '失败时已经过点的回答' })
      const res = await withHold(hold, () => setDeadline(created.id, -1000).then(() => undefined), pending, '失败且过点')
      const data = dataOf(res, '失败且过点')
      await aiLog.flush()
      const turns = await loadTurns(created.id)
      check(res.status < 300 && data['done'] === true && data['timeUp'] === true && !('question' in data)
        && llmRequests === llmBefore + 1
        && turns.some((t) => t.content === '失败时已经过点的回答')
        && turns.filter((t) => t.role === 'interviewer').length === interviewerBefore
        && (await failedQuestionLogs()) === logsBefore + 1,
        '模型失败且已经过点：回答在库里，没有下一题，面试官轮次没增加，返回已结束，失败日志照旧记一条')

      const fresh = await create(memberA, 5)
      dataOf(await start(fresh.id, fresh.auth, { hardDeadline: true }), '失败且没过点开始')
      enqueue(500, '')
      const logsNotPast = await failedQuestionLogs()
      const llmNotPast = llmRequests
      const denied = await api('POST', `/mock-interviews/${fresh.id}/answer`, fresh.auth, { answer: '失败时还没过点的回答' })
      const deniedErr = errorOf(denied)
      await aiLog.flush()
      const freshTurns = await loadTurns(fresh.id)
      check(denied.status === 503 && deniedErr.code === 'AI_PROVIDER_ERROR'
        && llmRequests === llmNotPast + 1
        && freshTurns.some((t) => t.role === 'interviewer' && t.idx === 0)
        && !freshTurns.some((t) => t.role === 'candidate')
        && (await failedQuestionLogs()) === logsNotPast + 1,
        '模型失败且没过点：报原来的错，第一题还在，回答不在库里，失败日志照旧有')
      enqueue(200, JSON.stringify({ question: '失败后重交的下一题', qType: 'experience' }))
      const retried = dataOf(await api('POST', `/mock-interviews/${fresh.id}/answer`, fresh.auth, { answer: '失败时还没过点的回答' }), '失败后重交')
      const retriedTurns = await loadTurns(fresh.id)
      check(retried['done'] === false && retried['question'] === '失败后重交的下一题'
        && retriedTurns.some((t) => t.role === 'candidate' && t.content === '失败时还没过点的回答'),
        '没过点失败后同一条回答再交一次：模型正常，拿到下一题，回答在库里')
    }

    // ── 结束：只用已存回答；没回答 400；出报告失败后回答仍 409 ───────────────
    {
      const stored = '已存回答_只此一句'
      const rejected = '过点后不该进报告的回答'
      const created = await create(NONE, 5)
      dataOf(await start(created.id, created.auth, { hardDeadline: true }), '出报告开始')
      await setDeadline(created.id, -1000)
      const llmBefore = llmRequests
      dataOf(await api('POST', `/mock-interviews/${created.id}/answer`, created.auth, { answer: stored }), '出报告前的宽限回答')
      check(llmRequests === llmBefore, '出报告前这条宽限回答没有打模型（对照后面出报告会打）')
      await setDeadline(created.id, -3500)
      const rejectLlm = llmRequests
      assert409(await api('POST', `/mock-interviews/${created.id}/answer`, created.auth, { answer: rejected }), '出报告前过点 3.5 秒')
      check(llmRequests === rejectLlm && !(await loadTurns(created.id)).some((t) => t.content === rejected),
        '过点 3.5 秒的回答被拒绝，没有入库，也没有打模型')
      enqueue(200, REPORT_JSON)
      const bodiesAtEnd = llmBodies.length
      const ended = dataOf(await api('POST', `/mock-interviews/${created.id}/end`, created.auth, {}), '过点后结束')
      const reportBody = llmBodies.slice(bodiesAtEnd).join('\n')
      const excerpts = Array.isArray(ended['qaExcerpts']) ? ended['qaExcerpts'] as Array<Record<string, unknown>> : []
      const answers = excerpts.map((row) => row['answerExcerpt']).filter((item) => item != null)
      check(llmRequests === llmBefore + 1 && reportBody.includes(stored) && !reportBody.includes(rejected)
        && answers.length === 1 && answers[0] === stored,
        '过点后结束：出报告请求里有被收下的回答、没有被拒的那条，摘录也只有被收下的')

      const empty = await create(NONE, 5)
      dataOf(await start(empty.id, empty.auth, { hardDeadline: true }), '零回答开始')
      await setDeadline(empty.id, -1000)
      const noAnswer = await api('POST', `/mock-interviews/${empty.id}/end`, empty.auth, {})
      const noAnswerErr = errorOf(noAnswer)
      const reports = await prisma.mockInterviewReport.count({ where: { sessionId: empty.id } })
      check(noAnswer.status === 400 && noAnswerErr.code === 'INTERVIEW_NO_ANSWERS' && reports === 0,
        '过点后一条回答都没有，结束仍是 400 INTERVIEW_NO_ANSWERS')

      const broken = await create(memberA, 5)
      dataOf(await start(broken.id, broken.auth, { hardDeadline: true }), '报告失败开始')
      await setDeadline(broken.id, -1000)
      dataOf(await api('POST', `/mock-interviews/${broken.id}/answer`, broken.auth, { answer: '报告失败前的回答' }), '报告失败前回答')
      await setDeadline(broken.id, -3500)
      enqueue(500, '')
      const endLlm = llmRequests
      const reportFailed = await api('POST', `/mock-interviews/${broken.id}/end`, broken.auth, {})
      const reportErr = errorOf(reportFailed)
      const after = await prisma.mockInterviewSession.findUnique({ where: { id: broken.id } })
      check(reportFailed.status === 503 && reportErr.code === 'AI_PROVIDER_ERROR' && llmRequests === endLlm + 1
        && after?.status === 'in_progress',
        '出报告时模型失败仍是 503，场次回到进行中')
      const answerLlm = llmRequests
      assert409(await api('POST', `/mock-interviews/${broken.id}/answer`, broken.auth, { answer: '报告失败后还想答' }), '报告失败后再回答')
      check(llmRequests === answerLlm, '报告失败后再回答仍被截止挡住，没有打模型')
    }

    // ── 到点后同一题连交两次：都按已结束返回，库里只留先到的那条 ───────────────
    {
      const created = await create(memberA, 5)
      dataOf(await start(created.id, created.auth, { hardDeadline: true }), '重复提交开始')
      await setDeadline(created.id, -1000)
      const llmBefore = llmRequests
      const first = dataOf(await api('POST', `/mock-interviews/${created.id}/answer`, created.auth, { answer: '重复提交第一次' }), '到点后第一次提交')
      const second = dataOf(await api('POST', `/mock-interviews/${created.id}/answer`, created.auth, { answer: '重复提交第二次内容不同' }), '到点后第二次提交')
      const answers = (await loadTurns(created.id)).filter((t) => t.role === 'candidate')
      check(first['done'] === true && first['timeUp'] === true
        && second['done'] === true && second['timeUp'] === true
        && llmRequests === llmBefore
        && answers.length === 1 && answers[0]?.content === '重复提交第一次',
        '到点后同一题连交两次都已结束，库里只留第一次，假模型没有收到请求')
    }

    // ── AI 暂停：读取走真实守卫，生成被拦住 ───────────────────────────────────
    {
      const llmBefore = llmRequests
      await setFlags(true)
      const got = dataOf(await api('GET', `/mock-interviews/${memberSession.id}`, memberSession.auth), 'AI 暂停时读取')
      check(got['sessionId'] === memberSession.id && got['timeUp'] === true, 'AI 暂停时 GET 照常返回这场会话')
      const blocked = await api('POST', `/mock-interviews/${memberSession.id}/answer`, memberSession.auth, { answer: '暂停时不该进服务' })
      const blockedErr = errorOf(blocked)
      check(blocked.status === 503 && blockedErr.code === 'AI_PAUSED' && llmRequests === llmBefore,
        '同一个守卫在暂停时拦住回答（对照：读取没被拦，模型也没被打）')
      await setFlags(false)
      assert409(await api('POST', `/mock-interviews/${memberSession.id}/answer`, memberSession.auth, { answer: '暂停解开后' }), '暂停解开后回答')
    }

    check(answerSuccesses.length > 0 && answerSuccesses.every((row) => !(row['done'] === false && row['timeUp'] === true)),
      `回答接口的成功返回里没有 done 为 false 同时 timeUp 为 true（共 ${answerSuccesses.length} 条）`)

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } finally {
    await setFlags(false).catch(() => undefined)
    if (sessionIds.length > 0) {
      await prisma.mockInterviewSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => undefined)
      await prisma.auditLog.deleteMany({ where: { targetId: { in: sessionIds } } }).catch(() => undefined)
    }
    await prisma.aiServiceLog.deleteMany({
      where: { createdAt: { gte: scriptStarted }, operation: { in: ['interviewQuestion', 'interviewReport', 'voiceTranscribe', 'voiceSynthesize'] } },
    }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } }).catch(() => undefined)
    await app.close().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await prisma.onModuleDestroy?.().catch(() => undefined)
  }
}

main().catch((error) => {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
  writeSync(2, `${text}\n`)
  process.exit(1)
})
