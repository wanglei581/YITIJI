import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { FirstOrderReportSnapshot } from '@ai-job-print/shared'
import { AuditService } from '../../src/audit/audit.service'
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
  async function request<T>(actor: 'admin' | 'partner', path: string, expected = 200, body?: unknown): Promise<T> {
    const response = await fetch(`${f.base}${path}`, {
      method: body === undefined ? 'GET' : 'PATCH',
      headers: { Authorization: `Bearer ${f.tokens[actor]}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
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
    for (const role of ['admin', 'partner'] as const) {
      const response = await fetch(`${f.base}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f.credentials[role], portal: role }),
      })
      check(`完整应用${role}真实密码登录返回201`, response.status === 201)
      const login = await response.json() as { data: { token: string; user: { id: string; role: string; orgId: string | null } } }
      const expectedOrg = role === 'admin' ? null : f.orgs.own
      check(`完整应用${role}登录身份与机构匹配`, typeof login.data?.token === 'string' && login.data.token.length > 0 && login.data.user.id === f.users[role] && login.data.user.role === role && login.data.user.orgId === expectedOrg)
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
    return checks
  } finally { await f.close() }
}
