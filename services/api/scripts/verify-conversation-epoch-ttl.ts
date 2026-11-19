/**
 * 代次墓碑有时限。期限内挤掉前抓住的代次写不回；过了时限墓碑清掉，内存回落；
 * 同一会话号之后新抓住的代次照常写回。时钟由用例推进。
 * 时限内墓碑不因条数丢掉。清过场的会话号在这段时间不再沿用；没清过场的新号照常抓住。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:conversation-epoch-ttl
 */
import { Logger } from '@nestjs/common'
import { AdvisorQaMemory } from '../src/advisor/advisor-qa-memory'
import { LlmChatService } from '../src/ai/llm/llm-chat.service'
import {
  CONVERSATION_EPOCH_MODEL_BUDGET_MS,
  CONVERSATION_EPOCH_TOMBSTONE_MARGIN_MS,
  CONVERSATION_EPOCH_TOMBSTONE_TTL_MS,
  ConversationEpoch,
} from '../src/common/conversation-epoch'

let passCount = 0
function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}
function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  throw new Error(message)
}
function check(condition: boolean, message: string): void {
  if (condition) pass(message)
  else fail(message)
}

async function main(): Promise<void> {
  check(
    CONVERSATION_EPOCH_TOMBSTONE_TTL_MS === CONVERSATION_EPOCH_MODEL_BUDGET_MS + CONVERSATION_EPOCH_TOMBSTONE_MARGIN_MS
      && CONVERSATION_EPOCH_MODEL_BUDGET_MS === 120_000
      && CONVERSATION_EPOCH_TOMBSTONE_MARGIN_MS === 30_000,
    '墓碑时限等于模型在途上限 120 秒加 30 秒余量',
  )

  let now = 1_700_000_000_000
  const epoch = new ConversationEpoch(2, () => now)
  epoch.invalidate('job')
  const held = epoch.capture('job')
  check(held !== 0, '挤掉前抓住的是已经发出的代次')
  epoch.invalidate('filler-a')
  epoch.invalidate('filler-b')
  const whileHeld = epoch.size()
  epoch.sweep()
  check(!epoch.matches('job', held), '期限内，挤掉之前抓住的代次不能写回')
  check(epoch.size() === whileHeld, '期限内清扫不丢掉这块墓碑')

  const early = new ConversationEpoch(2, () => now)
  const beforeInsert = early.capture('early-job')
  early.invalidate('early-job')
  early.invalidate('early-a')
  early.invalidate('early-b')
  check(beforeInsert !== 0 && !early.matches('early-job', beforeInsert), '期限内，挤掉前第一次抓住的代次也不能写回')

  now += CONVERSATION_EPOCH_TOMBSTONE_TTL_MS
  epoch.sweep()
  check(epoch.size() < whileHeld && epoch.size() <= 4, '超过在途时限加余量后，墓碑被清，内存回落，且不超过两倍容量')
  check(!epoch.matches('job', held), '墓碑清掉之后，挤掉前抓住的代次仍然不能写回')
  const renewed = epoch.capture('job')
  check(renewed !== held && epoch.matches('job', renewed), '墓碑清掉之后，同一会话号新抓住的代次可以写回')

  const quiet = new ConversationEpoch(2, () => now)
  const heldQuiet = quiet.capture('quiet')
  quiet.invalidate('quiet')
  quiet.capture('quiet-a')
  quiet.capture('quiet-b')
  check(quiet.wasRetired('quiet') && !quiet.matches('quiet', heldQuiet), '挤成墓碑后，时限内旧代次不能写回')
  now += CONVERSATION_EPOCH_TOMBSTONE_TTL_MS
  quiet.sweep()
  check(!quiet.wasRetired('quiet') && !quiet.matches('quiet', heldQuiet), '墓碑到期清掉后，旧代次仍然不能写回')
  const quietNext = quiet.capture('quiet')
  check(quietNext !== heldQuiet && quiet.matches('quiet', quietNext), '墓碑到期清掉后，同一会话号新抓住的代次可以写回')

  const packed = new ConversationEpoch(2, () => now)
  const heldPacked = packed.capture('packed')
  packed.invalidate('packed')
  packed.capture('packed-a')
  packed.capture('packed-b')
  packed.invalidate('packed-c')
  check(
    packed.wasRetired('packed') && !packed.matches('packed', heldPacked),
    '容量压力下未到期墓碑仍在，旧代次不能写回',
  )
  const packedNext = packed.capture('packed')
  check(
    packedNext !== heldPacked && packed.matches('packed', packedNext) && packed.wasRetired('packed'),
    '未到期墓碑还在时，同一会话号新抓住的代次可以写回，沿用检查仍认它清过场',
  )

  const flood = new ConversationEpoch(2, () => now)
  const floodFirst = flood.capture('flood-0')
  flood.invalidate('flood-0')
  for (let i = 1; i < 8; i += 1) flood.invalidate(`flood-${i}`)
  const floodIds = Array.from({ length: 8 }, (_, index) => `flood-${index}`)
  check(floodIds.every((id) => flood.wasRetired(id)), '时限内，容量压力也不丢掉未到期墓碑')
  check(flood.size() === 10, '时限内墓碑不因条数丢掉，活表加墓碑可以暂时超过两倍容量')
  const freshEpochId = 'f'.repeat(32)
  check(!flood.wasRetired(freshEpochId), '没清过场的新会话号不在墓碑里')
  const freshEpoch = flood.capture(freshEpochId)
  check(freshEpoch !== 0 && flood.matches(freshEpochId, freshEpoch), '墓碑暂时超过容量时，新会话号仍能抓住并写回')
  now += CONVERSATION_EPOCH_TOMBSTONE_TTL_MS
  flood.sweep()
  check(flood.size() <= 4, '超过在途时限加余量后，活表与墓碑合计回到不超过两倍容量')
  check(
    floodIds.every((id) => !flood.wasRetired(id)) && !flood.matches('flood-0', floodFirst),
    '超过在途时限加余量后，墓碑清掉，旧代次仍然不能写回',
  )
  const floodNext = flood.capture('flood-0')
  check(floodNext !== floodFirst && flood.matches('flood-0', floodNext), '墓碑到期清掉后，同一会话号新抓住的代次可以写回')

  const pinned = new ConversationEpoch(2, () => now)
  const pinnedEpoch = pinned.capture('slow')
  pinned.hold('slow')
  pinned.hold('slow')
  pinned.capture('slow-a')
  pinned.capture('slow-b')
  pinned.capture('slow-c')
  check(pinned.matches('slow', pinnedEpoch), '两次在途叠在同一会话上，后来的会话挤不掉')
  pinned.release('slow')
  pinned.capture('slow-d')
  check(pinned.matches('slow', pinnedEpoch), '还有一次在途时，放开其中一次仍挤不掉')
  pinned.release('slow')
  pinned.capture('slow-e')
  pinned.capture('slow-f')
  check(!pinned.matches('slow', pinnedEpoch), '在途都结束之后，后来的会话可以挤掉，旧号不能写回')

  const cleared = new ConversationEpoch(2, () => now)
  const clearedEpoch = cleared.capture('cleared')
  cleared.hold('cleared')
  cleared.invalidate('cleared')
  cleared.capture('cleared-a')
  cleared.capture('cleared-b')
  check(!cleared.matches('cleared', clearedEpoch), '钉住期间清场，旧代次不能写回')
  const clearedNext = cleared.capture('cleared')
  check(
    clearedNext !== clearedEpoch && cleared.matches('cleared', clearedNext),
    '钉住期间清场后，新代次可以写回',
  )
  cleared.release('cleared')

  assertAdvisorHoldSurvivesFlood()
  assertPublicClearLeavesInflightPin()
  assertEarlyReturnReturnsToBaseline()
  await assertChatKeepsInFlightAndRefusesClearedId()

  console.log(`verify:conversation-epoch-ttl ${passCount} PASS`)
}

/** 作业追问的在途钉住和结束放开。公开接口：还在途时挤满写得回，放开后再挤，旧代次写不回。 */
function assertAdvisorHoldSurvivesFlood(): void {
  const memory = new AdvisorQaMemory()
  const slow = 'slow-job'
  const captured = memory.begin(slow, null)
  for (let i = 0; i < 9000; i += 1) {
    const id = `other-${i}`
    memory.begin(id, null)
    memory.end(id)
  }
  memory.append(slow, '在途问题', '在途回答', null, captured)
  check(
    memory.read(slow).some((turn) => turn.content === '在途问题'),
    '作业追问还在途时，后来的会话把代次表挤满也挤不掉，抓住的代次仍能写回',
  )
  memory.end(slow)
  for (let i = 0; i < 9000; i += 1) {
    const id = `later-${i}`
    memory.begin(id, null)
    memory.end(id)
  }
  memory.append(slow, '旧代次问题', '不该留下', null, captured)
  check(
    !memory.read(slow).some((turn) => turn.content === '旧代次问题'),
    '作业追问结束后被后来的会话挤掉，旧代次不能写回',
  )
  const renewed = memory.begin(slow, null)
  memory.append(slow, '新代次问题', '新回答', null, renewed)
  memory.end(slow)
  check(
    memory.read(slow).some((turn) => turn.content === '新代次问题'),
    '同一作业号新抓住的代次可以写回',
  )
}

/**
 * agy 说 AdvisorQaMemory.end 在没有登记时提前返回，钉会泄漏。公开路径不成立。
 * 清场、按归属清、清扫、读取都不摘在途登记，钉还在；结束才放开。
 * 同一次作业进来两次时，结束一次只放开一根钉。
 * 出处：advisor-qa-memory.ts 的 end，以及 advisor.service.ts ask 的 begin / finally end。
 */
function assertPublicClearLeavesInflightPin(): void {
  const memory = new AdvisorQaMemory()
  const id = 'pinned-public'
  const owner = 'u:member-pinned'
  memory.begin(id, owner)
  memory.append(id, '问题', '回答', owner)
  memory.forget(id)
  memory.forgetIfOwner(id, owner)
  memory.forgetOwner(owner)
  memory.read(id)
  memory.sweep()
  check(
    inflightCount(memory, id) === 1 && pinCount(memory, id) === 1,
    '清场、按归属清、清扫、读取都不摘在途登记，钉还在',
  )
  memory.end(id)
  check(
    inflightCount(memory, id) === 0 && pinCount(memory, id) === 0,
    '请求结束时登记还在，钉随之放开',
  )
  memory.end(id)
  check(pinCount(memory, id) === 0, '没有登记时结束直接返回，钉不会被多放一次')

  const twice = 'pinned-twice'
  memory.begin(twice, null)
  memory.begin(twice, null)
  memory.forget(twice)
  memory.end(twice)
  check(
    inflightCount(memory, twice) === 1 && pinCount(memory, twice) === 1,
    '同一次作业还有一次在途时，结束只放开这一次的钉',
  )
  memory.end(twice)
  check(inflightCount(memory, twice) === 0 && pinCount(memory, twice) === 0, '两次在途都结束后钉放开')
}

/**
 * 同一次作业进来两次，两次都结束，再结束一次。
 * 第三次没有登记，走 end 里的提前返回。
 * 若第二次进来覆盖了登记，第二次结束就会提前返回，钉留在 1，活表挤不掉。
 * 出处：advisor-qa-memory.ts 的 end；agy-m1434i-reply.md 第三节第 2 条。
 */
function assertEarlyReturnReturnsToBaseline(): void {
  const control = new AdvisorQaMemory()
  control.begin('control-once', null)
  control.end('control-once')

  const memory = new AdvisorQaMemory()
  const id = 'early-return'
  const captured = memory.begin(id, null)
  memory.begin(id, null)
  memory.end(id)
  memory.end(id)
  memory.end(id)
  memory.end('never-begun')
  check(
    pinCount(memory, id) === pinCount(control, 'control-once')
      && liveCount(memory) === liveCount(control),
    '两次在途都结束后再走提前返回，钉和活表槽位与一次成对结束相同',
  )

  const epoch = epochOf(memory)
  epoch.cap = 2
  for (let index = 0; index < 4; index += 1) {
    const other = `early-other-${index}`
    memory.begin(other, null)
    memory.end(other)
  }
  check(pinCount(memory, id) === 0 && epoch.order.length <= epoch.cap, '提前返回之后灌满活表，钉是 0，槽位不超过容量')
  check(!epoch.matches(id, captured), '提前返回之后灌满活表，这条会话的槽位回到可挤掉的基线')
}

function liveCount(memory: AdvisorQaMemory): number {
  return epochOf(memory).current.size
}

function epochOf(memory: AdvisorQaMemory): {
  cap: number
  order: string[]
  current: Map<string, number>
  matches(id: string, captured: number): boolean
} {
  return (memory as unknown as {
    epoch: {
      cap: number
      order: string[]
      current: Map<string, number>
      matches(id: string, captured: number): boolean
    }
  }).epoch
}

function inflightCount(memory: AdvisorQaMemory, id: string): number {
  const inflight = (memory as unknown as { inflight: Map<string, { n: number }> }).inflight
  return inflight.get(id)?.n ?? 0
}

function pinCount(memory: AdvisorQaMemory, id: string): number {
  const epoch = (memory as unknown as { epoch: { pins: Map<string, number> } }).epoch
  return epoch.pins.get(id) ?? 0
}

function hexId(n: number): string {
  return n.toString(16).padStart(32, '0')
}

/**
 * 小青还在等模型时，别的会话把代次表挤过默认容量，这一轮仍写回。
 * 更早清掉的会话号在墓碑时限内不再沿用。没清过场的新号照常沿用。
 */
async function assertChatKeepsInFlightAndRefusesClearedId(): Promise<void> {
  Logger.overrideLogger({ log() {}, warn() {}, error() {}, debug() {}, verbose() {} })
  const chat = new LlmChatService({
    getApiKey: () => 'verify-key',
    getConfig: () => ({
      vendor: 'openai',
      model: 'm',
      baseURL: 'https://api.deepseek.com/v1',
      systemPrompt: '你是就业服务助手',
      roleScope: '',
      forbiddenWords: [],
      temperature: 0,
      enabled: true,
    }),
  } as never)
  const cleared = 'a'.repeat(32)
  const first = await chat.chat({ message: '打印机卡纸怎么办', channel: 'kiosk', sessionId: cleared })
  check(first.sessionId === cleared, '没清过场的会话号第一次会被沿用')
  check(chat.forgetSession(cleared, 'anon'), '清掉刚才沿用的会话')

  let started = false
  let releaseFetch = (): void => undefined
  const gate = new Promise<void>((resolve) => { releaseFetch = resolve })
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    started = true
    await gate
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '模型答了' } }] }),
    }
  }) as typeof fetch
  const hungId = 'd'.repeat(32)
  const userText = '帮我看看这份简历'
  const pending = chat.chat({ message: userText, channel: 'kiosk', sessionId: hungId })
  try {
    for (let i = 0; i < 50 && !started; i += 1) {
      await new Promise<void>((resolve) => { setImmediate(resolve) })
    }
    check(started, '在途请求已经进到模型调用')
    for (let i = 0; i < 8300; i += 1) {
      const id = hexId(i + 1)
      const created = await chat.chat({ message: '打印机卡纸怎么办', channel: 'kiosk', sessionId: id })
      chat.forgetSession(created.sessionId, 'anon')
    }
    const again = await chat.chat({ message: '打印机卡纸怎么办', channel: 'kiosk', sessionId: cleared })
    check(again.sessionId !== cleared, '清过场的会话号在墓碑超过活表容量后，时限内不再沿用')
    const fresh = 'c'.repeat(32)
    const freshResult = await chat.chat({ message: '打印机卡纸怎么办', channel: 'kiosk', sessionId: fresh })
    check(freshResult.sessionId === fresh, '没清过场的新会话号在墓碑很多时仍会沿用')
    releaseFetch()
    const answered = await pending
    const transcript = chat.getOwnedTranscript(hungId, 'anon')
    check(
      answered.sessionId === hungId
        && Boolean(transcript?.some((turn) => turn.content.includes(userText)))
        && Boolean(transcript?.some((turn) => turn.content === '模型答了')),
      '小青还在等模型时，后来的会话把代次表挤满也挤不掉这一轮',
    )
  } finally {
    releaseFetch()
    globalThis.fetch = previousFetch
    await pending.catch(() => undefined)
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
