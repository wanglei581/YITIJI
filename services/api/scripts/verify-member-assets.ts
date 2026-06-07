/**
 * Phase C-2B — 会员个人资产中心只读 API 归属验证。
 *
 * 覆盖：
 *   1. 本人可读：会员可读自己的简历 / 文档 / AI 记录。
 *   2. 跨用户拒绝：会员只能看到本人资产，绝不返回他人数据（按 endUserId 隔离）。
 *   3. 匿名拒绝：EndUserAuthGuard 对无 token / 错 token / 无会话一律抛 401。
 *   4. 只回元数据：不含 payloadJson / report / accessTokenHash / storageKey / sha256 等敏感字段。
 *   5. 留存治理：过期 AiResumeResult、软删 / 过期 FileObject 不返回。
 *   6. 空列表返回 []。
 *
 * 运行：pnpm verify:member-assets
 *
 * service 读取路径只依赖 prisma；guard 用最小桩注入 jwt / redis，确定性验证鉴权分支。
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import type { ExecutionContext } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectGuardCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望 401 ${code}，但 canActivate 通过（鉴权未拦截）`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

function mockCtx(headers: Record<string, string>): ExecutionContext {
  const req = { headers }
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
}

async function main() {
  console.log('\n=== Phase C-2B 会员资产中心只读 API 归属验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new MemberAssetsService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userA = `eu_ma_a_${suffix}`
  const userB = `eu_ma_b_${suffix}`
  const userC = `eu_ma_c_${suffix}` // 无任何资产 → 空列表
  const future = new Date(Date.now() + 60 * 60 * 1000)
  const past = new Date(Date.now() - 60 * 60 * 1000)

  const taskA = `ma_task_a_${suffix}`       // A 的简历（parse + optimize）
  const taskAExpired = `ma_task_aexp_${suffix}` // A 的过期 parse（应被排除）
  const taskB = `ma_task_b_${suffix}`       // B 的简历
  const allTaskIds = [taskA, taskAExpired, taskB]
  const fileA = `ma_file_a_${suffix}`
  const fileADeleted = `ma_file_adel_${suffix}`
  const fileB = `ma_file_b_${suffix}`
  const allFileIds = [fileA, fileADeleted, fileB]

  async function cleanup() {
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: allTaskIds } } })
    await prisma.fileObject.deleteMany({ where: { id: { in: allFileIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB, userC] } } })
  }

  try {
    await cleanup()

    for (const [id, n] of [[userA, '会员A'], [userB, '会员B'], [userC, '会员C']] as const) {
      await prisma.endUser.create({ data: { id, phoneHash: `ma-${id}`, phoneEnc: `ma-enc-${id}`, nickname: n } })
    }
    pass('三个测试会员已创建')

    // ── A 的 AiResumeResult：parse(未过期) + optimize(同 taskId) + 过期 parse ──
    await prisma.aiResumeResult.create({ data: { taskId: taskA, kind: 'parse', status: 'completed', payloadJson: JSON.stringify({ report: { secret: 'RESUME-RAW-A' } }), provider: 'mock', expiresAt: future, endUserId: userA } })
    await prisma.aiResumeResult.create({ data: { taskId: taskA, kind: 'optimize', status: 'completed', payloadJson: JSON.stringify({ modules: [{ after: 'RESUME-RAW-A-OPT' }] }), provider: 'mock', expiresAt: future, endUserId: userA } })
    await prisma.aiResumeResult.create({ data: { taskId: taskAExpired, kind: 'parse', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: past, endUserId: userA } })
    // ── B 的 parse ──
    await prisma.aiResumeResult.create({ data: { taskId: taskB, kind: 'parse', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userB } })

    // ── A 的文件：active(未过期) + 软删 ──；B 的文件 ──
    await prisma.fileObject.create({ data: { id: fileA, storageKey: `ma/${fileA}.pdf`, filename: '简历A.pdf', mimeType: 'application/pdf', sizeBytes: 1234, sha256: 'SHA-A-SECRET', purpose: 'resume', expiresAt: future, endUserId: userA, ownerType: 'user', ownerId: userA, status: 'active' } })
    await prisma.fileObject.create({ data: { id: fileADeleted, storageKey: `ma/${fileADeleted}.pdf`, filename: '已删A.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x', purpose: 'resume', expiresAt: future, endUserId: userA, ownerType: 'user', ownerId: userA, status: 'deleted', deletedAt: new Date() } })
    await prisma.fileObject.create({ data: { id: fileB, storageKey: `ma/${fileB}.pdf`, filename: '简历B.pdf', mimeType: 'application/pdf', sizeBytes: 4321, sha256: 'SHA-B', purpose: 'resume', expiresAt: future, endUserId: userB, ownerType: 'user', ownerId: userB, status: 'active' } })

    // ── 1. 本人可读 ──────────────────────────────────────────────
    const resA = await svc.listResumes(userA)
    if (resA.length === 1 && resA[0].taskId === taskA && resA[0].optimized === true) pass('1. 本人可读简历：A 得到 1 条 parse，optimized=true（过期 parse 已排除）')
    else fail(`1. A 简历列表异常：${JSON.stringify(resA)}`)

    const docA = await svc.listDocuments(userA)
    if (docA.length === 1 && docA[0].id === fileA && docA[0].downloadUrlPath === `/files/${fileA}/download-url`) pass('2. 本人可读文档：A 得到 1 个 active 文件（软删已排除），含临时访问端点路径')
    else fail(`2. A 文档列表异常：${JSON.stringify(docA)}`)

    const aiA = await svc.listAiRecords(userA)
    if (aiA.length === 2 && aiA.every((r) => r.taskId === taskA) && new Set(aiA.map((r) => r.kind)).size === 2) pass('3. 本人可读 AI 记录：A 得到 parse+optimize 2 条（过期已排除）')
    else fail(`3. A AI 记录异常：${JSON.stringify(aiA)}`)

    // ── 2. 跨用户隔离（双向）─────────────────────────────────────
    const resB = await svc.listResumes(userB)
    const docB = await svc.listDocuments(userB)
    const crossOk =
      resB.length === 1 && resB[0].taskId === taskB &&
      !resA.some((r) => r.taskId === taskB) &&
      docB.length === 1 && docB[0].id === fileB &&
      !docA.some((d) => d.id === fileB)
    if (crossOk) pass('4. 跨用户隔离：A 看不到 B 的简历/文档，B 也只看到自己的')
    else fail(`4. 跨用户隔离失败：resB=${JSON.stringify(resB)} docB=${JSON.stringify(docB)}`)

    // ── 3. 只回元数据，无 payload / PII / 敏感列 ──────────────────
    const resJson = JSON.stringify(resA) + JSON.stringify(aiA)
    const docJson = JSON.stringify(docA)
    const leak =
      resJson.includes('RESUME-RAW-A') || resJson.includes('payloadJson') || resJson.includes('report') ||
      resJson.includes('accessTokenHash') ||
      docJson.includes('SHA-A-SECRET') || docJson.includes('storageKey') || docJson.includes('sha256')
    if (!leak) pass('5. 只回元数据：简历/AI/文档列表均无 payloadJson / report / accessTokenHash / storageKey / sha256 / 原文')
    else fail('5. 列表泄露了敏感字段（payload / PII / 原文 / storageKey）')

    // ── 4. 空列表返回 [] ─────────────────────────────────────────
    const emptyOk =
      JSON.stringify(await svc.listResumes(userC)) === '[]' &&
      JSON.stringify(await svc.listDocuments(userC)) === '[]' &&
      JSON.stringify(await svc.listAiRecords(userC)) === '[]'
    if (emptyOk) pass('6. 空列表返回 []（无资产会员 C）')
    else fail('6. 空列表未返回 []')

    // ── 5. 匿名 / 失效鉴权拒绝（EndUserAuthGuard）────────────────
    const guardNoToken = new EndUserAuthGuard({} as never, {} as never)
    await expectGuardCode(() => guardNoToken.canActivate(mockCtx({})), 'MEMBER_MISSING_TOKEN', '7. 匿名（无 Authorization）→ 401 MEMBER_MISSING_TOKEN')

    const jwtThrows = { verify: () => { throw new Error('bad') } } as never
    const guardBad = new EndUserAuthGuard(jwtThrows, {} as never)
    await expectGuardCode(() => guardBad.canActivate(mockCtx({ authorization: 'Bearer bad.token' })), 'MEMBER_TOKEN_INVALID', '8. 错 token → 401 MEMBER_TOKEN_INVALID')

    const jwtOk = { verify: () => ({ sub: userA, jti: 'sess-x' }) } as never
    const redisNull = { get: async () => null } as never
    const guardNoSession = new EndUserAuthGuard(jwtOk, redisNull)
    await expectGuardCode(() => guardNoSession.canActivate(mockCtx({ authorization: 'Bearer ok.token' })), 'MEMBER_SESSION_EXPIRED', '9. 有效 token 但无 Redis 会话 → 401 MEMBER_SESSION_EXPIRED')

    // ── 6. 正向：有效 token + 会话 → 通过并注入 endUser ──────────
    const redisOk = { get: async () => userA } as never
    const guardOk = new EndUserAuthGuard(jwtOk, redisOk)
    const ctx = mockCtx({ authorization: 'Bearer ok.token' })
    const allowed = await guardOk.canActivate(ctx)
    const injected = (ctx.switchToHttp().getRequest() as { endUser?: { endUserId: string } }).endUser
    if (allowed === true && injected?.endUserId === userA) pass('10. 有效会员 token + 会话 → 通过并注入本人 endUserId')
    else fail('10. 有效会员鉴权未通过或未注入 endUser')
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
