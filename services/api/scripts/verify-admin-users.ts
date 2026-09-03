/**
 * Admin 用户管理闭环验证。
 *
 * 覆盖真实 SQLite 列表/筛选、手机号隐私、详情留存统计、最近活动上限、
 * 敏感字段负向检查、审计上下文、Admin 鉴权元数据和写边界。
 *
 * ── 边界变更记录 ───────────────────────────────────────────────────────────
 * 2026-09-02：本脚本原先断言 controller 只有 `['getDetail','list']` 两个 GET，
 * 即「用户管理面全只读」。该断言咬的是**当时还没做**，不是永远不做：
 *   - docs/product/feature-scope.md:216 把「用户列表、封禁、查看记录」列为 P1
 *   - docs/product/commercial-grade-feature-plan-2026-07.md:234 原文是
 *     「只读 GET /admin/users（…**封禁开关后置**），访问写审计」——「后置」是排期
 *   - docs/product/user-center-commercial-closure-plan-2026-07.md:115 的状态图
 *     直接写着 `Active --> Disabled: 管理员封禁`
 * 现在补齐该 P1 能力，只读边界随之挪到 **disable / restore 两条写路径**：
 * 除这两条外，controller 仍不得出现任何写方法，且这两条必须写审计、必须要求
 * 非空 reason、必须同事务改 status + statusChangedAt。边界是挪位置，不是撤掉。
 *
 * Run: pnpm --filter @ai-job-print/api verify:admin-users
 */
import 'dotenv/config'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { ROLES_KEY, type UserRole } from '../src/common/decorators/roles.decorator'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { AdminUsersController } from '../src/admin-users/admin-users.controller'
import { AdminUsersService } from '../src/admin-users/admin-users.service'
import type { AdminUserAuditContext } from '../src/admin-users/admin-users.types'
import { ListAdminUsersDto } from '../src/admin-users/dto/list-admin-users.dto'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

if (process.env['NODE_ENV'] === 'production') throw new Error('verify:admin-users 禁止在 production 环境运行')
const fallbackDbName = `verify-admin-users-${randomUUID().slice(0, 8)}.db`
process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-admin-users-secret-key-01234567890123456789'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function errorCode(error: unknown): string | undefined {
  const candidate = error as {
    getResponse?: () => unknown
    response?: unknown
  }
  const body = candidate.getResponse?.() ?? candidate.response
  return (body as { error?: { code?: string } } | undefined)?.error?.code
}

async function expectCode(code: string, label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
    fail(`${label}: 期望 ${code}，但请求成功`)
  } catch (error) {
    assert.equal(errorCode(error), code, `${label}: 错误码不匹配`)
    pass(label)
  }
}

async function main(): Promise<void> {
  console.log('\n=== Admin 用户管理闭环验证 ===')
  await initFallbackDb()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const service = new AdminUsersService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const adminId = `admin_au_${suffix}`
  const endUserId = `eu_au_${suffix}`
  const disabledUserId = `eu_au_disabled_${suffix}`
  // 状态变更专用夹具：与上面两个只读夹具隔离，避免停用/恢复动作污染既有断言。
  const statusUserId = `eu_au_status_${suffix}`
  const closingUserId = `eu_au_closing_${suffix}`
  const anonymizedUserId = `eu_au_anon_${suffix}`
  const statusUserIds = [statusUserId, closingUserId, anonymizedUserId]
  const phone = `139${Date.now().toString().slice(-8)}`
  const disabledPhone = `138${(Date.now() - 1).toString().slice(-8)}`
  const statusPhone = `137${(Date.now() - 2).toString().slice(-8)}`
  const closingPhone = `136${(Date.now() - 3).toString().slice(-8)}`
  const anonymizedPhone = `135${(Date.now() - 4).toString().slice(-8)}`
  const now = new Date()
  const future = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const past = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const context: AdminUserAuditContext = {
    actorId: adminId,
    actorRole: 'admin',
    ipAddress: '127.0.0.1',
    userAgent: 'verify-admin-users/1.0',
    requestId: `req_${suffix}`,
  }

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
    await prisma.externalJumpLog.deleteMany({ where: { endUserId: { in: [endUserId, disabledUserId] } } })
    await prisma.browseLog.deleteMany({ where: { endUserId: { in: [endUserId, disabledUserId] } } })
    await prisma.aiResumeResult.deleteMany({ where: { endUserId: { in: [endUserId, disabledUserId] } } })
    await prisma.printTask.deleteMany({ where: { endUserId: { in: [endUserId, disabledUserId] } } })
    await prisma.fileObject.deleteMany({ where: { endUserId: { in: [endUserId, disabledUserId] } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [endUserId, disabledUserId, ...statusUserIds] } } })
    await prisma.user.deleteMany({ where: { id: adminId } })
  }

  try {
    await cleanup()
    await prisma.user.createMany({
      data: [{
        id: adminId,
        username: `admin-users-${suffix}`,
        passwordHash: 'verify-only',
        name: '用户管理验证管理员',
        role: 'admin',
        enabled: true,
      }],
    })
    await prisma.endUser.createMany({
      data: [
        {
          id: endUserId,
          phoneHash: hashPhone(phone),
          phoneEnc: encryptPhone(phone),
          nickname: '验证会员甲',
          enabled: true,
          lastLoginAt: new Date('2026-07-15T02:00:00.000Z'),
          createdAt: new Date('2026-07-10T01:00:00.000Z'),
          updatedAt: new Date('2026-07-15T02:00:00.000Z'),
        },
        {
          id: disabledUserId,
          phoneHash: hashPhone(disabledPhone),
          phoneEnc: encryptPhone(disabledPhone),
          nickname: '停用会员乙',
          enabled: false,
          createdAt: new Date('2026-07-01T01:00:00.000Z'),
          updatedAt: new Date('2026-07-02T01:00:00.000Z'),
        },
        {
          id: statusUserId,
          phoneHash: hashPhone(statusPhone),
          phoneEnc: encryptPhone(statusPhone),
          nickname: '状态变更会员丙',
          enabled: true,
          status: 'active',
          createdAt: new Date('2026-07-03T01:00:00.000Z'),
          updatedAt: new Date('2026-07-03T01:00:00.000Z'),
        },
        {
          id: closingUserId,
          phoneHash: hashPhone(closingPhone),
          phoneEnc: encryptPhone(closingPhone),
          nickname: '注销中会员丁',
          enabled: false,
          status: 'closing',
          closingRequestedAt: new Date('2026-07-04T01:00:00.000Z'),
          statusChangedAt: new Date('2026-07-04T01:00:00.000Z'),
          createdAt: new Date('2026-07-04T01:00:00.000Z'),
          updatedAt: new Date('2026-07-04T01:00:00.000Z'),
        },
        {
          id: anonymizedUserId,
          phoneHash: hashPhone(anonymizedPhone),
          phoneEnc: encryptPhone(anonymizedPhone),
          nickname: null,
          enabled: false,
          status: 'anonymized',
          anonymizedAt: new Date('2026-07-05T01:00:00.000Z'),
          statusChangedAt: new Date('2026-07-05T01:00:00.000Z'),
          createdAt: new Date('2026-07-05T01:00:00.000Z'),
          updatedAt: new Date('2026-07-05T01:00:00.000Z'),
        },
      ],
    })

    await createBaselineActivities(prisma, { endUserId, suffix, now, future, past })
    pass('真实 SQLite 验证夹具创建完成')

    const byNickname = await service.list({ page: 1, pageSize: 20, keyword: '验证会员' }, context)
    assert.equal(byNickname.total, 1)
    assert.equal(byNickname.items[0]?.id, endUserId)
    assert.equal(byNickname.items[0]?.maskedPhone, `${phone.slice(0, 3)}****${phone.slice(-4)}`)
    pass('昵称筛选、分页和手机号脱敏正确')

    const byPhone = await service.list({ page: 1, pageSize: 20, phone }, context)
    assert.equal(byPhone.total, 1)
    assert.equal(byPhone.items[0]?.id, endUserId)
    pass('完整手机号通过 phoneHash 精确命中')

    const pageTwoContext = { ...context, requestId: `req_phone_page_2_${suffix}` }
    const phonePageTwo = await service.list({ page: 2, pageSize: 20, phone }, pageTwoContext)
    assert.equal(phonePageTwo.total, 1)
    assert.equal(phonePageTwo.items.length, 0)
    const pageTwoAudit = await prisma.auditLog.findFirst({ where: { requestId: pageTwoContext.requestId } })
    assert.equal(pageTwoAudit?.targetId, endUserId)
    assert.equal((JSON.parse(pageTwoAudit?.payloadJson ?? '{}') as { matched?: boolean }).matched, true)
    pass('手机号命中审计不受分页窗口影响')

    const requiredAuditService = new AdminUsersService(prisma, { write: async () => null } as AuditService)
    await expectCode('ADMIN_USER_AUDIT_UNAVAILABLE', '敏感查询在审计写失败时拒绝返回', () =>
      requiredAuditService.list({ page: 1, pageSize: 20, phone }, context),
    )

    await expectCode('ADMIN_USER_PAGE_INVALID', '超大或非安全页码在服务层被拒绝', () =>
      service.list({ page: Number.MAX_SAFE_INTEGER, pageSize: 100 }, context),
    )

    const controllerContext = {
      ...context,
      requestId: `r${suffix}`.padEnd(180, 'x'),
    }
    const controller = new AdminUsersController(service)
    const admin: AuthedUser = { userId: adminId, role: 'admin', orgId: null }
    const request = {
      headers: {
        'x-forwarded-for': '203.0.113.99',
        'user-agent': 'u'.repeat(800),
      },
      ip: '127.0.0.2',
      socket: { remoteAddress: '127.0.0.3' },
      requestId: controllerContext.requestId,
    } as unknown as Parameters<AdminUsersController['list']>[2]
    await controller.list(Object.assign(new ListAdminUsersDto(), { phone }), admin, request)
    const controllerAudit = await prisma.auditLog.findFirst({
      where: { requestId: controllerContext.requestId.slice(0, 128) },
    })
    assert.equal(controllerAudit?.ipAddress, '127.0.0.2')
    assert.equal(controllerAudit?.userAgent?.length, 512)
    assert.equal(controllerAudit?.requestId?.length, 128)
    pass('审计元数据忽略伪造转发头并限制长度')

    const disabled = await service.list({ page: 1, pageSize: 20, enabled: false }, context)
    // 夹具里 enabled=false 的三位：历史停用、注销中、已匿名化。
    // 用集合比对而不是 total===1 —— 后者只是在数夹具个数，加一个夹具就会假红；
    // 集合比对才真正咬住「enabled 过滤器只返回停用账号、且一个不漏」。
    assert.deepEqual(
      disabled.items.map((item) => item.id).sort(),
      [disabledUserId, closingUserId, anonymizedUserId].sort(),
    )
    assert.equal(disabled.total, 3)
    assert.ok(disabled.items.every((item) => item.enabled === false), 'enabled=false 过滤器混入了启用账号')
    const registered = await service.list({
      page: 1,
      pageSize: 20,
      registeredFrom: '2026-07-09T00:00:00.000Z',
      registeredTo: '2026-07-11T00:00:00.000Z',
    }, context)
    assert.equal(registered.total, 1)
    assert.equal(registered.items[0]?.id, endUserId)
    pass('启用状态与注册时间筛选正确')

    await prisma.endUser.update({
      where: { id: disabledUserId },
      data: { phoneEnc: 'corrupted-phone-ciphertext' },
    })
    const corruptedCipherList = await service.list({ page: 1, pageSize: 20, enabled: false }, context)
    // 按 id 取而不是 items[0]：列表按 createdAt desc 排序，位置会随夹具增减漂移，
    // 断言要咬的是「这一行降级了」，不是「它恰好排第一」。
    const corruptedRow = corruptedCipherList.items.find((item) => item.id === disabledUserId)
    assert.equal(corruptedRow?.maskedPhone, '***')
    assert.ok(
      corruptedCipherList.items.every((item) => item.id === disabledUserId || item.maskedPhone !== '***'),
      '密文损坏的降级不应波及同页其它账号',
    )
    const corruptedCipherDetail = await service.getDetail(disabledUserId, context)
    assert.equal(corruptedCipherDetail.user.maskedPhone, '***')
    pass('单条手机号密文损坏时列表与详情安全降级且不泄露密文')

    await expectCode('ADMIN_USER_SEARCH_CONFLICT', '手机号与昵称同时查询被拒绝', () =>
      service.list({ page: 1, pageSize: 20, phone, keyword: '会员' }, context),
    )
    await expectCode('ADMIN_USER_PHONE_INVALID', '非法手机号被拒绝', () =>
      service.list({ page: 1, pageSize: 20, phone: '12345' }, context),
    )
    await expectCode('ADMIN_USER_DATE_RANGE_INVALID', '反向注册日期范围被拒绝', () =>
      service.list({
        page: 1,
        pageSize: 20,
        registeredFrom: '2026-07-12T00:00:00.000Z',
        registeredTo: '2026-07-11T00:00:00.000Z',
      }, context),
    )

    const detail = await service.getDetail(endUserId, context)
    assert.deepEqual(detail.stats, {
      fileCount: 1,
      printTaskCount: 1,
      aiResultCount: 1,
      browseCount: 1,
      externalJumpCount: 1,
    })
    assert.equal(detail.user.maskedPhone, `${phone.slice(0, 3)}****${phone.slice(-4)}`)
    assert.ok(detail.retentionNotice.includes('当前留存'))
    pass('详情五项统计遵守当前留存口径')

    await createActivityCapFixtures(prisma, { endUserId, suffix, now })
    const capped = await service.getDetail(endUserId, context)
    assert.equal(capped.recentActivities.length, 20)
    assert.ok(capped.recentActivities.every((item, index, all) =>
      index === 0 || all[index - 1]!.occurredAt >= item.occurredAt,
    ))
    pass('最近活动跨五类合并、倒序且最多 20 条')

    await expectCode('ADMIN_USER_NOT_FOUND', '不存在用户返回稳定错误码', () =>
      service.getDetail(`missing_${suffix}`, context),
    )

    const safeSerialized = JSON.stringify({ byNickname, byPhone, detail: capped })
    const banned = [
      phone,
      hashPhone(phone),
      'phoneEnc',
      'phoneHash',
      'filename',
      'storageKey',
      'sha256',
      'fileUrl',
      'fileMd5',
      'paramsJson',
      'errorMessage',
      'payloadJson',
      'provider',
      'accessTokenHash',
      'targetTitle',
      'sourceName',
      'sourceUrl',
      'externalId',
      'sensitive-resume.pdf',
      'https://secret.example',
    ]
    for (const value of banned) assert.equal(safeSerialized.includes(value), false, `响应泄露敏感值/字段: ${value}`)
    pass('列表与详情响应通过敏感字段负向检查')

    const logs = await prisma.auditLog.findMany({ where: { actorId: adminId }, orderBy: { createdAt: 'asc' } })
    const phoneSearchLog = logs.find((row) => row.action === 'admin.user.phone_search')
    const detailLog = logs.find((row) => row.action === 'admin.user.detail.view' && row.targetId === endUserId)
    assert.equal(phoneSearchLog?.targetId, endUserId)
    assert.equal(detailLog?.targetId, endUserId)
    assert.equal(phoneSearchLog?.ipAddress, context.ipAddress)
    assert.equal(phoneSearchLog?.userAgent, context.userAgent)
    assert.equal(phoneSearchLog?.requestId, context.requestId)
    assert.equal(logs.some((row) => row.payloadJson.includes(phone) || row.payloadJson.includes(hashPhone(phone))), false)
    pass('手机号搜索与详情查看写入脱敏审计和请求元数据')


    // ── 停用 / 恢复闭环 ──────────────────────────────────────────────────────
    // 边界从「全只读」挪到这两条写路径后，护栏改由下面这组断言承担。

    const statusSnapshot = (id: string) => prisma.endUser.findUnique({
      where: { id },
      select: { enabled: true, status: true, statusChangedAt: true, phoneHash: true, phoneEnc: true },
    })

    await expectCode('ADMIN_USER_STATUS_REASON_REQUIRED', '纯空白原因的停用被拒绝', () =>
      service.setStatus(statusUserId, 'disable', '   ', context))
    await expectCode('ADMIN_USER_STATUS_REASON_REQUIRED', '超长原因的停用被拒绝', () =>
      service.setStatus(statusUserId, 'disable', 'x'.repeat(201), context))
    const beforeAnyChange = await statusSnapshot(statusUserId)
    assert.equal(beforeAnyChange?.status, 'active')
    assert.equal(beforeAnyChange?.enabled, true)
    assert.equal(beforeAnyChange?.statusChangedAt, null)
    assert.equal(await prisma.auditLog.count({ where: { targetId: statusUserId } }), 0)
    pass('原因缺失时状态、statusChangedAt 与审计三者均未被写入')

    await expectCode('ADMIN_USER_NOT_FOUND', '停用不存在的用户返回稳定错误码', () =>
      service.setStatus(`eu_missing_${suffix}`, 'disable', '验证不存在的用户', context))

    const disableResult = await service.setStatus(statusUserId, 'disable', '刷免费 AI 额度', context)
    assert.equal(disableResult.changed, true)
    assert.equal(disableResult.user.status, 'disabled')
    assert.equal(disableResult.user.enabled, false)
    const afterDisable = await statusSnapshot(statusUserId)
    assert.equal(afterDisable?.enabled, false)
    assert.equal(afterDisable?.status, 'disabled')
    // statusChangedAt 不是可选装饰：member-step-up.service.ts:216 把它逐字编进
    // step-up 授权票据并比对，漏写会让被停用者手里的票据继续有效。
    assert.ok(afterDisable?.statusChangedAt instanceof Date, 'statusChangedAt 未被写入')
    assert.equal(disableResult.statusChangedAt, afterDisable?.statusChangedAt?.toISOString())
    pass('停用同事务写入 enabled=false、status=disabled 与 statusChangedAt')

    const disableLogs = await prisma.auditLog.findMany({
      where: { action: 'admin.user.disable', targetId: statusUserId },
    })
    assert.equal(disableLogs.length, 1, '停用必须写且只写一条审计')
    const disableLog = disableLogs[0]!
    assert.equal(disableLog.actorId, adminId)
    assert.equal(disableLog.actorRole, 'admin')
    assert.equal(disableLog.targetType, 'EndUser')
    assert.equal(disableLog.ipAddress, context.ipAddress)
    assert.equal(disableLog.userAgent, context.userAgent)
    assert.equal(disableLog.requestId, context.requestId)
    const disablePayload = JSON.parse(disableLog.payloadJson) as Record<string, unknown>
    assert.equal(disablePayload['reason'], '刷免费 AI 额度')
    assert.equal(disablePayload['fromStatus'], 'active')
    assert.equal(disablePayload['toStatus'], 'disabled')
    assert.equal(disableLog.payloadJson.includes(statusPhone), false, '审计 payload 泄露手机号')
    assert.equal(disableLog.payloadJson.includes(hashPhone(statusPhone)), false)
    pass('停用审计含操作人、请求元数据、原因与前后状态，且不含手机号')

    const repeatDisable = await service.setStatus(statusUserId, 'disable', '再点一次', context)
    assert.equal(repeatDisable.changed, false, '重复停用应幂等返回而不是报错')
    assert.equal(repeatDisable.user.status, 'disabled')
    assert.equal(repeatDisable.statusChangedAt, disableResult.statusChangedAt, '幂等调用不得推进 statusChangedAt')
    assert.equal(
      await prisma.auditLog.count({ where: { action: 'admin.user.disable', targetId: statusUserId } }),
      1,
      '重复停用不得产生第二条审计噪音',
    )
    pass('重复停用幂等返回、不推进时间戳、不重复留痕')

    const restoreResult = await service.setStatus(statusUserId, 'restore', '申诉成立，恢复使用', context)
    assert.equal(restoreResult.changed, true)
    assert.equal(restoreResult.user.status, 'active')
    assert.equal(restoreResult.user.enabled, true)
    const afterRestore = await statusSnapshot(statusUserId)
    assert.ok(afterRestore?.statusChangedAt instanceof Date)
    assert.ok(
      afterRestore!.statusChangedAt!.getTime() >= afterDisable!.statusChangedAt!.getTime(),
      '恢复必须同样推进 statusChangedAt',
    )
    const restoreLogs = await prisma.auditLog.findMany({
      where: { action: 'admin.user.restore', targetId: statusUserId },
    })
    assert.equal(restoreLogs.length, 1, '恢复必须同样写审计，不能只审停用')
    const restorePayload = JSON.parse(restoreLogs[0]!.payloadJson) as Record<string, unknown>
    assert.equal(restorePayload['reason'], '申诉成立，恢复使用')
    assert.equal(restorePayload['fromStatus'], 'disabled')
    assert.equal(restorePayload['toStatus'], 'active')
    pass('恢复写入独立审计并同样推进 statusChangedAt')

    // ── 不可恢复状态的护栏 ───────────────────────────────────────────────────
    // 这两组断言是本次最容易在将来被「顺手优化」掉的部分。CAS 的 where 条件只是
    // 实现手段，真正的护栏是这里：anonymized 账号的 phoneHash / phoneEnc 已经换成
    // 墓碑值，「恢复」在物理上无法还原任何东西；closing 由隐私执行器推进，
    // 管理员插一脚会让那条流水线状态错乱。删掉断言等于允许把已注销用户复活。
    const anonBefore = await statusSnapshot(anonymizedUserId)
    await expectCode('ADMIN_USER_STATUS_CONFLICT', '已匿名化注销的账号不能被恢复', () =>
      service.setStatus(anonymizedUserId, 'restore', '尝试复活已注销账号', context))
    await expectCode('ADMIN_USER_STATUS_CONFLICT', '已匿名化注销的账号不能被再次停用', () =>
      service.setStatus(anonymizedUserId, 'disable', '尝试改已注销账号', context))
    assert.deepEqual(await statusSnapshot(anonymizedUserId), anonBefore, '被拒绝的操作改动了 anonymized 账号')
    assert.equal(await prisma.auditLog.count({ where: { targetId: anonymizedUserId } }), 0)
    pass('anonymized 账号的停用与恢复均被拒，状态与审计零变动')

    const closingBefore = await statusSnapshot(closingUserId)
    await expectCode('ADMIN_USER_STATUS_CONFLICT', '注销中的账号不能被管理员恢复', () =>
      service.setStatus(closingUserId, 'restore', '尝试恢复注销中账号', context))
    await expectCode('ADMIN_USER_STATUS_CONFLICT', '注销中的账号不能被管理员停用', () =>
      service.setStatus(closingUserId, 'disable', '尝试改注销中账号', context))
    assert.deepEqual(await statusSnapshot(closingUserId), closingBefore, '被拒绝的操作改动了 closing 账号')
    assert.equal(await prisma.auditLog.count({ where: { targetId: closingUserId } }), 0)
    pass('closing 账号的停用与恢复均被拒，状态与审计零变动')

    const statusList = await service.list({ page: 1, pageSize: 100 }, context)
    const anonItem = statusList.items.find((item) => item.id === anonymizedUserId)
    assert.equal(anonItem?.status, 'anonymized', '列表必须暴露真实 status 供 UI 判断可否恢复')
    assert.equal(anonItem?.enabled, false)
    pass('列表响应带回真实 status，UI 不必用 !enabled 猜测可恢复性')

    verifyControllerMetadata()
    verifyContractParity()
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    cleanupFallbackDb()
  }

  console.log('\nALL PASS')
}

async function createBaselineActivities(
  prisma: PrismaService,
  args: { endUserId: string; suffix: string; now: Date; future: Date; past: Date },
): Promise<void> {
  const { endUserId, suffix, now, future, past } = args
  await prisma.fileObject.createMany({
    data: [
      { id: `file_current_${suffix}`, storageKey: `verify/current-${suffix}.pdf`, filename: 'sensitive-resume.pdf', mimeType: 'application/pdf', sizeBytes: 128, sha256: `sha-current-${suffix}`, endUserId, purpose: 'resume_upload', status: 'active', createdAt: now, expiresAt: future, deletedAt: null },
      { id: `file_expired_${suffix}`, storageKey: `verify/expired-${suffix}.pdf`, filename: 'expired-resume.pdf', mimeType: 'application/pdf', sizeBytes: 128, sha256: `sha-expired-${suffix}`, endUserId, purpose: 'resume_upload', status: 'active', createdAt: past, expiresAt: past, deletedAt: null },
      { id: `file_signature_${suffix}`, storageKey: `verify/signature-${suffix}.png`, filename: 'signature.png', mimeType: 'image/png', sizeBytes: 64, sha256: `sha-signature-${suffix}`, endUserId, purpose: 'signature_image', status: 'active', createdAt: now, expiresAt: future, deletedAt: null },
    ],
  })
  await prisma.printTask.createMany({
    data: [{ id: `print_current_${suffix}`, endUserId, fileUrl: 'https://secret.example/current', fileMd5: `md5-current-${suffix}`, status: 'completed', terminalId: `terminal_${suffix}`, createdAt: now }],
  })
  await prisma.aiResumeResult.createMany({
    data: [
      { id: `ai_current_${suffix}`, taskId: `task_current_${suffix}`, endUserId, kind: 'parse', status: 'completed', provider: 'verify-provider', createdAt: now, expiresAt: future },
      { id: `ai_expired_${suffix}`, taskId: `task_expired_${suffix}`, endUserId, kind: 'optimize', status: 'completed', provider: 'verify-provider', createdAt: past, expiresAt: past },
    ],
  })
  await prisma.browseLog.createMany({
    data: [
      { id: `browse_current_${suffix}`, endUserId, targetType: 'job', targetId: `job_${suffix}`, terminalId: `terminal_${suffix}`, createdAt: now, expiresAt: future },
      { id: `browse_expired_${suffix}`, endUserId, targetType: 'job_fair', targetId: `fair_${suffix}`, createdAt: past, expiresAt: past },
    ],
  })
  await prisma.externalJumpLog.createMany({
    data: [
      { id: `jump_current_${suffix}`, endUserId, targetType: 'job', targetId: `job_${suffix}`, action: 'external_apply', terminalId: `terminal_${suffix}`, createdAt: now, expiresAt: future },
      { id: `jump_expired_${suffix}`, endUserId, targetType: 'policy', targetId: `policy_${suffix}`, action: 'external_open', createdAt: past, expiresAt: past },
    ],
  })
}

async function createActivityCapFixtures(
  prisma: PrismaService,
  args: { endUserId: string; suffix: string; now: Date },
): Promise<void> {
  await prisma.printTask.createMany({
    data: Array.from({ length: 25 }, (_, index) => ({
      id: `print_cap_${index}_${args.suffix}`,
      endUserId: args.endUserId,
      fileUrl: `https://secret.example/cap-${index}`,
      fileMd5: `md5-cap-${index}-${args.suffix}`,
      status: index % 2 === 0 ? 'completed' : 'failed',
      terminalId: `terminal_${args.suffix}`,
      createdAt: new Date(args.now.getTime() + (index + 1) * 1000),
    })),
  })
}

/** 每个 handler 期望的 HTTP 动词。GET 之外的一律视为写路径，见下方写边界断言。 */
const EXPECTED_ROUTE_VERBS: Record<string, number> = {
  list: RequestMethod.GET,
  getDetail: RequestMethod.GET,
  disable: RequestMethod.POST,
  restore: RequestMethod.POST,
}

function verifyControllerMetadata(): void {
  const guards = ((Reflect.getMetadata(GUARDS_METADATA, AdminUsersController) ?? []) as Function[]).map((guard) => guard.name)
  const roles = (Reflect.getMetadata(ROLES_KEY, AdminUsersController) ?? []) as UserRole[]
  assert.ok(guards.includes(JwtAuthGuard.name))
  assert.ok(guards.includes(RolesGuard.name))
  assert.ok(roles.includes('admin'))

  const prototype = AdminUsersController.prototype as unknown as Record<string, unknown>
  const methods = Object.getOwnPropertyNames(prototype).filter((name) => name !== 'constructor')
  assert.deepEqual(methods.sort(), ['disable', 'getDetail', 'list', 'restore'])
  for (const name of methods) {
    assert.equal(
      Reflect.getMetadata(METHOD_METADATA, prototype[name] as object),
      EXPECTED_ROUTE_VERBS[name],
      `${name} 的 HTTP 动词与预期不符`,
    )
    const headers = (Reflect.getMetadata(HEADERS_METADATA, prototype[name] as object) ?? []) as Array<{ name: string; value: string }>
    assert.ok(headers.some((header) => header.name.toLowerCase() === 'cache-control' && header.value === 'no-store'))
  }

  // 写边界：只允许 disable / restore 两条。想加第三条写路径必须先改这里，
  // 顺带被迫回答「它写不写审计、要不要 reason」——这就是这条断言存在的意义。
  const writeMethods = methods.filter((name) => EXPECTED_ROUTE_VERBS[name] !== RequestMethod.GET)
  assert.deepEqual(writeMethods.sort(), ['disable', 'restore'])
  pass('Controller 暴露 2 个 GET + disable/restore 两条写路径，动词与禁缓存头均正确')
}

function verifyContractParity(): void {
  const shared = readFileSync('../../packages/shared/src/types/adminUsers.ts', 'utf8')
  const local = readFileSync('src/admin-users/admin-users.types.ts', 'utf8')
  const required = [
    'AdminUserListQuery',
    'AdminUserListItem',
    'AdminUserListResult',
    'AdminUserActivityItem',
    'AdminUserDetailResult',
    'maskedPhone',
    'recentActivities',
    'retentionNotice',
    'externalJumpCount',
    'AdminUserStatusChangeRequest',
    'AdminUserStatusChangeResult',
    'AdminUserManagedStatus',
  ]
  for (const symbol of required) {
    assert.ok(shared.includes(symbol), `shared 契约缺少 ${symbol}`)
    assert.ok(local.includes(symbol), `API 本地镜像缺少 ${symbol}`)
  }
  assert.ok(local.includes('packages/shared/src/types/adminUsers.ts'))
  pass('共享契约与 API 本地镜像包含同名字段和 SSOT 说明')
}

function cleanupFallbackDb(): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`prisma/${fallbackDbName}${suffix}`, { force: true })
}

async function initFallbackDb(): Promise<void> {
  const client = createClient({ url: process.env['DATABASE_URL']! })
  try {
    await client.batch([
      `CREATE TABLE "User" (
        "id" TEXT NOT NULL PRIMARY KEY, "username" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
        "passwordProofState" TEXT NOT NULL DEFAULT 'legacy',
        "name" TEXT NOT NULL, "role" TEXT NOT NULL, "orgId" TEXT, "phoneHash" TEXT, "phoneEnc" TEXT,
        "phoneVerifiedAt" DATETIME, "emailHash" TEXT, "emailEnc" TEXT, "emailVerifiedAt" DATETIME,
        "emailVerifyMethod" TEXT, "tokenVersion" INTEGER NOT NULL DEFAULT 0, "lastLoginAt" DATETIME,
        "enabled" BOOLEAN NOT NULL DEFAULT true, "deletedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX "User_username_key" ON "User"("username")`,
      `CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash")`,
      `CREATE TABLE "EndUser" (
        "id" TEXT NOT NULL PRIMARY KEY, "phoneHash" TEXT NOT NULL, "phoneEnc" TEXT NOT NULL, "nickname" TEXT,
        "wxOpenId" TEXT,
        "enabled" BOOLEAN NOT NULL DEFAULT true, "status" TEXT NOT NULL DEFAULT 'active',
        "statusChangedAt" DATETIME, "closingRequestedAt" DATETIME, "anonymizedAt" DATETIME,
        "lastLoginAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
      `CREATE UNIQUE INDEX "EndUser_wxOpenId_key" ON "EndUser"("wxOpenId")`,
      `CREATE TABLE "FileObject" (
        "id" TEXT NOT NULL PRIMARY KEY, "storageKey" TEXT NOT NULL,
        "bucket" TEXT NOT NULL DEFAULT 'local-fs', "region" TEXT NOT NULL DEFAULT 'local',
        "filename" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL, "sha256" TEXT NOT NULL,
        "uploaderId" TEXT, "endUserId" TEXT, "ownerType" TEXT, "ownerId" TEXT, "purpose" TEXT NOT NULL,
        "sensitiveLevel" TEXT NOT NULL DEFAULT 'normal', "visibility" TEXT NOT NULL DEFAULT 'private',
        "status" TEXT NOT NULL DEFAULT 'active', "createdBy" TEXT, "expiresAt" DATETIME, "deletedAt" DATETIME,
        "deletedBy" TEXT, "deleteReason" TEXT, "assetCategory" TEXT NOT NULL DEFAULT 'original',
        "sourceFileId" TEXT, "retentionPolicy" TEXT, "retentionSetBy" TEXT, "retentionConsentAt" DATETIME,
        "retentionConsentVersion" TEXT, "retentionLockedReason" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey")`,
      `CREATE TABLE "PrintTask" (
        "id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT, "fileUrl" TEXT NOT NULL, "fileMd5" TEXT NOT NULL,
        "paramsJson" TEXT NOT NULL DEFAULT '{}', "status" TEXT NOT NULL DEFAULT 'pending', "terminalId" TEXT,
        "claimedAt" DATETIME, "claimExpiry" DATETIME, "completedAt" DATETIME, "errorCode" TEXT,
        "errorMessage" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE "AiResumeResult" (
        "id" TEXT NOT NULL PRIMARY KEY, "taskId" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL,
        "payloadJson" TEXT NOT NULL DEFAULT '{}', "provider" TEXT NOT NULL, "endUserId" TEXT,
        "accessTokenHash" TEXT, "jobAiConsentVersion" TEXT, "jobAiConsentGrantedAt" DATETIME,
        "jobAiConsentRevokedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME
      )`,
      `CREATE UNIQUE INDEX "AiResumeResult_taskId_kind_key" ON "AiResumeResult"("taskId", "kind")`,
      `CREATE TABLE "BrowseLog" (
        "id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
        "targetTitle" TEXT, "sourceName" TEXT, "sourceUrl" TEXT, "externalId" TEXT, "terminalId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL
      )`,
      `CREATE TABLE "ExternalJumpLog" (
        "id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
        "action" TEXT NOT NULL, "targetTitle" TEXT, "sourceName" TEXT, "sourceUrl" TEXT, "externalId" TEXT,
        "terminalId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL
      )`,
      `CREATE TABLE "AuditLog" (
        "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "actorRole" TEXT NOT NULL, "action" TEXT NOT NULL,
        "targetType" TEXT NOT NULL, "targetId" TEXT, "payloadJson" TEXT NOT NULL DEFAULT '{}', "ipAddress" TEXT,
        "userAgent" TEXT, "requestId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ], 'write')
  } finally {
    client.close()
  }
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  cleanupFallbackDb()
  process.exit(1)
})
