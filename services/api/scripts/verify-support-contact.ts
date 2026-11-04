/**
 * 公开只读 GET /api/v1/public/support-contact 与管理员配置。
 * 临时 SQLite，不写共享 dev.db。时钟可注入，缓存断言不等待 5 分钟。
 * 夹具号码只出现在本文件。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BadRequestException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { SupportContactAdminController } from '../src/support-contact/support-contact.admin.controller'
import { TERMINAL_ONLINE_WINDOW_MS } from '../src/support-contact/support-contact.online'
import { SupportContactPublicController } from '../src/support-contact/support-contact.public.controller'
import {
  DEFAULT_SERVICE_HOURS,
  SUPPORT_CONTACT_CACHE_TTL_MS,
  SupportContactService,
  setSupportContactClock,
  supportContactCacheSize,
  type PublicSupportContact,
} from '../src/support-contact/support-contact.service'

const API_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(API_ROOT, '../..')
const MOBILE = '13800138000'
const LANDLINE = '0532-87654321'
const SELF_ID = 'term-shinan-self'
const SELF_CODE = 'QD-SN-01'
const SIBLING_ID = 'term-shinan-other'
const SIBLING_CODE = 'QD-SN-02'
const FAR_ID = 'term-jimo-01'
const FAR_CODE = 'JM-RC-01'
const BARE_ID = 'term-bare-01'
const BARE_CODE = 'QD-BARE-01'
const HIDDEN = [SIBLING_CODE, SIBLING_ID, FAR_CODE, FAR_ID, BARE_CODE, BARE_ID, SELF_CODE, SELF_ID]

function flatten(errors: ValidationError[]): string[] {
  const out: string[] = []
  for (const error of errors) {
    if (error.constraints) out.push(...Object.values(error.constraints))
    if (error.children?.length) out.push(...flatten(error.children))
  }
  return out
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function assertStatic(): void {
  const service = read(join(API_ROOT, 'src/support-contact/support-contact.service.ts'))
  const online = read(join(API_ROOT, 'src/support-contact/support-contact.online.ts'))
  const controller = read(join(API_ROOT, 'src/support-contact/support-contact.public.controller.ts'))
  const card = read(join(REPO_ROOT, 'apps/admin/src/routes/legal-docs/SupportContactCard.tsx'))
  const schema = read(join(API_ROOT, 'prisma/schema.prisma'))
  const progress = read(join(REPO_ROOT, 'docs/progress/current-progress.md'))
  const block = schema.slice(schema.indexOf('model PlatformSetting {'), schema.indexOf('model PlatformSetting {') + 500)
  assert.equal(DEFAULT_SERVICE_HOURS, '工作日 9:00–18:00')
  assert.ok(service.includes(DEFAULT_SERVICE_HOURS))
  assert.ok(card.includes(DEFAULT_SERVICE_HOURS))
  assert.ok(online.includes('TERMINAL_ONLINE_WINDOW_MS'))
  assert.ok(online.includes('328'))
  assert.ok(controller.includes('@TerminalScopedThrottle(30)'))
  assert.ok(block.startsWith('model PlatformSetting {'))
  assert.equal(block.includes('endUserId'), false)
  assert.ok(progress.includes('第 328 行'))
  assert.ok(SUPPORT_CONTACT_CACHE_TTL_MS <= 5 * 60 * 1000)
  for (const file of [service, online, controller, card, schema, progress]) {
    assert.equal(file.includes(MOBILE), false)
    assert.equal(file.includes(LANDLINE), false)
  }
  console.log('PASS 静态契约：默认服务时间、在线口径、节流、模型无会员字段')
}

function pushSchema(url: string): void {
  execFileSync(
    process.execPath,
    [
      join(API_ROOT, 'node_modules/prisma/build/index.js'),
      'db',
      'push',
      '--url',
      url,
      '--accept-data-loss',
    ],
    { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' },
  )
}

async function main(): Promise<void> {
  assertStatic()
  process.env['ADMIN_IP_ALLOWLIST'] = ''
  const dir = mkdtempSync(join(tmpdir(), 'support-contact-'))
  const databasePath = join(dir, 'support.db')
  closeSync(openSync(databasePath, 'a'))
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  const origin = Date.parse('2026-10-04T01:00:00.000Z')
  let now = origin
  setSupportContactClock(() => now)

  @Module({
    imports: [JwtModule.register({ secret: 'support-contact-verify-secret', signOptions: { expiresIn: '2h' } })],
    controllers: [SupportContactPublicController, SupportContactAdminController],
    providers: [
      SupportContactService,
      AuditService,
      JwtAuthGuard,
      RolesGuard,
      PrismaService,
      { provide: RedisService, useValue: { async setJsonIfVersionNotOlder() { return 'ok' } } },
    ],
  })
  class FixtureModule {}

  pushSchema(databaseUrl)
  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false })
  try {
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = flatten(errors)
        return new BadRequestException({
          error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details },
        })
      },
    }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const port = (app.getHttpServer().address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`
    const prisma = app.get(PrismaService)
    const jwt = app.get(JwtService)
    const adminToken = () => jwt.sign({ sub: 'user-zhou', ver: 0 })
    const partnerToken = () => jwt.sign({ sub: 'user-lin', ver: 0 })

    await prisma.organization.create({ data: { id: 'org-shinan', name: '青岛市南区公共就业服务中心', type: 'public_service' } })
    await prisma.organization.create({ data: { id: 'org-jimo', name: '即墨区人才服务中心', type: 'public_service' } })
    await prisma.user.create({ data: { id: 'user-zhou', username: 'zhou-qiming', passwordHash: 'not-used', name: '周启明', role: 'admin' } })
    await prisma.user.create({ data: { id: 'user-lin', username: 'lin-xiaozhou', passwordHash: 'not-used', name: '林晓舟', role: 'partner', orgId: 'org-shinan' } })
    await createTerminal(prisma, { id: SELF_ID, terminalCode: SELF_CODE, orgId: 'org-shinan' })
    await createTerminal(prisma, { id: SIBLING_ID, terminalCode: SIBLING_CODE, orgId: 'org-shinan' })
    await createTerminal(prisma, { id: FAR_ID, terminalCode: FAR_CODE, orgId: 'org-jimo', lastHeartbeatAt: new Date(origin + 86_400_000) })
    await createTerminal(prisma, { id: BARE_ID, terminalCode: BARE_CODE, orgId: null })

    async function call(method: string, path: string, body?: unknown, token?: string) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = await response.json() as { success?: boolean; data?: PublicSupportContact; error?: { code?: string } }
      return { status: response.status, json }
    }

    async function publicOf(terminalId?: string): Promise<PublicSupportContact> {
      const path = terminalId === undefined
        ? '/api/v1/public/support-contact'
        : `/api/v1/public/support-contact?terminalId=${encodeURIComponent(terminalId)}`
      const res = await call('GET', path)
      assert.equal(res.status, 200, path)
      assert.equal(res.json.success, true)
      const data = res.json.data!
      assert.deepEqual(Object.keys(data).sort(), ['miniappPublished', 'otherOnlineTerminalNearby', 'serviceHours', 'servicePhone'])
      const text = JSON.stringify(data)
      for (const hidden of HIDDEN) assert.equal(text.includes(hidden), false, hidden)
      return data
    }

    async function auditCount(): Promise<number> {
      return prisma.auditLog.count({ where: { action: 'support_contact.update' } })
    }

    const unconfigured = await publicOf(SELF_CODE)
    assert.equal(unconfigured.servicePhone, null)
    assert.notEqual(unconfigured.servicePhone, '')
    assert.equal(unconfigured.serviceHours, DEFAULT_SERVICE_HOURS)
    assert.equal(unconfigured.miniappPublished, false)
    assert.equal(unconfigured.otherOnlineTerminalNearby, false)
    const adminBefore = await call('GET', '/api/v1/admin/support-contact', undefined, adminToken())
    assert.equal(adminBefore.status, 200)
    assert.equal(adminBefore.json.data?.serviceHours, null)
    console.log('PASS 没配时电话为 null、服务时间为默认、小程序未发布、附近为 false')

    const auditsBefore = await auditCount()
    const saved = await call('PUT', '/api/v1/admin/support-contact', {
      servicePhone: `  ${MOBILE}  `,
      serviceHours: ' 工作日 8:30–17:30 ',
      miniappPublished: true,
    }, adminToken())
    assert.equal(saved.status, 200)
    assert.equal(saved.json.data?.servicePhone, MOBILE)
    assert.equal(saved.json.data?.serviceHours, '工作日 8:30–17:30')
    assert.equal(saved.json.data?.miniappPublished, true)
    assert.equal(await auditCount(), auditsBefore + 1)
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'support_contact.update' }, orderBy: { createdAt: 'desc' } })
    const payload = JSON.parse(audit.payloadJson) as { before: { servicePhone: string | null }; after: { servicePhone: string | null } }
    assert.equal(audit.actorId, 'user-zhou')
    assert.equal(audit.targetType, 'system')
    assert.equal(audit.targetId, 'support-contact')
    assert.equal(payload.before.servicePhone, null)
    assert.equal(payload.after.servicePhone, MOBILE)
    assert.equal(JSON.stringify(payload).includes(SIBLING_CODE), false)
    console.log('PASS 配了返回配置值，管理员修改写入审计')

    now = origin + 60_000
    await prisma.terminal.update({ where: { id: SIBLING_ID }, data: { lastHeartbeatAt: new Date(now - 30_000) } })
    const cached = await publicOf(SELF_CODE)
    assert.equal(cached.servicePhone, null)
    assert.equal(cached.serviceHours, DEFAULT_SERVICE_HOURS)
    assert.equal(cached.miniappPublished, false)
    assert.equal(cached.otherOnlineTerminalNearby, false)
    now = origin + SUPPORT_CONTACT_CACHE_TTL_MS
    const expired = await publicOf(SELF_CODE)
    assert.equal(expired.servicePhone, MOBILE)
    assert.equal(expired.serviceHours, '工作日 8:30–17:30')
    assert.equal(expired.miniappPublished, true)
    assert.equal(expired.otherOnlineTerminalNearby, true)
    console.log('PASS 缓存期内仍是旧值，过期后是新值')

    async function advance(setup: () => Promise<void>, terminalId?: string): Promise<PublicSupportContact> {
      now += SUPPORT_CONTACT_CACHE_TTL_MS + 1
      await setup()
      return publicOf(terminalId)
    }

    async function shape(input: {
      columnOffset: number | null
      rowOffset: number | null
      lifecycleStatus?: string
      enabled?: boolean
    }): Promise<void> {
      await prisma.terminal.update({
        where: { id: SIBLING_ID },
        data: {
          orgId: 'org-shinan',
          lifecycleStatus: input.lifecycleStatus ?? 'active',
          enabled: input.enabled ?? true,
          lastHeartbeatAt: input.columnOffset === null ? null : new Date(now + input.columnOffset),
        },
      })
      await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: SIBLING_ID } })
      if (input.rowOffset !== null) {
        await prisma.terminalHeartbeat.create({
          data: { id: 'hb-sibling', terminalId: SIBLING_ID, createdAt: new Date(now + input.rowOffset) },
        })
      }
    }

    const byId = await advance(async () => {
      await prisma.terminal.update({ where: { id: SIBLING_ID }, data: { lastHeartbeatAt: new Date(now - 30_000) } })
    }, SELF_ID)
    assert.equal(byId.otherOnlineTerminalNearby, true)
    assert.equal(byId.servicePhone, MOBILE)
    console.log('PASS 内部 id 与终端号都能读')

    assert.equal((await advance(() => shape({ columnOffset: -(TERMINAL_ONLINE_WINDOW_MS + 1000), rowOffset: null }), SELF_CODE)).otherOnlineTerminalNearby, false)
    console.log('PASS 同机构心跳过期 → false')

    assert.equal((await advance(() => shape({ columnOffset: -30_000, rowOffset: null, lifecycleStatus: 'retired' }), SELF_CODE)).otherOnlineTerminalNearby, false)
    assert.equal((await advance(() => shape({ columnOffset: -30_000, rowOffset: null, lifecycleStatus: 'planned' }), SELF_CODE)).otherOnlineTerminalNearby, false)
    assert.equal((await advance(() => shape({ columnOffset: -30_000, rowOffset: null, enabled: false }), SELF_CODE)).otherOnlineTerminalNearby, false)
    console.log('PASS 同机构已退役、计划中、停用 → false')

    assert.equal((await advance(() => shape({ columnOffset: -(TERMINAL_ONLINE_WINDOW_MS + 5_000), rowOffset: null }), SELF_CODE)).otherOnlineTerminalNearby, false)
    console.log('PASS 别的机构有在线终端、本机构没有 → false')

    assert.equal((await advance(() => shape({ columnOffset: null, rowOffset: -30_000 }), SELF_CODE)).otherOnlineTerminalNearby, true)
    assert.equal((await advance(() => shape({ columnOffset: -(TERMINAL_ONLINE_WINDOW_MS + 5_000), rowOffset: -20_000 }), SELF_CODE)).otherOnlineTerminalNearby, true)
    assert.equal((await advance(() => shape({ columnOffset: -30_000, rowOffset: -(TERMINAL_ONLINE_WINDOW_MS + 5_000) }), SELF_CODE)).otherOnlineTerminalNearby, true)
    assert.equal((await advance(() => shape({ columnOffset: -TERMINAL_ONLINE_WINDOW_MS, rowOffset: null }), SELF_CODE)).otherOnlineTerminalNearby, false)
    assert.equal((await advance(() => shape({ columnOffset: -(TERMINAL_ONLINE_WINDOW_MS - 1), rowOffset: null }), SELF_CODE)).otherOnlineTerminalNearby, true)
    console.log('PASS 心跳列与心跳行取较新者，窗口边界严格小于')

    // 只算正常运营（active）的机器：维护中、已暂停、调试中即使有心跳也不能让用户去那台。
    for (const status of ['maintenance', 'suspended', 'commissioning']) {
      assert.equal((await advance(() => shape({ columnOffset: -30_000, rowOffset: null, lifecycleStatus: status }), SELF_CODE)).otherOnlineTerminalNearby, false, status)
    }
    console.log('PASS 同机构维护中 / 已暂停 / 调试中即使有心跳 → false')

    assert.equal((await advance(async () => {
      await shape({ columnOffset: -30_000, rowOffset: null })
      await prisma.terminal.update({ where: { id: SELF_ID }, data: { lifecycleStatus: 'retired' } })
    }, SELF_CODE)).otherOnlineTerminalNearby, false)
    await prisma.terminal.update({ where: { id: SELF_ID }, data: { lifecycleStatus: 'active' } })
    assert.equal((await advance(async () => {}, BARE_CODE)).otherOnlineTerminalNearby, false)
    assert.equal((await advance(async () => {}, undefined)).otherOnlineTerminalNearby, false)
    assert.equal((await advance(async () => {}, 'NO-SUCH-TERMINAL')).otherOnlineTerminalNearby, false)
    assert.equal((await advance(async () => {}, 'x'.repeat(129))).otherOnlineTerminalNearby, false)
    // 公开接口不登录：换着终端号刷，缓存条数也不能无限涨；超长的号不进缓存。
    const contactService = app.get(SupportContactService)
    for (let i = 0; i < 620; i += 1) await contactService.getPublic(`probe-${i}`)
    assert.ok(supportContactCacheSize() <= 500, `缓存条数应有上限，实际 ${supportContactCacheSize()}`)
    const sizeBefore = supportContactCacheSize()
    await contactService.getPublic('y'.repeat(300))
    assert.ok(supportContactCacheSize() <= sizeBefore, '超长终端号不得进缓存')
    console.log('PASS 公开接口缓存有上限，超长终端号不缓存')
    console.log('PASS 本机退役、本机没绑机构、不带参数、终端号不存在 → false')

    const beforeClear = await auditCount()
    const cleared = await call('PUT', '/api/v1/admin/support-contact', {
      servicePhone: '',
      serviceHours: '   ',
      miniappPublished: false,
    }, adminToken())
    assert.equal(cleared.status, 200)
    assert.equal(cleared.json.data?.servicePhone, null)
    assert.equal(cleared.json.data?.serviceHours, null)
    assert.equal(cleared.json.data?.miniappPublished, false)
    assert.equal(await auditCount(), beforeClear + 1)
    const afterClear = await advance(async () => {}, SELF_CODE)
    assert.equal(afterClear.servicePhone, null)
    assert.equal(afterClear.serviceHours, DEFAULT_SERVICE_HOURS)
    assert.equal(afterClear.miniappPublished, false)
    console.log('PASS 清空后电话回到 null，公开服务时间回到默认')

    const beforePartial = await call('PUT', '/api/v1/admin/support-contact', { servicePhone: LANDLINE }, adminToken())
    assert.equal(beforePartial.status, 200)
    assert.equal(beforePartial.json.data?.servicePhone, LANDLINE)
    const partial = await call('PUT', '/api/v1/admin/support-contact', { miniappPublished: true }, adminToken())
    assert.equal(partial.status, 200)
    assert.equal(partial.json.data?.servicePhone, LANDLINE)
    assert.equal(partial.json.data?.miniappPublished, true)
    console.log('PASS 省略的字段保持不变，固话可以保存')

    const beforeInvalid = await auditCount()
    const invalid = await call('PUT', '/api/v1/admin/support-contact', { servicePhone: '12345' }, adminToken())
    assert.equal(invalid.status, 400)
    assert.equal(invalid.json.error?.code, 'VALIDATION_FAILED')
    const tooLong = await call('PUT', '/api/v1/admin/support-contact', { serviceHours: '班'.repeat(41) }, adminToken())
    assert.equal(tooLong.status, 400)
    const extra = await call('PUT', '/api/v1/admin/support-contact', { servicePhone: LANDLINE, extra: true }, adminToken())
    assert.equal(extra.status, 400)
    const still = await call('GET', '/api/v1/admin/support-contact', undefined, adminToken())
    assert.equal(still.json.data?.servicePhone, LANDLINE)
    assert.equal(await auditCount(), beforeInvalid)
    console.log('PASS 号码格式非法、服务时间过长、多余字段 → 400，且不写审计')

    const beforePartner = await auditCount()
    const partnerPut = await call('PUT', '/api/v1/admin/support-contact', { miniappPublished: false }, partnerToken())
    assert.equal(partnerPut.status, 403)
    assert.equal(partnerPut.json.error?.code, 'AUTH_ROLE_FORBIDDEN')
    const partnerGet = await call('GET', '/api/v1/admin/support-contact', undefined, partnerToken())
    assert.equal(partnerGet.status, 403)
    assert.equal(await auditCount(), beforePartner)
    const publicAudits = await auditCount()
    await advance(async () => {}, SELF_CODE)
    assert.equal(await auditCount(), publicAudits)
    console.log('PASS 非管理员 403，公开读取不写审计')
  } finally {
    setSupportContactClock(null)
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
  console.log('verify:support-contact PASS')
}

async function createTerminal(
  prisma: PrismaService,
  input: { id: string; terminalCode: string; orgId: string | null; lastHeartbeatAt?: Date },
): Promise<void> {
  await prisma.terminal.create({
    data: {
      id: input.id,
      terminalCode: input.terminalCode,
      agentToken: `token-${input.id}`,
      deviceFingerprint: `fp-${input.id}`,
      orgId: input.orgId,
      orgBoundAt: input.orgId ? new Date('2026-10-01T00:00:00.000Z') : null,
      lifecycleStatus: 'active',
      enabled: true,
      lastHeartbeatAt: input.lastHeartbeatAt ?? null,
    },
  })
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
