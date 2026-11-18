/**
 * 机构改成公共就业点位时，名下终端的收费设置在同一事务里复位。
 * 改回非公共不复活旧价。在途的保存带着旧绑定版本，得到 409。
 *
 * 默认临时 SQLite。--postgres 时 DATABASE_URL 必须是本机 PostgreSQL，库名含 p1d_charge_verify。
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['NODE_ENV'] = 'test'
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['PAYMENT_PROVIDER'] = 'sandbox'
process.env['SANDBOX_PAYMENT_SECRET'] = 'verify-terminal-charge-public-reset-sandbox-secret'

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ConflictException } from '@nestjs/common'
import { AuditService } from '../src/audit/audit.service'
import { getEffectiveUserPrices } from '../src/payment/effective-user-prices'
import {
  PERSONAL_CHARGE_SETTING_KEY,
  TERMINAL_CHARGE_SERVICE_KEYS,
} from '../src/payment/terminal-charge.contract'
import {
  TERMINAL_CHARGE_SETTINGS_STALE_CODE,
  saveTerminalChargeSettings,
} from '../src/payment/terminal-charge-settings'
import { TERMINAL_CHARGE_RESET_ON_PUBLIC_SITE_AUDIT_ACTION } from '../src/payment/terminal-charge-public-reset'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = resolve(__dirname, '..')
const ORG_ID = 'org-public-reset'
const OTHER_ORG_ID = 'org-public-reset-other'
const TERM_PRICED = 'term-public-reset-priced'
const TERM_EMPTY = 'term-public-reset-empty'
const TERM_OTHER = 'term-public-reset-other'
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

async function storedPrices(prisma: PrismaService, terminalId: string): Promise<Record<string, number | null>> {
  const rows = await prisma.terminalServicePrice.findMany({
    where: { terminalId },
    select: { serviceKey: true, unitCents: true },
  })
  const prices: Record<string, number | null> = {}
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
    const row = rows.find((item) => item.serviceKey === key)
    prices[key] = row === undefined ? null : row.unitCents
  }
  return prices
}

async function main(): Promise<void> {
  let dir: string | null = null
  if (postgres) {
    const url = process.env['DATABASE_URL'] ?? ''
    if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
      throw new Error('CHARGE_PUBLIC_RESET_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
    }
    if (!url.includes('p1d_charge_verify')) {
      throw new Error('CHARGE_PUBLIC_RESET_POSTGRES_REQUIRED: database name must contain p1d_charge_verify')
    }
  } else {
    dir = mkdtempSync(join(tmpdir(), 'terminal-charge-public-reset-'))
    const databasePath = join(dir, 'verify-terminal-charge-public-reset.db')
    process.env['DATABASE_URL'] = `file:${databasePath}`
    closeSync(openSync(databasePath, 'wx'))
  }
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  assertIsolatedVerificationDatabase()
  pushSchema(databaseUrl)

  const prisma = new PrismaService()
  if (postgres && prisma.dbKind !== 'postgres') throw new Error('CHARGE_PUBLIC_RESET_POSTGRES_REQUIRED')
  await prisma.onModuleInit()
  const orgs = new AdminOrgsService(prisma, new AuditService(prisma), {} as never)
  const adminRow = await prisma.user.create({
    data: { username: 'public-reset-admin', passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const admin = { userId: adminRow.id, role: 'admin' as const, orgId: null }
  try {
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: '改类型前的学校',
        type: 'school_employment_center',
        sceneTemplate: 'school',
        enabledModulesJson: JSON.stringify(['print_scan', 'resume_service']),
      },
    })
    await prisma.organization.create({ data: { id: OTHER_ORG_ID, name: '另一所学校', type: 'school' } })
    await prisma.terminal.create({
      data: {
        id: TERM_PRICED,
        terminalCode: 'PUB-PRICED',
        agentToken: 'agent-pub-priced',
        deviceFingerprint: 'fp-pub-priced',
        orgId: ORG_ID,
        userChargeMode: 'user_pays',
      },
    })
    await prisma.terminal.create({
      data: {
        id: TERM_EMPTY,
        terminalCode: 'PUB-EMPTY',
        agentToken: 'agent-pub-empty',
        deviceFingerprint: 'fp-pub-empty',
        orgId: ORG_ID,
        userChargeMode: 'org_pays',
      },
    })
    await prisma.terminal.create({
      data: {
        id: TERM_OTHER,
        terminalCode: 'PUB-OTHER',
        agentToken: 'agent-pub-other',
        deviceFingerprint: 'fp-pub-other',
        orgId: OTHER_ORG_ID,
        userChargeMode: 'user_pays',
      },
    })
    await prisma.terminalServicePrice.create({ data: { terminalId: TERM_PRICED, serviceKey: 'scan', unitCents: 500 } })
    await prisma.terminalServicePrice.create({ data: { terminalId: TERM_PRICED, serviceKey: 'print_bw_page', unitCents: 80 } })
    await prisma.terminalServicePrice.create({ data: { terminalId: TERM_OTHER, serviceKey: 'print_bw_page', unitCents: 80 } })
    // CI 里两条收费门禁接连用同一个 PostgreSQL 库，这个键可能已由前一条建好：有就改成开，没有就建。
    await prisma.platformSetting.upsert({
      where: { key: PERSONAL_CHARGE_SETTING_KEY },
      create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
      update: { value: 'true' },
    })

    const beforePriced = {
      userChargeMode: 'user_pays',
      personalChargeEnabled: true,
      prices: await storedPrices(prisma, TERM_PRICED),
    }
    const beforeEmpty = {
      userChargeMode: 'org_pays',
      personalChargeEnabled: true,
      prices: await storedPrices(prisma, TERM_EMPTY),
    }
    assert.equal(beforePriced.prices.resume_optimize, null, '没设过的价必须是空')
    assert.equal(beforePriced.prices.scan, 500)
    assert.equal(beforeEmpty.prices.scan, null)

    await orgs.updateOrg(ORG_ID, {
      type: 'public_employment_service',
      sceneTemplate: 'public_employment',
      enabledModules: ['print_scan'],
    }, admin)

    for (const terminalId of [TERM_PRICED, TERM_EMPTY]) {
      const row = await prisma.terminal.findUniqueOrThrow({
        where: { id: terminalId },
        select: { userChargeMode: true, orgBindingGeneration: true },
      })
      assert.equal(row.userChargeMode, 'org_pays', `${terminalId} 必须复位成机构承担`)
      assert.equal(row.orgBindingGeneration, 1, `${terminalId} 绑定版本必须加一`)
      const prices = await storedPrices(prisma, terminalId)
      for (const key of TERMINAL_CHARGE_SERVICE_KEYS) assert.equal(prices[key], null, `${terminalId} 的 ${key} 必须清空`)
    }
    const other = await prisma.terminal.findUniqueOrThrow({
      where: { id: TERM_OTHER },
      select: { userChargeMode: true, orgBindingGeneration: true },
    })
    assert.equal(other.userChargeMode, 'user_pays', '别的机构不能被清')
    assert.equal(other.orgBindingGeneration, 0)
    assert.equal((await storedPrices(prisma, TERM_OTHER)).print_bw_page, 80)

    for (const [code, expected] of [['PUB-PRICED', beforePriced], ['PUB-EMPTY', beforeEmpty]] as const) {
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: TERMINAL_CHARGE_RESET_ON_PUBLIC_SITE_AUDIT_ACTION, targetId: code },
      })
      const payload = JSON.parse(audit.payloadJson) as { before?: typeof expected }
      assert.deepEqual(payload.before, expected, `${code} 的复位审计要和改公共前的库一致`)
      assert.equal(/phone|mobile|姓名|realName|userName|displayName/.test(audit.payloadJson), false, '复位审计详情不带手机号或姓名')
    }
    console.log('PASS 改成公共就业点位后价目清空、审计有复位前快照、版本加一')

    const auditsAfterEnter = await prisma.auditLog.count({ where: { action: TERMINAL_CHARGE_RESET_ON_PUBLIC_SITE_AUDIT_ACTION } })
    await orgs.updateOrg(ORG_ID, {
      type: 'gig_worker_home',
      sceneTemplate: 'public_employment',
      enabledModules: ['print_scan'],
    }, admin)
    const stillPublic = await prisma.terminal.findUniqueOrThrow({ where: { id: TERM_PRICED }, select: { orgBindingGeneration: true } })
    assert.equal(stillPublic.orgBindingGeneration, 1, '公共类型之间改，版本不加')
    assert.equal(
      await prisma.auditLog.count({ where: { action: TERMINAL_CHARGE_RESET_ON_PUBLIC_SITE_AUDIT_ACTION } }),
      auditsAfterEnter,
      '公共类型之间改，不再记复位审计',
    )
    console.log('PASS 公共就业类型之间切换不再复位')

    await orgs.updateOrg(ORG_ID, {
      type: 'school_employment_center',
      sceneTemplate: 'school',
      enabledModules: ['print_scan', 'resume_service'],
    }, admin)
    const returned = await prisma.terminal.findUniqueOrThrow({
      where: { id: TERM_PRICED },
      select: { userChargeMode: true, orgBindingGeneration: true },
    })
    assert.equal(returned.userChargeMode, 'org_pays', '改回非公共不能把谁付钱复活')
    assert.equal(returned.orgBindingGeneration, 1, '改回非公共不加版本')
    const returnedPrices = await storedPrices(prisma, TERM_PRICED)
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) assert.equal(returnedPrices[key], null, `改回后 ${key} 仍是空`)
    const effective = await getEffectiveUserPrices(prisma, TERM_PRICED)
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      assert.equal(effective.prices[key].effectiveCents, 0, `改回后 ${key} 生效价仍是 0`)
    }
    console.log('PASS 改回非公共后旧价不复活，生效价仍全是 0')

    await prisma.terminal.update({ where: { id: TERM_PRICED }, data: { userChargeMode: 'user_pays' } })
    await prisma.terminalServicePrice.create({ data: { terminalId: TERM_PRICED, serviceKey: 'scan', unitCents: 700 } })
    const generationBeforeRace = (await prisma.terminal.findUniqueOrThrow({
      where: { id: TERM_PRICED },
      select: { orgBindingGeneration: true },
    })).orgBindingGeneration
    let armed = true
    const wrapped = Object.create(prisma) as PrismaService
    wrapped.$transaction = ((...args: unknown[]) => {
      const run = async () => {
        if (armed) {
          armed = false
          await orgs.updateOrg(ORG_ID, {
            type: 'public_employment_service',
            sceneTemplate: 'public_employment',
            enabledModules: ['print_scan'],
          }, admin)
        }
        return prisma.$transaction(...(args as [never]))
      }
      return run()
    }) as PrismaService['$transaction']
    const prices = Object.fromEntries(TERMINAL_CHARGE_SERVICE_KEYS.map((key) => [key, key === 'scan' ? 700 : 0]))
    let rejected: unknown
    try {
      await saveTerminalChargeSettings(wrapped, TERM_PRICED, {
        userChargeMode: 'user_pays',
        prices,
        orgBindingGeneration: generationBeforeRace,
      }, admin.userId)
    } catch (error) {
      rejected = error
    }
    assert.equal(staleCode(rejected), TERMINAL_CHARGE_SETTINGS_STALE_CODE, `在途保存必须是绑定版本过期：${rejected instanceof Error ? rejected.message : String(rejected)}`)
    const raced = await prisma.terminal.findUniqueOrThrow({
      where: { id: TERM_PRICED },
      select: { userChargeMode: true, orgBindingGeneration: true },
    })
    assert.equal(raced.userChargeMode, 'org_pays')
    assert.equal(raced.orgBindingGeneration, generationBeforeRace + 1)
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) assert.equal((await storedPrices(prisma, TERM_PRICED))[key], null)
    const racedEmpty = await prisma.terminal.findUniqueOrThrow({ where: { id: TERM_EMPTY }, select: { orgBindingGeneration: true } })
    assert.equal(racedEmpty.orgBindingGeneration, generationBeforeRace + 1, '同一机构的另一台也要加版本')
    console.log(`PASS verify:terminal-charge-public-reset${postgres ? ':postgres' : ''}`)
  } finally {
    await prisma.onModuleDestroy()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
