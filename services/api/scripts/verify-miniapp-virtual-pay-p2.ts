/**
 * 小程序微信虚拟支付二期（P2d2）：权益核销、失败退回、官方退款、推送与查单收敛、后台接口。
 * 临时 SQLite（支持接入 REDIS_URL 真 Redis 或本地内存 Redis，支持指定 VPAY_P2_PORT 真端口如 3374）。
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['NODE_ENV'] = 'test'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['JWT_SECRET'] = 'verify-miniapp-vpay-p2-jwt-secret'
process.env['SECRET_ENCRYPTION_KEY'] = 'verify-miniapp-vpay-p2-pepper-key-0123456'

import 'reflect-metadata'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BadRequestException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Redis } from 'ioredis'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { EndUserAuthGuard, memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { installBodyParsers } from '../src/config/body-parsers'
import { MiniappAccessTokenService } from '../src/miniapp-access-token/miniapp-access-token.service'
import type { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { ServiceOrderService } from '../src/payment/service-order.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { VirtualPayAdminController } from '../src/virtual-pay/virtual-pay-admin.controller'
import { VirtualPayAdminService } from '../src/virtual-pay/virtual-pay-admin.service'
import { VirtualPayCreditRedeemController } from '../src/virtual-pay/virtual-pay-credit-redeem.controller'
import { VirtualPayCreditRedeemService } from '../src/virtual-pay/virtual-pay-credit-redeem.service'
import { VirtualPayCreditsController } from '../src/virtual-pay/virtual-pay-credits.controller'
import { VirtualPayCreditsService } from '../src/virtual-pay/virtual-pay-credits.service'
import { VirtualPayReconcileService } from '../src/virtual-pay/virtual-pay-reconcile.service'
import { VirtualPayRefundService } from '../src/virtual-pay/virtual-pay-refund.service'
import { WechatMiniappMessageController } from '../src/virtual-pay/wechat-miniapp-message.controller'
import { WechatMiniappMessageService } from '../src/virtual-pay/wechat-miniapp-message.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { assertVirtualPayRedeemFlow } from './support/miniapp-virtual-pay-p2-redeem'
import { assertVirtualPayRefundAndAdmin } from './support/miniapp-virtual-pay-p2-refund'

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
    [join(API_ROOT, 'node_modules/prisma/build/index.js'), 'db', 'push', '--url', url, '--accept-data-loss'],
    { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' },
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
    async setJsonIfVersionNotOlder() { return 'written' as const },
  }
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'verify-miniapp-vpay-p2-'))
  const dbPath = join(tempDir, 'verify.db')
  closeSync(openSync(dbPath, 'w'))
  const dbUrl = `file:${dbPath}`
  process.env['DATABASE_URL'] = dbUrl
  assertIsolatedVerificationDatabase()
  pushSchema(dbUrl)

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
  // 故意让现金 provider.refund 抛错：证明 miniapp_credit 退回绝不会调微信 Native 退款！
  const registry = {
    get: () => ({
      channel: 'wechat',
      async createQrPayment() { throw new Error('UNEXPECTED_CASH_QR') },
      async refund() { throw new Error('UNEXPECTED_NATIVE_REFUND_FOR_MINIAPP_CREDIT') },
    }),
  } as unknown as PaymentProviderRegistry

  const serviceOrders = new ServiceOrderService(prisma, audit, sessions, registry, redisLike as RedisService)
  const redeemService = new VirtualPayCreditRedeemService(prisma, audit)
  const refundService = new VirtualPayRefundService(prisma, audit, tokens, redisLike as RedisService)
  const reconcileService = new VirtualPayReconcileService(prisma, audit, tokens, redisLike as RedisService)
  const adminService = new VirtualPayAdminService(prisma, audit, refundService)
  const creditsService = new VirtualPayCreditsService(prisma)
  const messageService = new WechatMiniappMessageService(prisma, audit, redisLike as RedisService)

  @Module({
    controllers: [
      VirtualPayCreditRedeemController,
      VirtualPayCreditsController,
      VirtualPayAdminController,
      WechatMiniappMessageController,
    ],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: JwtService, useValue: jwt },
      { provide: RedisService, useValue: redisLike },
      { provide: TERMINAL_TOKEN_VALIDATOR, useValue: { async validateTerminalToken() {} } },
      { provide: TerminalSessionService, useValue: sessions },
      { provide: VirtualPayCreditRedeemService, useValue: redeemService },
      { provide: VirtualPayRefundService, useValue: refundService },
      { provide: VirtualPayAdminService, useValue: adminService },
      { provide: VirtualPayCreditsService, useValue: creditsService },
      { provide: WechatMiniappMessageService, useValue: messageService },
      TerminalIdentityGuard,
      EndUserAuthGuard,
      JwtAuthGuard,
      RolesGuard,
    ],
  })
  class VerifyP2Module {}

  const app = await NestFactory.create(VerifyP2Module, { logger: false, abortOnError: false, bodyParser: false })
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

    const issueMemberToken = async (endUserId: string) => {
      const jti = `jti-${randomBytes(8).toString('hex')}`
      await (redisLike as { setEx(k: string, ttl: number, v: string): Promise<void> }).setEx(
        memberSessionKey(jti),
        1800,
        endUserId,
      )
      return jwt.sign({ sub: endUserId, jti, aud: 'enduser' })
    }

    const issueTerminalHeaders = async (terminalId: string) => {
      const { bootTicket } = await sessions.createBootTicket(terminalId, 'Bearer test')
      const { sessionToken } = await sessions.exchangeBootTicket(bootTicket)
      return {
        'x-terminal-id': terminalId,
        'x-terminal-session-token': sessionToken,
      }
    }

    await assertVirtualPayRedeemFlow({
      prisma,
      audit,
      sessions,
      serviceOrders,
      registry,
      http: {
        async post(path, body, headers) {
          const res = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
          })
          const text = await res.text()
          return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
        },
        async get(path, headers) {
          const res = await fetch(`${baseUrl}${path}`, { headers })
          const text = await res.text()
          return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
        },
      },
      issueMemberToken,
      issueTerminalHeaders,
    })

    await prisma.organization.upsert({
      where: { id: 'org-vpay-p2-partner' },
      create: { id: 'org-vpay-p2-partner', name: 'P2合作机构', type: 'school', enabled: true },
      update: {},
    })
    await prisma.user.upsert({
      where: { id: 'vpay-p2-admin' },
      create: { id: 'vpay-p2-admin', username: 'u_vpay_p2_admin', passwordHash: 'x', name: 'P2Admin', role: 'admin', tokenVersion: 0 },
      update: {},
    })
    await prisma.user.upsert({
      where: { id: 'vpay-p2-partner' },
      create: {
        id: 'vpay-p2-partner',
        username: 'u_vpay_p2_partner',
        passwordHash: 'x',
        name: 'P2Partner',
        role: 'partner',
        orgId: 'org-vpay-p2-partner',
        tokenVersion: 0,
      },
      update: {},
    })
    const adminToken = jwt.sign({ sub: 'vpay-p2-admin', ver: 0 })
    const partnerToken = jwt.sign({ sub: 'vpay-p2-partner', ver: 0 })
    await assertVirtualPayRefundAndAdmin({
      prisma,
      refunds: refundService,
      reconcile: reconcileService,
      redeem: redeemService,
      baseUrl,
      adminHeaders: { Authorization: `Bearer ${adminToken}` },
      partnerHeaders: { Authorization: `Bearer ${partnerToken}` },
    })

    console.log(`=== ALL PASS verify-miniapp-virtual-pay-p2 (SQLite, port=${port}, redis=${realRedis ? 'real' : 'memory'}) ===`)
  } finally {
    await app.close()
    await prisma.onModuleDestroy()
    if (realRedis) await realRedis.onModuleDestroy()
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
