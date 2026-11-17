/**
 * 保存收费设置和改绑撞在同一时刻。核对必须在写价的同一个事务里。
 *
 * 保存一进入事务，就先在另一条已提交的事务里把机构改走（版本加一、价目清空），
 * 再记一张改绑之后才出现的待付单，然后才跑原来的保存。
 * 核对在事务里：版本已经是 1，按读取时的 0 保存得到 409，价目不动，这张新单仍是待付。
 * 核对在事务外、写入又不带版本条件：外面读到的还是 0，随后改绑，事务把旧价写进去，并关掉这张新单。
 *
 * 默认临时 SQLite。--postgres 时 DATABASE_URL 必须是本机 PostgreSQL，库名含 p1d_charge_verify。
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['NODE_ENV'] = 'test'
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['PAYMENT_PROVIDER'] = 'sandbox'
process.env['SANDBOX_PAYMENT_SECRET'] = 'verify-terminal-charge-binding-race-sandbox-secret'

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ConflictException } from '@nestjs/common'
import { PERSONAL_CHARGE_SETTING_KEY, TERMINAL_CHARGE_SERVICE_KEYS } from '../src/payment/terminal-charge.contract'
import {
  TERMINAL_CHARGE_SETTINGS_STALE_CODE,
  TERMINAL_CHARGE_SETTINGS_STALE_MESSAGE,
  saveTerminalChargeSettings,
} from '../src/payment/terminal-charge-settings'
import { PrismaService } from '../src/prisma/prisma.service'
import { assignTerminalOrganization } from '../src/terminals/terminal-org-assignment'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = resolve(__dirname, '..')
const ORG_ID = 'org-race-school'
const TERMINAL_ID = 'term-race'
const KEEP_ORDER_ID = 'race-keep'
const postgres = process.argv.includes('--postgres')

function pushSchema(url: string): void {
  const args = [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', url, '--accept-data-loss',
  ]
  if (postgres) args.push('--config', 'prisma.postgres.config.ts', '--schema', 'prisma/postgres/schema.prisma')
  execFileSync(process.execPath, args, {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url, POSTGRES_URL: url },
    stdio: 'inherit',
  })
}

function staleCode(error: unknown): string | undefined {
  if (!(error instanceof ConflictException)) return undefined
  const body = error.getResponse() as { error?: { code?: string } }
  return body.error?.code
}

async function main(): Promise<void> {
  let dir: string | null = null
  if (postgres) {
    const url = process.env['DATABASE_URL'] ?? ''
    if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
      throw new Error('CHARGE_BINDING_RACE_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
    }
    if (!url.includes('p1d_charge_verify')) {
      throw new Error('CHARGE_BINDING_RACE_POSTGRES_REQUIRED: database name must contain p1d_charge_verify')
    }
  } else {
    dir = mkdtempSync(join(tmpdir(), 'terminal-charge-binding-race-'))
    const databasePath = join(dir, 'verify-terminal-charge-binding-race.db')
    process.env['DATABASE_URL'] = `file:${databasePath}`
    closeSync(openSync(databasePath, 'wx'))
  }
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  assertIsolatedVerificationDatabase()
  pushSchema(databaseUrl)

  const prisma = new PrismaService()
  if (postgres && prisma.dbKind !== 'postgres') throw new Error('CHARGE_BINDING_RACE_POSTGRES_REQUIRED')
  await prisma.onModuleInit()
  try {
    await prisma.organization.create({ data: { id: ORG_ID, name: '竞态学校', type: 'school' } })
    await prisma.terminal.create({
      data: {
        id: TERMINAL_ID,
        terminalCode: 'RACE-1',
        agentToken: 'agent-race',
        deviceFingerprint: 'fp-race',
        userChargeMode: 'user_pays',
      },
    })
    await prisma.terminalServicePrice.create({
      data: { terminalId: TERMINAL_ID, serviceKey: 'resume_optimize', unitCents: 100 },
    })
    await prisma.platformSetting.create({ data: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' } })

    let armed = true
    const wrapped = Object.create(prisma) as PrismaService
    wrapped.$transaction = ((...args: unknown[]) => {
      const run = async () => {
        if (armed) {
          armed = false
          await assignTerminalOrganization(prisma, TERMINAL_ID, ORG_ID, new Date(), async () => undefined)
          await prisma.serviceOrder.create({
            data: {
              id: KEEP_ORDER_ID,
              terminalId: TERMINAL_ID,
              serviceKey: 'resume_optimize',
              amountCents: 100,
              kioskSessionId: 'race-session',
              provider: 'sandbox',
              providerOrderNo: 'race-keep-no',
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          })
        }
        return prisma.$transaction(...(args as [never]))
      }
      return run()
    }) as PrismaService['$transaction']

    const prices = Object.fromEntries(TERMINAL_CHARGE_SERVICE_KEYS.map((key) => [key, key === 'resume_optimize' ? 100 : 0]))
    let rejected: unknown
    try {
      await saveTerminalChargeSettings(wrapped, TERMINAL_ID, {
        userChargeMode: 'user_pays',
        prices,
        orgBindingGeneration: 0,
      }, 'race-admin')
    } catch (error) {
      rejected = error
    }
    assert.equal(staleCode(rejected), TERMINAL_CHARGE_SETTINGS_STALE_CODE, `必须是绑定版本过期：${rejected instanceof Error ? rejected.message : String(rejected)}`)
    assert.equal(
      rejected instanceof ConflictException
        ? (rejected.getResponse() as { error?: { message?: string } }).error?.message
        : undefined,
      TERMINAL_CHARGE_SETTINGS_STALE_MESSAGE,
    )
    const terminal = await prisma.terminal.findUnique({
      where: { id: TERMINAL_ID },
      select: { userChargeMode: true, orgId: true, orgBindingGeneration: true, servicePrices: { select: { unitCents: true } } },
    })
    assert.equal(terminal?.orgId, ORG_ID)
    assert.equal(terminal?.orgBindingGeneration, 1, '改绑已经加上版本')
    assert.equal(terminal?.userChargeMode, 'org_pays', '旧价不能写进新机构')
    assert.equal(terminal?.servicePrices.length, 0, '旧价目不能写进去')
    const order = await prisma.serviceOrder.findUnique({ where: { id: KEEP_ORDER_ID } })
    assert.equal(order?.status, 'pending', '409 不能关掉改绑之后的待付单')
    assert.equal(order?.closeReason ?? null, null)
    assert.equal(order?.amountCents, 100)
    assert.equal(order?.channelClosePending, false)
    console.log(`PASS verify:terminal-charge-binding-race${postgres ? ':postgres' : ''}`)
  } finally {
    await prisma.onModuleDestroy()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
