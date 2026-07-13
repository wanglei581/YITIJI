/**
 * M1.5 岗位匹配治理编排门禁。
 *
 * 静态边界在本文件；无数据库/网络的运行时 fake 位于 scripts/lib，避免此门禁本身
 * 变成一个超过项目单文件阈值的大型脚本。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:governed-job-fit
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGovernedJobFitRuntimeChecks } from './lib/verify-governed-job-fit-runtime'

let failed = 0
let passed = 0

function pass(message: string): void {
  passed += 1
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function file(rel: string, label: string): string {
  const abs = join(process.cwd(), rel)
  if (!existsSync(abs)) {
    fail(`${label} — 文件缺失: ${rel}`)
    return ''
  }
  return readFileSync(abs, 'utf8')
}

function requireAll(source: string, markers: readonly string[], label: string): void {
  if (!source) return
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function rejectAny(source: string, markers: readonly string[], label: string): void {
  if (!source) return
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function requirePattern(source: string, pattern: RegExp, label: string): void {
  if (pattern.test(source)) pass(label)
  else fail(label)
}

function arrayBlock(source: string, property: 'controllers' | 'providers' | 'exports'): string {
  return source.match(new RegExp(`${property}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'm'))?.[1] ?? ''
}

function requireArrayMembers(source: string, property: 'controllers' | 'providers' | 'exports', members: readonly string[], label: string): void {
  const block = arrayBlock(source, property)
  if (!block) fail(`${label} — ${property} 数组缺失`)
  else requireAll(block, members, label)
}

function methodBlock(source: string, method: string): string {
  const signature = new RegExp(`(?:^|\\n)\\s*(?:private |protected |public )?(?:async\\s+)?${method}\\s*\\(`).exec(source)
  if (!signature || signature.index === undefined) return ''
  const start = signature.index
  const openingParen = source.indexOf('(', start)
  let parenDepth = 0
  let closingParen = -1
  for (let index = openingParen; index < source.length; index += 1) {
    if (source[index] === '(') parenDepth += 1
    if (source[index] === ')') parenDepth -= 1
    if (parenDepth === 0) {
      closingParen = index
      break
    }
  }
  const bodyStart = closingParen < 0 ? -1 : source.indexOf('{', closingParen)
  if (bodyStart < 0) return source.slice(start)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  return source.slice(start)
}

function requireCurrentAnonymousConsentHelper(jobFitService: string, governed: string): void {
  requirePattern(
    jobFitService,
    /(?:^|\n)\s*(?:public\s+)?requireActiveAnonymousJobFitConsent\s*\(/m,
    'JobFitService 对治理服务公开当前匿名 consent 判定 helper',
  )
  requireAll(jobFitService, [
    'jobAiConsentVersion === JOB_FIT_ANONYMOUS_CONSENT_VERSION',
    '!!parse.jobAiConsentGrantedAt',
    '!parse.jobAiConsentRevokedAt',
  ], '匿名 consent 状态仍锁定当前版本、已授权时间与未撤回状态')
  requireAll(governed, ['this.jobFit.requireActiveAnonymousJobFitConsent(parse)'], '治理服务必须调用 JobFitService 的当前匿名 consent helper')
}

function expiryBinding(section: string): string | null {
  const explicit = /\bexpiresAt\s*:\s*([A-Za-z_$][\w$]*)\b/.exec(section)?.[1]
  if (explicit) return explicit
  return /(?:^|[,\s{])expiresAt\s*(?=[,}])/.test(section) ? 'expiresAt' : null
}

function requireDerivedResultExpiry(jobFitService: string): void {
  const analysis = methodBlock(jobFitService, 'analyzeWithUsage')
  const upsertAt = analysis.indexOf('this.prisma.aiResumeResult.upsert(')
  if (upsertAt < 0) {
    fail('JobFit 缺少 job_fit upsert，无法验证派生 expiresAt')
    return
  }
  const upsert = analysis.slice(upsertAt)
  const updateAt = upsert.indexOf('update:')
  const createAt = upsert.indexOf('create:')
  const updateName = updateAt < 0 || createAt < 0 ? null : expiryBinding(upsert.slice(updateAt, createAt))
  const createName = createAt < 0 ? null : expiryBinding(upsert.slice(createAt))
  if (!updateName || updateName !== createName) {
    fail('JobFit job_fit upsert 的 update/create 必须写入同一 expiresAt 变量（含属性简写）')
    return
  }
  const beforeUpsert = analysis.slice(0, upsertAt)
  const assignment = new RegExp(`\\b${updateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`).exec(beforeUpsert)
  const assignmentAt = assignment?.index ?? -1
  const semanticWindow = assignmentAt < 0 ? '' : beforeUpsert.slice(Math.max(0, assignmentAt - 120), assignmentAt + 1_000)
  const minBounded = semanticWindow.includes('Math.min(')
    && semanticWindow.includes('parse.expiresAt')
    && semanticWindow.includes('RESULT_TTL_HOURS')
    && semanticWindow.includes('Date.now(')
  if (minBounded) pass('JobFit 同一 min 派生 expiresAt 变量绑定 job_fit upsert 的 update/create')
  else fail('JobFit 同一 expiresAt 变量缺少 parse/TTL 两个上界的 Math.min 语义')
}

async function main(): Promise<void> {
  console.log('\n=== M1.5 岗位匹配治理编排门禁 ===')
  const governed = file('src/job-ai/governed-job-fit.service.ts', 'GovernedJobFitService')
  const jobAiController = file('src/job-ai/job-ai.controller.ts', 'JobAiController')
  const jobFitController = file('src/ai/job-fit.controller.ts', 'JobFitController')
  const jobAiModule = file('src/job-ai/job-ai.module.ts', 'JobAiModule')
  const aiModule = file('src/ai/ai.module.ts', 'AiModule')
  const jobFitService = file('src/ai/resume/job-fit.service.ts', 'JobFitService')

  await runGovernedJobFitRuntimeChecks({
    rootDir: process.cwd(), governedRel: 'src/job-ai/governed-job-fit.service.ts', reporter: { pass, fail },
  })

  requireAll(governed, ['@Injectable()', 'export class GovernedJobFitService', 'analyzeForJobFit(', 'matchForMember('], '治理服务存在且暴露分析/会员匹配入口')
  requireAll(jobAiController, ["@Post(':id/ai/match')", 'JobAiMatchDto', 'ApiResponse.ok', 'private readonly governed: GovernedJobFitService', 'this.governed.matchForMember('], '会员 match 原 URL/DTO/ApiResponse 保持且委托治理服务')
  rejectAny(methodBlock(jobAiController, 'match'), ['this.service.matchJob('], '会员 match controller 不再直接绕过治理服务')

  requireAll(jobFitController, ["import { GovernedJobFitService } from '../job-ai/governed-job-fit.service'", 'private readonly governed: GovernedJobFitService'], 'JobFitController 注入治理服务')
  requireAll(jobAiController, ['member: requester.endUserId', 'terminal:', 'ip:', "fwd.split(',')[0]"], 'JobAiController 仍以 member/terminal/ip 与 XFF 首地址构造配额 context')
  const analyze = methodBlock(jobFitController, 'analyze')
  requirePattern(analyze, /return\s+this\.governed\.analyzeForJobFit\(dto\s*,\s*requester\s*,\s*[^)]+\)/, 'JobFitController POST 直接返回带三维 quota context 的 raw JobFitResponse')
  rejectAny(analyze, ['this.service.analyze(dto,', 'ApiResponse.ok', 'ApiResponse.fail'], 'JobFitController POST 不得绕过治理或改为 ApiResponse 包装')
  requireAll(methodBlock(jobFitController, 'requesterOf'), ['resolveOptionalEndUser', "headerOf(req, 'authorization')", 'return { endUserId: member.endUserId, accessToken: null }', "headerOf(req, 'x-resume-access-token')"], 'JobFitController 保留 Bearer 会员与 x-resume-access-token 匿名双 requester 路径')

  rejectAny(aiModule, ["import { JobFitController } from './job-fit.controller'", "from '../job-ai/job-ai.module'", 'JobAiModule'], 'AiModule 只移出 JobFitController 且不得反向依赖 JobAiModule')
  requireArrayMembers(aiModule, 'controllers', ['AiController', 'AiConfigController', 'AiConfigsController', 'CareerPlanController', 'FairVisitPlanController'], 'AiModule 保留其余全部 controller')
  rejectAny(arrayBlock(aiModule, 'controllers'), ['JobFitController'], 'AiModule controller 数组只移除 JobFitController')
  requireAll(aiModule, ['AuthModule', 'FilesModule', 'AsrModule', 'BenefitRedemptionModule'], 'AiModule 保留 main 的模块依赖（含 Asr/BenefitRedemption）')
  requireArrayMembers(aiModule, 'providers', ['AiService', 'AiLogService', 'MockAiProvider', 'OpenAiProvider', 'ClaudeProvider', 'LocalAiProvider', 'QwenProvider', 'ZhipuProvider', 'LlmConfigService', 'LlmJobFitService', 'JobFitService', 'LlmCareerPlanService', 'CareerPlanService', 'CareerPlanPdfService', 'LlmFairVisitPlanService', 'FairVisitPlanService', 'FairVisitPlanPdfService', 'LlmChatService', 'AiResultCleanupTask', 'ResumeExtractionService', 'OcrService', 'DisabledOcrProvider', 'TencentOcrProvider', 'BaiduOcrProvider', 'LlmResumeService', 'LlmResumeProvider', 'LlmResumeGenerateService', 'ResumePdfService', 'ResumeDocxService', 'ResumeTextService', 'LlmResumeOptimizeService'], 'AiModule providers 未因 controller 迁移回退')
  requireArrayMembers(aiModule, 'exports', ['AiService', 'AiLogService', 'ResumeExtractionService', 'LlmConfigService', 'JobFitService', 'LlmJobFitService', 'OcrService'], 'AiModule exports 未因 controller 迁移回退')
  requireAll(jobAiModule, ["import { JobFitController } from '../ai/job-fit.controller'", "import { GovernedJobFitService } from './governed-job-fit.service'", 'AiModule', 'MemberPrivacyModule'], 'JobAiModule 单向依赖 AiModule 并导入迁入 controller/governed')
  requireArrayMembers(jobAiModule, 'controllers', ['JobAiController', 'MemberJobAiSessionsController', 'JobFitController'], 'JobAiModule 注册 JobFitController')
  requireArrayMembers(jobAiModule, 'providers', ['JobAiService', 'JobAiLlmService', 'JobContextService', 'JobAiQuotaService', 'GovernedJobFitService', 'EndUserAuthGuard'], 'JobAiModule 提供治理服务且保留既有 provider')

  requireAll(governed, ['this.jobFit.authorizeParseForJobFit(', "this.privacy.requireActiveConsent(parse.endUserId, 'job_ai')"], '治理服务以 JobFit parse 归属为唯一裁决，并分别校验会员/匿名授权')
  requireCurrentAnonymousConsentHelper(jobFitService, governed)
  requirePattern(governed, /if\s*\(\s*parse\.endUserId\s*\)[\s\S]{0,700}requireActiveConsent[\s\S]{0,1600}else[\s\S]{0,1200}requireActiveAnonymousJobFitConsent/, '会员 UserAiConsent 与匿名 parse-bound consent 存在明确分支')
  requireAll(governed, ["operation: 'match'", 'expiresAt: parse.expiresAt', 'analyzeWithUsage(', "'jobMatch'"], '治理服务保留 match 会话、parse 生命周期、LLM 分析与 jobMatch 可观测性边界')
  requireDerivedResultExpiry(jobFitService)

  console.log(`\n=== 结果: ${passed} PASS / ${failed} FAIL ===`)
  if (failed > 0) process.exitCode = 1
}

void main().catch((error: unknown) => {
  fail(`门禁自身运行失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
