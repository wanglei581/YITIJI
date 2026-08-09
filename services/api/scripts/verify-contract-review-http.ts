import 'reflect-metadata'
import 'dotenv/config'
import assert from 'node:assert/strict'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BadRequestException,
  Module,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
  type INestApplication,
  type ValidationError,
} from '@nestjs/common'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import type { ContractReviewCreateInput, ContractReviewRequester } from '../src/contract-review/contract-review.types'
import type { ConfirmContractReviewDto } from '../src/contract-review/dto/contract-review.dto'
import {
  ContractReviewQueueService,
  type ContractReviewQueueAdapter,
  type ContractReviewQueueOptions,
} from '../src/contract-review/contract-review.queue'

process.env['JWT_SECRET'] ||= 'contract-review-http-verifier-jwt-secret'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'contract-review-http-terminal-admin-secret'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'contract-review-http-terminal-action-secret'
const configuredRedisUrl = process.env['REDIS_URL']
const fixtureDirectory = mkdtempSync(join(tmpdir(), 'contract-review-http-'))
const fixtureDatabase = join(fixtureDirectory, 'harness.db')
closeSync(openSync(fixtureDatabase, 'a'))
process.env['DATABASE_URL'] = `file:${fixtureDatabase}`

interface Envelope<T = unknown> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string; details?: string[] }
}

interface StoredTask {
  id: string
  accessToken: string
  status: string
  totalPages: number
  analyzedPages: number
  truncated: boolean
}

class MemoryQueueAdapter implements ContractReviewQueueAdapter {
  readonly jobs = new Map<string, { name: string; taskId: string }>()

  async add(name: string, data: { taskId: string }, options: ContractReviewQueueOptions) {
    this.jobs.set(options.jobId, { name, taskId: data.taskId })
    return { id: options.jobId }
  }
}

class LifecycleHarness {
  private sequence = 0
  private readonly tasks = new Map<string, StoredTask>()

  constructor(private readonly queue: ContractReviewQueueService) {}

  async createAndEnqueue(input: ContractReviewCreateInput, requester: ContractReviewRequester) {
    if (requester.endUserId === null && requester.sourceFileProof !== `proof:${input.sourceFileId}`) {
      throw taskNotFound()
    }
    const id = `http-task-${++this.sequence}`
    const accessToken = 'a'.repeat(42) + String(this.sequence % 10)
    await this.queue.enqueueExtract(id)
    this.tasks.set(id, {
      id, accessToken, status: 'awaiting_confirmation', totalPages: 2,
      analyzedPages: 2, truncated: false,
    })
    return requester.endUserId === null
      ? { id, status: 'uploaded', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), accessToken }
      : { id, status: 'uploaded', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
  }

  async get(id: string, requester: ContractReviewRequester) {
    const task = this.requireTask(id, requester)
    return {
      id, status: task.status, contractType: 'labor_contract', analyzedPages: task.analyzedPages,
      totalPages: task.totalPages, truncated: task.truncated, ocrConfidence: 'high',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      progress: { stage: task.status, completedPages: task.analyzedPages, totalPages: task.totalPages },
      result: null,
    }
  }

  async confirmAndEnqueue(id: string, input: ConfirmContractReviewDto, requester: ContractReviewRequester) {
    const task = this.requireTask(id, requester)
    if (
      input.totalPages !== task.totalPages || input.analyzedPages !== task.analyzedPages ||
      input.truncated !== task.truncated || input.ocrCoverageConfirmed !== true ||
      input.personalUseConfirmed !== true
    ) {
      throw new BadRequestException({
        error: { code: 'CONTRACT_REVIEW_CONFIRMATION_INVALID', message: '确认内容与提取结果不一致' },
      })
    }
    await this.queue.enqueueAnalyze(id)
    task.status = 'rule_checking'
    return { id, status: 'rule_checking' }
  }

  async createReport(id: string, requester: ContractReviewRequester): Promise<never> {
    this.requireTask(id, requester)
    throw new ServiceUnavailableException('REPORT_NOT_AVAILABLE')
  }

  async remove(id: string, requester: ContractReviewRequester) {
    this.requireTask(id, requester)
    this.tasks.delete(id)
    return { id, deleted: true }
  }

  private requireTask(id: string, requester: ContractReviewRequester): StoredTask {
    const task = this.tasks.get(id)
    if (!task || requester.endUserId !== null || requester.accessToken !== task.accessToken || requester.sourceFileProof) {
      throw taskNotFound()
    }
    return task
  }
}

function taskNotFound(): NotFoundException {
  return new NotFoundException({
    error: { code: 'CONTRACT_REVIEW_TASK_NOT_FOUND', message: '合同审查任务不存在' },
  })
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

function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const details: string[] = []
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property
    for (const message of Object.values(error.constraints ?? {})) details.push(`${path}: ${message}`)
    if (error.children?.length) details.push(...flattenValidationErrors(error.children, path))
  }
  return details
}

async function listen(app: INestApplication): Promise<number> {
  const express = app.getHttpAdapter().getInstance() as { set(name: string, value: number): void }
  express.set('trust proxy', 1)
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(validationPipe())
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  return (app.getHttpServer().address() as { port: number }).port
}

async function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  host = '127.0.0.1',
): Promise<{ status: number; body: Envelope }> {
  const response = await fetch(`http://${host}:${port}/api/v1${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() as Envelope }
}

function assertError(response: { status: number; body: Envelope }, status: number, code?: string): void {
  assert.equal(response.status, status)
  assert.equal(response.body.success, false)
  if (code) assert.equal(response.body.error?.code, code)
}

async function verifyDefaultAppHttpWiring(): Promise<void> {
  // Import the default module graph with queue processors disabled; the isolated
  // HTTP harness below supplies its own in-memory queue and must not contact Redis.
  delete process.env['REDIS_URL']
  const [{ AppModule }, { ContractReviewHttpModule }] = await Promise.all([
    import('../src/app.module'),
    import('../src/contract-review/contract-review-http.module'),
  ])
  process.env['REDIS_URL'] = configuredRedisUrl ?? 'redis://127.0.0.1:6379'
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? []) as unknown[]
  assert.equal(imports.includes(ContractReviewHttpModule), true)
}

async function verifyExplicitHttpModule(): Promise<void> {
  const [
    { ContractReviewHttpModule }, { StorageModule }, { AuditModule },
  ] = await Promise.all([
    import('../src/contract-review/contract-review-http.module'),
    import('../src/storage/storage.module'),
    import('../src/audit/audit.module'),
  ])
  const queue = new ContractReviewQueueService(new MemoryQueueAdapter())
  const lifecycle = new LifecycleHarness(queue)
  const consent = {
    async getConsentScope() {
      return {
        disclaimer: {
          id: 'legal-1', version: 'disclaimer-v1', content: '合同审查免责声明',
          publishedAt: new Date(0).toISOString(),
        },
        consentVersion: 'contract-review-consent-v1',
        disclosures: { retention: { maximumHours: 2, sessionDeletionFirst: true } },
        consentScopeHash: 'b'.repeat(64),
      }
    },
  }

  @Module({
    imports: [
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
      StorageModule,
      AuditModule,
      ContractReviewHttpModule.forVerification({
        lifecycle: lifecycle as never,
        consent: consent as never,
        queue,
      }),
    ],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  })
  class ContractReviewHttpVerifierRoot {}

  const app = await NestFactory.create(
    ContractReviewHttpVerifierRoot,
    { logger: false },
  )
  try {
    const port = await listen(app)
    assert.equal((await request(port, 'GET', '/contract-reviews/consent-scope')).status, 200)
    const missingTask = await request(port, 'GET', '/contract-reviews/missing')
    assertError(missingTask, 404, 'CONTRACT_REVIEW_TASK_NOT_FOUND')

    const createBody = {
      sourceFileId: 'file-1', contractType: 'labor_contract',
      consentVersion: 'contract-review-consent-v1', consentedAt: new Date().toISOString(),
      consentScopeHash: 'b'.repeat(64), disclaimerVersion: 'disclaimer-v1',
    }
    assertError(await request(port, 'POST', '/contract-reviews', { ...createBody, token: 'body-token' }), 400, 'VALIDATION_FAILED')
    assertError(await request(port, 'POST', '/contract-reviews', createBody), 404, 'CONTRACT_REVIEW_TASK_NOT_FOUND')
    const created = await request(port, 'POST', '/contract-reviews', createBody, {
      'X-Contract-Review-Source-File-Proof': 'proof:file-1',
    })
    assert.equal(created.status, 201)
    const task = created.body.data as { id: string; accessToken: string }
    assert.ok(task.id && task.accessToken)
    const tokenHeader = { 'X-Contract-Review-Access-Token': task.accessToken }
    assert.equal((await request(port, 'GET', `/contract-reviews/${task.id}`, undefined, tokenHeader)).status, 200)

    const confirmBody = {
      contractType: 'labor_contract', totalPages: 2, analyzedPages: 2, truncated: false,
      ocrCoverageConfirmed: true, personalUseConfirmed: true,
    }
    const replayHeaders = {
      ...tokenHeader,
      'X-Contract-Review-Source-File-Proof': 'proof:file-1',
    }
    for (const replay of [
      await request(port, 'GET', `/contract-reviews/${task.id}`, undefined, replayHeaders),
      await request(port, 'POST', `/contract-reviews/${task.id}/confirm`, confirmBody, replayHeaders),
      await request(port, 'POST', `/contract-reviews/${task.id}/report`, undefined, replayHeaders),
      await request(port, 'DELETE', `/contract-reviews/${task.id}`, undefined, replayHeaders),
    ]) {
      assertError(replay, 404, 'CONTRACT_REVIEW_TASK_NOT_FOUND')
      assert.deepEqual(replay.body.error, missingTask.body.error)
    }
    assert.equal((await request(port, 'GET', `/contract-reviews/${task.id}`, undefined, tokenHeader)).status, 200)
    assertError(await request(port, 'POST', `/contract-reviews/${task.id}/confirm`, {
      ...confirmBody, extractionFingerprint: 'forbidden',
    }, tokenHeader), 400, 'VALIDATION_FAILED')
    assert.equal((await request(port, 'POST', `/contract-reviews/${task.id}/confirm`, confirmBody, tokenHeader)).status, 202)
    assertError(await request(port, 'POST', `/contract-reviews/${task.id}/report`, undefined, tokenHeader), 503, 'REPORT_NOT_AVAILABLE')

    const throttleHeaders = {
      'X-Contract-Review-Source-File-Proof': 'proof:file-1',
      'X-Forwarded-For': '192.0.2.3',
    }
    for (let index = 0; index < 6; index += 1) {
      assert.equal((await request(port, 'POST', '/contract-reviews', createBody, throttleHeaders)).status, 201)
    }
    assertError(await request(port, 'POST', '/contract-reviews', createBody, throttleHeaders), 429, 'RATE_LIMITED')

    const confirmHeaders = { ...tokenHeader, 'X-Forwarded-For': '192.0.2.4' }
    for (let index = 0; index < 8; index += 1) {
      assert.equal((await request(port, 'POST', `/contract-reviews/${task.id}/confirm`, confirmBody, confirmHeaders)).status, 202)
    }
    assertError(await request(port, 'POST', `/contract-reviews/${task.id}/confirm`, confirmBody, confirmHeaders), 429, 'RATE_LIMITED')

    const reportHeaders = { ...tokenHeader, 'X-Forwarded-For': '192.0.2.5' }
    for (let index = 0; index < 4; index += 1) {
      assertError(await request(port, 'POST', `/contract-reviews/${task.id}/report`, undefined, reportHeaders), 503, 'REPORT_NOT_AVAILABLE')
    }
    assertError(await request(port, 'POST', `/contract-reviews/${task.id}/report`, undefined, reportHeaders), 429, 'RATE_LIMITED')
  } finally {
    await app.close()
  }
}

async function main(): Promise<void> {
  try {
    await verifyDefaultAppHttpWiring()
    await verifyExplicitHttpModule()
    console.log('contract review AppModule wiring, DTO, ownership, and throttling contract passed')
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true })
    if (configuredRedisUrl === undefined) delete process.env['REDIS_URL']
    else process.env['REDIS_URL'] = configuredRedisUrl
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
