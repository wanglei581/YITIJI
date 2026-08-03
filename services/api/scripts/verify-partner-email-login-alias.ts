/**
 * Partner Wave 1 — 登录邮箱别名验证。
 *
 * 覆盖:
 * 1. Admin 代绑要求 confirmVerified=true
 * 2. 绑定后脱敏展示，响应/审计无明文邮箱
 * 3. 已验证邮箱 + 密码可登录 partner portal
 * 4. emailVerifiedAt 为空时邮箱不可作登录别名
 * 5. 邮箱占用冲突 EMAIL_ALREADY_BOUND
 * 6. 换绑递增 tokenVersion 并写 emailVerifyMethod=admin_manual
 * 7. 用户名密码登录仍可用
 *
 * 运行: pnpm --filter @ai-job-print/api verify:partner-email-login-alias
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { AuthService } from '../src/auth/auth.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { hashEmail, maskEmail } from '../src/common/crypto/email-identity'

process.env['DATABASE_URL'] ||= 'file:./prisma/dev.db'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-partner-email-alias-secret-32b'

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
    fail(`${label} — 期望错误 ${code},但调用成功`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code},实际: ${c ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== Partner Wave 1 登录邮箱别名验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const redis = {
    del: async () => 1,
    setJsonIfVersionNotOlder: async () => 'stored' as const,
  } as never
  const auth = new AuthService(
    new JwtService({ secret: 'verify-partner-email-alias-jwt' }),
    prisma,
    redis,
    {} as never,
    audit,
  )
  const svc = new AdminOrgsService(prisma, audit, redis)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const adminRow = await prisma.user.create({
    data: { username: `vea_admin_${suffix}`, passwordHash: 'x', name: '邮箱验证管理员', role: 'admin' },
  })
  const admin: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  const username = `vea_partner_${suffix}`
  const phone = `138${Date.now().toString().slice(-8)}`
  const password = `EmailPass_${suffix}`
  const email = `teacher.${suffix}@university.edu.cn`
  const email2 = `backup.${suffix}@university.edu.cn`
  let orgId = ''
  let accountId = ''
  let otherAccountId = ''

  const cleanup = async () => {
    if (orgId) await prisma.user.deleteMany({ where: { orgId } })
    await prisma.organization.deleteMany({ where: { name: { contains: suffix } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { actorId: admin.userId } })
    await prisma.user.delete({ where: { id: admin.userId } }).catch(() => undefined)
  }

  try {
    const detail = await svc.createOrg(
      {
        name: `邮箱别名机构_${suffix}`,
        type: 'school_employment_center',
        sceneTemplate: 'school',
        enabledModules: ['print_scan', 'job_info'],
        account: { username, password, name: '邮箱机构账号', phone },
      },
      admin,
    )
    orgId = detail.id
    accountId = detail.accounts[0]!.id

    await expectCode(
      () => svc.bindAccountEmail(orgId, accountId, { email, confirmVerified: false as unknown as true }, admin),
      'EMAIL_CONFIRM_REQUIRED',
      '1. 未确认人工核验 → EMAIL_CONFIRM_REQUIRED',
    )

    const bound = await svc.bindAccountEmail(orgId, accountId, { email, confirmVerified: true }, admin)
    if (!bound.emailMasked || bound.emailMasked.includes(email.split('@')[0]!)) {
      // local part may partially appear if short; require no full email and has ***
      if (bound.emailMasked === email || !bound.emailMasked.includes('***')) {
        fail('2. 绑定响应应脱敏邮箱')
      }
    }
    if (bound.emailVerifyMethod !== 'admin_manual' || !bound.emailVerifiedAt) {
      fail('2. 应写入 admin_manual 与 emailVerifiedAt')
    }
    const rawBound = JSON.stringify(bound)
    if (rawBound.includes(email) || rawBound.includes(hashEmail(email))) {
      fail('2. 响应泄露明文邮箱或 hash')
    }
    const row = await prisma.user.findUniqueOrThrow({ where: { id: accountId } })
    if (!row.emailHash || !row.emailEnc || !row.emailVerifiedAt || row.emailVerifyMethod !== 'admin_manual') {
      fail('2. 库内 email* 字段不完整')
    }
    if (row.emailEnc.includes('@') || row.emailHash.includes('@')) fail('2. 库内出现明文邮箱痕迹')
    pass('2. 绑定成功：脱敏展示 + admin_manual + 密文落库')

    const loginByEmail = await auth.login(email, password, 'partner')
    if (loginByEmail.user.id !== accountId || loginByEmail.user.orgId !== orgId) {
      fail('3. 已验证邮箱密码登录失败')
    }
    if (loginByEmail.user.emailMasked && loginByEmail.user.emailMasked.includes(email)) {
      fail('3. 登录响应泄露明文邮箱')
    }
    pass('3. 已验证邮箱 + 密码可登录 partner')

    const loginByUsername = await auth.login(username, password, 'partner')
    if (loginByUsername.user.id !== accountId) fail('7. 用户名密码登录失败')
    pass('7. 用户名密码登录仍可用')

    await prisma.user.update({
      where: { id: accountId },
      data: { emailVerifiedAt: null },
    })
    await expectCode(
      () => auth.login(email, password, 'partner'),
      'AUTH_LOGIN_FAILED',
      '4. 未验证邮箱不可作登录别名 → AUTH_LOGIN_FAILED',
    )
    // 恢复验证态供后续用例
    await prisma.user.update({
      where: { id: accountId },
      data: { emailVerifiedAt: new Date(), emailVerifyMethod: 'admin_manual' },
    })

    const other = await svc.createAccount(
      orgId,
      {
        username: `vea_other_${suffix}`,
        password: `OtherPass_${suffix}`,
        name: '第二账号',
        phone: `137${Date.now().toString().slice(-8)}`,
      },
      admin,
    )
    otherAccountId = other.id
    await expectCode(
      () => svc.bindAccountEmail(orgId, otherAccountId, { email, confirmVerified: true }, admin),
      'EMAIL_ALREADY_BOUND',
      '5. 邮箱占用 → EMAIL_ALREADY_BOUND',
    )

    const before = await prisma.user.findUniqueOrThrow({ where: { id: accountId }, select: { tokenVersion: true } })
    const rebound = await svc.bindAccountEmail(orgId, accountId, { email: email2, confirmVerified: true }, admin)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: accountId }, select: { tokenVersion: true, emailVerifyMethod: true } })
    if (after.tokenVersion !== before.tokenVersion + 1) fail('6. 换绑未递增 tokenVersion')
    if (after.emailVerifyMethod !== 'admin_manual') fail('6. 换绑未保留 admin_manual')
    if (rebound.emailMasked !== maskEmail(email2) && !rebound.emailMasked?.includes('***')) {
      fail('6. 换绑脱敏异常')
    }
    const loginNew = await auth.login(email2, password, 'partner')
    if (loginNew.user.id !== accountId) fail('6. 新邮箱无法登录')
    await expectCode(
      () => auth.login(email, password, 'partner'),
      'AUTH_LOGIN_FAILED',
      '6. 旧邮箱换绑后不可登录',
    )
    pass('6. 换绑递增 tokenVersion + 新邮箱可登录 + 旧邮箱失效')

    const audits = await prisma.auditLog.findMany({
      where: { actorId: admin.userId, action: 'org.account.bind_email' },
    })
    if (audits.length < 2) fail('审计条数不足')
    for (const a of audits) {
      if (a.payloadJson?.includes(email) || a.payloadJson?.includes(email2)) {
        fail('审计 payload 含明文邮箱')
      }
      if (!a.payloadJson?.includes('admin_manual')) fail('审计未记录 emailVerifyMethod')
    }
    pass('审计：bind_email 脱敏 + admin_manual')

    console.log('\n全部通过\n')
  } catch (e) {
    console.error(e)
    await cleanup()
    process.exit(1)
  }

  await cleanup()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
