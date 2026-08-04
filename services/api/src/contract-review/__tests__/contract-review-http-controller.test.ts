import 'reflect-metadata'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  BadRequestException,
  HttpStatus,
  Module,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
  type INestApplication,
  type Type,
  type ValidationError,
} from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { NestFactory } from '@nestjs/core'
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter'
import { RedisService } from '../../common/redis/redis.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { CreateContractReviewDto } from '../dto/contract-review.dto'
import type { ContractReviewRequester } from '../contract-review.types'

process.env['TERMINAL_ADMIN_SECRET'] = 'test-terminal-admin-secret-1234567890'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] = 'test-terminal-action-secret-123456789'

interface CallRecord {
  method: string
  id?: string
  requester: ContractReviewRequester
}

class LifecycleHarness {
  readonly calls: CallRecord[] = []

  async createAndEnqueue(_dto: CreateContractReviewDto, requester: ContractReviewRequester) {
    this.calls.push({ method: 'create', requester })
    return requester.endUserId
      ? { id: 'task-member', status: 'uploaded', expiresAt: new Date(0).toISOString() }
      : {
          id: 'task-anonymous',
          status: 'uploaded',
          expiresAt: new Date(0).toISOString(),
          accessToken: 'a'.repeat(43),
        }
  }

  async get(id: string, requester: ContractReviewRequester) {
    this.calls.push({ method: 'get', id, requester })
    rejectSourceProofReplay(requester)
    return { id, status: 'queued', result: null }
  }

  async confirmAndEnqueue(id: string, _dto: unknown, requester: ContractReviewRequester) {
    this.calls.push({ method: 'confirm', id, requester })
    rejectSourceProofReplay(requester)
    return { id, status: 'rule_checking' }
  }

  async createReport(id: string, requester: ContractReviewRequester): Promise<never> {
    this.calls.push({ method: 'report', id, requester })
    rejectSourceProofReplay(requester)
    throw new ServiceUnavailableException('REPORT_NOT_AVAILABLE')
  }

  async remove(id: string, requester: ContractReviewRequester) {
    this.calls.push({ method: 'remove', id, requester })
    rejectSourceProofReplay(requester)
    return { id, deleted: true }
  }
}

function rejectSourceProofReplay(requester: ContractReviewRequester): void {
  if (requester.sourceFileProof === null) return
  throw new NotFoundException({
    error: {
      code: 'CONTRACT_REVIEW_TASK_NOT_FOUND',
      message: '合同审查任务不存在',
    },
  })
}

class ConsentHarness {
  async getConsentScope() {
    return {
      id: 'disclaimer-1',
      version: 'contract-review-disclaimer-v1',
      content: '用于测试的合同审查免责声明',
      publishedAt: new Date(0).toISOString(),
      disclosures: { retention: { maximumHours: 2, sessionDeletionFirst: true } },
      consentScopeHash: 'b'.repeat(64),
    }
  }
}

const jwtHarness = {
  verify(token: string): { sub: string; jti: string } {
    if (token !== 'member-token') throw new Error('invalid token')
    return { sub: 'member-1', jti: 'session-1' }
  },
}

const redisHarness = {
  async get(key: string): Promise<string | null> {
    return key === 'member:session:session-1' ? 'member-1' : null
  },
  async unregisterMemberSession(): Promise<void> {},
}

const prismaHarness = {
  endUser: {
    async findUnique(): Promise<{ enabled: boolean; status: string }> {
      return { enabled: true, status: 'active' }
    },
  },
}

function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const details: string[] = []
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property
    for (const message of Object.values(error.constraints ?? {})) details.push(`${path}: ${message}`)
    if (error.children?.length) details.push(...flattenValidationErrors(error.children, path))
  }
  return details
}

function validationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const details = flattenValidationErrors(errors)
      return new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: details[0] ?? '请求参数校验失败',
          details,
        },
      })
    },
  })
}

function createHarnessModule(
  lifecycle: LifecycleHarness,
  controller: Type<unknown>,
  lifecycleToken: Type<unknown>,
  consentToken: Type<unknown>,
) {
  @Module({
    imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }])],
    controllers: [controller],
    providers: [
      { provide: lifecycleToken, useValue: lifecycle },
      { provide: consentToken, useValue: new ConsentHarness() },
      { provide: JwtService, useValue: jwtHarness },
      { provide: RedisService, useValue: redisHarness },
      { provide: PrismaService, useValue: prismaHarness },
      { provide: APP_GUARD, useClass: ThrottlerGuard },
    ],
  })
  class ContractReviewHttpTestRoot {}
  return ContractReviewHttpTestRoot
}

interface ApiEnvelope<T = unknown> {
  success: boolean
  data?: T
  error?: { code?: string; message?: string; details?: string[] }
}

interface RunningHarness {
  app: INestApplication
  baseUrl: string
  lifecycle: LifecycleHarness
}

const runningApps: INestApplication[] = []

async function startHarness(): Promise<RunningHarness> {
  const lifecycle = new LifecycleHarness()
  const [{ ContractReviewController }, { ContractReviewLifecycleService }, { ContractReviewConsentService }] = await Promise.all([
    import('../contract-review.controller'),
    import('../contract-review-lifecycle.service'),
    import('../contract-review-consent.service'),
  ])
  const app = await NestFactory.create(createHarnessModule(
    lifecycle,
    ContractReviewController,
    ContractReviewLifecycleService,
    ContractReviewConsentService,
  ), { logger: false })
  app.useGlobalPipes(validationPipe())
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  runningApps.push(app)
  const address = app.getHttpServer().address() as { port: number }
  return { app, baseUrl: `http://127.0.0.1:${address.port}`, lifecycle }
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: ApiEnvelope }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() as ApiEnvelope }
}

const validCreate = Object.freeze({
  sourceFileId: 'file-1',
  contractType: 'labor_contract',
  consentVersion: 'member-privacy-v1',
  consentedAt: '2026-08-01T00:00:00.000Z',
  consentScopeHash: 'b'.repeat(64),
  disclaimerVersion: 'contract-review-disclaimer-v1',
})

const validConfirm = Object.freeze({
  contractType: 'labor_contract',
  totalPages: 2,
  analyzedPages: 2,
  truncated: false,
  ocrCoverageConfirmed: true,
  personalUseConfirmed: true,
})

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.close()))
})

test('HTTP module is explicit, contains no global guard, and stays outside default module wiring', async () => {
  const [{ ContractReviewHttpModule }, { ContractReviewModule }, { ContractReviewController }, { JwtVerifierModule }, { RedisModule }] = await Promise.all([
    import('../contract-review-http.module'),
    import('../contract-review.module'),
    import('../contract-review.controller'),
    import('../../common/jwt-verifier.module'),
    import('../../common/redis/redis.module'),
  ])
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, ContractReviewHttpModule) ?? []) as unknown[]
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ContractReviewHttpModule) ?? []) as unknown[]
  const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ContractReviewHttpModule) ?? []) as unknown[]
  assert.deepEqual(imports, [ContractReviewModule, JwtVerifierModule, RedisModule])
  assert.deepEqual(controllers, [ContractReviewController])
  assert.equal(providers.some((provider) => (
    typeof provider === 'object' && provider !== null && (provider as { provide?: unknown }).provide === APP_GUARD
  )), false)

  const defaultModule = readFileSync(resolve(__dirname, '../contract-review.module.ts'), 'utf8')
  const appModule = readFileSync(resolve(__dirname, '../../app.module.ts'), 'utf8')
  assert.doesNotMatch(defaultModule, /ContractReviewHttpModule|ContractReviewController/u)
  assert.doesNotMatch(appModule, /ContractReviewHttpModule|ContractReviewController/u)
})

test('real HTTP pipeline enforces exact DTO keys and endpoint status contracts', async () => {
  const { baseUrl, lifecycle } = await startHarness()

  const scope = await request(baseUrl, 'GET', '/contract-reviews/consent-scope')
  assert.equal(scope.status, HttpStatus.OK)
  assert.equal(scope.body.success, true)

  const created = await request(baseUrl, 'POST', '/contract-reviews', validCreate, {
    'x-contract-review-source-file-proof': 'signed-source-proof',
  })
  assert.equal(created.status, HttpStatus.CREATED)
  assert.equal(created.body.success, true)

  for (const invalid of [
    { ...validCreate, accessToken: 'body-token-is-forbidden' },
    { ...validCreate, sourceFileProof: 'body-proof-is-forbidden' },
    { ...validCreate, consentScopeHash: 'not-a-sha256' },
  ]) {
    const response = await request(baseUrl, 'POST', '/contract-reviews', invalid)
    assert.equal(response.status, HttpStatus.BAD_REQUEST)
    assert.equal(response.body.error?.code, 'VALIDATION_FAILED')
  }

  const confirmed = await request(baseUrl, 'POST', '/contract-reviews/task-1/confirm', validConfirm, {
    'x-contract-review-access-token': 'a'.repeat(43),
  })
  assert.equal(confirmed.status, HttpStatus.ACCEPTED)
  assert.equal(confirmed.body.success, true)

  for (const invalid of [
    { ...validConfirm, personalUseConfirmed: false },
    { ...validConfirm, fingerprint: 'forbidden' },
    { ...validConfirm, analyzedPages: -1 },
  ]) {
    const response = await request(baseUrl, 'POST', '/contract-reviews/task-1/confirm', invalid)
    assert.equal(response.status, HttpStatus.BAD_REQUEST)
    assert.equal(response.body.error?.code, 'VALIDATION_FAILED')
  }

  const report = await request(baseUrl, 'POST', '/contract-reviews/task-1/report', undefined, {
    'x-contract-review-access-token': 'a'.repeat(43),
  })
  assert.equal(report.status, HttpStatus.SERVICE_UNAVAILABLE)
  assert.equal(report.body.error?.code, 'REPORT_NOT_AVAILABLE')
  assert.equal(lifecycle.calls.filter((call) => call.method === 'confirm').length, 1)
})

test('requester parsing is header-only and a valid member overrides anonymous headers', async () => {
  const { baseUrl, lifecycle } = await startHarness()
  await request(baseUrl, 'POST', '/contract-reviews', validCreate, {
    authorization: 'Bearer member-token',
    'x-contract-review-access-token': 'a'.repeat(43),
    'x-contract-review-source-file-proof': 'anonymous-proof',
  })
  assert.deepEqual(lifecycle.calls.at(-1)?.requester, {
    endUserId: 'member-1',
    accessToken: null,
    sourceFileProof: null,
  })

  await request(
    baseUrl,
    'GET',
    `/contract-reviews/task-1?accessToken=${'a'.repeat(43)}&sourceFileProof=query-proof`,
    undefined,
    { authorization: 'Bearer invalid-token' },
  )
  assert.deepEqual(lifecycle.calls.at(-1)?.requester, {
    endUserId: null,
    accessToken: null,
    sourceFileProof: null,
  })

  await request(baseUrl, 'GET', '/contract-reviews/task-1', undefined, {
    'x-contract-review-access-token': 'a'.repeat(43),
    'x-contract-review-source-file-proof': 'must-not-be-replayed',
  })
  assert.deepEqual(lifecycle.calls.at(-1)?.requester, {
    endUserId: null,
    accessToken: 'a'.repeat(43),
    sourceFileProof: 'must-not-be-replayed',
  })
})

test('source-file proof replay is the same 404 on every non-create endpoint', async () => {
  const { baseUrl } = await startHarness()
  const headers = {
    'x-contract-review-access-token': 'a'.repeat(43),
    'x-contract-review-source-file-proof': 'must-not-be-replayed',
  }
  const requests = [
    () => request(baseUrl, 'GET', '/contract-reviews/task-1', undefined, headers),
    () => request(baseUrl, 'POST', '/contract-reviews/task-1/confirm', validConfirm, headers),
    () => request(baseUrl, 'POST', '/contract-reviews/task-1/report', undefined, headers),
    () => request(baseUrl, 'DELETE', '/contract-reviews/task-1', undefined, headers),
  ]
  for (const makeRequest of requests) {
    const response = await makeRequest()
    assert.equal(response.status, HttpStatus.NOT_FOUND)
    assert.deepEqual(response.body.error, {
      code: 'CONTRACT_REVIEW_TASK_NOT_FOUND',
      message: '合同审查任务不存在',
    })
  }
})

test('real global throttler returns the unified 429 envelope', async () => {
  const { baseUrl } = await startHarness()
  const statuses: number[] = []
  for (let index = 0; index < 7; index += 1) {
    statuses.push((await request(baseUrl, 'POST', '/contract-reviews', validCreate, {
      'x-contract-review-source-file-proof': `proof-${index}`,
    })).status)
  }
  assert.deepEqual(statuses.slice(0, 6), Array(6).fill(HttpStatus.CREATED))
  assert.equal(statuses[6], HttpStatus.TOO_MANY_REQUESTS)

  const limited = await request(baseUrl, 'POST', '/contract-reviews', validCreate)
  assert.equal(limited.status, HttpStatus.TOO_MANY_REQUESTS)
  assert.equal(limited.body.error?.code, 'RATE_LIMITED')
})

test('controller source delegates only to lifecycle/consent and does not import core queue or cleanup', async () => {
  const { ContractReviewController } = await import('../contract-review.controller')
  const source = readFileSync(resolve(__dirname, '../contract-review.controller.ts'), 'utf8')
  assert.doesNotMatch(source, /ContractReviewQueueService|ContractReviewService|ContractReviewCleanupTask|PrismaTransaction/u)
  assert.match(source, /this\.lifecycle\.createAndEnqueue/u)
  assert.match(source, /this\.lifecycle\.confirmAndEnqueue/u)
  assert.match(source, /this\.consent\.getConsentScope/u)
  assert.equal(Reflect.getMetadata(PATH_METADATA, ContractReviewController), 'contract-reviews')
})
