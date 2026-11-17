/**
 * 一体机首页「免费使用」按机器开关。
 * 临时 SQLite，真实 Nest HTTP：管理员改开关、审计 previous/next、机构与未登录、
 * 非布尔 400、终端不存在 404、一体机配置带上该字段且 configVersion 跟着变。
 *
 * 密钥必须写在任何 import 之前。swc 会把 import 提前，终端模块一加载就要这两个变量。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-home-free-badge-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-home-free-badge-terminal-action-secret-0123456789'
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
import { PrismaService } from '../src/prisma/prisma.service'
import { TERMINAL_HOME_FREE_BADGE_AUDIT_ACTION, TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = resolve(__dirname, '..')
const ADMIN = 'user-home-free-admin'
const PARTNER = 'user-home-free-partner'
const ORG = 'org-home-free'
const TERMINAL_ID = 'term-home-free-01'
const TERMINAL_CODE = 'HF-01'
const ACTION = 'terminal.home_free_badge.update'

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
  json: { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string }; [key: string]: unknown }
}

async function main(): Promise<void> {
  assert.equal(TERMINAL_HOME_FREE_BADGE_AUDIT_ACTION, ACTION)
  const dir = mkdtempSync(join(tmpdir(), 'terminal-home-free-badge-'))
  const databasePath = join(dir, 'verify-terminal-home-free-badge.db')
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
  // 终端模块在加载时读取密钥。上面的 process.env 若被编译器提前到 import 之后，这里再动态加载一次才安全。
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const { TerminalAdminService } = await import('../src/terminals/terminals-admin.service')
  const { TerminalsService } = await import('../src/terminals/terminals.service')
  const { TerminalsController } = await import('../src/terminals/terminals.controller')
  const { AdminTerminalsController } = await import('../src/terminals/admin-terminals.controller')
  const { ReleaseObservationService } = await import('../src/terminals/release-observation.service')
  const agent = new TerminalAgentService(prisma, audit)
  const releases = { toAdminObservation: () => null } as unknown as InstanceType<typeof ReleaseObservationService>
  const adminTerminals = new TerminalAdminService(prisma, agent, toolbox, releases)
  const terminals = new TerminalsService(agent, adminTerminals)
  const sessions = new TerminalSessionService(redis as never, prisma, { async validateTerminalToken() {} })
  const jwt = new JwtService({ secret: 'verify-terminal-home-free-badge-jwt-secret' })

  @Module({
    controllers: [AdminTerminalsController, TerminalsController],
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

    await prisma.organization.create({ data: { id: ORG, name: '首页免费开关验证机构', type: 'public_service' } })
    await prisma.user.create({ data: { id: ADMIN, username: 'home-free-admin', passwordHash: 'not-used', name: '管理员', role: 'admin' } })
    await prisma.user.create({ data: { id: PARTNER, username: 'home-free-partner', passwordHash: 'not-used', name: '机构', role: 'partner', orgId: ORG } })
    await prisma.terminal.create({
      data: {
        id: TERMINAL_ID,
        terminalCode: TERMINAL_CODE,
        agentToken: 'agent-home-free-01',
        deviceFingerprint: 'fp-home-free-01',
      },
    })
    const created = await prisma.terminal.findUnique({ where: { id: TERMINAL_ID }, select: { homeFreeBadge: true } })
    assert.equal(created?.homeFreeBadge, true, '库默认值必须是 true')

    const sessionToken = 'sess-home-free-01'
    store.set(`term:session:${sessionToken}`, JSON.stringify({
      terminalId: TERMINAL_ID,
      generation: 0,
      issuedAt: new Date().toISOString(),
    }))
    const kioskHeaders = {
      'x-terminal-id': TERMINAL_ID,
      'x-terminal-session-token': sessionToken,
    }

    const listed = await call('GET', '/api/v1/admin/terminals', undefined, adminHeaders)
    expectStatus(listed, 200, '管理员列表')
    const terminalsBody = listed.json.data as { terminals?: Array<{ id: string; homeFreeBadge?: boolean }> } | undefined
    const listedRow = terminalsBody?.terminals?.find((row) => row.id === TERMINAL_ID)
    assert.equal(listedRow?.homeFreeBadge, true, '管理员详情数据源必须带上默认开')

    const configOn = await call('GET', `/api/v1/terminals/${TERMINAL_ID}/config`, undefined, kioskHeaders)
    expectStatus(configOn, 200, '一体机配置')
    assert.equal(configOn.json.homeFreeBadge, true)
    const versionOn = configOn.json.configVersion
    assert.equal(typeof versionOn, 'string')
    assert.equal(String(versionOn).includes('home-free-badge:on'), true, String(versionOn))

    const turnedOff = await call('PUT', `/api/v1/admin/terminals/${TERMINAL_ID}/home-free-badge`, { enabled: false }, adminHeaders)
    expectStatus(turnedOff, 200, '改成关')
    assert.equal((turnedOff.json.data as { enabled?: boolean } | undefined)?.enabled, false)
    const turnedOn = await call('PUT', `/api/v1/admin/terminals/${TERMINAL_ID}/home-free-badge`, { enabled: true }, adminHeaders)
    expectStatus(turnedOn, 200, '改回开')
    assert.equal((turnedOn.json.data as { enabled?: boolean } | undefined)?.enabled, true)

    const audits = await prisma.auditLog.findMany({
      where: { action: ACTION, targetId: TERMINAL_CODE },
      orderBy: { createdAt: 'asc' },
    })
    assert.equal(audits.length, 2, `审计应有两行，实际 ${audits.length}`)
    const payloads = audits.map((row) => JSON.parse(row.payloadJson) as { previous?: boolean; next?: boolean; terminalCode?: string })
    assert.deepEqual(payloads[0], { terminalCode: TERMINAL_CODE, previous: true, next: false })
    assert.deepEqual(payloads[1], { terminalCode: TERMINAL_CODE, previous: false, next: true })
    console.log('PASS 管理员改关再改开，审计 previous/next 各一行')

    const partner = await call('PUT', `/api/v1/admin/terminals/${TERMINAL_ID}/home-free-badge`, { enabled: false }, partnerHeaders)
    expectStatus(partner, 403, '机构账号')
    assert.equal(partner.json.error?.code, 'AUTH_ROLE_FORBIDDEN')
    const anonymous = await call('PUT', `/api/v1/admin/terminals/${TERMINAL_ID}/home-free-badge`, { enabled: false })
    expectStatus(anonymous, 401, '未登录')
    assert.equal(anonymous.json.error?.code, 'AUTH_MISSING_TOKEN')
    console.log('PASS 机构 403、未登录 401')

    for (const body of [{ enabled: 'yes' }, { enabled: 1 }, { enabled: null }, {}]) {
      const rejected = await call('PUT', `/api/v1/admin/terminals/${TERMINAL_ID}/home-free-badge`, body, adminHeaders)
      expectStatus(rejected, 400, `非布尔 ${JSON.stringify(body)}`)
      assert.equal(rejected.json.error?.code, 'VALIDATION_FAILED')
    }
    const missing = await call('PUT', '/api/v1/admin/terminals/missing-terminal/home-free-badge', { enabled: false }, adminHeaders)
    expectStatus(missing, 404, '终端不存在')
    assert.equal(missing.json.error?.code, 'TERMINAL_NOT_FOUND')
    const auditsAfterRejects = await prisma.auditLog.count({ where: { action: ACTION } })
    assert.equal(auditsAfterRejects, 2, '拒绝的请求不能多写审计')
    console.log('PASS 非布尔 400、终端不存在 404')

    const configOff = await call('PUT', `/api/v1/admin/terminals/${TERMINAL_ID}/home-free-badge`, { enabled: false }, adminHeaders)
    expectStatus(configOff, 200, '再次改关以便核对配置版本')
    const configAfter = await call('GET', `/api/v1/terminals/${TERMINAL_ID}/config`, undefined, kioskHeaders)
    expectStatus(configAfter, 200, '改开关后的一体机配置')
    assert.equal(configAfter.json.homeFreeBadge, false)
    const versionOff = String(configAfter.json.configVersion)
    assert.equal(versionOff.includes('home-free-badge:off'), true, versionOff)
    assert.notEqual(versionOff, versionOn, '开关变化后 configVersion 必须变化')
    const listedOff = await call('GET', '/api/v1/admin/terminals', undefined, adminHeaders)
    const listedOffRow = (listedOff.json.data as { terminals?: Array<{ id: string; homeFreeBadge?: boolean }> } | undefined)?.terminals?.find((row) => row.id === TERMINAL_ID)
    assert.equal(listedOffRow?.homeFreeBadge, false)
    console.log('PASS 一体机配置带上开关，configVersion 含 home-free-badge 且随开关变化')
  } finally {
    await app.close()
    await prisma.onModuleDestroy()
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
