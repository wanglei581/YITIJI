/**
 * Real Nest HTTP for POST /print/jobs/claim-pickup and :orderId/release.
 *
 * verify-terminal-identity.ts checks the session state machine and guard
 * source text through a fake ExecutionContext. This file is the other half:
 * Nest route dispatch, TerminalIdentityGuard execution, header and parameter
 * binding, and HTTP 401/503. In-memory doubles only — no database, payment
 * authorization, or printer.
 *
 * Spawned by verify:terminal-identity so the existing package gate runs it.
 * Of the 20 scenarios in origin/pr/1035, "missing headers" is omitted: it hits
 * the same early reject as missing the session header or the terminal header.
 * "cooldown holds after Redis recovers" is added so a no-op cooldown cannot
 * hide behind the following reset.
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { AddressInfo } from 'node:net'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { RedisService } from '../src/common/redis/redis.service'
import { resetRedisCooldownForTests } from '../src/common/redis/redis-degradation'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { PrismaService } from '../src/prisma/prisma.service'
import { PrintJobsController } from '../src/print-jobs/print-jobs.controller'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PickupOrderService } from '../src/print-jobs/pickup-order.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import {
  TERMINAL_TOKEN_VALIDATOR,
  TerminalSessionService,
} from '../src/terminals/terminal-session.service'

type Scenario = {
  label: string
  headers: Record<string, string>
  status: number
  fault?: boolean
  enabled?: boolean
  generation?: number
  /** False only for the request that must still fail inside an open cooldown. */
  resetCooldown?: boolean
}

async function main(): Promise<void> {
  process.env['REDIS_UNAVAILABLE_COOLDOWN_MS'] = '30000'
  const terminalA = 'http_fixture_terminal_a'
  const terminalB = 'http_fixture_terminal_b'
  const pickupCode = '12345678'
  const orderId = 'http_fixture_order'
  const paymentToken = 'http_fixture_payment_token'
  const data = new Map<string, string>()
  let redisFault = false
  let redisCalls = 0
  let terminalEnabled = true
  let credentialGeneration = 1
  const calls: { method: string; args: unknown[] }[] = []
  const redis = {
    async get(key: string) {
      redisCalls += 1
      if (redisFault) throw new Error('fixture Redis unavailable')
      return data.get(key) ?? null
    },
    async getDel(key: string) {
      redisCalls += 1
      if (redisFault) throw new Error('fixture Redis unavailable')
      const value = data.get(key) ?? null
      data.delete(key)
      return value
    },
    async setEx(key: string, _ttl: number, value: string) {
      redisCalls += 1
      if (redisFault) throw new Error('fixture Redis unavailable')
      data.set(key, value)
    },
  }
  const prisma = {
    terminal: {
      async findUnique({ where }: { where: { id: string } }) {
        return [terminalA, terminalB].includes(where.id)
          ? { enabled: terminalEnabled, credentialGeneration }
          : null
      },
    },
  }
  const pickupOrders = {
    async claim(...args: unknown[]) {
      calls.push({ method: 'claim', args })
      return { orderId, paymentSessionToken: paymentToken }
    },
    async release(...args: unknown[]) {
      calls.push({ method: 'release', args })
      return { orderId, printTaskId: 'http_fixture_task' }
    },
  }
  const forbiddenDependency = new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string' || property === 'then'
        || property.startsWith('on') || property === 'beforeApplicationShutdown') return undefined
      return () => { throw new Error(`Unexpected dependency call: ${String(property)}`) }
    },
  })

  @Module({
    controllers: [PrintJobsController],
    providers: [
      TerminalIdentityGuard,
      TerminalSessionService,
      { provide: RedisService, useValue: redis },
      { provide: PrismaService, useValue: prisma },
      { provide: PickupOrderService, useValue: pickupOrders },
      { provide: PrintJobsService, useValue: forbiddenDependency },
      { provide: JwtService, useValue: forbiddenDependency },
      {
        provide: TERMINAL_TOKEN_VALIDATOR,
        useValue: {
          async validateTerminalToken(id: string, authorization: string | undefined) {
            assert.ok([terminalA, terminalB].includes(id))
            assert.equal(authorization, 'Bearer http_fixture_agent')
          },
        },
      },
    ],
  })
  class FixtureModule {}

  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false })
  let passed = 0
  try {
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }))
    app.useGlobalFilters(new HttpExceptionFilter())
    const sessions = app.get(TerminalSessionService)
    const boot = await sessions.createBootTicket(terminalA, 'Bearer http_fixture_agent')
    const { sessionToken } = await sessions.exchangeBootTicket(boot.bootTicket)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    assert.equal(address.address, '127.0.0.1')
    const base = `http://127.0.0.1:${address.port}/api/v1/print/jobs`
    const validHeaders = {
      'x-terminal-id': terminalA,
      'x-terminal-session-token': sessionToken,
    }
    const scenarios: Scenario[] = [
      { label: 'missing session', headers: { 'x-terminal-id': terminalA }, status: 401 },
      { label: 'missing terminal', headers: { 'x-terminal-session-token': sessionToken }, status: 401 },
      { label: 'wrong session', headers: { ...validHeaders, 'x-terminal-session-token': 'invalid' }, status: 401 },
      { label: 'cross-terminal token', headers: { ...validHeaders, 'x-terminal-id': terminalB }, status: 401 },
      { label: 'disabled terminal', headers: validHeaders, status: 401, enabled: false },
      { label: 'rotated credential generation', headers: validHeaders, status: 401, generation: 2 },
      { label: 'valid session', headers: validHeaders, status: 200 },
      { label: 'Redis outage', headers: validHeaders, status: 503, fault: true },
      // Must stay immediately after the outage: Redis is healthy again, but the
      // cooldown opened by that error has not been reset.
      { label: 'cooldown holds after Redis recovers', headers: validHeaders, status: 503, resetCooldown: false },
      { label: 'healthy after cooldown reset', headers: validHeaders, status: 200 },
    ]
    for (const route of ['claim', 'release'] as const) {
      for (const scenario of scenarios) {
        calls.length = 0
        redisCalls = 0
        if (scenario.resetCooldown !== false) resetRedisCooldownForTests()
        redisFault = scenario.fault ?? false
        terminalEnabled = scenario.enabled ?? true
        credentialGeneration = scenario.generation ?? 1
        const url = route === 'claim' ? `${base}/claim-pickup` : `${base}/${orderId}/release`
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-payment-session-token': paymentToken,
            ...scenario.headers,
          },
          body: JSON.stringify(route === 'claim' ? { code: pickupCode } : {}),
          signal: AbortSignal.timeout(5000),
        })
        const body = await response.json() as {
          error?: { code?: string }
          orderId?: string
          paymentSessionToken?: string
          printTaskId?: string
        }
        const label = `${route}: ${scenario.label}`
        assert.equal(response.status, scenario.status, `${label}: HTTP status`)
        if (scenario.resetCooldown === false) {
          assert.equal(redisCalls, 0, `${label}: cooldown must reject before touching Redis`)
        }
        if (scenario.status !== 200) {
          assert.equal(calls.length, 0, `${label}: no business calls`)
          assert.equal(body.error?.code, scenario.status === 401
            ? 'TERMINAL_SESSION_INVALID'
            : 'TERMINAL_SESSION_RETRYABLE', `${label}: error code`)
        } else {
          assert.deepEqual(calls, [{
            method: route,
            args: route === 'claim' ? [pickupCode, terminalA] : [orderId, terminalA, paymentToken],
          }], `${label}: exactly one business call with unchanged arguments`)
          assert.deepEqual(body, route === 'claim'
            ? { orderId, paymentSessionToken: paymentToken }
            : { orderId, printTaskId: 'http_fixture_task' }, `${label}: unchanged response`)
        }
        passed += 1
        console.log(`PASS ${label} -> ${response.status}`)
      }
    }
    assert.equal(passed, 20, 'all selected HTTP scenarios executed')
  } finally {
    await app.close()
    assert.equal(app.getHttpServer().listening, false, 'HTTP listener must be closed')
  }
  console.log('PASS app closed')
  console.log(`ALL PASS: ${passed} real HTTP scenarios; in-memory dependencies, no DB/payment/print evidence`)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
