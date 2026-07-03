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
 *   10. 机构类型矩阵:type → sceneTemplate → enabledModules 写路径硬约束;历史不合规数据
 *       grandfather,无关字段编辑 / 读取 / 登录 / 启停不被误伤。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:admin-orgs
 */
import 'dotenv/config'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { AuthService } from '../src/auth/auth.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

process.env['DATABASE_URL'] ||= 'file:./prisma/dev.db'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-admin-orgs-secret-32-bytes-ok'

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
  const redis = { del: async () => 1 } as never
  const auth = new AuthService(
    new JwtService({ secret: 'verify-admin-orgs-test-secret' }),
    prisma,
    redis,
    {} as never,
    audit,
  )
  const svc = new AdminOrgsService(prisma, audit, redis)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const adminRow = await prisma.user.create({
    data: { username: `vao_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const admin: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  const username = `vao_partner_${suffix}`
  const phone = `139${Date.now().toString().slice(-8)}`
  const passwordV1 = `InitPass_${suffix}`
  const passwordV2 = `ResetPass_${suffix}`
  let orgId = ''
  let legacyOrgId = ''
  let legacyUsername = ''
  let legacyPassword = ''

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `vao_partner_${suffix}` } } })
    await prisma.organization.deleteMany({ where: { name: { contains: suffix } } }).catch(() => undefined)
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined)
    if (legacyOrgId) await prisma.organization.delete({ where: { id: legacyOrgId } }).catch(() => undefined)
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
          account: { username, password: passwordV1, name: '机构账号', phone },
        },
        admin,
      )
      orgId = detail.id
      if (detail.accounts.length !== 1 || detail.accounts[0].username !== username) fail('1. 初始账号未创建')
      const userRow = await prisma.user.findUnique({ where: { username } })
      if (!userRow || userRow.role !== 'partner' || userRow.orgId !== orgId) fail('1. 账号 role/orgId 错误')
      if (userRow.passwordHash === passwordV1 || !userRow.passwordHash.startsWith('$2')) fail('1. 密码未 bcrypt 哈希')
      if (!userRow.phoneHash || !userRow.phoneEnc || userRow.phoneVerifiedAt) fail('1. 登录手机号未绑定或被错误标为已验证')
      const login = await auth.login(username, passwordV1, 'partner')
      if (login.user.orgId !== orgId) fail('1. 初始账号无法登录')
      pass('1. 创建机构 + 初始账号(bcrypt + 可登录,orgId 正确 + 手机号待验证)')
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
      await expectCode(() => auth.login(username, passwordV1, 'partner'), 'AUTH_LOGIN_FAILED', '4a. 机构停用后账号登录被拒')
      await svc.setOrgStatus(orgId, 'enable', admin)
      await auth.login(username, passwordV1, 'partner')
      pass('4b. 机构恢复后登录恢复')
    }

    // ── 5. 账号启停 ────────────────────────────────────────────────────────
    {
      const detail = await svc.getOrgDetail(orgId)
      const accountId = detail.accounts[0].id
      await svc.setAccountStatus(orgId, accountId, 'disable', admin)
      await expectCode(() => auth.login(username, passwordV1, 'partner'), 'AUTH_LOGIN_FAILED', '5a. 账号停用后登录被拒')
      await svc.setAccountStatus(orgId, accountId, 'enable', admin)
      await auth.login(username, passwordV1, 'partner')
      pass('5b. 账号恢复后登录恢复')

      // ── 6. 重置密码 ──────────────────────────────────────────────────────
      await svc.resetAccountPassword(orgId, accountId, passwordV2, admin)
      await expectCode(() => auth.login(username, passwordV1, 'partner'), 'AUTH_LOGIN_FAILED', '6a. 旧密码失效')
      await auth.login(username, passwordV2, 'partner')
      pass('6b. 新密码可登录')
    }

    // ── 7. 用户名冲突 ──────────────────────────────────────────────────────
    await expectCode(
      () => svc.createAccount(orgId, { username, password: 'AnotherPass123', name: '重复账号', phone: `138${Date.now().toString().slice(-8)}` }, admin),
      'USERNAME_TAKEN',
      '7. 重复用户名 → USERNAME_TAKEN',
    )

    // ── 8. 计数 ────────────────────────────────────────────────────────────
    {
      await svc.createAccount(orgId, {
        username: `${username}_2`,
        password: 'AnotherPass123',
        name: '第二账号',
        phone: `137${Date.now().toString().slice(-8)}`,
      }, admin)
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

    // ── 10. 机构类型矩阵硬约束 + grandfather 兼容 ───────────────────────────
    {
      await expectCode(
        () => svc.createOrg(
          {
            name: `矩阵错误学校_${suffix}`,
            type: 'school_employment_center',
            sceneTemplate: 'public_employment',
            enabledModules: ['resume_service', 'smart_campus'],
          },
          admin,
        ),
        'ORG_TYPE_MATRIX_VIOLATION',
        '10a. 学校机构必须使用 school 场景模板',
      )

      await expectCode(
        () => svc.createOrg(
          {
            name: `矩阵错误人社_${suffix}`,
            type: 'public_employment_service',
            sceneTemplate: 'public_employment',
            enabledModules: ['policy_service', 'smart_campus'],
          },
          admin,
        ),
        'ORG_TYPE_MATRIX_VIOLATION',
        '10b. smart_campus 仅允许学校机构启用',
      )

      await expectCode(
        () => svc.createOrg(
          {
            name: `矩阵错误来源方_${suffix}`,
            type: 'enterprise_source',
            sceneTemplate: undefined,
            enabledModules: ['job_info'],
          },
          admin,
        ),
        'ORG_TYPE_MATRIX_VIOLATION',
        '10c. 企业数据来源方 source-only,不得启用运营模块',
      )

      await expectCode(
        () => svc.createOrg(
          {
            name: `矩阵错误招聘会方_${suffix}`,
            type: 'fair_organizer',
            sceneTemplate: undefined,
            enabledModules: ['job_fair'],
          },
          admin,
        ),
        'ORG_TYPE_MATRIX_VIOLATION',
        '10d. 招聘会主办方 source-only,不得启用前台招聘会模块',
      )

      const enterpriseSource = await svc.createOrg(
        {
          name: `矩阵合法来源方_${suffix}`,
          type: 'enterprise_source',
          sceneTemplate: undefined,
          enabledModules: [],
        },
        admin,
      )
      const fairOrganizer = await svc.createOrg(
        {
          name: `矩阵合法招聘会方_${suffix}`,
          type: 'fair_organizer',
          sceneTemplate: undefined,
          enabledModules: [],
        },
        admin,
      )
      await prisma.organization.deleteMany({ where: { id: { in: [enterpriseSource.id, fairOrganizer.id] } } })
      pass('10e. source-only 机构仅空模块集可创建')

      const typeSwitchOrg = await svc.createOrg(
        {
          name: `矩阵切换类型_${suffix}`,
          type: 'public_employment_service',
          sceneTemplate: 'public_employment',
          enabledModules: ['print_scan', 'policy_service'],
        },
        admin,
      )
      await expectCode(
        () => svc.updateOrg(typeSwitchOrg.id, { type: 'licensed_hr_agency' }, admin),
        'ORG_TYPE_MATRIX_VIOLATION',
        '10f. 修改 type 时必须同时满足目标类型矩阵',
      )
      await prisma.organization.delete({ where: { id: typeSwitchOrg.id } })

      const school = await svc.createOrg(
        {
          name: `矩阵合法学校_${suffix}`,
          type: 'school_employment_center',
          sceneTemplate: 'school',
          enabledModules: ['resume_service', 'print_scan', 'job_info', 'job_fair', 'smart_campus'],
        },
        admin,
      )
      await prisma.organization.delete({ where: { id: school.id } })
      pass('10g. 合法学校矩阵可创建并保留 smart_campus')

      legacyOrgId = `vao_legacy_${suffix}`
      legacyUsername = `vao_partner_${suffix}_legacy`
      legacyPassword = `LegacyPass_${suffix}`
      await prisma.organization.create({
        data: {
          id: legacyOrgId,
          name: `历史不合规机构_${suffix}`,
          type: 'enterprise_source',
          sceneTemplate: 'school',
          enabledModulesJson: JSON.stringify(['smart_campus', 'print_scan']),
        },
      })
      await prisma.user.create({
        data: {
          username: legacyUsername,
          passwordHash: await bcrypt.hash(legacyPassword, 10),
          name: '历史机构账号',
          role: 'partner',
          orgId: legacyOrgId,
        },
      })

      await svc.listOrgs()
      await svc.getOrgDetail(legacyOrgId)
      await svc.getOwnProfile({ userId: 'legacy-partner', role: 'partner', orgId: legacyOrgId })
      await auth.login(legacyUsername, legacyPassword, 'partner')
      await svc.setOrgStatus(legacyOrgId, 'disable', admin)
      await expectCode(() => auth.login(legacyUsername, legacyPassword, 'partner'), 'AUTH_LOGIN_FAILED', '10h. 历史机构停用仍走既有登录闸')
      await svc.setOrgStatus(legacyOrgId, 'enable', admin)
      await auth.login(legacyUsername, legacyPassword, 'partner')
      pass('10i. 历史不合规机构读取 / 登录 / 启停 grandfather 放行')

      const renamed = await svc.updateOrg(legacyOrgId, { contact: '历史联系人' }, admin)
      if (renamed.contact !== '历史联系人') fail('10j. 历史机构无关字段编辑未生效')
      pass('10j. 历史不合规机构仅编辑无关字段不触发矩阵误拒')

      const nullModules = await svc.updateOrg(
        legacyOrgId,
        { contact: '历史联系人-null', enabledModules: null as unknown as string[] },
        admin,
      )
      if (nullModules.contact !== '历史联系人-null') fail('10k. enabledModules=null 时无关字段编辑未生效')
      pass('10k. enabledModules=null 按未实际修改模块处理,不触发矩阵误拒')

      await expectCode(
        () => svc.updateOrg(legacyOrgId, { enabledModules: ['job_info', 'smart_campus'] }, admin),
        'ORG_TYPE_MATRIX_VIOLATION',
        '10l. 历史机构一旦实际修改矩阵字段,必须修正到合法矩阵',
      )

      const legacyProhibitedOrgId = `vao_legacy_prohibited_${suffix}`
      await prisma.organization.create({
        data: {
          id: legacyProhibitedOrgId,
          name: `历史闭环模块机构_${suffix}`,
          type: 'school_employment_center',
          sceneTemplate: 'school',
          enabledModulesJson: JSON.stringify(['candidate_management']),
        },
      })
      await expectCode(
        () => svc.updateOrg(legacyProhibitedOrgId, { type: 'public_employment_service' }, admin),
        'MODULE_PROHIBITED',
        '10m. 历史闭环模块参与矩阵字段变更时仍按 MODULE_PROHIBITED 最高优先级拒绝',
      )
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
