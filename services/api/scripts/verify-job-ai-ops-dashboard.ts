/**
 * 岗位 AI 管理侧 / 合作侧运营看板门禁。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-ai-ops-dashboard
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function read(path: string): string {
  const full = join(root, path)
  if (!existsSync(full)) fail(`缺少文件: ${path}`)
  return readFileSync(full, 'utf8')
}

function mustContain(text: string, tokens: string[], message: string): void {
  const missing = tokens.filter((token) => !text.includes(token))
  if (missing.length > 0) fail(`${message}; missing=${missing.join(', ')}`)
  pass(message)
}

function mustNotContain(text: string, tokens: string[], message: string): void {
  const hit = tokens.find((token) => text.includes(token))
  if (hit) fail(`${message}; hit=${hit}`)
  pass(message)
}

async function verifyAiUsageRuntime(): Promise<void> {
  const { AiLogService } = await import('../src/ai/ai-log.service')
  let findManyArgs: unknown
  const service = new AiLogService({
    aiServiceLog: {
      create: async () => ({}),
      findMany: async (args: unknown) => {
        findManyArgs = args
        return [
          {
            id: 'log-1',
            operation: 'jobRecommend',
            provider: 'llm:deepseek-chat',
            status: 'success',
            latencyMs: 1200,
            errorCode: null,
            tokenUsageJson: JSON.stringify({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }),
            estimatedCostCny: 18,
            terminalId: 'KSK-001',
            endUserId: 'enduser-a',
            createdAt: new Date(),
          },
          {
            id: 'log-2',
            operation: 'jobExplain',
            provider: 'llm:deepseek-chat',
            status: 'failed',
            latencyMs: 2200,
            errorCode: 'AI_TIMEOUT',
            tokenUsageJson: JSON.stringify({ promptTokens: 100, completionTokens: 0, totalTokens: 100 }),
            estimatedCostCny: 0,
            terminalId: 'KSK-001',
            endUserId: 'enduser-a',
            createdAt: new Date(),
          },
          {
            id: 'log-3',
            operation: 'jobMatch',
            provider: 'llm:deepseek-chat',
            status: 'success',
            latencyMs: 800,
            errorCode: null,
            tokenUsageJson: JSON.stringify({ promptTokens: 500, completionTokens: 300, totalTokens: 800 }),
            estimatedCostCny: 40,
            terminalId: 'KSK-001',
            endUserId: 'enduser-a',
            createdAt: new Date(),
          },
        ]
      },
    },
  } as never)

  const usage = await service.getUsage('llm:deepseek-chat')
  const serialized = JSON.stringify({ findManyArgs, usage })
  const leakedSensitiveText = [
    'resumeText',
    'promptText',
    'modelOutput',
    'candidateScreening',
    'interviewInvite',
    'offerStatus',
  ].some((token) => serialized.includes(token))
  if (
    usage.totalCalls === 3 &&
    usage.byOperation.jobRecommend === 1 &&
    usage.byOperation.jobExplain === 1 &&
    usage.byOperation.jobMatch === 1 &&
    usage.estimatedCostCny === 58 &&
    usage.tokenUsageTotals.totalTokens === 2400 &&
    usage.alerts.some((alert) => alert.code === 'ai_cost_watch') &&
    serialized.includes('"createdAt"') &&
    !leakedSensitiveText
  ) {
    pass('运行时:Admin AI 用量基于 AiServiceLog 持久化元数据聚合，含岗位 AI 操作、token 和成本告警')
  } else {
    fail(`运行时:Admin AI 用量聚合异常 ${serialized}`)
  }
}

async function verifyJobQualitySummaryRuntime(): Promise<void> {
  const { JobQualityService } = await import('../src/job-ai/job-quality.service')
  let groupByArgs: unknown
  let findManyArgs: unknown
  const service = new JobQualityService({
    jobDataQualitySnapshot: {
      groupBy: async (args: unknown) => {
        groupByArgs = args
        return [
          { jobId: 'job-a', _max: { checkedAt: new Date('2026-06-01T10:00:00.000Z') } },
          { jobId: 'job-b', _max: { checkedAt: new Date('2026-06-02T10:00:00.000Z') } },
        ]
      },
      findMany: async (args: unknown) => {
        findManyArgs = args
        return [
          {
            id: 'snap-a',
            jobId: 'job-a',
            sourceOrgId: 'org-a',
            missingFieldsJson: '[]',
            qualityLevel: 'ready',
            sourceUrlReachable: true,
            checkedAt: new Date('2026-06-01T10:00:00.000Z'),
            lastError: null,
            job: { sourceId: 'source-a' },
          },
          {
            id: 'snap-b',
            jobId: 'job-b',
            sourceOrgId: 'org-a',
            missingFieldsJson: '["syncTimeStale"]',
            qualityLevel: 'partial',
            sourceUrlReachable: false,
            checkedAt: new Date('2026-06-02T10:00:00.000Z'),
            lastError: 'HTTP_404',
            job: { sourceId: 'source-a' },
          },
        ]
      },
    },
  } as never)

  const summary = await service.getSourceQualitySummary({ sourceOrgId: 'org-a' })
  const serialized = JSON.stringify({ groupByArgs, findManyArgs, summary })
  if (
    serialized.includes('"by":["jobId"]') &&
    serialized.includes('"_max":{"checkedAt":true}') &&
    !serialized.includes('"take"') &&
    summary.length === 1 &&
    summary[0]?.totalJobs === 2 &&
    summary[0]?.readyJobs === 1 &&
    summary[0]?.partialJobs === 1 &&
    summary[0]?.brokenSourceUrlJobs === 1 &&
    summary[0]?.staleJobs === 1
  ) {
    pass('运行时:岗位质量摘要按每个岗位最新快照聚合，不使用固定 take 截断')
  } else {
    fail(`运行时:岗位质量摘要聚合异常 ${serialized}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== 岗位 AI Admin/Partner 运营看板门禁 ===')

  const aiLog = read('src/ai/ai-log.service.ts')
  const aiController = read('src/ai/ai.controller.ts')
  const jobsController = read('src/jobs/jobs.controller.ts')
  const jobQuality = read('src/job-ai/job-quality.service.ts')
  const jobAiService = read('src/job-ai/job-ai.service.ts')
  const jobFitService = read('src/ai/resume/job-fit.service.ts')
  const llmJobFitService = read('src/ai/resume/llm-job-fit.service.ts')
  const packageJson = read('package.json')
  const ci = read('../../.github/workflows/ci.yml')

  mustContain(aiLog, [
    'async getUsage',
    'this.prisma.aiServiceLog.findMany',
    'parseTokenUsage',
    'buildAiUsageAlerts',
    'tokenUsageTotals',
    'costByOperation',
    'alerts',
    'jobRecommend',
    'jobExplain',
    'jobMatch',
  ], 'AiLogService 从持久化元数据聚合岗位 AI 用量、token、成本和告警')

  mustContain(aiController, [
    'async getAiUsage',
    'await this.logService.getUsage',
    'async getAiLogs',
    'await this.logService.getLogs',
  ], 'Admin AI usage/logs controller 使用异步真实聚合')

  mustContain(jobsController, [
    "Get('admin/jobs/quality-summary')",
    "Get('partner/jobs/quality-summary')",
    "Roles('admin')",
    "Roles('partner')",
    'getSourceQualitySummary',
  ], 'JobsController 暴露 Admin/Partner 岗位质量摘要端点')

  mustContain(jobQuality, [
    'getSourceQualitySummary',
    'SourceQualitySummaryItem',
    'groupBy',
    '_max',
    'checkedAt',
    'missingFieldsJson',
    'sourceUrlReachable',
  ], 'JobQualityService 使用真实 JobDataQualitySnapshot 聚合来源质量')

  mustNotContain(jobQuality, [
    'take: 5_000',
    'take: 5000',
  ], 'JobQualityService 质量摘要不使用固定 take 截断历史快照')

  mustContain(jobAiService + jobFitService + llmJobFitService, [
    'analyzeWithUsage',
    'tokenUsage',
    'provider',
    'recordAiServiceLog',
    'jobMatch',
  ], 'jobMatch 成功日志透传 LLM provider 与 tokenUsage 元数据')

  mustNotContain(aiLog + aiController + jobsController, [
    'resumeText',
    'promptText',
    'modelOutput',
    'candidateScreening',
    'interviewInvite',
    'offerStatus',
  ], '运营看板后端不暴露隐私原文、模型原始输出或招聘闭环字段')

  mustContain(packageJson, ['"verify:job-ai-ops-dashboard"'], 'package.json 注册 verify:job-ai-ops-dashboard')
  mustContain(ci, ['verify:job-ai-ops-dashboard'], 'CI 接入岗位 AI 运营看板门禁')

  await verifyAiUsageRuntime()
  await verifyJobQualitySummaryRuntime()
  console.log('✅ ALL PASS — 岗位 AI Admin/Partner 运营看板门禁一致')
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
