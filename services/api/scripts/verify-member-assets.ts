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
let failed = 0
function fail(m: string): void { failed += 1; console.error(`  FAIL ${m}`) }

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

type MemberDeleteBranch = 'parse' | 'job_fit'
type MemberDeleteQuery = {
  scope: 'transaction' | 'direct'
  delegate: 'aiResumeResult.findFirst' | 'aiResumeResult.deleteMany' | 'jobAiSession.deleteMany'
  where: Record<string, unknown>
}
type MemberDeleteRun = {
  calls: string[]
  queries: MemberDeleteQuery[]
  pendingDeletes: string[]
  committedDeletes: string[]
}

type TransactionMode = 'success' | 'before_callback_rollback' | 'after_callback_rollback'

function createMemberDeleteRun(
  branch: MemberDeleteBranch,
  transactionMode: TransactionMode,
  resultDeleteCount = branch === 'parse' ? 4 : 1,
): {
  prisma: object
  state: MemberDeleteRun
} {
  const state: MemberDeleteRun = { calls: [], queries: [], pendingDeletes: [], committedDeletes: [] }
  const row = {
    id: `member-delete-${branch}`,
    taskId: `member-delete-task-${branch}`,
    kind: branch,
  }
  const findRecord = (scope: MemberDeleteQuery['scope']) => async (args: { where: Record<string, unknown> }) => {
    state.calls.push(`${scope}.aiResumeResult.findFirst`)
    state.queries.push({ scope, delegate: 'aiResumeResult.findFirst', where: args.where })
    return row
  }
  const recordDelete = (scope: MemberDeleteQuery['scope'], delegate: Extract<MemberDeleteQuery['delegate'], `${string}.deleteMany`>) => async (args: { where: Record<string, unknown> }) => {
    state.calls.push(`${scope}.${delegate}`)
    state.queries.push({ scope, delegate, where: args.where })
    const count = delegate === 'aiResumeResult.deleteMany' ? resultDeleteCount : (branch === 'parse' ? 3 : 1)
    if (count > 0 && scope === 'transaction') state.pendingDeletes.push(`${scope}.${delegate}`)
    else if (count > 0) state.committedDeletes.push(`${scope}.${delegate}`)
    return { count }
  }
  const transactionClient = {
    aiResumeResult: {
      findFirst: findRecord('transaction'),
      deleteMany: recordDelete('transaction', 'aiResumeResult.deleteMany'),
    },
    jobAiSession: { deleteMany: recordDelete('transaction', 'jobAiSession.deleteMany') },
  }
  const prisma = {
    $transaction: async (callback: (tx: typeof transactionClient) => Promise<unknown>) => {
      state.calls.push('transaction.begin')
      if (transactionMode === 'before_callback_rollback') {
        state.calls.push('transaction.rollback')
        throw new Error('simulated member asset transaction rollback before callback')
      }
      try {
        const result = await callback(transactionClient)
        if (transactionMode === 'after_callback_rollback') {
          throw new Error('simulated member asset transaction rollback after callback')
        }
        state.calls.push('transaction.commit')
        state.committedDeletes.push(...state.pendingDeletes)
        state.pendingDeletes.length = 0
        return result
      } catch (error) {
        state.calls.push('transaction.rollback')
        state.pendingDeletes.length = 0
        throw error
      }
    },
    aiResumeResult: {
      findFirst: findRecord('direct'),
      deleteMany: recordDelete('direct', 'aiResumeResult.deleteMany'),
    },
    jobAiSession: { deleteMany: recordDelete('direct', 'jobAiSession.deleteMany') },
  }
  return { prisma, state }
}

function hasWhere(query: MemberDeleteQuery | undefined, expected: Record<string, unknown>): boolean {
  return JSON.stringify(query?.where) === JSON.stringify(expected)
}

async function verifyMemberAssetDeletionTransaction(branch: MemberDeleteBranch): Promise<void> {
  const success = createMemberDeleteRun(branch, 'success')
  const service = new MemberAssetsService(success.prisma as never)
  await service.deleteAiRecord('member-delete-owner', `member-delete-${branch}`)

  const findQuery = success.state.queries.find((query) => query.scope === 'transaction' && query.delegate === 'aiResumeResult.findFirst')
  const resultQuery = success.state.queries.find((query) => query.scope === 'transaction' && query.delegate === 'aiResumeResult.deleteMany')
  const sessionQuery = success.state.queries.find((query) => query.scope === 'transaction' && query.delegate === 'jobAiSession.deleteMany')
  const expectedResultWhere = branch === 'parse'
    ? { endUserId: 'member-delete-owner', taskId: `member-delete-task-${branch}` }
    : { endUserId: 'member-delete-owner', id: `member-delete-${branch}` }
  const expectedSessionWhere = branch === 'parse'
    ? { endUserId: 'member-delete-owner', resumeTaskId: `member-delete-task-${branch}` }
    : { endUserId: 'member-delete-owner', resumeTaskId: `member-delete-task-${branch}`, operation: 'match' }
  const usesTransactionClient =
    success.state.calls.includes('transaction.begin') &&
    success.state.calls.includes('transaction.commit') &&
    success.state.calls.includes('transaction.aiResumeResult.findFirst') &&
    success.state.calls.includes('transaction.aiResumeResult.deleteMany') &&
    success.state.calls.includes('transaction.jobAiSession.deleteMany') &&
    !success.state.calls.some((call) => call.startsWith('direct.')) &&
    hasWhere(findQuery, { id: `member-delete-${branch}`, endUserId: 'member-delete-owner' }) &&
    hasWhere(resultQuery, expectedResultWhere) &&
    hasWhere(sessionQuery, expectedSessionWhere)
  if (usesTransactionClient) {
    pass(`14.${branch} 归属查询与级联删除均通过同一 $transaction callback 的 tx，过滤范围正确`)
  } else {
    fail(`14.${branch} 归属查询与删除必须通过同一 $transaction callback 的 tx calls=${success.state.calls.join(',')} queries=${JSON.stringify(success.state.queries)}`)
  }

  const rollback = createMemberDeleteRun(branch, 'after_callback_rollback')
  const rollbackService = new MemberAssetsService(rollback.prisma as never)
  let thrown = false
  try {
    await rollbackService.deleteAiRecord('member-delete-owner', `member-delete-${branch}`)
  } catch (error) {
    thrown = (error as Error).message === 'simulated member asset transaction rollback after callback'
  }
  if (thrown && rollback.state.calls.includes('transaction.rollback') && !rollback.state.calls.includes('transaction.commit') && rollback.state.pendingDeletes.length === 0 && rollback.state.committedDeletes.length === 0) {
    pass(`15.${branch} callback 执行后 transaction rollback 仍不提交 AiResumeResult 或 JobAiSession 删除`)
  } else {
    fail(`15.${branch} callback 后 rollback 不得提交删除 thrown=${thrown} calls=${rollback.state.calls.join(',')} pending=${rollback.state.pendingDeletes.join(',')} committed=${rollback.state.committedDeletes.join(',')}`)
  }

  const concurrentGone = createMemberDeleteRun(branch, 'success', 0)
  const concurrentGoneService = new MemberAssetsService(concurrentGone.prisma as never)
  let concurrentGoneCode: string | undefined
  try {
    await concurrentGoneService.deleteAiRecord('member-delete-owner', `member-delete-${branch}`)
  } catch (error) {
    concurrentGoneCode = errCode(error)
  }
  const sessionDeleteCalled = concurrentGone.state.calls.some((call) => call.endsWith('jobAiSession.deleteMany'))
  if (concurrentGoneCode === 'MEMBER_RECORD_NOT_FOUND' && !sessionDeleteCalled && concurrentGone.state.committedDeletes.length === 0) {
    pass(`16.${branch} 并发删除使结果 deleteMany=0 时不删会话，统一 MEMBER_RECORD_NOT_FOUND`)
  } else {
    fail(`16.${branch} deleteMany=0 不得删会话或暴露删除状态 code=${concurrentGoneCode ?? 'none'} calls=${concurrentGone.state.calls.join(',')} committed=${concurrentGone.state.committedDeletes.join(',')}`)
  }
}

async function main() {
  console.log('\n=== Phase C-2B 会员资产中心只读 API 归属验证 ===')

  // 先跑纯内存事务门禁：即使本机 Prisma runtime 尚未注入 $transaction，也能明确暴露契约 RED。
  await verifyMemberAssetDeletionTransaction('parse')
  await verifyMemberAssetDeletionTransaction('job_fit')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new MemberAssetsService(prisma)
  const firstPage = { cursor: null, pageSize: 20 }

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userA = `eu_ma_a_${suffix}`
  const userB = `eu_ma_b_${suffix}`
  const userC = `eu_ma_c_${suffix}` // 无任何资产 → 空列表
  const future = new Date(Date.now() + 60 * 60 * 1000)
  const past = new Date(Date.now() - 60 * 60 * 1000)

  const taskA = `ma_task_a_${suffix}`       // A 的简历（parse + optimize）
  const taskAExpired = `ma_task_aexp_${suffix}` // A 的过期 parse（应被排除）
  const taskB = `ma_task_b_${suffix}`       // B 的简历
  const taskJobFit = `ma_task_jobfit_${suffix}`
  // AiResumeResult 的 taskId + kind 为全局唯一；B 的 job_fit / career_plan sentinel 用独立任务，
  // 但其 match session 仍与 A 的 taskJobFit 相同，专测 endUserId 不能被级联越权忽略。
  const taskJobFitOtherUser = `ma_task_jobfit_other_${suffix}`
  const allTaskIds = [taskA, taskAExpired, taskB, taskJobFit, taskJobFitOtherUser]
  const fileA = `ma_file_a_${suffix}`
  const fileADeleted = `ma_file_adel_${suffix}`
  const fileB = `ma_file_b_${suffix}`
  const allFileIds = [fileA, fileADeleted, fileB]

  async function cleanup() {
    await prisma.jobAiSession.deleteMany({ where: { resumeTaskId: { in: allTaskIds } } })
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
    const rowParseA = await prisma.aiResumeResult.create({ data: { taskId: taskA, kind: 'parse', status: 'completed', payloadJson: JSON.stringify({ report: { secret: 'RESUME-RAW-A' } }), provider: 'mock', expiresAt: future, endUserId: userA } })
    await prisma.aiResumeResult.create({ data: { taskId: taskA, kind: 'optimize', status: 'completed', payloadJson: JSON.stringify({ modules: [{ after: 'RESUME-RAW-A-OPT' }] }), provider: 'mock', expiresAt: future, endUserId: userA } })
    await prisma.aiResumeResult.create({ data: { taskId: taskA, kind: 'job_fit', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userA } })
    await prisma.aiResumeResult.create({ data: { taskId: taskA, kind: 'career_plan', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userA } })
    await prisma.aiResumeResult.create({ data: { taskId: taskAExpired, kind: 'parse', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: past, endUserId: userA } })
    // ── B 的 parse ──
    await prisma.aiResumeResult.create({ data: { taskId: taskB, kind: 'parse', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userB } })
    const rowJobFitParseA = await prisma.aiResumeResult.create({ data: { taskId: taskJobFit, kind: 'parse', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userA } })
    const rowJobFitA = await prisma.aiResumeResult.create({ data: { taskId: taskJobFit, kind: 'job_fit', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userA } })
    const rowCareerPlanA = await prisma.aiResumeResult.create({ data: { taskId: taskJobFit, kind: 'career_plan', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userA } })
    const rowJobFitB = await prisma.aiResumeResult.create({ data: { taskId: taskJobFitOtherUser, kind: 'job_fit', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userB } })
    const rowCareerPlanB = await prisma.aiResumeResult.create({ data: { taskId: taskJobFitOtherUser, kind: 'career_plan', status: 'completed', payloadJson: '{}', provider: 'mock', expiresAt: future, endUserId: userB } })
    await prisma.jobAiSession.createMany({ data: [
      { endUserId: userA, resumeTaskId: taskA, operation: 'match', status: 'completed', expiresAt: future },
      { endUserId: userA, resumeTaskId: taskA, operation: 'recommend', status: 'completed', expiresAt: future },
      { endUserId: userA, resumeTaskId: taskA, operation: 'explain', status: 'completed', expiresAt: future },
      { endUserId: userA, resumeTaskId: taskJobFit, operation: 'match', status: 'completed', expiresAt: future },
      { endUserId: userA, resumeTaskId: taskJobFit, operation: 'recommend', status: 'completed', expiresAt: future },
      { endUserId: userA, resumeTaskId: taskJobFit, operation: 'explain', status: 'completed', expiresAt: future },
      { endUserId: userB, resumeTaskId: taskJobFit, operation: 'match', status: 'completed', expiresAt: future },
    ] })

    // ── A 的文件：active(未过期) + 软删 ──；B 的文件 ──
    await prisma.fileObject.create({ data: { id: fileA, storageKey: `ma/${fileA}.pdf`, filename: '简历A.pdf', mimeType: 'application/pdf', sizeBytes: 1234, sha256: 'SHA-A-SECRET', purpose: 'resume', expiresAt: future, endUserId: userA, ownerType: 'user', ownerId: userA, status: 'active' } })
    await prisma.fileObject.create({ data: { id: fileADeleted, storageKey: `ma/${fileADeleted}.pdf`, filename: '已删A.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x', purpose: 'resume', expiresAt: future, endUserId: userA, ownerType: 'user', ownerId: userA, status: 'deleted', deletedAt: new Date() } })
    await prisma.fileObject.create({ data: { id: fileB, storageKey: `ma/${fileB}.pdf`, filename: '简历B.pdf', mimeType: 'application/pdf', sizeBytes: 4321, sha256: 'SHA-B', purpose: 'resume', expiresAt: future, endUserId: userB, ownerType: 'user', ownerId: userB, status: 'active' } })

    // ── 1. 本人可读 ──────────────────────────────────────────────
    const resA = (await svc.listResumes(userA, firstPage)).items
    if (resA.length === 2 && resA.some((row) => row.taskId === taskA && row.optimized) && resA.some((row) => row.taskId === taskJobFit && !row.optimized)) pass('1. 本人可读简历：A 得到 2 条未过期 parse，优化状态正确')
    else fail(`1. A 简历列表异常：${JSON.stringify(resA)}`)

    const docA = (await svc.listDocuments(userA, firstPage)).items
    if (docA.length === 1 && docA[0].id === fileA && docA[0].downloadUrlPath === `/files/${fileA}/download-url`) pass('2. 本人可读文档：A 得到 1 个 active 文件（软删已排除），含临时访问端点路径')
    else fail(`2. A 文档列表异常：${JSON.stringify(docA)}`)

    const aiA = (await svc.listAiRecords(userA, firstPage)).items
    if (aiA.length === 7 && aiA.every((r) => r.taskId === taskA || r.taskId === taskJobFit)) pass('3. 本人可读 AI 记录：A 得到全部未过期派生记录')
    else fail(`3. A AI 记录异常：${JSON.stringify(aiA)}`)

    // ── 2. 跨用户隔离（双向）─────────────────────────────────────
    const resB = (await svc.listResumes(userB, firstPage)).items
    const docB = (await svc.listDocuments(userB, firstPage)).items
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
      JSON.stringify((await svc.listResumes(userC, firstPage)).items) === '[]' &&
      JSON.stringify((await svc.listDocuments(userC, firstPage)).items) === '[]' &&
      JSON.stringify((await svc.listAiRecords(userC, firstPage)).items) === '[]'
    if (emptyOk) pass('6. 空列表返回 []（无资产会员 C）')
    else fail('6. 空列表未返回 []')

    // ── 5. 匿名 / 失效鉴权拒绝（EndUserAuthGuard）────────────────
    const guardNoToken = new EndUserAuthGuard({} as never, {} as never, {} as never)
    await expectGuardCode(() => guardNoToken.canActivate(mockCtx({})), 'MEMBER_MISSING_TOKEN', '7. 匿名（无 Authorization）→ 401 MEMBER_MISSING_TOKEN')

    const jwtThrows = { verify: () => { throw new Error('bad') } } as never
    const guardBad = new EndUserAuthGuard(jwtThrows, {} as never, {} as never)
    await expectGuardCode(() => guardBad.canActivate(mockCtx({ authorization: 'Bearer bad.token' })), 'MEMBER_TOKEN_INVALID', '8. 错 token → 401 MEMBER_TOKEN_INVALID')

    const jwtOk = { verify: () => ({ sub: userA, jti: 'sess-x' }) } as never
    const redisNull = { get: async () => null } as never
    const guardNoSession = new EndUserAuthGuard(jwtOk, redisNull, {} as never)
    await expectGuardCode(() => guardNoSession.canActivate(mockCtx({ authorization: 'Bearer ok.token' })), 'MEMBER_SESSION_EXPIRED', '9. 有效 token 但无 Redis 会话 → 401 MEMBER_SESSION_EXPIRED')

    // ── 6. 正向：有效 token + 会话 → 通过并注入 endUser ──────────
    const redisOk = { get: async () => userA } as never
    const prismaEnabled = { endUser: { findUnique: async () => ({ enabled: true }) } } as never
    const guardOk = new EndUserAuthGuard(jwtOk, redisOk, prismaEnabled)
    const ctx = mockCtx({ authorization: 'Bearer ok.token' })
    const allowed = await guardOk.canActivate(ctx)
    const injected = (ctx.switchToHttp().getRequest() as { endUser?: { endUserId: string } }).endUser
    if (allowed === true && injected?.endUserId === userA) pass('10. 有效会员 token + 会话 → 通过并注入本人 endUserId')
    else fail('10. 有效会员鉴权未通过或未注入 endUser')

    // ── 7. 删除 parse：删除同 task 的所有派生结果和全部会话，文件仍由文档资产管理 ──
    await svc.deleteAiRecord(userA, rowParseA.id)
    const parseCascade = await prisma.aiResumeResult.count({ where: { endUserId: userA, taskId: taskA } })
    const parseSessions = await prisma.jobAiSession.count({ where: { endUserId: userA, resumeTaskId: taskA } })
    const fileAfterParseDelete = await prisma.fileObject.findUnique({ where: { id: fileA }, select: { id: true } })
    const parseExplainSessions = await prisma.jobAiSession.count({ where: { endUserId: userA, resumeTaskId: taskA, operation: 'explain' } })
    if (parseCascade === 0 && parseSessions === 0 && parseExplainSessions === 0 && fileAfterParseDelete?.id === fileA) {
      pass('11. 删除 parse：同 taskId 全 kind 与 match/recommend/explain 全会话删除，FileObject 保持存活')
    } else {
      fail(`11. parse 级联不完整 results=${parseCascade} allSessions=${parseSessions} explain=${parseExplainSessions} file=${fileAfterParseDelete?.id ?? 'missing'}`)
    }

    // ── 8. 删除 job_fit：仅删除该结果和对应 match 会话，不能吞掉同任务其它资产 ──
    await svc.deleteAiRecord(userA, rowJobFitA.id)
    const jobFitRow = await prisma.aiResumeResult.findUnique({ where: { id: rowJobFitA.id }, select: { id: true } })
    const jobFitParse = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId: taskJobFit, kind: 'parse' } }, select: { id: true } })
    const jobFitCareerPlanA = await prisma.aiResumeResult.findUnique({ where: { id: rowCareerPlanA.id }, select: { id: true } })
    const jobFitRowB = await prisma.aiResumeResult.findUnique({ where: { id: rowJobFitB.id }, select: { id: true } })
    const jobFitCareerPlanB = await prisma.aiResumeResult.findUnique({ where: { id: rowCareerPlanB.id }, select: { id: true } })
    const matchSessions = await prisma.jobAiSession.count({ where: { endUserId: userA, resumeTaskId: taskJobFit, operation: 'match' } })
    const recommendSessions = await prisma.jobAiSession.count({ where: { endUserId: userA, resumeTaskId: taskJobFit, operation: 'recommend' } })
    const explainSessions = await prisma.jobAiSession.count({ where: { endUserId: userA, resumeTaskId: taskJobFit, operation: 'explain' } })
    const otherMemberMatchSessions = await prisma.jobAiSession.count({ where: { endUserId: userB, resumeTaskId: taskJobFit, operation: 'match' } })
    const fileAfterJobFitDelete = await prisma.fileObject.findUnique({ where: { id: fileA }, select: { id: true } })
    if (!jobFitRow && jobFitParse && jobFitCareerPlanA && jobFitRowB && jobFitCareerPlanB && matchSessions === 0 && recommendSessions === 1 && explainSessions === 1 && otherMemberMatchSessions === 1 && fileAfterJobFitDelete?.id === fileA) {
      pass("12. 删除 job_fit：只删本人 job_fit+match，career_plan/recommend/explain/他人结果与会话保持")
    } else {
      fail(`12. job_fit 级联异常 ownRow=${Boolean(jobFitRow)} ownParse=${Boolean(jobFitParse)} ownCareer=${Boolean(jobFitCareerPlanA)} otherJobFit=${Boolean(jobFitRowB)} otherCareer=${Boolean(jobFitCareerPlanB)} ownMatch=${matchSessions} ownRecommend=${recommendSessions} ownExplain=${explainSessions} otherMatch=${otherMemberMatchSessions} file=${fileAfterJobFitDelete?.id ?? 'missing'}`)
    }

    // ── 9. 未知/他人 ID 保持不泄露的统一 404，且不能误删本人数据 ──
    for (const [recordId, label] of [['missing-record', '未知记录'], [rowJobFitParseA.id, '他人记录']] as const) {
      try {
        await svc.deleteAiRecord(userB, recordId)
        fail(`13. ${label}应统一拒绝`)
      } catch (error) {
        if (errCode(error) !== 'MEMBER_RECORD_NOT_FOUND') fail(`13. ${label}错误码不一致: ${errCode(error)}`)
      }
    }
    const ownedRowStillExists = await prisma.aiResumeResult.findUnique({ where: { id: rowJobFitParseA.id }, select: { id: true } })
    if (!ownedRowStillExists) fail('13. 他人删除失败后本人记录不应消失')
    else pass('13. 未知/他人 recordId 统一 MEMBER_RECORD_NOT_FOUND 且不删除数据')

  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 会员资产删除治理未通过\n`)
    process.exit(1)
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
