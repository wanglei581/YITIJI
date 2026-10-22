import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { FirstOrderIncident, FirstOrderOverview, FirstOrderProject, FirstOrderReport, FirstOrderReportSnapshot } from '@ai-job-print/shared'
import { createFirstOrderFixture, seedFirstOrderMonth } from './support/first-order-fixture'
import { assignTerminalOrganization } from '../src/terminals/terminal-org-assignment'

const A = '/admin/first-order', P = '/partner/first-order'
let checks = 0
function check(name: string, value: unknown): void {
  assert.ok(value, name)
  checks++
  console.log(`  ✓ ${name}`)
}

async function main() {
  const f = await createFirstOrderFixture({ mode: process.argv.includes('--postgres') ? 'postgres' : 'sqlite' })
  try {
    async function request<T = Record<string, unknown>>(
      actor: keyof typeof f.tokens | null, path: string, expected = 200, body?: unknown, method = body === undefined ? 'GET' : 'POST',
    ): Promise<T> {
      const response = await fetch(`${f.base}${path}`, {
        method, headers: { ...(actor ? { Authorization: `Bearer ${f.tokens[actor]}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, received ${response.status}: ${text.slice(0, 400)}`)
      checks++
      if (path.endsWith('/csv')) return text as T
      return (text ? JSON.parse(text) : null) as T
    }

    console.log(`First-order verification: real ${f.mode} + Redis + Nest HTTP + JWT/role guards; synthetic business facts, no hardware claim.`)
    const cors = await fetch(`${f.base}${P}/overview`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5174', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } })
    check('真实浏览器带凭据跨域预检明确允许本地页面', cors.status === 204 && cors.headers.get('access-control-allow-origin') === 'http://127.0.0.1:5174' && cors.headers.get('access-control-allow-credentials') === 'true')
    await request(null, `${P}/overview`, 401)
    await request('kiosk', `${P}/overview`, 403)
    await request('partner', `${A}/overview?orgId=${f.orgs.own}`, 403)
    await request('partner', `${P}/overview?orgId=${f.orgs.other}`, 400)
    const input = {
      name: 'HTTP登记项目', reference: `FIRST-${randomUUID()}`, orgId: f.orgs.own,
      serviceStartAt: new Date(Date.now() - 86_400_000).toISOString(), serviceEndAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      serviceScope: '免费求职准备与打印、年度技术服务', supportContact: '平台服务窗口',
    }
    const project = await request<FirstOrderProject>('admin', `${A}/projects`, 201, input)
    check('项目写入真实数据库', (await f.prisma.serviceProject.findUnique({ where: { id: project.id } }))?.reference === input.reference)
    await request('admin', `${A}/projects`, 409, input)
    await request('partner', `${A}/projects`, 403, input)
    const editable = { name: input.name, reference: input.reference, serviceStartAt: input.serviceStartAt, serviceEndAt: input.serviceEndAt, serviceScope: input.serviceScope, supportContact: input.supportContact }
    const updated = await request<FirstOrderProject>('admin', `${A}/projects/${project.id}`, 200, { ...editable, supportContact: '更新后的平台服务窗口', version: project.version }, 'PATCH')
    check('项目更新持久化并递增版本', updated.version === project.version + 1 && updated.supportContact === '更新后的平台服务窗口')
    await request('admin', `${A}/projects/${project.id}`, 409, { ...editable, version: project.version }, 'PATCH')
    await request('admin', `${A}/projects/${project.id}/deployments`, 400, { terminalId: f.terminals.spare, locationLabel: '大厅一楼', startedAt: '2026-01-01T00:00:00Z' })
    await request('admin', `${A}/projects/${project.id}/deployments`, 404, { terminalId: f.terminals.other, locationLabel: '越权设备' })
    const before = Date.now()
    const deployment = await request<{ id: string; startedAt: string }>('admin', `${A}/projects/${project.id}/deployments`, 201, { terminalId: f.terminals.spare, locationLabel: '大厅一楼' })
    check('设备登记时间由服务端产生，不倒填', new Date(deployment.startedAt).getTime() >= before)
    await request('admin', `${A}/projects/${project.id}/deployments`, 409, { terminalId: f.terminals.spare, locationLabel: '重复登记' })
    const dateConflict = await request<{ error: { code: string } }>('admin', `${A}/projects/${project.id}`, 409, { ...editable, version: updated.version, serviceEndAt: new Date(new Date(editable.serviceEndAt).getTime() + 86_400_000).toISOString() }, 'PATCH')
    check('已有登记后服务日期不可追溯修改', dateConflict.error.code === 'FIRST_ORDER_PROJECT_DATES_LOCKED')
    const contactOnly = await request<FirstOrderProject>('admin', `${A}/projects/${project.id}`, 200, { ...editable, supportContact: '仅更新联系窗口', version: updated.version }, 'PATCH')
    check('只改联系方式并保留原始任意ISO日期可以保存', contactOnly.supportContact === '仅更新联系窗口' && new Date(contactOnly.serviceStartAt).getTime() === new Date(editable.serviceStartAt).getTime() && new Date(contactOnly.serviceEndAt).getTime() === new Date(editable.serviceEndAt).getTime())
    const ownView = await request<FirstOrderOverview>('partner', `${P}/overview`)
    const otherView = await request<FirstOrderOverview>('other', `${P}/overview`)
    check('机构看到自己的项目和点位', ownView.projects.some((row) => row.id === project.id && row.deployments.some((d) => d.id === deployment.id)))
    check('另一机构不读取该项目或设备', !otherView.projects.some((row) => row.id === project.id) && !otherView.terminals.some((row) => row.id === f.terminals.spare))
    check('健康响应不包含Agent凭证或裸网络信息', !/agentToken|deviceFingerprint|ipAddress|fileUrl|passwordHash/.test(JSON.stringify(ownView)))

    const incidentInput = { deploymentId: deployment.id, issueCode: 'paper', note: '缺纸，请安排补纸', requestKey: randomUUID() }
    await request('other', `${P}/incidents`, 404, incidentInput)
    const incident = await request<FirstOrderIncident>('partner', `${P}/incidents`, 201, incidentInput)
    const replay = await request<FirstOrderIncident>('partner', `${P}/incidents`, 201, incidentInput)
    check('报障重试幂等，数据库只写一单', replay.id === incident.id && await f.prisma.serviceIncident.count({ where: { requestKey: incidentInput.requestKey } }) === 1)
    await request('partner', `${P}/incidents`, 409, { ...incidentInput, note: '同key不同内容' })
    const concurrentInput = { ...incidentInput, requestKey: randomUUID(), note: '并发同一次报障' }
    const concurrent = await Promise.all([
      request<FirstOrderIncident>('partner', `${P}/incidents`, 201, concurrentInput),
      request<FirstOrderIncident>('partner', `${P}/incidents`, 201, concurrentInput),
    ])
    check('并发同key报障收敛为同一持久化记录', concurrent[0].id === concurrent[1].id && await f.prisma.serviceIncident.count({ where: { requestKey: concurrentInput.requestKey } }) === 1)
    const casResults = await Promise.all(['维修甲', '维修乙'].map(async (assignee) => {
      const result = await fetch(`${f.base}${A}/incidents/${concurrent[0].id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${f.tokens.admin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', version: concurrent[0].version, note: '并发受理', assignee }),
      })
      return result.status
    }))
    check('同版本并发处理只有一次成功，另一方收到冲突', casResults.sort().join(',') === '200,409')
    await request('partner', `${P}/incidents/${incident.id}`, 403, { action: 'start', version: incident.version, note: '机构不能派单', assignee: '维修员' }, 'PATCH')
    await request('admin', `${A}/incidents/${incident.id}`, 409, { action: 'resolve', version: incident.version, note: '未受理就修复' }, 'PATCH')
    const started = await request<FirstOrderIncident>('admin', `${A}/incidents/${incident.id}`, 200, { action: 'start', version: incident.version, note: '已受理', assignee: '验证维修员' }, 'PATCH')
    check('管理员受理并分配负责人', started.status === 'processing' && started.assignee === '验证维修员')
    await request('admin', `${A}/incidents/${incident.id}`, 409, { action: 'resolve', version: incident.version, note: '旧版本写入' }, 'PATCH')
    const resolved = await request<FirstOrderIncident>('admin', `${A}/incidents/${incident.id}`, 200, { action: 'resolve', version: started.version, note: '已补纸并检查，等待机构核对' }, 'PATCH')
    check('修复与机构确认分开记录', resolved.status === 'resolved' && !!resolved.resolvedAt && !resolved.closedAt)
    await request('admin', `${A}/incidents/${incident.id}`, 403, { action: 'confirm', version: resolved.version, note: '不可代机构确认' }, 'PATCH')
    const confirmed = await request<FirstOrderIncident>('partner', `${P}/incidents/${incident.id}`, 200, { action: 'confirm', version: resolved.version, note: '现场核对已恢复' }, 'PATCH')
    check('机构确认后才关闭', confirmed.status === 'closed' && !!confirmed.closedAt)
    const reopened = await request<FirstOrderIncident>('partner', `${P}/incidents/${incident.id}`, 200, { action: 'reopen', version: confirmed.version, note: '复用时再次缺纸' }, 'PATCH')
    check('机构可复开，状态与时间清理正确', reopened.status === 'open' && !reopened.resolvedAt && !reopened.closedAt && reopened.events.length >= 5)
    await request('other', `${P}/incidents/${incident.id}`, 404, { action: 'reopen', version: reopened.version, note: '越权' }, 'PATCH')

    await f.prisma.$transaction(async (tx) => {
      if (f.mode === 'postgres') {
        await tx.$executeRawUnsafe(`CREATE FUNCTION first_order_audit_reject_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'first_order.incident_%' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$`)
        await tx.$executeRawUnsafe(`CREATE TRIGGER first_order_audit_reject BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION first_order_audit_reject_fn()`)
      } else await tx.$executeRawUnsafe(`CREATE TRIGGER first_order_audit_reject BEFORE INSERT ON "AuditLog" WHEN NEW.action LIKE 'first_order.incident_%' BEGIN SELECT RAISE(ABORT, 'fixture audit unavailable'); END`)
    })
    const rollbackKey = randomUUID()
    try {
      await request('partner', `${P}/incidents`, 500, { ...incidentInput, requestKey: rollbackKey })
      check('必须成功的审计失败会回滚工单', await f.prisma.serviceIncident.count({ where: { requestKey: rollbackKey } }) === 0)
    } finally { await f.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DROP TRIGGER first_order_audit_reject${f.mode === 'postgres' ? ' ON "AuditLog"' : ''}`)
      if (f.mode === 'postgres') await tx.$executeRawUnsafe('DROP FUNCTION first_order_audit_reject_fn()')
    }) }
    check('工单操作保留独立事件和审计', await f.prisma.serviceIncidentEvent.count({ where: { incidentId: incident.id } }) >= 5 && await f.prisma.auditLog.count({ where: { targetId: incident.id } }) >= 5)

    const monthly = await seedFirstOrderMonth(f)
    const small = await seedFirstOrderMonth(f, true)
    const preview = await request<FirstOrderReportSnapshot>('partner', `${P}/projects/${monthly.project.id}/report-preview?month=${monthly.month}`)
    check('自然月按北京时间，起点包含、终点不含', preview.window.from === monthly.from.toISOString() && preview.window.to === monthly.to.toISOString() && preview.metrics.sessions.value === 10)
    check('真实任务结果与未确认、失败分别聚合', preview.metrics.printedTasks.value === 5 && preview.metrics.unconfirmedPrints.value === 5 && preview.metrics.failedPrints.value === 5)
    check('印面复用订单页数×任务份数，不当作纸张数', preview.metrics.printedFaces.value === 20)
    check('离线只用可判定心跳推导', preview.metrics.offlineMinutes.state === 'measured' && (preview.metrics.offlineMinutes.value ?? 0) > 0)
    check('没有可靠完成时间的扫描不会伪造月完成数', preview.metrics.completedScans.value === null && preview.metrics.completedScans.state === 'unverified')
    const low = await request<FirstOrderReportSnapshot>('partner', `${P}/projects/${small.project.id}/report-preview?month=${small.month}`)
    check('小样本抑制在服务端与关联打印指标同时生效', low.metrics.sessions.value === null && low.metrics.sessions.state === 'sample_suppressed' && ['printedTasks', 'printedFaces', 'failedPrints', 'unconfirmedPrints'].every((key) => low.metrics[key as keyof typeof low.metrics].value === null))
    const carryTerminal = `carry-${randomUUID()}`
    await f.prisma.terminal.create({ data: { id: carryTerminal, terminalCode: carryTerminal, agentToken: randomUUID(), deviceFingerprint: carryTerminal, orgId: f.orgs.other, orgBoundAt: monthly.from } })
    const monthlyProjectData = { orgId: monthly.project.orgId, name: monthly.project.name, serviceStartAt: monthly.project.serviceStartAt, serviceEndAt: monthly.project.serviceEndAt, serviceScope: monthly.project.serviceScope, supportContact: monthly.project.supportContact }
    const oldProject = await f.prisma.serviceProject.create({ data: { ...monthlyProjectData, reference: `OLD-${randomUUID()}` } })
    await f.prisma.serviceDeployment.create({ data: {
      orgId: f.orgs.own, projectId: oldProject.id, terminalId: carryTerminal, terminalCode: carryTerminal, locationLabel: '上月旧机构',
      startedAt: new Date(monthly.from.getTime() - 86_400_000), endedAt: monthly.from,
    } })
    const newProject = await f.prisma.serviceProject.create({ data: { ...monthlyProjectData, orgId: f.orgs.other, reference: `NEW-${randomUUID()}` } })
    await f.prisma.serviceDeployment.create({ data: { orgId: f.orgs.other, projectId: newProject.id, terminalId: carryTerminal, activeTerminalId: carryTerminal, terminalCode: carryTerminal, locationLabel: '本月新机构', startedAt: monthly.from } })
    for (let i = 0; i < 5; i++) {
      const id = randomUUID()
      await f.prisma.printTask.create({ data: { id, terminalId: carryTerminal, fileUrl: 'https://fixture.invalid/PRIVATE_RESUME_BODY.pdf', fileMd5: 'b'.repeat(32), paramsJson: '{"copies":1}', status: 'completed', createdAt: new Date(monthly.from.getTime() - 1000), completedAt: new Date(monthly.from.getTime() + 60_000) } })
      await f.prisma.order.create({ data: { orderNo: `CARRY-${id}`, printTaskId: id, terminalId: carryTerminal, billablePages: 2, amountCents: 0, paymentSource: 'free', payStatus: 'paid' } })
      await f.prisma.kioskSession.create({ data: { terminalId: carryTerminal, orgId: f.orgs.other, clientSessionId: randomUUID(), startedAt: new Date(monthly.from.getTime() + i * 60_000), lastActiveAt: monthly.from, expiresAt: monthly.to } })
    }
    const carryOld = await request<FirstOrderReportSnapshot>('partner', `${P}/projects/${oldProject.id}/report-preview?month=${monthly.month}`)
    const carryNew = await request<FirstOrderReportSnapshot>('other', `${P}/projects/${newProject.id}/report-preview?month=${monthly.month}`)
    check('跨月晚完成按创建时归属仍计入旧机构，按完成时间落月', carryOld.metrics.printedTasks.value === 5 && carryOld.metrics.printedFaces.value === 10)
    check('新机构不继承调拨前创建任务的出纸量', carryNew.metrics.printedTasks.value === null && carryNew.metrics.printedTasks.state === 'not_recorded' && carryNew.metrics.sessions.value === 5)
    const currentMonth = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7)
    await request('partner', `${P}/projects/${project.id}/report-preview?month=${currentMonth}`, 200)
    await request('partner', `${P}/projects/${project.id}/reports`, 400, { month: currentMonth })
    await request('other', `${P}/projects/${monthly.project.id}/report-preview?month=${monthly.month}`, 404)
    const concurrentReports = await Promise.all([
      request<FirstOrderReport>('partner', `${P}/projects/${monthly.project.id}/reports`, 201, { month: monthly.month }),
      request<FirstOrderReport>('admin', `${A}/projects/${monthly.project.id}/reports`, 201, { month: monthly.month }),
    ])
    const report = concurrentReports[0]
    check('并发留存自然月报只产生一份快照', concurrentReports[1].id === report.id && await f.prisma.serviceReport.count({ where: { projectId: monthly.project.id, month: monthly.month } }) === 1)
    const repeat = await request<FirstOrderReport>('admin', `${A}/projects/${monthly.project.id}/reports`, 201, { month: monthly.month })
    check('同项目自然月重复留存返回同一快照', repeat.id === report.id && repeat.checksum === report.checksum)
    await f.prisma.kioskSession.create({ data: { terminalId: f.terminals.monthly, orgId: f.orgs.own, clientSessionId: randomUUID(), startedAt: new Date(monthly.from.getTime() + 123_000), lastActiveAt: monthly.from, expiresAt: monthly.to } })
    const frozen = await request<FirstOrderReport>('partner', `${P}/reports/${report.id}`)
    check('源记录变化不会改写已留存快照', frozen.snapshot.metrics.sessions.value === 10 && frozen.checksum === report.checksum)
    const csv = await request<string>('partner', `${P}/reports/${report.id}/csv`)
    check('CSV导出基于同一快照并防公式注入', csv.includes("'=SUM(1,2)") && csv.includes('"10"') && !csv.includes('PRIVATE_RESUME_BODY'))
    check('CSV交付资料包含同一报告编号校验摘要、服务范围和设备台账', csv.includes(report.id) && csv.includes(report.checksum) && csv.includes('免费服务与维保范围') && csv.includes('设备编号') && csv.includes(report.snapshot.deployments[0].terminalCode))
    check('JSON与CSV不暴露群众材料、URL或取件码', !/PRIVATE_RESUME_BODY|pickupCode|fileUrl|endUserId|memberId|agentToken/.test(JSON.stringify(report) + csv))
    await request('other', `${P}/reports/${report.id}`, 404)
    await request('other', `${P}/reports/${report.id}/csv`, 404)
    const ack = await request<FirstOrderReport>('partner', `${P}/reports/${report.id}/acknowledge`, 201, {})
    const ackAgain = await request<FirstOrderReport>('partner', `${P}/reports/${report.id}/acknowledge`, 201, {})
    check('月报核对幂等且不改写数据快照', !!ack.acknowledgedAt && ack.acknowledgedAt === ackAgain.acknowledgedAt && ack.checksum === report.checksum)
    check('报告导出与核对保留审计', await f.prisma.auditLog.count({ where: { targetId: report.id, action: 'first_order.report_exported' } }) === 1 && await f.prisma.auditLog.count({ where: { targetId: report.id, action: 'first_order.report_acknowledged' } }) === 1)

    await assignTerminalOrganization(f.prisma, f.terminals.monthly, f.orgs.other)
    const endedByTransfer = await f.prisma.serviceDeployment.findUniqueOrThrow({ where: { id: monthly.deployment.id } })
    check('真实调拨服务在同一事务关闭旧项目登记', !!endedByTransfer.endedAt && endedByTransfer.activeTerminalId === null)
    const afterTransfer = await request<FirstOrderReportSnapshot>('partner', `${P}/projects/${monthly.project.id}/report-preview?month=${monthly.month}`)
    check('终端改绑后，旧机构仍按历史有效部署与事实归属统计', afterTransfer.metrics.sessions.value === 11 && afterTransfer.metrics.printedTasks.value === 5)
    const newOrg = await request<FirstOrderOverview>('other', `${P}/overview`)
    check('新机构不继承旧项目、工单或月报', !newOrg.projects.some((row) => row.id === monthly.project.id) && !newOrg.reports.some((row) => row.id === report.id))

    const transferredProject = await request<FirstOrderProject>('admin', `${A}/projects`, 201, { ...input, orgId: f.orgs.other, reference: `TRANSFER-${randomUUID()}` })
    const transferredDeployment = await request<{ id: string }>('admin', `${A}/projects/${transferredProject.id}/deployments`, 201, { terminalId: f.terminals.monthly, locationLabel: '新机构新点位' })
    await request('admin', `${A}/deployments/${monthly.deployment.id}/end`, 201, {})
    const terminalAfterOldEnd = await f.prisma.terminal.findUniqueOrThrow({ where: { id: f.terminals.monthly } })
    const newBindingAfterOldEnd = await f.prisma.serviceDeployment.findUniqueOrThrow({ where: { id: transferredDeployment.id } })
    check('结束旧机构历史登记绝不恢复旧归属或结束新机构登记', terminalAfterOldEnd.orgId === f.orgs.other && newBindingAfterOldEnd.activeTerminalId === f.terminals.monthly && newBindingAfterOldEnd.endedAt === null)

    let previousDeploymentId = deployment.id
    // A slightly ahead fixture timestamp models clock regression without changing the system clock.
    const ahead = new Date(Date.now() + 1000)
    await f.prisma.serviceDeployment.update({ where: { id: previousDeploymentId }, data: { startedAt: ahead } })
    for (let round = 0; round < 3; round++) {
      const ending = request('admin', `${A}/deployments/${previousDeploymentId}/end`, 201, {})
      const creating = fetch(`${f.base}${A}/projects/${project.id}/deployments`, {
        method: 'POST', headers: { Authorization: `Bearer ${f.tokens.admin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminalId: f.terminals.spare, locationLabel: `并发登记${round}` }),
      })
      const [, createdResponse] = await Promise.all([ending, creating])
      const createdBody = await createdResponse.json() as { id?: string }
      check(`并发结束/新登记${round + 1}只返回成功或明确冲突`, createdResponse.status === 201 || createdResponse.status === 409)
      const next = createdResponse.status === 201 ? createdBody : await request<{ id: string }>('admin', `${A}/projects/${project.id}/deployments`, 201, { terminalId: f.terminals.spare, locationLabel: `冲突重试${round}` })
      assert.ok(next.id)
      const prior = await f.prisma.serviceDeployment.findUniqueOrThrow({ where: { id: previousDeploymentId } })
      const current = await f.prisma.serviceDeployment.findUniqueOrThrow({ where: { id: next.id } })
      check(`同终端历史有效区间${round + 1}不倒序不重叠`, !!prior.endedAt && prior.endedAt >= prior.startedAt && current.startedAt >= prior.endedAt && prior.activeTerminalId === null)
      check(`同终端并发登记${round + 1}仅保留一条有效登记`, await f.prisma.serviceDeployment.count({ where: { terminalId: f.terminals.spare, endedAt: null } }) === 1)
      previousDeploymentId = current.id
    }
    await request('admin', `${A}/deployments/${deployment.id}/end`, 201, {})
    await request('partner', `${P}/incidents`, 409, { ...incidentInput, requestKey: randomUUID() })
    console.log(`\nPASS: ${checks} real HTTP/database assertions. No production, live AI, SMS login or physical output acceptance is claimed.`)
  } finally { await f.close() }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
