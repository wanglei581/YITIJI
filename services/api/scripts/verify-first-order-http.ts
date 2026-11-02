import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { FirstOrderIncident, FirstOrderIncidentDirectory, FirstOrderOverview, FirstOrderProject, FirstOrderReport, FirstOrderReportDirectory, FirstOrderReportSnapshot } from '@ai-job-print/shared'
import { createFirstOrderFixture, seedFirstOrderMonth } from './support/first-order-fixture'
import { previousClosedMonth } from '../src/first-order/first-order-report-metrics'
import { assignTerminalOrganization } from '../src/terminals/terminal-org-assignment'
import { AuditService } from '../src/audit/audit.service'
import { verifyFirstOrderReviewBoundaries } from './support/first-order-review-boundaries'

const A = '/admin/first-order', P = '/partner/first-order'
let checks = 0
function check(name: string, value: unknown): void {
  assert.ok(value, name)
  checks++
  console.log(`  ✓ ${name}`)
}

async function main() {
  const mode = process.argv.includes('--postgres') ? 'postgres' : 'sqlite'
  const f = await createFirstOrderFixture({ mode })
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
    check('同版本并发冲突不会多写负责人审计', await f.prisma.auditLog.count({ where: { targetId: concurrent[0].id, action: 'first_order.incident_start' } }) === 1)
    await request('partner', `${P}/incidents/${incident.id}`, 403, { action: 'start', version: incident.version, note: '机构不能派单', assignee: '维修员' }, 'PATCH')
    await request('admin', `${A}/incidents/${incident.id}`, 409, { action: 'resolve', version: incident.version, note: '未受理就修复' }, 'PATCH')
    const started = await request<FirstOrderIncident>('admin', `${A}/incidents/${incident.id}`, 200, { action: 'start', version: incident.version, note: '已受理', assignee: '验证维修员' }, 'PATCH')
    check('管理员受理并分配负责人', started.status === 'processing' && started.assignee === '验证维修员')
    const reassigned = await request<FirstOrderIncident>('admin', `${A}/incidents/${incident.id}`, 200, { action: 'start', version: started.version, note: '处理中改派', assignee: '验证维修员乙' }, 'PATCH')
    check('处理中改派负责人真实持久化', reassigned.status === 'processing' && reassigned.assignee === '验证维修员乙' && (await f.prisma.serviceIncident.findUnique({ where: { id: incident.id } }))?.assignee === '验证维修员乙')
    const auditsBeforeConflict = await f.prisma.auditLog.count({ where: { targetId: incident.id } })
    await request('admin', `${A}/incidents/${incident.id}`, 409, { action: 'resolve', version: incident.version, note: '旧版本写入' }, 'PATCH')
    check('陈旧版本冲突不追加审计或覆盖改派负责人', await f.prisma.auditLog.count({ where: { targetId: incident.id } }) === auditsBeforeConflict && (await f.prisma.serviceIncident.findUnique({ where: { id: incident.id } }))?.assignee === '验证维修员乙')
    const resolved = await request<FirstOrderIncident>('admin', `${A}/incidents/${incident.id}`, 200, { action: 'resolve', version: reassigned.version, note: '已补纸并检查，等待机构核对' }, 'PATCH')
    check('修复与机构确认分开记录', resolved.status === 'resolved' && !!resolved.resolvedAt && !resolved.closedAt)
    await request('admin', `${A}/incidents/${incident.id}`, 403, { action: 'confirm', version: resolved.version, note: '不可代机构确认' }, 'PATCH')
    const confirmed = await request<FirstOrderIncident>('partner', `${P}/incidents/${incident.id}`, 200, { action: 'confirm', version: resolved.version, note: '现场核对已恢复' }, 'PATCH')
    check('机构确认后才关闭', confirmed.status === 'closed' && !!confirmed.closedAt)
    const reopened = await request<FirstOrderIncident>('partner', `${P}/incidents/${incident.id}`, 200, { action: 'reopen', version: confirmed.version, note: '复用时再次缺纸' }, 'PATCH')
    const reopenedRow = await f.prisma.serviceIncident.findUnique({ where: { id: incident.id } })
    check('机构可复开，状态与负责人时间清理正确', reopened.status === 'open' && reopened.assignee === null && reopenedRow?.assignee === null && !reopened.resolvedAt && !reopened.closedAt && reopened.events.length >= 6)
    const assigneeHistory = (await f.prisma.auditLog.findMany({ where: { targetId: incident.id } })).map((row) => ({ action: row.action, payload: JSON.parse(row.payloadJson) as Record<string, unknown> }))
    for (const [action, version, previousAssignee, assignee, status] of [
      ['start', incident.version, null, '验证维修员', 'processing'],
      ['start', started.version, '验证维修员', '验证维修员乙', 'processing'],
      ['resolve', reassigned.version, '验证维修员乙', '验证维修员乙', 'resolved'],
      ['confirm', resolved.version, '验证维修员乙', '验证维修员乙', 'closed'],
      ['reopen', confirmed.version, '验证维修员乙', null, 'open'],
    ] as const) {
      const history = assigneeHistory.filter((row) => row.action === `first_order.incident_${action}` && row.payload.version === version)
      check(`复开后仍保留${action}版本${version}负责人前后值审计`, history.length === 1 && history[0].payload.previousAssignee === previousAssignee && history[0].payload.assignee === assignee && history[0].payload.status === status)
    }
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

    await assignTerminalOrganization(f.prisma, f.terminals.monthly, f.orgs.other, undefined, (tx, result) => new AuditService(f.prisma).writeRequired(tx, {
      actorId: f.users.admin, actorRole: 'admin', action: 'terminal.org.update', targetType: 'terminal', targetId: result.terminalCode, payload: { ...result },
    }))
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

    const secretNote = '现场说明正文不应出现'
    const secretPhone = '13900001111'
    const secretContact = '群众联系人张三'
    const ownOrgBefore = await f.prisma.organization.findUniqueOrThrow({ where: { id: f.orgs.own } })
    await f.prisma.organization.update({ where: { id: f.orgs.own }, data: { contact: secretContact, contactPhone: secretPhone } })
    await f.prisma.serviceIncident.update({ where: { id: incident.id }, data: { createdAt: new Date('2026-05-01T00:00:00.000Z') } })
    await f.prisma.serviceIncident.update({ where: { id: concurrent[0].id }, data: { createdAt: new Date('2026-06-01T00:00:00.000Z') } })
    const otherOpen = await f.prisma.serviceIncident.create({ data: {
      orgId: f.orgs.other, projectId: transferredProject.id, deploymentId: transferredDeployment.id,
      terminalCode: f.terminals.monthly.toUpperCase(), issueCode: 'offline', note: `${secretNote}${secretPhone}`,
      requestKey: randomUUID(), status: 'open', assignee: '目录维修员', createdAt: new Date('2026-03-01T00:00:00.000Z'),
      events: { create: { action: 'create', note: `${secretNote}${secretPhone}`, actorRole: 'partner' } },
    } })
    const ownOpen = await f.prisma.serviceIncident.create({ data: {
      orgId: f.orgs.own, projectId: project.id, deploymentId: deployment.id, terminalCode: f.terminals.spare.toUpperCase(),
      issueCode: 'jam', note: secretNote, requestKey: randomUUID(), status: 'open', createdAt: new Date('2026-04-01T00:00:00.000Z'),
    } })
    const processingRow = await f.prisma.serviceIncident.create({ data: {
      orgId: f.orgs.own, projectId: project.id, deploymentId: deployment.id, terminalCode: f.terminals.spare.toUpperCase(),
      issueCode: 'scan', note: secretNote, requestKey: randomUUID(), status: 'processing', assignee: '目录维修员乙', createdAt: new Date('2026-02-01T00:00:00.000Z'),
    } })
    const resolvedRow = await f.prisma.serviceIncident.create({ data: {
      orgId: f.orgs.own, projectId: project.id, deploymentId: deployment.id, terminalCode: f.terminals.spare.toUpperCase(),
      issueCode: 'quality', note: secretNote, requestKey: randomUUID(), status: 'resolved', createdAt: new Date('2026-01-15T00:00:00.000Z'),
    } })
    const closedRow = await f.prisma.serviceIncident.create({ data: {
      orgId: f.orgs.own, projectId: project.id, deploymentId: deployment.id, terminalCode: f.terminals.spare.toUpperCase(),
      issueCode: 'other', note: secretNote, requestKey: randomUUID(), status: 'closed', createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } })
    await request(null, `${A}/incidents`, 401)
    await request('partner', `${A}/incidents`, 403)
    await request('kiosk', `${A}/incidents`, 403)
    await request('partner', `${P}/incidents`, 404)
    await request('admin', `${A}/incidents?status=nope`, 400)
    await request('admin', `${A}/incidents?limit=0`, 400)
    const auditsBeforeIncidents = await f.prisma.auditLog.count()
    const incidentList = await request<FirstOrderIncidentDirectory>('admin', `${A}/incidents`)
    const incidentKeys = ['assignee', 'createdAt', 'id', 'issueCode', 'orgId', 'orgName', 'projectId', 'projectName', 'status', 'terminalCode', 'updatedAt'].join(',')
    const incidentJson = JSON.stringify(incidentList)
    check('跨机构工单只给管理员且读取不写审计', await f.prisma.auditLog.count() === auditsBeforeIncidents)
    check('未关闭工单按状态和创建时间排列并跨两家机构', incidentList.items.map((row) => row.id).join(',') === [otherOpen.id, ownOpen.id, incident.id, processingRow.id, concurrent[0].id, resolvedRow.id].join(',') && incidentList.total === 6 && incidentList.truncated === false)
    check('工单目录字段只有白名单且不含说明、事件和联系方式', incidentList.items.every((row) => Object.keys(row).sort().join(',') === incidentKeys) && !incidentJson.includes(secretNote) && !incidentJson.includes(secretPhone) && !incidentJson.includes(secretContact) && !incidentJson.includes('缺纸，请安排补纸'))
    check('目录保留机构名、项目名和内部负责人', incidentList.items[0].orgId === f.orgs.other && incidentList.items[0].orgName === '另一验证机构' && incidentList.items[0].projectName === transferredProject.name && incidentList.items[0].assignee === '目录维修员' && incidentList.items[0].terminalCode === f.terminals.monthly.toUpperCase())
    const openOnly = await request<FirstOrderIncidentDirectory>('admin', `${A}/incidents?status=open`)
    check('按状态筛选只返回该状态', openOnly.items.every((row) => row.status === 'open') && openOnly.total === 3 && openOnly.items.map((row) => row.id).join(',') === [otherOpen.id, ownOpen.id, incident.id].join(','))
    const closedOnly = await request<FirstOrderIncidentDirectory>('admin', `${A}/incidents?status=closed`)
    check('显式查询已关闭时才返回已关闭', closedOnly.total === 1 && closedOnly.items[0]?.id === closedRow.id && closedOnly.truncated === false)
    const incidentPage = await request<FirstOrderIncidentDirectory>('admin', `${A}/incidents?limit=1`)
    check('工单超过本次条数时总数准确且标明未列全', incidentPage.items.length === 1 && incidentPage.items[0]?.id === otherOpen.id && incidentPage.total === 6 && incidentPage.truncated === true)
    const bulkNote = `bulk-cap-${randomUUID()}`
    await f.prisma.serviceIncident.createMany({ data: Array.from({ length: 201 }, (_, index) => ({
      orgId: f.orgs.own, projectId: project.id, deploymentId: deployment.id, terminalCode: f.terminals.spare.toUpperCase(),
      issueCode: 'other', note: bulkNote, requestKey: randomUUID(), status: 'resolved', createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)),
    })) })
    const cappedIncidents = await request<FirstOrderIncidentDirectory>('admin', `${A}/incidents?status=resolved&limit=500`)
    check('工单条数超过上限不报错，总数仍准确', cappedIncidents.items.length === 200 && cappedIncidents.total === 202 && cappedIncidents.truncated === true && !JSON.stringify(cappedIncidents).includes(bulkNote))
    await f.prisma.serviceIncident.deleteMany({ where: { note: bulkNote } })
    await f.prisma.organization.update({ where: { id: f.orgs.own }, data: { contact: ownOrgBefore.contact, contactPhone: ownOrgBefore.contactPhone } })

    await request(null, `${A}/reports`, 401)
    await request('partner', `${A}/reports`, 403)
    await request('kiosk', `${A}/reports`, 403)
    await request('admin', `${A}/reports?month=2026-13`, 400)
    await request('admin', `${A}/reports?month=2026/09`, 400)
    await request('admin', `${A}/reports?limit=abc`, 400)
    const bareProject = await f.prisma.serviceProject.create({ data: {
      orgId: f.orgs.own, name: '无部署不应出现', reference: `BARE-${randomUUID()}`, serviceStartAt: new Date('2026-01-01T00:00:00.000Z'),
      serviceEndAt: new Date('2027-12-01T00:00:00.000Z'), serviceScope: '无部署范围', supportContact: '无部署联系窗口',
    } })
    const auditsBeforeReports = await f.prisma.auditLog.count()
    const reportList = await request<FirstOrderReportDirectory>('admin', `${A}/reports`)
    const reportKeys = ['acknowledgedAt', 'month', 'orgId', 'orgName', 'projectId', 'projectName', 'reportId', 'status'].join(',')
    const retained = reportList.items.find((row) => row.projectId === monthly.project.id)
    const missingReport = reportList.items.find((row) => row.projectId === small.project.id)
    check('默认月份是北京时间上一个完整自然月且读取不写审计', reportList.month === monthly.month && reportList.month === previousClosedMonth().month && await f.prisma.auditLog.count() === auditsBeforeReports)
    check('已结束月份列出留存与未留存，部署已结束的不计入', !!retained && retained.reportId === report.id && retained.acknowledgedAt === ack.acknowledgedAt && retained.status === null && retained.orgName === '首单验证机构' && !!missingReport && missingReport.reportId === null && missingReport.acknowledgedAt === null && missingReport.status === null && reportList.items.some((row) => row.projectId === newProject.id && row.orgId === f.orgs.other) && !reportList.items.some((row) => row.projectId === oldProject.id || row.projectId === bareProject.id))
    check('月报目录只有约定字段且不含会话明细', Object.keys(reportList).sort().join(',') === 'items,month,total,truncated' && reportList.items.every((row) => Object.keys(row).sort().join(',') === reportKeys) && !/平台验证服务窗口|免费打印与年度技术服务|snapshot|sessions|metrics|PRIVATE_RESUME_BODY|endUserId/.test(JSON.stringify(reportList)))
    const reportPage = await request<FirstOrderReportDirectory>('admin', `${A}/reports?limit=1`)
    check('月报超过本次条数时总数准确且标明未列全', reportPage.total === reportList.total && reportPage.total > 1 && reportPage.items.length === 1 && reportPage.truncated === true)
    const reportWide = await request<FirstOrderReportDirectory>('admin', `${A}/reports?limit=500`)
    check('月报条数超过上限不报错', reportWide.total === reportList.total && reportWide.items.length === reportList.total && reportWide.truncated === false)
    const [yearText, monthText] = currentMonth.split('-')
    const futureMonth = monthText === '12' ? `${Number(yearText) + 1}-01` : `${yearText}-${String(Number(monthText) + 1).padStart(2, '0')}`
    const currentReports = await request<FirstOrderReportDirectory>('admin', `${A}/reports?month=${currentMonth}`)
    const futureReports = await request<FirstOrderReportDirectory>('admin', `${A}/reports?month=${futureMonth}`)
    check('当前月和以后的月份只能预览，不当成缺报', currentReports.items.length > 0 && futureReports.items.length > 0 && [...currentReports.items, ...futureReports.items].every((row) => row.status === '本月尚未结束，只能预览') && currentReports.items.some((row) => row.reportId === null))
    const pastReports = await request<FirstOrderReportDirectory>('admin', `${A}/reports?month=2025-12`)
    check('早于首单年份的合法月份按空目录返回，不报格式错误', pastReports.month === '2025-12' && pastReports.total === 0 && pastReports.items.length === 0 && pastReports.truncated === false)

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
    const fullOverview = await request<FirstOrderOverview>('partner', `${P}/overview`)
    check('首单总览明确返回未截断，完整或超限拒绝', fullOverview.truncated === false)
    await f.prisma.serviceIncident.createMany({ data: Array.from({ length: 201 }, () => ({ orgId: f.orgs.own, projectId: project.id, deploymentId: deployment.id, terminalCode: f.terminals.spare, issueCode: 'offline', note: 'Fixture cap only', requestKey: randomUUID() })) })
    await request('partner', `${P}/overview`, 400)
    await f.prisma.serviceIncident.deleteMany({ where: { note: 'Fixture cap only' } })
    await f.prisma.serviceProject.createMany({ data: Array.from({ length: 201 }, () => ({ orgId: f.orgs.own, name: 'Fixture cap only', reference: randomUUID(), serviceStartAt: new Date(), serviceEndAt: new Date(Date.now() + 86400000), serviceScope: 'Fixture', supportContact: 'Fixture' })) })
    await request('partner', `${P}/overview`, 400)
  } finally { await f.close() }
  // Full AppModule gets a fresh owned database/environment after the focused fixture closes.
  checks += await verifyFirstOrderReviewBoundaries(mode)
  console.log(`\nPASS: ${checks} real HTTP/database assertions. No production, live AI, SMS login or physical output acceptance is claimed.`)
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
