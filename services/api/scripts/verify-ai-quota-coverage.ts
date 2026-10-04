/**
 * verify:ai-quota-coverage — Q2a 全入口登记。
 *
 * 静态：每个 @AiUse('generate'|'voice') 要么接入 runWithAiQuota（桶 ai_resume），
 * 要么在登记表里标明不计次 / Q2b 接入 / 待裁定。登记表写了但路由没了、或新路由没登记，都报错。
 * 运行时：不监听端口。简历类入口扣 1、用完 429 且模型桩不再被调；同号重放与进行中 409；
 * 金额封顶先拒绝则不写预占；模型报错归还、客户端断开不归还且结果能按记录号读回；
 * 简历桶用完不影响助手与面试；转写不预占；简历解析不再扣旧的 Redis 会员计数。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:ai-quota-coverage
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ServiceUnavailableException } from '@nestjs/common'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { JwtService } from '@nestjs/jwt'
import { AI_USE_METADATA } from '../src/ai-access/ai-access.decorator'
import { AdvisorController } from '../src/advisor/advisor.controller'
import { AdvisorArtifactService } from '../src/advisor/advisor-artifact.service'
import { AdvisorService } from '../src/advisor/advisor.service'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { AiController } from '../src/ai/ai.controller'
import { AiService } from '../src/ai/ai.service'
import { AiPublicQuotaService } from '../src/ai/ai-public-quota.service'
import { CareerPlanController } from '../src/ai/career-plan.controller'
import { CareerPlanService } from '../src/ai/resume/career-plan.service'
import { FairVisitPlanController } from '../src/ai/fair-visit-plan.controller'
import { FairVisitPlanService } from '../src/ai/resume/fair-visit-plan.service'
import { JobFitController } from '../src/ai/job-fit.controller'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { JobFitService } from '../src/ai/resume/job-fit.service'
import { AiQuotaService } from '../src/ai/quota/ai-quota.service'
import { quotaHttpCode, runWithAiQuota } from '../src/ai/quota/ai-quota-run'
import { DailyBriefController } from '../src/assistant/daily-brief.controller'
import { DailyBriefService } from '../src/assistant/daily-brief.service'
import { AuditService } from '../src/audit/audit.service'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { ContractReviewController } from '../src/contract-review/contract-review.controller'
import { ContractReviewLifecycleService } from '../src/contract-review/contract-review-lifecycle.service'
import {
  ContractReviewOrchestratorService,
  createContractReviewExtractionFingerprint,
} from '../src/contract-review/contract-review-orchestrator.service'
import type { ContractReviewExtractionResult } from '../src/contract-review/contract-review-extraction.service'
import { JobAiController, MemberJobAiSessionsController } from '../src/job-ai/job-ai.controller'
import { GovernedJobFitService } from '../src/job-ai/governed-job-fit.service'
import { JobAiService } from '../src/job-ai/job-ai.service'
import { MaterialsController } from '../src/materials/materials.controller'
import { MaterialsService } from '../src/materials/materials.service'
import { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'
import { MemberMockInterviewController, MockInterviewController } from '../src/mock-interview/mock-interview.controller'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { TrtcController } from '../src/trtc/trtc.controller'
import { TrtcService } from '../src/trtc/trtc.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

type Proto = object
type Ctor = { name: string; prototype: Proto }
type Status = 'wired' | 'exempt' | 'q2b' | 'pending'
interface Via { proto: Proto; method: string }
interface Entry {
  controller: Ctor
  method: string
  status: Status
  reason?: string
  via?: Via
  /** 控制器只入队，模型调用在作业里。 */
  asyncJob?: boolean
}

const WIRED = '接入'
const EXEMPT = '不计次'
const Q2B = 'Q2b 接入'
const PENDING = '待裁定'

function via(proto: Proto, method: string): Via { return { proto, method } }

const REGISTRY: Entry[] = [
  { controller: AiController, method: 'submitResumeParse', status: 'wired', via: via(AiService.prototype, 'submitResumeParse') },
  { controller: AiController, method: 'getResumeOptimize', status: 'wired', via: via(AiService.prototype, 'getResumeOptimize') },
  { controller: AiController, method: 'adjustResumeLayout', status: 'wired', via: via(AiService.prototype, 'adjustResumeLayout') },
  { controller: AiController, method: 'submitResumeGenerate', status: 'wired', via: via(AiService.prototype, 'submitResumeGenerate') },
  { controller: CareerPlanController, method: 'generate', status: 'wired', via: via(CareerPlanService.prototype, 'generate') },
  { controller: FairVisitPlanController, method: 'generate', status: 'wired', via: via(FairVisitPlanService.prototype, 'generate') },
  { controller: JobFitController, method: 'analyze', status: 'wired', via: via(GovernedJobFitService.prototype, 'analyzeForJobFit') },
  { controller: AdvisorController, method: 'run', status: 'wired', via: via(AdvisorService.prototype, 'run') },
  { controller: ContractReviewController, method: 'confirm', status: 'wired', asyncJob: true, via: via(ContractReviewOrchestratorService.prototype, 'analyze') },

  { controller: AiController, method: 'factCheckResume', status: 'exempt', reason: '规则比对原文与优化稿字段，不调用模型', via: via(AiService.prototype, 'factCheckResume') },
  { controller: AiController, method: 'transcribeResumeVoice', status: 'exempt', reason: '转写本身不占次数。会员当天简历次数已经用完时才拒绝，避免白转写进不了生成' },
  { controller: AdvisorController, method: 'switchSkill', status: 'exempt', reason: '只更新会话的作业型，不调用模型', via: via(AdvisorService.prototype, 'switchSkill') },
  { controller: ContractReviewController, method: 'create', status: 'exempt', reason: '上传并排队抽取文字，这一步不调用审查模型', via: via(ContractReviewLifecycleService.prototype, 'createAndEnqueue') },
  { controller: ContractReviewController, method: 'report', status: 'exempt', reason: '把已经落库的审查结果渲染成文件，不调用模型', via: via(ContractReviewLifecycleService.prototype, 'createReport') },
  { controller: MaterialsController, method: 'createTask', status: 'exempt', reason: '打印前材料检查是规则处理，已不是生成式调用', via: via(MaterialsService.prototype, 'createTask') },

  { controller: AdvisorController, method: 'create', status: 'pending', reason: '创建会话会调用模型做作业型分类，失败时用关键词兜底。是否计入简历次数尚未裁定，本包不扣', via: via(AdvisorService.prototype, 'createSession') },

  { controller: AiController, method: 'chatWithAssistant', status: 'q2b', via: via(AiService.prototype, 'chatWithAssistant') },
  { controller: AiController, method: 'transcribeAssistantVoice', status: 'q2b' },
  { controller: AiController, method: 'summarizeAssistantSession', status: 'q2b', via: via(AssistantSummaryService.prototype, 'summarize') },
  { controller: MockInterviewController, method: 'create', status: 'q2b', via: via(MockInterviewService.prototype, 'createSession') },
  { controller: MockInterviewController, method: 'start', status: 'q2b', via: via(MockInterviewService.prototype, 'start') },
  { controller: MockInterviewController, method: 'answer', status: 'q2b', via: via(MockInterviewService.prototype, 'answer') },
  { controller: MockInterviewController, method: 'transcribe', status: 'q2b' },
  { controller: MockInterviewController, method: 'questionAudio', status: 'q2b' },
  { controller: MockInterviewController, method: 'end', status: 'q2b', via: via(MockInterviewService.prototype, 'end') },
  { controller: JobAiController, method: 'recommendations', status: 'q2b', via: via(JobAiService.prototype, 'recommendations') },
  { controller: JobAiController, method: 'explain', status: 'q2b', via: via(JobAiService.prototype, 'explainJob') },
  { controller: JobAiController, method: 'match', status: 'q2b', via: via(GovernedJobFitService.prototype, 'matchForMember') },
  { controller: AdvisorController, method: 'ask', status: 'q2b', via: via(AdvisorService.prototype, 'ask') },
  { controller: DailyBriefController, method: 'create', status: 'q2b', via: via(DailyBriefService.prototype, 'create') },
  { controller: TrtcController, method: 'startSession', status: 'q2b', via: via(TrtcService.prototype, 'startSession') },
]

const SCANNED: Ctor[] = [
  AiController, CareerPlanController, FairVisitPlanController, JobFitController, AdvisorController,
  ContractReviewController, MaterialsController, DailyBriefController, TrtcController,
  JobAiController, MemberJobAiSessionsController, MockInterviewController, MemberMockInterviewController,
]

function sourceOf(proto: Proto, name: string): string {
  const fn = (proto as Record<string, unknown>)[name]
  return typeof fn === 'function' ? Function.prototype.toString.call(fn) : ''
}

function hops(source: string): string[] {
  const names = new Set<string>()
  const re = /\bthis\.([A-Za-z0-9_]+)\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) names.add(match[1])
  return [...names]
}

/** 起点方法，再沿同一原型上的 this.方法( 走两跳。不跟 this.其他对象.方法。 */
function reached(proto: Proto, name: string, depth = 2): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const visit = (method: string, left: number) => {
    if (seen.has(method)) return
    seen.add(method)
    const source = sourceOf(proto, method)
    if (!source) return
    out.push(source)
    if (left <= 0) return
    for (const next of hops(source)) visit(next, left - 1)
  }
  visit(name, depth)
  return out
}

function usesResumeQuota(sources: string[]): boolean {
  return sources.some((source) => /runWithAiQuota/.test(source) && /bucket:\s*['"]ai_resume['"]/.test(source))
}

function routesOf(ctor: Ctor): string[] {
  return Object.getOwnPropertyNames(ctor.prototype).filter((name) => {
    const fn = (ctor.prototype as Record<string, unknown>)[name]
    return name !== 'constructor' && typeof fn === 'function' && Reflect.getMetadata(METHOD_METADATA, fn) !== undefined
  })
}

function aiUseOf(ctor: Ctor, method: string): string | undefined {
  return Reflect.getMetadata(AI_USE_METADATA, (ctor.prototype as Record<string, unknown>)[method] as object)
}

function keyOf(ctor: Ctor, method: string): string { return `${ctor.name}.${method}` }

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function controllerFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) controllerFiles(path, acc)
    else if (name.endsWith('.controller.ts')) acc.push(path)
  }
  return acc
}

function staticScan(): { line: string; violations: string[] } {
  const violations: string[] = []
  const scannedNames = new Set(SCANNED.map((ctor) => ctor.name))
  const srcRoot = resolve(__dirname, '../src')
  for (const file of controllerFiles(srcRoot)) {
    const text = stripComments(readFileSync(file, 'utf8'))
    if (!/@AiUse\(\s*['"](?:generate|voice)['"]\s*\)/.test(text)) continue
    for (const match of text.matchAll(/export class ([A-Za-z0-9_]+Controller)\b/g)) {
      if (!scannedNames.has(match[1])) violations.push(`控制器 ${match[1]} 与生成或语音路由同文件，但没有进入扫描`)
    }
  }

  const live = new Map<string, { ctor: Ctor; method: string; kind: string }>()
  for (const ctor of SCANNED) {
    for (const method of routesOf(ctor)) {
      const kind = aiUseOf(ctor, method)
      if (kind === 'generate' || kind === 'voice') live.set(keyOf(ctor, method), { ctor, method, kind })
    }
  }
  const registered = new Set<string>()
  let wired = 0
  let exempt = 0
  let q2b = 0
  let pending = 0

  for (const entry of REGISTRY) {
    const id = keyOf(entry.controller, entry.method)
    registered.add(id)
    const routeKind = aiUseOf(entry.controller, entry.method)
    const isRoute = routesOf(entry.controller).includes(entry.method)
    if (!isRoute) {
      violations.push(`${id} 在登记表里，但路由已不存在`)
      continue
    }
    if ((routeKind === 'generate' || routeKind === 'voice') && !live.has(id)) {
      violations.push(`${id} 路由种类无法识别`)
    }
    if (entry.status !== 'exempt' && routeKind !== 'generate' && routeKind !== 'voice') {
      violations.push(`${id} 不是生成或语音路由，不能标成 ${entry.status}`)
    }
    if (entry.via && typeof (entry.via.proto as Record<string, unknown>)[entry.via.method] !== 'function') {
      violations.push(`${id} 的经由方法 ${entry.via.method} 不存在`)
      continue
    }
    const sources = entry.via ? reached(entry.via.proto, entry.via.method) : reached(entry.controller.prototype, entry.method)
    const charged = usesResumeQuota(sources)
    const controllerSource = sourceOf(entry.controller.prototype, entry.method)
    if (entry.via && !entry.asyncJob && !controllerSource.includes(entry.via.method)) {
      violations.push(`${id} 的控制器没有调用 ${entry.via.method}`)
    }
    if (entry.status === 'wired') {
      if (charged) wired += 1
      else violations.push(`${id} 应接入简历次数，但方法体没有 runWithAiQuota 且桶不是 ai_resume`)
      continue
    }
    if (charged) violations.push(`${id} 标为${entry.status === 'q2b' ? Q2B : entry.status === 'pending' ? PENDING : EXEMPT}，但调用了 runWithAiQuota`)
    if ((entry.status === 'exempt' || entry.status === 'pending') && !entry.reason?.trim()) {
      violations.push(`${id} 的理由为空`)
    }
    if (entry.status === 'exempt') exempt += 1
    else if (entry.status === 'q2b') q2b += 1
    else pending += 1
  }

  for (const [id] of live) {
    if (!registered.has(id)) violations.push(`${id} 是新的生成或语音路由，没有登记也没有接入`)
  }

  const line = `${WIRED} ${wired}、${EXEMPT} ${exempt}、待 Q2b ${q2b}、${PENDING} ${pending}、违规 ${violations.length}`
  return { line, violations }
}

function extractionStub() {
  return {
    async extractResumeText(input: { fileId?: string }) {
      return {
        ok: true as const,
        text: `${input.fileId ?? '简历'}：在青岛市南区公共就业服务中心做窗口服务，负责求职登记和材料清单。`,
        pageCount: 1,
        warnings: [] as string[],
        textSource: 'pdf_text',
        confidence: 'high' as const,
      }
    },
  }
}

async function main() {
  const scanned = staticScan()
  for (const item of scanned.violations) console.error(`违规 ${item}`)
  if (scanned.violations.length > 0) {
    console.log(scanned.line)
    console.log(`违规清单：${scanned.violations.join('；')}`)
    process.exit(1)
  }

  const apiRoot = resolve(__dirname, '..')
  const temporary = mkdtempSync(join(tmpdir(), 'verify-ai-quota-coverage-'))
  const db = join(temporary, 'verify-ai-quota-coverage.db')
  closeSync(openSync(db, 'a'))
  process.env.DATABASE_URL = `file:${db}`
  process.env.VERIFICATION_DATABASE_TARGET = 'isolated'
  process.env.SECRET_ENCRYPTION_KEY = 'verify-ai-quota-phone-secret-0123456789abcdef'
  process.env.REDIS_URL = 'redis://127.0.0.1:1'
  process.env.AI_PROVIDER = 'llm'
  process.env.AI_QUOTA_RESUME_DAILY = '1'
  process.env.AI_QUOTA_ASSISTANT_DAILY = '80'
  process.env.AI_QUOTA_INTERVIEW_DAILY = '5'
  delete process.env.AI_QUOTA_GUEST_TERMINAL_DAILY
  const failures: string[] = []
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
      console.log(`PASS ${name}`)
    } catch (error) {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error)
      failures.push(`${name}\n${detail}`)
      console.error(`FAIL ${name}`)
      console.error(detail)
    }
  }
  const expectCode = async (name: string, code: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      assert.fail(`${name} 应当拒绝 ${code}`)
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error
      assert.equal(quotaHttpCode(error), code, `${name} 实际 ${quotaHttpCode(error) ?? (error as Error).message}`)
    }
  }

  let prisma: PrismaService | undefined
  const originalLayout = LlmResumeOptimizeService.prototype.adjustLayoutDraft
  try {
    assertIsolatedVerificationDatabase()
    execFileSync(resolve(apiRoot, 'node_modules/.bin/prisma'), ['db', 'push'], {
      cwd: apiRoot, env: process.env, stdio: 'pipe', timeout: 60_000,
    })
    prisma = new PrismaService()
    await prisma.onModuleInit()
    const dbPrisma = prisma
    const quota = new AiQuotaService(dbPrisma)
    const audit = new AuditService(dbPrisma)
    const run = randomBytes(3).toString('hex')
    const people = [
      ['周晓楠', 'parse'], ['韩沐阳', 'optimize'], ['林清越', 'layout'], ['赵知夏', 'generate'],
      ['吴景行', 'career'], ['郑安然', 'fair'], ['陈予安', 'jobfit'], ['孙嘉树', 'advisor'],
      ['李婉清', 'contract'], ['高予辰', 'voice'], ['何清和', 'isolate'], ['马晓舟', 'failure'],
      ['沈清禾', 'order'], ['钱知衡', 'inflight'],
    ] as const
    const userOf = new Map<string, string>()
    for (let i = 0; i < people.length; i++) {
      const id = `cov-${run}-${people[i][1]}`
      const phone = `1380532${String(1200 + i)}`
      await dbPrisma.endUser.create({
        data: {
          id, nickname: people[i][0], phoneHash: hashPhone(phone), phoneEnc: encryptPhone(phone),
          enabled: true, status: 'active',
        },
      })
      userOf.set(people[i][1], id)
    }
    const used = async (role: string) => (await quota.remaining({ endUserId: userOf.get(role)! })).find((row) => row.bucket === 'ai_resume')!.dailyUsed
    const requester = (role: string) => ({ endUserId: userOf.get(role)!, accessToken: null as string | null })
    const expiresAt = new Date(Date.now() + 24 * 3600_000)
    const seedParse = async (role: string, taskId: string, fileId: string) => {
      await dbPrisma.aiResumeResult.create({
        data: {
          taskId, kind: 'parse', status: 'completed', provider: 'llm', endUserId: userOf.get(role)!, expiresAt,
          payloadJson: JSON.stringify({
            taskId, status: 'completed', fileId,
            report: { summary: `${people.find((item) => item[1] === role)?.[0]}的窗口服务经历` },
          }),
        },
      })
    }

    const model = { parse: 0, optimize: 0, generate: 0, layout: 0, career: 0, fair: 0, jobFit: 0, advisor: 0 }
    const provider = {
      name: 'llm' as const,
      async parseResume() {
        model.parse += 1
        return { taskId: 'pending', status: 'completed' as const, report: { summary: '周晓楠的简历诊断已完成' } }
      },
      async optimizeResume(taskId: string) {
        model.optimize += 1
        return { taskId, status: 'completed' as const, suggestions: ['把市南窗口经历写成一段可以念的话'] }
      },
      async generateResume() {
        model.generate += 1
        return {
          taskId: 'pending', status: 'completed' as const,
          resume: {
            basic: { name: '赵知夏', phone: '13805321203' },
            intention: { targetJob: '就业窗口' },
            summary: '赵知夏想在青岛市南继续做窗口服务。',
            education: [], experience: [], projects: [], skills: ['材料清单'], certificates: [],
          },
        }
      },
    }
    LlmResumeOptimizeService.prototype.adjustLayoutDraft = async function (input: { currentResume: { summary?: string } }) {
      model.layout += 1
      return { resume: input.currentResume, warnings: [] as string[] }
    }
    const extraction = extractionStub()
    const quiet = { record() {} }
    const ai = new AiService(
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      provider as never, quiet as never, {} as never, {} as never, extraction as never,
      {} as never, {} as never, dbPrisma, quiet as never, {} as never, {} as never,
      undefined, undefined, undefined, quota,
    )
    const careerLlm = { async build() { model.career += 1; return { summary: '吴景行可以继续做窗口服务', currentSnapshot: [{ point: '有窗口经验', evidence: '市南就业窗口' }], directions: [{ title: '窗口主管', why: '已经熟悉材料', firstStep: '整理一套清单' }], skillPlan: [{ skill: '材料核验', action: '把缺件写成表', timeframe: '1-3 个月' }], actionChecklist: ['本周整理清单'] } } }
    const career = new CareerPlanService(dbPrisma, careerLlm as never, extraction as never, {} as never, {} as never, audit, quiet as never, {} as never, undefined, quota)
    const fairLlm = { async build() { model.fair += 1; return { mode: 'preparation' as const, summary: '郑安然参会前先把简历印好', fairHighlights: ['市南专场'], priorityCompanies: [], preparationChecklist: ['印两份简历'], questionsToAsk: ['材料要带哪些'], onsiteTips: ['先看窗口名单'] } } }
    const fairPlan = new FairVisitPlanService(dbPrisma, fairLlm as never, extraction as never, {} as never, {} as never, audit, quiet as never, quota)
    const jobFitLlm = { async analyze() { model.jobFit += 1; return { provider: 'llm', payload: { summary: '陈予安的窗口经历和前台岗位大体对得上', matchPoints: [{ point: '做过窗口', evidence: '市南就业窗口' }], gapPoints: [{ gap: '材料话术还不固定', suggestion: '写成一张清单' }], targetedSuggestions: ['写清到岗时间'] } } } }
    const jobFit = new JobFitService(dbPrisma, jobFitLlm as never, extraction as never, audit)
    const governed = new GovernedJobFitService(
      dbPrisma, jobFit, { async buildTargetJobContext() { throw new Error('手填岗位不应去读系统岗位') } } as never,
      quiet as never, new MemberPrivacyService(dbPrisma),
      { async consume() { return { keys: [] } }, async rollback() {} } as never, quota,
    )
    const advisorLlm = {
      calls: 0,
      isAvailable: () => true,
      providerLabel: () => 'llm:coverage:advisor',
      async draft() { model.advisor += 1; return { draft: '我在青岛市南做窗口服务，想把材料一次备齐。', blanks: [], summary: '一段可以直接念的自我介绍' } },
    }
    const advisor = new AdvisorService(dbPrisma, advisorLlm as never, new AdvisorArtifactService(dbPrisma, {} as never, {} as never, audit), audit, quiet as never, quota)

    await check('金额封顶先拒绝时不产生预占，保存结果时预占仍是 reserved', async () => {
      const shen = userOf.get('order')!
      const before = await dbPrisma.aiQuotaReservation.count()
      await expectCode('金额封顶', 'AI_BUDGET_EXHAUSTED', () => runWithAiQuota({
        quota, bucket: 'ai_resume', operationKey: `budget:${shen}`, endUserId: shen,
        budget: { assertWithinBudget: async () => { throw new ServiceUnavailableException({ error: { code: 'AI_BUDGET_EXHAUSTED', message: '今天的模型调用已经到上限' } }) } },
      }, async () => '不应执行', async () => 'ref'))
      assert.equal(await dbPrisma.aiQuotaReservation.count(), before)
      await runWithAiQuota({
        quota, bucket: 'ai_resume', operationKey: `order:${shen}`, endUserId: shen,
      }, async () => '沈清禾的窗口简历已生成', async () => {
        const row = await dbPrisma.aiQuotaReservation.findFirst({ where: { endUserId: shen, status: 'reserved' } })
        assert.ok(row, '保存结果时预占必须仍是 reserved')
        return `shen-${run}`
      })
      assert.equal(await used('order'), 1)
    })

    await check('同号进行中第二个请求 409，已结算的同号重看不再调模型', async () => {
      const qian = userOf.get('inflight')!
      let started = false
      let finish: (value: string) => void = () => {}
      const pending = new Promise<string>((resolvePromise) => { finish = resolvePromise })
      const first = runWithAiQuota({
        quota, bucket: 'ai_resume', operationKey: `inflight:${qian}`, endUserId: qian,
      }, async () => { started = true; return pending }, async () => `qian-${run}`)
      while (!started) await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
      await expectCode('进行中', 'AI_QUOTA_OPERATION_IN_PROGRESS', () => runWithAiQuota({
        quota, bucket: 'ai_resume', operationKey: `inflight:${qian}`, endUserId: qian,
      }, async () => '第二份', async () => `qian-2-${run}`))
      finish('钱知衡的第一份结果')
      assert.equal(await first, '钱知衡的第一份结果')
      assert.equal(await used('inflight'), 1)
    })

    await check('简历解析：首次扣 1，同一意图重看不调模型，新的一次在用完后 429', async () => {
      const intentId = createHash('sha256').update(`周晓楠-${run}-市南简历`).digest('hex')
      const input = { fileId: `file-${run}-zhou`, fileName: '周晓楠-简历.pdf', fileFormat: 'pdf', source: 'upload' as const }
      const first = await ai.submitResumeParse(input, userOf.get('parse'), { intentId, accessToken: null })
      assert.equal(first.status, 'completed')
      assert.equal(model.parse, 1)
      assert.equal(await used('parse'), 1)
      const replay = await ai.submitResumeParse(input, userOf.get('parse'), { intentId, accessToken: null })
      assert.equal(replay.taskId, first.taskId)
      assert.equal(model.parse, 1)
      const before = model.parse
      await expectCode('解析用完', 'AI_QUOTA_EXHAUSTED', () => ai.submitResumeParse(
        { ...input, fileId: `file-${run}-zhou-2` }, userOf.get('parse'),
      ))
      assert.equal(model.parse, before)
    })

    await check('优化：首次扣 1，已有结果只读，另一份在用完后 429 且不调模型', async () => {
      const taskId = `han-${run}-window`
      await seedParse('optimize', taskId, `file-${run}-han`)
      const first = await ai.getResumeOptimize(taskId, requester('optimize'))
      assert.equal(first.status, 'completed')
      assert.equal(model.optimize, 1)
      assert.equal(await used('optimize'), 1)
      await ai.getResumeOptimize(taskId, requester('optimize'))
      assert.equal(model.optimize, 1)
      const other = `han-${run}-second`
      await seedParse('optimize', other, `file-${run}-han-2`)
      const before = model.optimize
      await expectCode('优化用完', 'AI_QUOTA_EXHAUSTED', () => ai.getResumeOptimize(other, requester('optimize')))
      assert.equal(model.optimize, before)
    })

    await check('排版：调模型的一次扣 1，下一次新序号在用完后 429', async () => {
      const taskId = `lin-${run}-layout`
      await seedParse('layout', taskId, `file-${run}-lin`)
      const resume = {
        basic: { name: '林清越', phone: '13805321202' }, intention: { targetJob: '窗口服务' },
        summary: '在青岛市南做了三年窗口服务。', education: [], experience: [], projects: [], skills: [], certificates: [],
      }
      await ai.adjustResumeLayout(taskId, resume as never, 'condense', undefined, requester('layout'))
      assert.equal(model.layout, 1)
      assert.equal(await used('layout'), 1)
      const before = model.layout
      await expectCode('排版用完', 'AI_QUOTA_EXHAUSTED', () => ai.adjustResumeLayout(taskId, resume as never, 'reformat', undefined, requester('layout')))
      assert.equal(model.layout, before)
    })

    await check('生成：每次新任务号扣 1，用完后第二次 429 且不调模型', async () => {
      const input = {
        basic: { name: '赵知夏', phone: '13805321203' }, intention: { targetJob: '就业窗口' },
        education: [], experience: [], projects: [], skills: ['材料清单'], certificates: [], selfIntro: '想继续在市南做窗口。',
      }
      const first = await ai.submitResumeGenerate(input as never, userOf.get('generate'))
      assert.equal(first.status, 'completed')
      assert.equal(model.generate, 1)
      assert.equal(await used('generate'), 1)
      const stored = await dbPrisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId: first.taskId, kind: 'generate' } } })
      assert.ok(stored)
      const before = model.generate
      await expectCode('生成用完', 'AI_QUOTA_EXHAUSTED', () => ai.submitResumeGenerate(input as never, userOf.get('generate')))
      assert.equal(model.generate, before)
    })

    await check('职业规划：首次扣 1，同号重看不调模型，另一份用完后 429', async () => {
      const taskId = `wu-${run}-plan`
      await seedParse('career', taskId, `file-${run}-wu`)
      const first = await career.generate(taskId, requester('career'))
      assert.equal(first.status, 'completed')
      assert.equal(model.career, 1)
      assert.equal(await used('career'), 1)
      await career.generate(taskId, requester('career'))
      assert.equal(model.career, 1)
      const other = `wu-${run}-plan-2`
      await seedParse('career', other, `file-${run}-wu-2`)
      const before = model.career
      await expectCode('规划用完', 'AI_QUOTA_EXHAUSTED', () => career.generate(other, requester('career')))
      assert.equal(model.career, before)
    })

    await check('参会准备：首次扣 1，同号重看不调模型，另一场用完后 429', async () => {
      const orgId = `org-shinan-${run}`
      await dbPrisma.organization.create({ data: { id: orgId, name: '青岛市市南区公共就业服务中心', type: 'gov' } })
      const fair = await dbPrisma.jobFair.create({
        data: {
          sourceOrgId: orgId, externalId: `shinan-fair-${run}`, sourceName: '市南公共就业', sourceUrl: 'https://rsj.qingdao.gov.cn/shinan-fair',
          title: '市南区秋季公共就业服务专场', startAt: new Date(), endAt: new Date(Date.now() + 7 * 24 * 3600_000),
          venue: '市南区宁夏路就业服务厅', city: '青岛', reviewStatus: 'approved', publishStatus: 'published', theme: 'general',
        },
      })
      const taskId = `zheng-${run}-visit`
      await seedParse('fair', taskId, `file-${run}-zheng`)
      const first = await fairPlan.generate(fair.id, taskId, requester('fair'))
      assert.equal(first.status, 'completed')
      assert.equal(model.fair, 1)
      assert.equal(await used('fair'), 1)
      await fairPlan.generate(fair.id, taskId, requester('fair'))
      assert.equal(model.fair, 1)
      const other = `zheng-${run}-visit-2`
      await seedParse('fair', other, `file-${run}-zheng-2`)
      const before = model.fair
      await expectCode('参会准备用完', 'AI_QUOTA_EXHAUSTED', () => fairPlan.generate(fair.id, other, requester('fair')))
      assert.equal(model.fair, before)
    })

    await check('岗位对照：同一手填目标重看不调模型，换目标在用完后 429', async () => {
      const taskId = `chen-${run}-fit`
      await seedParse('jobfit', taskId, `file-${run}-chen`)
      await dbPrisma.userAiConsent.create({ data: { endUserId: userOf.get('jobfit')!, scope: 'job_ai', consentVersion: '20260701' } })
      const input = { taskId, manualJob: { title: '就业服务窗口', requirements: '熟悉材料清单，能在市南大厅接待' } }
      const first = await governed.analyzeForJobFit(input, requester('jobfit'), { member: userOf.get('jobfit')!, terminal: 'desk-shinan-01', ip: '10.8.4.21' })
      assert.equal(first.status, 'completed')
      assert.equal(model.jobFit, 1)
      assert.equal(await used('jobfit'), 1)
      await governed.analyzeForJobFit(input, requester('jobfit'), { member: userOf.get('jobfit')!, terminal: 'desk-shinan-01', ip: '10.8.4.21' })
      assert.equal(model.jobFit, 1)
      const before = model.jobFit
      await expectCode('对照用完', 'AI_QUOTA_EXHAUSTED', () => governed.analyzeForJobFit(
        { taskId, manualJob: { title: '档案整理', requirements: '能核对纸质材料' } },
        requester('jobfit'), { member: userOf.get('jobfit')!, terminal: 'desk-shinan-01', ip: '10.8.4.21' },
      ))
      assert.equal(model.jobFit, before)
    })

    await check('顾问成稿：非问答型扣 1，再跑一次是新序号，用完后 429', async () => {
      const session = await dbPrisma.advisorSession.create({
        data: {
          endUserId: userOf.get('advisor')!, skill: 'slot_fill', status: 'ready', skillSource: 'user_override',
          topic: '青岛市南公共就业服务中心前台岗位的自我介绍',
          slotsJson: JSON.stringify({
            current_role: { value: '市南区社区就业窗口办事员', filledAt: new Date().toISOString() },
            best_achievement: { value: '把求职登记从纸质改成当天办结', filledAt: new Date().toISOString() },
            why_this_job: { value: '想继续在市南帮人把材料一次备齐', filledAt: new Date().toISOString() },
          }),
          expiresAt,
        },
      })
      const view = await advisor.run(session.id, requester('advisor'))
      assert.equal(model.advisor, 1)
      assert.equal(await used('advisor'), 1)
      assert.ok(view.artifacts.length > 0)
      const before = model.advisor
      await expectCode('顾问用完', 'AI_QUOTA_EXHAUSTED', () => advisor.run(session.id, requester('advisor')))
      assert.equal(model.advisor, before)
    })

    await check('合同审查只在分析作业调模型时扣次，第二份用完后 429', async () => {
      const extracted: ContractReviewExtractionResult = {
        sourceSha256: 'a'.repeat(64), sourceSizeBytes: 128, ocrProvider: null,
        mode: 'text_layer', totalPages: 1, analyzedPages: 1, truncated: false, ocrConfidence: null,
        pages: [{ pageNumber: 1, text: '姓名：李婉清。试用期为六个月。', source: 'text_layer', ocrConfidence: null }],
      }
      const fingerprint = createContractReviewExtractionFingerprint('file-li-contract', extracted, 'contract-review-v1')
      const now = new Date()
      const task = (id: string) => ({
        id, sourceFileId: 'file-li-contract', endUserId: userOf.get('contract')!, status: 'rule_checking',
        contractType: 'labor_contract', disclaimerVersion: 'disclaimer-v1', schemaVersion: 'contract-review-v1',
        rulePackVersion: 'labor-contract-cn-p0-v1', extractionFingerprint: fingerprint, confirmedAt: now,
        expiresAt: new Date(Date.now() + 24 * 3600_000), resultJson: null, ocrConfidence: null, analyzedPages: 1, errorCode: null,
      })
      let current = task(`crLi${run}`)
      let providerCalls = 0
      const fake = {
        current,
        contractReviewTask: {
          findUnique: async ({ where }: { where: { id: string } }) => where.id === fake.current.id ? { ...fake.current } : null,
          updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            if (where.id !== fake.current.id) return { count: 0 }
            if (typeof where.status === 'string' && where.status !== fake.current.status) return { count: 0 }
            const gt = (where.expiresAt as { gt?: Date } | undefined)?.gt
            if (gt instanceof Date && !(fake.current.expiresAt > gt)) return { count: 0 }
            fake.current = { ...fake.current, ...data }
            return { count: 1 }
          },
        },
        async $transaction<T>(work: (tx: { contractReviewTask: typeof fake.contractReviewTask }) => Promise<T>) {
          return work({ contractReviewTask: fake.contractReviewTask })
        },
      }
      const candidate = {
        priorityCheckCount: 0, attentionCount: 0, insufficientInfoCount: 0, coverage: 'complete', ocrConfidence: 'high',
        disclaimerVersion: 'disclaimer-v1', rulePackVersion: 'labor-contract-cn-p0-v1', generatedByAi: true, findings: [],
      }
      const orchestrator = new ContractReviewOrchestratorService(
        fake as never,
        { async extract(input: { onPageComplete?: (done: number, total: number) => Promise<void> }) { await input.onPageComplete?.(1, 1); return extracted } } as never,
        { merge: () => ({ facts: {}, hasFieldConflict: false }) } as never,
        { evaluate: () => [] } as never,
        { mapRules: () => [], mapAi: () => [], composeResult: () => candidate } as never,
        { validate: () => candidate } as never,
        { async reviewWithIdentity() { providerCalls += 1; return { identity: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-v4-pro' }, draft: { findings: [] } } } } as never,
        quiet as never,
        { now: () => new Date() },
        quota,
      )
      await orchestrator.analyze(fake.current.id)
      assert.equal(providerCalls, 1)
      assert.equal(await used('contract'), 1)
      fake.current = task(`crLi${run}b`)
      await expectCode('审查用完', 'AI_QUOTA_EXHAUSTED', () => orchestrator.analyze(fake.current.id))
      assert.equal(providerCalls, 1)
    })

    await check('模型报错归还；客户端断开不归还，结果能按记录号读回', async () => {
      const ma = userOf.get('failure')!
      const broken = Object.assign(new Error('upstream'), { code: 'AI_PROVIDER_ERROR' })
      await assert.rejects(() => runWithAiQuota({
        quota, bucket: 'ai_resume', operationKey: `broken:${ma}`, endUserId: ma,
      }, async () => { throw broken }, async () => 'no-ref'))
      assert.equal(await used('failure'), 0)
      const taskId = `disc${run}ma`
      await runWithAiQuota({
        quota, bucket: 'ai_resume', operationKey: `disc:${ma}`, endUserId: ma, req: { aborted: true },
      }, async () => ({ taskId }), async (value) => {
        await dbPrisma.aiResumeResult.create({
          data: {
            taskId: value.taskId, kind: 'generate', status: 'completed', provider: 'llm', endUserId: ma, expiresAt,
            payloadJson: JSON.stringify({ summary: '马晓舟的窗口简历已生成，可在我的记录里打开' }),
          },
        })
        return value.taskId
      })
      assert.equal(await used('failure'), 1)
      const row = await dbPrisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'generate' } } })
      assert.match(row?.payloadJson ?? '', /马晓舟/)
    })

    await check('简历次数用完后，助手和面试仍可预占', async () => {
      const he = userOf.get('isolate')!
      const resume = await quota.reserve({ bucket: 'ai_resume', endUserId: he, operationKey: `iso:${he}` })
      await quota.commit(resume.reservationId, { resultRef: `iso-${run}` })
      const assistant = await quota.reserve({ bucket: 'ai_assistant', endUserId: he, operationKey: `iso-a:${he}` })
      const interview = await quota.reserve({ bucket: 'ai_interview', endUserId: he, operationKey: `iso-i:${he}` })
      assert.ok(assistant.reservationId)
      assert.ok(interview.reservationId)
    })

    await check('语音转写额度没用完照常，用完 429，转写本身不产生预占', async () => {
      const gao = userOf.get('voice')!
      const jwt = new JwtService({ secret: 'verify-ai-quota-coverage-secret-0123456789' })
      const token = jwt.sign({ sub: gao, jti: `sess-${gao}` }, { audience: 'enduser', expiresIn: '10m' })
      const redis = { async get(key: string) { return key === memberSessionKey(`sess-${gao}`) ? gao : null } }
      let asrCalls = 0
      const asr = { activeProviderName: 'coverage-asr', async recognizeWav() { asrCalls += 1; return { ok: true, text: '高予辰想做青岛市南的窗口服务' } } }
      const controller = new AiController(
        {} as never, quiet as never, {} as never, jwt, redis as never, dbPrisma, asr as never,
        {} as never, {} as never, {} as never, {} as never, {} as never, undefined, undefined, quota,
      )
      const wav = Buffer.alloc(12)
      wav.write('RIFF', 0)
      wav.write('WAVE', 8)
      const req = { headers: { authorization: `Bearer ${token}` } }
      const before = await dbPrisma.aiQuotaReservation.count({ where: { endUserId: gao } })
      const spoken = await controller.transcribeResumeVoice({ buffer: wav } as never, req as never)
      assert.match(spoken.text, /高予辰/)
      assert.equal(asrCalls, 1)
      assert.equal(await dbPrisma.aiQuotaReservation.count({ where: { endUserId: gao } }), before)
      const reserved = await quota.reserve({ bucket: 'ai_resume', endUserId: gao, operationKey: `voice-block:${gao}` })
      await quota.commit(reserved.reservationId, { resultRef: `voice-${run}` })
      const reservations = await dbPrisma.aiQuotaReservation.count({ where: { endUserId: gao } })
      await expectCode('转写用完', 'AI_QUOTA_EXHAUSTED', () => controller.transcribeResumeVoice({ buffer: wav } as never, req as never))
      assert.equal(asrCalls, 1)
      assert.equal(await dbPrisma.aiQuotaReservation.count({ where: { endUserId: gao } }), reservations)
    })

    await check('简历解析不再扣旧的 Redis 会员计数，助手对话仍扣', async () => {
      const keys: string[] = []
      const redis = { async incrWithTtl(key: string) { keys.push(key); return keys.filter((item) => item === key).length }, async decr() { return 0 } }
      const publicQuota = new AiPublicQuotaService(redis as never)
      await publicQuota.consume('resume_parse', { member: userOf.get('parse')!, terminal: 'desk-shinan-01', ip: '10.8.2.14' })
      assert.equal(keys.some((key) => key.includes(':member:')), false)
      assert.equal(keys.some((key) => key.includes(':terminal:')), true)
      assert.equal(keys.some((key) => key.includes(':ip:')), true)
      const before = keys.length
      await publicQuota.consume('assistant_chat', { member: userOf.get('parse')!, terminal: null, ip: null })
      assert.equal(keys.slice(before).some((key) => key.includes(':member:')), true)
    })
  } finally {
    LlmResumeOptimizeService.prototype.adjustLayoutDraft = originalLayout
    await prisma?.onModuleDestroy?.().catch(() => undefined)
    rmSync(temporary, { recursive: true, force: true })
  }

  console.log(scanned.line)
  console.log(scanned.violations.length === 0 ? '违规清单：无' : `违规清单：${scanned.violations.join('；')}`)
  if (failures.length > 0) {
    console.error(`运行时失败 ${failures.length} 组`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
