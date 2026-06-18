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
import { ROLES_KEY, type UserRole } from '../src/common/decorators/roles.decorator'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { MemberNotificationsService } from '../src/member-notifications/member-notifications.service'
import { MemberNotificationsController } from '../src/member-notifications/member-notifications.controller'
import { AdminMemberNotificationsController } from '../src/member-notifications/admin-member-notifications.controller'
import { MemberFeedbackService } from '../src/member-feedback/member-feedback.service'
import { MemberFeedbackController } from '../src/member-feedback/member-feedback.controller'
import { AdminMemberFeedbackController } from '../src/member-feedback/admin-member-feedback.controller'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-feedback-notifications-${randomUUID().slice(0, 8)}.db`
if (fallbackDbName) process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-feedback-notifications-secret-key-0123456789'

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

function guardNames(target: Function): string[] {
  return ((Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as Function[]).map((g) => g.name)
}

async function main() {
  console.log('\n=== P1 反馈与通知闭环验证 ===')
  if (fallbackDbName) await initFallbackDb()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const notifications = new MemberNotificationsService(prisma, audit)
  const feedback = new MemberFeedbackService(prisma, audit, notifications)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const adminId = `admin_fb_${suffix}`
  const userA = `eu_fb_a_${suffix}`
  const userB = `eu_fb_b_${suffix}`
  const phoneA = `139${Date.now().toString().slice(-8)}`
  const phoneB = `138${Date.now().toString().slice(-8)}`
  const admin: AuthedUser = { userId: adminId, role: 'admin', orgId: null }

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: adminId } }).catch(() => undefined)
  }

  try {
    await cleanup()
    await prisma.user.create({
      data: { id: adminId, username: `fb-admin-${suffix}`, passwordHash: 'verify', name: '反馈验证管理员', role: 'admin', enabled: true },
    })
    await prisma.endUser.createMany({
      data: [
        { id: userA, phoneHash: hashPhone(phoneA), phoneEnc: encryptPhone(phoneA), nickname: '反馈用户A' },
        { id: userB, phoneHash: hashPhone(phoneB), phoneEnc: encryptPhone(phoneB), nickname: '反馈用户B' },
      ],
    })

    const ticket = await feedback.create(userA, {
      category: 'device',
      title: '触屏响应慢',
      content: '本地验证反馈内容长度超过十个字。',
      contactPhone: phoneA,
      terminalId: 'KSK-VERIFY',
    })
    if (ticket.status === 'pending' && ticket.contactPhoneMasked?.endsWith(phoneA.slice(-4))) pass('1. 用户可提交反馈且手机号只返回脱敏值')
    else fail(`1. 提交反馈异常：${JSON.stringify(ticket)}`)

    const listA = await feedback.listForEndUser(userA, { cursor: null, pageSize: 20 })
    const listB = await feedback.listForEndUser(userB, { cursor: null, pageSize: 20 })
    if (listA.items.some((item) => item.id === ticket.id) && !listB.items.some((item) => item.id === ticket.id)) pass('2. 反馈列表按本人隔离')
    else fail(`2. 本人隔离异常：A=${JSON.stringify(listA)} B=${JSON.stringify(listB)}`)
    await expectReject('FEEDBACK_NOT_FOUND', '3. 用户B不能关闭用户A反馈', () => feedback.closeByEndUser(userB, ticket.id))

    const adminDetail = await feedback.addAdminReply(admin, ticket.id, { content: '已记录，现场工作人员会核对设备状态。' })
    if (adminDetail.status === 'replied' && adminDetail.replies.some((reply) => reply.senderType === 'admin')) pass('4. Admin 回复反馈并流转为已回复')
    else fail(`4. Admin 回复异常：${JSON.stringify(adminDetail)}`)

    const noticeA = await notifications.listForEndUser(userA, { cursor: null, pageSize: 20 })
    const noticeB = await notifications.listForEndUser(userB, { cursor: null, pageSize: 20 })
    if (noticeA.items.some((item) => item.relatedId === ticket.id && item.category === 'feedback') && !noticeB.items.some((item) => item.relatedId === ticket.id)) pass('5. Admin 回复自动生成本人通知且不串号')
    else fail(`5. 通知隔离异常：A=${JSON.stringify(noticeA)} B=${JSON.stringify(noticeB)}`)

    await expectReject('NOTIFICATION_COPY_FORBIDDEN', '6. 广播拒绝招聘流程文案', () =>
      notifications.createBroadcast(admin, { title: '录用通知', content: '您的投递结果已通过', category: 'notice' }),
    )
    const broadcast = await notifications.createBroadcast(admin, { title: '系统维护提醒', content: '设备维护期间部分服务可能暂不可用。', category: 'maintenance' })
    const beforeReadA = await notifications.listForEndUser(userA, { cursor: null, pageSize: 20 })
    await notifications.markBroadcastRead(userA, broadcast.id)
    const afterReadA = await notifications.listForEndUser(userA, { cursor: null, pageSize: 20 })
    const afterReadB = await notifications.listForEndUser(userB, { cursor: null, pageSize: 20 })
    if (
      beforeReadA.items.some((item) => item.kind === 'broadcast' && !item.isRead) &&
      afterReadA.items.some((item) => item.kind === 'broadcast' && item.isRead) &&
      afterReadB.items.some((item) => item.kind === 'broadcast' && !item.isRead)
    ) pass('7. 广播已读状态按用户隔离')
    else fail(`7. 广播已读异常：A=${JSON.stringify(afterReadA)} B=${JSON.stringify(afterReadB)}`)

    const boundaryNow = Date.now()
    const readBroadcasts = Array.from({ length: 55 }, (_, i) => ({
      id: `read_boundary_${suffix}_${i}`,
      title: `已读广播 ${i}`,
      content: '用于验证未读列表不会被较新的已读广播截断。',
      category: 'notice',
      createdBy: adminId,
      createdAt: new Date(boundaryNow + i * 1000),
      updatedAt: new Date(boundaryNow + i * 1000),
    }))
    const unreadBoundary = await prisma.systemBroadcast.create({
      data: {
        id: `unread_boundary_${suffix}`,
        title: '较早未读广播',
        content: '这条较早的未读广播必须出现在未读列表里。',
        category: 'notice',
        createdBy: adminId,
        createdAt: new Date(boundaryNow - 1000),
        updatedAt: new Date(boundaryNow - 1000),
      },
    })
    await prisma.systemBroadcast.createMany({ data: readBroadcasts })
    await prisma.broadcastReadState.createMany({
      data: readBroadcasts.map((row) => ({
        endUserId: userA,
        broadcastId: row.id,
        readAt: new Date(boundaryNow + 60_000),
      })),
    })
    const unreadOnlyA = await notifications.listForEndUser(userA, { cursor: null, pageSize: 50, unreadOnly: true })
    if (unreadOnlyA.items.some((item) => item.id === unreadBoundary.id && item.kind === 'broadcast' && !item.isRead)) pass('7b. 未读广播列表不会被较新的已读广播截断')
    else fail(`7b. 未读广播分页异常：${JSON.stringify(unreadOnlyA.items.map((item) => ({ id: item.id, isRead: item.isRead, kind: item.kind })))}`)

    const bulkUnreadBroadcasts = Array.from({ length: 105 }, (_, i) => ({
      id: `unread_all_${suffix}_${i}`,
      title: `批量未读广播 ${i}`,
      content: '用于验证全部已读不能只处理前 100 条。',
      category: 'notice',
      createdBy: adminId,
      createdAt: new Date(boundaryNow + 120_000 + i * 1000),
      updatedAt: new Date(boundaryNow + 120_000 + i * 1000),
    }))
    await prisma.systemBroadcast.createMany({ data: bulkUnreadBroadcasts })
    const markAll = await notifications.markAllRead(userB)
    const afterMarkAllB = await notifications.listForEndUser(userB, { cursor: null, pageSize: 50, unreadOnly: true })
    if (markAll.updated >= 105 && afterMarkAllB.unreadCount === 0) pass('7c. 全部已读可处理超过 100 条广播')
    else fail(`7c. 全部已读未清空：updated=${markAll.updated}, unread=${afterMarkAllB.unreadCount}`)

    await expectReject('FEEDBACK_COPY_FORBIDDEN', '8. 反馈回复拒绝招聘流程文案', () =>
      feedback.addAdminReply(admin, ticket.id, { content: '已收到企业面试邀约，请查看投递结果。' }),
    )

    const logs = await prisma.auditLog.findMany({ where: { actorId: adminId } })
    const payloads = logs.map((log) => log.payloadJson).join('\n')
    if (logs.some((log) => log.action === 'feedback.reply') && logs.some((log) => log.action === 'member_notification.broadcast.create')) pass('9a. Admin 回复和广播创建均写审计')
    else fail(`9a. 审计缺失：${logs.map((log) => log.action).join(',')}`)
    if (!payloads.includes(phoneA) && !payloads.includes(phoneB)) pass('9b. AuditLog 不含明文手机号')
    else fail('9b. AuditLog 泄露明文手机号')
    if (!logs.some((log) => log.action === 'feedback.view')) pass('9c. Admin 回复不额外写查看审计')
    else fail('9c. Admin 回复产生了误导性的 feedback.view 审计')

    const endGuards = guardNames(MemberFeedbackController)
    const noticeGuards = guardNames(MemberNotificationsController)
    const adminFeedbackGuards = guardNames(AdminMemberFeedbackController)
    const adminNoticeGuards = guardNames(AdminMemberNotificationsController)
    const adminFeedbackRoles = (Reflect.getMetadata(ROLES_KEY, AdminMemberFeedbackController) ?? []) as UserRole[]
    const adminNoticeRoles = (Reflect.getMetadata(ROLES_KEY, AdminMemberNotificationsController) ?? []) as UserRole[]
    if (
      endGuards.includes(EndUserAuthGuard.name) &&
      noticeGuards.includes(EndUserAuthGuard.name) &&
      adminFeedbackGuards.includes(JwtAuthGuard.name) &&
      adminFeedbackGuards.includes(RolesGuard.name) &&
      adminNoticeGuards.includes(JwtAuthGuard.name) &&
      adminNoticeGuards.includes(RolesGuard.name) &&
      adminFeedbackRoles.includes('admin') &&
      adminNoticeRoles.includes('admin')
    ) pass('10. 控制器鉴权元数据正确')
    else fail('10. 控制器鉴权元数据异常')
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
      `CREATE TABLE "AuditLog" ("id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "actorRole" TEXT NOT NULL, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT, "payloadJson" TEXT NOT NULL DEFAULT '{}', "ipAddress" TEXT, "userAgent" TEXT, "requestId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "PrintTask" ("id" TEXT NOT NULL PRIMARY KEY, "terminalId" TEXT, "endUserId" TEXT, "fileId" TEXT, "status" TEXT NOT NULL DEFAULT 'pending', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "MemberNotification" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT NOT NULL, "title" TEXT NOT NULL, "content" TEXT NOT NULL, "category" TEXT NOT NULL DEFAULT 'system', "relatedType" TEXT, "relatedId" TEXT, "isRead" BOOLEAN NOT NULL DEFAULT false, "readAt" DATETIME, "deletedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "SystemBroadcast" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL, "content" TEXT NOT NULL, "category" TEXT NOT NULL DEFAULT 'system', "deletedAt" DATETIME, "createdBy" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "BroadcastReadState" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT NOT NULL, "broadcastId" TEXT NOT NULL, "readAt" DATETIME, "dismissedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "BroadcastReadState_endUserId_broadcastId_key" ON "BroadcastReadState"("endUserId","broadcastId")`,
      `CREATE TABLE "FeedbackTicket" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT NOT NULL, "terminalId" TEXT, "relatedPrintTaskId" TEXT, "category" TEXT NOT NULL, "title" TEXT, "content" TEXT NOT NULL, "contactPhoneEnc" TEXT, "status" TEXT NOT NULL DEFAULT 'pending', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "FeedbackReply" ("id" TEXT NOT NULL PRIMARY KEY, "ticketId" TEXT NOT NULL, "senderType" TEXT NOT NULL, "actorId" TEXT, "content" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    ])
  } finally {
    client.close()
  }
}
