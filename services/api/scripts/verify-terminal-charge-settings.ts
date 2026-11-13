/**
 * 每台机器谁付钱、五个服务的配置价，以及真正向用户收的生效价。
 * 临时 SQLite，真实 Nest HTTP。
 *
 * 为什么这样断言：公共就业点位永远不向求职者收费，不靠开关；
 * 总开关没有行必须算关，否则预先配好的价会在默认环境里开始收钱；
 * 打印报价只认本机生效价，全站 PriceConfig 改成 100 也不能把本机 0 元收成 100。
 *
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-terminal-charge-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-terminal-charge-terminal-action-secret-0123456789'
process.env['ADMIN_IP_ALLOWLIST'] = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['NODE_ENV'] = 'test'

import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BadRequestException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { quoteCopy } from '../src/payment/copy-pricing'
import { PricingService } from '../src/payment/pricing.service'
import {
  PERSONAL_CHARGE_DISABLE_AUDIT_ACTION,
  PERSONAL_CHARGE_ENABLE_AUDIT_ACTION,
  TERMINAL_CHARGE_SETTINGS_AUDIT_ACTION,
} from '../src/payment/terminal-charge-settings'
import { PrismaService } from '../src/prisma/prisma.service'
import { PartnerStatsService } from '../src/orgs/partner-stats.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import {
  PERSONAL_CHARGE_SETTING_KEY as SHARED_PERSONAL_CHARGE_SETTING_KEY,
  PUBLIC_EMPLOYMENT_ORG_TYPES,
  TERMINAL_CHARGE_MAX_UNIT_CENTS as SHARED_TERMINAL_CHARGE_MAX_UNIT_CENTS,
  TERMINAL_CHARGE_SERVICE_KEYS as SHARED_TERMINAL_CHARGE_SERVICE_KEYS,
} from '@ai-job-print/shared'
import { ORG_TYPE_MATRIX } from '../src/orgs/admin-orgs.service'
import {
  PERSONAL_CHARGE_SETTING_KEY,
  TERMINAL_CHARGE_MAX_UNIT_CENTS,
  TERMINAL_CHARGE_SERVICE_KEYS,
  isPublicEmploymentOrgType,
  type TerminalChargeServiceKey,
} from '../src/payment/terminal-charge.contract'

const API_ROOT = resolve(__dirname, '..')
const ADMIN = 'user-charge-admin'
const PARTNER = 'user-charge-partner'
const ORG_PUBLIC = 'org-charge-public'
const ORG_SCHOOL = 'org-charge-school'
const ORG_OTHER = 'org-charge-other'
const PUBLIC_TERMINAL = 'term-charge-public'
const SELF_TERMINAL = 'term-charge-self'
const SCHOOL_TERMINAL = 'term-charge-school'
const OTHER_TERMINAL = 'term-charge-other'

const ZERO_PRICES = {
  resume_optimize: 0,
  mock_interview: 0,
  print_bw_page: 0,
  print_color_page: 0,
  scan: 0,
}

const SAMPLE_PRICES = {
  resume_optimize: 100,
  mock_interview: 200,
  print_bw_page: 100,
  print_color_page: 300,
  scan: 100,
}

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
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', url, '--accept-data-loss',
  ], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' })
}

interface CallResult {
  status: number
  json: {
    success?: boolean
    data?: Record<string, unknown>
    error?: { code?: string; message?: string }
    [key: string]: unknown
  }
}

interface EffectiveBody {
  userChargeMode?: string
  personalChargeEnabled?: boolean
  isPublicSite?: boolean
  prices?: Record<string, { configuredCents?: number; effectiveCents?: number; reason?: string }>
}

function pricesOf(body: EffectiveBody | undefined, field: 'effectiveCents' | 'configuredCents'): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) out[key] = body?.prices?.[key]?.[field] ?? -1
  return out
}

async function main(): Promise<void> {
  assert.deepEqual([...TERMINAL_CHARGE_SERVICE_KEYS], [...SHARED_TERMINAL_CHARGE_SERVICE_KEYS])
  assert.equal(PERSONAL_CHARGE_SETTING_KEY, SHARED_PERSONAL_CHARGE_SETTING_KEY)
  assert.equal(TERMINAL_CHARGE_MAX_UNIT_CENTS, SHARED_TERMINAL_CHARGE_MAX_UNIT_CENTS)
  const fromMatrix = Object.keys(ORG_TYPE_MATRIX)
    .filter((key) => ORG_TYPE_MATRIX[key]?.sceneTemplate === 'public_employment')
    .sort()
  assert.deepEqual(fromMatrix, [...PUBLIC_EMPLOYMENT_ORG_TYPES].sort())
  for (const type of PUBLIC_EMPLOYMENT_ORG_TYPES) assert.equal(isPublicEmploymentOrgType(type), true)
  assert.equal(isPublicEmploymentOrgType('school_employment_center'), false)
  assert.equal(isPublicEmploymentOrgType('public_service'), false)
  assert.equal(isPublicEmploymentOrgType(null), false)
  assert.equal(TERMINAL_CHARGE_SETTINGS_AUDIT_ACTION, 'terminal.charge_settings.update')
  assert.equal(PERSONAL_CHARGE_ENABLE_AUDIT_ACTION, 'billing.personal_charge.enable')
  assert.equal(PERSONAL_CHARGE_DISABLE_AUDIT_ACTION, 'billing.personal_charge.disable')

  const dir = mkdtempSync(join(tmpdir(), 'terminal-charge-settings-'))
  const databasePath = join(dir, 'verify-terminal-charge-settings.db')
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  closeSync(openSync(databasePath, 'wx'))
  pushSchema(databaseUrl)

  const store = new Map<string, string>()
  const redis = {
    async get(key: string) { return store.get(key) ?? null },
    async setEx(key: string, _ttl: number, value: string) { store.set(key, value) },
    async getDel(key: string) {
      const value = store.get(key) ?? null
      store.delete(key)
      return value
    },
    async setJsonIfVersionNotOlder() { return 'ok' as const },
  }
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const capabilities = new TerminalCapabilitiesService(prisma)
  const toolbox = new TerminalToolboxService(prisma)
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const { TerminalAdminService } = await import('../src/terminals/terminals-admin.service')
  const { TerminalsService } = await import('../src/terminals/terminals.service')
  const { TerminalsController } = await import('../src/terminals/terminals.controller')
  const { AdminTerminalsController } = await import('../src/terminals/admin-terminals.controller')
  const { AdminBillingController } = await import('../src/payment/admin-billing.controller')
  const { AdminBillingService } = await import('../src/payment/admin-billing.service')
  const { ReleaseObservationService } = await import('../src/terminals/release-observation.service')
  const { PartnerStatsController } = await import('../src/orgs/partner-stats.controller')
  const agent = new TerminalAgentService(prisma, audit)
  const releases = { toAdminObservation: () => null } as unknown as InstanceType<typeof ReleaseObservationService>
  const adminTerminals = new TerminalAdminService(prisma, agent, toolbox, releases)
  const terminals = new TerminalsService(agent, adminTerminals)
  const sessions = new TerminalSessionService(redis as never, prisma, { async validateTerminalToken() {} })
  const billing = new AdminBillingService(prisma, audit)
  const partnerStats = new PartnerStatsService(prisma)
  const jwt = new JwtService({ secret: 'verify-terminal-charge-jwt-secret' })

  @Module({
    controllers: [AdminTerminalsController, TerminalsController, AdminBillingController, PartnerStatsController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      { provide: JwtService, useValue: jwt },
      { provide: AuditService, useValue: audit },
      { provide: TerminalCapabilitiesService, useValue: capabilities },
      { provide: TerminalsService, useValue: terminals },
      { provide: TerminalToolboxService, useValue: toolbox },
      { provide: ReleaseObservationService, useValue: releases },
      { provide: TerminalSessionService, useValue: sessions },
      { provide: TERMINAL_TOKEN_VALIDATOR, useValue: { async validateTerminalToken() {} } },
      { provide: AdminBillingService, useValue: billing },
      { provide: PartnerStatsService, useValue: partnerStats },
      {
        provide: (await import('../src/payment/reconciliation.service')).ReconciliationService,
        useValue: { report: async () => ({}) },
      },
      TerminalIdentityGuard,
      JwtAuthGuard,
      RolesGuard,
    ],
  })
  class FixtureModule {}
  Module({})(FixtureModule)

  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false })
  try {
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = flatten(errors)
        return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details } })
      },
    }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const port = (app.getHttpServer().address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`
    const adminToken = jwt.sign({ sub: ADMIN, ver: 0 })
    const partnerToken = jwt.sign({ sub: PARTNER, ver: 0 })
    const adminHeaders = { authorization: `Bearer ${adminToken}` }
    const partnerHeaders = { authorization: `Bearer ${partnerToken}` }

    async function call(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<CallResult> {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = await response.json() as CallResult['json']
      return { status: response.status, json }
    }

    function expectStatus(result: CallResult, status: number, label: string): void {
      assert.equal(result.status, status, `${label} → ${result.status} ${JSON.stringify(result.json)}`)
    }

    await prisma.organization.create({ data: { id: ORG_PUBLIC, name: '市南区公共就业服务中心', type: 'public_employment_service' } })
    await prisma.organization.create({ data: { id: ORG_SCHOOL, name: '青岛大学', type: 'school' } })
    await prisma.organization.create({ data: { id: ORG_OTHER, name: '其他机构', type: 'school' } })
    await prisma.user.create({ data: { id: ADMIN, username: 'charge-admin', passwordHash: 'not-used', name: '管理员', role: 'admin' } })
    await prisma.user.create({
      data: { id: PARTNER, username: 'charge-partner', passwordHash: 'not-used', name: '机构', role: 'partner', orgId: ORG_SCHOOL },
    })
    const terminalRows = [
      { id: PUBLIC_TERMINAL, terminalCode: 'CHG-PUBLIC', orgId: ORG_PUBLIC, deviceFingerprint: 'fp-public' },
      { id: SELF_TERMINAL, terminalCode: 'CHG-SELF', orgId: null, deviceFingerprint: 'fp-self' },
      { id: SCHOOL_TERMINAL, terminalCode: 'CHG-SCHOOL', orgId: ORG_SCHOOL, deviceFingerprint: 'fp-school' },
      { id: OTHER_TERMINAL, terminalCode: 'CHG-OTHER', orgId: ORG_OTHER, deviceFingerprint: 'fp-other' },
    ]
    for (const row of terminalRows) {
      await prisma.terminal.create({
        data: {
          id: row.id,
          terminalCode: row.terminalCode,
          agentToken: `agent-${row.id}`,
          deviceFingerprint: row.deviceFingerprint,
          orgId: row.orgId,
        },
      })
    }

    const fresh = await call('GET', `/api/v1/admin/terminals/${SELF_TERMINAL}/charge-settings`, undefined, adminHeaders)
    expectStatus(fresh, 200, '默认读设置')
    const freshData = fresh.json.data as EffectiveBody
    assert.equal(freshData.personalChargeEnabled, false)
    assert.equal(freshData.isPublicSite, false)
    assert.equal(freshData.userChargeMode, 'org_pays')
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      assert.equal(freshData.prices?.[key]?.effectiveCents, 0, key)
    }
    console.log('PASS 新终端默认五个生效价全是 0')

    // 预先配好向用户收费，但总开关这一行不存在。没有行必须算关，否则默认环境就会收钱。
    await prisma.terminal.update({ where: { id: SELF_TERMINAL }, data: { userChargeMode: 'user_pays' } })
    await prisma.terminalServicePrice.create({
      data: { terminalId: SELF_TERMINAL, serviceKey: 'print_bw_page', unitCents: 100 },
    })
    const preset = await call('GET', `/api/v1/admin/terminals/${SELF_TERMINAL}/charge-settings`, undefined, adminHeaders)
    const presetData = preset.json.data as EffectiveBody
    assert.equal(presetData.personalChargeEnabled, false, '默认环境全部 0')
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      assert.equal(presetData.prices?.[key]?.effectiveCents, 0, `默认环境全部 0：${key}`)
      assert.equal(presetData.prices?.[key]?.reason, 'personal_charge_off', key)
    }
    assert.equal(presetData.prices?.print_bw_page?.configuredCents, 100)
    console.log('PASS 默认环境全部 0（没有总开关行，预先配的价也不生效）')

    await prisma.terminal.update({ where: { id: SELF_TERMINAL }, data: { userChargeMode: 'org_pays' } })
    await prisma.terminalServicePrice.deleteMany({ where: { terminalId: SELF_TERMINAL } })

    const savedWhileOff = await call('PUT', `/api/v1/admin/terminals/${SELF_TERMINAL}/charge-settings`, {
      userChargeMode: 'user_pays',
      prices: SAMPLE_PRICES,
    }, adminHeaders)
    expectStatus(savedWhileOff, 200, '总开关关着仍可预先保存')
    const savedOffData = savedWhileOff.json.data as EffectiveBody
    assert.deepEqual(pricesOf(savedOffData, 'configuredCents'), SAMPLE_PRICES)
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      assert.equal(savedOffData.prices?.[key]?.effectiveCents, 0, `开关关时 user_pays 也是 0：${key}`)
      assert.equal(savedOffData.prices?.[key]?.reason, 'personal_charge_off')
    }
    console.log('PASS 开关关时 user_pays 也是 0，配置价照实保存')

    const chargeAudit = await prisma.auditLog.findFirst({
      where: { action: TERMINAL_CHARGE_SETTINGS_AUDIT_ACTION, targetId: 'CHG-SELF' },
      orderBy: { createdAt: 'desc' },
    })
    const chargePayload = JSON.parse(chargeAudit?.payloadJson ?? '{}') as {
      previous?: { userChargeMode?: string }
      next?: { userChargeMode?: string; prices?: Record<string, number> }
    }
    assert.equal(chargePayload.previous?.userChargeMode, 'org_pays')
    assert.equal(chargePayload.next?.userChargeMode, 'user_pays')
    assert.equal(chargePayload.next?.prices?.print_bw_page, 100)
    console.log('PASS 修改终端收费设置记了改前改后')

    const publicSave = await call('PUT', `/api/v1/admin/terminals/${PUBLIC_TERMINAL}/charge-settings`, {
      userChargeMode: 'user_pays',
      prices: SAMPLE_PRICES,
    }, adminHeaders)
    expectStatus(publicSave, 409, '公共点位写收费')
    assert.equal(publicSave.json.error?.code, 'PUBLIC_SITE_ALWAYS_FREE', '公共点位保存必须 409 PUBLIC_SITE_ALWAYS_FREE')
    const publicRow = await prisma.terminal.findUnique({ where: { id: PUBLIC_TERMINAL }, select: { userChargeMode: true } })
    const publicPriceCount = await prisma.terminalServicePrice.count({ where: { terminalId: PUBLIC_TERMINAL } })
    assert.equal(publicRow?.userChargeMode, 'org_pays')
    assert.equal(publicPriceCount, 0, '409 不能写库')
    console.log('PASS 公共点位保存 user_pays 或大于 0 返回 409，不写库')

    await prisma.terminal.update({ where: { id: PUBLIC_TERMINAL }, data: { userChargeMode: 'user_pays' } })
    await prisma.terminalServicePrice.create({
      data: { terminalId: PUBLIC_TERMINAL, serviceKey: 'scan', unitCents: 500 },
    })
    await prisma.platformSetting.create({ data: { key: 'charge.personalCharge.enabled', value: 'true' } })
    const publicEffective = await call('GET', `/api/v1/admin/terminals/${PUBLIC_TERMINAL}/charge-settings`, undefined, adminHeaders)
    const publicData = publicEffective.json.data as EffectiveBody
    assert.equal(publicData.isPublicSite, true)
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      assert.equal(publicData.prices?.[key]?.effectiveCents, 0, `公共点位开关开 + user_pays + 价大于 0 仍为 0：${key}`)
      assert.equal(publicData.prices?.[key]?.reason, 'public_site')
    }
    console.log('PASS 公共点位开关开 + user_pays + 价大于 0 仍为 0')
    await prisma.platformSetting.delete({ where: { key: 'charge.personalCharge.enabled' } })
    await prisma.terminal.update({ where: { id: PUBLIC_TERMINAL }, data: { userChargeMode: 'org_pays' } })
    await prisma.terminalServicePrice.deleteMany({ where: { terminalId: PUBLIC_TERMINAL } })

    const openBare = await call('PUT', '/api/v1/admin/billing/personal-charge', { enabled: true }, adminHeaders)
    expectStatus(openBare, 400, '打开不带确认')
    assert.equal(openBare.json.error?.code, 'PERSONAL_CHARGE_CONFIRM_REQUIRED', '打开总开关必须 confirm')
    const auditsAfterBare = await prisma.auditLog.count({
      where: { action: { in: [PERSONAL_CHARGE_ENABLE_AUDIT_ACTION, PERSONAL_CHARGE_DISABLE_AUDIT_ACTION] } },
    })
    assert.equal(auditsAfterBare, 0, '没确认不能记打开审计')
    console.log('PASS 打开总开关不带 confirm 返回 400')

    const overviewBefore = await call('GET', '/api/v1/admin/billing/personal-charge', undefined, adminHeaders)
    expectStatus(overviewBefore, 200, '总开关清单')
    assert.equal(overviewBefore.json.enabled, false)
    const warning = (overviewBefore.json.terminals as Array<{ terminalCode?: string; prices?: Record<string, number> }> | undefined) ?? []
    assert.equal(warning.some((row) => row.terminalCode === 'CHG-SELF'), true, '预先配好的自营机应出现在打开后会收费的清单')
    assert.equal(warning.some((row) => row.terminalCode === 'CHG-PUBLIC'), false)
    const selfWarning = warning.find((row) => row.terminalCode === 'CHG-SELF')
    assert.equal(selfWarning?.prices?.print_bw_page, 100)

    const opened = await call('PUT', '/api/v1/admin/billing/personal-charge', { enabled: true, confirm: true }, adminHeaders)
    expectStatus(opened, 200, '确认后打开')
    assert.equal(opened.json.enabled, true)
    const closed = await call('PUT', '/api/v1/admin/billing/personal-charge', { enabled: false }, adminHeaders)
    expectStatus(closed, 200, '关闭')
    assert.equal(closed.json.enabled, false)
    const switchAudits = await prisma.auditLog.findMany({
      where: { action: { in: [PERSONAL_CHARGE_ENABLE_AUDIT_ACTION, PERSONAL_CHARGE_DISABLE_AUDIT_ACTION] } },
      orderBy: { createdAt: 'asc' },
    })
    assert.deepEqual(switchAudits.map((row) => row.action), [
      PERSONAL_CHARGE_ENABLE_AUDIT_ACTION,
      PERSONAL_CHARGE_DISABLE_AUDIT_ACTION,
    ], '开关都记审计')
    console.log('PASS 总开关打开要 confirm，开和关都记审计')

    await call('PUT', '/api/v1/admin/billing/personal-charge', { enabled: true, confirm: true }, adminHeaders)
    const charging = await call('GET', `/api/v1/admin/terminals/${SELF_TERMINAL}/charge-settings`, undefined, adminHeaders)
    const chargingData = charging.json.data as EffectiveBody
    assert.equal(chargingData.personalChargeEnabled, true)
    assert.deepEqual(pricesOf(chargingData, 'effectiveCents'), SAMPLE_PRICES, '开关开、自营、user_pays 时等于配置价')
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      assert.equal(chargingData.prices?.[key]?.reason, 'user_pays')
    }
    console.log('PASS 开关开、自营、user_pays 时等于配置价')

    await prisma.priceConfig.create({
      data: {
        serviceKey: 'print_bw_page',
        unitCents: 100,
        unit: 'page',
        active: true,
        description: '全站参考价',
      },
    })
    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: SELF_TERMINAL, serviceKey: 'print_bw_page' } },
      data: { unitCents: 0 },
    })
    const pricing = new PricingService(prisma)
    const siteQuote = await pricing.quotePrint({
      billablePages: 1,
      billingPageSource: 'pdf_lightweight_scan',
      copies: 1,
      colorMode: 'black_white',
      terminalId: SELF_TERMINAL,
    })
    assert.equal(siteQuote.amountCents, 0, '全站价改成 100、本机 0 时报价仍为 0')
    const noTerminalQuote = await pricing.quotePrint({
      billablePages: 2,
      billingPageSource: 'pdf_lightweight_scan',
      copies: 1,
      colorMode: 'black_white',
    })
    assert.equal(noTerminalQuote.amountCents, 0, '不带终端一律 0，到机补价由 P2 做')
    console.log('PASS 全站价改成 100、本机 0 时报价仍为 0')

    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: SELF_TERMINAL, serviceKey: 'print_bw_page' } },
      data: { unitCents: 100 },
    })
    await prisma.terminalServicePrice.upsert({
      where: { terminalId_serviceKey: { terminalId: SELF_TERMINAL, serviceKey: 'print_color_page' } },
      create: { terminalId: SELF_TERMINAL, serviceKey: 'print_color_page', unitCents: 300 },
      update: { unitCents: 300 },
    })
    const colorCopy = await quoteCopy({
      pageCount: 2, copies: 3, colorMode: 'color', duplex: 'simplex', terminalId: SELF_TERMINAL,
    }, prisma)
    const bwCopy = await quoteCopy({
      pageCount: 2, copies: 1, colorMode: 'black_white', duplex: 'simplex', terminalId: SELF_TERMINAL,
    }, prisma)
    assert.equal(colorCopy.quotable && colorCopy.quote.unitCents, 300, '复印跟随本机彩色打印价')
    assert.equal(colorCopy.quotable && colorCopy.quote.amountCents, 1800)
    assert.equal(bwCopy.quotable && bwCopy.quote.unitCents, 100, '复印跟随本机黑白打印价')
    const colorPrint = await pricing.quotePrint({
      billablePages: 2, billingPageSource: 'pdf_lightweight_scan', copies: 3, colorMode: 'color', terminalId: SELF_TERMINAL,
    })
    assert.equal(colorPrint.amountCents, colorCopy.quotable ? colorCopy.quote.amountCents : -1)
    console.log('PASS 复印跟随本机同色打印价')

    const partnerView = await partnerStats.getTerminalOperations(ORG_SCHOOL as never, 'week')
    assert.deepEqual(partnerView.terminals.map((row) => row.terminalCode), ['CHG-SCHOOL'])
    assert.equal(partnerView.terminals[0]?.charge.userChargeMode, 'org_pays')
    assert.equal(partnerView.terminals[0]?.charge.isPublicSite, false)
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      assert.equal(partnerView.terminals[0]?.charge.effective[key], 0)
    }
    const partnerHttp = await call('GET', '/api/v1/partner/terminal-operations?period=week', undefined, partnerHeaders)
    expectStatus(partnerHttp, 200, '机构终端列表')
    const partnerCodes = ((partnerHttp.json.terminals as Array<{ terminalCode?: string }> | undefined) ?? []).map((row) => row.terminalCode)
    assert.deepEqual(partnerCodes, ['CHG-SCHOOL'], '机构接口只回本机构终端')
    console.log('PASS 机构接口只回本机构终端')

    const sessionToken = 'sess-charge-self'
    store.set(`term:session:${sessionToken}`, JSON.stringify({
      terminalId: SELF_TERMINAL,
      generation: 0,
      issuedAt: new Date().toISOString(),
    }))
    const kiosk = await call('GET', `/api/v1/terminals/${SELF_TERMINAL}/config`, undefined, {
      'x-terminal-id': SELF_TERMINAL,
      'x-terminal-session-token': sessionToken,
    })
    expectStatus(kiosk, 200, '一体机配置')
    const kioskPricing = kiosk.json.pricing as { effective?: Record<TerminalChargeServiceKey, number>; personalChargeEnabled?: boolean } | undefined
    assert.equal(kioskPricing?.personalChargeEnabled, true)
    assert.equal(kioskPricing?.effective?.print_bw_page, 100)
    assert.equal(kioskPricing?.effective?.print_color_page, 300)
    assert.equal(String(kiosk.json.configVersion).includes('pricing:'), true)
    console.log('PASS 一体机配置带上本机 pricing')

    const partnerWrite = await call('PUT', `/api/v1/admin/terminals/${SCHOOL_TERMINAL}/charge-settings`, {
      userChargeMode: 'org_pays',
      prices: ZERO_PRICES,
    }, partnerHeaders)
    expectStatus(partnerWrite, 403, '机构不能改收费设置')
  } finally {
    await app.close()
    await prisma.onModuleDestroy()
    rmSync(dir, { recursive: true, force: true })
  }
  console.log('PASS verify:terminal-charge-settings')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
