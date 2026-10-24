import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import * as bcrypt from 'bcryptjs'
import type { FirstOrderOverview, FirstOrderReportSnapshot } from '@ai-job-print/shared'
import { AuditService } from '../../src/audit/audit.service'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import { assignTerminalOrganization, type TerminalOrgAssignmentAudit } from '../../src/terminals/terminal-org-assignment'
import { createFirstOrderFixture, previousMonth } from './first-order-fixture'

/** Claude review regressions: owned DB/Redis, complete AppModule, real guards and transactions. */
export async function verifyFirstOrderReviewBoundaries(mode: 'sqlite' | 'postgres'): Promise<number> {
  const f = await createFirstOrderFixture({ mode, fullApp: true })
  let checks = 0
  const check = (name: string, condition: unknown) => {
    assert.ok(condition, name)
    checks++
    console.log(`  ✓ ${name}`)
  }
  const audit = new AuditService(f.prisma)
  const writeAudit: TerminalOrgAssignmentAudit = (tx, result) => audit.writeRequired(tx, {
    actorId: f.users.admin, actorRole: 'admin', action: 'terminal.org.update',
    targetType: 'terminal', targetId: result.terminalCode, payload: { ...result },
  })
  async function request<T>(actor: 'admin' | 'partner', path: string, expected = 200, body?: unknown, method?: 'GET' | 'POST' | 'PATCH', token = f.tokens[actor]): Promise<T> {
    const verb = method ?? (body === undefined ? 'GET' : 'PATCH')
    const response = await fetch(`${f.base}${path}`, {
      method: verb,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    assert.equal(response.status, expected, `${path}: ${response.status}: ${text.slice(0, 400)}`)
    checks++
    return JSON.parse(text) as T
  }
  const { from, to, month } = previousMonth()
  const beforeMonth = new Date(from.getTime() - 86_400_000)
  async function project() {
    return f.prisma.serviceProject.create({ data: {
      orgId: f.orgs.own, name: '审查边界真实数据库夹具', reference: randomUUID(),
      serviceStartAt: beforeMonth, serviceEndAt: new Date(Date.now() + 365 * 86_400_000),
      serviceScope: '仅合成业务事实，不证明真机出纸', supportContact: '验证窗口',
    } })
  }
  async function terminal(orgBoundAt = beforeMonth) {
    const id = `review-${randomUUID()}`
    return f.prisma.terminal.create({ data: {
      id, terminalCode: id, agentToken: randomUUID(), deviceFingerprint: id,
      orgId: f.orgs.own, orgBoundAt, enabled: true, lifecycleStatus: 'active',
    } })
  }
  async function deployment(terminalId: string, startedAt: Date, endedAt: Date | null = null) {
    const p = await project()
    return f.prisma.serviceDeployment.create({ data: {
      projectId: p.id, orgId: f.orgs.own, terminalId, terminalCode: terminalId,
      activeTerminalId: endedAt ? null : terminalId, startedAt, endedAt, locationLabel: '边界验证位置',
    } })
  }
  try {
    console.log(`Full AppModule review boundaries: real ${mode}, isolated services.`)
    assert.ok(f.credentials, '完整应用夹具必须提供本次随机生成的登录凭据')
    // 真实 /auth/login 为每 IP 60 秒 5 次。本夹具开头两次登录计入同一计数，满 4 次先等满 61 秒，不清键、不改 Guard、不送 XFF。
    let passwordLoginPosts = 0
    async function postPasswordLogin(body: { loginId: string; password: string; portal: 'admin' | 'partner' }): Promise<Response> {
      if (passwordLoginPosts >= 4) {
        await new Promise((resolve) => setTimeout(resolve, 61_000))
        passwordLoginPosts = 0
      }
      passwordLoginPosts += 1
      return fetch(`${f.base}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }
    await f.prisma.user.update({ where: { id: f.users.partner }, data: { passwordProofState: 'owner_managed' } })
    for (const role of ['admin', 'partner'] as const) {
      const response = await postPasswordLogin({ ...f.credentials[role], portal: role })
      check(`完整应用${role}真实密码登录返回201`, response.status === 201)
      const login = await response.json() as { data: { token: string; user: { id: string; role: string; orgId: string | null; phoneVerificationAvailable?: boolean } } }
      const expectedOrg = role === 'admin' ? null : f.orgs.own
      check(`完整应用${role}登录身份与机构匹配`, typeof login.data?.token === 'string' && login.data.token.length > 0 && login.data.user.id === f.users[role] && login.data.user.role === role && login.data.user.orgId === expectedOrg)
      if (role === 'partner') check('owner_managed机构账号登录响应phoneVerificationAvailable为true', login.data.user.phoneVerificationAvailable === true)
      // Use the actual AuthService-issued token, never a different module's JwtService.
      f.tokens[role] = login.data.token
      const me = await request<{ data: { userId: string; role: string; orgId: string | null } }>(role, '/auth/me')
      check(`完整应用${role}当前账号通过真实鉴权`, me.data.userId === f.users[role] && me.data.role === role && me.data.orgId === expectedOrg)
    }
    const device = await terminal()
    const active = await deployment(device.id, beforeMonth)
    const bindingState = async () => ({
      terminal: await f.prisma.terminal.findUniqueOrThrow({ where: { id: device.id }, select: { orgId: true, orgBoundAt: true } }),
      deployment: await f.prisma.serviceDeployment.findUniqueOrThrow({ where: { id: active.id }, select: { endedAt: true, activeTerminalId: true } }),
    })
    const original = await bindingState()
    const deploymentCount = await f.prisma.serviceDeployment.count({ where: { terminalId: device.id } })
    await f.prisma.$transaction(async (tx) => {
      if (mode === 'postgres') {
        await tx.$executeRawUnsafe(`CREATE FUNCTION review_rebind_reject_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'terminal.org.update' THEN RAISE EXCEPTION 'fixture required audit unavailable'; END IF; RETURN NEW; END $$`)
        await tx.$executeRawUnsafe(`CREATE TRIGGER review_rebind_reject BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION review_rebind_reject_fn()`)
      } else await tx.$executeRawUnsafe(`CREATE TRIGGER review_rebind_reject BEFORE INSERT ON "AuditLog" WHEN NEW.action = 'terminal.org.update' BEGIN SELECT RAISE(ABORT, 'fixture required audit unavailable'); END`)
    })
    try {
      await request('admin', `/admin/terminals/${device.id}/org`, 500, { orgId: f.orgs.other })
      assert.deepEqual(await bindingState(), original, 'HTTP审计失败必须同时回滚归属、绑定时间、部署结束时间和有效设备槽')
      assert.equal(await f.prisma.serviceDeployment.count({ where: { terminalId: device.id } }), deploymentCount, 'HTTP审计失败不得残留或删除部署')
      checks += 2
      check('完整应用审计被拒绝后没有遗留改绑审计', await f.prisma.auditLog.count({ where: { action: 'terminal.org.update', targetId: device.terminalCode } }) === 0)
    } finally {
      await f.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DROP TRIGGER review_rebind_reject${mode === 'postgres' ? ' ON "AuditLog"' : ''}`)
        if (mode === 'postgres') await tx.$executeRawUnsafe('DROP FUNCTION review_rebind_reject_fn()')
      })
    }
    await request('admin', `/admin/terminals/${device.id}/org`, 200, { orgId: f.orgs.other })
    const committed = await bindingState()
    const rows = await f.prisma.auditLog.findMany({ where: { action: 'terminal.org.update', targetId: device.terminalCode } })
    check('恢复审计后真实HTTP改绑成功并关闭旧部署', committed.terminal.orgId === f.orgs.other && !!committed.deployment.endedAt && committed.deployment.activeTerminalId === null)
    check('成功改绑恰好一条操作者审计', rows.length === 1 && rows[0].actorId === f.users.admin && rows[0].actorRole === 'admin')
    const payload = JSON.parse(rows[0].payloadJson) as Record<string, unknown>
    assert.deepEqual(payload.deploymentIds, [active.id])
    check('审计包含旧新机构、关闭部署和真实有效时间', payload.oldOrgId === f.orgs.own && payload.newOrgId === f.orgs.other && payload.effectiveAt === committed.terminal.orgBoundAt?.toISOString() && payload.effectiveAt === committed.deployment.endedAt?.toISOString())

    // Keep each lower bound after the injected clock but before the wall clock,
    // so ignoring the optional clock cannot accidentally satisfy these assertions.
    const day = 86_400_000, nowMs = Date.now(), earliest = beforeMonth.getTime()
    const room = nowMs - earliest
    const align = (ms: number) => Math.floor(ms / 1000) * 1000
    const backwardsNow = new Date(align(earliest - 180 * day))
    const midBound = new Date(align(earliest + room / 4))
    const midEnd = new Date(align(earliest + room / 2))
    const midStart = new Date(align(earliest + room * 3 / 4))
    check('回拨夹具下界位于注入时钟与真实墙钟之间', room > 4 * day && backwardsNow < midBound && midBound < midEnd && midEnd < midStart && midStart.getTime() > earliest && midStart.getTime() < nowMs)
    for (const source of ['orgBoundAt', 'latestEndedAt', 'activeStartedAt'] as const) {
      const t = await terminal(midBound)
      const d = source === 'latestEndedAt' ? await deployment(t.id, midBound, midEnd)
        : source === 'activeStartedAt' ? await deployment(t.id, midStart) : null
      const expected = source === 'orgBoundAt' ? midBound : source === 'latestEndedAt' ? midEnd : midStart
      const startedExpected = source === 'latestEndedAt' ? midBound : midStart
      await assignTerminalOrganization(f.prisma, t.id, f.orgs.other, backwardsNow, writeAudit)
      const after = await f.prisma.terminal.findUniqueOrThrow({ where: { id: t.id } })
      check(`时钟回拨受锁后${source}下界保护`, after.orgId === f.orgs.other && after.orgBoundAt?.getTime() === expected.getTime())
      const history = d ? await f.prisma.serviceDeployment.findUniqueOrThrow({ where: { id: d.id } }) : null
      if (history) check(`时钟回拨${source}不倒退或重写历史区间`, history.startedAt.getTime() === startedExpected.getTime() && history.endedAt?.getTime() === expected.getTime() && history.endedAt >= history.startedAt && history.activeTerminalId === null)
      const log = await f.prisma.auditLog.findMany({ where: { action: 'terminal.org.update', targetId: t.terminalCode } })
      const entry = log.length === 1 ? JSON.parse(log[0].payloadJson) as Record<string, unknown> : null
      check(`时钟回拨${source}同事务审计记录有效时间`, !!entry && entry.effectiveAt === after.orgBoundAt?.toISOString() && entry.oldOrgId === f.orgs.own && entry.newOrgId === f.orgs.other)
    }

    async function reportCase(printed: number, failed: number, unconfirmed: number, missingPages: boolean) {
      const t = await terminal()
      const d = await deployment(t.id, beforeMonth)
      for (const [kind, count] of [['printed', printed], ['failed', failed], ['unconfirmed', unconfirmed]] as const) {
        for (let index = 0; index < count; index++) {
          const id = randomUUID()
          await f.prisma.printTask.create({ data: {
            id, terminalId: t.id, fileUrl: 'https://fixture.invalid/synthetic.pdf', fileMd5: 'a'.repeat(32), paramsJson: '{"copies":1}',
            createdAt: new Date(from.getTime() + 1000), completedAt: new Date(from.getTime() + 2000),
            status: kind === 'printed' ? 'completed' : 'failed', printOutcome: kind === 'printed' ? 'printed' : null,
            errorCode: kind === 'unconfirmed' ? 'PRINT_JOB_UNCONFIRMED' : null,
          } })
          if (kind === 'printed' && (!missingPages || index === 0)) await f.prisma.order.create({ data: {
            orderNo: `REVIEW-${id}`, printTaskId: id, terminalId: t.id, billablePages: 2,
            amountCents: 0, paymentSource: 'free', payStatus: 'paid',
          } })
        }
      }
      return request<FirstOrderReportSnapshot>('partner', `/partner/first-order/projects/${d.projectId}/report-preview?month=${month}`)
    }
    const mixed = await reportCase(12, 0, 0, true)
    check('12条可信出纸仅一条有2印面不会误抑制充足任务计数', mixed.metrics.printedTasks.value === 12 && mixed.metrics.printedTasks.state === 'measured')
    check('混合缺页整项印面仍未知而非输出少算合计', mixed.metrics.printedFaces.value === null && mixed.metrics.printedFaces.state === 'unverified' && mixed.complete === false)
    for (const kind of ['printed', 'failed', 'unconfirmed'] as const) for (const small of [1, 4]) {
      const report = await reportCase(kind === 'printed' ? small : 12, kind === 'failed' ? small : 0, kind === 'unconfirmed' ? small : 0, kind !== 'printed')
      check(`真实${kind}小样本${small}仍抑制整个可计数打印组`, ['printedTasks', 'failedPrints', 'unconfirmedPrints'].every((key) => {
        const metric = report.metrics[key as 'printedTasks' | 'failedPrints' | 'unconfirmedPrints']
        return metric.value === null && metric.state === 'sample_suppressed'
      }))
      check(`真实${kind}小样本${small}不泄漏印面`, report.metrics.printedFaces.value === null && report.metrics.printedFaces.state === (kind === 'printed' ? 'sample_suppressed' : 'unverified'))
    }
    for (const kind of ['failed', 'unconfirmed'] as const) {
      const report = await reportCase(12, kind === 'failed' ? 1 : 0, kind === 'unconfirmed' ? 1 : 0, false)
      check(`页数齐全时${kind}小样本仍抑制整组且不泄漏印面`, (['printedTasks', 'failedPrints', 'unconfirmedPrints', 'printedFaces'] as const).every((key) => {
        const metric = report.metrics[key]
        return metric.value === null && metric.state === 'sample_suppressed'
      }))
    }
    // Month boundary object is reused above; ensure reports cover the full closed month.
    check('新增报告回归仍使用同一完整北京时间自然月', mixed.window.from === from.toISOString() && mixed.window.to === to.toISOString())

    // §18.4 开户边界只复用本 fullApp 夹具。报障、受理、确认已在总套件，这里不重放。
    // 手机号、用户名和密码只在本次进程内随机生成。
    const reservedPhones = new Set(['13800000000', '13800000001'])
    const mobile = () => {
      let phone = ''
      do phone = `139${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`
      while (reservedPhones.has(phone))
      reservedPhones.add(phone)
      return phone
    }
    const secret = () => `Aa1!${randomBytes(18).toString('base64url')}`
    const letterUser = () => `p${randomBytes(6).toString('hex')}`
    type NewAccount = { id: string; username: string; enabled: boolean; canRegisterContactPhone: boolean; phoneVerifiedAt: string | null; phoneRegisteredByAdminAt: string | null }
    async function createdAccount(orgId: string, username: string, phone: string, password: string) {
      const created = await request<NewAccount>('admin', `/admin/orgs/${orgId}/accounts`, 201, { username, password, name: '合成机构账号', phone }, 'POST')
      const row = await f.prisma.user.findUniqueOrThrow({ where: { id: created.id }, select: { orgId: true, enabled: true, passwordProofState: true, phoneVerifiedAt: true, phoneRegisteredByAdminAt: true } })
      check('新建账号HTTP为启用且未验证未登记', created.enabled === true && created.phoneVerifiedAt === null && created.phoneRegisteredByAdminAt === null && created.canRegisterContactPhone === true && created.username === username && !('password' in created) && !('passwordHash' in created))
      check('新建账号库存仍是临时证明', row.orgId === orgId && row.enabled && row.passwordProofState === 'temporary' && row.phoneVerifiedAt === null && row.phoneRegisteredByAdminAt === null)
      return created
    }
    async function partnerLogin(name: string, loginId: string, password: string, expected: number) {
      const response = await postPasswordLogin({ loginId, password, portal: 'partner' })
      const text = await response.text()
      assert.equal(response.status, expected, `${name}: ${response.status}: ${text.slice(0, 180)}`)
      checks++
      console.log(`  ✓ ${name}`)
      return (text ? JSON.parse(text) : {}) as { data?: { token?: string; user?: { id?: string; phoneVerificationAvailable?: boolean } } }
    }
    async function seeOwnTerminals(token: string, accountId: string) {
      const me = await request<{ data: { userId: string; role: string; orgId: string | null } }>('partner', '/auth/me', 200, undefined, 'GET', token)
      check('首次登录后auth/me是本机构身份', me.data.userId === accountId && me.data.role === 'partner' && me.data.orgId === f.orgs.own)
      const overview = await request<FirstOrderOverview>('partner', '/partner/first-order/overview', 200, undefined, 'GET', token)
      const ids = overview.terminals.map((item) => item.id)
      check('首次登录总览可见本机构终端且不见另一机构', ids.includes(f.terminals.monthly) && ids.includes(f.terminals.spare) && !ids.includes(f.terminals.other))
    }
    async function rejectedCreate(status: 400 | 409, username: string, phone: string, name: string) {
      const before = await f.prisma.user.count()
      const existing = await f.prisma.user.findUnique({ where: { username }, select: { id: true } })
      await request('admin', `/admin/orgs/${f.orgs.own}/accounts`, status, { username, password: secret(), name: '合成机构账号', phone }, 'POST')
      const after = await f.prisma.user.findUnique({ where: { username }, select: { id: true } })
      check(name, await f.prisma.user.count() === before && after?.id === existing?.id)
    }
    const phoneUser = mobile()
    const phonePassword = secret()
    const phoneAccount = await createdAccount(f.orgs.own, phoneUser, phoneUser, phonePassword)
    const phoneSession = await partnerLogin('手机号用户名首次密码登录201', phoneUser, phonePassword, 201)
    check('手机号用户名临时账号phoneVerificationAvailable为false', phoneSession.data?.user?.id === phoneAccount.id && phoneSession.data?.user?.phoneVerificationAvailable === false)
    await seeOwnTerminals(phoneSession.data?.token ?? '', phoneAccount.id)
    const letter = letterUser()
    const letterPhone = mobile()
    const letterPassword = secret()
    const letterAccount = await createdAccount(f.orgs.own, letter, letterPhone, letterPassword)
    const letterSession = await partnerLogin('字母用户名首次密码登录201', letter, letterPassword, 201)
    check('字母用户名临时账号phoneVerificationAvailable为false', letterSession.data?.user?.id === letterAccount.id && letterSession.data?.user?.phoneVerificationAvailable === false)
    await seeOwnTerminals(letterSession.data?.token ?? '', letterAccount.id)
    const phoneCode = await request<{ error?: { code?: string } }>('partner', '/auth/phone/code', 409, {}, 'POST', letterSession.data?.token ?? '')
    const afterCode = await f.prisma.user.findUniqueOrThrow({ where: { id: letterAccount.id }, select: { phoneVerifiedAt: true, passwordProofState: true } })
    check('临时账号phone/code仍409且未写成已验证', phoneCode.error?.code === 'ACCOUNT_PASSWORD_PROOF_NOT_READY' && afterCode.phoneVerifiedAt === null && afterCode.passwordProofState === 'temporary')
    await rejectedCreate(400, mobile(), mobile(), '手机号形态用户名与手机号不符返回400且无残留')
    await rejectedCreate(409, letterPhone, letterPhone, '同一号码用户名交叉占用返回409且无残留')
    const occupied = mobile()
    const occupiedElsewhere = mobile()
    const occupiedId = `fo-x-${randomUUID()}`
    await f.prisma.user.create({ data: {
      id: occupiedId, username: occupied, name: '合成用户名占号', role: 'partner', orgId: f.orgs.own, enabled: true,
      passwordHash: await bcrypt.hash(secret(), 4), passwordProofState: 'temporary',
      phoneHash: hashPhone(occupiedElsewhere), phoneEnc: encryptPhone(occupiedElsewhere),
    } })
    const occupiedBefore = await f.prisma.user.findUniqueOrThrow({ where: { id: occupiedId }, select: { phoneHash: true } })
    const countBefore = await f.prisma.user.count()
    await request('admin', `/admin/orgs/${f.orgs.own}/accounts`, 409, { username: letterUser(), password: secret(), name: '合成机构账号', phone: occupied }, 'POST')
    const occupiedAfter = await f.prisma.user.findUniqueOrThrow({ where: { id: occupiedId }, select: { phoneHash: true } })
    check('手机号撞上已有用户名返回409且无部分账号', await f.prisma.user.count() === countBefore && occupiedAfter.phoneHash === occupiedBefore.phoneHash && occupiedAfter.phoneHash === hashPhone(occupiedElsewhere))
    const verifiedPhone = mobile()
    const passwordA = secret()
    const passwordB = secret()
    const idA = `fo-a-${randomUUID()}`
    const idB = `fo-b-${randomUUID()}`
    await f.prisma.user.create({ data: {
      id: idA, username: letterUser(), name: '合成已验证账号', role: 'partner', orgId: f.orgs.own, enabled: true,
      passwordHash: await bcrypt.hash(passwordA, 4), passwordProofState: 'owner_managed',
      phoneHash: hashPhone(verifiedPhone), phoneEnc: encryptPhone(verifiedPhone), phoneVerifiedAt: new Date(), lastLoginAt: null,
    } })
    await f.prisma.user.create({ data: {
      id: idB, username: verifiedPhone, name: '合成冲突用户名', role: 'partner', orgId: f.orgs.own, enabled: true,
      passwordHash: await bcrypt.hash(passwordB, 4), passwordProofState: 'temporary', lastLoginAt: null,
    } })
    await partnerLogin('冲突用户名密码不能登录已验证手机号', verifiedPhone, passwordB, 401)
    const blockedB = await f.prisma.user.findUniqueOrThrow({ where: { id: idB }, select: { lastLoginAt: true } })
    const loginA = await partnerLogin('已验证手机号使用账号A密码登录', verifiedPhone, passwordA, 201)
    const afterB = await f.prisma.user.findUniqueOrThrow({ where: { id: idB }, select: { lastLoginAt: true } })
    const afterA = await f.prisma.user.findUniqueOrThrow({ where: { id: idA }, select: { lastLoginAt: true } })
    check('已验证手机号优先登录A，B的lastLoginAt始终不变', loginA.data?.user?.id === idA && loginA.data?.user?.phoneVerificationAvailable === true && blockedB.lastLoginAt === null && afterB.lastLoginAt === null && afterA.lastLoginAt !== null)
    await partnerLogin('未验证字母账号的手机号不能作为登录别名', letterPhone, letterPassword, 401)
    await partnerLogin('+86输入不能作为未验证手机号用户名的别名', `+86${phoneUser}`, phonePassword, 401)
    await request('admin', `/admin/orgs/${f.orgs.own}/accounts/${phoneAccount.id}/status`, 200, { action: 'disable' })
    const disabledRow = await f.prisma.user.findUniqueOrThrow({ where: { id: phoneAccount.id }, select: { enabled: true, deletedAt: true } })
    check('停用账号仍保留且enabled为false', disabledRow.enabled === false && disabledRow.deletedAt === null)
    const offOrg = `fo-off-${randomUUID().slice(0, 8)}`
    await f.prisma.organization.create({ data: { id: offOrg, name: '合成停用机构', type: 'public_employment_service', enabled: true, contentTrustStatus: 'active' } })
    const offUser = letterUser()
    const offPassword = secret()
    await createdAccount(offOrg, offUser, mobile(), offPassword)
    await request('admin', `/admin/orgs/${offOrg}/status`, 200, { action: 'disable' })
    check('停用机构已落库', (await f.prisma.organization.findUniqueOrThrow({ where: { id: offOrg }, select: { enabled: true } })).enabled === false)
    const nextPassword = secret()
    const changedBody = await request<{ data: { success: true } }>('partner', '/auth/password/change', 201, { currentPassword: letterPassword, newPassword: nextPassword }, 'POST', letterSession.data?.token ?? '')
    const changed = await f.prisma.user.findUniqueOrThrow({ where: { id: letterAccount.id }, select: { passwordProofState: true, passwordHash: true, phoneVerifiedAt: true } })
    check('自行改密不提升证明且旧密码哈希失效', changedBody.data.success === true && changed.passwordProofState === 'temporary' && changed.phoneVerifiedAt === null && !(await bcrypt.compare(letterPassword, changed.passwordHash)) && await bcrypt.compare(nextPassword, changed.passwordHash))
    await partnerLogin('停用账号密码登录401', phoneUser, phonePassword, 401)
    await partnerLogin('停用机构密码登录401', offUser, offPassword, 401)
    await partnerLogin('自行改密后旧密码失效', letter, letterPassword, 401)
    await f.prisma.user.update({ where: { id: idA }, data: { enabled: false } })
    await partnerLogin('停用已验证手机号不回退到冲突用户名', verifiedPhone, passwordB, 401)
    return checks
  } finally { await f.close() }
}
