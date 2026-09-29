/**
 * verify:internal-accounts —— 3.9 内部账号名册 + 备用管理员 + 服务器端应急启用（2026-09-29）
 *
 * 按规格写的断言（不是照现状写的）：
 *   [A] 名册只给白名单字段：序列化整页响应后，passwordHash / phoneHash / phoneEnc / emailHash / emailEnc /
 *       tokenVersion 的字段名和**真实值**都不得出现；已删除账号不出现；筛选（角色/启停/机构/关键字/手机号）
 *       与分页按规格生效；非管理员 403、未登录 401、参数越界 400。
 *   [B] 启停只管管理员：密码错 422、临时密码的操作人 403、目标是合作机构 / 一体机账号 422、停自己 409、
 *       不存在 404、状态未变 409；两个管理员同时互相停用（屏障保证两边都已过前置检查）只能成功一个，
 *       系统里至少剩一个可用管理员；启停后 tokenVersion+1、旧登录凭证立即失效；审计带事由与来源。
 *   [C] 建备用管理员：本人密码 → 备用手机号验证码 → 同一事务建号（停用、手机号已验证、临时密码、
 *       isBackupAdmin=true）；验证码错保留凭证、过期作废凭证；凭证不能被别的管理员用、不能重放；
 *       手机号被占 409；已有备用管理员 409；两人并发建号只成一个；数据库条件唯一索引（来自真实迁移）挡第二个。
 *   [D] 服务器端应急命令：非生产 / 非 PostgreSQL / 确认短语不对 / 缺事由 一律拒；只认备用管理员
 *       （库里只有普通停用管理员时拒绝且不改它）；确认码篡改 / 过期拒绝；启用后同一码作废；审计 system-cli。
 *   [E] 启用后首次登录：停用时找回密码不发码；启用后走短信找回密码 → owner_managed →
 *       开着 P1-4 短信第二步照样能登录，且新登录凭证能访问名册。
 *   [F] 本门禁写入的所有审计：payload 里没有完整手机号、密文、哈希或密码。
 *
 * 数据库：每次用真实 SQLite 迁移（prisma migrate deploy）建一个临时库，含本次的条件唯一索引；
 * Redis：真实 Redis（REDIS_URL）；HTTP：进程内 Nest（本模块 + 真实 JwtAuthGuard / RolesGuard / ValidationPipe /
 * HttpExceptionFilter / RequestIdMiddleware）。短信验证码从 Redis 取（log 通道），不连外网。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const apiRoot = path.resolve(__dirname, '..')
const dbName = `verify-internal-accounts-${randomUUID().slice(0, 8)}.db`
const dbPath = path.join(apiRoot, 'prisma', dbName)
process.env['DATABASE_URL'] = `file:./prisma/${dbName}`
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
assertIsolatedVerificationDatabase()
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-internal-accounts-secret-key-0123456789abcdef'
if (!process.env['JWT_SECRET'] || process.env['JWT_SECRET'].length < 16) process.env['JWT_SECRET'] = 'verify-internal-accounts-jwt-secret'
process.env['SMS_PROVIDER'] = 'log'
process.env['SMS_INTERNAL_DAILY_LIMIT'] = '100000'
delete process.env['ADMIN_IP_ALLOWLIST']
process.env['ADMIN_LOGIN_SECOND_FACTOR'] = 'off'
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'
process.env['REDIS_URL'] = REDIS_URL

let checks = 0
let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) {
    console.log(`  ✅ ${name}`)
    return
  }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

function cleanupDb(): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${dbPath}${suffix}`, { force: true })
}

function migrateFreshDb(): void {
  cleanupDb()
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: apiRoot,
    stdio: 'pipe',
    env: { ...process.env },
  })
}

type HttpResult = { status: number; body: Record<string, unknown> & { error?: { code?: string } } }

async function main(): Promise<void> {
  console.log('\n=== verify:internal-accounts ===')
  migrateFreshDb()

  const { NestFactory } = await import('@nestjs/core')
  const { BadRequestException, Module, ValidationPipe } = await import('@nestjs/common')
  const { JwtService } = await import('@nestjs/jwt')
  const bcrypt = await import('bcryptjs')
  const { default: Redis } = await import('ioredis')
  const { PrismaModule } = await import('../src/prisma/prisma.module')
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { RedisModule } = await import('../src/common/redis/redis.module')
  const { RedisService } = await import('../src/common/redis/redis.service')
  const { PartnerAccountActionRedisService } = await import('../src/common/redis/partner-account-action-redis.service')
  const { AuditModule } = await import('../src/audit/audit.module')
  const { AuditService } = await import('../src/audit/audit.service')
  const { AuthService } = await import('../src/auth/auth.service')
  const { HttpExceptionFilter } = await import('../src/common/filters/http-exception.filter')
  const { RequestIdMiddleware } = await import('../src/common/middleware/request-id.middleware')
  const { AdminInternalAccountsModule } = await import('../src/admin-internal-accounts/admin-internal-accounts.module')
  const { AdminInternalAccountsService } = await import('../src/admin-internal-accounts/admin-internal-accounts.service')
  const { encryptPhone, hashPhone } = await import('../src/common/crypto/phone-identity')
  const emergency = await import('../src/admin-internal-accounts/backup-admin-emergency-enable')

  @Module({ imports: [RedisModule, PrismaModule, AuditModule, AdminInternalAccountsModule] })
  class VerifyRootModule {}

  const app = await NestFactory.create(VerifyRootModule, { logger: false })
  const requestId = new RequestIdMiddleware()
  app.use(requestId.use.bind(requestId))
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address() as { port: number }
  const base = `http://127.0.0.1:${address.port}/api/v1`

  const prisma = app.get(PrismaService)
  const redisService = app.get(RedisService)
  const actionRedis = app.get(PartnerAccountActionRedisService)
  const audit = app.get(AuditService)
  const auth = app.get(AuthService)
  const jwt = app.get(JwtService)
  const rawRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 })

  const suffix = randomBytes(4).toString('hex')
  const secret = process.env['SECRET_ENCRYPTION_KEY']!
  const phoneOf = (n: number) => `13${String(100000000 + Math.floor(Math.random() * 800000000) + n).slice(0, 9)}`
  const phones = {
    partner: phoneOf(1), backup: phoneOf(2), backupB: phoneOf(3), deleted: phoneOf(4), emailOwner: phoneOf(5),
  }
  const password = (label: string) => `Verify-${label}-${suffix}-Aa1!`
  const pw = { a: password('a'), b: password('b'), t: password('t'), l: password('l'), p: password('p') }
  const hash = async (value: string) => bcrypt.hash(value, 4)

  const org = await prisma.organization.create({ data: { id: `va-org-${suffix}`, name: `核验机构-${suffix}`, type: 'school' } })
  const mk = async (data: Record<string, unknown>) => prisma.user.create({ data: data as never })
  const adminA = await mk({ username: `va-admin-a-${suffix}`, name: '管理员甲', role: 'admin', passwordHash: await hash(pw.a), passwordProofState: 'owner_managed' })
  const adminB = await mk({ username: `va-admin-b-${suffix}`, name: '管理员乙', role: 'admin', passwordHash: await hash(pw.b), passwordProofState: 'owner_managed' })
  const adminT = await mk({ username: `va-admin-t-${suffix}`, name: '临时管理员', role: 'admin', passwordHash: await hash(pw.t), passwordProofState: 'temporary' })
  const adminL = await mk({ username: `va-admin-l-${suffix}`, name: '锁定管理员', role: 'admin', passwordHash: await hash(pw.l), passwordProofState: 'legacy' })
  const partner = await mk({
    username: `va-partner-${suffix}`, name: '机构账号', role: 'partner', orgId: org.id, passwordHash: await hash(pw.p),
    passwordProofState: 'owner_managed', phoneHash: hashPhone(phones.partner), phoneEnc: encryptPhone(phones.partner),
    phoneVerifiedAt: new Date(), emailHash: `emailhash-${suffix}`, emailEnc: `emailenc-${suffix}`, emailVerifiedAt: new Date(),
  })
  const kiosk = await mk({ username: `va-kiosk-${suffix}`, name: '一体机账号', role: 'kiosk', passwordHash: await hash('kiosk-x'), enabled: false })
  const deleted = await mk({
    username: `va-deleted-${suffix}`, name: '已删管理员', role: 'admin', passwordHash: await hash('deleted-x'),
    deletedAt: new Date(), phoneHash: hashPhone(phones.deleted), phoneEnc: encryptPhone(phones.deleted), phoneVerifiedAt: new Date(),
  })
  // 普通停用管理员：手机号已验证、其它条件都和备用管理员一样，只差 isBackupAdmin——应急命令绝不能选中它。
  const plainPhone = phoneOf(7)
  const plainDisabled = await mk({
    username: `va-plain-disabled-${suffix}`, name: '普通停用管理员', role: 'admin', passwordHash: await hash('plain-x'), enabled: false,
    passwordProofState: 'temporary', phoneHash: hashPhone(plainPhone), phoneEnc: encryptPhone(plainPhone), phoneVerifiedAt: new Date(),
  })

  const token = (user: { id: string; role: string; orgId: string | null }, ver: number) =>
    jwt.sign({ sub: user.id, role: user.role, orgId: user.orgId, ver, jti: randomUUID() })
  const tokA = token(adminA, 0)
  const tokB0 = token(adminB, 0)
  const tokT = token(adminT, 0)
  const tokL = token(adminL, 0)
  const tokP = token(partner, 0)

  async function http(method: string, url: string, bearer: string | null, body?: unknown): Promise<HttpResult> {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'user-agent': 'verify-internal-accounts/1.0',
        'x-request-id': `req-${suffix}-${checks}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : {} }
  }
  const codeOf = (r: HttpResult) => r.body.error?.code
  const smsKey = (purpose: string, phone: string) => `internal:sms:code:${purpose}:${hashPhone(phone)}`
  async function allowNextSms(phone: string): Promise<void> {
    // 模拟「60 秒冷却已过」并剔除同一 CI Redis 上别的门禁累积的来源地址计数。
    const hour = new Date().toISOString().slice(0, 13)
    await rawRedis.del(`internal:sms:cooldown:global:${hashPhone(phone)}`, `internal:sms:ip:127.0.0.1:${hour}`,
      `internal:sms:ip:::ffff:127.0.0.1:${hour}`, `internal:password-reset:ip:127.0.0.1`, `internal:password-reset:ip:::ffff:127.0.0.1`,
      `internal:password-reset:identity-cooldown:${createHash('sha256').update(phone).digest('hex')}`)
  }
  const userRow = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } })

  try {
    // ── [A] 名册 ───────────────────────────────────────────────────────────
    console.log('\n[A] 名册白名单、筛选、分页、权限')
    const all = await http('GET', '/admin/internal-accounts?pageSize=100', tokA)
    const items = (all.body.items ?? []) as Array<Record<string, unknown>>
    check('A1 管理员可读名册 200', all.status === 200, `status=${all.status}`)
    const ids = items.map((item) => item.id)
    check('A2 admin / partner / kiosk 都在，已删除账号不在',
      [adminA.id, adminB.id, adminT.id, partner.id, kiosk.id].every((id) => ids.includes(id)) && !ids.includes(deleted.id))
    const expectedKeys = ['createdAt', 'emailBound', 'enabled', 'id', 'isBackupAdmin', 'lastLoginAt', 'name', 'orgId', 'orgName',
      'passwordState', 'phoneBound', 'phoneMasked', 'phoneVerified', 'role', 'username'].join(',')
    check('A3 每一项的字段集合恰好等于白名单', items.every((item) => Object.keys(item).sort().join(',') === expectedKeys),
      JSON.stringify(Object.keys(items[0] ?? {}).sort()))
    const serialized = JSON.stringify(all.body)
    const partnerRow = await userRow(partner.id)
    const forbiddenNames = ['passwordHash', 'phoneHash', 'phoneEnc', 'emailHash', 'emailEnc', 'tokenVersion', 'passwordProofState']
    const forbiddenValues = [partnerRow.passwordHash, partnerRow.phoneHash!, partnerRow.phoneEnc!, partnerRow.emailHash!, partnerRow.emailEnc!,
      phones.partner, (await userRow(adminA.id)).passwordHash]
    check('A4 敏感字段名不出现在响应里', forbiddenNames.every((name) => !serialized.includes(name)),
      forbiddenNames.filter((name) => serialized.includes(name)).join(','))
    check('A5 敏感字段的真实值（哈希/密文/完整手机号）不出现在响应里', forbiddenValues.every((value) => !serialized.includes(value)))
    const partnerItem = items.find((item) => item.id === partner.id) ?? {}
    check('A6 合作机构账号：机构名、脱敏手机号、已验证、邮箱已绑定、owner_managed',
      partnerItem.orgName === org.name && partnerItem.phoneMasked === `${phones.partner.slice(0, 3)}****${phones.partner.slice(7)}`
      && partnerItem.phoneVerified === true && partnerItem.emailBound === true && partnerItem.passwordState === 'owner_managed',
      JSON.stringify(partnerItem))
    const tItem = items.find((item) => item.id === adminT.id) ?? {}
    const lItem = items.find((item) => item.id === adminL.id) ?? {}
    check('A7 密码状态映射 temporary / legacy，未绑手机 phoneMasked=null',
      tItem.passwordState === 'temporary' && lItem.passwordState === 'legacy' && tItem.phoneMasked === null && tItem.phoneBound === false)

    const partnersOnly = await http('GET', '/admin/internal-accounts?role=partner&pageSize=100', tokA)
    check('A8 role=partner 只返回合作机构账号', partnersOnly.status === 200
      && (partnersOnly.body.items as Array<{ role: string }>).every((item) => item.role === 'partner')
      && (partnersOnly.body.items as Array<{ id: string }>).some((item) => item.id === partner.id))
    const disabledOnly = await http('GET', '/admin/internal-accounts?enabled=false&pageSize=100', tokA)
    check('A9 enabled=false 只返回停用账号', disabledOnly.status === 200
      && (disabledOnly.body.items as Array<{ enabled: boolean; id: string }>).every((item) => !item.enabled)
      && (disabledOnly.body.items as Array<{ id: string }>).some((item) => item.id === kiosk.id))
    const byOrg = await http('GET', `/admin/internal-accounts?orgId=${org.id}`, tokA)
    check('A10 orgId 筛选', byOrg.status === 200 && byOrg.body.total === 1
      && (byOrg.body.items as Array<{ id: string }>)[0]?.id === partner.id)
    const byKeyword = await http('GET', `/admin/internal-accounts?keyword=${encodeURIComponent(`va-admin-b-${suffix}`)}`, tokA)
    check('A11 关键字按用户名筛选', byKeyword.status === 200 && byKeyword.body.total === 1
      && (byKeyword.body.items as Array<{ id: string }>)[0]?.id === adminB.id)
    const byPhone = await http('GET', `/admin/internal-accounts?keyword=${phones.partner}`, tokA)
    check('A12 关键字是手机号时按手机号精确匹配', byPhone.status === 200 && byPhone.body.total === 1
      && (byPhone.body.items as Array<{ id: string }>)[0]?.id === partner.id)
    const page1 = await http('GET', '/admin/internal-accounts?role=admin&pageSize=10&page=1', tokA)
    const page2 = await http('GET', '/admin/internal-accounts?role=admin&pageSize=10&page=2', tokA)
    const adminCount = await prisma.user.count({ where: { role: 'admin', deletedAt: null } })
    check('A13 分页：total 为真实条数、page/pageSize 回显、第二页不与第一页重复',
      page1.body.total === adminCount && page1.body.page === 1 && page1.body.pageSize === 10
      && (page2.body.items as Array<{ id: string }>).every((item) => !(page1.body.items as Array<{ id: string }>).some((p) => p.id === item.id)))
    check('A14 pageSize 不在 10/20/50/100 → 400', codeOf(await http('GET', '/admin/internal-accounts?pageSize=7', tokA)) === 'VALIDATION_FAILED')
    check('A15 role 不是内部角色 → 400', codeOf(await http('GET', '/admin/internal-accounts?role=enduser', tokA)) === 'VALIDATION_FAILED')
    const asPartner = await http('GET', '/admin/internal-accounts', tokP)
    check('A16 合作机构账号读名册 → 403', asPartner.status === 403 && codeOf(asPartner) === 'AUTH_ROLE_FORBIDDEN', `${asPartner.status}`)
    check('A17 合作机构账号调启停 / 建备用 → 403',
      (await http('PATCH', `/admin/internal-accounts/${adminB.id}/status`, tokP, { action: 'disable', reason: '越权测试', adminCurrentPassword: pw.p })).status === 403
      && (await http('POST', '/admin/internal-accounts/backup-admin/start', tokP, { phone: phones.backup, adminCurrentPassword: pw.p })).status === 403)
    check('A18 未登录 → 401', (await http('GET', '/admin/internal-accounts', null)).status === 401)

    // ── [D0] 应急命令：库里还没有备用管理员时，只有一个普通停用管理员 ───────────────
    console.log('\n[D0] 应急命令只认备用管理员')
    let d0Error = ''
    let d0Code: string | null = null
    try {
      d0Code = (await emergency.issueBackupAdminEmergencyCode(prisma, { reason: '门禁核验', secret })).code
    } catch (error) {
      d0Error = (error as Error).message
    }
    // 万一签发成功（回归），把第二步也走完，让 D0-2 能看到「普通管理员被启用」这一真实后果。
    if (d0Code) await emergency.commitBackupAdminEmergencyEnable(prisma, { code: d0Code, reason: '门禁核验', secret }).catch(() => undefined)
    check('D0-1 没有备用管理员时签发确认码被拒（普通停用管理员不会被选中）', d0Error.startsWith('BACKUP_ADMIN_EMERGENCY_NOT_FOUND'), d0Error)
    check('D0-2 普通停用管理员仍是停用', (await userRow(plainDisabled.id)).enabled === false)

    // ── [B] 启停 ───────────────────────────────────────────────────────────
    console.log('\n[B] 启停管理员')
    const statusUrl = (id: string) => `/admin/internal-accounts/${id}/status`
    const wrong = await http('PATCH', statusUrl(adminB.id), tokA, { action: 'disable', reason: '核验停用', adminCurrentPassword: 'wrong-password' })
    check('B1 本人密码错 → 422 ADMIN_CREDENTIAL_INVALID，目标不变',
      wrong.status === 422 && codeOf(wrong) === 'ADMIN_CREDENTIAL_INVALID' && (await userRow(adminB.id)).enabled, `${wrong.status} ${codeOf(wrong)}`)
    check('B2 缺事由 / 事由全是空白 → 400',
      codeOf(await http('PATCH', statusUrl(adminB.id), tokA, { action: 'disable', adminCurrentPassword: pw.a })) === 'VALIDATION_FAILED'
      && codeOf(await http('PATCH', statusUrl(adminB.id), tokA, { action: 'disable', reason: '    ', adminCurrentPassword: pw.a })) === 'VALIDATION_FAILED'
      && codeOf(await http('PATCH', statusUrl(adminB.id), tokA, { action: 'disable', reason: 'x'.repeat(201), adminCurrentPassword: pw.a })) === 'VALIDATION_FAILED')
    const onPartner = await http('PATCH', statusUrl(partner.id), tokA, { action: 'disable', reason: '越界测试', adminCurrentPassword: pw.a })
    check('B3 目标是合作机构账号 → 422 INTERNAL_ACCOUNT_ROLE_UNSUPPORTED，且账号未被停用',
      onPartner.status === 422 && codeOf(onPartner) === 'INTERNAL_ACCOUNT_ROLE_UNSUPPORTED' && (await userRow(partner.id)).enabled)
    const onKiosk = await http('PATCH', statusUrl(kiosk.id), tokA, { action: 'enable', reason: '越界测试', adminCurrentPassword: pw.a })
    check('B4 目标是一体机账号 → 422，且账号未被启用', codeOf(onKiosk) === 'INTERNAL_ACCOUNT_ROLE_UNSUPPORTED' && !(await userRow(kiosk.id)).enabled)
    const self = await http('PATCH', statusUrl(adminA.id), tokA, { action: 'disable', reason: '停自己', adminCurrentPassword: pw.a })
    check('B5 停用自己 → 409 INTERNAL_ACCOUNT_SELF_DISABLE_FORBIDDEN', self.status === 409 && codeOf(self) === 'INTERNAL_ACCOUNT_SELF_DISABLE_FORBIDDEN')
    check('B6 目标不存在 / 已删除 → 404',
      codeOf(await http('PATCH', statusUrl('no-such-user'), tokA, { action: 'disable', reason: '不存在', adminCurrentPassword: pw.a })) === 'INTERNAL_ACCOUNT_NOT_FOUND'
      && codeOf(await http('PATCH', statusUrl(deleted.id), tokA, { action: 'enable', reason: '已删除', adminCurrentPassword: pw.a })) === 'INTERNAL_ACCOUNT_NOT_FOUND')
    const byTemp = await http('PATCH', statusUrl(adminB.id), tokT, { action: 'disable', reason: '临时密码操作人', adminCurrentPassword: pw.t })
    check('B7 临时密码的管理员不能做启停 → 403', byTemp.status === 403 && codeOf(byTemp) === 'INTERNAL_ACCOUNT_ACTOR_PASSWORD_NOT_READY')

    for (let i = 0; i < 5; i += 1) await http('PATCH', statusUrl(adminB.id), tokL, { action: 'disable', reason: '锁定测试', adminCurrentPassword: `bad-${i}` })
    const locked = await http('PATCH', statusUrl(adminB.id), tokL, { action: 'disable', reason: '锁定测试', adminCurrentPassword: pw.l })
    check('B8 连错 5 次后正确密码也被锁 → 429 ADMIN_CREDENTIAL_LOCKED，目标不变',
      locked.status === 429 && codeOf(locked) === 'ADMIN_CREDENTIAL_LOCKED' && (await userRow(adminB.id)).enabled)
    await actionRedis.clearPasswordFailures('admin', adminL.id)

    const beforeB = await userRow(adminB.id)
    check('B9a 停用前乙的登录凭证可用', (await http('GET', '/admin/internal-accounts', tokB0)).status === 200)
    const disableB = await http('PATCH', statusUrl(adminB.id), tokA, { action: 'disable', reason: '人员离岗', adminCurrentPassword: pw.a })
    const afterB = await userRow(adminB.id)
    check('B9 停用乙 → 200，enabled=false，tokenVersion+1',
      disableB.status === 200 && disableB.body.enabled === false && afterB.enabled === false && afterB.tokenVersion === beforeB.tokenVersion + 1,
      `${disableB.status} ${JSON.stringify(disableB.body).slice(0, 160)}`)
    check('B10 停用后乙的旧登录凭证立即失效（401）', (await http('GET', '/admin/internal-accounts', tokB0)).status === 401)
    const sessionState = JSON.parse((await rawRedis.get(`internal:session-state:${adminB.id}`)) ?? '{}') as { enabled?: boolean; tokenVersion?: number }
    check('B11 Redis 会话状态写成停用 + 新版本', sessionState.enabled === false && sessionState.tokenVersion === afterB.tokenVersion)
    const disableAudit = await prisma.auditLog.findFirst({ where: { action: 'user.disable', targetId: adminB.id } })
    const disablePayload = JSON.parse(disableAudit?.payloadJson ?? '{}') as Record<string, unknown>
    check('B12 审计 user.disable：操作人、事由、来源地址 / UA / requestId',
      disableAudit?.actorId === adminA.id && disableAudit.actorRole === 'admin' && disableAudit.targetType === 'user'
      && disablePayload.reason === '人员离岗' && !!disableAudit.ipAddress && disableAudit.userAgent === 'verify-internal-accounts/1.0'
      && !!disableAudit.requestId?.startsWith(`req-${suffix}`), JSON.stringify(disableAudit))
    const again = await http('PATCH', statusUrl(adminB.id), tokA, { action: 'disable', reason: '重复停用', adminCurrentPassword: pw.a })
    check('B13 已停用再停用 → 409 INTERNAL_ACCOUNT_STATUS_UNCHANGED，版本不再变',
      codeOf(again) === 'INTERNAL_ACCOUNT_STATUS_UNCHANGED' && (await userRow(adminB.id)).tokenVersion === afterB.tokenVersion)
    const enableB = await http('PATCH', statusUrl(adminB.id), tokA, { action: 'enable', reason: '人员返岗', adminCurrentPassword: pw.a })
    const reB = await userRow(adminB.id)
    check('B14 启用乙 → 200，tokenVersion 再 +1，审计 user.enable',
      enableB.status === 200 && reB.enabled && reB.tokenVersion === afterB.tokenVersion + 1
      && !!(await prisma.auditLog.findFirst({ where: { action: 'user.enable', targetId: adminB.id, actorId: adminA.id } })))
    check('B15 启用后停用前签发的旧凭证仍然无效，新凭证有效',
      (await http('GET', '/admin/internal-accounts', tokB0)).status === 401
      && (await http('GET', '/admin/internal-accounts', token(adminB, reB.tokenVersion))).status === 200)

    // 并发互停：先把其它可用管理员（临时 T、锁定 L）停掉，只剩甲、乙。两边都过了前置检查后再一起进事务。
    for (const id of [adminT.id, adminL.id]) {
      const r = await http('PATCH', statusUrl(id), tokA, { action: 'disable', reason: '准备并发用例', adminCurrentPassword: pw.a })
      check(`B16 准备：停用 ${id === adminT.id ? '临时' : '锁定'}管理员`, r.status === 200, `${r.status} ${codeOf(r)}`)
    }
    const enabledAdminsBefore = await prisma.user.count({ where: { role: 'admin', enabled: true, deletedAt: null } })
    check('B17 准备完毕：只剩甲、乙两个可用管理员', enabledAdminsBefore === 2, `${enabledAdminsBefore}`)
    let arrivals = 0
    let releaseGate: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    const gateTimer = setTimeout(() => releaseGate(), 5_000)
    const gatedPrisma = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === '$transaction') {
          return async (...args: unknown[]) => {
            arrivals += 1
            if (arrivals >= 2) releaseGate()
            await gate
            return (target.$transaction as (...a: unknown[]) => Promise<unknown>).apply(target, args)
          }
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const racer = new AdminInternalAccountsService(gatedPrisma as typeof prisma, redisService, actionRedis, audit)
    const ctx = { ip: '127.0.0.1', ipAddress: '127.0.0.1', userAgent: 'verify-race', requestId: null }
    const race = await Promise.allSettled([
      racer.setStatus({ userId: adminA.id, role: 'admin', orgId: null }, adminB.id, { action: 'disable', reason: '并发互停', adminCurrentPassword: pw.a }, ctx),
      racer.setStatus({ userId: adminB.id, role: 'admin', orgId: null }, adminA.id, { action: 'disable', reason: '并发互停', adminCurrentPassword: pw.b }, ctx),
    ])
    clearTimeout(gateTimer)
    const fulfilled = race.filter((r) => r.status === 'fulfilled').length
    const rejectedCodes = race.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()?.error?.code ?? String(r.reason))
    const enabledAdminsAfter = await prisma.user.count({ where: { role: 'admin', enabled: true, deletedAt: null } })
    check('B18 两个管理员同时互相停用：两边都已进入事务，只成功一个，另一个 409 INTERNAL_ACCOUNT_LAST_ADMIN',
      arrivals === 2 && fulfilled === 1 && rejectedCodes.length === 1 && rejectedCodes[0] === 'INTERNAL_ACCOUNT_LAST_ADMIN',
      `arrivals=${arrivals} fulfilled=${fulfilled} rejected=${rejectedCodes.join(',')}`)
    check('B19 系统里至少剩一个可用管理员', enabledAdminsAfter >= 1, `${enabledAdminsAfter}`)
    // 恢复：让甲可用、乙停用（后续用甲操作）。
    const aRow = await userRow(adminA.id)
    if (!aRow.enabled) {
      await prisma.user.update({ where: { id: adminA.id }, data: { enabled: true } })
      await prisma.user.update({ where: { id: adminB.id }, data: { enabled: false } })
    }
    const tokA2 = token(adminA, (await userRow(adminA.id)).tokenVersion)
    const bNow = await userRow(adminB.id)
    const reEnableB = await http('PATCH', statusUrl(adminB.id), tokA2, { action: 'enable', reason: '恢复乙', adminCurrentPassword: pw.a })
    check('B20 恢复：甲重新启用乙', reEnableB.status === 200, `${reEnableB.status} ${codeOf(reEnableB)}`)
    const tokB = token(adminB, bNow.tokenVersion + 1)

    // ── [C] 建备用管理员 ─────────────────────────────────────────────────────
    console.log('\n[C] 建备用管理员')
    const startUrl = '/admin/internal-accounts/backup-admin/start'
    const verifyUrl = '/admin/internal-accounts/backup-admin/verify'
    const startWrong = await http('POST', startUrl, tokA2, { phone: phones.backup, adminCurrentPassword: 'wrong-password' })
    check('C1 本人密码错 → 422，不发码', codeOf(startWrong) === 'ADMIN_CREDENTIAL_INVALID'
      && (await rawRedis.get(smsKey('backup_admin_create', phones.backup))) === null)
    const occupied = await http('POST', startUrl, tokA2, { phone: phones.partner, adminCurrentPassword: pw.a })
    check('C2 手机号已被合作机构账号占用 → 409 INTERNAL_ACCOUNT_PHONE_OCCUPIED', occupied.status === 409 && codeOf(occupied) === 'INTERNAL_ACCOUNT_PHONE_OCCUPIED')
    const occupiedDeleted = await http('POST', startUrl, tokA2, { phone: phones.deleted, adminCurrentPassword: pw.a })
    check('C3 手机号被已删除账号占着（phoneHash 全表唯一）→ 409', codeOf(occupiedDeleted) === 'INTERNAL_ACCOUNT_PHONE_OCCUPIED')
    check('C4 手机号格式不对 → 400', codeOf(await http('POST', startUrl, tokA2, { phone: '12345', adminCurrentPassword: pw.a })) === 'VALIDATION_FAILED')

    await allowNextSms(phones.backup)
    const s1 = await http('POST', startUrl, tokA2, { phone: phones.backup, adminCurrentPassword: pw.a })
    check('C5 开始建号 → 200，返回凭证与脱敏手机号', s1.status === 200 && typeof s1.body.ticket === 'string'
      && s1.body.phoneMasked === `${phones.backup.slice(0, 3)}****${phones.backup.slice(7)}` && !JSON.stringify(s1.body).includes(phones.backup),
      `${s1.status} ${codeOf(s1)}`)
    // 过期：删掉验证码等同于 5 分钟已过。
    await rawRedis.del(smsKey('backup_admin_create', phones.backup))
    const expired = await http('POST', verifyUrl, tokA2, { ticket: s1.body.ticket, code: '123456' })
    check('C6 验证码过期 → 400 SMS_CODE_EXPIRED', expired.status === 400 && codeOf(expired) === 'SMS_CODE_EXPIRED', `${expired.status} ${codeOf(expired)}`)
    check('C7 过期后凭证作废 → 409 BACKUP_ADMIN_CHALLENGE_UNAVAILABLE',
      codeOf(await http('POST', verifyUrl, tokA2, { ticket: s1.body.ticket, code: '123456' })) === 'BACKUP_ADMIN_CHALLENGE_UNAVAILABLE')

    await allowNextSms(phones.backup)
    const s2 = await http('POST', startUrl, tokA2, { phone: phones.backup, adminCurrentPassword: pw.a })
    const realCode = (await rawRedis.get(smsKey('backup_admin_create', phones.backup))) ?? ''
    const wrongCode = realCode === '000000' ? '111111' : '000000'
    const badCode = await http('POST', verifyUrl, tokA2, { ticket: s2.body.ticket, code: wrongCode })
    check('C8 验证码错 → 400 SMS_CODE_INVALID，不建号', badCode.status === 400 && codeOf(badCode) === 'SMS_CODE_INVALID'
      && (await prisma.user.count({ where: { isBackupAdmin: true } })) === 0)
    const otherAdmin = await http('POST', verifyUrl, tokB, { ticket: s2.body.ticket, code: realCode })
    check('C9 别的管理员拿这张凭证 → 409，不建号', codeOf(otherAdmin) === 'BACKUP_ADMIN_CHALLENGE_UNAVAILABLE'
      && (await prisma.user.count({ where: { isBackupAdmin: true } })) === 0)
    const ok = await http('POST', verifyUrl, tokA2, { ticket: s2.body.ticket, code: realCode })
    check('C10 验证码对 → 200，建出停用、手机已验证、临时密码的备用管理员',
      ok.status === 200 && ok.body.role === 'admin' && ok.body.enabled === false && ok.body.isBackupAdmin === true
      && ok.body.phoneVerified === true && ok.body.passwordState === 'temporary' && ok.body.name === '备用管理员',
      `${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`)
    const backupId = String(ok.body.id)
    const backupRow = await userRow(backupId)
    check('C11 库里：isBackupAdmin、停用、phoneHash 对得上、phoneVerifiedAt 有值、无机构',
      backupRow.isBackupAdmin && !backupRow.enabled && backupRow.phoneHash === hashPhone(phones.backup) && !!backupRow.phoneVerifiedAt && backupRow.orgId === null)
    check('C12 随机临时密码不是任何已知口令', !(await bcrypt.compare(pw.a, backupRow.passwordHash)) && !(await bcrypt.compare('', backupRow.passwordHash)))
    const createAudit = await prisma.auditLog.findFirst({ where: { action: 'user.create', targetId: backupId } })
    const createPayload = JSON.parse(createAudit?.payloadJson ?? '{}') as Record<string, unknown>
    check('C13 审计 user.create：标 backup、脱敏手机号、带来源地址 / UA / requestId',
      createAudit?.actorId === adminA.id && createPayload.backup === true && createPayload.phoneMasked === s2.body.phoneMasked
      && !!createAudit.ipAddress && createAudit.userAgent === 'verify-internal-accounts/1.0' && !!createAudit.requestId,
      JSON.stringify(createAudit))
    check('C14 凭证不能重放', codeOf(await http('POST', verifyUrl, tokA2, { ticket: s2.body.ticket, code: realCode })) === 'BACKUP_ADMIN_CHALLENGE_UNAVAILABLE')
    await allowNextSms(phones.backupB)
    const second = await http('POST', startUrl, tokA2, { phone: phones.backupB, adminCurrentPassword: pw.a })
    check('C15 已有备用管理员时再建 → 409 BACKUP_ADMIN_EXISTS', second.status === 409 && codeOf(second) === 'BACKUP_ADMIN_EXISTS')
    let indexError = ''
    try {
      await prisma.user.create({ data: { username: `va-second-backup-${suffix}`, name: 'x', role: 'admin', passwordHash: 'x', isBackupAdmin: true, enabled: false } })
    } catch (error) {
      indexError = (error as Error).message
    }
    check('C16 数据库条件唯一索引（真实迁移）挡住绕过服务层的第二个备用管理员', indexError !== '', 'second insert succeeded')
    const listed = await http('GET', '/admin/internal-accounts?keyword=backup-admin', tokA2)
    check('C17 名册里能看到备用管理员（isBackupAdmin=true、停用）',
      (listed.body.items as Array<{ id: string; isBackupAdmin: boolean; enabled: boolean }> | undefined)?.some((item) => item.id === backupId && item.isBackupAdmin && !item.enabled) === true)

    // 并发建号：先软删现有备用管理员腾位（条件索引只管未删除的），甲乙各自拿到凭证后同时提交。
    await prisma.user.update({ where: { id: backupId }, data: { deletedAt: new Date() } })
    await allowNextSms(phones.backupB)
    const sa = await http('POST', startUrl, tokA2, { phone: phones.backupB, adminCurrentPassword: pw.a })
    const codeA = (await rawRedis.get(smsKey('backup_admin_create', phones.backupB))) ?? ''
    const phoneC = phoneOf(6)
    await allowNextSms(phoneC)
    const sb = await http('POST', startUrl, tokB, { phone: phoneC, adminCurrentPassword: pw.b })
    const codeB = (await rawRedis.get(smsKey('backup_admin_create', phoneC))) ?? ''
    const [ra, rb] = await Promise.all([
      http('POST', verifyUrl, tokA2, { ticket: sa.body.ticket, code: codeA }),
      http('POST', verifyUrl, tokB, { ticket: sb.body.ticket, code: codeB }),
    ])
    const liveBackups = await prisma.user.count({ where: { isBackupAdmin: true, deletedAt: null } })
    check('C18 两个管理员并发建备用管理员：一个 200、一个 409 BACKUP_ADMIN_EXISTS，库里只有一个',
      sa.status === 200 && sb.status === 200 && [ra.status, rb.status].sort().join(',') === '200,409'
      && [codeOf(ra), codeOf(rb)].includes('BACKUP_ADMIN_EXISTS') && liveBackups === 1,
      `start=${sa.status},${sb.status} verify=${ra.status}:${codeOf(ra)},${rb.status}:${codeOf(rb)} live=${liveBackups}`)
    const winner = await prisma.user.findFirstOrThrow({ where: { isBackupAdmin: true, deletedAt: null } })
    const winnerPhone = winner.phoneHash === hashPhone(phones.backupB) ? phones.backupB : phoneC

    // ── [D] 应急命令 ────────────────────────────────────────────────────────
    console.log('\n[D] 服务器端应急启用命令')
    const prodEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://ops:secret@127.0.0.1:5432/production',
      BACKUP_ADMIN_EMERGENCY_CONFIRM: emergency.BACKUP_ADMIN_EMERGENCY_CONFIRMATION,
      BACKUP_ADMIN_EMERGENCY_REASON: '主管理员手机丢失',
      SECRET_ENCRYPTION_KEY: secret,
    }
    const rejectsWith = (env: NodeJS.ProcessEnv, code: string) => {
      try {
        emergency.readBackupAdminEmergencyConfig(env)
        return false
      } catch (error) {
        return (error as Error).message.startsWith(code)
      }
    }
    check('D1 生产 + PostgreSQL + 精确短语 + 事由 → 放行（无确认码 = 第一步）', emergency.readBackupAdminEmergencyConfig(prodEnv).code === null)
    check('D2 非生产 / SQLite / 短语不对 / 缺事由 一律拒',
      rejectsWith({ ...prodEnv, NODE_ENV: 'test' }, 'BACKUP_ADMIN_EMERGENCY_ENV_FORBIDDEN')
      && rejectsWith({ ...prodEnv, DATABASE_URL: 'file:./prisma/dev.db' }, 'BACKUP_ADMIN_EMERGENCY_POSTGRES_REQUIRED')
      && rejectsWith({ ...prodEnv, BACKUP_ADMIN_EMERGENCY_CONFIRM: 'yes' }, 'BACKUP_ADMIN_EMERGENCY_CONFIRMATION_REQUIRED')
      && rejectsWith({ ...prodEnv, BACKUP_ADMIN_EMERGENCY_REASON: '' }, 'BACKUP_ADMIN_EMERGENCY_REASON_REQUIRED'))

    // [E0] 停用中的备用管理员：找回密码不发码。
    await allowNextSms(winnerPhone)
    await auth.startPasswordReset(winnerPhone, '127.0.0.1')
    check('E0 停用中的备用管理员找回密码不发码', (await rawRedis.get(smsKey('reset_password', winnerPhone))) === null)

    const now = new Date()
    const issued = await emergency.issueBackupAdminEmergencyCode(prisma, { reason: '主管理员手机丢失', secret, now })
    check('D3 第一步签发确认码，只打印用户名与脱敏手机号，账号仍停用',
      issued.userId === winner.id && issued.phoneMasked.includes('****') && !(await userRow(winner.id)).enabled)
    check('D4 第一步写审计 user.emergency_enable_requested（system-cli）',
      !!(await prisma.auditLog.findFirst({ where: { action: 'user.emergency_enable_requested', targetId: winner.id, actorRole: 'system-cli', actorId: null } })))
    const commitRejects = async (code: string, at: Date, expected: string) => {
      try {
        await emergency.commitBackupAdminEmergencyEnable(prisma, { code, reason: '主管理员手机丢失', secret, now: at })
        return false
      } catch (error) {
        return (error as Error).message.startsWith(expected)
      }
    }
    const tampered = issued.code.replace(/.$/, (c) => (c === '0' ? '1' : '0'))
    check('D5 确认码被改一位 → 拒绝', await commitRejects(tampered, now, 'BACKUP_ADMIN_EMERGENCY_CODE_INVALID'))
    check('D6 超过 10 分钟 → 拒绝', await commitRejects(issued.code, new Date(now.getTime() + 10 * 60 * 1000 + 1), 'BACKUP_ADMIN_EMERGENCY_CODE_EXPIRED'))
    check('D7 换一个密钥伪造 → 拒绝', await (async () => {
      try {
        await emergency.commitBackupAdminEmergencyEnable(prisma, { code: issued.code, reason: 'x1', secret: `${secret}-other`, now })
        return false
      } catch (error) {
        return (error as Error).message.startsWith('BACKUP_ADMIN_EMERGENCY_CODE_INVALID')
      }
    })())
    check('D8 以上被拒后账号仍停用', !(await userRow(winner.id)).enabled)
    const winnerBefore = await userRow(winner.id)
    const enabledByCli = await emergency.commitBackupAdminEmergencyEnable(prisma, { code: issued.code, reason: '主管理员手机丢失', secret, now })
    const winnerAfter = await userRow(winner.id)
    check('D9 10 分钟内带确认码 → 启用，tokenVersion+1', enabledByCli.userId === winner.id && winnerAfter.enabled
      && winnerAfter.tokenVersion === winnerBefore.tokenVersion + 1)
    const cliAudit = await prisma.auditLog.findFirst({ where: { action: 'user.enable', targetId: winner.id } })
    const cliPayload = JSON.parse(cliAudit?.payloadJson ?? '{}') as Record<string, unknown>
    check('D10 审计 user.enable：actorRole=system-cli、无 actorId、带事由与 via=emergency_cli',
      cliAudit?.actorRole === 'system-cli' && cliAudit.actorId === null && cliPayload.reason === '主管理员手机丢失' && cliPayload.via === 'emergency_cli')
    check('D11 同一确认码再用 → 拒绝（一次性）', await commitRejects(issued.code, now, 'BACKUP_ADMIN_EMERGENCY_ALREADY_ENABLED'))
    check('D12 普通停用管理员始终没被启用', (await userRow(plainDisabled.id)).enabled === false)

    // ── [E] 启用后首次登录：短信找回密码 → 第二步开着也能登录 ───────────────────
    console.log('\n[E] 备用管理员首次登录')
    await allowNextSms(winnerPhone)
    await auth.startPasswordReset(winnerPhone, '127.0.0.1')
    const resetCode = (await rawRedis.get(smsKey('reset_password', winnerPhone))) ?? ''
    check('E1 启用后找回密码会发码', /^\d{6}$/.test(resetCode))
    const { resetTicket } = await auth.verifyPasswordReset(winnerPhone, resetCode, '127.0.0.1')
    const newPassword = `Backup-${suffix}-Aa1!`
    await auth.completePasswordReset(resetTicket, newPassword, '127.0.0.1')
    const winnerReset = await userRow(winner.id)
    check('E2 找回密码后 passwordProofState=owner_managed', winnerReset.passwordProofState === 'owner_managed')
    process.env['ADMIN_LOGIN_SECOND_FACTOR'] = 'sms'
    const challenge = await auth.login(winner.username, newPassword, 'admin', '127.0.0.1') as { secondFactorRequired?: boolean; challengeTicket?: string }
    check('E3 第二步开着：密码登录只拿到第二步凭证', challenge.secondFactorRequired === true && typeof challenge.challengeTicket === 'string')
    const twoFaCode = (await rawRedis.get(smsKey('admin_login_2fa', winnerPhone))) ?? ''
    const loggedIn = await auth.completeAdminSecondFactor(challenge.challengeTicket ?? '', twoFaCode, '127.0.0.1') as { token?: string }
    check('E4 短信第二步通过 → 拿到登录凭证', typeof loggedIn.token === 'string')
    check('E5 备用管理员的新凭证能打开名册', (await http('GET', '/admin/internal-accounts', loggedIn.token ?? '')).status === 200)
    process.env['ADMIN_LOGIN_SECOND_FACTOR'] = 'off'

    // ── [F] 审计脱敏 ─────────────────────────────────────────────────────────
    console.log('\n[F] 审计脱敏')
    const audits = await prisma.auditLog.findMany({ where: { action: { startsWith: 'user.' } } })
    const blob = audits.map((row) => row.payloadJson).join('\n')
    const secrets = [...Object.values(phones), phoneC, plainPhone, ...Object.values(pw), newPassword,
      hashPhone(phones.backupB), hashPhone(phoneC), winner.phoneEnc ?? '', winner.passwordHash]
    check('F1 user.* 审计 payload 里没有完整手机号 / 哈希 / 密文 / 密码', audits.length >= 6 && secrets.every((value) => !value || !blob.includes(value)),
      `audits=${audits.length}`)
    check('F2 user.step_up_failed 审计只记结果不记输入', audits.filter((row) => row.action === 'user.step_up_failed').length >= 1
      && !blob.includes('wrong-password'))
  } finally {
    await rawRedis.quit().catch(() => undefined)
    await app.close()
  }
}

main()
  .then(() => {
    cleanupDb()
    console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILED'} (${checks - failures}/${checks})`)
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch((error: unknown) => {
    console.error('\n', error)
    cleanupDb()
    process.exit(1)
  })
