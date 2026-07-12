/**
 * 岗位 AI 用户同意 / 隐私 / 配额治理门禁。
 *
 * 覆盖：
 *   1. 会员 AI 同意、撤回、数据请求和 Admin 处理 API 存在。
 *   2. Job AI recommendations / match 在 LLM 前强制检查会员同意和 Redis 配额。
 *   3. explain 不读取简历，但必须进入 Redis 配额。
 *   4. 配额必须用 Redis，禁止内存 Map 伪配额；Redis 异常必须 fail-closed。
 *   5. 隐私治理不保存简历原文、完整 prompt/output、签名 URL 或招聘闭环状态。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-ai-privacy
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

function mustExist(rel: string, label: string): string {
  const abs = join(process.cwd(), rel)
  if (!existsSync(abs)) {
    fail(`${label} — 文件缺失: ${rel}`)
    return ''
  }
  pass(label)
  return readFileSync(abs, 'utf8')
}

function mustContain(source: string, markers: string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(source: string, markers: string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

type PrivacyDeleteRun = {
  calls: string[]
  auditWrites: Array<{ payload?: Record<string, unknown> }>
  pendingDeletes: string[]
  committedDeletes: string[]
  pendingRequestStatus: string | null
  requestStatus: string
}

type PrivacyTransactionMode = 'success' | 'before_callback_rollback' | 'after_callback_rollback'

function createPrivacyDeleteRun(transactionMode: PrivacyTransactionMode): {
  prisma: object
  audit: object
  state: PrivacyDeleteRun
} {
  const state: PrivacyDeleteRun = {
    calls: [],
    auditWrites: [],
    pendingDeletes: [],
    committedDeletes: [],
    pendingRequestStatus: null,
    requestStatus: 'pending',
  }
  const existing = {
    id: 'privacy-delete-request',
    endUserId: 'privacy-delete-member',
    requestType: 'delete',
    status: 'pending',
    requestedAt: new Date('2026-07-12T00:00:00.000Z'),
    handledAt: null,
    handledBy: null,
    auditRef: null,
  }
  const updateRequest = async (scope: 'transaction' | 'direct', args: { data: { status: string } }) => {
    state.calls.push(`${scope}.userDataRequest.update`)
    if (scope === 'transaction') state.pendingRequestStatus = args.data.status
    else state.requestStatus = args.data.status
    return {
      ...existing,
      status: args.data.status,
      handledAt: new Date('2026-07-12T00:00:01.000Z'),
      handledBy: 'admin-delete',
      auditRef: 'audit-delete',
    }
  }
  const transactionClient = {
    aiResumeResult: {
      deleteMany: async () => {
        state.calls.push('transaction.aiResumeResult.deleteMany')
        state.pendingDeletes.push('transaction.aiResumeResult.deleteMany')
        return { count: 3 }
      },
    },
    jobAiSession: {
      deleteMany: async () => {
        state.calls.push('transaction.jobAiSession.deleteMany')
        state.pendingDeletes.push('transaction.jobAiSession.deleteMany')
        return { count: 2 }
      },
    },
    userAiConsent: {
      updateMany: async () => {
        state.calls.push('transaction.userAiConsent.updateMany')
        state.pendingDeletes.push('transaction.userAiConsent.updateMany')
        return { count: 1 }
      },
    },
    userDataRequest: {
      update: (args: { data: { status: string } }) => updateRequest('transaction', args),
    },
  }
  const prisma = {
    $transaction: async (input: ((tx: typeof transactionClient) => Promise<unknown>) | Promise<unknown>[]) => {
      state.calls.push('transaction.begin')
      if (transactionMode === 'before_callback_rollback') {
        state.calls.push('transaction.rollback')
        throw new Error('simulated transaction rollback before callback')
      }
      try {
        const result = await (typeof input === 'function' ? input(transactionClient) : Promise.all(input))
        if (transactionMode === 'after_callback_rollback') {
          throw new Error('simulated transaction rollback after callback')
        }
        state.calls.push('transaction.commit')
        state.committedDeletes.push(...state.pendingDeletes)
        state.pendingDeletes.length = 0
        if (state.pendingRequestStatus) {
          state.requestStatus = state.pendingRequestStatus
          state.pendingRequestStatus = null
        }
        return result
      } catch (error) {
        state.calls.push('transaction.rollback')
        state.pendingDeletes.length = 0
        state.pendingRequestStatus = null
        throw error
      }
    },
    aiResumeResult: {
      deleteMany: async () => {
        state.calls.push('direct.aiResumeResult.deleteMany')
        state.committedDeletes.push('direct.aiResumeResult.deleteMany')
        return { count: 3 }
      },
    },
    jobAiSession: {
      deleteMany: async () => {
        state.calls.push('direct.jobAiSession.deleteMany')
        state.committedDeletes.push('direct.jobAiSession.deleteMany')
        return { count: 2 }
      },
    },
    userAiConsent: {
      updateMany: async () => {
        state.calls.push('direct.userAiConsent.updateMany')
        state.committedDeletes.push('direct.userAiConsent.updateMany')
        return { count: 1 }
      },
    },
    userDataRequest: {
      findUnique: async () => existing,
      update: (args: { data: { status: string } }) => updateRequest('direct', args),
    },
  }
  const audit = {
    write: async (args: { payload?: Record<string, unknown> }) => {
      state.calls.push('audit.write')
      state.auditWrites.push(args)
      return 'audit-delete'
    },
  }
  return { prisma, audit, state }
}

async function verifyDeleteDataRightsTransaction(): Promise<void> {
  const success = createPrivacyDeleteRun('success')
  const service = new MemberPrivacyService(success.prisma as never, success.audit as never)
  await service.handleDataRequest('privacy-delete-request', {
    status: 'completed',
    handledBy: 'admin-delete',
  })

  const transactionDeletes = [
    'transaction.aiResumeResult.deleteMany',
    'transaction.jobAiSession.deleteMany',
    'transaction.userAiConsent.updateMany',
  ]
  if (transactionDeletes.every((call) => success.state.calls.includes(call))) {
    pass('数据权利删除在同一 transaction 内删除 AI 结果、会话并撤回有效授权')
  } else {
    fail(`数据权利删除缺少 transaction 操作: ${transactionDeletes.filter((call) => !success.state.calls.includes(call)).join(' | ')}`)
  }

  const auditIndex = success.state.calls.indexOf('audit.write')
  const transactionCommitIndex = success.state.calls.indexOf('transaction.commit')
  const lastTransactionDelete = Math.max(...transactionDeletes.map((call) => success.state.calls.indexOf(call)))
  const transactionUpdateIndex = success.state.calls.indexOf('transaction.userDataRequest.update')
  const directUpdateIndex = success.state.calls.indexOf('direct.userDataRequest.update')
  const auditPayload = success.state.auditWrites[0]?.payload ?? {}
  const auditPayloadJson = JSON.stringify(auditPayload)
  const exactCounts =
    auditPayload['aiResumeResultsDeleted'] === 3 &&
    auditPayload['jobAiSessionsDeleted'] === 2 &&
    auditPayload['consentsRevoked'] === 1
  const requestUpdatedInTransaction = transactionUpdateIndex > lastTransactionDelete && transactionUpdateIndex < auditIndex
  const requestUpdatedAfterAudit = directUpdateIndex > auditIndex
  if (transactionCommitIndex > lastTransactionDelete && auditIndex > transactionCommitIndex && exactCounts && success.state.requestStatus === 'completed' && (requestUpdatedInTransaction || requestUpdatedAfterAudit) && !/payload|resume(Text|Content)?/i.test(auditPayloadJson)) {
    pass('数据权利删除 transaction commit 后才写审计；request 完成状态要么随 transaction 提交，要么在审计成功后更新')
  } else {
    fail(`数据权利删除 transaction/审计/request 顺序或内容错误 calls=${success.state.calls.join(',')} status=${success.state.requestStatus} payload=${auditPayloadJson}`)
  }

  const failedTransaction = createPrivacyDeleteRun('after_callback_rollback')
  const failingService = new MemberPrivacyService(failedTransaction.prisma as never, failedTransaction.audit as never)
  let thrown = false
  try {
    await failingService.handleDataRequest('privacy-delete-request', {
      status: 'completed',
      handledBy: 'admin-delete',
    })
  } catch (error) {
    thrown = (error as Error).message === 'simulated transaction rollback after callback'
  }
  if (thrown && failedTransaction.state.calls.includes('transaction.rollback') && !failedTransaction.state.calls.includes('transaction.commit') && failedTransaction.state.auditWrites.length === 0 && failedTransaction.state.requestStatus === 'pending' && failedTransaction.state.pendingDeletes.length === 0 && failedTransaction.state.committedDeletes.length === 0) {
    pass('callback 后 transaction rollback 时不提交三类删除、不写审计且不更新数据请求状态')
  } else {
    fail(`callback 后 rollback 不得提交/审计/更新 request thrown=${thrown} calls=${failedTransaction.state.calls.join(',')} audit=${failedTransaction.state.auditWrites.length} status=${failedTransaction.state.requestStatus} pending=${failedTransaction.state.pendingDeletes.join(',')} committed=${failedTransaction.state.committedDeletes.join(',')}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== 岗位 AI 用户同意 / 隐私 / 配额治理门禁 ===')

  const moduleFile = mustExist('src/member-privacy/member-privacy.module.ts', 'MemberPrivacyModule 已创建')
  const memberController = mustExist('src/member-privacy/member-privacy.controller.ts', 'MemberPrivacyController 已创建')
  const adminController = mustExist('src/member-privacy/admin-member-privacy.controller.ts', 'AdminMemberPrivacyController 已创建')
  const privacyService = mustExist('src/member-privacy/member-privacy.service.ts', 'MemberPrivacyService 已创建')
  const privacyTypes = mustExist('src/member-privacy/member-privacy.types.ts', 'MemberPrivacy types 已创建')
  const quotaService = mustExist('src/job-ai/job-ai-quota.service.ts', 'JobAiQuotaService 已创建')
  const jobAiService = read('src/job-ai/job-ai.service.ts')
  const governedJobFit = mustExist('src/job-ai/governed-job-fit.service.ts', 'GovernedJobFitService 已创建')
  const jobAiController = read('src/job-ai/job-ai.controller.ts')
  const prisma = read('src/prisma/prisma.service.ts')
  const appModule = read('src/app.module.ts')
  const packageJson = read('package.json')
  const ci = read('../../.github/workflows/ci.yml')

  mustContain(
    moduleFile,
    ['MemberPrivacyController', 'AdminMemberPrivacyController', 'MemberPrivacyService', 'EndUserAuthGuard', 'JwtAuthGuard', 'RolesGuard'],
    'MemberPrivacyModule 注册会员端 / Admin 端 controller 和 guards',
  )

  mustContain(
    memberController,
    [
      "@Controller('me/ai-consents')",
      '@UseGuards(EndUserAuthGuard)',
      '@CurrentEndUser()',
      "@Get('status')",
      '@Post()',
      "@Post(':scope/revoke')",
      "@Controller('me/data-requests')",
      "requestType: 'export' | 'delete' | 'revoke_consent'",
    ],
    '会员端隐私 API 支持授权状态、授权、撤回和数据请求',
  )

  mustContain(
    adminController,
    [
      "@Controller('admin/member-privacy')",
      '@UseGuards(JwtAuthGuard, RolesGuard)',
      "@Roles('admin')",
      "@Get('data-requests')",
      "@Patch('data-requests/:id')",
      'handledBy',
      'auditRef',
    ],
    'Admin 隐私 API 支持数据请求列表和处理留痕',
  )

  mustContain(
    privacyService,
    [
      'CURRENT_JOB_AI_CONSENT_VERSION',
      'grantConsent',
      'revokeConsent',
      'getConsentStatus',
      'requireActiveConsent',
      'createDataRequest',
      'listDataRequestsForAdmin',
      'handleDataRequest',
      'userAiConsent',
      'userAiConsent.updateMany',
      'userDataRequest',
      'deleteJobAiPersonalData',
      '$transaction',
      'aiResumeResult.deleteMany',
      'aiResumeResultsDeleted',
      'jobAiSession.deleteMany',
      'jobAiSessionsDeleted',
      'consentsRevoked',
      'revokedAt',
      'USER_AI_CONSENT_REQUIRED',
    ],
    'MemberPrivacyService 使用现有 UserAiConsent / UserDataRequest 实现同意和数据请求',
  )

  mustContain(
    privacyTypes,
    [
      "export type MemberDataRequestType = 'export' | 'delete' | 'revoke_consent'",
      "export type MemberAiConsentScope = 'job_ai'",
      'MemberAiConsentStatus',
      'MemberDataRequestItem',
    ],
    'MemberPrivacy types 收敛 requestType 和 consent scope 字面量',
  )

  mustContain(
    quotaService,
    [
      'JobAiQuotaService',
      'consume',
      'incrWithTtl',
      'JOB_AI_QUOTA_EXCEEDED',
      'JOB_AI_QUOTA_UNAVAILABLE',
      'rollback',
      'decr',
      '8 * 60 * 60 * 1000',
      'createHash',
      'sha256',
      'member',
      'terminal',
      'ip',
    ],
    'JobAiQuotaService 使用 Redis 日配额和脱敏维度 key',
  )

  mustNotContain(
    quotaService,
    ['new Map(', 'Map<string', 'globalThis'],
    'JobAiQuotaService 禁止内存 Map / global 配额兜底',
  )

  mustContain(
    jobAiController,
    [
      'ip?: string',
      'socket?:',
      'ipOf(req)',
      'quotaContextOf(req',
      'x-terminal-id',
    ],
    'JobAiController 提供 terminal/IP/member 配额上下文',
  )

  mustContain(
    jobAiService,
    [
      'MemberPrivacyService',
      'JobAiQuotaService',
      'assertResumeAiConsent',
      'requireActiveConsent',
      'consumeJobAiQuota',
      'createSession',
      'llm.recommend',
      'this.governed.matchForMember',
      'llm.explain',
    ],
    'JobAiService 的 recommendations/explain 保持 consent + quota，match 委托治理服务',
  )

  mustContain(
    governedJobFit,
    [
      'authorizeParseForJobFit',
      'requireActiveAnonymousJobFitConsent',
      'requireActiveConsent',
      "this.quota.consume('match'",
      "operation: 'match'",
      'this.quota.rollback',
      "operation: 'jobMatch'",
    ],
    'GovernedJobFitService 在会话创建和 LLM 调用前接入 consent + quota',
  )

  mustContain(prisma, ['get userDataRequest()'], 'PrismaService 暴露 userDataRequest delegate')
  mustContain(appModule, ['MemberPrivacyModule'], 'AppModule 接入 MemberPrivacyModule')
  mustContain(packageJson, ['"verify:job-ai-privacy"'], 'package.json 注册 verify:job-ai-privacy')
  mustContain(ci, ['verify:job-ai-privacy'], 'CI 串行 verify 接入岗位 AI 隐私门禁')

  mustNotContain(
    [memberController, adminController, privacyService, quotaService, jobAiService, governedJobFit].join('\n'),
    [
      'resumeText:',
      'resumeContent',
      'fileContent',
      'fileName',
      'fullPrompt',
      'promptJson',
      'outputJson',
      'completionText',
      'signedUrl',
      'Signature=',
      'X-Cos-',
      'applicationStatus',
      'deliveryStatus',
      'candidateStatus',
      'interviewInvite',
      'offerStatus',
      '投递状态',
    ],
    '隐私治理和 Job AI 不持久化简历原文、完整模型内容、签名 URL 或招聘闭环状态',
  )

  await verifyDeleteDataRightsTransaction()

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 岗位 AI 隐私 / 配额门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 岗位 AI 用户同意 / 隐私 / 配额治理门禁一致\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
