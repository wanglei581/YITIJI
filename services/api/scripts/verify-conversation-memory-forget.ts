/**
 * B10：删问答记录、会员登出、一体机清场时，进程内存里的对话原话立刻丢掉；
 * 空闲过期改成每分钟扫，不再等下一次调用顺手清。
 *
 * 自建临时 SQLite，不碰开发库。模型请求用假 fetch 截下来看正文。
 * 运行：pnpm --filter @ai-job-print/api verify:conversation-memory-forget
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BadRequestException, HttpException, Module, NotFoundException, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AssistantSessionForgetController } from '../src/ai/assistant-session-forget.controller'
import { AssistantSessionsForgetDto } from '../src/ai/dto/assistant-sessions-forget.dto'
import { AiLogService } from '../src/ai/ai-log.service'
import { LlmChatService, assistantOwnerKey } from '../src/ai/llm/llm-chat.service'
import { maskUserTextsForLlmText } from '../src/common/pii/llm-input-mask'
import { AdvisorController } from '../src/advisor/advisor.controller'
import { AdvisorQaMemory } from '../src/advisor/advisor-qa-memory'
import { AdvisorArtifactService } from '../src/advisor/advisor-artifact.service'
import { AdvisorService } from '../src/advisor/advisor.service'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { AuditService } from '../src/audit/audit.service'
import { ConversationMemoryBridge } from '../src/common/conversation-memory-bridge'
import { ConversationMemoryModule } from '../src/common/conversation-memory.module'
import { resolveOptionalEndUser } from '../src/common/auth/optional-end-user'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { resetRedisCooldownForTests } from '../src/common/redis/redis-degradation'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { MemberAuthService } from '../src/member-auth/member-auth.service'
import { SMS_SENDER } from '../src/member-auth/sms/sms-sender'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { runInflightForgetScenarios } from './verify-conversation-memory-forget-inflight'
import { runGuestLoginLogoutScenarios } from './verify-conversation-memory-forget-logout-switch'

process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

/**
 * 进对话内容的测试标记不带数字：发给模型前的遮盖会把 UUID 里连着的数字（如「1345-4828-977」）
 * 当成手机号、银行卡遮掉，标记就对不上了（10/13 实测 5000 个里 33 个被改，门禁偶发红）。
 */
function textMark(label: string): string {
  return `${label}${randomUUID().replace(/-/g, '').replace(/\d/g, (d) => 'ghijklmnop'[Number(d)]!)}`
}

let passCount = 0
let failCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }
function check(ok: boolean, msg: string) { if (ok) pass(msg); else fail(msg) }

const API_ROOT = resolve(__dirname, '..')
function readSrc(rel: string): string {
  return readFileSync(join(API_ROOT, rel), 'utf8')
}

function methodSlice(source: string, signature: string): string {
  const start = source.indexOf(signature)
  if (start < 0) return ''
  const next = source.indexOf('\n  async ', start + signature.length)
  const nextPrivate = source.indexOf('\n  private ', start + signature.length)
  const ends = [next, nextPrivate].filter((index) => index > start)
  const end = ends.length > 0 ? Math.min(...ends) : source.length
  return source.slice(start, end)
}

const CRON_SWEEP = /@Cron\(CronExpression\.EVERY_MINUTE\)\s*\n\s*sweep\(/

interface SentBody { messages: Array<{ role: string; content: string }> }
const sent: SentBody[] = []
function userText(body: SentBody | undefined): string {
  return (body?.messages ?? []).filter((message) => message.role === 'user').map((message) => message.content).join('\n')
}

const llmConfig = {
  vendor: 'openai',
  model: 'm',
  baseURL: 'http://127.0.0.1/v1',
  systemPrompt: '你是就业服务助手',
  roleScope: '',
  forbiddenWords: [] as string[],
  temperature: 0,
  enabled: true,
}

function notFoundMessage(error: unknown): string {
  if (!(error instanceof NotFoundException)) return ''
  const body = error.getResponse() as { error?: { message?: string }; message?: string | string[] }
  if (typeof body.error?.message === 'string') return body.error.message
  if (typeof body.message === 'string') return body.message
  return ''
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'conversation-memory-forget-'))
  const db = join(dir, 'verify-conversation-memory-forget.db')
  closeSync(openSync(db, 'a'))
  process.env['DATABASE_URL'] = `file:${db}`
  process.env['VERIFICATION_DATABASE_TARGET'] ||= 'isolated'
  const savedFetch = globalThis.fetch
  let prisma: PrismaService | undefined
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined
  try {
    assertIsolatedVerificationDatabase()
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push'], {
      cwd: API_ROOT,
      env: process.env,
      stdio: 'pipe',
    })
    prisma = new PrismaService()
    await prisma.onModuleInit()

    const chatSrc = readSrc('src/ai/llm/llm-chat.service.ts')
    const memorySrc = readSrc('src/advisor/advisor-qa-memory.ts')
    const advisorModule = readSrc('src/advisor/advisor.module.ts')
    const aiModule = readSrc('src/ai/ai.module.ts')
    const assetsModule = readSrc('src/member-assets/member-assets.module.ts')
    const assetsSrc = readSrc('src/member-assets/member-assets.service.ts')
    const authModule = readSrc('src/member-auth/member-auth.module.ts')
    const authSrc = readSrc('src/member-auth/member-auth.service.ts')
    const forgetSrc = readSrc('src/ai/assistant-session-forget.controller.ts')
    const aiController = readSrc('src/ai/ai.controller.ts')
    const advisorSrc = readSrc('src/advisor/advisor.service.ts')
    const advisorControllerSrc = readSrc('src/advisor/advisor.controller.ts')
    const providersBlock = /providers:\s*\[([\s\S]*?)\]/.exec(advisorModule)?.[1] ?? ''
    const deleteBody = methodSlice(assetsSrc, 'async deleteQaRecord(')
    const logoutBody = methodSlice(authSrc, 'async logout(')

    check(providersBlock.includes('AdvisorRetentionTask'), '接线：AdvisorRetentionTask 仍在 AdvisorModule 的 providers 里')
    check(!providersBlock.includes('AdvisorQaMemory'), '接线：问答内存不在 AdvisorModule 里再造一份')
    check(advisorModule.includes('ConversationMemoryModule') && /exports:\s*\[[^\]]*ConversationMemoryModule/.test(advisorModule), '接线：AdvisorModule 引入并导出问答内存模块')
    check(aiModule.includes('ConversationMemoryModule') && aiModule.includes('LlmChatService') && aiModule.includes('AssistantSessionForgetController'), '接线：AiModule 接上清理桥、导出对话服务、挂上清场控制器')
    check(/exports:\s*\[[^\]]*LlmChatService/.test(aiModule), '接线：LlmChatService 从 AiModule 导出，删记录才能清到同一份内存')
    check(assetsModule.includes('AiModule') && assetsModule.includes('ConversationMemoryModule'), '接线：会员资产模块引 AI 模块和问答内存模块')
    check(!assetsModule.includes('AdvisorModule'), '接线：会员资产不引 AdvisorModule，避免绕回 AI 模块')
    check(authModule.includes('ConversationMemoryModule') && !authModule.includes('AiModule') && !authModule.includes('AdvisorModule'), '接线：登录模块只引清理桥这一小块，不引 AI 或顾问模块')
    const deleteManyAt = deleteBody.indexOf('advisorSession.deleteMany')
    check(
      deleteManyAt >= 0 && deleteBody.indexOf('qaMemory') > deleteManyAt && deleteBody.indexOf('forgetOwner(') > deleteManyAt,
      '接线：删库成功之后才清作业问答内存和该会员的小青对话',
    )
    const unregAt = logoutBody.indexOf('unregisterMemberSession')
    check(
      unregAt >= 0 && logoutBody.indexOf('forgetChatOwner(') > unregAt && logoutBody.indexOf('forgetOwner(') > unregAt,
      '接线：登出先注销会话，再清该会员的小青对话和作业问答',
    )
    check(advisorSrc.includes('u:${row.endUserId}'), '接线：作业追问写入内存时带上会员归属')
    check(forgetSrc.includes("@Post('assistant/sessions/forget')"), '接线：清场路由是 POST /assistant/sessions/forget')
    check(advisorControllerSrc.includes("@Post('sessions/:sessionId/forget')") && methodSlice(advisorSrc, 'async forgetSession(').includes('this.loadOwned('), '接线：作业清场路由是 @Post(\'sessions/:sessionId/forget\')，调了 loadOwned')
    check(forgetSrc.includes('@TerminalScopedThrottle(12)') && aiController.includes('@TerminalScopedThrottle(12)'), '场景 5 阳性：清场和 /assistant/chat 都是每分钟 12 次的同一套限流')
    check(forgetSrc.includes('@AiUseExempt(') && !/@AiUse\(/.test(forgetSrc) && !/publicQuota|\.consume\(|aiLog/.test(forgetSrc), '场景 5：清场不扣次数、不算 AI 调用、不进 AI 闸门')
    check(/private readonly sessions = new Map</.test(chatSrc) && !/prisma\./.test(chatSrc), '阳性：小青对话仍只在这个文件的内存 Map 里，不落库')

    const sessions = new Map<string, string>()
    const redis = {
      get: async (key: string) => sessions.get(key) ?? null,
      unregisterMemberSession: async () => undefined,
    }
    const llmGate: { pending: Promise<void> | null } = { pending: null }
    const modelGate: { wait: () => Promise<void>; entered: () => void } = {
      wait: async () => undefined,
      entered: () => undefined,
    }
    const jwt = new JwtService({ secret: 'verify-conversation-memory-forget-secret' })
    const configStub = { getApiKey: () => 'verify-key', getConfig: () => llmConfig, isReady: () => true }
    const { LlmConfigService } = await import('../src/ai/llm/llm-config.service')
    class ProbeModule {}
    Module({
      imports: [ConversationMemoryModule],
      providers: [
        { provide: LlmConfigService, useValue: configStub },
        LlmChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: JwtService, useValue: jwt },
        { provide: SMS_SENDER, useValue: { sendCode: async () => undefined, sendPartnerPhoneRegisteredNotice: async () => undefined } },
        { provide: LlmAdvisorService, useValue: {
          isAvailable: () => true,
          providerLabel: () => 'verify',
          answer: async (question: string) => {
            modelGate.entered()
            await modelGate.wait()
            return { answer: `答：${question}`, evidenceLevel: 'E3', sourceNote: '参考' }
          },
        } },
        { provide: AdvisorArtifactService, useValue: { save: async () => { throw new Error('不应走到保存要点') } } },
        { provide: AuditService, useValue: { write: async () => undefined } },
        { provide: AiLogService, useValue: { record: () => undefined } },
        AdvisorService,
        MemberAssetsService,
        MemberAuthService,
      ],
    })(ProbeModule)
    app = await NestFactory.createApplicationContext(ProbeModule, { logger: false, abortOnError: false })
    const chat = app.get(LlmChatService)
    const memory = app.get(AdvisorQaMemory)
    const advisor = app.get(AdvisorService)
    const assets = app.get(MemberAssetsService)
    const auth = app.get(MemberAuthService)
    const bridge = app.get(ConversationMemoryBridge)
    const wired = advisor as unknown as { qaMemory: AdvisorQaMemory }
    const assetsWired = assets as unknown as { qaMemory?: AdvisorQaMemory; chat?: LlmChatService }
    const authWired = auth as unknown as { qaMemory?: AdvisorQaMemory; memoryBridge?: ConversationMemoryBridge }
    check(wired.qaMemory === memory, '接线阳性：作业服务用的是模块里那一份问答内存')
    check(assetsWired.qaMemory === memory && assetsWired.chat === chat, '接线阳性：删记录清的是同一份问答内存和同一份小青对话')
    check(authWired.qaMemory === memory && authWired.memoryBridge === bridge, '接线阳性：登出清的是同一份问答内存，对话走清理桥')

    ;(globalThis as { fetch: typeof fetch }).fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')) as SentBody)
      const pending = llmGate.pending
      if (pending) await pending
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ choices: [{ message: { content: '模型的回答' } }] }) } as Response
    }) as typeof fetch

    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    const future = new Date(Date.now() + 3_600_000)
    async function createUser(id: string): Promise<void> {
      await prisma!.endUser.create({ data: { id, phoneHash: id, phoneEnc: 'verify-only', nickname: 'verify', enabled: true, status: 'active' } })
    }
    async function createQa(userId: string, sessionId: string, artifactId: string): Promise<void> {
      await prisma!.advisorSession.create({ data: { id: sessionId, endUserId: userId, topic: '顾问作业', skill: 'qa', expiresAt: future } })
      await prisma!.advisorArtifact.create({ data: { id: artifactId, sessionId, kind: 'qa_pins', provider: 'verify', payloadJson: '{}', expiresAt: future } })
    }
    function bearer(userId: string): string {
      const jti = randomUUID()
      sessions.set(memberSessionKey(jti), userId)
      return jwt.sign({ sub: userId }, { jwtid: jti, audience: 'enduser', expiresIn: '10m' })
    }
    async function chatTurn(owner: string, sessionId: string | undefined, message: string) {
      const before = sent.length
      const result = await chat.chat({ message, channel: 'kiosk', sessionId } as never, undefined, owner)
      return { result, body: sent[before], calls: sent.length - before }
    }
    const controller = new AssistantSessionForgetController(chat, jwt, redis as never, prisma)

    // ── 场景 1 ────────────────────────────────────────────────────────────
    const userA = `verify-a-${randomUUID()}`
    const userB = `verify-b-${randomUUID()}`
    await createUser(userA)
    await createUser(userB)
    const markA = textMark('甲会员上一轮原话')
    const markB = textMark('乙会员上一轮原话')
    // 自检：老写法的标记会被遮盖改掉（门禁偶发红的原因），新写法不会。
    const oldStyle = '乙会员上一轮原话0627c99c-1345-4828-977d-3df0fa3e31ce'
    check(maskUserTextsForLlmText([oldStyle], 'assistant_chat', { keepNames: true })[0] !== oldStyle, '自检阳性：带连号数字的 UUID 标记会被遮盖改掉')
    check([markA, markB].every((mark) => !/\d/.test(mark) && maskUserTextsForLlmText([mark], 'assistant_chat', { keepNames: true })[0] === mark), '自检：进对话的测试标记不含数字，遮盖不改它')
    const firstA = await chatTurn(`u:${userA}`, undefined, markA)
    const secondA = await chatTurn(`u:${userA}`, firstA.result.sessionId, '甲会员接着问')
    check(firstA.calls === 1 && userText(firstA.body).includes(markA), '场景 1 阳性：甲的第一轮原话确实发给了模型')
    check(secondA.result.sessionId === firstA.result.sessionId && userText(secondA.body).includes(markA), '场景 1 阳性：甲续聊时模型请求里带着上一轮原话')
    const firstB = await chatTurn(`u:${userB}`, undefined, markB)
    const secondB = await chatTurn(`u:${userB}`, firstB.result.sessionId, '乙会员接着问')
    check(secondB.result.sessionId === firstB.result.sessionId && userText(secondB.body).includes(markB), '场景 1 阳性：乙续聊时模型请求里带着乙自己的上一轮原话')
    const qaA = `verify-qa-a-${randomUUID()}`
    const artifactA = `verify-art-a-${randomUUID()}`
    await createQa(userA, qaA, artifactA)
    await assets.deleteQaRecord(userA, artifactA)
    const afterDelete = await chatTurn(`u:${userA}`, firstA.result.sessionId, '甲会员删后再问')
    check(afterDelete.calls === 1 && userText(afterDelete.body).includes('甲会员删后再问') && !userText(afterDelete.body).includes(markA), '场景 1：删甲的问答记录后，同一会话号再聊，发给模型的请求里没有上一轮原话')
    const afterB = await chatTurn(`u:${userB}`, firstB.result.sessionId, '乙会员在甲删除之后接着问')
    check(afterB.result.sessionId === firstB.result.sessionId && userText(afterB.body).includes(markB), '场景 1：乙的会话不受影响，续聊仍带旧上下文')

    // ── 场景 2 ────────────────────────────────────────────────────────────
    const userS = `verify-s-${randomUUID()}`
    await createUser(userS)
    const markS = textMark('要点原话')
    const summaryChat = await chatTurn(`u:${userS}`, undefined, markS)
    const beforeSummary = chat.getOwnedTranscript(summaryChat.result.sessionId, `u:${userS}`)
    check(!!beforeSummary && beforeSummary.some((turn) => turn.content.includes(markS)), '场景 2 阳性：删记录前，原来的小青会话还在，转写里有这一轮原话')
    const qaS = `verify-qa-s-${randomUUID()}`
    const artifactS = `verify-art-s-${randomUUID()}`
    await createQa(userS, qaS, artifactS)
    await assets.deleteQaRecord(userS, artifactS)
    let summaryError: unknown
    try {
      const summary = new AssistantSummaryService(prisma, chat, configStub as never, { save: async () => { throw new Error('不应走到保存要点') } } as never, { write: async () => undefined } as never, { record: () => undefined } as never)
      await summary.summarize(summaryChat.result.sessionId, userS, '10.1.1.1')
      summaryError = null
    } catch (error) {
      summaryError = error
    }
    check(summaryError instanceof NotFoundException && notFoundMessage(summaryError).includes('会话不存在或已过期'), `场景 2：删问答记录后，用原来的小青会话号重新生成要点，回「会话不存在或已过期」（实际：${summaryError instanceof Error ? summaryError.name : '没有抛错'}）`)

    // ── 场景 3 ────────────────────────────────────────────────────────────
    const userQ = `verify-q-${randomUUID()}`
    const userQ2 = `verify-q2-${randomUUID()}`
    await createUser(userQ)
    await createUser(userQ2)
    const workQ = `verify-work-q-${randomUUID()}`
    const workQ2 = `verify-work-q2-${randomUUID()}`
    const artifactQ = `verify-art-q-${randomUUID()}`
    const artifactQ2 = `verify-art-q2-${randomUUID()}`
    await createQa(userQ, workQ, artifactQ)
    await createQa(userQ2, workQ2, artifactQ2)
    const questionQ = textMark('作业甲的原话')
    const questionQ2 = textMark('作业乙的原话')
    await advisor.ask(workQ, questionQ, { endUserId: userQ, accessToken: null })
    await advisor.ask(workQ2, questionQ2, { endUserId: userQ2, accessToken: null })
    check(memory.read(workQ).some((turn) => turn.content.includes(questionQ)), '场景 3 阳性：删记录前，这个作业的问答内存里有原话')
    check(memory.read(workQ2).some((turn) => turn.content.includes(questionQ2)), '场景 3 阳性：另一个作业的问答内存里有它自己的原话')
    await assets.deleteQaRecord(userQ, artifactQ)
    check(memory.read(workQ).length === 0, '场景 3：删记录后这个作业的问答内存为空')
    check(memory.read(workQ2).some((turn) => turn.content.includes(questionQ2)), '场景 3：另一个作业不受影响')

    // ── 场景 4 ────────────────────────────────────────────────────────────
    const userL = `verify-l-${randomUUID()}`
    const userL2 = `verify-l2-${randomUUID()}`
    await createUser(userL)
    await createUser(userL2)
    const markL = textMark('登出前原话')
    const markL2 = textMark('另一个会员的原话')
    const loggedIn = await chatTurn(`u:${userL}`, undefined, markL)
    const otherMember = await chatTurn(`u:${userL2}`, undefined, markL2)
    const workL = `verify-work-l-${randomUUID()}`
    const workL2 = `verify-work-l2-${randomUUID()}`
    const anonWork = `verify-work-anon-${randomUUID()}`
    await createQa(userL, workL, `verify-art-l-${randomUUID()}`)
    await createQa(userL2, workL2, `verify-art-l2-${randomUUID()}`)
    const questionL = textMark('登出前作业原话')
    const questionL2 = textMark('另一个会员作业原话')
    const questionAnon = textMark('匿名作业原话')
    await advisor.ask(workL, questionL, { endUserId: userL, accessToken: null })
    await advisor.ask(workL2, questionL2, { endUserId: userL2, accessToken: null })
    memory.append(anonWork, questionAnon, '匿名回答', null)
    check(
      !!chat.getOwnedTranscript(loggedIn.result.sessionId, `u:${userL}`)?.some((turn) => turn.content.includes(markL))
        && memory.read(workL).some((turn) => turn.content.includes(questionL)),
      '场景 4 阳性：登出前，他名下的小青对话和作业问答都在',
    )
    check(memory.read(anonWork).some((turn) => turn.content.includes(questionAnon)), '场景 4 阳性：匿名作业问答在，登出不该动它')
    await auth.logout(userL, randomUUID())
    check(chat.getOwnedTranscript(loggedIn.result.sessionId, `u:${userL}`) === null, '场景 4：登出后他名下的小青对话没了')
    check(memory.read(workL).length === 0, '场景 4：登出后他名下的作业问答没了')
    check(
      !!chat.getOwnedTranscript(otherMember.result.sessionId, `u:${userL2}`)?.some((turn) => turn.content.includes(markL2))
        && memory.read(workL2).some((turn) => turn.content.includes(questionL2))
        && memory.read(anonWork).some((turn) => turn.content.includes(questionAnon)),
      '场景 4：另一个会员和匿名作业都还在',
    )

    // ── 场景 5 ────────────────────────────────────────────────────────────
    const userF = `verify-f-${randomUUID()}`
    const userF2 = `verify-f2-${randomUUID()}`
    await createUser(userF)
    await createUser(userF2)
    const markF = textMark('清场前原话')
    const markF2 = textMark('别人的清场原话')
    const mine = await chatTurn(`u:${userF}`, undefined, markF)
    const continued = await chatTurn(`u:${userF}`, mine.result.sessionId, '清场前接着问')
    check(userText(continued.body).includes(markF), '场景 5 阳性：清自己的会话之前，续聊请求里带着原话')
    const theirs = await chatTurn(`u:${userF2}`, undefined, markF2)
    const ipMine = '10.8.1.1'
    const ipOther = '10.8.1.2'
    const markIp = textMark('来源地址甲的原话')
    const anon = await chatTurn(assistantOwnerKey(null, ipMine), undefined, markIp)
    const fetchesBeforeForget = sent.length
    const forgotten = await controller.forget(
      await pipe.transform({ sessionIds: [mine.result.sessionId, mine.result.sessionId] }, { type: 'body', metatype: AssistantSessionsForgetDto }) as AssistantSessionsForgetDto,
      { headers: { authorization: `Bearer ${bearer(userF)}` }, ip: '10.9.0.1' },
    )
    check(forgotten.forgotten === 1, `场景 5：本人清自己的会话号（重复一次）→ forgotten:1（实际 ${forgotten.forgotten}）`)
    check(sent.length === fetchesBeforeForget && fetchesBeforeForget > 0, '场景 5：清场没有再调用模型；阳性是前面的对话已经调用过')
    const afterForget = await chatTurn(`u:${userF}`, mine.result.sessionId, '清场后再问')
    check(afterForget.calls === 1 && userText(afterForget.body).includes('清场后再问') && !userText(afterForget.body).includes(markF), '场景 5：清掉之后再聊，不带旧上下文')
    const stolen = await controller.forget(
      await pipe.transform({ sessionIds: [theirs.result.sessionId] }, { type: 'body', metatype: AssistantSessionsForgetDto }) as AssistantSessionsForgetDto,
      { headers: { authorization: `Bearer ${bearer(userF)}` }, ip: '10.9.0.1' },
    )
    const theirsNext = await chatTurn(`u:${userF2}`, theirs.result.sessionId, '别人被拿去清之后接着问')
    check(stolen.forgotten === 0 && theirsNext.result.sessionId === theirs.result.sessionId && userText(theirsNext.body).includes(markF2), '场景 5：拿别的会员的会话号来清 → forgotten:0，那个会话还在')
    const stolenIp = await controller.forget(
      await pipe.transform({ sessionIds: [anon.result.sessionId] }, { type: 'body', metatype: AssistantSessionsForgetDto }) as AssistantSessionsForgetDto,
      { headers: {}, ip: ipOther },
    )
    const anonStill = chat.getOwnedTranscript(anon.result.sessionId, assistantOwnerKey(null, ipMine))
    check(stolenIp.forgotten === 0 && !!anonStill?.some((turn) => turn.content.includes(markIp)), '场景 5：拿别的来源地址的会话号来清 → forgotten:0，那个会话还在')
    const eleven = Array.from({ length: 11 }, (_item, index) => index.toString(16).padStart(32, 'a'))
    for (const [label, body] of [
      ['sessionIds 为空', { sessionIds: [] }],
      ['sessionIds 超过 10 个', { sessionIds: eleven }],
      ['sessionIds 有大写', { sessionIds: ['A'.repeat(32)] }],
      ['sessionIds 长度不对', { sessionIds: ['abc'] }],
      ['带不认识的字段', { sessionIds: [mine.result.sessionId], extra: true }],
    ] as const) {
      let status = 0
      try {
        await pipe.transform(body, { type: 'body', metatype: AssistantSessionsForgetDto })
      } catch (error) {
        status = error instanceof BadRequestException ? error.getStatus() : -1
      }
      check(status === 400, `场景 5：${label} → 400（实际 ${status}）`)
    }

    // ── 场景 6 ────────────────────────────────────────────────────────────
    check(CRON_SWEEP.test(chatSrc) && CRON_SWEEP.test(memorySrc), '场景 6：小青对话和作业问答都是每分钟调用 sweep，不等下一次有人来才清')
    const markOld = textMark('三十一分钟前的原话')
    const markOld2 = textMark('另一段三十一分钟前的原话')
    const old1 = await chatTurn(`u:${userF}`, undefined, markOld)
    const old2 = await chatTurn(`u:${userF2}`, undefined, markOld2)
    const workOld = `verify-work-old-${randomUUID()}`
    const workOld2 = `verify-work-old2-${randomUUID()}`
    memory.append(workOld, markOld, '旧回答', `u:${userF}`)
    memory.append(workOld2, markOld2, '旧回答二', `u:${userF2}`)
    check(
      !!chat.getOwnedTranscript(old1.result.sessionId, `u:${userF}`)?.some((turn) => turn.content.includes(markOld))
        && !!chat.getOwnedTranscript(old2.result.sessionId, `u:${userF2}`)?.some((turn) => turn.content.includes(markOld2))
        && memory.read(workOld).some((turn) => turn.content.includes(markOld))
        && memory.read(workOld2).some((turn) => turn.content.includes(markOld2)),
      '场景 6 阳性：清扫前两段小青对话和两段作业问答都在',
    )
    const keptChat = chat.sweep(Date.now() + 1000)
    const keptQa = memory.sweep(Date.now() + 1000)
    check(keptChat === 0 && keptQa === 0 && !!chat.getOwnedTranscript(old1.result.sessionId, `u:${userF}`) && memory.read(workOld).length > 0, '场景 6 阳性：只过 1 秒、没有人再调用，清扫不会把刚写上的会话丢掉')
    const sweptChat = chat.sweep(Date.now() + 31 * 60 * 1000)
    const sweptQa = memory.sweep(Date.now() + 31 * 60 * 1000)
    check(
      sweptChat >= 1 && sweptQa >= 1
        && chat.getOwnedTranscript(old1.result.sessionId, `u:${userF}`) === null
        && chat.getOwnedTranscript(old2.result.sessionId, `u:${userF2}`) === null
        && memory.read(workOld).length === 0
        && memory.read(workOld2).length === 0,
      '场景 6：拨过 30 分钟后跑一次清扫，没有任何人再调用，这几段会话已经不在',
    )
    const markFresh = textMark('清扫之后新写的原话')
    const fresh = await chatTurn(`u:${userF}`, undefined, markFresh)
    const workFresh = `verify-work-fresh-${randomUUID()}`
    memory.append(workFresh, markFresh, '新回答', `u:${userF}`)
    chat.sweep(Date.now() + 1000)
    memory.sweep(Date.now() + 1000)
    check(
      !!chat.getOwnedTranscript(fresh.result.sessionId, `u:${userF}`)?.some((turn) => turn.content.includes(markFresh))
        && memory.read(workFresh).some((turn) => turn.content.includes(markFresh)),
      '场景 6 阳性：清扫之后新写的会话，再扫 1 秒仍然在',
    )

    // ── 场景 7 ────────────────────────────────────────────────────────────
    const forgetHandler = advisorControllerSrc.slice(advisorControllerSrc.indexOf("@Post('sessions/:sessionId/forget')"))
    check(forgetHandler.includes('@AiUseExempt(') && !/@AiUse\(/.test(forgetHandler) && !/publicQuota|\.consume\(|aiLog/.test(forgetHandler), '场景 7：作业清场不扣次数、不算 AI 调用、不进 AI 闸门')
    const anonToken = `tok-${randomUUID()}`
    const otherToken = `tok-${randomUUID()}`
    const workAnon = `verify-work-fa-${randomUUID()}`
    const workOther = `verify-work-fb-${randomUUID()}`
    const workMember = `verify-work-fm-${randomUUID()}`
    async function createAnon(id: string, token: string): Promise<void> {
      await prisma!.advisorSession.create({
        data: { id, accessTokenHash: createHash('sha256').update(token, 'utf8').digest('hex'), topic: '顾问作业', skill: 'qa', expiresAt: future },
      })
    }
    await createAnon(workAnon, anonToken)
    await createAnon(workOther, otherToken)
    await createQa(userF, workMember, `verify-art-fm-${randomUUID()}`)
    const qAnon = textMark('匿名清场原话')
    const qOther = textMark('旁路作业原话')
    const qMember = textMark('会员清场原话')
    await advisor.ask(workAnon, qAnon, { endUserId: null, accessToken: anonToken })
    await advisor.ask(workOther, qOther, { endUserId: null, accessToken: otherToken })
    await advisor.ask(workMember, qMember, { endUserId: userF, accessToken: null })
    check(memory.read(workAnon).some((turn) => turn.content.includes(qAnon)), '场景 7 阳性：清场前，匿名作业的问答内存里有这一轮原话')
    const advisorController = new AdvisorController(advisor, jwt, redis as never, prisma)
    const anonReq = (token: string) => ({ headers: { 'x-advisor-access-token': token } })
    const wrong = await advisorController.forget(workAnon, anonReq(`bad-${randomUUID()}`))
    const stolenMember = await advisorController.forget(workAnon, { headers: { authorization: `Bearer ${bearer(userF2)}` } })
    check(wrong.forgotten === 0 && stolenMember.forgotten === 0 && memory.read(workAnon).some((turn) => turn.content.includes(qAnon)), '场景 7：错的令牌或别的会员来清 → forgotten:0，那条内存还在')
    const cleared = await advisorController.forget(workAnon, anonReq(anonToken))
    check(cleared.forgotten === 1 && memory.read(workAnon).length === 0, `场景 7：正确令牌清匿名作业 → forgotten:1，内存没了（实际 ${cleared.forgotten}）`)
    const again = await advisorController.forget(workAnon, anonReq(anonToken))
    check(again.forgotten === 0, `场景 7：再清一次 → forgotten:0（实际 ${again.forgotten}）`)
    check(memory.read(workOther).some((turn) => turn.content.includes(qOther)), '场景 7：另一个作业的内存不受影响')
    const memberCleared = await advisorController.forget(workMember, { headers: { authorization: `Bearer ${bearer(userF)}` } })
    check(memberCleared.forgotten === 1 && memory.read(workMember).length === 0, `场景 7：会员本人来清 → forgotten:1（实际 ${memberCleared.forgotten}）`)
    check(!!await prisma.advisorSession.findUnique({ where: { id: workAnon } }) && !!await prisma.advisorSession.findUnique({ where: { id: workMember } }), '场景 7：作业还在，只清了内存')
    const realDelegate = prisma.advisorSession
    let dbStatus = 0
    Object.defineProperty(prisma, 'advisorSession', { configurable: true, get: () => new Proxy(realDelegate, { get(target, prop, receiver) {
      if (prop === 'findUnique') return () => Promise.reject(new Error('database unavailable'))
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    } }) })
    try {
      await advisorController.forget(workOther, anonReq(otherToken))
      dbStatus = 200
    } catch { dbStatus = 500 } finally { delete (prisma as { advisorSession?: unknown }).advisorSession }
    check(dbStatus === 500 && memory.read(workOther).some((turn) => turn.content.includes(qOther)), '场景 7：数据库不可用时不回 forgotten:0，错误照常抛出，另一个作业还在')

    // ── 场景 8：在途回复不得把已忘掉的会话写回 ─────────────────
    async function waitUntil(ready: () => boolean, label: string): Promise<void> {
      const started = Date.now()
      while (!ready()) {
        if (Date.now() - started > 3_000) throw new Error(`超时：${label}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    const userHang = `verify-hang-${randomUUID()}`
    await createUser(userHang)
    const ownerHang = `u:${userHang}`
    const markHang = textMark('在途聊天原话')
    const seededChat = await chatTurn(ownerHang, undefined, textMark('在途聊天上一轮'))
    let releaseChat!: () => void
    llmGate.pending = new Promise((resolve) => { releaseChat = resolve })
    const chatBefore = sent.length
    const chatPending = chat.chat({ message: markHang, channel: 'kiosk', sessionId: seededChat.result.sessionId } as never, undefined, ownerHang)
    try {
      await waitUntil(() => sent.length > chatBefore, '小青假模型挂起')
      const removedChat = chat.forgetSession(seededChat.result.sessionId, ownerHang)
      const goneNow = chat.getOwnedTranscript(seededChat.result.sessionId, ownerHang)
      check(removedChat === true && goneNow === null, '场景 8 阳性：挂起期间忘掉小青会话，当场读是空的')
      releaseChat()
      llmGate.pending = null
      const chatResult = await chatPending
      const afterChat = chat.getOwnedTranscript(seededChat.result.sessionId, ownerHang)
      const restored = JSON.stringify(afterChat ?? '')
      check(
        typeof chatResult.reply === 'string' && chatResult.reply.length > 0
          && afterChat === null
          && !restored.includes(markHang),
        '场景 8：放行后回复仍返回，内存里没有这段小青对话',
      )
    } finally {
      releaseChat()
      llmGate.pending = null
    }

    const workHang = `verify-work-hang-${randomUUID()}`
    await createQa(userHang, workHang, `verify-art-hang-${randomUUID()}`)
    const markQa = textMark('在途作业原话')
    await advisor.ask(workHang, textMark('在途作业上一轮'), { endUserId: userHang, accessToken: null })
    let releaseQa!: () => void
    let qaEntered!: () => void
    const qaEnteredPromise = new Promise<void>((resolve) => { qaEntered = resolve })
    modelGate.entered = qaEntered
    modelGate.wait = () => new Promise((resolve) => { releaseQa = resolve })
    const qaPending = advisor.ask(workHang, markQa, { endUserId: userHang, accessToken: null })
    try {
      await qaEnteredPromise
      const removedQa = await advisor.forgetSession(workHang, { endUserId: userHang, accessToken: null })
      check(removedQa.forgotten === 1 && memory.read(workHang).length === 0, '场景 8 阳性：挂起期间忘掉作业，当场读是空的')
      releaseQa()
      const qaResult = await qaPending
      const left = memory.read(workHang).map((turn) => turn.content).join('\n')
      check(
        typeof qaResult.answer === 'string' && qaResult.answer.length > 0
          && !left.includes(markQa),
        '场景 8：放行后作业回答仍返回，内存里没有这段作业对话',
      )
    } finally {
      releaseQa?.()
      modelGate.wait = async () => undefined
      modelGate.entered = () => undefined
    }

    // ── 场景 9：身份查询出错不得装作已清 0 ─────────────────────
    async function callForget(run: () => Promise<{ forgotten: number }>): Promise<{ status: number; forgotten: number | null }> {
      try {
        const body = await run()
        return { status: 200, forgotten: body.forgotten }
      } catch (error) {
        return { status: error instanceof HttpException ? error.getStatus() : -1, forgotten: null }
      }
    }
    function notPretendCleared(result: { status: number; forgotten: number | null }): boolean {
      return !(result.status === 200 && result.forgotten === 0)
    }
    const userId9 = `verify-id-${randomUUID()}`
    await createUser(userId9)
    const markChat9 = textMark('身份故障聊天原话')
    const chat9 = await chatTurn(`u:${userId9}`, undefined, markChat9)
    const work9 = `verify-work-id-${randomUUID()}`
    await createQa(userId9, work9, `verify-art-id-${randomUUID()}`)
    const markQa9 = textMark('身份故障作业原话')
    await advisor.ask(work9, markQa9, { endUserId: userId9, accessToken: null })
    const memberToken9 = bearer(userId9)
    const memberReq9 = { headers: { authorization: `Bearer ${memberToken9}` }, ip: '10.9.9.9' }
    function memoriesCleared(): boolean {
      const transcript = chat.getOwnedTranscript(chat9.result.sessionId, `u:${userId9}`)
      return !transcript?.some((turn) => turn.content.includes(markChat9))
        && !memory.read(work9).some((turn) => turn.content.includes(markQa9))
    }
    const originalRedisGet = redis.get
    redis.get = async () => {
      throw new Error('redis down')
    }
    try {
      const loose = await resolveOptionalEndUser(`Bearer ${memberToken9}`, jwt, redis as never, prisma)
      check(loose === null, '场景 9 阳性：不带严格模式时，Redis 故障仍当游客，其它接口口径不变')
      resetRedisCooldownForTests()
      const assistantRedis = await callForget(async () => controller.forget(
        await pipe.transform({ sessionIds: [chat9.result.sessionId] }, { type: 'body', metatype: AssistantSessionsForgetDto }) as AssistantSessionsForgetDto,
        memberReq9,
      ))
      check(notPretendCleared(assistantRedis), `场景 9：小青清场在 Redis 故障时不回 200/0（实际 ${assistantRedis.status}/${String(assistantRedis.forgotten)}）`)
      resetRedisCooldownForTests()
      const advisorRedis = await callForget(() => advisorController.forget(work9, memberReq9))
      check(notPretendCleared(advisorRedis), `场景 9：作业清场在 Redis 故障时不回 200/0（实际 ${advisorRedis.status}/${String(advisorRedis.forgotten)}）`)
    } finally {
      redis.get = originalRedisGet
      resetRedisCooldownForTests()
    }
    const realEndUser = prisma.endUser
    Object.defineProperty(prisma, 'endUser', {
      configurable: true,
      get: () => new Proxy(realEndUser, {
        get(target, prop, receiver) {
          if (prop === 'findUnique') return () => Promise.reject(new Error('database unavailable'))
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }),
    })
    try {
      const assistantDb = await callForget(async () => controller.forget(
        await pipe.transform({ sessionIds: [chat9.result.sessionId] }, { type: 'body', metatype: AssistantSessionsForgetDto }) as AssistantSessionsForgetDto,
        memberReq9,
      ))
      check(notPretendCleared(assistantDb), `场景 9：小青清场在会员库故障时不回 200/0（实际 ${assistantDb.status}/${String(assistantDb.forgotten)}）`)
      const advisorDb = await callForget(() => advisorController.forget(work9, memberReq9))
      check(notPretendCleared(advisorDb), `场景 9：作业清场在会员库故障时不回 200/0（实际 ${advisorDb.status}/${String(advisorDb.forgotten)}）`)
    } finally {
      delete (prisma as { endUser?: unknown }).endUser
    }
    const workRow9 = await prisma.advisorSession.findUnique({ where: { id: work9 } })
    check(memoriesCleared() && !!workRow9, '场景 9：身份查询失败时先清掉这两段内存，作业行还在库里')

    // ── 场景 10：两种凭据都在时，游客作业也清，但不能清别人的 ──
    const userBoth = `verify-both-${randomUUID()}`
    await createUser(userBoth)
    const tokenMine = `tok-${randomUUID()}`
    const tokenOther = `tok-${randomUUID()}`
    const workGuest = `verify-work-both-${randomUUID()}`
    const workStranger = `verify-work-stranger-${randomUUID()}`
    const workMemberBoth = `verify-work-both-member-${randomUUID()}`
    await createAnon(workGuest, tokenMine)
    await createAnon(workStranger, tokenOther)
    await createQa(userBoth, workMemberBoth, `verify-art-both-${randomUUID()}`)
    const markGuest = textMark('双头游客原话')
    const markStranger = textMark('别人游客原话')
    const markMemberBoth = textMark('双头会员原话')
    await advisor.ask(workGuest, markGuest, { endUserId: null, accessToken: tokenMine })
    await advisor.ask(workStranger, markStranger, { endUserId: null, accessToken: tokenOther })
    await advisor.ask(workMemberBoth, markMemberBoth, { endUserId: userBoth, accessToken: null })
    const memberBearer = bearer(userBoth)
    const dual = (guestToken: string) => ({
      headers: {
        authorization: `Bearer ${memberBearer}`,
        'x-advisor-access-token': guestToken,
      },
    })
    const swapped = await advisorController.forget(workGuest, dual(tokenOther))
    check(
      swapped.forgotten === 0 && memory.read(workGuest).some((turn) => turn.content.includes(markGuest)),
      `场景 10：双头里的游客令牌对不上这个作业 → forgotten:0（实际 ${swapped.forgotten}）`,
    )
    const notStranger = await advisorController.forget(workStranger, dual(tokenMine))
    check(
      notStranger.forgotten === 0 && memory.read(workStranger).some((turn) => turn.content.includes(markStranger)),
      '场景 10：双头里游客令牌换成别人的，别人的作业不被清',
    )
    const clearedGuest = await advisorController.forget(workGuest, dual(tokenMine))
    check(
      clearedGuest.forgotten === 1 && memory.read(workGuest).length === 0,
      `场景 10：会员和游客令牌一起带上时，这个游客作业被清掉（实际 ${clearedGuest.forgotten}）`,
    )
    const clearedMember = await advisorController.forget(workMemberBoth, dual(tokenOther))
    check(
      clearedMember.forgotten === 1 && memory.read(workMemberBoth).length === 0,
      `场景 10：两种凭据都在时，会员自己的作业也清掉（实际 ${clearedMember.forgotten}）`,
    )
    check(
      memory.read(workStranger).some((turn) => turn.content.includes(markStranger)),
      '场景 10 阳性：清完自己的之后，别人的游客作业还在',
    )

    // ── 场景 11：Redis 注销失败也要清本进程两块内存 ───────────
    const userRevoke = `verify-revoke-${randomUUID()}`
    const userRevokeKeep = `verify-revoke-keep-${randomUUID()}`
    await createUser(userRevoke)
    await createUser(userRevokeKeep)
    const markRevokeChat = textMark('注销失败聊天原话')
    const markKeepChat = textMark('注销失败旁路聊天')
    const revokeChat = await chatTurn(`u:${userRevoke}`, undefined, markRevokeChat)
    const keepChat = await chatTurn(`u:${userRevokeKeep}`, undefined, markKeepChat)
    const workRevoke = `verify-work-revoke-${randomUUID()}`
    const workRevokeKeep = `verify-work-revoke-keep-${randomUUID()}`
    await createQa(userRevoke, workRevoke, `verify-art-revoke-${randomUUID()}`)
    await createQa(userRevokeKeep, workRevokeKeep, `verify-art-revoke-keep-${randomUUID()}`)
    const markRevokeQa = textMark('注销失败作业原话')
    const markKeepQa = textMark('注销失败旁路作业')
    await advisor.ask(workRevoke, markRevokeQa, { endUserId: userRevoke, accessToken: null })
    await advisor.ask(workRevokeKeep, markKeepQa, { endUserId: userRevokeKeep, accessToken: null })
    const originalUnregister = redis.unregisterMemberSession
    redis.unregisterMemberSession = async () => {
      throw new Error('redis revoke failed')
    }
    let revokeError: unknown = null
    try {
      await auth.logout(userRevoke, randomUUID())
    } catch (error) {
      revokeError = error
    } finally {
      redis.unregisterMemberSession = originalUnregister
    }
    check(
      revokeError instanceof Error
        && chat.getOwnedTranscript(revokeChat.result.sessionId, `u:${userRevoke}`) === null
        && memory.read(workRevoke).length === 0,
      '场景 11：注销抛错之后，他名下的小青对话和作业问答都空了，登出仍失败',
    )
    check(
      !!chat.getOwnedTranscript(keepChat.result.sessionId, `u:${userRevokeKeep}`)?.some((turn) => turn.content.includes(markKeepChat))
        && memory.read(workRevokeKeep).some((turn) => turn.content.includes(markKeepQa)),
      '场景 11 阳性：另一个会员的两块内存不受这次注销失败影响',
    )

    // ── 场景 12：清当前作业不许连带清同会员的另一个作业 ───────
    const userScope = `verify-scope-${randomUUID()}`
    await createUser(userScope)
    const workScopeA = `verify-work-scope-a-${randomUUID()}`
    const workScopeB = `verify-work-scope-b-${randomUUID()}`
    await createQa(userScope, workScopeA, `verify-art-scope-a-${randomUUID()}`)
    await createQa(userScope, workScopeB, `verify-art-scope-b-${randomUUID()}`)
    const markScopeA = textMark('当前作业原话')
    const markScopeB = textMark('同会员另一作业原话')
    await advisor.ask(workScopeA, markScopeA, { endUserId: userScope, accessToken: null })
    await advisor.ask(workScopeB, markScopeB, { endUserId: userScope, accessToken: null })
    check(
      memory.read(workScopeA).some((turn) => turn.content.includes(markScopeA))
        && memory.read(workScopeB).some((turn) => turn.content.includes(markScopeB)),
      '场景 12 阳性：清之前，同一会员的两个作业都有原话',
    )
    const scopeCleared = await advisor.forgetSession(workScopeA, { endUserId: userScope, accessToken: null })
    check(
      scopeCleared.forgotten === 1
        && memory.read(workScopeA).length === 0
        && memory.read(workScopeB).some((turn) => turn.content.includes(markScopeB)),
      '场景 12：清当前作业不清同会员的另一个作业',
    )

    const inflightCtx = {
      check,
      textMark,
      chat,
      memory,
      advisor,
      auth,
      assets,
      controller,
      advisorController,
      redis,
      prisma,
      jwt,
      createUser,
      createQa,
      bearer,
      modelGate,
    }
    await runInflightForgetScenarios(inflightCtx)
    await runGuestLoginLogoutScenarios(inflightCtx)

    console.log(`\nverify:conversation-memory-forget ${failCount === 0 ? '通过' : '未通过'}：PASS ${passCount} / FAIL ${failCount}`)
    if (failCount > 0) process.exitCode = 1
  } finally {
    ;(globalThis as { fetch: typeof fetch }).fetch = savedFetch
    if (app) await app.close()
    if (prisma) await prisma.onModuleDestroy()
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
