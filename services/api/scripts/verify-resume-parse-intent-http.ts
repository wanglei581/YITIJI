/**
 * POST /resume/parse header branch. Fakes only; no provider, Redis, or database.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import { AiController } from '../src/ai/ai.controller'
import type { AiPublicQuotaContext } from '../src/ai/ai-public-quota.service'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function token(): string {
  return randomBytes(32).toString('base64url')
}

function codeOf(error: unknown): { status: number; code: string } {
  if (!(error instanceof HttpException)) throw error
  const body = error.getResponse() as { error?: { code?: string } }
  return { status: error.getStatus(), code: body.error?.code ?? '' }
}

async function expectHttp(run: () => Promise<unknown>, status: number, code: string): Promise<void> {
  try {
    await run()
    throw new Error(`expected ${status} ${code}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('expected ')) throw error
    const seen = codeOf(error)
    assert.equal(seen.status, status)
    assert.equal(seen.code, code)
  }
}

const dto = { fileId: 'file-1', fileName: 'a.pdf', fileFormat: 'pdf', source: 'upload' as const }

function makeController() {
  const calls = { consume: 0, parse: 0, runner: 0, consent: 0 }
  const audits: unknown[] = []
  let consentError: Error | null = null
  let runnerResult: Record<string, unknown> = { taskId: 'intent-task', status: 'completed' }
  const runnerArgs: unknown[] = []
  const controller = new AiController(
    ...(Array.from({ length: AiController.length }, () => ({})) as never[]),
  )
  Object.assign(controller, {
    aiService: {
      getProviderName: () => 'mock',
      submitResumeParse: async () => {
        calls.parse += 1
        return { taskId: 'legacy-task', status: 'completed' }
      },
    },
    audit: { write: async (entry: unknown) => { audits.push(entry) } },
    jwt: { verify: () => ({ sub: 'member-1', jti: 'sid-1' }) },
    redis: { get: async (key: string) => (key === 'member:session:sid-1' ? 'member-1' : null) },
    prisma: { endUser: { findUnique: async () => ({ enabled: true, status: 'active' }) } },
    publicQuota: {
      consume: async () => {
        calls.consume += 1
        return { keys: ['legacy'] }
      },
      rollback: async () => undefined,
    },
    privacy: {
      requireActiveConsent: async (id: string, purpose: string) => {
        calls.consent += 1
        assert.equal(id, 'member-1')
        assert.equal(purpose, 'resume_ai')
        if (consentError) throw consentError
      },
    },
    resumeParseIntent: {
      submit: async (...args: unknown[]) => {
        calls.runner += 1
        runnerArgs.push(args)
        return runnerResult
      },
    },
  })
  return {
    controller,
    calls,
    audits,
    runnerArgs,
    setRunnerResult: (value: Record<string, unknown>) => { runnerResult = value },
    failConsent: () => { consentError = new Error('consent required') },
    dropRunner: () => { (controller as unknown as { resumeParseIntent?: unknown }).resumeParseIntent = undefined },
  }
}

function request(headers: Record<string, string> = {}) {
  return {
    headers,
    ip: '203.0.113.8',
    socket: { remoteAddress: '203.0.113.8' },
    on: () => undefined,
  }
}

function memberRequest(headers: Record<string, string> = {}) {
  return request({ authorization: 'Bearer member-token', 'x-terminal-id': 'terminal-1', ...headers })
}

async function main(): Promise<void> {
  console.log('=== POST /resume/parse intent headers ===')
  const intent = token()
  const proof = token()
  const headers = { 'x-resume-parse-intent': intent, 'x-resume-parse-proof': proof }

  const legacy = makeController()
  const legacyResult = await legacy.controller.submitResumeParse(dto, request({ 'x-terminal-id': 'terminal-1' }))
  assert.equal(legacyResult.taskId, 'legacy-task')
  assert.equal(legacy.calls.consume, 1)
  assert.equal(legacy.calls.parse, 1)
  assert.equal(legacy.calls.runner, 0)
  pass('missing intent headers keep the legacy quota path')

  const keyed = makeController()
  const keyedResult = await keyed.controller.submitResumeParse(dto, request({ ...headers, 'x-terminal-id': 'terminal-1' }))
  assert.equal(keyedResult.taskId, 'intent-task')
  assert.equal(keyed.calls.runner, 1)
  assert.equal(keyed.calls.consume, 0)
  assert.equal(keyed.calls.parse, 0)
  const args = keyed.runnerArgs[0] as [typeof dto, string | null, AiPublicQuotaContext, string, string]
  assert.deepEqual(args[0], dto)
  assert.equal(args[1], null)
  assert.deepEqual(args[2], { member: null, terminal: 'terminal-1', ip: '203.0.113.8' })
  assert.equal(args[3], intent)
  assert.equal(args[4], proof)
  pass('valid intent headers call the runner and skip legacy quota')

  for (const bad of [
    { 'x-resume-parse-intent': intent },
    { 'x-resume-parse-proof': proof },
    { 'x-resume-parse-intent': 'short', 'x-resume-parse-proof': proof },
    { 'x-resume-parse-intent': intent, 'x-resume-parse-proof': intent },
  ]) {
    const harness = makeController()
    await expectHttp(() => harness.controller.submitResumeParse(dto, request(bad)), 400, 'RESUME_PARSE_INTENT_MALFORMED')
    assert.equal(harness.calls.consume, 0)
    assert.equal(harness.calls.parse, 0)
    assert.equal(harness.calls.runner, 0)
    assert.equal(harness.audits.length, 0)
  }
  pass('a partial or malformed intent header makes no quota or provider call')

  const gated = makeController()
  gated.failConsent()
  await assert.rejects(() => gated.controller.submitResumeParse(dto, memberRequest(headers)))
  assert.equal(gated.calls.consent, 1)
  assert.equal(gated.calls.runner, 0)
  assert.equal(gated.calls.consume, 0)
  assert.equal(gated.calls.parse, 0)
  pass('member privacy consent still runs before either parse path')

  const allowed = makeController()
  await allowed.controller.submitResumeParse(dto, memberRequest(headers))
  assert.equal(allowed.calls.consent, 1)
  assert.equal((allowed.runnerArgs[0] as [unknown, string])[1], 'member-1')
  pass('an allowed member reaches the runner with the member id')

  const processing = makeController()
  processing.setRunnerResult({ taskId: 'intent-task', status: 'processing' })
  const processingResult = await processing.controller.submitResumeParse(dto, request(headers))
  assert.equal(processingResult.status, 'processing')
  assert.equal('usage' in processingResult, false)
  const processingAudit = JSON.stringify(processing.audits[0])
  assert.equal(processingAudit.includes(intent), false)
  assert.equal(processingAudit.includes(proof), false)
  assert.equal(processingAudit.includes('usage'), false)
  assert.equal(processingAudit.includes('cost'), false)

  const replayToken = 'replay-access-token'
  const replay = makeController()
  replay.setRunnerResult({ taskId: 'intent-task', status: 'completed', accessToken: replayToken })
  const replayResult = await replay.controller.submitResumeParse(dto, request(headers))
  assert.equal(replayResult.status, 'completed')
  assert.equal(replayResult.accessToken, replayToken)
  assert.equal('usage' in replayResult, false)
  const replayAudit = JSON.stringify(replay.audits[0])
  assert.equal(replayAudit.includes(intent), false)
  assert.equal(replayAudit.includes(proof), false)
  assert.equal(replayAudit.includes(replayToken), false)
  assert.equal(replayAudit.includes('"accessTokenIssued":true'), true)
  pass('processing and replay responses do not invent a model charge or log secrets')

  const missing = makeController()
  missing.dropRunner()
  await expectHttp(() => missing.controller.submitResumeParse(dto, request(headers)), 503, 'RESUME_PARSE_INTENT_UNAVAILABLE')
  assert.equal(missing.calls.consume, 0)
  assert.equal(missing.calls.parse, 0)
  pass('intent headers fail closed when the runner is not injected')

  console.log('PASS POST /resume/parse intent headers')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
