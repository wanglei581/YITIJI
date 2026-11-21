/**
 * 游客问完、登录、再登出。挂在 verify-conversation-memory-forget 末尾。
 *
 * 一体机登出先清场再注销会员（AuthContext.logout → clearKioskSensitiveSession →
 * forgetAiSessions，然后 memberLogout）。游客登录不走清场。
 * 小青会话号在进页时就铸成 32 位十六进制，发 /assistant/chat 请求前登记（不等回复，
 * 且不在每次渲染或清场换新号时乱登记），服务端沿用没被占用的这个号；
 * 清场先按会员令牌发，再按同一来源地址匿名发。别的归属沿用或清掉这个号都失败。
 * 作业追问一体机没有调用点。已经用 getAdvisorSession 登记过令牌的，清场带会员令牌和
 * 游客作业令牌，在途写回作废。没登记令牌的不在清场请求里，登出只按会员归属清，不动它。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HttpException, ValidationPipe } from '@nestjs/common'
import { AssistantSessionForgetController } from '../src/ai/assistant-session-forget.controller'
import { AssistantSessionsForgetDto } from '../src/ai/dto/assistant-sessions-forget.dto'
import { assistantOwnerKey, type LlmChatService } from '../src/ai/llm/llm-chat.service'
import type { AdvisorController } from '../src/advisor/advisor.controller'
import type { AdvisorQaMemory } from '../src/advisor/advisor-qa-memory'
import type { AdvisorService } from '../src/advisor/advisor.service'
import type { InflightForgetContext } from './verify-conversation-memory-forget-inflight'

const KIOSK = resolve(__dirname, '../../../apps/kiosk/src')
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })

function readKiosk(rel: string): string {
  return readFileSync(join(KIOSK, rel), 'utf8')
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) return ''
  const to = source.indexOf(end, from + start.length)
  return source.slice(from, to < 0 ? source.length : to)
}

async function forgetBody(sessionIds: string[]): Promise<AssistantSessionsForgetDto> {
  return await pipe.transform(
    { sessionIds },
    { type: 'body', metatype: AssistantSessionsForgetDto },
  ) as AssistantSessionsForgetDto
}

async function forgottenOf(run: () => Promise<{ forgotten: number }>): Promise<number> {
  try {
    return (await run()).forgotten
  } catch (error) {
    if (error instanceof HttpException) return -error.getStatus()
    throw error
  }
}

function transcript(chat: LlmChatService, sessionId: string, owner: string): string {
  return (chat.getOwnedTranscript(sessionId, owner) ?? []).map((turn) => turn.content).join('\n')
}

function qaText(memory: AdvisorQaMemory, sessionId: string): string {
  return memory.read(sessionId).map((turn) => turn.content).join('\n')
}

interface Hung {
  pending: Promise<{ sessionId?: string; reply?: string; answer?: string }>
  entered: Promise<void>
  release: () => void
}

function hangChat(chat: LlmChatService, owner: string, mark: string, sessionId: string): Hung {
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
  ) as Promise<{ sessionId: string; reply: string }>
  return {
    pending,
    entered,
    release() {
      releaseGate()
      globalThis.fetch = previous
    },
  }
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

async function settle(hung: Hung): Promise<void> {
  hung.release()
  await hung.pending.catch(() => undefined)
}

/** 一体机 forgetAiSessions：有会员令牌就先按会员发，再按同一来源地址匿名发一次。 */
async function kioskAssistantForget(
  controller: AssistantSessionForgetController,
  sessionId: string,
  token: string,
  ip: string,
): Promise<{ member: number; anon: number }> {
  const dto = await forgetBody([sessionId])
  const member = await forgottenOf(() => controller.forget(dto, {
    headers: { authorization: `Bearer ${token}` },
    ip,
  }))
  const anon = await forgottenOf(() => controller.forget(dto, { headers: {}, ip }))
  return { member, anon }
}

export async function runGuestLoginLogoutScenarios(ctx: InflightForgetContext): Promise<void> {
  const { check, textMark, chat, memory, advisor, auth, controller, advisorController, prisma, createUser, bearer, modelGate } = ctx
  const kioskIp = '10.44.1.8'
  const guestOwner = assistantOwnerKey(null, kioskIp)
  const otherIp = '10.44.9.9'
  const otherOwner = assistantOwnerKey(null, otherIp)

  const authSrc = readKiosk('auth/AuthContext.tsx')
  const loginBody = between(authSrc, 'const login = useCallback', 'const logout = useCallback')
  const guestBranch = between(loginBody, 'else if (!current)', 'sessionExpiryExit.cancel()')
  const logoutBody = between(authSrc, 'const logout = useCallback', 'useEffect')
  const forgetSrc = readKiosk('services/api/aiSessionForget.ts')
  const scenes = readKiosk('pages/assistant/advisorScenes.ts')
  const aiAdapter = readKiosk('services/api/aiHttpAdapter.ts')
  const chatAdapterBody = between(aiAdapter, 'async chatWithAssistant(', '\n  },')
  const chatSrc = readFileSync(resolve(__dirname, '../src/ai/llm/llm-chat.service.ts'), 'utf8')
  check(!guestBranch.includes('clearKioskSensitiveSession'), '游客登录不调用清场，这次到访的对话还留着')
  check(
    logoutBody.includes('clearKioskSensitiveSession(token)')
      && logoutBody.indexOf('clearKioskSensitiveSession(token)') < logoutBody.indexOf('memberLogout(token)'),
    '退出登录先按这次到访清场，再注销会员',
  )
  check(readKiosk('auth/kioskSensitiveSession.ts').includes('forgetAiSessions(outgoingMemberToken ?? null)'), '清场会把登记过的会话号发出去')
  check(
    forgetSrc.includes("fireForget('/assistant/sessions/forget', { ...headers, Authorization: `Bearer ${token}` }, body)")
      && forgetSrc.includes("fireForget('/assistant/sessions/forget', headers, body)"),
    '小青清场先带会员令牌，再匿名发一次',
  )
  check(forgetSrc.includes('if (!token && !advisor.accessToken) continue'), '作业号没记下令牌、当前也不是会员时，清场不发这个号')
  check(
    scenes.includes('getRandomValues')
      && !scenes.includes('rememberAssistantSession(')
      && chatAdapterBody.includes('trackAssistantSessionRequest(req.sessionId)')
      && chatAdapterBody.indexOf('trackAssistantSessionRequest(req.sessionId)')
        < chatAdapterBody.indexOf("post<AssistantChatResponse>('/assistant/chat'")
      && chatAdapterBody.includes('settle(res.sessionId)'),
    '一体机铸 32 位会话号，发 /assistant/chat 前登记不等回复，且铸号本身不乱登记',
  )
  check(
    chatSrc.includes('unusedVisitId') && chatSrc.includes('!this.inflight.has(requestedId)'),
    '服务端只沿用还没被占用的 32 位会话号',
  )
  check(chatSrc.includes('!this.epoch.wasRetired(requestedId)'), '清场过的会话号在墓碑期内不再沿用')
  check(readKiosk('services/api/advisor.ts').includes('rememberAdvisorSession(sessionId, access)'), '读过的作业会记下作业号和游客令牌')
  check(!readKiosk('services/api/advisor.ts').includes('/ask'), '一体机作业客户端不发起追问')

  const user = `verify-switch-${randomUUID()}`
  await createUser(user)
  const bystanderMark = textMark('旁路游客小青')
  const bystander = await chat.chat(
    { message: bystanderMark, channel: 'kiosk' } as never,
    undefined,
    otherOwner,
  ) as { sessionId: string }

  const clientId = randomBytes(16).toString('hex')
  const inflightMark = textMark('游客小青在途原话')
  const hung = hangChat(chat, guestOwner, inflightMark, clientId)
  try {
    await waitFor(hung.entered, '游客小青在途')
    const token = bearer(user)
    const cleared = await kioskAssistantForget(controller, clientId, token, kioskIp)
    await auth.logout(user, randomUUID())
    hung.release()
    const answered = await hung.pending as { sessionId: string; reply: string }
    check(answered.sessionId === clientId && answered.reply.length > 0, '在途小青沿用这次到访铸的会话号，回答仍返回')
    check(cleared.member === 0 && cleared.anon === 1, '会员令牌对不上游客归属；同一来源地址的匿名清场作废这一条')
    check(
      !transcript(chat, clientId, guestOwner).includes(inflightMark),
      '游客小青还在生成时登录再退出，放行后内存没有原话',
    )
  } finally {
    await settle(hung)
  }
  check(transcript(chat, bystander.sessionId, otherOwner).includes(bystanderMark), '另一来源地址的小青不受这次退出影响')

  const storedId = randomBytes(16).toString('hex')
  const storedMark = textMark('游客小青已写入')
  const stored = await chat.chat(
    { message: storedMark, channel: 'kiosk', sessionId: storedId } as never,
    undefined,
    guestOwner,
  ) as { sessionId: string }
  check(stored.sessionId === storedId && transcript(chat, storedId, guestOwner).includes(storedMark), '游客小青写进内存后，登录前原话还在')
  const storedUser = `verify-switch-stored-${randomUUID()}`
  await createUser(storedUser)
  const storedToken = bearer(storedUser)
  check(transcript(chat, storedId, guestOwner).includes(storedMark), '游客登录不清除已经写进内存的小青')
  const storedCleared = await kioskAssistantForget(controller, storedId, storedToken, kioskIp)
  await auth.logout(storedUser, randomUUID())
  check(
    storedCleared.anon === 1 && !transcript(chat, storedId, guestOwner).includes(storedMark),
    '登录再退出后，匿名清场清掉这次到访已经写进内存的小青',
  )

  const legacy = await chat.chat(
    { message: textMark('旧格式会话号'), channel: 'kiosk', sessionId: 'session-legacy' } as never,
    undefined,
    guestOwner,
  ) as { sessionId: string }
  check(legacy.sessionId !== 'session-legacy' && /^[0-9a-f]{32}$/.test(legacy.sessionId), '不是 32 位十六进制的会话号不沿用')

  const retiredId = randomBytes(16).toString('hex')
  const retiredMark = textMark('清场后不再沿用')
  const retired = await chat.chat(
    { message: retiredMark, channel: 'kiosk', sessionId: retiredId } as never,
    undefined,
    guestOwner,
  ) as { sessionId: string }
  const retiredUser = `verify-switch-retired-${randomUUID()}`
  await createUser(retiredUser)
  const retiredCleared = await kioskAssistantForget(controller, retiredId, bearer(retiredUser), kioskIp)
  const reused = await chat.chat(
    { message: textMark('下一位的新一句'), channel: 'kiosk', sessionId: retiredId } as never,
    undefined,
    guestOwner,
  ) as { sessionId: string }
  check(
    retired.sessionId === retiredId
      && retiredCleared.anon === 1
      && reused.sessionId !== retiredId
      && /^[0-9a-f]{32}$/.test(reused.sessionId)
      && !transcript(chat, retiredId, guestOwner).includes('下一位的新一句'),
    '清场之后，墓碑期内不再沿用同一个会话号',
  )

  const victimId = randomBytes(16).toString('hex')
  const victimMark = textMark('受害者小青')
  const victim = await chat.chat(
    { message: victimMark, channel: 'kiosk', sessionId: victimId } as never,
    undefined,
    guestOwner,
  ) as { sessionId: string }
  const attackerUser = `verify-switch-attacker-${randomUUID()}`
  await createUser(attackerUser)
  const attacker = await chat.chat(
    { message: textMark('攻击者小青'), channel: 'kiosk', sessionId: victimId } as never,
    undefined,
    assistantOwnerKey(null, otherIp),
  ) as { sessionId: string }
  const victimDto = await forgetBody([victimId])
  const stolen = await forgottenOf(() => controller.forget(victimDto, {
    headers: { authorization: `Bearer ${bearer(attackerUser)}` },
    ip: otherIp,
  }))
  const anonStolen = await forgottenOf(() => controller.forget(victimDto, {
    headers: {},
    ip: otherIp,
  }))
  check(
    victim.sessionId === victimId
      && attacker.sessionId !== victimId
      && stolen === 0
      && anonStolen === 0
      && transcript(chat, victimId, guestOwner).includes(victimMark),
    '别的归属不能沿用这个会话号，也不能按号清掉别人的小青',
  )

  await runAdvisorSwitch(advisor, advisorController, memory, auth, prisma, createUser, bearer, modelGate, check, textMark)
}

async function runAdvisorSwitch(
  advisor: AdvisorService,
  advisorController: AdvisorController,
  memory: AdvisorQaMemory,
  auth: InflightForgetContext['auth'],
  prisma: InflightForgetContext['prisma'],
  createUser: InflightForgetContext['createUser'],
  bearer: InflightForgetContext['bearer'],
  modelGate: InflightForgetContext['modelGate'],
  check: InflightForgetContext['check'],
  textMark: InflightForgetContext['textMark'],
): Promise<void> {
  const future = new Date(Date.now() + 3_600_000)
  async function createAnon(id: string, token: string): Promise<void> {
    await prisma.advisorSession.create({
      data: {
        id,
        accessTokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
        topic: '顾问作业',
        skill: 'qa',
        expiresAt: future,
      },
    })
  }

  const keptToken = `tok-${randomUUID()}`
  const keptId = `verify-work-kept-${randomUUID()}`
  await createAnon(keptId, keptToken)
  const keptMark = textMark('旁路游客作业')
  await advisor.ask(keptId, keptMark, { endUserId: null, accessToken: keptToken })

  const accessToken = `tok-${randomUUID()}`
  const workId = `verify-work-switch-${randomUUID()}`
  await createAnon(workId, accessToken)
  const mark = textMark('游客作业在途原话')
  const previousWait = modelGate.wait
  const previousEntered = modelGate.entered
  let releaseGate: () => void = () => undefined
  let markEntered: () => void = () => undefined
  const entered = new Promise<void>((resolve) => { markEntered = resolve })
  modelGate.entered = () => markEntered()
  modelGate.wait = () => new Promise<void>((resolve) => { releaseGate = resolve })
  const pending = advisor.ask(workId, mark, { endUserId: null, accessToken }) as Promise<{ answer: string }>
  const release = () => {
    releaseGate()
    modelGate.wait = previousWait
    modelGate.entered = previousEntered
  }
  try {
    await waitFor(entered, '游客作业在途')
    const user = `verify-switch-qa-${randomUUID()}`
    await createUser(user)
    const token = bearer(user)
    const wrong = await advisorController.forget(workId, { headers: { authorization: `Bearer ${token}` } })
    check(wrong.forgotten === 0, '只有会员令牌、没有游客作业令牌时，清不掉匿名作业')
    const cleared = await advisorController.forget(workId, {
      headers: { authorization: `Bearer ${token}`, 'x-advisor-access-token': accessToken },
    })
    await auth.logout(user, randomUUID())
    release()
    const answered = await pending
    check(
      answered.answer.length > 0
        && cleared.forgotten === 0
        && !qaText(memory, workId).includes(mark),
      '作业还在生成时登录再退出，带上登记过的游客令牌，放行后内存没有原话',
    )
  } finally {
    release()
    await pending.catch(() => undefined)
  }
  check(qaText(memory, keptId).includes(keptMark), '另一次游客作业不因这次退出被清掉')

  const storedToken = `tok-${randomUUID()}`
  const storedId = `verify-work-stored-${randomUUID()}`
  await createAnon(storedId, storedToken)
  const storedMark = textMark('游客作业已写入')
  await advisor.ask(storedId, storedMark, { endUserId: null, accessToken: storedToken })
  const storedUser = `verify-switch-qa-stored-${randomUUID()}`
  await createUser(storedUser)
  const storedBearer = bearer(storedUser)
  check(qaText(memory, storedId).includes(storedMark), '游客登录不清除已经写进内存的作业')
  const storedCleared = await advisorController.forget(storedId, {
    headers: { authorization: `Bearer ${storedBearer}`, 'x-advisor-access-token': storedToken },
  })
  await auth.logout(storedUser, randomUUID())
  check(
    storedCleared.forgotten === 1 && !qaText(memory, storedId).includes(storedMark),
    '登录再退出后，带游客令牌的清场清掉这次到访已经写进内存的作业',
  )
}
