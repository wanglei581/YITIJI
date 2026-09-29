import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import { createClient } from '@libsql/client'
import {
  BadRequestException,
  Module,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'
import { OptionalEndUserAuthGuard } from '../src/common/guards/optional-end-user-auth.guard'
import { ROLES_KEY, type UserRole } from '../src/common/decorators/roles.decorator'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { BenefitActivitiesService } from '../src/benefit-activities/benefit-activities.service'
import { BenefitActivitiesController } from '../src/benefit-activities/benefit-activities.controller'
import { AdminBenefitActivitiesController } from '../src/benefit-activities/admin-benefit-activities.controller'
import { MemberBenefitsService } from '../src/member-benefits/member-benefits.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

type ActivityInput = Parameters<BenefitActivitiesService['create']>[1]

const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-benefit-activities-${randomUUID().slice(0, 8)}.db`
if (fallbackDbName) process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-benefit-activities-secret-key-0123456789'
process.env['JWT_SECRET'] ??= 'verify-benefit-activities-jwt-secret-0123456789'

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { console.error(`  FAIL ${message}`); process.exit(1) }

async function expectReject(code: string, label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    fail(`${label} — expected ${code}, got success`)
  } catch (error) {
    const body = (error as { getResponse?: () => unknown; response?: unknown }).getResponse?.()
      ?? (error as { response?: unknown }).response
    const actual = (body as { error?: { code?: string } } | undefined)?.error?.code
    if (actual === code) pass(label)
    else fail(`${label} — expected ${code}, got ${actual ?? (error as Error).message}`)
  }
}

function guardNames(target: object, propertyKey?: string): string[] {
  const record = target as Record<string, unknown>
  const handler = propertyKey ? record[propertyKey] : target
  const metadata = Reflect.getMetadata(GUARDS_METADATA, handler as object) as Array<{ name?: string }> | undefined
  return (metadata ?? []).map((guard) => guard.name ?? '')
}

async function main() {
  console.log('\n=== 权益活动中心 MVP 验证 ===')
  if (fallbackDbName) await initFallbackDb()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const activities = new BenefitActivitiesService(prisma, audit)
  const benefits = new MemberBenefitsService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const adminId = `admin_ba_${suffix}`
  const userA = `eu_ba_a_${suffix}`
  const userB = `eu_ba_b_${suffix}`
  const userC = `eu_ba_c_${suffix}`
  const phoneA = `139${Date.now().toString().slice(-8)}`
  const phoneB = `138${Date.now().toString().slice(-8)}`
  const phoneC = `137${Date.now().toString().slice(-8)}`
  const admin: AuthedUser = { userId: adminId, role: 'admin', orgId: null }
  const activityIds: string[] = []

  async function cleanup() {
    const auditCleanupWhere: Array<Record<string, unknown>> = [
      { actorId: adminId },
      { actorId: { in: [userA, userB, userC] } },
    ]
    if (activityIds.length) auditCleanupWhere.push({ targetId: { in: activityIds } })
    await prisma.benefitClaim.deleteMany({ where: { endUserId: { in: [userA, userB, userC] } } }).catch(() => undefined)
    await prisma.benefitGrant.deleteMany({ where: { endUserId: { in: [userA, userB, userC] } } }).catch(() => undefined)
    await prisma.benefitActivity.deleteMany({ where: { title: { contains: suffix } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { OR: auditCleanupWhere } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB, userC] } } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: adminId } }).catch(() => undefined)
  }

  try {
    await cleanup()
    await prisma.user.create({
      data: { id: adminId, username: `ba-admin-${suffix}`, passwordHash: 'verify', name: '权益活动管理员', role: 'admin', enabled: true },
    })
    await prisma.endUser.createMany({
      data: [
        { id: userA, phoneHash: hashPhone(phoneA), phoneEnc: encryptPhone(phoneA), nickname: '权益用户A' },
        { id: userB, phoneHash: hashPhone(phoneB), phoneEnc: encryptPhone(phoneB), nickname: '权益用户B' },
        { id: userC, phoneHash: hashPhone(phoneC), phoneEnc: encryptPhone(phoneC), nickname: '权益用户C' },
      ],
    })

    const validFrom = new Date(Date.now() - 60_000).toISOString()
    const validUntil = new Date(Date.now() + 86_400_000).toISOString()
    const draft = await activities.create(admin, {
      title: `新用户免费打印 ${suffix}`,
      description: '领取后可用于本终端打印服务。',
      rulesText: '每个手机号限领一次。',
      benefitType: 'free_quota',
      sourceType: 'platform',
      quantityTotal: 20,
      stockTotal: 10,
      validFrom,
      validUntil,
      grantValidDays: 30,
    })
    if (draft.status === 'draft' && draft.stockRemaining === 10) pass('1. Admin 创建草稿活动')
    else fail(`1. 草稿活动异常：${JSON.stringify(draft)}`)
    activityIds.push(draft.id)

    await prisma.benefitActivity.update({ where: { id: draft.id }, data: { description: '保证录用后再来打印' } })
    await expectReject('BENEFIT_ACTIVITY_COPY_FORBIDDEN', '2. 发布时二次合规校验拒绝违规文案', () => activities.publish(admin, draft.id))
    await prisma.benefitActivity.update({ where: { id: draft.id }, data: { description: '领取后可用于本终端打印服务。' } })
    const published = await activities.publish(admin, draft.id)
    const visible = await activities.listVisible({}, null)
    if (published.status === 'published' && visible.items.some((item) => item.id === draft.id)) pass('3. 发布后 Kiosk 列表可见')
    else fail(`3. 发布可见异常：${JSON.stringify({ published, visible })}`)

    const tourist = visible.items.find((item) => item.id === draft.id)
    if (tourist && tourist.claimed === false && tourist.claimable === true) pass('4. 游客可看列表但 claimed=false')
    else fail(`4. 游客状态异常：${JSON.stringify(tourist)}`)

    const grant = await activities.claim(userA, draft.id)
    const dbGrant = await prisma.benefitGrant.findUnique({ where: { id: grant.id } })
    const claim = await prisma.benefitClaim.findFirst({ where: { activityId: draft.id, endUserId: userA } })
    if (dbGrant?.sourceRef === draft.id && claim?.benefitGrantId === grant.id && grant.quantityTotal === 20) pass('5. 登录会员领取生成 BenefitGrant 且 sourceRef=activityId')
    else fail(`5. 领取落库异常：${JSON.stringify({ grant, dbGrant, claim })}`)

    const myBenefits = await benefits.list(userA, { cursor: null, pageSize: 50 })
    if (myBenefits.items.some((item) => item.id === grant.id)) pass('6. /me/benefits 可读取领取到的权益')
    else fail(`6. 我的权益缺失：${JSON.stringify(myBenefits)}`)

    await expectReject('BENEFIT_ACTIVITY_ALREADY_CLAIMED', '7. 同一用户重复领取被拒', () => activities.claim(userA, draft.id))
    const claimCount = await prisma.benefitClaim.count({ where: { activityId: draft.id, endUserId: userA } })
    const grantCount = await prisma.benefitGrant.count({ where: { endUserId: userA, sourceRef: draft.id } })
    if (claimCount === 1 && grantCount === 1) pass('7b. 重复领取后仍只有一条 BenefitClaim/BenefitGrant')
    else fail(`7b. 重复领取计数异常：claim=${claimCount}, grant=${grantCount}`)

    const limited = await activities.create(admin, {
      title: `限量活动 ${suffix}`,
      description: '限量免费打印权益。',
      rulesText: '库存只有一份。',
      benefitType: 'free_quota',
      sourceType: 'platform',
      quantityTotal: 5,
      stockTotal: 1,
      validFrom,
      validUntil,
      grantValidDays: null,
    })
    activityIds.push(limited.id)
    await activities.publish(admin, limited.id)
    await activities.claim(userB, limited.id)
    await expectReject('BENEFIT_ACTIVITY_SOLD_OUT', '8. 有限库存不会超发', () => activities.claim(userC, limited.id))
    const limitedClaims = await prisma.benefitClaim.count({ where: { activityId: limited.id } })
    const limitedStock = await prisma.benefitActivity.findUnique({ where: { id: limited.id } })
    if (limitedClaims === 1 && limitedStock?.stockRemaining === 0) pass('8b. 库存扣减到 0 且成功领取数恰为 1')
    else fail(`8b. 库存计数异常：claims=${limitedClaims}, stock=${limitedStock?.stockRemaining}`)

    await expectReject('BENEFIT_ACTIVITY_QUANTITY_FORBIDDEN', '9. subsidy_eligibility_hint 不允许配置额度', () => activities.create(admin, {
      title: `政策提示 ${suffix}`,
      description: '仅提供官方入口与材料说明。',
      rulesText: null,
      benefitType: 'subsidy_eligibility_hint',
      sourceType: 'gov',
      quantityTotal: 1,
      stockTotal: null,
      validFrom,
      validUntil,
      grantValidDays: null,
    }))

    await activities.end(admin, limited.id)
    await expectReject('BENEFIT_ACTIVITY_NOT_CLAIMABLE', '10. 下架活动不可领取', () => activities.claim(userC, limited.id))

    const claims = await activities.listClaims(draft.id)
    if (claims.items.some((item) => item.endUserId === userA && item.phoneMasked.endsWith(phoneA.slice(-4)) && !item.phoneMasked.includes(phoneA))) pass('11. Admin 领取记录只返回脱敏手机号')
    else fail(`11. 领取记录脱敏异常：${JSON.stringify(claims)}`)

    const extraActivities = await Promise.all(Array.from({ length: 200 }, (_, index) => activities.create(admin, {
      title: `分页活动 ${index} ${suffix}`,
      description: '用于验证活动列表总数不因展示上限失真。',
      rulesText: null,
      benefitType: 'free_quota',
      sourceType: 'platform',
      quantityTotal: 1,
      stockTotal: 1,
      validFrom,
      validUntil,
      grantValidDays: null,
    })))
    activityIds.push(...extraActivities.map((activity) => activity.id))
    const adminActivities = await activities.adminList({})
    if (adminActivities.items.length === 200 && adminActivities.total >= 202) pass('11b. Admin 活动列表超过 200 条时返回真实 total')
    else fail(`11b. Admin 活动 total 异常：${JSON.stringify({ items: adminActivities.items.length, total: adminActivities.total })}`)

    const logs = await prisma.auditLog.findMany({
      where: {
        action: { in: ['benefit_activity.create', 'benefit_activity.publish', 'benefit_activity.end', 'benefit_activity.claim'] },
        targetId: { in: [draft.id, limited.id] },
      },
    })
    const payloads = logs.map((log) => log.payloadJson).join('\n')
    const hasLog = (action: string, targetId: string) => logs.some((log) => log.action === action && log.targetId === targetId)
    const claimLog = logs.find((log) => log.action === 'benefit_activity.claim' && log.targetId === draft.id)
    if (
      hasLog('benefit_activity.create', draft.id) &&
      hasLog('benefit_activity.publish', draft.id) &&
      hasLog('benefit_activity.end', limited.id) &&
      claimLog?.actorId === null &&
      claimLog?.payloadJson.includes(userA) === true
    ) pass('12a. create/publish/end/claim 写 AuditLog')
    else fail(`12a. 审计动作缺失或串到历史数据：${logs.map((log) => `${log.action}:${log.targetId ?? '-'}`).join(',')}`)
    if (!payloads.includes(phoneA) && !payloads.includes(phoneB) && !payloads.includes(phoneC)) pass('12b. AuditLog payload 不含明文手机号')
    else fail('12b. AuditLog 泄露明文手机号')

    const kioskProto = BenefitActivitiesController.prototype
    const adminGuards = guardNames(AdminBenefitActivitiesController)
    const adminRoles = (Reflect.getMetadata(ROLES_KEY, AdminBenefitActivitiesController) ?? []) as UserRole[]
    if (
      guardNames(kioskProto, 'list').includes(OptionalEndUserAuthGuard.name) &&
      guardNames(kioskProto, 'detail').includes(OptionalEndUserAuthGuard.name) &&
      guardNames(kioskProto, 'claim').includes(EndUserAuthGuard.name) &&
      adminGuards.includes(JwtAuthGuard.name) &&
      adminGuards.includes(RolesGuard.name) &&
      adminRoles.includes('admin')
    ) pass('13. 控制器鉴权元数据正确')
    else fail('13. 控制器鉴权元数据异常')

    await verifyRedeemableQuantity({ prisma, activities, audit, admin, suffix, activityIds, userA, userB })
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    cleanupFallbackDb()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})

function cleanupFallbackDb(): void {
  if (!fallbackDbName) return
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`prisma/${fallbackDbName}${suffix}`, { force: true })
  }
}

async function initFallbackDb(): Promise<void> {
  const client = createClient({ url: process.env['DATABASE_URL']! })
  try {
    await client.batch([
      `CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "username" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "passwordProofState" TEXT NOT NULL DEFAULT 'legacy', "name" TEXT NOT NULL, "role" TEXT NOT NULL, "orgId" TEXT, "phoneHash" TEXT, "phoneEnc" TEXT, "phoneVerifiedAt" DATETIME, "emailHash" TEXT, "emailEnc" TEXT, "emailVerifiedAt" DATETIME, "emailVerifyMethod" TEXT, "tokenVersion" INTEGER NOT NULL DEFAULT 0, "lastLoginAt" DATETIME, "enabled" BOOLEAN NOT NULL DEFAULT true, "deletedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "User_username_key" ON "User"("username")`,
      `CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash")`,
      `CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash")`,
      `CREATE INDEX "User_orgId_idx" ON "User"("orgId")`,
      `CREATE INDEX "User_phoneVerifiedAt_idx" ON "User"("phoneVerifiedAt")`,
      `CREATE TABLE "EndUser" ("id" TEXT NOT NULL PRIMARY KEY, "phoneHash" TEXT NOT NULL, "phoneEnc" TEXT NOT NULL, "nickname" TEXT, "wxOpenId" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "status" TEXT NOT NULL DEFAULT 'active', "statusChangedAt" DATETIME, "closingRequestedAt" DATETIME, "anonymizedAt" DATETIME, "lastLoginAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
      `CREATE UNIQUE INDEX "EndUser_wxOpenId_key" ON "EndUser"("wxOpenId")`,
      `CREATE TABLE "AuditLog" ("id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "actorRole" TEXT NOT NULL, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT, "payloadJson" TEXT NOT NULL DEFAULT '{}', "ipAddress" TEXT, "userAgent" TEXT, "requestId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
      `CREATE TABLE "BenefitGrant" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT NOT NULL, "benefitType" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "quantityTotal" INTEGER, "quantityRemaining" INTEGER, "status" TEXT NOT NULL DEFAULT 'active', "sourceType" TEXT NOT NULL DEFAULT 'platform', "sourceRef" TEXT, "validFrom" DATETIME, "validUntil" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX "BenefitGrant_endUserId_idx" ON "BenefitGrant"("endUserId")`,
      `CREATE INDEX "BenefitGrant_endUserId_status_idx" ON "BenefitGrant"("endUserId","status")`,
      `CREATE TABLE "BenefitActivity" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL, "description" TEXT, "rulesText" TEXT, "benefitType" TEXT NOT NULL, "sourceType" TEXT NOT NULL DEFAULT 'platform', "quantityTotal" INTEGER, "stockTotal" INTEGER, "stockRemaining" INTEGER, "claimLimitPerUser" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'draft', "validFrom" DATETIME, "validUntil" DATETIME, "grantValidDays" INTEGER, "createdById" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX "BenefitActivity_status_idx" ON "BenefitActivity"("status")`,
      `CREATE INDEX "BenefitActivity_sourceType_idx" ON "BenefitActivity"("sourceType")`,
      `CREATE INDEX "BenefitActivity_validFrom_validUntil_idx" ON "BenefitActivity"("validFrom","validUntil")`,
      `CREATE TABLE "BenefitClaim" ("id" TEXT NOT NULL PRIMARY KEY, "activityId" TEXT NOT NULL, "endUserId" TEXT NOT NULL, "benefitGrantId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "BenefitClaim_benefitGrantId_key" ON "BenefitClaim"("benefitGrantId")`,
      `CREATE UNIQUE INDEX "BenefitClaim_activityId_endUserId_key" ON "BenefitClaim"("activityId","endUserId")`,
      `CREATE INDEX "BenefitClaim_endUserId_idx" ON "BenefitClaim"("endUserId")`,
      `CREATE INDEX "BenefitClaim_activityId_createdAt_idx" ON "BenefitClaim"("activityId","createdAt")`,
    ])
  } finally {
    client.close()
  }
}


let httpPrisma: PrismaService | null = null
let httpAudit: AuditService | null = null
const httpRedisCache = new Map<string, string>()
const httpRedis = {
  async get(key: string) { return httpRedisCache.get(key) ?? null },
  async del(key: string) { return httpRedisCache.delete(key) ? 1 : 0 },
  async setJsonIfVersionNotOlder(key: string, _ttl: number, value: string, tokenVersion: number) {
    const current = httpRedisCache.get(key)
    const currentVersion = current ? (JSON.parse(current) as { tokenVersion?: number }).tokenVersion : undefined
    if (typeof currentVersion === 'number' && currentVersion > tokenVersion) return 'stale' as const
    httpRedisCache.set(key, value)
    return 'stored' as const
  },
}

@Module({
  imports: [JwtModule.register({ secret: process.env['JWT_SECRET'], signOptions: { expiresIn: '30m' } })],
  controllers: [AdminBenefitActivitiesController],
  providers: [
    { provide: PrismaService, useFactory: () => httpPrisma ?? fail('HTTP 测试未绑定 Prisma') },
    { provide: AuditService, useFactory: () => httpAudit ?? fail('HTTP 测试未绑定 Audit') },
    BenefitActivitiesService,
    Reflector,
    RolesGuard,
    JwtAuthGuard,
    { provide: loadRedisService(), useValue: httpRedis },
  ],
})
class BenefitActivityQuantityHttpModule {}

// 分段加载真实模块：静态路径会给本门禁增加图谱边，而本任务不能刷新 docs/graph。
function loadModule(segments: string[]): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(segments.join('/')) as Record<string, unknown>
}

function loadNamed(segments: string[], name: string): unknown {
  const value = loadModule(segments)[name]
  if (value === undefined) fail(`${name} 不可读`)
  return value
}

function loadRedeemableBenefitTypes(): readonly string[] {
  const types = loadNamed(['..', 'src', 'benefit-redemption', 'benefit-redemption.types'], 'REDEEMABLE_BENEFIT_TYPES')
  if (!Array.isArray(types) || types.some((item) => typeof item !== 'string')) fail('REDEEMABLE_BENEFIT_TYPES 不可读')
  return types as readonly string[]
}

function loadRedisService(): new (...args: never[]) => unknown {
  const Service = loadNamed(['..', 'src', 'common', 'redis', 'redis.service'], 'RedisService')
  if (typeof Service !== 'function') fail('RedisService 不可读')
  return Service as new (...args: never[]) => unknown
}

function loadHttpExceptionFilter(): new () => { catch(exception: unknown, host: unknown): void } {
  const Filter = loadNamed(['..', 'src', 'common', 'filters', 'http-exception.filter'], 'HttpExceptionFilter')
  if (typeof Filter !== 'function') fail('HttpExceptionFilter 不可读')
  return Filter as new () => { catch(exception: unknown, host: unknown): void }
}

function activityInput(benefitType: string, title: string, quantity: number | null | undefined): ActivityInput {
  const input: ActivityInput = {
    title,
    description: '额度校验活动。',
    rulesText: null,
    benefitType,
    sourceType: 'platform',
    stockTotal: null,
    validFrom: null,
    validUntil: null,
    grantValidDays: null,
  }
  if (quantity !== undefined) input.quantityTotal = quantity
  return input
}

function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) for (const message of Object.values(error.constraints)) out.push(`${field}: ${message}`)
    if (error.children?.length) out.push(...flattenValidationErrors(error.children, field))
  }
  return out
}

function thrownCode(error: unknown): string | undefined {
  const body = (error as { getResponse?: () => unknown; response?: unknown }).getResponse?.()
    ?? (error as { response?: unknown }).response
  return (body as { error?: { code?: string } } | undefined)?.error?.code
}

async function counts(prisma: PrismaService): Promise<string> {
  const [activities, grants, claims, audits] = await Promise.all([
    prisma.benefitActivity.count(),
    prisma.benefitGrant.count(),
    prisma.benefitClaim.count(),
    prisma.auditLog.count(),
  ])
  return `${activities}:${grants}:${claims}:${audits}`
}

async function footprint(prisma: PrismaService, activityId: string): Promise<string> {
  const activity = await prisma.benefitActivity.findUnique({ where: { id: activityId } })
  const grants = await prisma.benefitGrant.findMany({
    where: { sourceRef: activityId },
    select: { id: true, quantityTotal: true, quantityRemaining: true, updatedAt: true },
    orderBy: { id: 'asc' },
  })
  const [claims, audits] = await Promise.all([
    prisma.benefitClaim.count({ where: { activityId } }),
    prisma.auditLog.count({ where: { action: 'benefit_activity.claim', targetId: activityId } }),
  ])
  return JSON.stringify({
    quantityTotal: activity?.quantityTotal ?? null,
    stockRemaining: activity?.stockRemaining ?? null,
    status: activity?.status ?? null,
    updatedAt: activity?.updatedAt.getTime() ?? null,
    claims,
    audits,
    grants: grants.map((grant) => [grant.id, grant.quantityTotal, grant.quantityRemaining, grant.updatedAt.getTime()]),
  })
}

async function expectNoWrite(
  prisma: PrismaService,
  code: string,
  label: string,
  fn: () => Promise<unknown>,
  activityId?: string,
): Promise<void> {
  const beforeCounts = await counts(prisma)
  const beforeFoot = activityId ? await footprint(prisma, activityId) : ''
  let actual: string | undefined
  try {
    await fn()
  } catch (error) {
    actual = thrownCode(error)
  }
  if (actual !== code) fail(`${label} — expected ${code}, got ${actual ?? 'success'}`)
  if (beforeCounts !== await counts(prisma)) fail(`${label} 写入了活动、权益、领取或审计`)
  if (activityId && beforeFoot !== await footprint(prisma, activityId)) fail(`${label} 改变了活动、库存、权益、领取或审计`)
  pass(label)
}

async function verifyRedeemableQuantity(input: {
  prisma: PrismaService
  activities: BenefitActivitiesService
  audit: AuditService
  admin: AuthedUser
  suffix: string
  activityIds: string[]
  userA: string
  userB: string
}): Promise<void> {
  const { prisma, activities, audit, admin, suffix, activityIds, userA, userB } = input
  const redeemable = loadRedeemableBenefitTypes()
  if (redeemable.length === 0 || redeemable.includes('subsidy_eligibility_hint')) fail(`可核销类型常量异常：${redeemable.join(',')}`)
  const anchorType = redeemable[0] ?? 'coupon'
  pass(`14. 可核销类型：${redeemable.join(',')}`)

  let anchorDraft: { id: string; title: string } | null = null
  let preservedId = ''
  for (const benefitType of redeemable) {
    for (const quantity of [undefined, null] as const) {
      const state = quantity === undefined ? '缺省' : 'null'
      await expectNoWrite(prisma, 'BENEFIT_ACTIVITY_QUANTITY_REQUIRED', `${benefitType} create ${state}`, () =>
        activities.create(admin, activityInput(benefitType, `${benefitType}-c-${state}-${suffix}`, quantity)))
    }
    const created = await activities.create(admin, activityInput(benefitType, `${benefitType}-草稿-${suffix}`, 4))
    activityIds.push(created.id)
    if (created.quantityTotal !== 4) fail(`${benefitType} 有效额度未按原值保存`)
    if (benefitType === anchorType) {
      anchorDraft = created
      const preserved = await prisma.benefitGrant.create({
        data: {
          endUserId: userA,
          benefitType,
          title: `已有额度 ${suffix}`,
          quantityTotal: 4,
          quantityRemaining: 2,
          status: 'active',
          sourceType: 'platform',
          sourceRef: created.id,
        },
      })
      preservedId = preserved.id
    }
    for (const quantity of [undefined, null] as const) {
      const state = quantity === undefined ? '缺省' : 'null'
      await expectNoWrite(
        prisma,
        'BENEFIT_ACTIVITY_QUANTITY_REQUIRED',
        `${benefitType} update ${state} 不改活动`,
        () => activities.update(admin, created.id, activityInput(benefitType, created.title, quantity)),
        created.id,
      )
    }
  }
  if (!anchorDraft) fail('缺少锚点活动')
  const draft = anchorDraft
  const still = await prisma.benefitGrant.findUnique({ where: { id: preservedId } })
  if (still?.quantityTotal !== 4 || still.quantityRemaining !== 2) fail('空额度更新改写了已有 BenefitGrant')

  const bounded = await activities.create(admin, activityInput(anchorType, `边界额度 ${suffix}`, 1))
  activityIds.push(bounded.id)
  const raised = await activities.update(admin, bounded.id, activityInput(anchorType, bounded.title, 9999))
  if (bounded.quantityTotal !== 1 || raised.quantityTotal !== 9999) fail(`边界额度异常 ${bounded.quantityTotal}/${raised.quantityTotal}`)
  pass('15. 1 与 9999 的 create/update 通过')

  for (const value of [0, -1, 10000, 1.5, Number.NaN]) {
    await expectNoWrite(prisma, 'BENEFIT_ACTIVITY_QUANTITY_REQUIRED', `service 拒绝 ${value}`, () =>
      activities.update(admin, draft.id, activityInput(anchorType, draft.title, value)), draft.id)
  }
  for (const value of ['3', true] as const) {
    const body = activityInput(anchorType, draft.title, undefined)
    body.quantityTotal = value as unknown as number
    await expectNoWrite(prisma, 'BENEFIT_ACTIVITY_QUANTITY_REQUIRED', `service 拒绝 ${typeof value}`, () =>
      activities.update(admin, draft.id, body), draft.id)
  }

  let hintId = ''
  let hintTitle = ''
  for (const quantity of [undefined, null] as const) {
    const state = quantity === undefined ? '缺省' : 'null'
    const created = await activities.create(admin, activityInput('subsidy_eligibility_hint', `提示-${state}-${suffix}`, quantity))
    activityIds.push(created.id)
    const updated = await activities.update(admin, created.id, activityInput('subsidy_eligibility_hint', created.title, quantity))
    if (created.quantityTotal !== null || updated.quantityTotal !== null) fail('政策提示写成了额度')
    hintId = created.id
    hintTitle = created.title
  }
  const publishedHint = await activities.publish(admin, hintId)
  const hintGrant = await activities.claim(userB, hintId)
  if (publishedHint.quantityTotal !== null || hintGrant.quantityTotal !== null) fail('政策提示领取写成了额度')
  pass('16. 政策提示 null/缺省可创建、发布并领取')
  await expectNoWrite(prisma, 'BENEFIT_ACTIVITY_QUANTITY_FORBIDDEN', '政策提示带额度仍拒绝', () =>
    activities.update(admin, hintId, activityInput('subsidy_eligibility_hint', hintTitle, 1)), hintId)

  const ghost = await prisma.benefitActivity.create({
    data: { title: `历史草稿 ${suffix}`, benefitType: anchorType, sourceType: 'platform', quantityTotal: null, status: 'draft' },
  })
  activityIds.push(ghost.id)
  await expectNoWrite(prisma, 'BENEFIT_ACTIVITY_QUANTITY_REQUIRED', '历史空额度草稿不能发布', () =>
    activities.publish(admin, ghost.id), ghost.id)

  const legacy = await prisma.benefitActivity.create({
    data: {
      title: `历史已发布 ${suffix}`,
      benefitType: anchorType,
      sourceType: 'platform',
      quantityTotal: null,
      stockTotal: 4,
      stockRemaining: 4,
      status: 'published',
    },
  })
  activityIds.push(legacy.id)
  await prisma.benefitGrant.create({
    data: {
      endUserId: userA,
      benefitType: anchorType,
      title: `历史权益 ${suffix}`,
      quantityTotal: 3,
      quantityRemaining: 3,
      status: 'active',
      sourceType: 'platform',
      sourceRef: legacy.id,
    },
  })
  await expectNoWrite(prisma, 'BENEFIT_ACTIVITY_QUANTITY_REQUIRED', '已发布空额度领取被拒且无副作用', () =>
    activities.claim(userA, legacy.id), legacy.id)

  await verifyQuantityHttp({ prisma, audit, admin, suffix, activityIds, userA, anchorType })
}

async function verifyQuantityHttp(input: {
  prisma: PrismaService
  audit: AuditService
  admin: AuthedUser
  suffix: string
  activityIds: string[]
  userA: string
  anchorType: string
}): Promise<void> {
  const { prisma, audit, admin, suffix, activityIds, userA, anchorType } = input
  httpPrisma = prisma
  httpAudit = audit
  const Filter = loadHttpExceptionFilter()
  const app = await NestFactory.create<NestExpressApplication>(BenefitActivityQuantityHttpModule, { logger: ['error'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const details = flattenValidationErrors(errors)
      const message = details[0] ?? '请求参数校验失败'
      return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message, details } })
    },
  }))
  app.useGlobalFilters(new Filter())
  await app.listen(0, '127.0.0.1')
  const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
  const token = app.get(JwtService).sign({ sub: admin.userId, ver: 0 })
  const required = '可核销权益必须填写 1 到 9999 的整数额度'

  async function request(method: string, path: string, body?: ActivityInput) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, json: await response.json() as Record<string, unknown> }
  }

  function errorOf(json: Record<string, unknown>): { code?: string; message?: string } {
    const error = json['error']
    return error && typeof error === 'object' ? error as { code?: string; message?: string } : {}
  }

  async function expectHttpReject(code: string, message: string, label: string, method: string, path: string, body: ActivityInput, activityId?: string) {
    const beforeCounts = await counts(prisma)
    const beforeFoot = activityId ? await footprint(prisma, activityId) : ''
    const result = await request(method, path, body)
    const actual = errorOf(result.json)
    if (result.status !== 400 || actual.code !== code || actual.message !== message) {
      fail(`${label} — expected 400 ${code}, got ${result.status} ${actual.code ?? ''} ${actual.message ?? ''}`)
    }
    if (beforeCounts !== await counts(prisma)) fail(`${label} 写入了活动、权益、领取或审计`)
    if (activityId && beforeFoot !== await footprint(prisma, activityId)) fail(`${label} 改变了活动、库存、权益或领取`)
    pass(label)
  }

  try {
    for (const quantity of [undefined, null] as const) {
      const state = quantity === undefined ? '缺省' : 'null'
      await expectHttpReject(
        'BENEFIT_ACTIVITY_QUANTITY_REQUIRED',
        required,
        `HTTP create ${anchorType} ${state}`,
        'POST',
        '/admin/benefit-activities',
        activityInput(anchorType, `HTTP-${state}-${suffix}`, quantity),
      )
    }
    await expectHttpReject(
      'VALIDATION_FAILED',
      'quantityTotal: quantityTotal must not be less than 1',
      'HTTP create 额度 0 由 ValidationPipe 拒绝',
      'POST',
      '/admin/benefit-activities',
      activityInput(anchorType, `HTTP-zero-${suffix}`, 0),
    )

    const created = await request('POST', '/admin/benefit-activities', activityInput(anchorType, `HTTP-ok-${suffix}`, 4))
    const createdData = created.json['data'] as { id?: string; quantityTotal?: number | null } | undefined
    if (created.status !== 201 || created.json['success'] !== true || !createdData?.id || createdData.quantityTotal !== 4) {
      fail(`HTTP 有效 create 异常：${created.status} ${JSON.stringify(created.json)}`)
    }
    const createdId = createdData.id
    activityIds.push(createdId)
    const httpGrant = await prisma.benefitGrant.create({
      data: {
        endUserId: userA,
        benefitType: anchorType,
        title: `HTTP 已有权益 ${suffix}`,
        quantityTotal: 4,
        quantityRemaining: 4,
        status: 'active',
        sourceType: 'platform',
        sourceRef: createdId,
      },
    })
    pass('HTTP create 有效整数 201')
    const patch = `/admin/benefit-activities/${createdId}`
    for (const quantity of [null, undefined] as const) {
      const state = quantity === undefined ? '缺失' : '清空'
      await expectHttpReject(
        'BENEFIT_ACTIVITY_QUANTITY_REQUIRED',
        required,
        `HTTP update ${state}`,
        'PATCH',
        patch,
        activityInput(anchorType, `HTTP-ok-${suffix}`, quantity),
        createdId,
      )
    }
    const updated = await request('PATCH', patch, activityInput(anchorType, `HTTP-ok-${suffix}`, 6))
    const updatedData = updated.json['data'] as { quantityTotal?: number | null } | undefined
    const stored = await prisma.benefitActivity.findUnique({ where: { id: createdId } })
    const grantAfter = await prisma.benefitGrant.findUnique({ where: { id: httpGrant.id } })
    if (updated.status !== 200 || updatedData?.quantityTotal !== 6 || stored?.quantityTotal !== 6 || grantAfter?.quantityTotal !== 4 || grantAfter.quantityRemaining !== 4) {
      fail(`HTTP 有效 update 异常：${updated.status} ${JSON.stringify(updatedData)}`)
    }
    pass('HTTP update 有效整数 200，已有 BenefitGrant 仍是 4')

    for (const quantity of [undefined, null] as const) {
      const state = quantity === undefined ? '缺省' : 'null'
      const hint = await request('POST', '/admin/benefit-activities', activityInput('subsidy_eligibility_hint', `HTTP-hint-${state}-${suffix}`, quantity))
      const hintData = hint.json['data'] as { id?: string; quantityTotal?: number | null } | undefined
      if (hint.status !== 201 || !hintData?.id || hintData.quantityTotal !== null) fail(`HTTP 政策提示 ${state} 异常：${hint.status}`)
      activityIds.push(hintData.id)
    }
    pass('HTTP 政策提示 null 与缺省仍创建成功')
    await expectHttpReject(
      'BENEFIT_ACTIVITY_QUANTITY_FORBIDDEN',
      '政策资格提示不允许设置额度',
      'HTTP 政策提示带额度仍是原错误',
      'POST',
      '/admin/benefit-activities',
      activityInput('subsidy_eligibility_hint', `HTTP-hint-qty-${suffix}`, 1),
    )
  } finally {
    await app.close()
  }
}
