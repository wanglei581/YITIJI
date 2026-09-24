/**
 * POST /resume/parse header branch, then a local HTTP fault injection.
 * The header cases fake the controller dependencies. The file-preflight cases
 * boot Nest against an isolated SQLite file, local disk, and a private redis-server.
 * They do not call a model or OCR provider.
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BadRequestException,
  HttpException,
  Module,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { NestFactory } from '@nestjs/core'
import { Redis } from 'ioredis'
import { AiController } from '../src/ai/ai.controller'
import { AiLogService } from '../src/ai/ai-log.service'
import { AiPublicQuotaService, type AiPublicQuotaContext } from '../src/ai/ai-public-quota.service'
import { AiService } from '../src/ai/ai.service'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { AsrService } from '../src/asr/asr.service'
import { AuditService } from '../src/audit/audit.service'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { REDIS_CLIENT, RedisService } from '../src/common/redis/redis.service'
import { FilesService } from '../src/files/files.service'
import { CURRENT_RESUME_AI_CONSENT_VERSION, MemberPrivacyService } from '../src/member-privacy/member-privacy.service'
import { PrismaModule } from '../src/prisma/prisma.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageModule } from '../src/storage/storage.module'
import { StorageService } from '../src/storage/storage.service'
import { resumeParseAccessTokenHash, resumeParseIntentId } from '../src/ai/resume-parse-intent'
import { ResumeParseIntentRunner } from '../src/ai/resume-parse-intent-runner.service'
import { ResumeParseSubmissionService } from '../src/ai/resume-parse-submission.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

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
    jwt: {
      verify: (token: string) => {
        if (token === 'invalid-member-token') throw new Error('bad token')
        return { sub: 'member-1', jti: 'sid-1' }
      },
    },
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

  const mixedCaseMember = makeController()
  await mixedCaseMember.controller.submitResumeParse(dto, request({
    ...headers,
    authorization: 'bEaReR member-token',
    'x-terminal-id': 'terminal-1',
  }))
  assert.equal(mixedCaseMember.calls.consent, 1)
  assert.equal((mixedCaseMember.runnerArgs[0] as [unknown, string])[1], 'member-1')
  pass('bearer scheme casing still resolves a valid member')

  const invalidBearer = makeController()
  await expectHttp(
    () => invalidBearer.controller.submitResumeParse(dto, request({
      ...headers,
      Authorization: 'bEaReR invalid-member-token',
    })),
    401,
    'MEMBER_TOKEN_INVALID',
  )
  assert.equal(invalidBearer.calls.consent, 0)
  assert.equal(invalidBearer.calls.runner, 0)
  assert.equal(invalidBearer.calls.consume, 0)
  assert.equal(invalidBearer.calls.parse, 0)
  assert.equal(invalidBearer.audits.length, 0)
  pass('a presented bearer that does not resolve is rejected before consent, quota, or the provider')

  const unkeyedInvalid = makeController()
  const unkeyedResult = await unkeyedInvalid.controller.submitResumeParse(dto, request({
    authorization: 'Bearer invalid-member-token',
    'x-terminal-id': 'terminal-1',
  }))
  assert.equal(unkeyedResult.taskId, 'legacy-task')
  assert.equal(unkeyedInvalid.calls.consume, 1)
  assert.equal(unkeyedInvalid.calls.parse, 1)
  assert.equal(unkeyedInvalid.calls.runner, 0)
  assert.equal(unkeyedInvalid.calls.consent, 0)
  pass('an unkeyed request with an unusable bearer stays on the legacy anonymous path')

  const partialBearer = makeController()
  await expectHttp(
    () => partialBearer.controller.submitResumeParse(dto, request({
      authorization: 'Bearer invalid-member-token',
      'x-resume-parse-intent': intent,
    })),
    400,
    'RESUME_PARSE_INTENT_MALFORMED',
  )
  assert.equal(partialBearer.calls.consent, 0)
  assert.equal(partialBearer.calls.consume, 0)
  assert.equal(partialBearer.calls.runner, 0)
  assert.equal(partialBearer.calls.parse, 0)
  pass('a partial intent header is still rejected without quota or a provider call')

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

  await verifyKeyedFilePreflight()
  console.log('PASS POST /resume/parse intent headers')
}

const PDF_SENTINEL = 'ZZ_PREFLIGHT_RESUME_SECRET'
const PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  Buffer.from(PDF_SENTINEL),
])

interface PreflightHttpBody {
  error?: { code?: string; message?: string }
  taskId?: string
  status?: string
  accessToken?: string
}

const preflightSessions = new Map<string, { sub: string; jti: string }>()
const preflightProvider: Array<'keyed' | 'legacy'> = []
let preflightRedis: Redis | null = null

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [AiController],
  providers: [
    AuditService,
    FilesService,
    ResumeParseSubmissionService,
    ResumeParseIntentRunner,
    AiPublicQuotaService,
    RedisService,
    MemberPrivacyService,
    { provide: REDIS_CLIENT, useFactory: () => preflightRedis },
    {
      provide: AiService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        getProviderName: () => 'llm',
        async submitResumeParse(
          input: { fileId: string },
          endUserId: string | null,
          intent?: { intentId: string; accessToken: string | null },
        ) {
          preflightProvider.push(intent ? 'keyed' : 'legacy')
          if (!intent) return { taskId: 'legacy-parse', status: 'completed', providerName: 'llm' }
          const accessToken = endUserId ? null : intent.accessToken
          const output = {
            taskId: intent.intentId,
            status: 'completed' as const,
            providerName: 'llm',
            fileId: input.fileId,
          }
          await prisma.aiResumeResult.create({
            data: {
              taskId: intent.intentId,
              kind: 'parse',
              status: 'completed',
              payloadJson: JSON.stringify(output),
              provider: 'llm',
              endUserId,
              accessTokenHash: accessToken ? resumeParseAccessTokenHash(accessToken) : null,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          })
          return accessToken ? { ...output, accessToken } : output
        },
        async getResumeRecord(taskId: string, requester?: { endUserId: string | null; accessToken: string | null }) {
          const row = await prisma.aiResumeResult.findUnique({
            where: { taskId_kind: { taskId, kind: 'parse' } },
          })
          const tokenOk = !!row?.accessTokenHash
            && !!requester?.accessToken
            && resumeParseAccessTokenHash(requester.accessToken) === row.accessTokenHash
          const ownerOk = !!row && (row.endUserId ? row.endUserId === requester?.endUserId : tokenOk)
          if (!row || !ownerOk) {
            throw new NotFoundException({ error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在' } })
          }
          return JSON.parse(row.payloadJson) as { taskId: string; status: string }
        },
      }),
    },
    { provide: AiLogService, useValue: {} },
    {
      provide: JwtService,
      useValue: {
        verify(token: string, options?: { audience?: string }) {
          if (options?.audience !== 'enduser') throw new Error('audience')
          const session = preflightSessions.get(token)
          if (!session) throw new Error('token')
          return session
        },
      },
    },
    { provide: AsrService, useValue: {} },
    { provide: BenefitRedemptionService, useValue: {} },
    { provide: AssistantSummaryService, useValue: {} },
  ],
})
class ResumeParseFilePreflightModule {}

function rememberEnv(names: readonly string[]): () => void {
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const opened = typeof address === 'object' && address ? address.port : 0
        server.close(() => resolve(opened))
      })
    })
    if (port !== 0 && port !== 6379) return port
  }
  throw new Error('no isolated redis port; refusing 6379')
}

function pingRedis(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 200)
    const finish = (up: boolean) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(up)
    }
    socket.once('error', () => finish(false))
    socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'))
    socket.on('data', (data) => {
      if (data.toString().includes('+PONG')) finish(true)
    })
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      resolve()
    }, 1_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function startRedis(port: number): Promise<{ child: ChildProcess; dir: string }> {
  if (port === 6379) throw new Error('refusing to start redis on port 6379')
  const dir = join(tmpdir(), `resume-parse-preflight-redis-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  const child = spawn('redis-server', [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--save', '',
    '--appendonly', 'no',
    '--daemonize', 'no',
    '--supervised', 'no',
    '--dir', dir,
    '--protected-mode', 'yes',
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null
  child.stdout?.resume()
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000) })
  child.stdin?.on('error', () => undefined)
  child.once('exit', (code, signal) => { exit = { code, signal } })
  const deadline = Date.now() + 8_000
  let up = false
  while (Date.now() < deadline && !exit) {
    if (await pingRedis(port)) {
      up = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
  if (!up || exit) {
    await stopChild(child)
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`redis-server failed to stay up port=${port} stderr=${stderr.trim()}`)
  }
  return { child, dir }
}

async function verifyKeyedFilePreflight(): Promise<void> {
  console.log('=== keyed resume parse file preflight ===')
  const restoreEnv = rememberEnv([
    'DATABASE_URL',
    'VERIFICATION_DATABASE_TARGET',
    'FILE_STORAGE_DRIVER',
    'FILE_STORAGE_DIR',
    'FILE_SIGNING_SECRET',
    'NODE_ENV',
    'AI_RESUME_PARSE_IP_DAILY_LIMIT',
    'AI_RESUME_PARSE_TERMINAL_DAILY_LIMIT',
    'AI_RESUME_PARSE_MEMBER_DAILY_LIMIT',
  ])
  const root = mkdtempSync(join(tmpdir(), 'verify-resume-parse-file-'))
  const databasePath = join(root, 'verify.db')
  const storageDir = join(root, 'storage')
  mkdirSync(storageDir, { recursive: true })
  closeSync(openSync(databasePath, 'a'))
  process.env['NODE_ENV'] = 'test'
  process.env['DATABASE_URL'] = `file:${databasePath}`
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  process.env['FILE_STORAGE_DRIVER'] = 'local'
  process.env['FILE_STORAGE_DIR'] = storageDir
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-parse-file-preflight-secret-32'
  process.env['AI_RESUME_PARSE_IP_DAILY_LIMIT'] = '50'
  process.env['AI_RESUME_PARSE_TERMINAL_DAILY_LIMIT'] = '50'
  process.env['AI_RESUME_PARSE_MEMBER_DAILY_LIMIT'] = '50'
  assertIsolatedVerificationDatabase()

  const port = await freePort()
  const redisServer = await startRedis(port)
  preflightRedis = new Redis({
    host: '127.0.0.1',
    port,
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    reconnectOnError: () => false,
  })
  preflightRedis.on('error', () => undefined)
  await preflightRedis.connect()

  const apiRoot = join(__dirname, '..')
  const prismaCli = join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js')
  if (!existsSync(prismaCli)) throw new Error(`Missing Prisma CLI: ${prismaCli}`)
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    throw new Error(`prisma migrate deploy failed: ${(err.stderr || err.stdout || err.message || 'unknown error').trim()}`)
  }

  const app = await NestFactory.create(ResumeParseFilePreflightModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' },
    }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/v1`
  const prisma = app.get(PrismaService)
  const files = app.get(FilesService)
  const storage = app.get(StorageService)
  let headCalls = 0
  let getCalls = 0
  let unreadableKey: string | null = null
  const originalHead = storage.headObject.bind(storage)
  const originalGet = storage.getObject.bind(storage)
  storage.headObject = async (objectKey: string, bucket?: string | null) => {
    headCalls += 1
    if (unreadableKey && objectKey === unreadableKey) throw new Error('EIO')
    return originalHead(objectKey, bucket)
  }
  storage.getObject = async (objectKey: string, bucket?: string | null) => {
    getCalls += 1
    return originalGet(objectKey, bucket)
  }

  const suffix = randomBytes(4).toString('hex')
  const userA = await prisma.endUser.create({
    data: { phoneHash: `preflight-a-${suffix}`, phoneEnc: `enc-a-${suffix}` },
  })
  const userB = await prisma.endUser.create({
    data: { phoneHash: `preflight-b-${suffix}`, phoneEnc: `enc-b-${suffix}` },
  })
  preflightSessions.set('token-a', { sub: userA.id, jti: 'sess-a' })
  preflightSessions.set('token-b', { sub: userB.id, jti: 'sess-b' })
  await preflightRedis.set(memberSessionKey('sess-a'), userA.id, 'EX', 1800)
  await preflightRedis.set(memberSessionKey('sess-b'), userB.id, 'EX', 1800)

  const upload = async (endUserId: string | null) => {
    const saved = await files.upload({
      buffer: PDF_BYTES,
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      purpose: 'resume_upload',
      uploaderId: null,
      endUserId,
      actorRole: null,
    })
    return prisma.fileObject.findUniqueOrThrow({ where: { id: saved.fileId } })
  }

  try {
    const healthy = await upload(null)
    const legacyFile = await upload(null)
    const expired = await upload(null)
    const deleted = await upload(null)
    const foreign = await upload(userA.id)
    const missingObject = await upload(null)
    const unreadable = await upload(null)
    await prisma.fileObject.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    await prisma.fileObject.update({
      where: { id: deleted.id },
      data: { status: 'deleted', deletedAt: new Date(), deletedBy: 'verify', deleteReason: 'preflight' },
    })
    await storage.deleteObject(missingObject.storageKey, missingObject.bucket)
    unreadableKey = unreadable.storageKey

    const quotaSnapshot = async () => {
      const keys = await preflightRedis!.keys('quota:ai_public:resume_parse:*')
      const rows: Record<string, string> = {}
      for (const key of keys.sort()) rows[key] = (await preflightRedis!.get(key)) ?? ''
      return rows
    }
    const post = async (input: {
      fileId: string
      key?: string
      proof?: string
      fileName?: string
      token?: string
      authorization?: string
    }) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-terminal-id': 'preflight-terminal',
      }
      if (input.key) headers['x-resume-parse-intent'] = input.key
      if (input.proof) headers['x-resume-parse-proof'] = input.proof
      if (input.authorization !== undefined) headers.Authorization = input.authorization
      else if (input.token) headers.Authorization = `Bearer ${input.token}`
      const res = await fetch(`${base}/resume/parse`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileId: input.fileId,
          fileName: input.fileName ?? 'resume.pdf',
          fileFormat: 'pdf',
          source: 'upload',
        }),
      })
      return { status: res.status, body: await res.json() as PreflightHttpBody }
    }
    const fresh = () => ({
      key: randomBytes(32).toString('base64url'),
      proof: randomBytes(32).toString('base64url'),
    })
    const intentOf = (key: string) => prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: resumeParseIntentId(key), kind: 'parse_intent' } },
    })
    const hidden = (value: unknown, secrets: readonly string[]) => {
      const text = JSON.stringify(value)
      for (const secret of secrets) {
        if (secret) assert.equal(text.includes(secret), false, secret)
      }
    }

    assert.deepEqual(await quotaSnapshot(), {})
    const absentPair = fresh()
    const absent = await post({ fileId: `missing-${suffix}`, ...absentPair })
    const absentAgain = await post({ fileId: `missing-${suffix}`, ...absentPair })
    assert.equal(absent.status, 404)
    assert.equal(absent.body.error?.code, 'FILE_NOT_FOUND')
    assert.equal(absent.body.error?.message, '文件不存在或已被清理')
    assert.deepEqual(absentAgain.body.error, absent.body.error)
    assert.equal((await intentOf(absentPair.key))?.status, 'quota_pending')
    assert.equal(headCalls, 0)
    const masked = { code: absent.body.error?.code, message: absent.body.error?.message }

    const cases: Array<{ label: string; fileId: string; heads: number }> = [
      { label: 'expired', fileId: expired.id, heads: 0 },
      { label: 'deleted', fileId: deleted.id, heads: 0 },
      { label: 'other owner', fileId: foreign.id, heads: 0 },
      { label: 'storage missing', fileId: missingObject.id, heads: 2 },
    ]
    for (const item of cases) {
      const heads = headCalls
      const pair = fresh()
      const first = await post({ fileId: item.fileId, ...pair })
      const second = await post({ fileId: item.fileId, ...pair })
      assert.equal(first.status, 404, item.label)
      assert.deepEqual({ code: first.body.error?.code, message: first.body.error?.message }, masked, item.label)
      assert.deepEqual(second.body.error, first.body.error, item.label)
      assert.equal(headCalls - heads, item.heads, item.label)
      const intent = await intentOf(pair.key)
      assert.equal(intent?.status, 'quota_pending', item.label)
      assert.equal(intent?.endUserId ?? null, null, item.label)
      hidden(first.body, [pair.key, pair.proof, PDF_SENTINEL, foreign.storageKey, userA.id])
    }
    pass('absent, expired, deleted, other owner, and storage-missing files do not charge or read bytes')

    const memberHeads = headCalls
    const memberPair = fresh()
    const noConsent = await post({ fileId: foreign.id, ...memberPair, token: 'token-a' })
    assert.equal(noConsent.status, 403)
    assert.equal(noConsent.body.error?.code, 'USER_AI_CONSENT_REQUIRED')
    assert.equal(await intentOf(memberPair.key), null)
    assert.equal(headCalls, memberHeads)
    await prisma.userAiConsent.create({
      data: {
        endUserId: userB.id,
        scope: 'resume_ai',
        consentVersion: CURRENT_RESUME_AI_CONSENT_VERSION,
      },
    })
    const crossPair = fresh()
    const crossHeads = headCalls
    const cross = await post({ fileId: foreign.id, ...crossPair, token: 'token-b' })
    const crossAgain = await post({ fileId: foreign.id, ...crossPair, token: 'token-b' })
    assert.equal(cross.status, 404)
    assert.deepEqual({ code: cross.body.error?.code, message: cross.body.error?.message }, masked)
    assert.deepEqual(crossAgain.body.error, cross.body.error)
    assert.equal(headCalls, crossHeads)
    assert.equal((await intentOf(crossPair.key))?.endUserId, userB.id)
    hidden(cross.body, [crossPair.key, crossPair.proof, PDF_SENTINEL, foreign.storageKey, userA.id, userB.id])

    const unreadHeads = headCalls
    const unreadPair = fresh()
    const unread = await post({ fileId: unreadable.id, ...unreadPair })
    const unreadAgain = await post({ fileId: unreadable.id, ...unreadPair })
    assert.equal(unread.status, 503)
    assert.equal(unread.body.error?.code, 'FILE_STORAGE_UNAVAILABLE')
    assert.equal(unread.body.error?.message, '文件暂时无法读取，请稍后重试')
    assert.deepEqual(unreadAgain.body.error, unread.body.error)
    assert.equal(headCalls - unreadHeads, 2)
    assert.equal((await intentOf(unreadPair.key))?.status, 'quota_pending')
    hidden(unread.body, [unreadPair.key, unreadPair.proof, PDF_SENTINEL, unreadable.storageKey, 'EIO'])
    assert.deepEqual(await quotaSnapshot(), {})
    assert.deepEqual(preflightProvider, [])
    assert.equal(getCalls, 0)
    pass('member consent and an unreadable object stay before quota; provider and object reads stay at zero')

    const validPair = fresh()
    const valid = await post({ fileId: healthy.id, ...validPair })
    assert.equal(valid.status, 201)
    assert.equal(valid.body.status, 'completed')
    assert.equal(valid.body.taskId, resumeParseIntentId(validPair.key))
    assert.equal(typeof valid.body.accessToken, 'string')
    const charged = await quotaSnapshot()
    const replay = await post({ fileId: healthy.id, ...validPair })
    assert.equal(replay.status, 201)
    assert.equal(replay.body.taskId, valid.body.taskId)
    assert.equal(replay.body.accessToken, valid.body.accessToken)
    assert.deepEqual(await quotaSnapshot(), charged)
    assert.deepEqual(preflightProvider, ['keyed'])
    assert.equal((await intentOf(validPair.key))?.status, 'completed')
    const wrongProof = randomBytes(32).toString('base64url')
    const wrongHeads = headCalls
    const wrong = await post({ fileId: healthy.id, key: validPair.key, proof: wrongProof })
    assert.equal(wrong.status, 404)
    assert.equal(wrong.body.error?.code, 'AI_TASK_NOT_FOUND')
    const mismatched = await post({ fileId: healthy.id, ...validPair, fileName: 'other.pdf' })
    assert.equal(mismatched.status, 409)
    assert.equal(mismatched.body.error?.code, 'RESUME_PARSE_INTENT_PAYLOAD_MISMATCH')
    assert.equal(headCalls, wrongHeads)
    assert.deepEqual(await quotaSnapshot(), charged)
    assert.deepEqual(preflightProvider, ['keyed'])
    await storage.deleteObject(healthy.storageKey, healthy.bucket)
    const afterDelete = await post({ fileId: healthy.id, ...validPair })
    assert.equal(afterDelete.status, 201)
    assert.equal(afterDelete.body.taskId, valid.body.taskId)
    assert.deepEqual(preflightProvider, ['keyed'])
    assert.deepEqual(await quotaSnapshot(), charged)
    hidden(valid.body, [validPair.key, validPair.proof, PDF_SENTINEL, healthy.storageKey])
    const audits = await prisma.auditLog.findMany({ where: { action: 'resume.parse_submitted' } })
    assert.equal(audits.length, 3)
    for (const audit of audits) {
      hidden(audit.payloadJson, [validPair.key, validPair.proof, valid.body.accessToken ?? '', PDF_SENTINEL])
    }
    pass('a readable file charges once, replays without the object, and rejects a changed proof before probing')

    const legacy = await post({ fileId: legacyFile.id })
    assert.equal(legacy.status, 201)
    assert.equal(legacy.body.taskId, 'legacy-parse')
    assert.deepEqual(preflightProvider, ['keyed', 'legacy'])
    const onceKeys = Object.keys(await quotaSnapshot()).filter((key) => key.includes(':once:'))
    assert.equal(onceKeys.length, 1)
    assert.equal(await prisma.aiResumeResult.count({ where: { taskId: 'legacy-parse', kind: 'parse_intent' } }), 0)
    assert.equal(getCalls, 0)
    pass('the unkeyed route still reaches the provider and does not read the object bytes')

    const owned = await upload(userA.id)
    const guardPair = fresh()
    const invalidToken = randomBytes(24).toString('base64url')
    const guardQuota = await quotaSnapshot()
    const guardProvider = [...preflightProvider]
    const guardHeads = headCalls
    const guardGets = getCalls
    assert.equal(await prisma.userAiConsent.count({ where: { endUserId: userA.id } }), 0)
    const rejected = await post({
      fileId: owned.id,
      ...guardPair,
      authorization: `bEaReR ${invalidToken}`,
    })
    assert.equal(rejected.status, 401)
    assert.equal(rejected.body.error?.code, 'MEMBER_TOKEN_INVALID')
    assert.equal(rejected.body.error?.message, '登录已失效,请重新登录')
    assert.equal(rejected.body.taskId, undefined)
    assert.equal(await prisma.aiResumeResult.count({ where: { taskId: resumeParseIntentId(guardPair.key) } }), 0)
    assert.equal(await prisma.auditLog.count({ where: { action: 'resume.parse_submitted', targetId: owned.id } }), 0)
    assert.equal(await prisma.userAiConsent.count({ where: { endUserId: userA.id } }), 0)
    assert.deepEqual(await quotaSnapshot(), guardQuota)
    assert.deepEqual(preflightProvider, guardProvider)
    assert.equal(headCalls, guardHeads)
    assert.equal(getCalls, guardGets)
    hidden(rejected.body, [guardPair.key, guardPair.proof, invalidToken, PDF_SENTINEL, owned.storageKey, userA.id, userB.id])

    await prisma.userAiConsent.create({
      data: {
        endUserId: userA.id,
        scope: 'resume_ai',
        consentVersion: CURRENT_RESUME_AI_CONSENT_VERSION,
      },
    })
    const accepted = await post({ fileId: owned.id, ...guardPair, token: 'token-a' })
    assert.equal(accepted.status, 201)
    assert.equal(accepted.body.status, 'completed')
    assert.equal(accepted.body.taskId, resumeParseIntentId(guardPair.key))
    assert.equal(accepted.body.accessToken, undefined)
    assert.equal((await intentOf(guardPair.key))?.endUserId, userA.id)
    assert.equal((await intentOf(guardPair.key))?.status, 'completed')
    const chargedGuard = await quotaSnapshot()
    assert.notDeepEqual(chargedGuard, guardQuota)
    const replayed = await post({ fileId: owned.id, ...guardPair, token: 'token-a' })
    assert.equal(replayed.status, 201)
    assert.equal(replayed.body.taskId, accepted.body.taskId)
    assert.equal(replayed.body.status, 'completed')
    assert.deepEqual(await quotaSnapshot(), chargedGuard)
    assert.deepEqual(preflightProvider, [...guardProvider, 'keyed'])
    assert.equal(await prisma.auditLog.count({ where: { action: 'resume.parse_submitted', targetId: owned.id } }), 2)
    hidden(accepted.body, [guardPair.key, guardPair.proof, invalidToken, PDF_SENTINEL, owned.storageKey, userA.id])
    hidden(replayed.body, [guardPair.key, guardPair.proof, invalidToken, 'token-a', PDF_SENTINEL, owned.storageKey, userA.id])
    pass('an invalid bearer writes nothing, then the same key succeeds once for the member and replays')

    const anonFile = await upload(null)
    const anonPair = fresh()
    const anon = await post({ fileId: anonFile.id, ...anonPair })
    assert.equal(anon.status, 201)
    assert.equal(anon.body.status, 'completed')
    assert.equal(anon.body.taskId, resumeParseIntentId(anonPair.key))
    assert.equal(typeof anon.body.accessToken, 'string')
    assert.equal((await intentOf(anonPair.key))?.endUserId ?? null, null)
    assert.deepEqual(preflightProvider, [...guardProvider, 'keyed', 'keyed'])
    hidden(anon.body, [anonPair.key, anonPair.proof, invalidToken, PDF_SENTINEL, anonFile.storageKey])
    pass('a keyed request with no authorization stays anonymous')
    console.log('PASS keyed resume parse file preflight')
  } finally {
    preflightSessions.clear()
    preflightProvider.splice(0, preflightProvider.length)
    await app.close().catch(() => undefined)
    preflightRedis?.disconnect()
    preflightRedis = null
    await stopChild(redisServer.child)
    rmSync(redisServer.dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    restoreEnv()
  }
}

function mkdtempSync(prefix: string): string {
  const { mkdtempSync: make } = require('node:fs') as typeof import('node:fs')
  return make(prefix)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
