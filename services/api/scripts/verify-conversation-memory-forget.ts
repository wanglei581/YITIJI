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
import { BadRequestException, Module, NotFoundException, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AssistantSessionForgetController } from '../src/ai/assistant-session-forget.controller'
import { AssistantSessionsForgetDto } from '../src/ai/dto/assistant-sessions-forget.dto'
import { AiLogService } from '../src/ai/ai-log.service'
import { LlmChatService, assistantOwnerKey } from '../src/ai/llm/llm-chat.service'
import { AdvisorController } from '../src/advisor/advisor.controller'
import { AdvisorQaMemory } from '../src/advisor/advisor-qa-memory'
import { AdvisorArtifactService } from '../src/advisor/advisor-artifact.service'
import { AdvisorService } from '../src/advisor/advisor.service'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { AuditService } from '../src/audit/audit.service'
import { ConversationMemoryBridge } from '../src/common/conversation-memory-bridge'
import { ConversationMemoryModule } from '../src/common/conversation-memory.module'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { MemberAuthService } from '../src/member-auth/member-auth.service'
import { SMS_SENDER } from '../src/member-auth/sms/sms-sender'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

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
          answer: async (question: string) => ({ answer: `答：${question}`, evidenceLevel: 'E3', sourceNote: '参考' }),
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
    const markA = `甲会员上一轮原话${randomUUID()}`
    const markB = `乙会员上一轮原话${randomUUID()}`
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
    const markS = `要点原话${randomUUID()}`
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
    const questionQ = `作业甲的原话${randomUUID()}`
    const questionQ2 = `作业乙的原话${randomUUID()}`
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
    const markL = `登出前原话${randomUUID()}`
    const markL2 = `另一个会员的原话${randomUUID()}`
    const loggedIn = await chatTurn(`u:${userL}`, undefined, markL)
    const otherMember = await chatTurn(`u:${userL2}`, undefined, markL2)
    const workL = `verify-work-l-${randomUUID()}`
    const workL2 = `verify-work-l2-${randomUUID()}`
    const anonWork = `verify-work-anon-${randomUUID()}`
    await createQa(userL, workL, `verify-art-l-${randomUUID()}`)
    await createQa(userL2, workL2, `verify-art-l2-${randomUUID()}`)
    const questionL = `登出前作业原话${randomUUID()}`
    const questionL2 = `另一个会员作业原话${randomUUID()}`
    const questionAnon = `匿名作业原话${randomUUID()}`
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
    const markF = `清场前原话${randomUUID()}`
    const markF2 = `别人的清场原话${randomUUID()}`
    const mine = await chatTurn(`u:${userF}`, undefined, markF)
    const continued = await chatTurn(`u:${userF}`, mine.result.sessionId, '清场前接着问')
    check(userText(continued.body).includes(markF), '场景 5 阳性：清自己的会话之前，续聊请求里带着原话')
    const theirs = await chatTurn(`u:${userF2}`, undefined, markF2)
    const ipMine = '10.8.1.1'
    const ipOther = '10.8.1.2'
    const markIp = `来源地址甲的原话${randomUUID()}`
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
    const markOld = `三十一分钟前的原话${randomUUID()}`
    const markOld2 = `另一段三十一分钟前的原话${randomUUID()}`
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
    const markFresh = `清扫之后新写的原话${randomUUID()}`
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
    const qAnon = `匿名清场原话${randomUUID()}`
    const qOther = `旁路作业原话${randomUUID()}`
    const qMember = `会员清场原话${randomUUID()}`
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
