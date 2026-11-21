/**
 * 小程序微信虚拟支付二期（P2d2）PostgreSQL 真并发验证：
 *   1. 20 并发抢核销同一张权益 → 严格 1 次 HTTP 200 成功、19 次 409 VPAY_CREDIT_UNAVAILABLE
 *   2. 10 轮退款发起 vs 一体机核销并发竞态 → 绝不同时成功
 * DATABASE_URL 必须是本机 PostgreSQL，库名含 verify。
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['NODE_ENV'] = 'test'
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['JWT_SECRET'] = 'verify-miniapp-vpay-p2-pg-jwt-secret'
process.env['SECRET_ENCRYPTION_KEY'] = 'verify-miniapp-vpay-p2-pg-pepper-0123456'

import 'reflect-metadata'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { BadRequestException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Redis } from 'ioredis'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { EndUserAuthGuard, memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { installBodyParsers } from '../src/config/body-parsers'
import { MiniappAccessTokenService } from '../src/miniapp-access-token/miniapp-access-token.service'
import type { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { ServiceOrderService } from '../src/payment/service-order.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { VirtualPayCreditRedeemController } from '../src/virtual-pay/virtual-pay-credit-redeem.controller'
import { VirtualPayCreditRedeemService } from '../src/virtual-pay/virtual-pay-credit-redeem.service'
import { VirtualPayRefundService } from '../src/virtual-pay/virtual-pay-refund.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import {
  assertConcurrentCreditRedeem20,
  assertFinishVsLateFailRace,
  assertFinishVsRestoreRace,
  assertSameSessionDoubleCreditRedeem,
} from './support/miniapp-virtual-pay-p2-redeem'
import { assertRefundVsRedeemRace } from './support/miniapp-virtual-pay-p2-refund'

const API_ROOT = resolve(__dirname, '..')

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const label = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) out.push(...Object.values(error.constraints).map((item) => `${label}: ${item}`))
    if (error.children?.length) out.push(...flatten(error.children, label))
  }
  return out
}

function pushSchema(url: string): void {
  execFileSync(
    process.execPath,
    [
      join(API_ROOT, 'node_modules/prisma/build/index.js'),
      'db', 'push', '--url', url, '--accept-data-loss',
      '--config', 'prisma.postgres.config.ts',
      '--schema', 'prisma/postgres/schema.prisma',
    ],
    { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url, POSTGRES_URL: url }, stdio: 'inherit' },
  )
}

function createMemoryRedis() {
  const store = new Map<string, string>()
  return {
    async get(key: string) { return store.get(key) ?? null },
    async setEx(key: string, _ttl: number, value: string) { store.set(key, value) },
    async set(key: string, value: string) { store.set(key, value) },
    async del(key: string) { return store.delete(key) ? 1 : 0 },
    async getDel(key: string) { const val = store.get(key) ?? null; store.delete(key); return val },
    async setIfAbsent(key: string, value: string) {
      if (store.has(key)) return false
      store.set(key, value)
      return true
    },
    async unregisterMemberSession() {},
    async touchMemberSession() { return 1 },
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  if (!databaseUrl.startsWith('postgres')) throw new Error('VPAY_POSTGRES_URL_REQUIRED')
  assertIsolatedVerificationDatabase()
  pushSchema(databaseUrl)

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  let realRedis: RedisService | null = null
  let redisLike: unknown
  if (process.env['REDIS_URL']?.trim()) {
    const client = new Redis(process.env['REDIS_URL'].trim())
    realRedis = new RedisService(client)
    redisLike = realRedis
  } else {
    redisLike = createMemoryRedis()
  }

  const audit = new AuditService(prisma)
  const jwt = new JwtService({ secret: process.env['JWT_SECRET'] })
  const tokens = new MiniappAccessTokenService(redisLike as RedisService)
  const sessions = new TerminalSessionService(
    redisLike as RedisService,
    prisma,
    { async validateTerminalToken() {} },
  )
  const registry = { get: () => null } as unknown as PaymentProviderRegistry
  const serviceOrders = new ServiceOrderService(prisma, audit, sessions, registry, redisLike as RedisService)
  const redeemService = new VirtualPayCreditRedeemService(prisma, audit)
  const refundService = new VirtualPayRefundService(prisma, audit, tokens, redisLike as RedisService)

  @Module({
    controllers: [VirtualPayCreditRedeemController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: JwtService, useValue: jwt },
      { provide: RedisService, useValue: redisLike },
      { provide: TERMINAL_TOKEN_VALIDATOR, useValue: { async validateTerminalToken() {} } },
      { provide: TerminalSessionService, useValue: sessions },
      { provide: VirtualPayCreditRedeemService, useValue: redeemService },
      TerminalIdentityGuard,
      EndUserAuthGuard,
    ],
  })
  class PgFixtureModule {}

  const app = await NestFactory.create(PgFixtureModule, { logger: false, abortOnError: false, bodyParser: false })
  installBodyParsers(app)
  app.setGlobalPrefix('api/v1')
  app.useGlobalFilters(new HttpExceptionFilter())
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: flatten(errors).join('; ') } }),
  }))

  const listenPort = Number(process.env['VPAY_P2_PORT'] || 0)
  try {
    await app.listen(listenPort, '127.0.0.1')
    const port = (app.getHttpServer().address() as AddressInfo).port
    const baseUrl = `http://127.0.0.1:${port}`

    const pgCtx = {
      prisma,
      audit,
      sessions,
      serviceOrders,
      registry,
      http: {
        async post(path: string, body: unknown, headers: Record<string, string>) {
          const res = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
          })
          const text = await res.text()
          return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
        },
        async get(path: string, headers: Record<string, string>) {
          const res = await fetch(`${baseUrl}${path}`, { headers })
          const text = await res.text()
          return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
        },
      },
      async issueMemberToken(endUserId: string) {
        const jti = `pg-jti-${randomBytes(8).toString('hex')}`
        await (redisLike as { setEx(k: string, ttl: number, v: string): Promise<void> }).setEx(
          memberSessionKey(jti),
          1800,
          endUserId,
        )
        return jwt.sign({ sub: endUserId, jti, aud: 'enduser' })
      },
      async issueTerminalHeaders(terminalId: string) {
        const { bootTicket } = await sessions.createBootTicket(terminalId, 'Bearer test')
        const { sessionToken } = await sessions.exchangeBootTicket(bootTicket)
        return { 'x-terminal-id': terminalId, 'x-terminal-session-token': sessionToken }
      },
    }

    await assertConcurrentCreditRedeem20(pgCtx)
    await assertSameSessionDoubleCreditRedeem(pgCtx)
    await assertFinishVsRestoreRace({ prisma, audit })
    await assertFinishVsLateFailRace({ prisma, audit, registry })

    await assertRefundVsRedeemRace({
      prisma,
      refunds: refundService,
      redeem: redeemService,
    })

    console.log(`=== ALL PASS verify-miniapp-virtual-pay-p2:postgres (port=${port}, redis=${realRedis ? 'real' : 'memory'}) ===`)
  } finally {
    await app.close()
    await prisma.onModuleDestroy()
    if (realRedis) await realRedis.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
