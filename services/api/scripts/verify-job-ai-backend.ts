/**
 * 岗位信息 AI 商用闭环 Task 4 后端门禁。
 *
 * 覆盖：
 *   1. Job AI 后端模块、controller、service、LLM 输出服务、上下文服务存在。
 *   2. recommendations / explain / match / me job-ai-sessions 路由存在。
 *   3. 推荐只读取 approved + published 真实岗位，并沉淀 JobAiSession / JobAiRecommendation。
 *   4. 匹配复用既有 JobFitService，不复制或绕过现有简历归属与输出防线。
 *   5. AiServiceLog 只落元数据，不保存简历原文、完整 prompt/output、签名 URL 或招聘闭环状态。
 *   6. 输出防线禁止百分比、录用概率、平台投递、候选人、面试邀约、Offer 等红线。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-ai-backend
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

function exceptionCode(error: unknown): string | undefined {
  const maybe = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof maybe.getResponse === 'function' ? maybe.getResponse() : maybe.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function verifyConsentFailClosed(): Promise<void> {
  const { JobAiService } = await import('../src/job-ai/job-ai.service')
  const { ForbiddenException } = await import('@nestjs/common')
  let sessionCreateCalled = false
  let quotaCalled = false
  const prisma = {
    aiResumeResult: {
      findUnique: async () => ({
        endUserId: 'enduser-consent-missing',
        accessTokenHash: null,
        expiresAt: new Date(Date.now() + 60_000),
        payloadJson: JSON.stringify({ fileId: 'file-consent' }),
      }),
    },
    jobAiSession: {
      create: async () => {
        sessionCreateCalled = true
        throw new Error('session should not be created without consent')
      },
    },
  }
  const service = new JobAiService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { record: () => undefined } as never,
    {
      requireActiveConsent: async () => {
        throw new ForbiddenException({ error: { code: 'USER_AI_CONSENT_REQUIRED', message: '请先确认 AI 简历分析授权' } })
      },
    } as never,
    {
      consume: async () => {
        quotaCalled = true
      },
    } as never,
  )
  try {
    await service.recommendations({ resumeTaskId: 'task-consent' }, { endUserId: 'enduser-consent-missing', accessToken: null })
    fail('运行时:缺少 job_ai 授权时 recommendations 应拒绝')
  } catch (error) {
    if (exceptionCode(error) === 'USER_AI_CONSENT_REQUIRED' && !sessionCreateCalled && !quotaCalled) {
      pass('运行时:缺少 job_ai 授权时 recommendations 在扣配额/创建 session/调用 LLM 前 fail-closed')
    } else {
      fail(`运行时:缺少授权时错误异常 code=${exceptionCode(error) ?? (error as Error).message}, sessionCreateCalled=${sessionCreateCalled}, quotaCalled=${quotaCalled}`)
    }
  }
}

async function verifyDecimalPercentBlocked(): Promise<void> {
  const { JobAiLlmService } = await import('../src/job-ai/job-ai-llm.service')
  const service = new JobAiLlmService({} as never)
  const reason = service.findUnsafeOutputReason('该岗位匹配参考为 98.5%，建议立即投递')
  if (reason) pass('运行时:Job AI 输出防线可拦截小数百分比与投递诱导文案')
  else fail('运行时:Job AI 输出防线应拦截 98.5% 这类小数百分比')
}

async function verifyExplainRequiresMember(): Promise<void> {
  const { JobAiService } = await import('../src/job-ai/job-ai.service')
  let contextCalled = false
  let quotaCalled = false
  const service = new JobAiService(
    {} as never,
    {} as never,
    {
      buildTargetJobContext: async () => {
        contextCalled = true
        throw new Error('context should not be read before member auth')
      },
    } as never,
    {} as never,
    {} as never,
    { record: () => undefined } as never,
    {} as never,
    { consume: async () => { quotaCalled = true } } as never,
  )
  try {
    await service.explainJob('job-public', { endUserId: null, accessToken: null }, null)
    fail('运行时:未登录 explain 应拒绝')
  } catch (error) {
    if (exceptionCode(error) === 'END_USER_AUTH_REQUIRED' && !contextCalled && !quotaCalled) {
      pass('运行时:未登录 explain 在读岗位/调用 LLM 前 fail-closed')
    } else {
      fail(`运行时:未登录 explain 异常 code=${exceptionCode(error) ?? (error as Error).message}, contextCalled=${contextCalled}, quotaCalled=${quotaCalled}`)
    }
  }
}

async function verifyListMinePublishedJobFilter(): Promise<void> {
  const { JobAiService } = await import('../src/job-ai/job-ai.service')
  let countWhere: unknown
  let findManyArgs: unknown
  const service = new JobAiService(
    {
      jobAiSession: {
        count: async (args: unknown) => {
          countWhere = (args as { where?: unknown }).where
          return 0
        },
        findMany: async (args: unknown) => {
          findManyArgs = args
          return []
        },
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { record: () => undefined } as never,
    {} as never,
    {} as never,
  )
  await service.listMine('enduser-owned', { cursor: null, pageSize: 20 })
  const serialized = JSON.stringify({ countWhere, findManyArgs })
  if (
    serialized.includes('"recommendations"') &&
    serialized.includes('"some"') &&
    serialized.includes('"reviewStatus":"approved"') &&
    serialized.includes('"publishStatus":"published"')
  ) {
    pass('运行时:listMine 只统计和返回仍关联已发布岗位的会话')
  } else {
    fail(`运行时:listMine 缺少已发布岗位过滤: ${serialized}`)
  }
}

async function verifyDeleteMineOwnership(): Promise<void> {
  const { JobAiService } = await import('../src/job-ai/job-ai.service')
  let findFirstWhere: unknown
  let deleteCalled = false
  const service = new JobAiService(
    {
      jobAiSession: {
        findFirst: async (args: unknown) => {
          findFirstWhere = (args as { where?: unknown }).where
          return null
        },
        delete: async () => {
          deleteCalled = true
          throw new Error('delete should not run for non-owned session')
        },
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { record: () => undefined } as never,
    {} as never,
    {} as never,
  )
  try {
    await service.deleteMine('enduser-owner', 'session-other')
    fail('运行时:deleteMine 对非本人会话应拒绝')
  } catch (error) {
    const serialized = JSON.stringify(findFirstWhere)
    if (
      exceptionCode(error) === 'JOB_AI_SESSION_NOT_FOUND' &&
      !deleteCalled &&
      serialized.includes('"id":"session-other"') &&
      serialized.includes('"endUserId":"enduser-owner"')
    ) {
      pass('运行时:deleteMine 按本人 endUserId 查找，非本人不执行删除')
    } else {
      fail(`运行时:deleteMine 归属异常 code=${exceptionCode(error) ?? (error as Error).message}, where=${serialized}, deleteCalled=${deleteCalled}`)
    }
  }
}

async function verifyQuotaRollbackOnLlmFailure(): Promise<void> {
  const { JobAiService } = await import('../src/job-ai/job-ai.service')
  const { ServiceUnavailableException } = await import('@nestjs/common')
  let rollbackCalled = false
  const sessionRow = {
    id: 'session-rollback',
    resumeTaskId: 'task-rollback',
    operation: 'recommend',
    status: 'pending',
    provider: null,
    terminalId: 'terminal-rollback',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }
  const service = new JobAiService(
    {
      aiResumeResult: {
        findUnique: async () => ({
          endUserId: 'enduser-rollback',
          accessTokenHash: null,
          expiresAt: new Date(Date.now() + 60_000),
          payloadJson: JSON.stringify({ fileId: 'file-rollback' }),
        }),
      },
      job: {
        findMany: async () => ([{
          id: 'job-rollback',
          title: '前端工程师',
          company: '示例公司',
          sourceName: '客户岗位源',
          sourceUrl: 'https://example.com/jobs/1',
          externalId: 'EXT-1',
          description: '负责前端开发',
          requirements: '熟悉 React',
          skillsJson: JSON.stringify(['React']),
          city: '上海',
          category: 'fulltime',
        }]),
      },
      jobAiSession: {
        create: async () => sessionRow,
        update: async () => ({ ...sessionRow, status: 'failed', provider: 'llm' }),
      },
    } as never,
    {
      recommend: async () => {
        throw new ServiceUnavailableException({ error: { code: 'AI_TIMEOUT', message: 'AI 模型响应超时' } })
      },
    } as never,
    {} as never,
    {
      extractResumeText: async () => ({ ok: true, text: '候选人掌握 React 和 TypeScript' }),
    } as never,
    {} as never,
    { record: () => undefined } as never,
    { requireActiveConsent: async () => undefined } as never,
    {
      consume: async () => ({ keys: ['quota-key-rollback'] }),
      rollback: async (ticket: { keys?: string[] } | null) => {
        rollbackCalled = ticket?.keys?.includes('quota-key-rollback') ?? false
      },
    } as never,
  )
  try {
    await service.recommendations(
      { resumeTaskId: 'task-rollback', terminalId: 'terminal-rollback' },
      { endUserId: 'enduser-rollback', accessToken: null },
      { member: 'enduser-rollback', terminal: 'terminal-rollback', ip: '127.0.0.1' },
    )
    fail('运行时:LLM 失败时 recommendations 应回滚配额并抛错')
  } catch (error) {
    if (exceptionCode(error) === 'AI_TIMEOUT' && rollbackCalled) {
      pass('运行时:LLM 失败时 recommendations 会回滚本次已扣配额')
    } else {
      fail(`运行时:LLM 失败配额回滚异常 code=${exceptionCode(error) ?? (error as Error).message}, rollbackCalled=${rollbackCalled}`)
    }
  }
}

async function main(): Promise<void> {
  console.log('\n=== 岗位 AI 后端推荐 / 会话 API 门禁 ===')

  const moduleFile = mustExist('src/job-ai/job-ai.module.ts', 'JobAiModule 已创建')
  const controller = mustExist('src/job-ai/job-ai.controller.ts', 'JobAiController 已创建')
  const service = mustExist('src/job-ai/job-ai.service.ts', 'JobAiService 已创建')
  const llm = mustExist('src/job-ai/job-ai-llm.service.ts', 'JobAiLlmService 已创建')
  const context = mustExist('src/job-ai/job-context.service.ts', 'JobContextService 已创建')
  const quota = mustExist('src/job-ai/job-ai-quota.service.ts', 'JobAiQuotaService 已创建')
  const privacy = mustExist('src/member-privacy/member-privacy.service.ts', 'MemberPrivacyService 已创建')
  const cleanup = mustExist('src/ai/ai-result.cleanup.task.ts', 'AiResultCleanupTask 已接入过期清理')
  const prisma = read('src/prisma/prisma.service.ts')
  const appModule = read('src/app.module.ts')
  const aiLog = read('src/ai/ai-log.service.ts')
  const packageJson = read('package.json')
  const ci = read('../../.github/workflows/ci.yml')

  mustContain(moduleFile, ['JobAiController', 'JobAiService', 'JobAiLlmService', 'JobContextService', 'JobFitService'], 'JobAiModule 注册 controller/service 并复用 JobFitService')
  mustContain(appModule, ['JobAiModule'], 'AppModule 接入 JobAiModule')

  mustContain(
    controller,
    [
      "@Controller('jobs')",
      "@Post('ai/recommendations')",
      "@Post(':id/ai/explain')",
      "@Post(':id/ai/match')",
      "@Controller('me/job-ai-sessions')",
      '@UseGuards(EndUserAuthGuard)',
      '@Delete',
      'return ApiResponse.ok(await this.service.recommendations',
      'return ApiResponse.ok(await this.service.explainJob',
      'return ApiResponse.ok(await this.service.matchJob',
      'x-resume-access-token',
      'headerOf(req, \'x-resume-access-token\')',
    ],
    'Controller 暴露 recommendations/explain/match/me sessions 路由与会员/匿名请求方解析',
  )

  mustContain(
    service,
    [
      'jobAiSession',
      'jobAiRecommendation',
      "reviewStatus: 'approved'",
      "publishStatus: 'published'",
      'JobFitService',
      'assertResumeAiConsent',
      'MemberPrivacyService',
      'requireActiveConsent',
      'JobAiQuotaService',
      'consumeJobAiQuota',
      'rollbackJobAiQuota',
      'quotaTicket',
      'assertMemberAiRequester',
      'END_USER_AUTH_REQUIRED',
      'PUBLISHED_JOB_WHERE',
      'recommendations: { some: { job: { is: PUBLISHED_JOB_WHERE } } }',
      'job: { is: PUBLISHED_JOB_WHERE }',
      'AiLogService',
      'recordAiServiceLog',
      'disclaimer',
      '仅供参考',
      'recommendations',
      'explainJob',
      'matchJob',
      'listMine',
      'deleteMine',
      '_count',
      'select: {',
    ],
    'JobAiService 使用真实已发布岗位、字段投影、用户同意校验、沉淀会话/推荐/日志并复用 JobFitService',
  )

  mustContain(
    privacy,
    [
      'requireActiveConsent',
      'userAiConsent',
      'consentVersion',
      'revokedAt: null',
      'USER_AI_CONSENT_REQUIRED',
    ],
    'MemberPrivacyService 提供版本化 job_ai 授权 fail-closed 校验',
  )

  mustContain(
    quota,
    [
      'JobAiQuotaService',
      'consume',
      'incrWithTtl',
      'rollback',
      'decr',
      'JOB_AI_QUOTA_EXCEEDED',
      'JOB_AI_QUOTA_UNAVAILABLE',
      'createHash',
      'sha256',
      'member',
      'terminal',
      'ip',
    ],
    'JobAiQuotaService 使用 Redis 日配额并按 member/terminal/ip 脱敏计数',
  )

  mustContain(
    cleanup,
    [
      'cleanupExpiredJobAiSessions',
      'jobAiSession.deleteMany',
      'expiresAt: { lt: new Date() }',
      'audit.write',
      'job_ai_session.cleanup_expired',
      'cleanupExpiredAiServiceLogs',
      'AI_SERVICE_LOG_RETENTION_DAYS',
      'aiServiceLog.deleteMany',
      'ai_service_log.cleanup_expired',
      'expired Job AI sessions',
    ],
    'AiResultCleanupTask 硬删过期 JobAiSession / AiServiceLog 并依赖级联清理推荐明细',
  )

  mustContain(
    context,
    [
      'buildTargetJobContext',
      'sourceUrl',
      'externalId',
      'skillsJson',
      'reviewStatus',
      'publishStatus',
      'TargetJobContext',
    ],
    'JobContextService 构建安全 TargetJobContext 且只读取已发布岗位',
  )

  mustContain(
    llm,
    [
      'JobAiLlmService',
      'recommend',
      'explain',
      'sanitize',
      'findUnsafeOutputReason',
      '录用概率',
      '通过率',
      '匹配率',
      '一键投递',
      '立即投递',
      '平台投递',
      'ServiceUnavailableException',
      'AI_NOT_CONFIGURED',
      'AI_OUTPUT_INVALID',
      'AbortController',
      'AI_TIMEOUT',
    ],
    'JobAiLlmService 使用真实 LLM 配置并包含输出安全防线',
  )

  mustContain(
    aiLog,
    [
      'jobRecommend',
      'jobExplain',
      'jobMatch',
      'MAX_IN_MEMORY_LOGS',
      'this.logs.splice(0, this.logs.length - MAX_IN_MEMORY_LOGS)',
      'persist',
      'aiServiceLog',
      'endUserId',
      'terminalId',
      'persist_failed',
    ],
    'AiLogService 支持 Job AI 操作并持久化元数据',
  )

  mustContain(
    prisma,
    [
      'get jobAiSession()',
      'get jobAiRecommendation()',
      'get aiServiceLog()',
      'get userAiConsent()',
      'get userDataRequest()',
    ],
    'PrismaService 暴露 Job AI delegate',
  )

  mustContain(packageJson, ['"verify:job-ai-backend"'], 'package.json 注册 verify:job-ai-backend')
  mustContain(ci, ['verify:job-ai-backend'], 'CI 串行 verify 接入岗位 AI 后端门禁')

  mustNotContain(
    [controller, service, llm, context, aiLog].join('\n'),
    [
      'resumeText:',
      'resumeContent',
      'fullPrompt',
      'completionText',
      'promptJson',
      'outputJson',
      'applicationStatus',
      'deliveryStatus',
      'candidateStatus',
      'interviewInvite',
      'offerStatus',
      '一键投递成功',
      '立即投递成功',
      '平台投递成功',
      'accessToken?:',
    ],
    'Job AI 后端不持久化隐私原文、完整模型输入输出、body token 或招聘闭环状态',
  )

  await verifyConsentFailClosed()
  await verifyDecimalPercentBlocked()
  await verifyExplainRequiresMember()
  await verifyListMinePublishedJobFilter()
  await verifyDeleteMineOwnership()
  await verifyQuotaRollbackOnLlmFailure()

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 岗位 AI 后端门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 岗位 AI 后端推荐 / 会话 API 门禁一致\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
