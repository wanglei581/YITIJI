/**
 * 阶段1B — Admin 合作机构管理验证。
 *
 * 覆盖(对应需求验收点):
 *   1.  创建机构 + 初始账号:org 落库,账号 role=partner、密码 bcrypt,可用其登录(AuthService)。
 *   2.  响应不泄密:列表/详情 JSON 不含 passwordHash / 明文密码。
 *   3.  档案编辑:字段落库;启用模块白名单 —— 招聘闭环模块 → MODULE_PROHIBITED 硬拒绝,
 *       未知模块 → MODULE_UNKNOWN,合法集合保存成功。
 *   4.  机构授权启停:disable → 该机构账号登录失败(AUTH_LOGIN_FAILED);enable → 恢复。
 *   5.  账号启停:disable → 登录失败;enable → 恢复。
 *   6.  重置密码:旧密码失效,新密码可登录。
 *   7.  用户名冲突 → USERNAME_TAKEN。
 *   8.  计数:accounts 计数与真实行数一致。
 *   9.  审计:org.create / org.update / org.disable / org.enable / org.account.* 全落 AuditLog,
 *       且审计 payload 内绝不出现明文密码。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:admin-orgs
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { AuthService } from '../src/auth/auth.service'
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
    fail(`${label} — 期望错误 ${code},但调用成功`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code},实际: ${c ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== 阶段1B Admin 合作机构管理验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const svc = new AdminOrgsService(prisma, audit)
  const auth = new AuthService(new JwtService({ secret: 'verify-admin-orgs-test-secret' }), prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const adminRow = await prisma.user.create({
    data: { username: `vao_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const admin: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  const username = `vao_partner_${suffix}`
  const passwordV1 = `InitPass_${suffix}`
  const passwordV2 = `ResetPass_${suffix}`
  let orgId = ''

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `vao_partner_${suffix}` } } })
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { actorId: admin.userId } })
    await prisma.user.delete({ where: { id: admin.userId } }).catch(() => undefined)
  }

  try {
    // ── 1. 创建机构 + 初始账号 ─────────────────────────────────────────────
    {
      const detail = await svc.createOrg(
        {
          name: `验证机构_${suffix}`,
          type: 'public_employment_service',
          contact: '验证联系人',
          contactPhone: '0532-12345678',
          sceneTemplate: 'public_employment',
          enabledModules: ['print_scan', 'policy_service', 'job_info'],
          account: { username, password: passwordV1, name: '机构账号' },
        },
        admin,
      )
      orgId = detail.id
      if (detail.accounts.length !== 1 || detail.accounts[0].username !== username) fail('1. 初始账号未创建')
      const userRow = await prisma.user.findUnique({ where: { username } })
      if (!userRow || userRow.role !== 'partner' || userRow.orgId !== orgId) fail('1. 账号 role/orgId 错误')
      if (userRow.passwordHash === passwordV1 || !userRow.passwordHash.startsWith('$2')) fail('1. 密码未 bcrypt 哈希')
      const login = await auth.login(username, passwordV1)
      if (login.user.orgId !== orgId) fail('1. 初始账号无法登录')
      pass('1. 创建机构 + 初始账号(bcrypt + 可登录,orgId 正确)')
    }

    // ── 2. 响应不泄密 ──────────────────────────────────────────────────────
    {
      const list = await svc.listOrgs()
      const detail = await svc.getOrgDetail(orgId)
      const raw = JSON.stringify({ list, detail })
      if (raw.includes('passwordHash') || raw.includes(passwordV1)) fail('2. 响应泄露密码信息')
      pass('2. 列表/详情响应不含 passwordHash / 明文密码')
    }

    // ── 3. 档案编辑 + 模块白名单 ───────────────────────────────────────────
    {
      const updated = await svc.updateOrg(orgId, { name: `验证机构改_${suffix}`, enabledModules: ['resume_service', 'print_scan'] }, admin)
      if (updated.name !== `验证机构改_${suffix}` || updated.enabledModules.join(',') !== 'resume_service,print_scan') {
        fail('3. 档案编辑未生效')
      }
      pass('3a. 档案编辑落库(名称 + 启用模块)')

      await expectCode(
        () => svc.updateOrg(orgId, { enabledModules: ['print_scan', 'candidate_management'] }, admin),
        'MODULE_PROHIBITED',
        '3b. 招聘闭环模块(candidate_management)硬拒绝',
      )
      await expectCode(
        () => svc.updateOrg(orgId, { enabledModules: ['no_such_module'] }, admin),
        'MODULE_UNKNOWN',
        '3c. 未知模块拒绝',
      )
    }

    // ── 4. 机构授权启停 → 登录闸 ───────────────────────────────────────────
    {
      await svc.setOrgStatus(orgId, 'disable', admin)
      await expectCode(() => auth.login(username, passwordV1), 'AUTH_LOGIN_FAILED', '4a. 机构停用后账号登录被拒')
      await svc.setOrgStatus(orgId, 'enable', admin)
      await auth.login(username, passwordV1)
      pass('4b. 机构恢复后登录恢复')
    }

    // ── 5. 账号启停 ────────────────────────────────────────────────────────
    {
      const detail = await svc.getOrgDetail(orgId)
      const accountId = detail.accounts[0].id
      await svc.setAccountStatus(orgId, accountId, 'disable', admin)
      await expectCode(() => auth.login(username, passwordV1), 'AUTH_LOGIN_FAILED', '5a. 账号停用后登录被拒')
      await svc.setAccountStatus(orgId, accountId, 'enable', admin)
      await auth.login(username, passwordV1)
      pass('5b. 账号恢复后登录恢复')

      // ── 6. 重置密码 ──────────────────────────────────────────────────────
      await svc.resetAccountPassword(orgId, accountId, passwordV2, admin)
      await expectCode(() => auth.login(username, passwordV1), 'AUTH_LOGIN_FAILED', '6a. 旧密码失效')
      await auth.login(username, passwordV2)
      pass('6b. 新密码可登录')
    }

    // ── 7. 用户名冲突 ──────────────────────────────────────────────────────
    await expectCode(
      () => svc.createAccount(orgId, { username, password: 'AnotherPass123', name: '重复账号' }, admin),
      'USERNAME_TAKEN',
      '7. 重复用户名 → USERNAME_TAKEN',
    )

    // ── 8. 计数 ────────────────────────────────────────────────────────────
    {
      await svc.createAccount(orgId, { username: `${username}_2`, password: 'AnotherPass123', name: '第二账号' }, admin)
      const list = await svc.listOrgs()
      const hit = list.find((o) => o.id === orgId)
      if (!hit || hit.counts.accounts !== 2) fail(`8. accounts 计数错误: ${hit?.counts.accounts}`)
      pass('8. accounts 计数与真实行数一致')
    }

    // ── 9. 审计 ────────────────────────────────────────────────────────────
    {
      const logs = await prisma.auditLog.findMany({ where: { actorId: admin.userId } })
      const actions = new Set(logs.map((l) => l.action))
      for (const expected of [
        'org.create', 'org.account.create', 'org.update', 'org.disable', 'org.enable',
        'org.account.disable', 'org.account.enable', 'org.account.reset_password',
      ]) {
        if (!actions.has(expected)) fail(`9. 缺少审计动作 ${expected};实际: ${[...actions].join(', ')}`)
      }
      const rawLogs = JSON.stringify(logs)
      if (rawLogs.includes(passwordV1) || rawLogs.includes(passwordV2)) fail('9. 审计日志泄露明文密码')
      pass('9. 8 类审计动作齐全,且审计不含明文密码')
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e)
  process.exit(1)
})
