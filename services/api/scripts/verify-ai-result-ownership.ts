/**
 * Phase C-1 — AI 简历结果读取归属收口验证。
 *
 * 目的：
 *   证明「用户不能读取他人 AI 结果」——会员所有的 AiResumeResult 只能由本人读取，
 *   不同会员 / 匿名请求一律 AI_TASK_NOT_FOUND；匿名结果（endUserId 为 null）保持可读；
 *   过期结果仍按留存治理视为不存在。
 *
 * 运行：
 *   pnpm verify:ai-result-ownership
 *
 * 说明：getResumeRecord / getResumeOptimize 的读取路径只依赖 this.prisma，
 *   因此构造 AiService 时其余依赖用最小桩对象注入，不触发任何 provider 调用。
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AiService } from '../src/ai/ai.service'

function pass(message: string) {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return resp?.error?.code
}

async function expectNotFound(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望 AI_TASK_NOT_FOUND，但调用成功返回（越权读取未被阻断）`)
  } catch (e) {
    const code = errCode(e)
    if (code === 'AI_TASK_NOT_FOUND') pass(label)
    else fail(`${label} — 期望 AI_TASK_NOT_FOUND，实际: ${code ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== Phase C-1 AI 简历结果读取归属收口验证 ===')

  // 确保用默认 mock provider（避免外部凭证 / stub 抛错影响构造）
  process.env['AI_PROVIDER'] = 'mock'

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  // 读取路径只用 prisma；其余依赖注入最小桩。
  const providerStub = { name: 'mock' } as unknown as never
  const stub = {} as unknown as never
  const ai = new AiService(
    providerStub, // mockProvider
    providerStub, // openAiProvider
    providerStub, // claudeProvider
    providerStub, // localProvider
    providerStub, // qwenProvider
    providerStub, // zhipuProvider
    stub,         // logService
    stub,         // llmConfig
    stub,         // llmChat
    prisma,
    stub,         // audit
  )

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userA = `eu_ai_a_${suffix}`
  const userB = `eu_ai_b_${suffix}`
  const ownedTask = `ai_owned_${suffix}`
  const anonTask = `ai_anon_${suffix}`
  const optTask = `ai_opt_${suffix}`
  const expiredTask = `ai_exp_${suffix}`

  const taskIds = [ownedTask, anonTask, optTask, expiredTask]
  const future = new Date(Date.now() + 60 * 60 * 1000)
  const past = new Date(Date.now() - 60 * 60 * 1000)

  const parsePayload = (taskId: string) =>
    JSON.stringify({
      taskId,
      status: 'completed',
      report: { sections: [{ key: 'basic', label: '基础信息', score: 8, maxScore: 10 }], suggestions: ['x'] },
    })
  const optimizePayload = (taskId: string) =>
    JSON.stringify({
      taskId,
      status: 'completed',
      modules: [{ title: 't', before: 'a', after: 'b' }],
    })

  async function cleanup() {
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } })
  }

  try {
    await cleanup()

    await prisma.endUser.create({
      data: { id: userA, phoneHash: `ai-hash-a-${suffix}`, phoneEnc: `ai-enc-a-${suffix}`, nickname: '会员A' },
    })
    await prisma.endUser.create({
      data: { id: userB, phoneHash: `ai-hash-b-${suffix}`, phoneEnc: `ai-enc-b-${suffix}`, nickname: '会员B' },
    })
    pass('两个测试会员已创建')

    // ── 会员 A 拥有的 parse 结果 ────────────────────────────────
    await prisma.aiResumeResult.create({
      data: { taskId: ownedTask, kind: 'parse', status: 'completed', payloadJson: parsePayload(ownedTask), provider: 'mock', expiresAt: future, endUserId: userA },
    })

    const own = await ai.getResumeRecord(ownedTask, userA)
    if (own?.taskId === ownedTask && own?.report) pass('会员本人可读取自己的 parse 结果')
    else fail('会员本人读取自己的 parse 结果失败')

    await expectNotFound(() => ai.getResumeRecord(ownedTask, userB), '其他会员读取他人 parse 结果被拒（AI_TASK_NOT_FOUND）')
    await expectNotFound(() => ai.getResumeRecord(ownedTask, null), '匿名请求读取会员 parse 结果被拒（AI_TASK_NOT_FOUND）')

    // ── 匿名（endUserId 为 null）parse 结果保持可读 ──────────────
    await prisma.aiResumeResult.create({
      data: { taskId: anonTask, kind: 'parse', status: 'completed', payloadJson: parsePayload(anonTask), provider: 'mock', expiresAt: future, endUserId: null },
    })
    const anonByAnon = await ai.getResumeRecord(anonTask, null)
    const anonByMember = await ai.getResumeRecord(anonTask, userB)
    if (anonByAnon?.taskId === anonTask && anonByMember?.taskId === anonTask) pass('匿名 parse 结果对匿名/会员请求均可读（残留风险见 Phase C-2）')
    else fail('匿名 parse 结果读取行为异常')

    // ── 会员 A 拥有的 optimize（缓存命中）+ 同 taskId parse ───────
    await prisma.aiResumeResult.create({
      data: { taskId: optTask, kind: 'parse', status: 'completed', payloadJson: parsePayload(optTask), provider: 'mock', expiresAt: future, endUserId: userA },
    })
    await prisma.aiResumeResult.create({
      data: { taskId: optTask, kind: 'optimize', status: 'completed', payloadJson: optimizePayload(optTask), provider: 'mock', expiresAt: future, endUserId: userA },
    })
    const optOwn = await ai.getResumeOptimize(optTask, userA)
    if (optOwn?.taskId === optTask && optOwn?.modules?.length) pass('会员本人可读取自己的 optimize 结果')
    else fail('会员本人读取自己的 optimize 结果失败')

    await expectNotFound(() => ai.getResumeOptimize(optTask, userB), '其他会员读取他人 optimize 结果被拒（AI_TASK_NOT_FOUND）')
    await expectNotFound(() => ai.getResumeOptimize(optTask, null), '匿名请求读取会员 optimize 结果被拒（AI_TASK_NOT_FOUND）')

    // ── 过期结果仍视为不存在（留存治理未被破坏）─────────────────
    await prisma.aiResumeResult.create({
      data: { taskId: expiredTask, kind: 'parse', status: 'completed', payloadJson: parsePayload(expiredTask), provider: 'mock', expiresAt: past, endUserId: userA },
    })
    await expectNotFound(() => ai.getResumeRecord(expiredTask, userA), '过期 parse 结果对本人也视为不存在（留存治理生效）')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
