/**
 * Sprint 1 / Task 4 — 合作机构资料（partner-profile）验证。
 *
 * 覆盖：
 *   1. 读取：getProfile 映射正确（contactName ← Organization.contact；type/enabled 透传）。
 *   2. 更新：updateProfile 改字段 → 返回 changedFields/before/after + detail；
 *      contactName 落 Organization.contact 列；可选字段空串归一为 null。
 *   3. 机构隔离：orgId 为空 → PARTNER_ORG_REQUIRED；orgId 指向不存在机构 → PARTNER_PROFILE_NOT_FOUND。
 *   4. 审计（controller 层）：partner.profile_update 落 AuditLog（targetType=partner），payload 含 changedFields。
 *
 * 运行：pnpm verify:partner-profile
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { PartnerProfileService } from '../src/partner-profile/partner-profile.service'
import { PartnerProfileController } from '../src/partner-profile/partner-profile.controller'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }
function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}
async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际：${c ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== Sprint 1 / Task 4 合作机构资料验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const service = new PartnerProfileService(prisma)
  const controller = new PartnerProfileController(service, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
  const orgId = `org_pp_${suffix}`
  const userId = `user_pp_${suffix}`

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { targetId: orgId, targetType: 'partner' } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
  }

  try {
    await cleanup()

    await prisma.organization.create({
      data: { id: orgId, name: '验证就业服务机构', type: 'public_employment_service', contact: '张主任', enabled: true },
    })
    await prisma.user.create({
      data: { id: userId, username: `pp_${suffix}`, passwordHash: 'verify-not-a-real-hash', name: '机构资料验证账号', role: 'partner', orgId },
    })
    pass('夹具就绪：Organization + partner 账号')

    const user: AuthedUser = { userId, role: 'partner', orgId }

    // ── 1. 读取 ────────────────────────────────────────────────
    const got = await service.getProfile(user)
    if (
      got.id === orgId && got.name === '验证就业服务机构' && got.type === 'public_employment_service' &&
      got.contactName === '张主任' && got.enabled === true && got.creditCode === null
    ) {
      pass('1. 读取：profile 映射正确（contactName ← contact，type/enabled 透传，未填项为 null）')
    } else fail(`1. 读取异常：${JSON.stringify(got)}`)

    // ── 2. 更新 ────────────────────────────────────────────────
    const upd = await service.updateProfile(user, {
      name: '验证就业服务机构（已更新）',
      contactName: '李四',
      contactPhone: '13800000002',
      creditCode: '91320000MA1TEST00',
      contactEmail: 'svc@example.gov.cn',
      address: '示例市示例区 1 号',
      description: '机构简介示例',
      websiteUrl: 'https://example.gov.cn',
    })
    const orgAfter = await prisma.organization.findUnique({ where: { id: orgId }, select: { contact: true, contactPhone: true, creditCode: true } })
    if (
      upd.detail.name === '验证就业服务机构（已更新）' && upd.detail.contactName === '李四' &&
      upd.detail.websiteUrl === 'https://example.gov.cn' &&
      orgAfter?.contact === '李四' && orgAfter.contactPhone === '13800000002' && orgAfter.creditCode === '91320000MA1TEST00' &&
      upd.changedFields.includes('name') && upd.changedFields.includes('contactName') &&
      upd.before['contactName'] === '张主任' && upd.after['contactName'] === '李四'
    ) {
      pass('2. 更新：字段落库（contactName→Organization.contact），changedFields/before/after 正确')
    } else fail(`2. 更新异常：detail=${JSON.stringify(upd.detail)} orgAfter=${JSON.stringify(orgAfter)} changed=${JSON.stringify(upd.changedFields)}`)

    // 空串归一为 null
    const upd2 = await service.updateProfile(user, {
      name: '验证就业服务机构（已更新）', contactName: '李四', contactPhone: '13800000002',
      address: '', description: '', websiteUrl: '', creditCode: '', contactEmail: '',
    })
    if (upd2.detail.address === null && upd2.detail.description === null && upd2.detail.creditCode === null) {
      pass('2b. 可选字段空串归一为 null')
    } else fail(`2b. 空串归一异常：${JSON.stringify(upd2.detail)}`)

    // ── 3. 机构隔离 ─────────────────────────────────────────────
    await expectCode(() => service.getProfile({ userId, role: 'partner', orgId: null }), 'PARTNER_ORG_REQUIRED', '3a. orgId 为空 → PARTNER_ORG_REQUIRED')
    await expectCode(() => service.getProfile({ userId, role: 'partner', orgId: 'org_not_exist' }), 'PARTNER_PROFILE_NOT_FOUND', '3b. orgId 指向不存在机构 → PARTNER_PROFILE_NOT_FOUND')

    // ── 4. 审计（controller）────────────────────────────────────
    const req = { headers: { 'user-agent': 'verify-partner-profile' }, requestId: `req_${suffix}`, ip: '127.0.0.1' }
    await controller.update({ name: '审计验证机构名', contactName: '王五', contactPhone: '13800000003' }, user, req)
    const audits = await prisma.auditLog.count({
      where: { actorId: userId, action: 'partner.profile_update', targetType: 'partner', targetId: orgId },
    })
    if (audits === 1) pass('4. 审计：partner.profile_update 已落 AuditLog（targetType=partner）')
    else fail(`4. 审计异常：count=${audits}`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
