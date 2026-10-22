import { BadRequestException, ConflictException } from '@nestjs/common'
import type { FirstOrderReportSnapshot } from '../../../../packages/shared/src/types/firstOrder.contract'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import type { ServiceDeployment, ServiceProject } from '../generated/prisma/client'
import { pagesByPrintedTask } from '../console-screen/console-screen.printed-pages'
import { HeartbeatFolder, summarizeFaults } from '../orgs/partner-terminal-ops'
import { deploymentView } from './first-order-mappers'
import { monthWindow, reportMetric, suppressPrintFamily } from './first-order-report-metrics'

type Project = ServiceProject & { deployments: ServiceDeployment[] }
const PRINT_CAP = 40_000
const HEARTBEAT_CAP = 500_000

/** Bounded reads; no user, document, URL, code, prompt or contact fields are loaded. */
export async function buildFirstOrderReport(tx: PrismaTransactionClient, project: Project, month: string, now = new Date()): Promise<FirstOrderReportSnapshot> {
  const window = monthWindow(month, now)
  const end = new Date(Math.min(window.to.getTime(), now.getTime()))
  const limitations = new Set<string>([
    '服务会话不是独立人数，不代表就业、投递或政策办理结果。',
    '出纸结果来自软件完成或管理员核查，不能替代实物抽验；印面数不含面板复印，也不等于耗纸张数。',
    '本报告暂不包含AI可用率；扫描缺少可核对的完成时间，暂不能统计自然月完成量。',
    '工单分布为本月新建工单在生成时的处理状态，不是月末状态或故障恢复率。',
  ])
  let complete = true, sessions = 0, printed = 0, faces = 0, failed = 0, unconfirmed = 0
  let observed = false, heartbeatCount = 0, offlineMinutes = 0, printCount = 0, missingPages = false
  const registered = project.deployments.filter((d) => d.startedAt < end)
  const deployments: ServiceDeployment[] = []
  if (registered.length === 0) {
    throw new BadRequestException({ error: { code: 'FIRST_ORDER_NO_COVERAGE', message: '该月没有有效设备登记，不能生成空白履约报告' } })
  }
  for (const d of registered) {
    const terminal = await tx.terminal.findUnique({ where: { id: d.terminalId }, select: { orgId: true, orgBoundAt: true } })
    if (!d.endedAt && (!terminal || terminal.orgId !== project.orgId || (terminal.orgBoundAt && terminal.orgBoundAt > d.startedAt))) {
      throw new ConflictException({ error: { code: 'FIRST_ORDER_BINDING_UNVERIFIED', message: '设备归属变化尚未完成登记核对，暂不生成报告' } })
    }
    const ownFrom = new Date(Math.max(d.startedAt.getTime(), project.serviceStartAt.getTime()))
    const ownTo = new Date(Math.min(d.endedAt?.getTime() ?? now.getTime(), project.serviceEndAt.getTime(), now.getTime()))
    const from = new Date(Math.max(window.from.getTime(), ownFrom.getTime()))
    const to = new Date(Math.min(end.getTime(), ownTo.getTime()))
    const tasks = await tx.printTask.findMany({
      where: { terminalId: d.terminalId, createdAt: { gte: ownFrom, lt: ownTo }, completedAt: { gte: window.from, lt: end }, status: { in: ['completed', 'failed'] } },
      select: { id: true, status: true, printOutcome: true, errorCode: true, paramsJson: true, order: { select: { billablePages: true } } }, take: PRINT_CAP + 1,
    })
    if (tasks.length || from < to) deployments.push(d)
    printCount += tasks.length
    if (printCount > PRINT_CAP) throw new BadRequestException({ error: { code: 'FIRST_ORDER_REPORT_LIMIT', message: '月报数据超过本次计算范围，请联系平台分批核对，不返回截断结果' } })
    const printedRows = tasks.filter((t) => (t.status === 'completed' && t.printOutcome !== 'not_printed') || t.printOutcome === 'printed')
    const printedIds = new Set(printedRows.map((t) => t.id))
    const pages = await pagesByPrintedTask(tx, printedRows)
    printed += printedRows.length
    for (const task of printedRows) {
      const count = pages.get(task.id)
      if (count === undefined) missingPages = true
      else faces += count
    }
    for (const task of tasks) {
      if (printedIds.has(task.id)) continue
      if (task.errorCode === 'PRINT_JOB_UNCONFIRMED' && task.printOutcome === null) unconfirmed++
      else failed++
    }
    // A task created under this deployment remains its owner's result even if it
    // finishes next month after transfer. Session/heartbeat time does not follow it.
    if (from >= to) {
      if (tasks.length) limitations.add('包含旧部署结束后完成的任务，按创建时部署归属、完成时间落月；不迁移到新机构。')
      continue
    }
    if (from > window.from || to < end) {
      complete = false
      limitations.add('部分设备仅覆盖本月部分时段，登记之前不追溯补造；各设备按有效登记和服务期统计。')
    }
    sessions += await tx.kioskSession.count({ where: { orgId: project.orgId, terminalId: d.terminalId, startedAt: { gte: from, lt: to } } })
    const seed = await tx.terminalHeartbeat.findFirst({ where: { terminalId: d.terminalId, createdAt: { gte: ownFrom, lt: from } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, printerStatus: true } })
    const folder = new HeartbeatFolder({ from, now: to, seedAt: seed?.createdAt ?? null, seedPrinterStatus: seed?.printerStatus ?? null })
    let cursor: string | undefined, first = true
    for (;;) {
      const rows = await tx.terminalHeartbeat.findMany({
        where: { terminalId: d.terminalId, createdAt: { gte: from, lt: to } },
        select: { id: true, createdAt: true, printerStatus: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      heartbeatCount += rows.length
      if (heartbeatCount > HEARTBEAT_CAP) throw new BadRequestException({ error: { code: 'FIRST_ORDER_REPORT_LIMIT', message: '心跳数量超出月报计算范围，请联系平台核对' } })
      if (first && !seed && (!rows[0] || rows[0].createdAt.getTime() > from.getTime() + 300_000)) {
        complete = false
        limitations.add('存在首条心跳之前的不可观测时段，不将其填为在线或零故障；离线分钟只覆盖可判定时段。')
      }
      for (const row of rows) folder.push(row)
      first = false
      if (rows.length < 2000) break
      cursor = rows[rows.length - 1].id
    }
    observed ||= folder.reportedInWindow || !!seed
    offlineMinutes += summarizeFaults(folder.finish(), to, folder.reportedInWindow).offlineMinutes
  }
  if (deployments.length === 0) throw new BadRequestException({ error: { code: 'FIRST_ORDER_NO_COVERAGE', message: '该月没有有效登记时段或归属本项目的完成记录，不能生成空白履约报告' } })
  if (sessions === 0) {
    complete = false
    limitations.add('没有本范围内会话记录，无法区分无人使用和未接入会话采集，不填零服务人数。')
  }
  if (missingPages) { complete = false; limitations.add('有已出纸任务缺可信页数来源，整项印面数不展示，不输出少算的合计。') }
  const printMetrics = suppressPrintFamily([printed, faces, unconfirmed, failed], [
    '软件完成且未被核查为未出纸，或人工核查已出纸；按完成时间落月。',
    '与大屏同口径：订单计费页×任务份数，双面仍计印面，不含复印。',
    '已结束但尚无法确认出纸，单列，不冒充成功。', '本月已结束且不属于已出纸/未确认的任务。',
  ])
  if (printCount === 0) {
    for (let i = 0; i < printMetrics.length; i++) printMetrics[i] = reportMetric(null, '没有本范围内已结束任务记录，不据此宣称零使用或零失败')
  }
  const groups = await tx.serviceIncident.groupBy({ by: ['status'], where: { projectId: project.id, createdAt: { gte: window.from, lt: end } }, _count: { _all: true } })
  const incidentCounts = { open: 0, processing: 0, resolved: 0, closed: 0 }
  for (const group of groups) if (group.status in incidentCounts) incidentCounts[group.status as keyof typeof incidentCounts] = group._count._all
  return {
    schemaVersion: 'first-order-v1', month, timezone: 'Asia/Shanghai', generatedAt: now.toISOString(),
    project: { id: project.id, name: project.name, reference: project.reference, serviceStartAt: project.serviceStartAt.toISOString(), serviceEndAt: project.serviceEndAt.toISOString(), serviceScope: project.serviceScope, supportContact: project.supportContact },
    window: { from: window.from.toISOString(), to: end.toISOString() }, complete,
    limitations: [...limitations], deployments: deployments.map(deploymentView), incidents: incidentCounts,
    metrics: {
      sessions: reportMetric(sessions || null, '按机构事实快照与有效部署区间统计的会话数，不是独立人数。'),
      printedTasks: printMetrics[0], printedFaces: missingPages ? { value: null, state: 'unverified', note: '存在缺可信页数的任务，未输出不完整合计' } : printMetrics[1],
      unconfirmedPrints: printMetrics[2], failedPrints: printMetrics[3],
      completedScans: { value: null, state: 'unverified', note: '缺少可核对的扫描完成时间，暂不能统计自然月完成量' },
      offlineMinutes: observed ? { value: offlineMinutes, state: 'measured', note: '按现有心跳口径推导，超过5分钟的间隙；不代表实际断电或全功能不可用时长' } : reportMetric(null, '没有可判定心跳记录'),
    },
  }
}
