/**
 * 小程序虚拟支付发货推送：PostgreSQL 上 20 个并发同一推送只能记一条权益。
 * DATABASE_URL 必须是本机 PostgreSQL，库名含 verify。不打真微信。
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['NODE_ENV'] = 'test'
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['JWT_SECRET'] = 'verify-miniapp-vpay-jwt-secret'
process.env['SECRET_ENCRYPTION_KEY'] = 'verify-miniapp-vpay-pepper-key-0123456789'

import 'reflect-metadata'
import { execFileSync } from 'node:child_process'
import { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AuditService } from '../src/audit/audit.service'
import { installBodyParsers } from '../src/config/body-parsers'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { assertConcurrentReconcileFailureCount } from './support/miniapp-virtual-pay-concurrent-reconcile'
import { assertConcurrentDelivery } from './support/miniapp-virtual-pay-delivery'

const API_ROOT = resolve(__dirname, '..')

function pushSchema(url: string): void {
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', url, '--accept-data-loss',
    '--config', 'prisma.postgres.config.ts',
    '--schema', 'prisma/postgres/schema.prisma',
  ], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url, POSTGRES_URL: url },
    stdio: 'inherit',
  })
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  if (!databaseUrl.startsWith('postgres')) {
    throw new Error('VPAY_POSTGRES_URL_REQUIRED')
  }
  assertIsolatedVerificationDatabase()
  pushSchema(databaseUrl)
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const { WechatMiniappMessageController } = await import('../src/virtual-pay/wechat-miniapp-message.controller')
  const { WechatMiniappMessageService } = await import('../src/virtual-pay/wechat-miniapp-message.service')
  const messages = new WechatMiniappMessageService(prisma, audit)

  @Module({
    controllers: [WechatMiniappMessageController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: WechatMiniappMessageService, useValue: messages },
    ],
  })
  class FixtureModule {}
  Module({})(FixtureModule)

  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false, bodyParser: false })
  installBodyParsers(app)
  app.setGlobalPrefix('api/v1')
  try {
    await app.listen(0, '127.0.0.1')
    const port = (app.getHttpServer().address() as AddressInfo).port
    await assertConcurrentDelivery({ prisma, base: `http://127.0.0.1:${port}` })
    const store = new Map<string, string>()
    const redis = {
      async get(key: string) { return store.get(key) ?? null },
      async setEx(key: string, _ttl: number, value: string) { store.set(key, value) },
      async setIfAbsent(key: string, value: string) {
        if (store.has(key)) return false
        store.set(key, value)
        return true
      },
      async del(key: string) { return store.delete(key) ? 1 : 0 },
    }
    await assertConcurrentReconcileFailureCount({ prisma, redis })
  } finally {
    await app.close()
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
