/**
 * 账户级不可用 / 模型名无效：机器码、人话、200-failed 的 failCode、简历解析退次。
 *
 * 桩 fetch，不打真实模型。用户可见句子不得带状态码，也不得出现余额、充值、欠费。
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ServiceUnavailableException } from '@nestjs/common'
import { LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { AiPublicQuotaService } from '../src/ai/ai-public-quota.service'
import { runWithPublicQuota } from '../src/ai/ai-request-guard'
import { LlmChatService } from '../src/ai/llm/llm-chat.service'
import {
  AI_ACCOUNT_OR_MODEL_MESSAGE,
  AI_PROVIDER_ACCOUNT_UNAVAILABLE,
  AI_PROVIDER_ERROR,
  AI_PROVIDER_MODEL_INVALID,
  AI_PROVIDER_REQUEST_ERROR,
  AI_PROVIDER_UNREACHABLE,
  AI_RATE_LIMITED,
  AI_UNKNOWN,
  isOurSideProviderFailure,
  isRefundableAiFailure,
  llmExceptionCode,
  llmExceptionMessage,
  llmUpstreamStatusError,
} from '../src/ai/llm/llm-failure'
import { LlmResumeProvider } from '../src/ai/providers/llm.provider'
import { LlmCareerPlanService } from '../src/ai/resume/llm-career-plan.service'
import { LlmFairVisitPlanService } from '../src/ai/resume/llm-fair-visit-plan.service'
import { LlmJobFitService } from '../src/ai/resume/llm-job-fit.service'
import { LlmResumeGenerateService } from '../src/ai/resume/llm-resume-generate.service'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { LlmResumeService } from '../src/ai/resume/llm-resume.service'
import { LlmSelfAssessmentService } from '../src/ai/resume/llm-self-assessment.service'
import { ResumeParseIntentRunner } from '../src/ai/resume-parse-intent-runner.service'
import type { ParseResumeOutput } from '../src/ai/interfaces/ai-provider.interface'
import { contractReviewFailureReason } from '../src/contract-review/contract-review-failure-reason'
import { JobAiLlmService } from '../src/job-ai/job-ai-llm.service'
import { MockInterviewLlmService } from '../src/mock-interview/mock-interview-llm.service'

const here = dirname(__filename)
const RESUME = '我在学校学习软件开发，做过课程项目。'
const BANNED_COPY = /余额|充值|欠费|\(40[1234]\)|\(500\)|\(429\)/

function codeOf(err: unknown): string {
  assert.ok(err instanceof ServiceUnavailableException, `expected ServiceUnavailableException, got ${String(err)}`)
  const code = llmExceptionCode(err)
  assert.equal(typeof code, 'string')
  return code as string
}

function assertHuman(err: unknown, code: string, label: string): void {
  assert.equal(codeOf(err), code, label)
  const message = llmExceptionMessage(err)
  assert.equal(message, AI_ACCOUNT_OR_MODEL_MESSAGE, `${label} message`)
  assert.doesNotMatch(message, BANNED_COPY, `${label} copy`)
  assert.notEqual(code, 'Service Unavailable', label)
}

function installFetch(status: number, data: unknown): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => data,
  })) as typeof fetch
  return () => { globalThis.fetch = original }
}

const cfg = {
  vendor: 'deepseek',
  model: 'stub-model',
  baseURL: 'https://api.deepseek.com',
  systemPrompt: '你是求职助手',
  roleScope: '',
  forbiddenWords: [] as string[],
  temperature: 0,
  enabled: true,
  apiKeyEncrypted: 'x',
}
const config = {
  getApiKey: () => 'stub-key',
  getConfig: () => cfg,
  isReady: () => true,
}

function token(): string {
  return randomBytes(32).toString('base64url')
}

async function expectAccount(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (err) {
    assertHuman(err, AI_PROVIDER_ACCOUNT_UNAVAILABLE, label)
    return
  }
  assert.fail(`${label} did not throw`)
}

function classifyMatrix(): void {
  for (const status of [401, 402, 403]) {
    const err = llmUpstreamStatusError('测试服务', status, { error: { message: 'Insufficient Balance', code: 'invalid_request_error' } })
    assertHuman(err, AI_PROVIDER_ACCOUNT_UNAVAILABLE, `status ${status}`)
  }
  const missing = llmUpstreamStatusError('测试服务', 404, { error: { message: 'not found' } })
  assertHuman(missing, AI_PROVIDER_MODEL_INVALID, '404')
  const model400 = llmUpstreamStatusError('测试服务', 400, {
    error: { message: 'The model `deepseek-chat` does not exist', code: 'model_not_found' },
  })
  assertHuman(model400, AI_PROVIDER_MODEL_INVALID, 'model 400')
  const retired = llmUpstreamStatusError('测试服务', 400, { error: { code: 'model_deprecated', message: 'model retired' } })
  assertHuman(retired, AI_PROVIDER_MODEL_INVALID, 'deprecated 400')
  const plain400 = llmUpstreamStatusError('测试服务', 400, { error: { message: 'invalid json' } })
  assert.equal(codeOf(plain400), AI_PROVIDER_REQUEST_ERROR)
  assert.match(llmExceptionMessage(plain400), /\(400\)/)
  const limited = llmUpstreamStatusError('测试服务', 429, { error: { message: 'slow down' } })
  assert.equal(codeOf(limited), AI_RATE_LIMITED)
  assert.doesNotMatch(llmExceptionMessage(limited), /429/)
  const server = llmUpstreamStatusError('测试服务', 500, { error: { message: 'boom' } })
  assert.equal(codeOf(server), AI_PROVIDER_ERROR)
  assert.match(llmExceptionMessage(server), /\(500\)/)
  assert.equal(isOurSideProviderFailure(AI_PROVIDER_ACCOUNT_UNAVAILABLE), true)
  assert.equal(isOurSideProviderFailure(AI_PROVIDER_MODEL_INVALID), true)
  assert.equal(isOurSideProviderFailure(AI_PROVIDER_ERROR), true)
  assert.equal(isOurSideProviderFailure(AI_PROVIDER_UNREACHABLE), true)
  assert.equal(isOurSideProviderFailure(AI_PROVIDER_REQUEST_ERROR), false)
  assert.equal(isOurSideProviderFailure(AI_UNKNOWN), false)
  assert.equal(isOurSideProviderFailure(undefined), false)
  // 退次口径：失败不扣、成功只扣一次。模型这一环的失败都退，只有内容审核拦下用户内容不退；没有机器码（文件本身的问题）不退。
  for (const code of [AI_PROVIDER_ACCOUNT_UNAVAILABLE, AI_PROVIDER_MODEL_INVALID, AI_PROVIDER_ERROR, AI_PROVIDER_UNREACHABLE,
    AI_PROVIDER_REQUEST_ERROR, 'AI_RATE_LIMITED', 'AI_DIAGNOSIS_TIMEOUT', 'AI_BUSY', 'AI_EMPTY_RESPONSE', AI_UNKNOWN]) {
    assert.equal(isRefundableAiFailure(code), true, `${code} 应退次`)
  }
  assert.equal(isRefundableAiFailure('AI_CONTENT_BLOCKED'), false, '内容审核拦下用户内容不退')
  assert.equal(isRefundableAiFailure(undefined), false, '没有机器码（文件本身的问题）不退')
  assert.equal(isRefundableAiFailure(''), false)
  console.log('classifier matrix ok')
}

async function everyService402(): Promise<void> {
  const restore = installFetch(402, { error: { message: 'Insufficient Balance' } })
  try {
    const resume = new LlmResumeService(config as never)
    const optimize = new LlmResumeOptimizeService(config as never)
    const generate = new LlmResumeGenerateService(config as never)
    const career = new LlmCareerPlanService(config as never)
    const jobFit = new LlmJobFitService(config as never)
    const self = new LlmSelfAssessmentService(config as never)
    const fair = new LlmFairVisitPlanService(config as never)
    const advisor = new LlmAdvisorService(config as never)
    const interview = new MockInterviewLlmService(config as never)
    const jobAi = new JobAiLlmService(config as never)
    const chat = new LlmChatService(config as never)
    const summary = new AssistantSummaryService({} as never, {} as never, config as never, {} as never, {} as never, { record() { return undefined } } as never)

    await expectAccount('diagnose', () => resume.diagnose(RESUME))
    await expectAccount('optimize', () => optimize.optimize(RESUME, { sections: [], suggestions: [] } as never))
    await expectAccount('generate', () => generate.generate({
      basic: { name: '测试' },
      intention: { position: '软件开发' },
      education: [],
      experience: [],
      projects: [],
      skills: [],
      certificates: [],
    }))
    await expectAccount('career', () => career.build({ resumeText: RESUME }))
    await expectAccount('job-fit', () => jobFit.analyze(RESUME, { title: '软件开发' }))
    const interpreted = await self.summarize({
      scored: { dimensions: [{ key: 'talk', label: '沟通', strength: 3, note: null } as never], summary: null },
      consent: { nonSensitive: true, sensitive: false },
    })
    assert.equal(interpreted.unavailableReason, AI_PROVIDER_ACCOUNT_UNAVAILABLE, 'self-assessment')
    await expectAccount('fair', () => fair.build({
      resumeText: RESUME,
      mode: 'preparation',
      fair: {
        id: 'fair-1', title: '示例招聘会', sourceName: '示例来源', sourceUrl: 'https://example.com/fair',
        startAt: '2099-10-01T00:00:00.000Z', endAt: '2099-10-02T00:00:00.000Z', venue: '会场', city: '杭州',
      },
      fairCompanies: [],
    }))
    await expectAccount('advisor', () => advisor.answer('我想把项目经历写清楚', []))
    await expectAccount('interview', () => interview.nextQuestion({
      interviewerType: 'hr', industry: '软件', position: '开发', experience: 'fresh', difficulty: 'easy',
      questionTarget: 3, askedCount: 0, resumeDigest: null, transcript: [],
    }))
    await expectAccount('job-ai', () => jobAi.recommend(RESUME, [{
      jobId: 'job-1', title: '软件开发', company: '示例单位', sourceName: '示例来源',
      sourceUrl: 'https://example.com/job', externalId: 'ext-1', skills: [], city: '杭州',
    }]))
    await expectAccount('chat', () => chat.chat({ message: '你好' }))
    const probed = await chat.test()
    assert.equal(probed.ok, false)
    assert.equal(probed.error, AI_ACCOUNT_OR_MODEL_MESSAGE)
    assert.doesNotMatch(probed.error ?? '', /Service Unavailable|402/)
    await expectAccount('assistant-summary', () => (summary as unknown as {
      condense: (turns: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<unknown>
    }).condense([{ role: 'user', content: '我想把简历写清楚' }]))

    const chatSource = readFileSync(join(here, '../src/ai/llm/llm-chat.service.ts'), 'utf8')
    assert.equal(chatSource.includes("new ServiceUnavailableException('"), false)
    assert.equal(chatSource.includes('new ServiceUnavailableException(`'), false)
    console.log('every llm service 402 ok')
  } finally {
    restore()
  }
}

async function failedResponsesCarryFailCode(): Promise<void> {
  const restore = installFetch(402, { error: { message: 'Insufficient Balance' } })
  try {
    const provider = new LlmResumeProvider(
      new LlmResumeService(config as never),
      new LlmResumeGenerateService(config as never),
      new LlmResumeOptimizeService(config as never),
    )
    const parsed = await provider.parseResume({ fileId: 'file-1', fileName: 'a.pdf', fileFormat: 'pdf', source: 'upload', extractedText: RESUME })
    assert.equal(parsed.status, 'failed')
    assert.equal(parsed.failCode, AI_PROVIDER_ACCOUNT_UNAVAILABLE)
    assert.equal(parsed.failReason, 'AI 暂时不可用，可以先打印原件或手动填写简历')
    assert.equal(isOurSideProviderFailure(parsed.failCode), true)

    const optimized = await provider.optimizeResume('task-1', { sections: [], suggestions: [] } as never, RESUME)
    assert.equal(optimized.failCode, AI_PROVIDER_ACCOUNT_UNAVAILABLE)
    assert.equal(optimized.failReason, 'AI 暂时不可用，可以先按模板手动填写')

    const generated = await provider.generateResume({
      basic: { name: '测试' },
      intention: { position: '软件开发' },
      education: [],
      experience: [],
      projects: [],
      skills: [],
      certificates: [],
    })
    assert.equal(generated.failCode, AI_PROVIDER_ACCOUNT_UNAVAILABLE)
    assert.equal(generated.failReason, 'AI 暂时不可用，可以先按模板手动填写')

    const empty = await provider.parseResume({ fileId: 'file-1', fileName: 'a.pdf', fileFormat: 'pdf', source: 'upload', extractedText: '   ' })
    assert.equal(empty.status, 'failed')
    assert.equal(empty.failCode, undefined)
    assert.equal(isOurSideProviderFailure(empty.failCode), false)
    console.log('200-failed failCode ok')
  } finally {
    restore()
  }
}

async function quotaRefund(): Promise<void> {
  let rolls = 0
  const quota = { async rollback() { rolls += 1 } }
  const refund = (result: { status?: string; failCode?: string }) =>
    result.status === 'failed' && isRefundableAiFailure(result.failCode)
  await runWithPublicQuota(quota as never, { keys: ['k'] }, {}, async () => ({
    status: 'failed',
    failCode: AI_PROVIDER_ACCOUNT_UNAVAILABLE,
  }), refund)
  assert.equal(rolls, 1, '402-shaped 200-failed releases the public count')
  await runWithPublicQuota(quota as never, { keys: ['k'] }, {}, async () => ({
    status: 'failed',
    failCode: AI_PROVIDER_ERROR,
  }), refund)
  assert.equal(rolls, 2, 'upstream 5xx releases the public count')
  await runWithPublicQuota(quota as never, { keys: ['k'] }, {}, async () => ({
    status: 'failed',
    failCode: AI_PROVIDER_UNREACHABLE,
  }), refund)
  assert.equal(rolls, 3, 'unreachable releases the public count')
  await runWithPublicQuota(quota as never, { keys: ['k'] }, {}, async () => ({
    status: 'failed',
    failReason: '简历文件无法提取文本，请重新上传',
  }), refund)
  assert.equal(rolls, 3, 'unreadable file does not release the public count')
  await runWithPublicQuota(quota as never, { keys: ['k'] }, {}, async () => ({
    status: 'failed',
    failCode: AI_UNKNOWN,
    failReason: 'AI 诊断服务暂时不可用，请稍后重试',
  }), refund)
  // 模型这一环出了没归类的错（AI_UNKNOWN）：用户没拿到结果，退。真实的「文件为空」不带机器码（上面 empty.failCode === undefined 已断言），不退。
  assert.equal(rolls, 4, 'an unclassified failure in the model step releases the public count')
  console.log('legacy quota release ok')
}

function quotaRedis() {
  const counts = new Map<string, number>()
  const markers = new Map<string, string>()
  return {
    counts,
    redis: {
      async get(key: string) { return markers.get(key) ?? null },
      async decr(key: string) {
        const next = (counts.get(key) ?? 0) - 1
        counts.set(key, next)
        return next
      },
      async consumeQuotaOnce(input: { markerKey: string; markerValue: string; counters: { key: string }[] }) {
        if (markers.has(input.markerKey)) return 'replay' as const
        markers.set(input.markerKey, input.markerValue)
        for (const counter of input.counters) counts.set(counter.key, (counts.get(counter.key) ?? 0) + 1)
        return 'charged' as const
      },
    },
  }
}

async function intentRelease(): Promise<void> {
  const { counts, redis } = quotaRedis()
  const quota = new AiPublicQuotaService(redis as never)
  const canned = new Map<string, ParseResumeOutput>()
  const done = new Set<string>()
  let thrown: Error | null = null
  const submission = {
    async create() { return undefined },
    async observe(input: { intentKey: string }) {
      const intentId = input.intentKey
      const row = {
        intentId,
        phase: done.has(intentId) ? 'completed' as const : 'quota_pending' as const,
        endUserId: 'member-a',
        payloadFingerprint: 'fp',
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date(),
      }
      if (done.has(intentId)) return { outcome: 'replay' as const, submission: row, result: {} }
      return { outcome: 'not_ready' as const, submission: row }
    },
    async admit() { return undefined },
    async startProvider(input: { intentKey: string }) {
      return {
        advanced: true,
        submission: {
          intentId: input.intentKey,
          phase: 'provider_started' as const,
          endUserId: 'member-a',
          payloadFingerprint: 'fp',
          expiresAt: new Date(Date.now() + 86_400_000),
          updatedAt: new Date(),
        },
      }
    },
    async complete(input: { intentKey: string }) {
      done.add(input.intentKey)
      return { advanced: true, submission: { intentId: input.intentKey, phase: 'completed', endUserId: 'member-a', payloadFingerprint: 'fp', expiresAt: new Date(), updatedAt: new Date() } }
    },
  }
  const ai = {
    async submitResumeParse(_dto: unknown, _endUserId: string | null, intent: { intentId: string }) {
      if (thrown) throw thrown
      const output = canned.get(intent.intentId)
      if (!output) throw new Error('missing canned output')
      return output
    },
    async getResumeRecord(taskId: string) {
      const output = canned.get(taskId)
      if (!output) throw new Error('missing stored output')
      return output
    },
  }
  const files = { async assertContentAccessibleForEndUser() { return undefined } }
  const runner = new ResumeParseIntentRunner(submission as never, quota, ai as never, files as never)
  // 会员、终端、IP 三项都要退（总指挥 10/4：上游一次故障不能把整台机、整个场地当天的次数烧掉）。
  const context = { member: 'member-a', terminal: 'KSK-001', ip: '203.0.113.10' }
  const total = () => [...counts.values()].reduce((sum, value) => sum + value, 0)
  const dto = { fileId: 'file-1', fileName: 'a.pdf', fileFormat: 'pdf', source: 'upload' as const }

  const accountId = 'a'.repeat(64)
  canned.set(accountId, { taskId: accountId, status: 'failed', failCode: AI_PROVIDER_ACCOUNT_UNAVAILABLE, failReason: 'AI 暂时不可用，可以先打印原件或手动填写简历' })
  const account = await runner.submit(dto, 'member-a', context, accountId, token())
  assert.equal(account.failCode, AI_PROVIDER_ACCOUNT_UNAVAILABLE)
  assert.equal(counts.size, 3, 'account failure was charged on member, terminal and ip before release')
  assert.ok([...counts.values()].every((value) => value === 0), 'account failure released the charged counters')

  const fileId = 'b'.repeat(64)
  canned.set(fileId, { taskId: fileId, status: 'failed', failReason: '简历文件无法提取文本，请重新上传' })
  await runner.submit(dto, 'member-a', context, fileId, token())
  assert.ok([...counts.values()].some((value) => value > 0), 'unreadable file stays charged')
  const charged = [...counts.values()].reduce((sum, value) => sum + value, 0)

  assert.equal(charged, 3, 'unreadable file charged once on each of the three counters')

  // 模型这一环抛错：退次（失败不扣）。
  thrown = new Error('provider down')
  const crashId = 'c'.repeat(64)
  await assert.rejects(() => runner.submit(dto, 'member-a', context, crashId, token()))
  assert.equal(total(), charged, 'a thrown provider error is released')
  thrown = null

  // 超时、普通 4xx：退次。
  for (const [id, code] of [['d'.repeat(64), 'AI_DIAGNOSIS_TIMEOUT'], ['e'.repeat(64), AI_PROVIDER_REQUEST_ERROR]] as const) {
    canned.set(id, { taskId: id, status: 'failed', failCode: code, failReason: 'AI 诊断服务暂时不可用，请稍后重试' })
    await runner.submit(dto, 'member-a', context, id, token())
    assert.equal(total(), charged, `${code} is released`)
  }
  // 内容审核拦下用户内容：照扣。
  const blockedId = 'f'.repeat(64)
  canned.set(blockedId, { taskId: blockedId, status: 'failed', failCode: 'AI_CONTENT_BLOCKED', failReason: '这个问题我不能回答' })
  await runner.submit(dto, 'member-a', context, blockedId, token())
  assert.equal(total(), charged + 3, 'content-moderation block stays charged')
  // 成功：三项各只扣一次；同一意图重放不再扣。
  const okId = '1'.repeat(64)
  canned.set(okId, { taskId: okId, status: 'completed' } as never)
  await runner.submit(dto, 'member-a', context, okId, token())
  assert.equal(total(), charged + 6, 'success charges exactly once on each counter')
  await runner.submit(dto, 'member-a', context, okId, token())
  assert.equal(total(), charged + 6, 'replaying the same successful intent does not charge again')

  const source = readFileSync(join(here, '../src/ai/resume-parse-intent-runner.service.ts'), 'utf8')
  assert.equal(source.includes('rollback'), false)
  assert.equal(source.includes('runWithPublicQuota'), false)
  console.log('intent count release ok')
}

function contractCopy(): void {
  assert.equal(contractReviewFailureReason('CONTRACT_PROVIDER_ACCOUNT_UNAVAILABLE'), 'AI 服务暂时不可用。')
  assert.doesNotMatch(contractReviewFailureReason('CONTRACT_PROVIDER_ACCOUNT_UNAVAILABLE'), /连接不上|余额|充值|402/)
  console.log('contract copy ok')
}

async function main(): Promise<void> {
  classifyMatrix()
  await everyService402()
  await failedResponsesCarryFailCode()
  await quotaRefund()
  await intentRelease()
  contractCopy()
  console.log('verify:llm-account-unavailable PASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
