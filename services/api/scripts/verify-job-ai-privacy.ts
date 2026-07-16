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

type PrivacyTransitionType = 'export' | 'delete' | 'revoke_consent'

function exceptionCode(error: unknown): string | undefined {
  const exception = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof exception.getResponse === 'function' ? exception.getResponse() : exception.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

function createPrivacyTransitionRun(requestType: PrivacyTransitionType) {
  const state = {
    calls: [] as string[],
    auditWrites: 0,
    requestStatus: 'pending',
  }
  const existing = {
    id: `privacy-${requestType}-request`,
    endUserId: 'privacy-member',
    requestType,
    status: 'pending',
    requestedAt: new Date('2026-07-16T00:00:00.000Z'),
    handledAt: null,
    handledBy: null,
    auditRef: null,
  }
  const recordUnexpectedDelete = (call: string) => async () => {
    state.calls.push(call)
    return { count: 1 }
  }
  const prisma = {
    $transaction: async () => {
      state.calls.push('$transaction')
      throw new Error('unexpected privacy transaction')
    },
    aiResumeResult: { deleteMany: recordUnexpectedDelete('aiResumeResult.deleteMany') },
    jobAiSession: { deleteMany: recordUnexpectedDelete('jobAiSession.deleteMany') },
    userAiConsent: { updateMany: recordUnexpectedDelete('userAiConsent.updateMany') },
    userDataRequest: {
      findUnique: async () => {
        state.calls.push('userDataRequest.findUnique')
        return existing
      },
      update: async (args: {
        data: { status: string; handledBy: string; auditRef: string | null; handledAt: Date | null }
      }) => {
        state.calls.push('userDataRequest.update')
        state.requestStatus = args.data.status
        return { ...existing, ...args.data }
      },
    },
  }
  const audit = {
    write: async () => {
      state.calls.push('audit.write')
      state.auditWrites += 1
      return 'audit-wave0'
    },
  }
  return { prisma, audit, state }
}

async function verifyFailClosedDataRequestTransitions(): Promise<void> {
  const blockedCases: Array<{
    requestType: 'export' | 'delete'
    status: 'completed' | 'rejected'
    label: string
  }> = [
    { requestType: 'export', status: 'completed', label: 'export -> completed' },
    { requestType: 'delete', status: 'completed', label: 'delete -> completed' },
    { requestType: 'delete', status: 'rejected', label: 'delete -> rejected' },
  ]

  for (const testCase of blockedCases) {
    const run = createPrivacyTransitionRun(testCase.requestType)
    const service = new MemberPrivacyService(run.prisma as never, run.audit as never)
    let code: string | undefined
    try {
      await service.handleDataRequest(`privacy-${testCase.requestType}-request`, {
        status: testCase.status,
        handledBy: 'admin-wave0',
      })
    } catch (error) {
      code = exceptionCode(error)
    }
    const sideEffects = run.state.calls.filter((call) => call !== 'userDataRequest.findUnique')
    if (
      code === 'DATA_REQUEST_EXECUTION_INCOMPLETE' &&
      sideEffects.length === 0 &&
      run.state.auditWrites === 0 &&
      run.state.requestStatus === 'pending'
    ) {
      pass(`${testCase.label} fail closed，且不删除、不审计、不更新 request`)
    } else {
      fail(`${testCase.label} 未安全阻断 code=${code ?? 'none'} calls=${run.state.calls.join(',')} audit=${run.state.auditWrites} status=${run.state.requestStatus}`)
    }
  }

  const revokeRun = createPrivacyTransitionRun('revoke_consent')
  const revokeService = new MemberPrivacyService(revokeRun.prisma as never, revokeRun.audit as never)
  const revoked = await revokeService.handleDataRequest('privacy-revoke_consent-request', {
    status: 'completed',
    handledBy: 'admin-wave0',
  })
  if (
    revoked.status === 'completed' &&
    revokeRun.state.requestStatus === 'completed' &&
    revokeRun.state.auditWrites === 1 &&
    revokeRun.state.calls.join(',') === 'userDataRequest.findUnique,audit.write,userDataRequest.update'
  ) {
    pass('revoke_consent -> completed 保持真实审计与状态更新')
  } else {
    fail(`revoke_consent 完成路径回退 calls=${revokeRun.state.calls.join(',')} audit=${revokeRun.state.auditWrites} status=${revokeRun.state.requestStatus}`)
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
      'DATA_REQUEST_EXECUTION_INCOMPLETE',
      "existing.requestType === 'export'",
      "existing.requestType === 'delete'",
      'revokedAt',
      'USER_AI_CONSENT_REQUIRED',
    ],
    'MemberPrivacyService 使用现有 UserAiConsent / UserDataRequest 实现同意和数据请求',
  )

  mustNotContain(
    privacyService,
    ['deleteJobAiPersonalData', 'aiResumeResult.deleteMany', 'jobAiSession.deleteMany'],
    'MemberPrivacyService 不再以部分同步删除伪造 delete 完成态',
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

  await verifyFailClosedDataRequestTransitions()

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
