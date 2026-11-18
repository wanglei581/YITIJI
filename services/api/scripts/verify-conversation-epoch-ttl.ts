/**
 * 代次墓碑有时限。期限内挤掉前抓住的代次写不回；过了时限墓碑清掉，内存回落；
 * 同一会话号之后新抓住的代次照常写回。时钟由用例推进。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:conversation-epoch-ttl
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

function main(): void {
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
  check(!packed.wasRetired('packed') && !packed.matches('packed', heldPacked), '容量挤掉未到期墓碑后，旧代次仍然不能写回')
  const packedNext = packed.capture('packed')
  check(packedNext !== heldPacked && packed.matches('packed', packedNext), '容量挤掉墓碑后，同一会话号新抓住的代次可以写回')

  const flood = new ConversationEpoch(2, () => now)
  for (let i = 0; i < 8; i += 1) flood.invalidate(`flood-${i}`)
  check(flood.size() <= 4, '活表与墓碑合计不超过两倍容量')

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

  const chatSrc = readFileSync(join(__dirname, '../src/ai/llm/llm-chat.service.ts'), 'utf8')
  const advisorSrc = readFileSync(join(__dirname, '../src/advisor/advisor-qa-memory.ts'), 'utf8')
  check(
    chatSrc.includes('this.epoch.hold(sessionId)') && chatSrc.includes('this.epoch.release(sessionId)'),
    '小青在途钉住代次，结束时放开',
  )
  check(
    advisorSrc.includes('this.epoch.hold(id)') && advisorSrc.includes('this.epoch.release(id)'),
    '作业追问在途钉住代次，结束时放开',
  )

  console.log(`verify:conversation-epoch-ttl ${passCount} PASS`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
