import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import { createClient } from '@libsql/client'
import { GUARDS_METADATA } from '@nestjs/common/constants'
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

function guardNames(target: Function | object, propertyKey?: string): string[] {
  const handler = propertyKey ? (target as Record<string, unknown>)[propertyKey] : target
  const metadata = Reflect.getMetadata(GUARDS_METADATA, handler)
  return ((metadata ?? []) as Function[]).map((g) => g.name)
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
      `CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "username" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "name" TEXT NOT NULL, "role" TEXT NOT NULL, "orgId" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "User_username_key" ON "User"("username")`,
      `CREATE TABLE "EndUser" ("id" TEXT NOT NULL PRIMARY KEY, "phoneHash" TEXT NOT NULL, "phoneEnc" TEXT NOT NULL, "nickname" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "lastLoginAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
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
