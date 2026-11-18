/**
 * 在途请求的清场补洞。挂在 verify-conversation-memory-forget 末尾。
 *
 * A 首次追问还没进内存时登出（Redis 成功 / 失败）；首次小青在途、内存里还没有这条时清场。
 *   归属查询回执挂起时删记录或登出、政策查询挂起时登出，放行后都不把原话写回。
 * B 容量淘汰本身作废在途回复；淘汰之后再登出 / forgetOwner 也不写回。
 * C 代次表挤满后，挤掉之前抓住的代次不能再对上；没被清、也没被挤掉的仍能对上。
 *   三个方法同样去掉会话号两端空白。同一条被挤掉后，新抓住的代次能对上，旧的不能。
 * D 两个清场接口在身份查询 503 时，只清这个令牌自己的内存并作废在途，作业行仍在库里。
 *   别人的会话号即使写在请求里也不动。
 * 同会话并发时，被拦的那一条按消息本身删除，不把后到的正常问题弹掉。
 */
import { randomUUID } from 'node:crypto'
import { HttpException, ValidationPipe } from '@nestjs/common'
import type { JwtService } from '@nestjs/jwt'
import { AssistantSessionForgetController } from '../src/ai/assistant-session-forget.controller'
import { AssistantSessionsForgetDto } from '../src/ai/dto/assistant-sessions-forget.dto'
import { LlmChatService, MAX_ASSISTANT_SESSIONS_PER_OWNER } from '../src/ai/llm/llm-chat.service'
import { AdvisorController } from '../src/advisor/advisor.controller'
import { AdvisorQaMemory } from '../src/advisor/advisor-qa-memory'
import { AdvisorService } from '../src/advisor/advisor.service'
import { CONVERSATION_EPOCH_TOMBSTONE_TTL_MS, ConversationEpoch } from '../src/common/conversation-epoch'
import { resetRedisCooldownForTests } from '../src/common/redis/redis-degradation'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { MemberAuthService } from '../src/member-auth/member-auth.service'
import type { PrismaService } from '../src/prisma/prisma.service'

interface ModelGate {
  wait: () => Promise<void>
  entered: () => void
}

interface RedisStub {
  get: (key: string) => Promise<string | null> | string | null
  unregisterMemberSession: (endUserId: string, sessionId: string) => Promise<void>
}

interface ChatSession {
  ownerKey: string
  messages: Array<{ role: string; content: string }>
}

export interface InflightForgetContext {
  check: (ok: boolean, msg: string) => void
  textMark: (label: string) => string
  chat: LlmChatService
  memory: AdvisorQaMemory
  advisor: AdvisorService
  auth: MemberAuthService
  assets: MemberAssetsService
  controller: AssistantSessionForgetController
  advisorController: AdvisorController
  redis: RedisStub
  prisma: PrismaService
  jwt: JwtService
  createUser: (id: string) => Promise<void>
  createQa: (userId: string, sessionId: string, artifactId: string) => Promise<void>
  bearer: (userId: string) => string
  modelGate: ModelGate
}

interface ForgetResult { status: number; code: string; forgotten: number | null }
interface HungChat {
  pending: Promise<{ reply: string; sessionId: string }>
  entered: Promise<void>
  release: () => void
}
interface HungAsk {
  pending: Promise<{ answer: string }>
  entered: Promise<void>
  release: () => void
}

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })

function sessionsOf(chat: LlmChatService): Map<string, ChatSession> {
  return (chat as unknown as { sessions: Map<string, ChatSession> }).sessions
}

function transcriptOf(chat: LlmChatService, sessionId: string, owner: string): string {
  return (chat.getOwnedTranscript(sessionId, owner) ?? []).map((turn) => turn.content).join('\n')
}

function qaText(memory: AdvisorQaMemory, sessionId: string): string {
  return memory.read(sessionId).map((turn) => turn.content).join('\n')
}

function findChat(chat: LlmChatService, owner: string, mark: string): string | undefined {
  for (const [id, session] of sessionsOf(chat)) {
    if (session.ownerKey === owner && session.messages.some((message) => message.content.includes(mark))) return id
  }
  return undefined
}

async function waitFor(ready: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`超时：${label}`)), 3_000)
  })
  try {
    await Promise.race([ready, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function forgetBody(sessionIds: string[]): Promise<AssistantSessionsForgetDto> {
  return await pipe.transform(
    { sessionIds },
    { type: 'body', metatype: AssistantSessionsForgetDto },
  ) as AssistantSessionsForgetDto
}

async function callForget(run: () => Promise<{ forgotten: number }>): Promise<ForgetResult> {
  try {
    const body = await run()
    return { status: 200, code: '', forgotten: body.forgotten }
  } catch (error) {
    let code = ''
    if (error instanceof HttpException) {
      const body = error.getResponse() as { error?: { code?: string } }
      code = typeof body.error?.code === 'string' ? body.error.code : ''
    }
    return { status: error instanceof HttpException ? error.getStatus() : -1, code, forgotten: null }
  }
}

/** 只挂住含 mark 的那一次模型请求。其它对话走同一个替身，立刻返回。 */
function hangChat(chat: LlmChatService, owner: string, mark: string, sessionId?: string): HungChat {
  const previous = globalThis.fetch
  let releaseGate: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { releaseGate = resolve })
  let markEntered: () => void = () => undefined
  const entered = new Promise<void>((resolve) => { markEntered = resolve })
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role: string; content: string }> }
    const text = (body.messages ?? []).filter((message) => message.role === 'user').map((message) => message.content).join('\n')
    if (text.includes(mark)) {
      markEntered()
      await gate
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '模型的回答' } }] }),
    } as Response
  }) as typeof fetch
  const pending = chat.chat(
    { message: mark, channel: 'kiosk', sessionId } as never,
    undefined,
    owner,
  ) as Promise<{ reply: string; sessionId: string }>
  return {
    pending,
    entered,
    release() {
      releaseGate()
      globalThis.fetch = previous
    },
  }
}

function hangAsk(
  gate: ModelGate,
  advisor: AdvisorService,
  sessionId: string,
  question: string,
  requester: { endUserId: string | null; accessToken: string | null },
): HungAsk {
  const previousWait = gate.wait
  const previousEntered = gate.entered
  let releaseGate: () => void = () => undefined
  let markEntered: () => void = () => undefined
  const entered = new Promise<void>((resolve) => { markEntered = resolve })
  gate.entered = () => markEntered()
  gate.wait = () => new Promise<void>((resolve) => { releaseGate = resolve })
  const pending = advisor.ask(sessionId, question, requester) as Promise<{ answer: string }>
  return {
    pending,
    entered,
    release() {
      releaseGate()
      gate.wait = previousWait
      gate.entered = previousEntered
    },
  }
}

async function fillUntilEvicted(chat: LlmChatService, sessionId: string, owner: string): Promise<void> {
  for (let n = 0; n < MAX_ASSISTANT_SESSIONS_PER_OWNER + 2 && chat.getOwnedTranscript(sessionId, owner); n += 1) {
    await chat.chat({ message: `填满归属${n}`, channel: 'kiosk' } as never, undefined, owner)
  }
}

/** 查询已经取到行，回执交还之前挂起。删记录或登出发生在这一段，才对得上「先等查询、后登记」的窗口。 */
function hangAdvisorReceipt(prisma: PrismaService, sessionId: string): HungAsk & { restore: () => void } {
  const delegate = prisma.advisorSession as unknown as {
    findUnique: (args: { where?: { id?: string } }) => Promise<unknown>
  }
  const original = delegate.findUnique.bind(delegate)
  let releaseGate: () => void = () => undefined
  let markEntered: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { releaseGate = resolve })
  const entered = new Promise<void>((resolve) => { markEntered = resolve })
  let armed = true
  delegate.findUnique = async (args) => {
    const row = await original(args)
    if (armed && args?.where?.id === sessionId) {
      armed = false
      markEntered()
      await gate
    }
    return row
  }
  return {
    pending: Promise.resolve({ answer: '' }),
    entered,
    release: () => releaseGate(),
    restore() { delegate.findUnique = original },
  }
}

/** 政策查询是聊天的第一次 await。挂起发生在进模型之前。 */
function hangPolicyRead(chat: LlmChatService, owner: string, mark: string): HungChat & { restore: () => void } {
  const target = chat as unknown as { policyContext?: { read: (policyId: string) => Promise<string | null> } }
  const previous = target.policyContext
  let releaseGate: () => void = () => undefined
  let markEntered: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { releaseGate = resolve })
  const entered = new Promise<void>((resolve) => { markEntered = resolve })
  target.policyContext = {
    read: async () => {
      markEntered()
      await gate
      return '政策原文'
    },
  }
  const pending = chat.chat(
    { message: mark, channel: 'kiosk', policyId: 'policy-hang' } as never,
    undefined,
    owner,
  ) as Promise<{ reply: string; sessionId: string }>
  return {
    pending,
    entered,
    release() { releaseGate() },
    restore() { target.policyContext = previous },
  }
}

function emptyShellId(chat: LlmChatService, owner: string): string | undefined {
  for (const [id, session] of sessionsOf(chat)) {
    if (session.ownerKey === owner && session.messages.length === 0) return id
  }
  return undefined
}

function ownerHasMark(chat: LlmChatService, owner: string, mark: string): boolean {
  for (const session of sessionsOf(chat).values()) {
    if (session.ownerKey === owner && session.messages.some((message) => message.content.includes(mark))) return true
  }
  return false
}

function runEpochCases(check: InflightForgetContext['check']): void {
  const epoch = new ConversationEpoch(2)
  const captured = epoch.capture('target-job')
  epoch.invalidate('target-job')
  epoch.invalidate('filler-a')
  epoch.invalidate('filler-b')
  check(!epoch.matches('target-job', captured), '场景 C：代次表挤掉这条之后，挤掉之前抓住的代次不能再写回')
  const renewed = epoch.capture('target-job')
  check(
    renewed !== captured && epoch.matches('target-job', renewed) && !epoch.matches('target-job', captured),
    '场景 C：同一条被挤掉之后，新抓住的代次能写回，挤掉前抓住的不能',
  )
  const fresh = epoch.capture('fresh-job')
  check(epoch.matches('fresh-job', fresh), '场景 C 阳性：挤掉之后新抓住的代次仍能写回')

  const room = new ConversationEpoch(4)
  const kept = room.capture('kept-job')
  room.invalidate('hot-job')
  room.invalidate('hot-job')
  room.invalidate('hot-job')
  const hotLatest = room.capture('hot-job')
  room.invalidate('other-a')
  room.invalidate('other-b')
  check(
    kept !== 0 && room.matches('kept-job', kept) && room.matches('hot-job', hotLatest),
    '场景 C 阳性：反复作废同一条时，这条的最新代次和没被清的会话都能写回',
  )
  check(
    room.matches('kept-job', kept),
    '场景 C：代次表还有空位时，没被清场也没被挤掉的会话，原先抓住的代次仍能写回',
  )
  const tight = new ConversationEpoch(2)
  tight.invalidate('hot-job')
  tight.invalidate('hot-job')
  tight.invalidate('hot-job')
  const hotEvicted = tight.capture('hot-job')
  tight.invalidate('other-a')
  tight.invalidate('other-b')
  check(!tight.matches('hot-job', hotEvicted), '场景 C：反复作废的那条被挤掉后，作废前抓住的代次不能再写回')

  const spaced = new ConversationEpoch()
  spaced.invalidate('job-1')
  const fromPadded = spaced.capture('  job-1  ')
  check(
    spaced.matches('job-1', fromPadded) && fromPadded !== 0,
    '场景 C：抓代次先去掉会话号两端空白，和作废用的是同一个号',
  )
  const plain = new ConversationEpoch()
  const before = plain.capture('job-2')
  plain.invalidate('  job-2  ')
  check(!plain.matches('job-2', before), '场景 C：作废时去掉两端空白，原先抓住的代次对不上')
  const again = plain.capture('job-2')
  check(!plain.matches('  job-2  ', before) && plain.matches('  job-2  ', again), '场景 C：核对代次时同样去掉两端空白')
}

export async function runInflightForgetScenarios(ctx: InflightForgetContext): Promise<void> {
  const {
    check, textMark, chat, memory, advisor, auth, assets, controller, advisorController,
    redis, prisma, createUser, createQa, bearer, modelGate,
  } = ctx
  runEpochCases(check)

  const userA = `verify-a-first-${randomUUID()}`
  await createUser(userA)
  const workA = `verify-work-a-first-${randomUUID()}`
  await createQa(userA, workA, `verify-art-a-first-${randomUUID()}`)
  const markA = textMark('首次追问原话')
  const hungA = hangAsk(modelGate, advisor, workA, markA, { endUserId: userA, accessToken: null })
  try {
    await waitFor(hungA.entered, '首次作业追问挂起')
    check(memory.read(workA).length === 0, '场景 A 阳性：首次追问还在路上，内存里还没有这条')
    await auth.logout(userA, randomUUID())
    hungA.release()
    const answered = await hungA.pending
    check(
      answered.answer.length > 0 && !qaText(memory, workA).includes(markA),
      '场景 A：首次追问在途时登出成功，放行后内存不写回原话，回答仍返回',
    )
  } finally {
    hungA.release()
  }

  const userA2 = `verify-a-fail-${randomUUID()}`
  await createUser(userA2)
  const workA2 = `verify-work-a-fail-${randomUUID()}`
  await createQa(userA2, workA2, `verify-art-a-fail-${randomUUID()}`)
  const markA2 = textMark('注销失败首次原话')
  const hungA2 = hangAsk(modelGate, advisor, workA2, markA2, { endUserId: userA2, accessToken: null })
  const originalUnregister = redis.unregisterMemberSession
  let logoutError: unknown = null
  try {
    await waitFor(hungA2.entered, '注销失败时的首次追问挂起')
    redis.unregisterMemberSession = async () => { throw new Error('redis revoke failed') }
    try {
      await auth.logout(userA2, randomUUID())
    } catch (error) {
      logoutError = error
    }
    hungA2.release()
    const answered = await hungA2.pending
    check(
      logoutError instanceof Error && answered.answer.length > 0 && !qaText(memory, workA2).includes(markA2),
      '场景 A：首次追问在途时 Redis 注销失败，登出仍失败，放行后内存不写回原话',
    )
  } finally {
    redis.unregisterMemberSession = originalUnregister
    hungA2.release()
  }

  const userKeep = `verify-a-keep-${randomUUID()}`
  await createUser(userKeep)
  const workKeep = `verify-work-a-keep-${randomUUID()}`
  await createQa(userKeep, workKeep, `verify-art-a-keep-${randomUUID()}`)
  const markKeep = textMark('旁路会员原话')
  await advisor.ask(workKeep, markKeep, { endUserId: userKeep, accessToken: null })
  check(qaText(memory, workKeep).includes(markKeep), '场景 A 阳性：旁路会员的作业原话还在')

  const userChat = `verify-a-chat-${randomUUID()}`
  await createUser(userChat)
  const ownerChat = `u:${userChat}`
  const markChat = textMark('首次小青原话')
  const hungChat = hangChat(chat, ownerChat, markChat)
  try {
    await waitFor(hungChat.entered, '首次小青挂起')
    const sessionId = findChat(chat, ownerChat, markChat)
    check(typeof sessionId === 'string' && sessionId.length === 32, '场景 A 阳性：首次小青已经在途，会话号已经铸出来')
    // 产品会先把空壳放进内存。拿掉之后，剩下的就是「还没写入，或刚被删掉但代次没升」的在途请求。
    if (sessionId) sessionsOf(chat).delete(sessionId)
    const forgotten = await controller.forget(
      await forgetBody(sessionId ? [sessionId] : ['0'.repeat(32)]),
      { headers: { authorization: `Bearer ${bearer(userChat)}` }, ip: '10.20.1.1' },
    )
    hungChat.release()
    const answered = await hungChat.pending
    const left = sessionId ? transcriptOf(chat, sessionId, ownerChat) : markChat
    check(
      forgotten.forgotten === 1 && answered.reply.length > 0 && !left.includes(markChat),
      `场景 A：首次小青在途且内存里还没有这条时清场，放行后不写回（forgotten ${forgotten.forgotten}）`,
    )
  } finally {
    hungChat.release()
  }

  const userB = `verify-b-chat-${randomUUID()}`
  await createUser(userB)
  const ownerB = `u:${userB}`
  const markB = textMark('淘汰小青原话')
  const hungB = hangChat(chat, ownerB, markB)
  try {
    await waitFor(hungB.entered, '待淘汰的小青挂起')
    const sessionId = findChat(chat, ownerB, markB) ?? ''
    check(sessionId.length === 32, '场景 B 阳性：挂起的小青会话在内存里')
    await fillUntilEvicted(chat, sessionId, ownerB)
    check(chat.getOwnedTranscript(sessionId, ownerB) === null, '场景 B 阳性：同会员再开满之后，挂起的那段被淘汰')
    hungB.release()
    const answered = await hungB.pending
    check(
      answered.reply.length > 0 && !transcriptOf(chat, sessionId, ownerB).includes(markB),
      '场景 B：小青被容量淘汰后直接放行，原会话号读不到原话，回答仍返回',
    )
  } finally {
    hungB.release()
  }

  const userB2 = `verify-b-logout-${randomUUID()}`
  await createUser(userB2)
  const ownerB2 = `u:${userB2}`
  const markB2 = textMark('淘汰后登出原话')
  const hungB2 = hangChat(chat, ownerB2, markB2)
  try {
    await waitFor(hungB2.entered, '淘汰后登出的小青挂起')
    const sessionId = findChat(chat, ownerB2, markB2) ?? ''
    await fillUntilEvicted(chat, sessionId, ownerB2)
    check(chat.getOwnedTranscript(sessionId, ownerB2) === null, '场景 B 阳性：登出前这段小青已经被淘汰')
    await auth.logout(userB2, randomUUID())
    hungB2.release()
    const answered = await hungB2.pending
    check(
      answered.reply.length > 0 && !transcriptOf(chat, sessionId, ownerB2).includes(markB2),
      '场景 B：小青淘汰后再登出，放行仍不写回原话',
    )
  } finally {
    hungB2.release()
  }

  const userQa = `verify-b-qa-${randomUUID()}`
  await createUser(userQa)
  const ownerQa = `u:${userQa}`
  const workB = `verify-work-b-${randomUUID()}`
  await createQa(userQa, workB, `verify-art-b-${randomUUID()}`)
  await advisor.ask(workB, textMark('作业上一轮'), { endUserId: userQa, accessToken: null })
  const markQa = textMark('淘汰作业原话')
  const hungQa = hangAsk(modelGate, advisor, workB, markQa, { endUserId: userQa, accessToken: null })
  try {
    await waitFor(hungQa.entered, '待淘汰的作业追问挂起')
    let flooded = 0
    while (memory.read(workB).length > 0 && flooded < 800) {
      memory.append(`${workB}-flood-${flooded}`, '问', '答', ownerQa)
      flooded += 1
    }
    check(memory.read(workB).length === 0 && flooded > 0, `场景 B 阳性：写满之后目标作业被淘汰（写了 ${flooded} 条）`)
    hungQa.release()
    const answered = await hungQa.pending
    check(
      answered.answer.length > 0 && !qaText(memory, workB).includes(markQa),
      '场景 B：作业被容量淘汰后直接放行，内存里没有这一问，回答仍返回',
    )
  } finally {
    hungQa.release()
  }

  const userQa2 = `verify-b-own-${randomUUID()}`
  await createUser(userQa2)
  const ownerQa2 = `u:${userQa2}`
  const workB2 = `verify-work-b2-${randomUUID()}`
  await createQa(userQa2, workB2, `verify-art-b2-${randomUUID()}`)
  await advisor.ask(workB2, textMark('作业再上一轮'), { endUserId: userQa2, accessToken: null })
  const markQa2 = textMark('淘汰后清归属原话')
  const hungQa2 = hangAsk(modelGate, advisor, workB2, markQa2, { endUserId: userQa2, accessToken: null })
  try {
    await waitFor(hungQa2.entered, '淘汰后清归属的作业挂起')
    let flooded = 0
    while (memory.read(workB2).length > 0 && flooded < 800) {
      memory.append(`${workB2}-flood-${flooded}`, '问', '答', ownerQa2)
      flooded += 1
    }
    check(memory.read(workB2).length === 0, '场景 B 阳性：forgetOwner 之前目标作业已经被淘汰')
    memory.forgetOwner(ownerQa2)
    hungQa2.release()
    const answered = await hungQa2.pending
    check(
      answered.answer.length > 0 && !qaText(memory, workB2).includes(markQa2),
      '场景 B：作业淘汰后再 forgetOwner，放行仍不写回原话',
    )
  } finally {
    hungQa2.release()
  }

  const userD = `verify-d-${randomUUID()}`
  await createUser(userD)
  const ownerD = `u:${userD}`
  const seeded = await chat.chat(
    { message: textMark('身份故障已有小青'), channel: 'kiosk' } as never,
    undefined,
    ownerD,
  ) as { sessionId: string }
  const markD = textMark('身份故障在途小青')
  const hungD = hangChat(chat, ownerD, markD, seeded.sessionId)
  const originalGet = redis.get
  try {
    await waitFor(hungD.entered, '身份故障时的小青挂起')
    check(transcriptOf(chat, seeded.sessionId, ownerD).length > 0, '场景 D 阳性：清场前小青原话在内存里')
    redis.get = async () => { throw new Error('redis down') }
    resetRedisCooldownForTests()
    const assistantFailed = await callForget(async () => controller.forget(
      await forgetBody([seeded.sessionId]),
      { headers: { authorization: `Bearer ${bearer(userD)}` }, ip: '10.20.2.2' },
    ))
    const clearedNow = transcriptOf(chat, seeded.sessionId, ownerD)
    hungD.release()
    const answered = await hungD.pending
    const left = transcriptOf(chat, seeded.sessionId, ownerD)
    check(
      assistantFailed.status === 503
        && assistantFailed.code === 'MEMBER_SESSION_STORE_UNAVAILABLE'
        && assistantFailed.forgotten === null
        && clearedNow.length === 0
        && answered.reply.length > 0
        && !left.includes(markD),
      `场景 D：小青清场身份查询失败时先清内存并作废在途，再回 503（实际 ${assistantFailed.status}/${assistantFailed.code}）`,
    )
  } finally {
    redis.get = originalGet
    resetRedisCooldownForTests()
    hungD.release()
  }

  const workD = `verify-work-d-${randomUUID()}`
  await createQa(userD, workD, `verify-art-d-${randomUUID()}`)
  await advisor.ask(workD, textMark('身份故障已有作业'), { endUserId: userD, accessToken: null })
  const markWork = textMark('身份故障在途作业')
  const hungWork = hangAsk(modelGate, advisor, workD, markWork, { endUserId: userD, accessToken: null })
  try {
    await waitFor(hungWork.entered, '身份故障时的作业追问挂起')
    check(qaText(memory, workD).length > 0, '场景 D 阳性：清场前作业原话在内存里')
    redis.get = async () => { throw new Error('redis down') }
    resetRedisCooldownForTests()
    const advisorFailed = await callForget(() => advisorController.forget(
      workD,
      { headers: { authorization: `Bearer ${bearer(userD)}` } },
    ))
    const clearedNow = qaText(memory, workD)
    const row = await prisma.advisorSession.findUnique({ where: { id: workD } })
    hungWork.release()
    const answered = await hungWork.pending
    check(
      advisorFailed.status === 503
        && advisorFailed.code === 'MEMBER_SESSION_STORE_UNAVAILABLE'
        && advisorFailed.forgotten === null
        && clearedNow.length === 0
        && !!row
        && answered.answer.length > 0
        && !qaText(memory, workD).includes(markWork),
      `场景 D：作业清场身份查询失败时只清内存并作废在途，不删库，再回 503（实际 ${advisorFailed.status}/${advisorFailed.code}）`,
    )
  } finally {
    redis.get = originalGet
    resetRedisCooldownForTests()
    hungWork.release()
  }

  const userReceipt = `verify-a-receipt-${randomUUID()}`
  await createUser(userReceipt)
  const workReceipt = `verify-work-a-receipt-${randomUUID()}`
  const artReceipt = `verify-art-a-receipt-${randomUUID()}`
  await createQa(userReceipt, workReceipt, artReceipt)
  const markReceipt = textMark('查询回执挂起删记录原话')
  const hungReceipt = hangAdvisorReceipt(prisma, workReceipt)
  const pendingReceipt = advisor.ask(workReceipt, markReceipt, { endUserId: userReceipt, accessToken: null }) as Promise<{ answer: string }>
  try {
    await waitFor(hungReceipt.entered, '作业归属查询回执挂起')
    check(memory.read(workReceipt).length === 0, '场景 A 阳性：查询回执挂起时，首次追问还没写入内存')
    await assets.deleteQaRecord(userReceipt, artReceipt)
    hungReceipt.release()
    const answered = await pendingReceipt
    const row = await prisma.advisorSession.findUnique({ where: { id: workReceipt } })
    check(
      answered.answer.length > 0 && row === null && !qaText(memory, workReceipt).includes(markReceipt),
      '场景 A：归属查询回执挂起时删记录，放行后库行仍无、内存不写回原话，回答仍返回',
    )
  } finally {
    hungReceipt.release()
    hungReceipt.restore()
  }

  const userReceiptOut = `verify-a-receipt-out-${randomUUID()}`
  await createUser(userReceiptOut)
  const workReceiptOut = `verify-work-a-receipt-out-${randomUUID()}`
  await createQa(userReceiptOut, workReceiptOut, `verify-art-a-receipt-out-${randomUUID()}`)
  const markReceiptOut = textMark('查询回执挂起登出原话')
  const hungReceiptOut = hangAdvisorReceipt(prisma, workReceiptOut)
  const pendingReceiptOut = advisor.ask(workReceiptOut, markReceiptOut, { endUserId: userReceiptOut, accessToken: null }) as Promise<{ answer: string }>
  try {
    await waitFor(hungReceiptOut.entered, '作业归属查询回执挂起后登出')
    await auth.logout(userReceiptOut, randomUUID())
    hungReceiptOut.release()
    const answered = await pendingReceiptOut
    check(
      answered.answer.length > 0 && !qaText(memory, workReceiptOut).includes(markReceiptOut),
      '场景 A：归属查询回执挂起时登出，放行后内存不写回原话，回答仍返回',
    )
  } finally {
    hungReceiptOut.release()
    hungReceiptOut.restore()
  }

  const userPolicy = `verify-a-policy-${randomUUID()}`
  await createUser(userPolicy)
  const ownerPolicy = `u:${userPolicy}`
  const markPolicy = textMark('政策查询挂起原话')
  const hungPolicy = hangPolicyRead(chat, ownerPolicy, markPolicy)
  try {
    await waitFor(hungPolicy.entered, '政策查询挂起')
    const sessionId = emptyShellId(chat, ownerPolicy)
    check(typeof sessionId === 'string' && sessionId.length === 32, '场景 A 阳性：政策查询还挂着，会话壳和在途登记已经在')
    await auth.logout(userPolicy, randomUUID())
    hungPolicy.release()
    const answered = await hungPolicy.pending
    const left = sessionId ? transcriptOf(chat, sessionId, ownerPolicy) : markPolicy
    check(
      answered.reply.length > 0 && !left.includes(markPolicy) && !ownerHasMark(chat, ownerPolicy, markPolicy),
      '场景 A：政策查询挂起时登出，放行后内存不写回原话，回答仍返回',
    )
  } finally {
    hungPolicy.release()
    hungPolicy.restore()
  }

  const victim = `verify-d-victim-${randomUUID()}`
  const attacker = `verify-d-attacker-${randomUUID()}`
  await createUser(victim)
  await createUser(attacker)
  const ownerVictim = `u:${victim}`
  const ownerAttacker = `u:${attacker}`
  const victimChat = await chat.chat(
    { message: textMark('受害者已有小青'), channel: 'kiosk' } as never,
    undefined,
    ownerVictim,
  ) as { sessionId: string }
  const attackerChat = await chat.chat(
    { message: textMark('攻击者已有小青'), channel: 'kiosk' } as never,
    undefined,
    ownerAttacker,
  ) as { sessionId: string }
  const attackerToken = bearer(attacker)
  const workVictim = `verify-work-d-victim-${randomUUID()}`
  const artVictim = `verify-art-d-victim-${randomUUID()}`
  await createQa(victim, workVictim, artVictim)
  const markVictimQa = textMark('受害者作业原话')
  await advisor.ask(workVictim, markVictimQa, { endUserId: victim, accessToken: null })
  const workAttacker = `verify-work-d-attacker-${randomUUID()}`
  await createQa(attacker, workAttacker, `verify-art-d-attacker-${randomUUID()}`)
  const markAttackerQa = textMark('攻击者作业原话')
  await advisor.ask(workAttacker, markAttackerQa, { endUserId: attacker, accessToken: null })
  const originalGetCross = redis.get
  try {
    redis.get = async () => { throw new Error('redis down') }
    resetRedisCooldownForTests()
    const crossChat = await callForget(async () => controller.forget(
      await forgetBody([victimChat.sessionId, attackerChat.sessionId]),
      { headers: { authorization: `Bearer ${attackerToken}` }, ip: '10.20.3.3' },
    ))
    const victimLeft = transcriptOf(chat, victimChat.sessionId, ownerVictim)
    const attackerLeft = transcriptOf(chat, attackerChat.sessionId, ownerAttacker)
    check(
      crossChat.status === 503
        && crossChat.code === 'MEMBER_SESSION_STORE_UNAVAILABLE'
        && crossChat.forgotten === null
        && victimLeft.includes('受害者已有小青')
        && attackerLeft.length === 0,
      `场景 D：身份查询失败时只清令牌本人的小青，请求里别人的会话号不动（实际 ${crossChat.status}/${crossChat.code}）`,
    )
    const crossAdvisor = await callForget(() => advisorController.forget(
      workVictim,
      { headers: { authorization: `Bearer ${attackerToken}` } },
    ))
    const victimRow = await prisma.advisorSession.findUnique({ where: { id: workVictim } })
    check(
      crossAdvisor.status === 503
        && crossAdvisor.code === 'MEMBER_SESSION_STORE_UNAVAILABLE'
        && qaText(memory, workVictim).includes(markVictimQa)
        && !!victimRow,
      `场景 D：身份查询失败时不按作业号清别人的问答，库行仍在（实际 ${crossAdvisor.status}/${crossAdvisor.code}）`,
    )
    const ownAdvisor = await callForget(() => advisorController.forget(
      workAttacker,
      { headers: { authorization: `Bearer ${attackerToken}` } },
    ))
    const attackerRow = await prisma.advisorSession.findUnique({ where: { id: workAttacker } })
    check(
      ownAdvisor.status === 503
        && !qaText(memory, workAttacker).includes(markAttackerQa)
        && !!attackerRow,
      '场景 D 阳性：同一个 503 仍清掉令牌本人的作业问答，并且不删库',
    )
  } finally {
    redis.get = originalGetCross
    resetRedisCooldownForTests()
  }

  const userRace = `verify-pop-${randomUUID()}`
  await createUser(userRace)
  const ownerRace = `u:${userRace}`
  const seedMark = textMark('并发前一轮')
  const seededRace = await chat.chat(
    { message: seedMark, channel: 'kiosk' } as never,
    undefined,
    ownerRace,
  ) as { sessionId: string }
  const cfg = (chat as unknown as {
    config: { getConfig: (feature: string) => { forbiddenWords: string[] } }
  }).config.getConfig('assistant_chat')
  const previousWords = cfg.forbiddenWords
  const previousFetch = globalThis.fetch
  cfg.forbiddenWords = ['禁词样例']
  let releaseFetch = (): void => undefined
  const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve })
  globalThis.fetch = (async () => {
    await fetchGate
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '模型的回答' } }] }),
    }
  }) as typeof fetch
  const normalMark = textMark('正常问题')
  try {
    const forbiddenPending = chat.chat(
      { message: `${textMark('被拦原话')}禁词样例`, channel: 'kiosk', sessionId: seededRace.sessionId } as never,
      undefined,
      ownerRace,
    ) as Promise<{ reply: string }>
    const normalPending = chat.chat(
      { message: normalMark, channel: 'kiosk', sessionId: seededRace.sessionId } as never,
      undefined,
      ownerRace,
    ) as Promise<{ reply: string }>
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    const mid = transcriptOf(chat, seededRace.sessionId, ownerRace)
    check(
      mid.includes(seedMark) && mid.includes(normalMark) && !mid.includes('禁词样例'),
      '同会话并发：被拦原话删掉时，后到的正常问题还在，被拦原话不留',
    )
    releaseFetch()
    const [forbiddenAnswer, normalAnswer] = await Promise.all([forbiddenPending, normalPending])
    const done = transcriptOf(chat, seededRace.sessionId, ownerRace)
    check(
      forbiddenAnswer.reply.length > 0
        && normalAnswer.reply.length > 0
        && done.includes(seedMark)
        && done.includes(normalMark)
        && !done.includes('禁词样例'),
      '同会话并发：两轮都返回之后，转写里仍是正常问题，没有被拦原话',
    )
  } finally {
    releaseFetch()
    cfg.forbiddenWords = previousWords
    globalThis.fetch = previousFetch
  }

  const userTtl = `verify-ttl-${randomUUID()}`
  await createUser(userTtl)
  const ownerTtl = `u:${userTtl}`
  const markTtl = textMark('查库挂起超过墓碑期限的原话')
  const hungTtl = hangPolicyRead(chat, ownerTtl, markTtl)
  const epoch = (chat as unknown as { epoch: ConversationEpoch }).epoch
  try {
    await waitFor(hungTtl.entered, '模型前查库挂起超过墓碑期限')
    const sessionId = emptyShellId(chat, ownerTtl) ?? ''
    check(sessionId.length === 32, '场景 B 阳性：查库还挂着，会话壳已经在')
    check(chat.forgetSession(sessionId, ownerTtl), '场景 B 阳性：清场作废这一条')
    for (let i = 0; i < 8192; i += 1) epoch.capture(`ttl-fill-${i}`)
    // 代次的时钟在构造时就绑成当时的 Date.now，事后改全局 Date.now 拨不到。
    // 填槽结束后再拨过墓碑期限，保证循环里记下的墓碑都早于清扫线。
    const epochClock = epoch as unknown as { now: () => number }
    const epochNow = epochClock.now
    const afterFill = epochNow()
    epochClock.now = () => afterFill + CONVERSATION_EPOCH_TOMBSTONE_TTL_MS + 5_000
    try {
      chat.sweep()
    } finally {
      epochClock.now = epochNow
    }
    check(!epoch.wasRetired(sessionId), '场景 B 阳性：超过墓碑期限并清扫后，这块墓碑已经不在')
    hungTtl.release()
    const answered = await hungTtl.pending
    check(
      answered.reply.length > 0
        && !transcriptOf(chat, sessionId, ownerTtl).includes(markTtl)
        && !ownerHasMark(chat, ownerTtl, markTtl),
      '场景 B：模型前查库挂起超过墓碑期限，清场后放行，不写回原话',
    )
    const fresh = textMark('墓碑清掉后的新一句')
    const again = await chat.chat(
      { message: fresh, channel: 'kiosk', sessionId } as never,
      undefined,
      ownerTtl,
    ) as { sessionId: string }
    check(
      again.sessionId === sessionId && transcriptOf(chat, sessionId, ownerTtl).includes(fresh),
      '场景 B：墓碑清掉之后，同一会话号新抓住的代次可以写回',
    )
  } finally {
    hungTtl.release()
    hungTtl.restore()
  }
}
