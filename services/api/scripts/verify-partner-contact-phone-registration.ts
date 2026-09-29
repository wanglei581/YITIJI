/**
 * 机构账号「临时密码 + 管理员登记手机」：登记、知会、找回密码自证、机构自管操作。
 * 自建临时 SQLite（prisma migrate deploy），不碰共享验证库。
 */
import 'reflect-metadata'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import Redis from 'ioredis'
import { AuditService } from '../src/audit/audit.service'
import { AuthService } from '../src/auth/auth.service'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import { PartnerAccountActionService } from '../src/auth/partner-account-action.service'
import { PASSWORD_PROOF_STATE } from '../src/auth/password-proof-state'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { decryptPhone, encryptPhone, hashPhone, maskPhone } from '../src/common/crypto/phone-identity'
import { PartnerAccountActionRedisService } from '../src/common/redis/partner-account-action-redis.service'
import { resetRedisCooldownForTests } from '../src/common/redis/redis-degradation'
import { RedisService } from '../src/common/redis/redis.service'
import { BudgetedSmsSender, smsBudgetChannelKey, shanghaiDay } from '../src/member-auth/sms/sms-budget'
import { SmsSendError } from '../src/member-auth/sms/sms-sender'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { CONTACT_PHONE_CHANGE_COOLDOWN_MS, contactPhoneRecentlyChanged } from '../src/orgs/contact-phone-change'
import { RegisterPartnerContactPhoneDto } from '../src/orgs/dto/register-partner-contact-phone.dto'
import { PartnerContactPhoneRegistrationService } from '../src/orgs/partner-contact-phone-registration.service'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  CapturingSmsSender,
  MemoryRedis,
} from './support/internal-auth-verify-harness'

const apiRoot = join(import.meta.dirname, '..')
const ADMIN_PASSWORD = 'AdminPass123'
const LOCK_PASSWORD = 'LockAdmin123'
const NEW_PASSWORD = 'OwnerPass1234'
const LETTER = 'QD-2026/091'

let passes = 0

function pass(message: string): void {
  passes += 1
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(`FAIL ${message}`)
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

function read(path: string): string {
  return readFileSync(join(apiRoot, path), 'utf8')
}

function httpOf(error: unknown): { status: number; code?: string; message?: string } {
  if (!(error instanceof HttpException)) return { status: 0, message: error instanceof Error ? error.message : String(error) }
  const response = error.getResponse()
  const payload = typeof response === 'object' && response ? response as { error?: { code?: string; message?: string } } : {}
  return { status: error.getStatus(), code: payload.error?.code, message: payload.error?.message }
}

async function expectHttp(
  operation: () => Promise<unknown>,
  status: number,
  code: string,
  message: string,
  label: string,
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    const http = httpOf(error)
    ensure(
      http.status === status && http.code === code && http.message === message,
      `${label}：得到 ${http.status} ${http.code ?? '-'} ${http.message ?? ''}`,
    )
    pass(label)
    return
  }
  fail(`${label}：调用成功了`)
}

function assertNoSecrets(value: unknown, secrets: string[], label: string): void {
  const text = JSON.stringify(value)
  for (const secret of secrets) ensure(text.includes(secret) === false, `${label} 带出了不该出现的内容`)
}

function mobile(offset: number): string {
  const base = Date.now() % 100000
  return `138${String(base + offset).padStart(8, '0')}`
}

function hyphen(phone: string): string {
  return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`
}

function actor(userId: string, sessionId: string): AuthedUser {
  return { userId, role: 'admin', orgId: null, sessionId }
}

class BoomAudit extends AuditService {
  override async writeRequired(tx: never, args: { action: string }): Promise<string> {
    if (args.action === 'partner_account.contact_phone_registered') throw new Error('audit boom')
    return super.writeRequired(tx, args as never)
  }
}

class FailingNoticeSender extends CapturingSmsSender {
  override async sendPartnerPhoneRegisteredNotice(): Promise<void> {
    throw new SmsSendError('FailedOperation')
  }
}

function assertSourceContract(): void {
  const auth = read('src/auth/auth.service.ts')
  const reset = read('src/auth/admin-registered-phone-reset.ts')
  const registration = read('src/orgs/partner-contact-phone-registration.service.ts')
  const controller = read('src/orgs/admin-orgs.controller.ts')
  const gates = read('src/config/production-runtime-gates.ts')
  const registerFn = registration.slice(registration.indexOf('async register('), registration.indexOf('private eligible('))
  const verified = auth.match(/private async findVerifiedUserByPhone\(phone: string\)[\s\S]*?\n {2}\}/)?.[0] ?? ''

  ensure(verified.includes('return user?.phoneVerifiedAt ? user : null'), 'findVerifiedUserByPhone 仍只认已经自证的手机号')
  ensure((reset.match(/user\.role === 'partner'/g) ?? []).length === 1, '未自证手机只放行机构账号这一处角色判断')
  ensure(reset.includes('findVerifiedUserByPhone'), '按手机号找回先走已自证查找')
  ensure(
    auth.includes('phoneVerifiedAt: new Date(), phoneRegisteredByAdminAt: null'),
    '找回密码成功时要在同一次更新里写上自证时间并清掉管理员登记时间',
  )
  ensure(registerFn.includes("normalizePhone(org.contactPhone ?? '') !== phone"), '登记必须核对机构联系人手机')
  ensure(registerFn.includes('CONTACT_PHONE_MISMATCH'), '不一致时使用 CONTACT_PHONE_MISMATCH')
  ensure(registerFn.includes('contactPhoneRecentlyChanged(org.contactPhoneChangedAt'), '登记必须看 24 小时冷却')
  ensure(registration.includes('passwordProofState !== PASSWORD_PROOF_STATE.TEMPORARY'), '资格判断要求临时密码')
  ensure(registration.includes('passwordProofState: PASSWORD_PROOF_STATE.TEMPORARY'), '写入时再次要求临时密码')
  ensure(/\$transaction\(async \(tx\) => \{[\s\S]*writeRequired\(tx,[\s\S]*contact_phone_registered/.test(registerFn), '登记审计写在同一事务里')
  ensure(/sendPartnerPhoneRegisteredNotice\(phone, org\.name\)[\s\S]*revertRegistration\(/.test(registerFn), '知会失败要补偿清掉这次登记')
  ensure(/notifyPhone|destinationPhone|forwardPhone/.test(registration) === false, '登记不能把验证码改发到别的号码')
  ensure(controller.includes("@Post('admin/orgs/:id/accounts/:accountId/contact-phone')"), '登记路由挂在机构账号下')
  ensure(controller.includes("@Roles('admin')"), '登记沿用管理员角色守卫')
  ensure(gates.includes('SMS_TEMPLATE_PARTNER_PHONE_REGISTERED') === false, '知会模板不是生产启动必填项')
  ensure(read('.env.example').includes('SMS_TEMPLATE_PARTNER_PHONE_REGISTERED='), '.env.example 写明知会模板要另申请')
  ensure(read('src/audit/audit.types.ts').includes("'partner_account.contact_phone_registered'"), '审计动作已登记')
  ensure(read('src/audit/audit.types.ts').includes("'partner_account.contact_phone_registration_reverted'"), '回滚审计动作已登记')
  ensure(read('../../packages/shared/src/types/audit.ts').includes("'partner_account.contact_phone_registered'"), '共享审计类型已登记')
  ensure(read('../../packages/shared/src/types/audit.ts').includes("'partner_account.contact_phone_registration_reverted'"), '共享回滚审计类型已登记')
  pass('源码契约：一致性、冷却、临时密码、事务审计、失败补偿、找回密码只放行机构账号')
}

async function assertDtoRejectsForwarding(): Promise<void> {
  const dto = plainToInstance(RegisterPartnerContactPhoneDto, {
    phone: '138-0000-2001',
    confirmationLetterNo: 'QD 2026 / 091',
    currentPassword: ADMIN_PASSWORD,
    notifyPhone: '13900000000',
  })
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true })
  ensure(errors.some((error) => error.property === 'notifyPhone'), '多出来的收信号码字段必须被拒绝')
  ensure(dto.phone === '13800002001' && dto.confirmationLetterNo === 'QD2026/091', '手机号与确认函编号要先规范化')
  const badPhone = await validate(plainToInstance(RegisterPartnerContactPhoneDto, {
    phone: '01012345678', confirmationLetterNo: LETTER, currentPassword: 'x',
  }))
  const badLetter = await validate(plainToInstance(RegisterPartnerContactPhoneDto, {
    phone: '13800002001', confirmationLetterNo: '中文函', currentPassword: 'x',
  }))
  ensure(badPhone.length > 0 && badLetter.length > 0, '非法手机号和确认函编号不能通过校验')
  pass('请求体拒绝改发号码，并规范化手机号与确认函编号')
}

function assertCooldownBoundary(): void {
  const now = new Date('2026-09-29T12:00:00.000Z')
  const exactly = new Date(now.getTime() - CONTACT_PHONE_CHANGE_COOLDOWN_MS)
  ensure(contactPhoneRecentlyChanged(null, now) === false, '没记过变更时间时不拦截')
  ensure(contactPhoneRecentlyChanged(exactly, now) === false, '满 24 小时整可以登记')
  ensure(contactPhoneRecentlyChanged(new Date(exactly.getTime() + 1), now) === true, '不满 24 小时不能登记')
  pass('24 小时冷却按「不满才拦截」计算')
}

async function assertNoticeBudget(): Promise<void> {
  resetRedisCooldownForTests()
  const day = shanghaiDay(new Date())
  const redis = new MemoryRedis()
  const inner = new CapturingSmsSender()
  const budgeted = new BudgetedSmsSender(inner, redis as never, 'internal', { dailyTotal: 2, terminalDaily: 5 })
  await budgeted.sendPartnerPhoneRegisteredNotice('13800002001', '机构甲')
  await budgeted.sendPartnerPhoneRegisteredNotice('13800002002', '机构乙')
  await expectHttp(
    () => budgeted.sendPartnerPhoneRegisteredNotice('13800002003', '机构丙'),
    429,
    'SMS_DAILY_TOTAL_LIMIT',
    '今天的短信验证码发送量已达上限，请明天再试',
    '知会短信计入内部短信每日总量，第 3 条不再发送',
  )
  ensure(inner.notices.length === 2, '超额之后不能再把知会交给发送器')
  ensure(redis.raw(smsBudgetChannelKey('internal', day)) === '2', '内部桶计数停在上限')

  resetRedisCooldownForTests()
  const rejectRedis = new MemoryRedis()
  let calls = 0
  const rejecting = {
    async sendCode(): Promise<void> { /* 额度用例不发验证码 */ },
    async sendPartnerPhoneRegisteredNotice(): Promise<void> {
      calls += 1
      if (calls === 1) throw new SmsSendError('Rejected')
    },
  }
  const releasing = new BudgetedSmsSender(rejecting, rejectRedis as never, 'internal', { dailyTotal: 1, terminalDaily: 5 })
  let first = ''
  try {
    await releasing.sendPartnerPhoneRegisteredNotice('13800002004', '机构丁')
    first = 'ok'
  } catch (error) {
    first = error instanceof SmsSendError ? error.providerCode ?? error.message : 'other'
  }
  ensure(first === 'Rejected', '服务商明确拒发要原样抛出')
  ensure(rejectRedis.raw(smsBudgetChannelKey('internal', day)) === null, '明确拒发要退回内部短信额度')
  await releasing.sendPartnerPhoneRegisteredNotice('13800002005', '机构戊')
  ensure(rejectRedis.raw(smsBudgetChannelKey('internal', day)) === '1', '退回额度后下一条知会还能发送')
  pass('知会走现有短信额度：占桶、超额拒绝、明确拒发退回')
}

function prismaCli(): string {
  const candidates = [
    join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js'),
    join(apiRoot, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) fail(`找不到 Prisma CLI：${candidates.join(' , ')}`)
  return found
}

function deployIsolatedSqlite(): { databasePath: string; cleanup: () => void } {
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const directory = mkdtempSync(join(tmpdir(), 'verify-contact-phone-'))
  const databasePath = join(directory, 'verify.db')
  closeSync(openSync(databasePath, 'a'))
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  try {
    execFileSync(process.execPath, [prismaCli(), 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
    else process.env['DATABASE_URL'] = previousDatabaseUrl
    const err = error as { stderr?: string; stdout?: string; message?: string }
    fail(`prisma migrate deploy 失败：${(err.stderr || err.stdout || err.message || '').trim()}`)
  }
  return {
    databasePath,
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

async function withEnv(vars: Record<string, string | undefined>, operation: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await operation()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function main(): Promise<void> {
  process.env['NODE_ENV'] = process.env['NODE_ENV'] === 'production' ? 'test' : (process.env['NODE_ENV'] ?? 'test')
  ensure(process.env['SECRET_ENCRYPTION_KEY'] && process.env['SECRET_ENCRYPTION_KEY'].length >= 32, '缺少 SECRET_ENCRYPTION_KEY')
  ensure(process.env['JWT_SECRET'], '缺少 JWT_SECRET')
  ensure(process.env['REDIS_URL'], '缺少 REDIS_URL')
  assertSourceContract()
  await assertDtoRejectsForwarding()
  assertCooldownBoundary()
  await assertNoticeBudget()

  const isolated = deployIsolatedSqlite()
  const suffix = randomBytes(4).toString('hex')
  const namespace = `verify:contact-phone:${suffix}`
  process.env['PARTNER_ACCOUNT_ACTION_REDIS_NAMESPACE'] = namespace
  const phoneA = mobile(1)
  const phoneB = mobile(2)
  const phoneMismatch = mobile(3)
  const phoneTaken = mobile(4)
  const phoneCooldown = mobile(5)
  const phoneProdMissing = mobile(6)
  const phoneProdOk = mobile(7)
  const phoneCompensate = mobile(8)
  const phoneBoom = mobile(9)
  const phoneCreated = mobile(10)
  const phoneVerified = mobile(11)
  const phoneAdmin = mobile(12)
  const phoneStamp = mobile(13)
  const phoneOwn = mobile(14)
  const phoneCreateOrg = mobile(15)
  const ip = `w03-${suffix}`
  const adminId = `adm-${suffix}`
  const lockAdminId = `lock-${suffix}`
  const disabledAdminId = `admd-${suffix}`
  const orgA = `org-a-${suffix}`
  const orgB = `org-b-${suffix}`
  const orgMismatch = `org-mis-${suffix}`
  const orgEmpty = `org-empty-${suffix}`
  const orgLandline = `org-land-${suffix}`
  const orgCooldown = `org-cool-${suffix}`
  const orgTaken = `org-taken-${suffix}`
  const orgProdMissing = `org-pm-${suffix}`
  const orgProdOk = `org-po-${suffix}`
  const orgCompensate = `org-comp-${suffix}`
  const orgBoom = `org-boom-${suffix}`
  const orgStamp = `org-stamp-${suffix}`
  const orgOwn = `org-own-${suffix}`
  const orgOther = `org-other-${suffix}`
  const orgLock = `org-lock-${suffix}`
  const accountA = `acct-a-${suffix}`
  const accountB = `acct-b-${suffix}`
  const rawRedis = new Redis(process.env['REDIS_URL'], { maxRetriesPerRequest: 1 })
  let prisma: PrismaService | undefined
  try {
    ensure(await rawRedis.ping() === 'PONG', 'Redis 没有响应')
    prisma = new PrismaService()
    await prisma.onModuleInit()
    ensure(prisma.dbKind === 'sqlite', '隔离库不是 SQLite')
    const redis = new RedisService(rawRedis)
    const actionRedis = new PartnerAccountActionRedisService(rawRedis)
    const sms = new CapturingSmsSender()
    const failingSms = new FailingNoticeSender()
    const otp = new InternalOtpService(redis, sms)
    const audit = new AuditService(prisma)
    const boomAudit = new BoomAudit(prisma)
    const jwt = new JwtService({ secret: process.env['JWT_SECRET'] })
    const auth = new AuthService(jwt, prisma, redis, otp, audit)
    const orgs = new AdminOrgsService(prisma, audit, redis)
    const actions = new PartnerAccountActionService(prisma, redis, actionRedis, otp, orgs, audit)
    const registration = new PartnerContactPhoneRegistrationService(prisma, audit, actions, sms)
    const failingRegistration = new PartnerContactPhoneRegistrationService(prisma, audit, actions, failingSms)
    const boomRegistration = new PartnerContactPhoneRegistrationService(prisma, boomAudit, actions, sms)
    const admin = actor(adminId, `sess-${suffix}`)
    const lockAdmin = actor(lockAdminId, `locksess-${suffix}`)
    const [adminHash, lockHash, tempHash] = await Promise.all([
      bcrypt.hash(ADMIN_PASSWORD, 4),
      bcrypt.hash(LOCK_PASSWORD, 4),
      bcrypt.hash('TempPass1234', 4),
    ])

    const orgRows = [
      { id: orgA, name: '青岛\n就业中心', contactPhone: hyphen(phoneA) },
      { id: orgB, name: '机构乙', contactPhone: phoneB },
      { id: orgMismatch, name: '不一致机构', contactPhone: phoneMismatch },
      { id: orgEmpty, name: '未填手机机构', contactPhone: null },
      { id: orgLandline, name: '座机机构', contactPhone: '0532-88886666' },
      { id: orgCooldown, name: '冷却机构', contactPhone: phoneCooldown },
      { id: orgTaken, name: '占用机构', contactPhone: phoneTaken },
      { id: orgProdMissing, name: '缺模板机构', contactPhone: phoneProdMissing },
      { id: orgProdOk, name: '有模板机构', contactPhone: phoneProdOk },
      { id: orgCompensate, name: '补偿机构', contactPhone: phoneCompensate },
      { id: orgBoom, name: '审计机构', contactPhone: phoneBoom },
      { id: orgStamp, name: '戳记机构', contactPhone: hyphen(phoneStamp) },
      { id: orgOwn, name: '自管资料机构', contactPhone: null },
      { id: orgOther, name: '别的机构', contactPhone: phoneA },
      { id: orgLock, name: '锁机构', contactPhone: phoneA },
    ]
    await prisma.organization.createMany({
      data: orgRows.map((row) => ({ ...row, type: 'enterprise_source' })),
    })
    await prisma.user.createMany({
      data: [
        { id: adminId, username: `admin-${suffix}`, passwordHash: adminHash, name: '管理员', role: 'admin' },
        { id: lockAdminId, username: `lock-${suffix}`, passwordHash: lockHash, name: '锁管理员', role: 'admin' },
        { id: disabledAdminId, username: `admd-${suffix}`, passwordHash: adminHash, name: '停用管理员', role: 'admin', enabled: false },
        partner(accountA, `partner-a-${suffix}`, orgA, tempHash),
        partner(accountB, `partner-b-${suffix}`, orgB, tempHash),
        partner(`own-${suffix}`, `partner-own-${suffix}`, orgMismatch, tempHash, { passwordProofState: 'owner_managed' }),
        partner(`ver-${suffix}`, `partner-ver-${suffix}`, orgMismatch, tempHash, {
          phoneHash: hashPhone(phoneVerified), phoneEnc: encryptPhone(phoneVerified), phoneVerifiedAt: new Date(),
        }),
        partner(`leg-${suffix}`, `partner-leg-${suffix}`, orgMismatch, tempHash, { passwordProofState: 'legacy' }),
        partner(`dis-${suffix}`, `partner-dis-${suffix}`, orgMismatch, tempHash, { enabled: false }),
        partner(`oth-${suffix}`, `partner-oth-${suffix}`, orgOther, tempHash),
        partner(`adm-acct-${suffix}`, `partner-role-admin-${suffix}`, orgA, tempHash, { role: 'admin' }),
        partner(`created-${suffix}`, `partner-created-${suffix}`, orgA, tempHash, {
          phoneHash: hashPhone(phoneCreated), phoneEnc: encryptPhone(phoneCreated),
        }),
        partner(`mis-${suffix}`, `partner-mis-${suffix}`, orgMismatch, tempHash),
        partner(`empty-${suffix}`, `partner-empty-${suffix}`, orgEmpty, tempHash),
        partner(`land-${suffix}`, `partner-land-${suffix}`, orgLandline, tempHash),
        partner(`cool-${suffix}`, `partner-cool-${suffix}`, orgCooldown, tempHash),
        partner(`taken-target-${suffix}`, `partner-taken-${suffix}`, orgTaken, tempHash),
        partner(`taken-owner-${suffix}`, `partner-owner-deleted-${suffix}`, orgTaken, tempHash, {
          phoneHash: hashPhone(phoneTaken), phoneEnc: encryptPhone(phoneTaken), deletedAt: new Date(), enabled: false,
        }),
        partner(`prod-m-${suffix}`, `partner-prod-m-${suffix}`, orgProdMissing, tempHash),
        partner(`prod-o-${suffix}`, `partner-prod-o-${suffix}`, orgProdOk, tempHash),
        partner(`comp-${suffix}`, `partner-comp-${suffix}`, orgCompensate, tempHash),
        partner(`boom-${suffix}`, `partner-boom-${suffix}`, orgBoom, tempHash),
        partner(`ownp-${suffix}`, `partner-ownp-${suffix}`, orgOwn, tempHash),
        partner(`lockp-${suffix}`, `partner-lock-${suffix}`, orgLock, tempHash),
        partner(`locko-${suffix}`, `partner-lock-owner-${suffix}`, orgLock, tempHash, { passwordProofState: 'owner_managed' }),
        {
          id: `reset-admin-${suffix}`,
          username: `reset-admin-${suffix}`,
          passwordHash: adminHash,
          name: '未自证管理员',
          role: 'admin',
          passwordProofState: 'temporary',
          phoneHash: hashPhone(phoneAdmin),
          phoneEnc: encryptPhone(phoneAdmin),
          phoneVerifiedAt: null,
          phoneRegisteredByAdminAt: new Date(),
        },
      ],
    })
    pass('隔离库已用迁移建好，并放入机构与账号')

    const created = await orgs.createOrg({
      name: '新建不记冷却',
      type: 'enterprise_source',
      contactPhone: phoneCreateOrg,
    }, admin)
    const createdRow = await prisma.organization.findUniqueOrThrow({ where: { id: created.id } })
    ensure(createdRow.contactPhoneChangedAt === null, '新建机构即使填了联系人手机也不记变更时间')
    pass('新建机构不开始 24 小时冷却')

    await orgs.updateOrg(orgStamp, { name: '只改名称' }, admin)
    let stamp = await prisma.organization.findUniqueOrThrow({ where: { id: orgStamp } })
    ensure(stamp.contactPhoneChangedAt === null && stamp.contactPhone === hyphen(phoneStamp), '只改名称不动联系人手机')
    await orgs.updateOrg(orgStamp, { contactPhone: phoneStamp }, admin)
    stamp = await prisma.organization.findUniqueOrThrow({ where: { id: orgStamp } })
    ensure(stamp.contactPhoneChangedAt === null && stamp.contactPhone === phoneStamp, '只改空格或横线不算改号')
    await orgs.updateOrg(orgStamp, { contactPhone: mobile(40) }, admin)
    stamp = await prisma.organization.findUniqueOrThrow({ where: { id: orgStamp } })
    ensure(stamp.contactPhoneChangedAt instanceof Date, '规范化后的号码变了才记变更时间')
    const ownPartner: AuthedUser = { userId: `ownp-${suffix}`, role: 'partner', orgId: orgOwn, sessionId: `own-${suffix}` }
    await orgs.updateOwnProfile(ownPartner, { contactPhone: phoneOwn }, { headers: {}, ip })
    const ownRow = await prisma.organization.findUniqueOrThrow({ where: { id: orgOwn } })
    ensure(ownRow.contactPhoneChangedAt instanceof Date, '机构自己改联系人手机也记变更时间')
    const ownChangedAt = ownRow.contactPhoneChangedAt?.getTime()
    await orgs.updateOwnProfile(ownPartner, { contactPhone: hyphen(phoneOwn) }, { headers: {}, ip })
    const ownAgain = await prisma.organization.findUniqueOrThrow({ where: { id: orgOwn } })
    ensure(ownAgain.contactPhoneChangedAt?.getTime() === ownChangedAt, '机构自己只改格式时不刷新变更时间')
    pass('联系人手机变更时间只在号码真正改变时写入')

    const detailBefore = await orgs.getOrgDetail(orgA)
    const flags = Object.fromEntries(detailBefore.accounts.map((account) => [account.id, account.canRegisterContactPhone]))
    ensure(flags[accountA] === true, '临时密码且未绑手机时可以显示登记手机号')
    ensure(flags[`created-${suffix}`] === false, '创建账号时存过手机号、但不是这次登记的，不显示')
    ensure(flags[`dis-${suffix}`] === undefined, '停用账号不在机构甲')
    const mismatchDetail = await orgs.getOrgDetail(orgMismatch)
    const mismatchFlags = Object.fromEntries(mismatchDetail.accounts.map((account) => [account.id, account.canRegisterContactPhone]))
    ensure(mismatchFlags[`own-${suffix}`] === false, '已经自己管密码的不显示')
    ensure(mismatchFlags[`ver-${suffix}`] === false, '已经自证手机的不显示')
    ensure(mismatchFlags[`leg-${suffix}`] === false, '旧账号不显示')
    ensure(mismatchFlags[`dis-${suffix}`] === false, '停用账号不显示')
    pass('只有「临时密码且未绑手机」显示登记手机号')

    const register = (
      service: PartnerContactPhoneRegistrationService,
      orgId: string,
      accountId: string,
      phone: string,
      extras: { letter?: string; password?: string; who?: AuthedUser } = {},
    ) => service.register(orgId, accountId, {
      phone,
      confirmationLetterNo: extras.letter ?? LETTER,
      currentPassword: extras.password ?? ADMIN_PASSWORD,
    }, extras.who ?? admin)

    await expectHttp(
      () => register(registration, orgA, accountA, phoneA, { who: { ...admin, role: 'partner' } }),
      403, 'ADMIN_REQUIRED', '只有管理员可以登记机构联系人手机',
      '不是管理员不能登记',
    )
    await expectHttp(
      () => register(registration, orgA, accountA, phoneA, { who: actor(disabledAdminId, `sessd-${suffix}`) }),
      403, 'ADMIN_REQUIRED', '只有管理员可以登记机构联系人手机',
      '已停用的管理员不能登记',
    )
    await expectHttp(
      () => register(registration, orgA, accountA, '01012345678'),
      400, 'VALIDATION_FAILED', '请填写中国大陆手机号',
      '座机和非法号码不能当手机号登记',
    )
    await expectHttp(
      () => register(registration, orgA, accountA, phoneA, { letter: '中文函' }),
      400, 'VALIDATION_FAILED', '确认函编号应为 4 到 64 位字母、数字、横线或斜线',
      '确认函编号只接受字母、数字、横线和斜线',
    )
    await expectHttp(
      () => register(registration, orgA, accountA, phoneA, { password: '' }),
      400, 'VALIDATION_FAILED', '请填写管理员本人密码',
      '没填管理员密码时直接拒绝',
    )

    await expectHttp(
      () => register(registration, orgMismatch, `own-${suffix}`, phoneMismatch),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '已经自己管密码的不能登记',
    )
    await expectHttp(
      () => register(registration, orgMismatch, `ver-${suffix}`, phoneMismatch),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '已经自证手机的不能登记',
    )
    await expectHttp(
      () => register(registration, orgMismatch, `leg-${suffix}`, phoneMismatch),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '旧账号不能登记',
    )
    await expectHttp(
      () => register(registration, orgA, `adm-acct-${suffix}`, phoneA),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '管理员账号不能登记',
    )
    await expectHttp(
      () => register(registration, orgA, `oth-${suffix}`, phoneA),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '别的机构的账号不能登记',
    )
    await expectHttp(
      () => register(registration, orgMismatch, `dis-${suffix}`, phoneMismatch),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '已停用账号不能登记',
    )
    await expectHttp(
      () => register(registration, orgA, `created-${suffix}`, phoneCreated),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '创建时存过手机号、尚未按确认函登记的不能登记',
    )
    await expectHttp(
      () => register(registration, orgA, `missing-${suffix}`, phoneA),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '找不到的账号按不能登记处理',
    )
    await expectHttp(
      () => register(registration, `org-missing-${suffix}`, accountA, phoneA),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '找不到的机构按不能登记处理',
    )
    await expectHttp(
      () => register(registration, orgTaken, `taken-owner-${suffix}`, phoneTaken),
      409, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号',
      '已删除账号不能登记',
    )

    await expectHttp(
      () => register(registration, orgMismatch, `mis-${suffix}`, mobile(31)),
      400, 'CONTACT_PHONE_MISMATCH', '手机号和机构确认函上登记的联系人手机不一致，请先核对机构资料',
      '手机号和机构联系人手机不一致',
    )
    await expectHttp(
      () => register(registration, orgEmpty, `empty-${suffix}`, phoneA),
      400, 'CONTACT_PHONE_MISMATCH', '手机号和机构确认函上登记的联系人手机不一致，请先核对机构资料',
      '机构没填联系人手机',
    )
    await expectHttp(
      () => register(registration, orgLandline, `land-${suffix}`, phoneA),
      400, 'CONTACT_PHONE_MISMATCH', '手机号和机构确认函上登记的联系人手机不一致，请先核对机构资料',
      '机构联系人是座机时不能登记手机号',
    )
    const mismatchRow = await prisma.user.findUniqueOrThrow({ where: { id: `mis-${suffix}` } })
    ensure(mismatchRow.phoneHash === null && mismatchRow.phoneRegisteredByAdminAt === null, '不一致时不能把号码写进去')

    await prisma.organization.update({ where: { id: orgCooldown }, data: { contactPhoneChangedAt: new Date() } })
    await expectHttp(
      () => register(registration, orgCooldown, `cool-${suffix}`, phoneCooldown),
      409, 'CONTACT_PHONE_RECENTLY_CHANGED', '机构联系人手机 24 小时内改过，请过 24 小时再登记',
      '机构联系人手机 24 小时内改过',
    )
    const cooledEarly = await prisma.user.findUniqueOrThrow({ where: { id: `cool-${suffix}` } })
    ensure(cooledEarly.phoneHash === null, '冷却期内不能把号码写进去')
    await prisma.organization.update({
      where: { id: orgCooldown },
      data: { contactPhoneChangedAt: new Date(Date.now() - CONTACT_PHONE_CHANGE_COOLDOWN_MS - 60_000) },
    })
    const cooled = await register(registration, orgCooldown, `cool-${suffix}`, phoneCooldown, { letter: 'QD-2026/090' })
    ensure(cooled.phoneMasked === maskPhone(phoneCooldown), '满 24 小时后可以登记')
    pass('满 24 小时后同一机构可以登记')

    let takenError = ''
    try {
      await register(registration, orgTaken, `taken-target-${suffix}`, phoneTaken)
    } catch (error) {
      const http = httpOf(error)
      takenError = JSON.stringify(http)
      ensure(http.status === 409 && http.code === 'PHONE_IN_USE' && http.message === '这个手机号已被其他账号使用', '号码被占用')
    }
    ensure(takenError.includes('PHONE_IN_USE'), '占用时返回 PHONE_IN_USE')
    ensure(takenError.includes(`partner-owner-deleted-${suffix}`) === false, '占用时不透露是哪个账号')
    pass('手机号已被其他账号使用时不透露是谁')

    await withEnv({ NODE_ENV: 'production', SMS_TEMPLATE_PARTNER_PHONE_REGISTERED: undefined }, async () => {
      await expectHttp(
        () => register(registration, orgProdMissing, `prod-m-${suffix}`, phoneProdMissing),
        503, 'CONTACT_PHONE_NOTICE_UNAVAILABLE', '知会短信暂时发不出，暂不能登记',
        '生产环境没配知会模板',
      )
    })
    const prodMissingRow = await prisma.user.findUniqueOrThrow({ where: { id: `prod-m-${suffix}` } })
    ensure(prodMissingRow.phoneHash === null && prodMissingRow.phoneRegisteredByAdminAt === null, '知会发不出时不能先把号码写进去')
    const prodMissingAudits = await auditsFor(prisma, `prod-m-${suffix}`)
    ensure(prodMissingAudits.length === 0, '知会发不出时不写登记审计')

    const noticesBeforeProd = sms.notices.length
    await withEnv({ NODE_ENV: 'production', SMS_TEMPLATE_PARTNER_PHONE_REGISTERED: 'notice-template-1' }, async () => {
      const produced = await register(registration, orgProdOk, `prod-o-${suffix}`, phoneProdOk)
      ensure(produced.phoneMasked === maskPhone(phoneProdOk), '生产环境配了知会模板就可以登记')
    })
    ensure(sms.notices.length === noticesBeforeProd + 1, '配了模板后知会要发出去')
    pass('生产环境只在知会模板已配置时登记')

    const compensatedFirst = await register(registration, orgCompensate, `comp-${suffix}`, phoneCompensate, { letter: 'HF-1' })
    ensure(compensatedFirst.accountId === `comp-${suffix}`, '补偿用例先登记成功')
    await expectHttp(
      () => failingRegistration.register(orgCompensate, `comp-${suffix}`, {
        phone: phoneCompensate, confirmationLetterNo: 'HF-2', currentPassword: ADMIN_PASSWORD,
      }, admin),
      503, 'CONTACT_PHONE_NOTICE_UNAVAILABLE', '知会短信暂时发不出，暂不能登记',
      '知会发送失败',
    )
    const compensated = await prisma.user.findUniqueOrThrow({ where: { id: `comp-${suffix}` } })
    ensure(compensated.phoneHash === null && compensated.phoneEnc === null && compensated.phoneRegisteredByAdminAt === null, '知会失败后清掉这次登记，不留着上一次的号码')
    const revertAudits = (await auditsFor(prisma, `comp-${suffix}`)).filter((row) => row.action === 'partner_account.contact_phone_registration_reverted')
    ensure(revertAudits.length === 1, '知会失败要写回滚审计')
    const revertPayload = JSON.parse(revertAudits[0]?.payloadJson ?? '{}') as { confirmationLetterNo?: string }
    ensure(revertPayload.confirmationLetterNo === 'HF-2', '回滚审计记下这次确认函编号')
    ensure(JSON.stringify(revertAudits).includes(phoneCompensate) === false, '回滚审计不写明文手机号')

    try {
      await boomRegistration.register(orgBoom, `boom-${suffix}`, {
        phone: phoneBoom, confirmationLetterNo: LETTER, currentPassword: ADMIN_PASSWORD,
      }, admin)
      fail('审计写失败时登记不该成功')
    } catch (error) {
      ensure(error instanceof Error && error.message === 'audit boom', '审计写失败要让登记一起失败')
    }
    const boomRow = await prisma.user.findUniqueOrThrow({ where: { id: `boom-${suffix}` } })
    ensure(boomRow.phoneHash === null && boomRow.phoneRegisteredByAdminAt === null, '审计失败时号码不能留下')
    ensure((await auditsFor(prisma, `boom-${suffix}`)).length === 0, '审计失败时登记审计也不能留下')
    pass('登记审计和号码在同一事务里，失败一起撤回')

    await expectHttp(
      () => register(registration, orgLock, `lockp-${suffix}`, phoneA, { password: '', who: lockAdmin }),
      400, 'VALIDATION_FAILED', '请填写管理员本人密码',
      '空密码不进入失败锁',
    )
    await expectHttp(
      () => register(registration, orgLock, `lockp-${suffix}`, phoneA, { password: 'a'.repeat(73), who: lockAdmin }),
      400, 'VALIDATION_FAILED', '请填写管理员本人密码',
      '过长密码不进入失败锁',
    )
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expectHttp(
        () => register(registration, orgLock, `lockp-${suffix}`, phoneA, { password: `wrong-${attempt}`, who: lockAdmin }),
        422, 'ADMIN_CREDENTIAL_INVALID', '管理员本人密码不正确',
        `管理员密码错误第 ${attempt} 次`,
      )
    }
    await expectHttp(
      () => actions.createChallenge(lockAdmin, orgLock, `locko-${suffix}`, {
        action: 'delete_account', verifyMethod: 'password', adminCurrentPassword: 'still-wrong',
      }, { ip }),
      429, 'ADMIN_CREDENTIAL_LOCKED', '管理员密码尝试次数过多，请稍后再试',
      '第 5 次错误和机构账号操作共用同一把锁',
    )

    const noticesBefore = sms.notices.length
    const codesBefore = sms.codes.length
    const registered = await registration.register(orgA, accountA, {
      phone: hyphen(phoneA),
      confirmationLetterNo: 'QD 2026 / 091',
      currentPassword: ADMIN_PASSWORD,
    }, admin)
    ensure(registered.accountId === accountA, '返回账号')
    ensure(registered.phoneMasked === maskPhone(phoneA), '返回打码手机号')
    ensure(Number.isNaN(Date.parse(registered.registeredAt)) === false, '返回登记时间')
    assertNoSecrets(registered, [phoneA], '登记成功结果')
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: accountA } })
    ensure(stored.phoneHash === hashPhone(phoneA), '按规范化号码保存查找键')
    ensure(decryptPhone(stored.phoneEnc ?? '') === phoneA, '加密号码可以在服务端解开')
    ensure(stored.phoneVerifiedAt === null && stored.phoneRegisteredByAdminAt instanceof Date, '登记后仍未自证')
    ensure(stored.passwordProofState === PASSWORD_PROOF_STATE.TEMPORARY, '登记本身不把密码变成自己管理')
    const registeredAudits = (await auditsFor(prisma, accountA)).filter((row) => row.action === 'partner_account.contact_phone_registered')
    ensure(registeredAudits.length === 1, '登记写一行审计')
    const registeredPayload = JSON.parse(registeredAudits[0]?.payloadJson ?? '{}') as {
      orgId?: string; accountId?: string; phoneMasked?: string; confirmationLetterNo?: string
    }
    ensure(registeredAudits[0]?.actorId === adminId, '审计操作人是这次的管理员')
    ensure(registeredPayload.orgId === orgA && registeredPayload.accountId === accountA, '审计记下机构和账号')
    ensure(registeredPayload.phoneMasked === maskPhone(phoneA) && registeredPayload.confirmationLetterNo === 'QD2026/091', '审计有打码号码和确认函编号')
    ensure(JSON.stringify(registeredAudits).includes(phoneA) === false, '审计不写明文手机号')
    const notice = sms.notices[sms.notices.length - 1]
    ensure(sms.notices.length === noticesBefore + 1 && notice?.phone === phoneA, '知会发到登记的号码')
    ensure(notice?.text === '平台管理员已为『青岛 就业中心』机构账号登记本手机号，用于找回密码。如非本机构操作，请联系平台客服。', '知会说明是管理员登记、用于找回密码')
    ensure(/\d{6}/.test(notice?.text ?? '') === false, '知会里没有验证码')
    const detailAfter = await orgs.getOrgDetail(orgA)
    ensure(detailAfter.accounts.find((account) => account.id === accountA)?.canRegisterContactPhone === true, '尚未自证时仍可显示登记手机号')
    const viewAfter = detailAfter.accounts.find((account) => account.id === accountA)
    ensure(viewAfter?.passwordProofState === 'temporary' && typeof viewAfter.phoneRegisteredByAdminAt === 'string', '后台列表：已登记待自证时带 passwordProofState=temporary 与登记时间')
    const again = await register(registration, orgA, accountA, phoneA, { letter: 'QD-2026/092' })
    ensure(again.phoneMasked === maskPhone(phoneA), '同一个号码可以改登记')
    ensure((await auditsFor(prisma, accountA)).filter((row) => row.action === 'partner_account.contact_phone_registered').length === 2, '改登记再写一行审计')
    ensure(await actionRedis.getAdminRecentVerification(adminId, admin.sessionId ?? '') === null, '登记成功不记成管理员最近已验证')
    pass('管理员登记成功：审计有确认函编号、知会发给本人、号码可改登记')

    const loginResult = await auth.sendSmsCode({ phone: phoneA, purpose: 'login', portal: 'partner' }, ip)
    assertNoSecrets(loginResult, [phoneA], '登录验证码结果')
    ensure(sms.codes.filter((item) => item.phone === phoneA).length === codesBefore, '还没自证时登录验证码不发给这个号码')
    await expectHttp(
      () => actions.createChallenge(admin, orgA, accountA, {
        action: 'delete_account', verifyMethod: 'password', adminCurrentPassword: ADMIN_PASSWORD,
      }, { ip }),
      422, 'ACCOUNT_ACTION_METHOD_UNAVAILABLE', '当前验证方式不可用',
      '还是临时密码时不能用密码做机构自管操作',
    )

    // 登录发码即使不真正发出，也会占住这个号码 60 秒冷却。清掉只为接着测找回密码。
    await redis.del(`internal:sms:cooldown:global:${hashPhone(phoneA)}`)
    const resetStart = await auth.startPasswordReset(`partner-a-${suffix}`, ip)
    const resetCode = onlyCode(sms, phoneA)
    assertNoSecrets(resetStart, [resetCode, phoneA], '找回密码开始结果')
    const resetVerify = await auth.verifyPasswordReset(`partner-a-${suffix}`, resetCode, ip)
    assertNoSecrets(resetVerify, [resetCode, phoneA], '找回密码核对结果')
    const resetComplete = await auth.completePasswordReset(resetVerify.resetTicket, NEW_PASSWORD, ip)
    assertNoSecrets(resetComplete, [resetCode, phoneA], '找回密码完成结果')
    const proved = await prisma.user.findUniqueOrThrow({ where: { id: accountA } })
    ensure(proved.passwordProofState === PASSWORD_PROOF_STATE.OWNER_MANAGED, '找回密码成功后密码归本人管理')
    ensure(proved.phoneVerifiedAt instanceof Date && proved.phoneRegisteredByAdminAt === null, '找回密码成功后手机号算本人自证')
    ensure(await bcrypt.compare(NEW_PASSWORD, proved.passwordHash), '新密码已经生效')
    const detailProved = await orgs.getOrgDetail(orgA)
    ensure(detailProved.accounts.find((account) => account.id === accountA)?.canRegisterContactPhone === false, '自证之后不再显示登记手机号')
    const viewProved = detailProved.accounts.find((account) => account.id === accountA)
    ensure(viewProved?.passwordProofState === 'owner_managed' && viewProved.phoneRegisteredByAdminAt === null, '后台列表：自证后 passwordProofState=owner_managed、登记时间清空')
    const challenge = await actions.createChallenge(admin, orgA, accountA, {
      action: 'delete_account', verifyMethod: 'password', adminCurrentPassword: ADMIN_PASSWORD,
    }, { ip })
    const verifiedAction = await actions.verifyChallenge(admin, orgA, accountA, challenge.challengeId, { currentPassword: NEW_PASSWORD })
    ensure(typeof verifiedAction.actionTicket === 'string' && verifiedAction.actionTicket.length > 0, '自证之后可以用新密码完成机构自管操作')
    pass('本人用用户名找回密码后，手机号自证，并能完成机构自管操作')

    await register(registration, orgB, accountB, phoneB, { letter: 'QD-2026/093' })
    const phoneStart = await auth.startPasswordReset(phoneB, ip)
    const phoneCode = onlyCode(sms, phoneB)
    assertNoSecrets(phoneStart, [phoneCode, phoneB], '按手机号找回的开始结果')
    const phoneVerify = await auth.verifyPasswordReset(hyphen(phoneB), phoneCode, ip)
    assertNoSecrets(phoneVerify, [phoneCode], '按手机号找回的核对结果')
    await auth.completePasswordReset(phoneVerify.resetTicket, NEW_PASSWORD, ip)
    const provedB = await prisma.user.findUniqueOrThrow({ where: { id: accountB } })
    ensure(provedB.passwordProofState === PASSWORD_PROOF_STATE.OWNER_MANAGED && provedB.phoneVerifiedAt instanceof Date && provedB.phoneRegisteredByAdminAt === null, '按手机号找回同样完成自证')
    pass('本人用手机号找回密码后同样完成自证')

    const adminCodesBefore = sms.codes.filter((item) => item.phone === phoneAdmin).length
    const adminByName = await auth.startPasswordReset(`reset-admin-${suffix}`, ip)
    const adminByPhone = await auth.startPasswordReset(phoneAdmin, ip)
    assertNoSecrets(adminByName, [phoneAdmin], '管理员按用户名找回的结果')
    assertNoSecrets(adminByPhone, [phoneAdmin], '管理员按手机号找回的结果')
    ensure(sms.codes.filter((item) => item.phone === phoneAdmin).length === adminCodesBefore, '管理员没自证手机时找回密码不发验证码')
    ensure(/\d{6}/.test(JSON.stringify(adminByName)) === false && /\d{6}/.test(JSON.stringify(adminByPhone)) === false, '管理员找回结果里没有验证码')
    pass('管理员账号没有自证手机时，找回密码仍然不发验证码')

    console.log(`verify-partner-contact-phone-registration: ${passes} PASS`)
  } finally {
    if (prisma) await prisma.onModuleDestroy().catch(() => undefined)
    const keys = await rawRedis.keys(`${namespace}:*`).catch(() => [])
    if (keys.length > 0) await rawRedis.del(...keys).catch(() => undefined)
    await rawRedis.quit().catch(() => undefined)
    isolated.cleanup()
  }
}

function partner(
  id: string,
  username: string,
  orgId: string,
  passwordHash: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    username,
    passwordHash,
    name: username,
    role: 'partner',
    orgId,
    passwordProofState: PASSWORD_PROOF_STATE.TEMPORARY,
    enabled: true,
    ...extra,
  }
}

async function auditsFor(prisma: PrismaService, accountId: string): Promise<Array<{ action: string; actorId: string | null; payloadJson: string }>> {
  const rows = await prisma.auditLog.findMany({ select: { action: true, actorId: true, payloadJson: true } })
  return rows.filter((row) => row.payloadJson.includes(accountId))
}

function onlyCode(sms: CapturingSmsSender, phone: string): string {
  const hits = sms.codes.filter((item) => item.phone === phone)
  ensure(hits.length === 1 && /^\d{6}$/.test(hits[0]?.code ?? ''), '验证码只应发给本人一次')
  return hits[0]?.code ?? ''
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
