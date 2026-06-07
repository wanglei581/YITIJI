/**
 * Phase C-1 + C-2A — AI 简历结果读取归属 / 一次性令牌收口验证。
 *
 * 目的：
 *   C-1：会员所有的 AiResumeResult 只能本人读取，跨会员 / 匿名一律 AI_TASK_NOT_FOUND。
 *   C-2A：匿名结果从「taskId + 短 TTL 即可读」收紧为「taskId + 一次性 accessToken 才可读」。
 *         明文 token 只在 parse 响应返回一次，DB 只存 SHA-256 hash；
 *         无 token / 错 token / 仅会员 token / 迁移前 null-hash 历史行 / 过期行一律 fail-closed。
 *
 * 运行：
 *   pnpm verify:ai-result-ownership
 *
 * 说明：读取路径只依赖 this.prisma；铸 token / 懒生成 optimize 还需 provider.parseResume /
 *   optimizeResume 与 logService.record，故注入最小可用 provider / logService 桩，
 *   其余依赖（llmConfig / llmChat / audit）用空桩注入，不触发任何外部调用。
 */
import 'dotenv/config'
import { createHash, randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AiService } from '../src/ai/ai.service'
import type { AiResultRequester } from '../src/ai/ai.service'

function pass(message: string) {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

const member = (endUserId: string): AiResultRequester => ({ endUserId, accessToken: null })
const anon = (accessToken: string | null = null): AiResultRequester => ({ endUserId: null, accessToken })

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
    fail(`${label} — 期望 AI_TASK_NOT_FOUND，但调用成功返回（越权 / 无凭证读取未被阻断）`)
  } catch (e) {
    const code = errCode(e)
    if (code === 'AI_TASK_NOT_FOUND') pass(label)
    else fail(`${label} — 期望 AI_TASK_NOT_FOUND，实际: ${code ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== Phase C-1 + C-2A AI 简历结果读取归属 / 一次性令牌收口验证 ===')

  // 确保用默认 mock provider（避免外部凭证 / stub 抛错影响构造）
  process.env['AI_PROVIDER'] = 'mock'

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userA = `eu_ai_a_${suffix}`
  const userB = `eu_ai_b_${suffix}`
  const memberTask = `ai_member_${suffix}`
  const mintTask = `ai_mint_${suffix}`        // 由 submitResumeParse 真实铸造
  const legacyTask = `ai_legacy_${suffix}`     // 迁移前匿名行（accessTokenHash=null）
  const expiredTask = `ai_exp_${suffix}`       // 过期匿名行（即便 token 正确也不可读）

  // provider 桩：parseResume 返回固定 mintTask；optimizeResume 返回固定 modules。
  const REPORT = { sections: [{ key: 'basic', label: '基础信息', score: 8, maxScore: 10 }], suggestions: ['x'] }
  const mockProvider = {
    name: 'mock',
    parseResume: async () => ({ taskId: mintTask, status: 'completed' as const, report: REPORT }),
    optimizeResume: async (taskId: string) => ({
      taskId,
      status: 'completed' as const,
      modules: [{ title: 't', before: 'a', after: 'b' }],
    }),
    chatAssistant: async () => { throw new Error('chatAssistant not used in this verify') },
    classifyIntent: async () => { throw new Error('classifyIntent not used in this verify') },
  } as unknown as never
  const otherProviderStub = { name: 'mock' } as unknown as never
  const logServiceStub = { record: () => {} } as unknown as never
  const emptyStub = {} as unknown as never

  const ai = new AiService(
    mockProvider,       // mockProvider（AI_PROVIDER=mock → this.provider）
    otherProviderStub,  // openAiProvider
    otherProviderStub,  // claudeProvider
    otherProviderStub,  // localProvider
    otherProviderStub,  // qwenProvider
    otherProviderStub,  // zhipuProvider
    logServiceStub,     // logService（submit/optimize 会调 record）
    emptyStub,          // llmConfig
    emptyStub,          // llmChat
    prisma,
    emptyStub,          // audit
  )

  const taskIds = [memberTask, mintTask, legacyTask, expiredTask]
  const future = new Date(Date.now() + 60 * 60 * 1000)
  const past = new Date(Date.now() - 60 * 60 * 1000)

  const parsePayload = (taskId: string) =>
    JSON.stringify({ taskId, status: 'completed', report: REPORT })

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

    // ── 1. 匿名 parse 真实铸 token；正确 token 可读 parse ─────────────────────
    const minted = await ai.submitResumeParse(
      { fileId: `f_${suffix}`, fileName: 'r.pdf', fileFormat: 'pdf', source: 'upload' },
      null,
    )
    const accessToken = minted.accessToken
    if (!accessToken) fail('匿名 parse 未返回一次性 accessToken')
    if (minted.taskId !== mintTask) fail('铸造任务 taskId 与预期不一致')
    const readParse = await ai.getResumeRecord(mintTask, anon(accessToken))
    if (readParse?.taskId === mintTask && readParse.report) pass('1. 匿名 parse 铸 token，正确 token 可读 parse')
    else fail('1. 正确 token 读 parse 失败')
    // 响应里的明文 token 不得回流到读取响应（读取响应不含 accessToken）
    if ((readParse as { accessToken?: string }).accessToken) fail('1b. 读取响应不应再次返回明文 accessToken')

    // ── 2. 正确 token 可懒生成 / 读取 optimize ───────────────────────────────
    const opt = await ai.getResumeOptimize(mintTask, anon(accessToken))
    if (opt?.taskId === mintTask && opt.modules?.length) pass('2. 正确 token 可懒生成 / 读取 optimize')
    else fail('2. 正确 token 读 optimize 失败')

    // ── 3. 无 token 读匿名结果 → AI_TASK_NOT_FOUND ──────────────────────────
    await expectNotFound(() => ai.getResumeRecord(mintTask, anon(null)), '3. 无 token 读匿名 parse → AI_TASK_NOT_FOUND')
    await expectNotFound(() => ai.getResumeOptimize(mintTask, anon(null)), '3b. 无 token 读匿名 optimize → AI_TASK_NOT_FOUND')

    // ── 4. 错 token 读匿名结果 → AI_TASK_NOT_FOUND ─────────────────────────
    const wrongToken = sha256Hex(`wrong-${suffix}`).slice(0, 48)
    await expectNotFound(() => ai.getResumeRecord(mintTask, anon(wrongToken)), '4. 错 token 读匿名 parse → AI_TASK_NOT_FOUND')
    await expectNotFound(() => ai.getResumeOptimize(mintTask, anon(wrongToken)), '4b. 错 token 读匿名 optimize → AI_TASK_NOT_FOUND')

    // ── 5. 仅会员 token（无 accessToken）读匿名结果 → AI_TASK_NOT_FOUND ──────
    await expectNotFound(() => ai.getResumeRecord(mintTask, member(userA)), '5. 仅会员 token 读匿名 parse → AI_TASK_NOT_FOUND')
    await expectNotFound(() => ai.getResumeOptimize(mintTask, member(userA)), '5b. 仅会员 token 读匿名 optimize → AI_TASK_NOT_FOUND')

    // ── 6. 会员本人可读会员结果 ──────────────────────────────────────────────
    await prisma.aiResumeResult.create({
      data: { taskId: memberTask, kind: 'parse', status: 'completed', payloadJson: parsePayload(memberTask), provider: 'mock', expiresAt: future, endUserId: userA, accessTokenHash: null },
    })
    const ownRead = await ai.getResumeRecord(memberTask, member(userA))
    if (ownRead?.taskId === memberTask && ownRead.report) pass('6. 会员本人可读会员结果')
    else fail('6. 会员本人读会员结果失败')

    // ── 7. 跨会员读会员结果 → AI_TASK_NOT_FOUND ────────────────────────────
    await expectNotFound(() => ai.getResumeRecord(memberTask, member(userB)), '7. 跨会员读会员结果 → AI_TASK_NOT_FOUND')

    // ── 8. 匿名读会员结果 → AI_TASK_NOT_FOUND（即便带任意 token）────────────
    await expectNotFound(() => ai.getResumeRecord(memberTask, anon(null)), '8. 匿名（无 token）读会员结果 → AI_TASK_NOT_FOUND')
    await expectNotFound(() => ai.getResumeRecord(memberTask, anon(accessToken)), '8b. 匿名（带匿名 token）读会员结果 → AI_TASK_NOT_FOUND')

    // ── 9. accessTokenHash 为 64 位 hex ────────────────────────────────────
    const mintRow = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId: mintTask, kind: 'parse' } } })
    if (mintRow?.accessTokenHash && /^[0-9a-f]{64}$/.test(mintRow.accessTokenHash)) pass('9. accessTokenHash 为 64 位小写 hex')
    else fail(`9. accessTokenHash 非 64 hex：${mintRow?.accessTokenHash ?? 'null'}`)
    if (mintRow!.accessTokenHash === sha256Hex(accessToken)) pass('9b. accessTokenHash == SHA-256(明文 token)')
    else fail('9b. accessTokenHash 与 SHA-256(token) 不一致')

    // ── 10. DB payloadJson / accessTokenHash / 其它列均不含明文 token ───────
    const optRow = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId: mintTask, kind: 'optimize' } } })
    const parseRowJson = JSON.stringify(mintRow)
    const optRowJson = JSON.stringify(optRow)
    if (
      !parseRowJson.includes(accessToken) &&
      !optRowJson.includes(accessToken) &&
      mintRow!.accessTokenHash !== accessToken &&
      !mintRow!.payloadJson.includes(accessToken)
    ) {
      pass('10. DB parse/optimize 行（含 payloadJson / accessTokenHash / 全列）均不含明文 token')
    } else {
      fail('10. DB 行包含明文 token（明文不应落库）')
    }
    // optimize 行继承 parse 行 hash，不铸新 token
    if (optRow?.accessTokenHash === mintRow!.accessTokenHash) pass('10b. optimize 行继承 parse 行 accessTokenHash（未铸新 token）')
    else fail('10b. optimize 行未正确继承 parse 行 accessTokenHash')

    // ── 11. 历史匿名行 accessTokenHash=null → fail-closed ───────────────────
    await prisma.aiResumeResult.create({
      data: { taskId: legacyTask, kind: 'parse', status: 'completed', payloadJson: parsePayload(legacyTask), provider: 'mock', expiresAt: future, endUserId: null, accessTokenHash: null },
    })
    await expectNotFound(() => ai.getResumeRecord(legacyTask, anon(null)), '11. 历史匿名行(null-hash) 无 token → AI_TASK_NOT_FOUND')
    await expectNotFound(() => ai.getResumeRecord(legacyTask, anon(accessToken)), '11b. 历史匿名行(null-hash) 带任意 token → AI_TASK_NOT_FOUND（fail-closed）')

    // ── 12. 过期匿名行即使 token 正确也 AI_TASK_NOT_FOUND ────────────────────
    const expiredToken = `${suffix}deadbeefcafef00dabcdef0123456789abcdef0123456789`
    await prisma.aiResumeResult.create({
      data: { taskId: expiredTask, kind: 'parse', status: 'completed', payloadJson: parsePayload(expiredTask), provider: 'mock', expiresAt: past, endUserId: null, accessTokenHash: sha256Hex(expiredToken) },
    })
    await expectNotFound(() => ai.getResumeRecord(expiredTask, anon(expiredToken)), '12. 过期匿名行即使 token 正确 → AI_TASK_NOT_FOUND（留存治理优先）')
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
