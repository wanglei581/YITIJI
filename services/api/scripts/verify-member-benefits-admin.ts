/**
 * P0b — Admin 手动发放/撤销会员权益验证。
 *
 * 覆盖：
 *   1. Admin 可按手机号精确搜索会员，只返回 endUserId + phoneMasked，不返回明文手机号。
 *   2. Admin 可发放 BenefitGrant，quantityRemaining 初始化为 quantityTotal。
 *   3. Kiosk /me/benefits 只读服务可读回该会员本人权益。
 *   4. subsidy_eligibility_hint 文案必须 info-only，拒绝承诺性词。
 *   5. revoke 只改状态为 revoked，不删除记录；二次 revoke 幂等拒绝。
 *   6. grant/revoke 均写 AuditLog，payload 不含明文手机号。
 *   7. Admin controller 带 JwtAuthGuard + RolesGuard + @Roles('admin')。
 */
import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import { createClient } from '@libsql/client'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { ROLES_KEY, type UserRole } from '../src/common/decorators/roles.decorator'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { MemberBenefitsService } from '../src/member-benefits/member-benefits.service'
import { AdminMemberBenefitsController } from '../src/member-benefits/admin-member-benefits.controller'
import { AdminMemberBenefitsService } from '../src/member-benefits/admin-member-benefits.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-benefits-admin-${randomUUID().slice(0, 8)}.db`
if (fallbackDbName) process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-member-benefits-admin-secret-key-0123456789'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

async function expectReject(code: string, label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    fail(`${label} — 期望拒绝 ${code}，但操作成功`)
  } catch (error) {
    const body = (error as { response?: { error?: { code?: string } }; getResponse?: () => unknown }).getResponse?.()
      ?? (error as { response?: unknown }).response
    const actual = (body as { error?: { code?: string } } | undefined)?.error?.code
    if (actual === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际 ${actual ?? (error as Error).message}`)
  }
}

function guardNames(target: Function): string[] {
  return ((Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as Function[]).map((g) => g.name)
}

async function main() {
  console.log('\n=== P0b Admin 会员权益发放/撤销验证 ===')

  if (fallbackDbName) {
    await initFallbackDb()
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const adminBenefits = new AdminMemberBenefitsService(prisma, audit)
  const memberBenefits = new MemberBenefitsService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const phone = `139${Date.now().toString().slice(-8)}`
  const phoneHash = hashPhone(phone)
  const adminId = `admin_benefit_${suffix}`
  const endUserId = `eu_benefit_${suffix}`
  const admin: AuthedUser = { userId: adminId, role: 'admin', orgId: null }

  async function cleanup() {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: adminId },
          { targetId: { contains: suffix } },
        ],
      },
    }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: endUserId } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: adminId } }).catch(() => undefined)
  }

  try {
    await cleanup()
    await prisma.user.create({
      data: {
        id: adminId,
        username: `benefit-admin-${suffix}`,
        passwordHash: 'verify-only',
        name: '权益验证管理员',
        role: 'admin',
        enabled: true,
      },
    })
    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash,
        phoneEnc: encryptPhone(phone),
        nickname: '权益验证会员',
      },
    })

    // 1. 搜索会员隐私。
    const search = await adminBenefits.searchEndUsersByPhone(admin, phone)
    if (search.items.length === 1 && search.items[0].endUserId === endUserId && search.items[0].phoneMasked.endsWith(phone.slice(-4))) {
      pass('1a. 手机号精确搜索命中会员，只返回脱敏手机号')
    } else fail(`1a. 搜索结果异常：${JSON.stringify(search)}`)
    if (!JSON.stringify(search).includes(phone)) pass('1b. 搜索响应不含明文手机号')
    else fail('1b. 搜索响应泄露明文手机号')

    // 真正经过 Nest 路由、DTO 与角色守卫的 HTTP 查询。
    const originalAuth = JwtAuthGuard.prototype.canActivate
    JwtAuthGuard.prototype.canActivate = async function (context) {
      const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user?: AuthedUser }>()
      request.user = { userId: adminId, role: request.headers.authorization === 'Bearer partner-test' ? 'partner' : 'admin', orgId: null }
      return true
    }
    @Module({
      controllers: [AdminMemberBenefitsController],
      providers: [
        { provide: AdminMemberBenefitsService, useValue: adminBenefits },
        { provide: JwtService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: {} },
        JwtAuthGuard,
        RolesGuard,
      ],
    })
    class SearchHttpModule {}
    const app = await NestFactory.create(SearchHttpModule, { logger: false, abortOnError: false })
    try {
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      await app.listen(0, '127.0.0.1')
      const port = (app.getHttpServer().address() as { port: number }).port
      const url = `http://127.0.0.1:${port}/admin/member-benefits/users/search`
      const post = (value: string, authorization = 'Bearer admin-test') => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ phone: value }),
      })
      const hit = await post(phone)
      const hitBody = await hit.json() as { data: { items: Array<{ endUserId: string; phoneMasked: string }> } }
      if (hit.status === 200 && hit.headers.get('cache-control') === 'no-store'
        && hitBody.data.items[0]?.endUserId === endUserId && !JSON.stringify(hitBody).includes(phone)) {
        pass('1c. HTTP POST 手机号命中、响应脱敏且 no-store')
      } else fail(`1c. HTTP POST 命中异常：${hit.status} ${JSON.stringify(hitBody)}`)
      const miss = await post('13800139999')
      const missBody = await miss.json() as { data: { items: unknown[] } }
      if (miss.status === 200 && missBody.data.items.length === 0) pass('1d. HTTP POST 未命中返回空数组')
      else fail(`1d. HTTP POST 未命中异常：${miss.status} ${JSON.stringify(missBody)}`)
      const denied = await post(phone, 'Bearer partner-test')
      if (denied.status === 403) pass('1e. HTTP POST 非管理员被 RolesGuard 拒绝')
      else fail(`1e. HTTP POST 非管理员状态：${denied.status}`)
    } finally {
      await app.close()
      JwtAuthGuard.prototype.canActivate = originalAuth
    }

    // 2. 发放权益。
    const granted = await adminBenefits.grant(admin, {
      endUserId,
      benefitType: 'free_quota',
      sourceType: 'campus',
      title: '校园就业季免费打印 3 次',
      description: '用于现场简历材料打印，具体使用规则以现场公示为准。',
      quantityTotal: 3,
      validFrom: null,
      validUntil: null,
    })
    if (granted.endUserId === endUserId && granted.quantityTotal === 3 && granted.quantityRemaining === 3 && granted.status === 'active') {
      pass('2. Admin 发放权益成功，剩余额度初始化正确')
    } else fail(`2. 发放结果异常：${JSON.stringify(granted)}`)

    // 3. Kiosk 本人只读可读回。
    const mine = await memberBenefits.list(endUserId, { cursor: null, pageSize: 20 })
    if (mine.items.some((i) => i.id === granted.id && i.quantityRemaining === 3)) pass('3. Kiosk /me/benefits 本人只读可读回 Admin 发放的权益')
    else fail(`3. Kiosk 读回异常：${JSON.stringify(mine)}`)

    // 分页夹具放在用例 3 之后：它一次插 100 条，会把用例 3 要读回的那条挤出 pageSize=20 的首页。
    await Promise.all(Array.from({ length: 100 }, (_, index) => adminBenefits.grant(admin, {
      endUserId,
      benefitType: 'free_quota',
      sourceType: 'platform',
      title: `分页权益 ${index}`,
      description: '用于验证后台权益列表总数不因展示上限失真。',
      quantityTotal: 1,
      validFrom: null,
      validUntil: null,
    })))
    const adminBenefitList = await adminBenefits.listForEndUser(endUserId)
    if (adminBenefitList.items.length === 100 && adminBenefitList.total === 101) pass('2b. Admin 权益列表超过 100 条时返回真实 total')
    else fail(`2b. Admin 权益 total 异常：${JSON.stringify({ items: adminBenefitList.items.length, total: adminBenefitList.total })}`)


    // 4. 合规拦截。
    await expectReject('BENEFIT_COPY_FORBIDDEN', '4. subsidy_eligibility_hint 拒绝承诺性文案', () =>
      adminBenefits.grant(admin, {
        endUserId,
        benefitType: 'subsidy_eligibility_hint',
        sourceType: 'gov',
        title: '求职补贴已到账提醒',
        description: '保证通过率，已发放金额 1000 元。',
        quantityTotal: null,
        validFrom: null,
        validUntil: null,
      }),
    )

    // 5. 撤销。
    const revoked = await adminBenefits.revoke(admin, granted.id, { reason: '验证撤销' })
    if (revoked.id === granted.id && revoked.status === 'revoked') pass('5a. revoke 将权益状态改为 revoked')
    else fail(`5a. revoke 结果异常：${JSON.stringify(revoked)}`)
    await expectReject('BENEFIT_NOT_ACTIVE', '5b. 二次 revoke 被拒绝，避免重复撤销', () =>
      adminBenefits.revoke(admin, granted.id, { reason: '重复撤销' }),
    )

    // 6. 审计。
    const logs = await prisma.auditLog.findMany({
      where: {
        actorId: adminId,
      },
      orderBy: { createdAt: 'asc' },
    })
    const actions = logs.map((l) => l.action)
    if (actions.includes('member_benefit.grant') && actions.includes('member_benefit.revoke')) pass('6a. grant/revoke 均写入 AuditLog')
    else fail(`6a. 审计动作缺失：${JSON.stringify(actions)}`)
    const searchLogs = logs.filter((l) => l.action === 'member_benefit.search')
    if (searchLogs.length >= 3 && searchLogs.every((l) => {
      const payload = JSON.parse(l.payloadJson) as Record<string, unknown>
      return Object.keys(payload).sort().join(',') === 'matched,phoneMasked' && typeof payload.phoneMasked === 'string'
    })) pass('6b. HTTP 搜索审计只含 phoneMasked 与既有 matched')
    else fail(`6b. 手机号搜索审计缺失：${JSON.stringify(actions)}`)
    if (!logs.some((l) => l.payloadJson.includes(phone))) pass('6c. AuditLog payload 不含明文手机号')
    else fail('6c. AuditLog payload 泄露明文手机号')

    // 7. Controller 鉴权元数据。
    const classGuards = guardNames(AdminMemberBenefitsController)
    const classRoles = (Reflect.getMetadata(ROLES_KEY, AdminMemberBenefitsController) ?? []) as UserRole[]
    if (classGuards.includes(JwtAuthGuard.name) && classGuards.includes(RolesGuard.name) && classRoles.includes('admin')) {
      pass('7. AdminMemberBenefitsController 带 JwtAuthGuard + RolesGuard + @Roles(admin)')
    } else {
      fail(`7. controller 鉴权元数据异常：guards=${classGuards.join(',')} roles=${classRoles.join(',')}`)
    }
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
      `CREATE TABLE "User" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "passwordHash" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "orgId" TEXT,
        "phoneHash" TEXT,
        "phoneEnc" TEXT,
        "phoneVerifiedAt" DATETIME,
        "phoneRegisteredByAdminAt" DATETIME,
        "tokenVersion" INTEGER NOT NULL DEFAULT 0,
        "lastLoginAt" DATETIME,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX "User_username_key" ON "User"("username")`,
      `CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash")`,
      `CREATE INDEX "User_orgId_idx" ON "User"("orgId")`,
      `CREATE INDEX "User_phoneVerifiedAt_idx" ON "User"("phoneVerifiedAt")`,
      `CREATE TABLE "EndUser" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "phoneHash" TEXT NOT NULL,
        "phoneEnc" TEXT NOT NULL,
        "nickname" TEXT,
        "wxOpenId" TEXT,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "lastLoginAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
      `CREATE UNIQUE INDEX "EndUser_wxOpenId_key" ON "EndUser"("wxOpenId")`,
      `CREATE TABLE "BenefitGrant" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "endUserId" TEXT NOT NULL,
        "benefitType" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "quantityTotal" INTEGER,
        "quantityRemaining" INTEGER,
        "status" TEXT NOT NULL DEFAULT 'active',
        "sourceType" TEXT NOT NULL DEFAULT 'platform',
        "sourceRef" TEXT,
        "validFrom" DATETIME,
        "validUntil" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BenefitGrant_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE INDEX "BenefitGrant_endUserId_idx" ON "BenefitGrant"("endUserId")`,
      `CREATE INDEX "BenefitGrant_endUserId_status_idx" ON "BenefitGrant"("endUserId", "status")`,
      `CREATE TABLE "AuditLog" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "actorId" TEXT,
        "actorRole" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "targetType" TEXT NOT NULL,
        "targetId" TEXT,
        "payloadJson" TEXT NOT NULL DEFAULT '{}',
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "requestId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`,
      `CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId")`,
      `CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action")`,
      `CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId")`,
    ], 'write')
  } finally {
    client.close()
  }
}
