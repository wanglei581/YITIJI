/**
 * 岗位 AI 用户同意 / 隐私 / 配额治理门禁。
 *
 * 覆盖：
 *   1. 会员 AI 同意、撤回与数据权利 API 使用各自唯一状态真相源。
 *   2. Job AI recommendations / match 在 LLM 前强制检查会员同意和 Redis 配额。
 *   3. explain 不读取简历，但必须进入 Redis 配额。
 *   4. 配额必须用 Redis，禁止内存 Map 伪配额；Redis 异常必须 fail-closed。
 *   5. 隐私治理不保存简历原文、完整 prompt/output、签名 URL 或招聘闭环状态。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-ai-privacy
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

async function main(): Promise<void> {
  console.log('\n=== 岗位 AI 用户同意 / 隐私 / 配额治理门禁 ===')

  const moduleFile = mustExist('src/member-privacy/member-privacy.module.ts', 'MemberPrivacyModule 已创建')
  const memberController = mustExist('src/member-privacy/member-privacy.controller.ts', 'MemberPrivacyController 已创建')
  const adminController = mustExist('src/member-privacy/admin-member-privacy.controller.ts', 'AdminMemberPrivacyController 已创建')
  const privacyService = mustExist('src/member-privacy/member-privacy.service.ts', 'MemberPrivacyService 已创建')
  const requestService = mustExist('src/member-privacy/member-data-request.service.ts', 'MemberDataRequestService 已创建')
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
    [
      'MemberPrivacyController',
      'MemberDataRequestController',
      'AdminMemberPrivacyController',
      'MemberDataExportController',
      'MemberPrivacyService',
      'MemberDataRequestService',
      'MemberAuthModule',
      'AuthModule',
    ],
    'MemberPrivacyModule 通过鉴权模块注册唯一会员/Admin/下载入口',
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
      "@Post('data-requests/:id/retry')",
      "@Post('data-requests/:id/reject')",
      'this.requests.retry',
      'this.requests.reject',
    ],
    'Admin 隐私 API 只支持列表与明确 retry/reject 动作',
  )
  mustNotContain(adminController, ["@Patch('data-requests/:id')"], 'Admin 不再提供 arbitrary status PATCH')

  mustContain(
    privacyService,
    [
      'CURRENT_JOB_AI_CONSENT_VERSION',
      'grantConsent',
      'revokeConsent',
      'getConsentStatus',
      'requireActiveConsent',
      'userAiConsent',
      'userAiConsent.updateMany',
      'revokedAt',
      'USER_AI_CONSENT_REQUIRED',
    ],
    'MemberPrivacyService 只负责 UserAiConsent 同意真相',
  )

  mustNotContain(
    privacyService,
    [
      'createDataRequest',
      'listMyDataRequests',
      'listDataRequestsForAdmin',
      'handleDataRequest',
      'deleteJobAiPersonalData',
      'aiResumeResult.deleteMany',
      'jobAiSession.deleteMany',
    ],
    'MemberPrivacyService 不保留数据请求双写或部分删除路径',
  )

  mustContain(
    requestService,
    [
      'MemberDataRequestService',
      'ACCOUNT_CLOSURE_NOT_AVAILABLE',
      'export_data_request',
      'writeRequired',
      'activeKey',
      'idempotencyKey',
      'MEMBER_EXPORT_JOB',
    ],
    'MemberDataRequestService 独占幂等、step-up、activeKey 与异步导出创建',
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
    [memberController, adminController, privacyService, requestService, quotaService, jobAiService, governedJobFit].join('\n'),
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
