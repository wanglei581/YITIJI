/**
 * 阶段1E — Admin 运营视图(打印任务流水 + 派生告警)验证。
 *
 * 覆盖(对应需求验收点):
 *   1. 打印任务列表:倒序返回、状态过滤、分页 total 准确。
 *   2. 安全字段:响应不含 fileUrl / fileMd5 / paramsJson / errorMessage / endUserId;
 *      paramsJson 损坏 → 字段 null 不抛错;归属仅 member/anonymous。
 *   3. 派生告警:离线终端产生 terminal_offline(超 30 分钟 error);
 *      在线终端 + 打印机异常心跳产生 printer_issue;
 *      近 24h 失败任务产生 print_failed;在线且正常的终端不产生告警。
 *   4. 确认/静默/关闭持久化；确认后默认 open 视图消失，all 视图仍标「问题仍在发生」。
 *   5. 已退款失败单（Order.payStatus=refunded，printOutcome 仍为空）不再报警。
 *   6. episode 不一致拒绝；处理动作写审计。
 *   7. GET 只读：列表端点不写 AlertDisposition（缺席不等于恢复）。
 *   8. 列表上限：total/firingCount 是精确总数、truncated 如实告知、被截断的告警仍可处置，
 *      且不会因为「这次没列出来」把操作员的处置抹掉。
 *   9. reopen：已关闭/已静默的告警可以被重新打开，回到待处理。
 *  10. 真实库 paid_pending_file_unavailable：active / 未到期不误报；上传中、隔离、
 *      软删除、已过期不漏报；已支付/未支付/已退款和两台终端归属分开；确认、关闭、
 *      恢复后再故障会换 episode；响应不含签名 URL、storageKey、哈希、支付字段或本人标识。
 *      正常删除文件走 ON DELETE SET NULL，fileId 被清空后与历史空 fileId 一样不告警。
 *      fileId 仍在而文件行不在的形状只由第 3b 节内存夹具覆盖。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:admin-ops
 */
import 'reflect-metadata'
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Module } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AuditService } from '../src/audit/audit.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminAlertActionsService } from '../src/admin-ops/admin-alert-actions.service'
import { AdminOpsController } from '../src/admin-ops/admin-ops.controller'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { collectDerivedAlerts, ONLINE_WINDOW_MS, PRINT_FAILED_LIST_CAP, resolveDerivedAlert } from '../src/admin-ops/derived-alerts'
import { AI_PROVIDER_UNAVAILABLE_WINDOW_MS, aiProviderUnavailableEpisodeToken } from '../src/admin-ops/derived-alert-identity'
import { AiBudgetService } from '../src/ai/usage/ai-budget.service'
import { beijingDayKey } from '../src/ai/usage/ai-usage-meter'
import { offlineEpisodeToken } from '../src/admin-ops/derived-alert-identity'
import { TERMINAL_ONLINE_WINDOW_MS } from '../src/terminals/printer-availability'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { RedisService } from '../src/common/redis/redis.service'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errorCode(err: unknown): string | undefined {
  const e = err as {
    message?: string
    response?: { error?: { code?: string } }
    getResponse?: () => { error?: { code?: string } }
  }
  return e.response?.error?.code ?? e.getResponse?.()?.error?.code ?? e.message
}

type FeedbackStatusClause = { status?: string | { in?: string[] }; replies?: { none?: { senderType?: string } } }
type FeedbackQuery = { where?: { category?: string; OR?: FeedbackStatusClause[] } & FeedbackStatusClause; orderBy?: { createdAt?: 'asc' | 'desc' } }
type FeedbackRow = { category: string; status: string; createdAt: Date; hasAdminReply?: boolean }
function matchStatusClause(row: FeedbackRow, clause: FeedbackStatusClause): boolean {
  const status = clause.status
  if (typeof status === 'string' && row.status !== status) return false
  if (status && typeof status === 'object' && status.in && !status.in.includes(row.status)) return false
  if (clause.replies?.none?.senderType === 'admin' && row.hasAdminReply) return false
  return true
}
function matchFeedback(rows: unknown[], args?: FeedbackQuery): FeedbackRow[] {
  return (rows as FeedbackRow[])
    .filter((row) => args?.where?.category === undefined || row.category === args.where.category)
    .filter((row) => matchStatusClause(row, args?.where ?? {}))
    .filter((row) => !args?.where?.OR || args.where.OR.some((clause) => matchStatusClause(row, clause)))
}

function mockOpsPrisma(
  terminalRows: unknown[],
  printRows: unknown[] = [],
  dispositionRows: unknown[] = [],
  unavailableRows: unknown[] = [],
  feedbackRows: unknown[] = [],
): PrismaService {
  return {
    terminal: { findMany: async () => terminalRows },
    printTask: {
      findMany: async (args?: { where?: { status?: string } }) => args?.where?.status === 'pending' ? unavailableRows : printRows,
      count: async (args?: { where?: { status?: string } }) => args?.where?.status === 'pending' ? unavailableRows.length : printRows.length,
      findFirst: async () => unavailableRows[0] ?? null,
    },
    terminalHeartbeat: { groupBy: async () => [], findFirst: async () => null },
    // 按真实 where 过滤、按真实 orderBy 排序（不自带排序），否则「只算 AI 内容投诉」「取最早 / 最新」都测不出来。
    // AI 告警在这些夹具里没有计量行：空结果，不能因为没桩而把整份列表打崩，也不能凭空报费用用完。
    aiUsageRecord: {
      findMany: async () => [],
      findFirst: async () => null,
      count: async () => 0,
      groupBy: async () => [],
    },
    feedbackTicket: {
      count: async (args?: FeedbackQuery) => matchFeedback(feedbackRows, args).length,
      findFirst: async (args?: FeedbackQuery) => {
        const rows = matchFeedback(feedbackRows, args)
        const direction = args?.orderBy?.createdAt
        if (!direction) return rows[0] ?? null
        const sorted = [...rows].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
        return (direction === 'asc' ? sorted[0] : sorted[sorted.length - 1]) ?? null
      },
      findMany: async () => { throw new Error('待处理投诉告警不得全表拉取（用 count + findFirst）') },
    },
    alertDisposition: {
      findMany: async () => dispositionRows,
      updateMany: async () => {
        throw new Error('listDerivedAlerts 是只读端点，不得写 AlertDisposition')
      },
    },
  } as unknown as PrismaService
}

/** disposition 行的可比较快照,用来断言「GET 没有写库」。 */
function dispositionFingerprint(row: {
  action: string
  episodeToken: string
  recoveredAt: Date | null
  silencedUntil: Date | null
  note: string | null
  updatedAt: Date
} | null): string {
  if (!row) return 'ABSENT'
  return [
    row.action,
    row.episodeToken,
    row.recoveredAt?.toISOString() ?? 'null',
    row.silencedUntil?.toISOString() ?? 'null',
    row.note ?? 'null',
    row.updatedAt.toISOString(),
  ].join('|')
}

async function verifyHealthyPrinterStatusesDoNotAlert(): Promise<void> {
  const now = new Date()
  for (const printerStatus of ['ok', 'ready', 'idle']) {
    const service = new AdminOpsService(mockOpsPrisma([{
      id: `term_vop_healthy_${printerStatus}`,
      terminalCode: `VOP-HEALTHY-${printerStatus}`,
      registeredAt: now,
      heartbeats: [{ createdAt: now, printerStatus }],
    }]))
    const { data } = await service.listDerivedAlerts()
    if (data.some((alert) => alert.type === 'printer_issue')) {
      fail(`3. 健康打印机状态 ${printerStatus} 不应产生 printer_issue 告警`)
    }
  }
  pass('3a. 健康打印机状态(ok/ready/idle)不产生 printer_issue 告警')
}

/**
 * 3a2. Agent 真会上报的 low_paper / unknown（apps/terminal-agent/src/agent/wmi.ts）必须有人话标题，
 * 不能落到「打印机状态异常(low_paper)」兜底；low_paper 还能出纸 → warning，unknown 一体机打不了 → error。
 * 同时钉住：告警文案时间按上海时间写，而 occurredAt / episodeToken 仍是原来的 UTC 口径。
 */
async function verifyPrinterStatusLabelsAndShanghaiTime(): Promise<void> {
  const now = new Date()
  const cases: Array<{ status: string; title: string; severity: 'warning' | 'error' }> = [
    { status: 'low_paper', title: '纸张或墨粉不足', severity: 'warning' },
    { status: 'unknown', title: '打印机状态读取不到', severity: 'error' },
    { status: 'paper_empty', title: '打印机缺纸', severity: 'warning' },
    { status: 'offline', title: '打印机离线', severity: 'error' },
  ]
  for (const { status, title, severity } of cases) {
    const service = new AdminOpsService(mockOpsPrisma([{
      id: `term_vop_label_${status}`,
      terminalCode: `VOP-LABEL-${status}`,
      registeredAt: now,
      heartbeats: [{ createdAt: now, printerStatus: status }],
    }]))
    const alert = (await service.listDerivedAlerts()).data.find((item) => item.type === 'printer_issue')
    if (!alert) fail(`3a2. 打印机状态 ${status} 没有产生 printer_issue 告警`)
    if (!alert.title.includes(title) || alert.title.includes('状态异常(')) {
      fail(`3a2. 打印机状态 ${status} 的标题应含「${title}」且不落兜底，实际「${alert.title}」`)
    }
    if (alert.severity !== severity) fail(`3a2. 打印机状态 ${status} 的级别应为 ${severity}，实际 ${alert.severity}`)
  }

  const lastSeen = new Date('2026-09-28T08:00:00.000Z')
  const offlineService = new AdminOpsService(mockOpsPrisma([{
    id: 'term_vop_shanghai_time',
    terminalCode: 'VOP-SHANGHAI-TIME',
    registeredAt: lastSeen,
    heartbeats: [{ createdAt: lastSeen, printerStatus: 'ready' }],
  }]))
  const offline = (await offlineService.listDerivedAlerts()).data.find((item) => item.type === 'terminal_offline')
  if (!offline || !offline.detail.includes('(2026-09-28 16:00)')) {
    fail(`3a2. 离线告警里的心跳时间应按上海时间写 2026-09-28 16:00，实际「${offline?.detail}」`)
  }
  // 离线已经好几天：写「N 天 M 小时前」，不写成「5211 分钟前」那样要值班人员自己换算的数。
  if (!/最近一次心跳在 \d+ 天( \d+ 小时)?前/.test(offline.detail) || /\d{3,} 分钟前/.test(offline.detail)) {
    fail(`3a2. 离线多天的告警应写「N 天 M 小时前」，实际「${offline.detail}」`)
  }
  if (offline.occurredAt !== lastSeen.toISOString() || offline.episodeToken !== offlineEpisodeToken(lastSeen)) {
    fail('3a2. 改时区只许动文案：occurredAt / episodeToken 必须仍按原 UTC 时刻算')
  }
  pass('3a2. low_paper（warning）/ unknown（error）有人话标题不落兜底；告警文案时间按上海时间，身份与 episode 不变')
}

async function verifyPendingFeedbackAlert(): Promise<void> {
  const feedbackRows: Array<{ createdAt: Date; category: string; status: string; contactPhoneEnc: string; content: string; hasAdminReply?: boolean }> = [
    { createdAt: new Date('2026-09-28T08:00:00.000Z'), category: 'ai_content', status: 'pending', contactPhoneEnc: 'secret-phone', content: 'secret-content' },
    { createdAt: new Date('2026-09-28T08:01:00.000Z'), category: 'ai_content', status: 'processing', contactPhoneEnc: 'secret-phone-2', content: 'secret-content-2' },
    { createdAt: new Date('2026-09-28T07:00:00.000Z'), category: 'print', status: 'pending', contactPhoneEnc: '', content: '打印问题' },
    { createdAt: new Date('2026-09-28T06:00:00.000Z'), category: 'ai_content', status: 'closed', contactPhoneEnc: '', content: '已处理' },
  ]
  const service = new AdminOpsService(mockOpsPrisma([], [], [], [], feedbackRows))
  const first = await service.listDerivedAlerts()
  const alert = first.data.find((item) => item.type === 'feedback_pending')
  if (!alert || !alert.detail.includes('共 2 条')) fail('3c. 待处理 AI 内容投诉告警缺失，或把打印问题、已关闭工单也算进去了')
  if (alert && alert.occurredAt !== '2026-09-28T08:00:00.000Z') fail('3c. 告警时间不是最早一条待处理 AI 内容投诉的提交时间')
  // 文案时间按上海时间（UTC 08:00 → 16:00），与意见反馈页显示的提交时间一致，不再差 8 小时。
  if (alert && !alert.detail.includes('最早提交于 2026-09-28 16:00')) fail(`3c. 告警文案里的最早提交时间应按上海时间写，实际「${alert.detail}」`)
  const encoded = JSON.stringify(alert)
  if (encoded.includes('secret-phone') || encoded.includes('secret-content')) fail('3c. 告警泄露手机号或投诉正文')
  // 提醒时机：答复较早的一条不换 episode（不打扰已确认的告警）；有新投诉进来才换（重新提醒）。
  feedbackRows[0].status = 'replied'
  feedbackRows[0].hasAdminReply = true
  const afterOldAnswered = (await service.listDerivedAlerts()).data.find((item) => item.type === 'feedback_pending')
  if (!afterOldAnswered || afterOldAnswered.episodeToken !== alert?.episodeToken) fail('3c. 答复旧投诉不该让告警换 episode（会把已确认的告警重新弹出来）')
  feedbackRows.push({ createdAt: new Date('2026-09-28T09:00:00.000Z'), category: 'ai_content', status: 'pending', contactPhoneEnc: '', content: '新投诉' })
  const afterNew = (await service.listDerivedAlerts()).data.find((item) => item.type === 'feedback_pending')
  if (!afterNew || afterNew.episodeToken === alert?.episodeToken) fail('3c. 有新投诉进来告警没有换 episode（已确认的告警不会重新提醒）')
  // 旧数据：状态被标成「已回复」却没有任何管理员回复记录 —— 提交人什么都没收到，告警不能消失。
  for (const row of feedbackRows) row.status = row.category === 'ai_content' ? 'replied' : row.status
  const repliedWithoutRecord = (await service.listDerivedAlerts()).data.find((item) => item.type === 'feedback_pending')
  // 此时 ai_content 共 4 条：第 1 条带回复记录；其余 3 条（含原先已关闭、被改成已回复的一条）都没有回复记录。
  if (!repliedWithoutRecord || !repliedWithoutRecord.detail.includes('共 3 条')) {
    fail(`3c. 标成已回复但没有回复记录的 AI 内容投诉必须仍算待处理，实际「${repliedWithoutRecord?.detail ?? '告警消失'}」`)
  }
  for (const row of feedbackRows) if (row.category === 'ai_content') row.hasAdminReply = true
  const after = await service.listDerivedAlerts()
  if (after.data.some((item) => item.type === 'feedback_pending')) fail('3c. AI 内容投诉都答复后派生告警未消失')
  pass('3c. 只按待处理 AI 内容投诉派生告警（条数与最早时间，不全表拉取），新投诉才重新提醒，不含个人信息；有回复记录才消失，只改状态不消失')
}

async function verifyPaidPendingFileUnavailableAlert(): Promise<void> {
  const now = new Date('2026-09-23T08:00:00.000Z')
  const bad = {
    id: 'pt_paid_pending_bad',
    fileId: 'file_paid_pending_bad',
    updatedAt: new Date('2026-09-23T07:59:00.000Z'),
    terminal: { terminalCode: 'VOP-PAID-PENDING' },
    order: { payStatus: 'paid' },
    file: {
      status: 'uploading',
      deletedAt: null,
      expiresAt: null,
      updatedAt: new Date('2026-09-23T07:58:00.000Z'),
      storageKey: 'must-not-leak',
    },
  }
  const active = {
    ...bad,
    id: 'pt_paid_pending_active',
    fileId: 'file_paid_pending_active',
    file: { ...bad.file, status: 'active', updatedAt: new Date('2026-09-23T07:57:00.000Z') },
  }
  const quarantined = {
    ...bad,
    id: 'pt_paid_pending_quarantined',
    fileId: 'file_paid_pending_quarantined',
    file: { ...bad.file, status: 'quarantined', updatedAt: new Date('2026-09-23T07:56:00.000Z') },
  }
  const deleted = {
    ...bad,
    id: 'pt_paid_pending_deleted',
    fileId: 'file_paid_pending_deleted',
    file: { ...bad.file, status: 'active', deletedAt: new Date('2026-09-23T07:55:00.000Z'), updatedAt: new Date('2026-09-23T07:55:00.000Z') },
  }
  const expired = {
    ...bad,
    id: 'pt_paid_pending_expired',
    fileId: 'file_paid_pending_expired',
    file: { ...bad.file, status: 'active', expiresAt: new Date(Date.now() - 60 * 60 * 1000), updatedAt: new Date('2026-09-23T07:54:00.000Z') },
  }
  const missing = { ...bad, id: 'pt_paid_pending_missing', fileId: 'file_paid_pending_missing', file: null }
  const refunded = { ...bad, id: 'pt_paid_pending_refunded', order: { payStatus: 'refunded' } }
  const legacy = { ...bad, id: 'pt_paid_pending_legacy', fileId: null, file: null }
  const svc = new AdminOpsService(mockOpsPrisma([], [], [], [bad, active, quarantined, deleted, expired, missing, refunded, legacy]))
  const first = await svc.listDerivedAlerts('open')
  const alert = first.data.find((item) => item.id === 'paid_pending_file_unavailable:pt_paid_pending_bad')
  if (!alert) fail('3b. 已支付 pending + uploading 文件必须进入派生告警')
  if (alert.severity !== 'error' || alert.conditionState !== 'firing') fail('3b. 文件不可用告警状态/级别错误')
  for (const id of ['quarantined', 'deleted', 'expired', 'missing']) {
    if (!first.data.some((item) => item.id === `paid_pending_file_unavailable:pt_paid_pending_${id}`)) {
      fail(`3b. ${id} 文件不可用状态必须进入派生告警`)
    }
  }
  if (first.firingCount !== 5 || first.data.some((item) => item.id.includes('active') || item.id.includes('refunded') || item.id.includes('legacy'))) {
    fail('3b. active、已退款或历史 fileId=null 任务不得误报，且五种不可用状态都要计数')
  }
  const encoded = JSON.stringify(alert)
  for (const banned of ['storageKey', 'must-not-leak', 'file_paid_pending_bad']) {
    if (banned === 'file_paid_pending_bad') continue
    if (encoded.includes(banned)) fail(`3b. 告警泄露敏感字段: ${banned}`)
  }
  const second = await svc.listDerivedAlerts('open')
  const repeated = second.data.find((item) => item.id === alert.id)
  if (!repeated || repeated.episodeToken !== alert.episodeToken) fail('3b. 同一文件故障的 episodeToken 必须稳定')
  const resolved = await resolveDerivedAlert(
    mockOpsPrisma([], [], [], [bad]),
    'paid_pending_file_unavailable',
    bad.id,
    now,
  )
  if (!resolved || resolved.subjectKey !== alert.subjectKey) fail('3b. 单条正向查证必须复用同一告警条件')
  pass('3b. 已支付 pending 文件不可用告警、误报排除、稳定身份和单条查证')
}

/**
 * N-6：三种 AI 派生告警。计量行的功能名、时间像真的；人名不需要。
 * 告警文本不得带用户输入（这里把哨兵写进 model，查询不取这一列）。
 */
async function verifyAiDerivedAlerts(prisma: PrismaService): Promise<void> {
  const vendor = 'verify-ai-alert'
  const sentinel = 'SENTINEL_USER_TEXT_不要出现'
  const clear = () => prisma.aiUsageRecord.deleteMany({ where: { vendor } })
  await clear()
  const budget = new AiBudgetService(prisma)
  if (!(budget.limits.terminalCny < budget.limits.globalCny)) {
    fail(`单终端上限必须低于全站上限，否则分不清「只到单终端」。实际 terminal=${budget.limits.terminalCny} global=${budget.limits.globalCny}`)
  }
  let problem: string | null = null
  const stop = (message: string) => { if (!problem) problem = message }

  const insert = async (rows: Array<{
    createdAt: Date
    status: string
    httpStatus: number | null
    featureKey: string
    costCny?: number
    terminalId?: string
    terminalVerified?: boolean
  }>) => {
    for (const row of rows) {
      await prisma.aiUsageRecord.create({
        data: {
          vendor,
          model: sentinel,
          featureKey: row.featureKey,
          status: row.status,
          httpStatus: row.httpStatus,
          dayKey: beijingDayKey(row.createdAt),
          createdAt: row.createdAt,
          costCny: row.costCny ?? 0,
          costMeasured: true,
          terminalId: row.terminalId ?? null,
          terminalVerified: row.terminalVerified ?? false,
        },
      })
    }
  }

  const collect = () => collectDerivedAlerts(prisma, new Date())
  const consistent = (collected: Awaited<ReturnType<typeof collectDerivedAlerts>>, label: string) => {
    if (collected.firingTotal !== collected.alerts.length + collected.omitted) {
      stop(`${label} firingTotal=${collected.firingTotal} 与列表 ${collected.alerts.length} + 省略 ${collected.omitted} 不一致`)
    }
  }
  const ofType = (collected: Awaited<ReturnType<typeof collectDerivedAlerts>>, type: string) => collected.alerts.filter((alert) => alert.type === type)
  const noLeak = (collected: Awaited<ReturnType<typeof collectDerivedAlerts>>, label: string) => {
    const text = JSON.stringify(collected.alerts.filter((alert) => alert.type.startsWith('ai_')))
    if (text.includes(sentinel) || text.includes('工作人员') || text.includes('resume_diagnosis') || text.includes('mock_interview')) {
      stop(`${label} 告警文本带了不该出现的内容：${text}`)
    }
  }

  // return 写在 try 里会跳过 try 后面的失败上报，变异时门禁会假绿。用 break 离开这一段。
  aiCases: {
  try {
    const anchor = new Date()
    const ago = (minutes: number) => new Date(anchor.getTime() - minutes * 60 * 1000)

    await insert([{ createdAt: ago(1), status: 'upstream_error', httpStatus: 402, featureKey: 'resume_diagnosis' }])
    let collected = await collect()
    consistent(collected, '402')
    noLeak(collected, '402')
    const provider = ofType(collected, 'ai_provider_unavailable')
    if (provider.length !== 1) stop(`402 一次应出 ai_provider_unavailable，实际 ${provider.length} 条`)
    else {
      if (provider[0].severity !== 'error') stop('账户不可用应为 error')
      if (provider[0].title !== 'AI 服务账户不可用（余额或密钥问题），用户只能用手动方式') stop(`账户不可用标题不对：${provider[0].title}`)
      if (!provider[0].detail.includes('余额不足') || !provider[0].detail.includes('1 次')) stop(`账户不可用明细不对：${provider[0].detail}`)
      if (provider[0].subjectId !== 'global' || provider[0].terminalCode !== null) stop('账户不可用必须是全站一条，不挂终端')
      const firstAt = new Date(provider[0].occurredAt)
      if (provider[0].episodeToken !== aiProviderUnavailableEpisodeToken(firstAt)) stop('账户不可用回合不是第一次失败所在的 15 分钟窗口')
      const resolved = await resolveDerivedAlert(prisma, 'ai_provider_unavailable', 'global', new Date())
      if (!resolved || resolved.episodeToken !== provider[0].episodeToken) stop('单条查证应复用同一条账户不可用告警')
    }
    if (problem) break aiCases

    await insert([{ createdAt: new Date(), status: 'ok', httpStatus: 200, featureKey: 'mock_interview' }])
    collected = await collect()
    consistent(collected, '402 之后 ok')
    if (ofType(collected, 'ai_provider_unavailable').length !== 0) stop('账户失败之后有成功，告警应消失')
    if (problem) break aiCases

    await clear()
    await insert([{ createdAt: ago(16), status: 'upstream_error', httpStatus: 402, featureKey: 'resume_diagnosis' }])
    collected = await collect()
    if (ofType(collected, 'ai_provider_unavailable').length !== 0) stop('15 分钟窗口之外的 402 不得告警')
    if (problem) break aiCases

    await clear()
    await insert([
      { createdAt: ago(3), status: 'ok', httpStatus: 200, featureKey: 'assistant_chat' },
      { createdAt: ago(1), status: 'upstream_error', httpStatus: 401, featureKey: 'career_plan' },
    ])
    collected = await collect()
    if (ofType(collected, 'ai_provider_unavailable').length !== 1) stop('成功出现在失败之前，账户不可用仍应告警')
    noLeak(collected, '401')
    if (problem) break aiCases

    await clear()
    await insert([1, 2, 3, 4].map((minute) => ({
      createdAt: ago(minute), status: 'timeout', httpStatus: null, featureKey: minute % 2 ? 'resume_diagnosis' : 'resume_optimize',
    })))
    collected = await collect()
    consistent(collected, '连续 4 次')
    if (ofType(collected, 'ai_consecutive_failures').length !== 0) stop('连续 4 次超时不得告警')
    if (problem) break aiCases

    await insert([{ createdAt: ago(0.2), status: 'timeout', httpStatus: null, featureKey: 'mock_interview' }])
    collected = await collect()
    consistent(collected, '连续 5 次')
    noLeak(collected, '连续 5 次')
    const streak = ofType(collected, 'ai_consecutive_failures')
    if (streak.length !== 1) stop(`连续 5 次超时应出 ai_consecutive_failures，实际 ${streak.length} 条`)
    else {
      if (streak[0].severity !== 'error') stop('这段时间没有成功，连续失败应为 error')
      if (!/^AI 连续失败 5 次，最近一次是超时$/.test(streak[0].title)) stop(`连续失败标题不对：${streak[0].title}`)
      if (!streak[0].detail.includes('没有成功的调用')) stop(`连续失败明细应说明没有成功：${streak[0].detail}`)
    }
    if (problem) break aiCases

    await clear()
    await insert([
      { createdAt: ago(8), status: 'ok', httpStatus: 200, featureKey: 'assistant_chat' },
      ...[1, 2, 3, 4, 5].map((minute) => ({
        createdAt: ago(minute), status: 'timeout', httpStatus: null, featureKey: 'mock_interview',
      })),
    ])
    collected = await collect()
    const warned = ofType(collected, 'ai_consecutive_failures')
    if (warned.length !== 1 || warned[0].severity !== 'warning') stop('前面有成功、末尾连续 5 次失败，应为 warning')
    if (problem) break aiCases

    await clear()
    await insert([
      { createdAt: ago(7), status: 'timeout', httpStatus: null, featureKey: 'resume_diagnosis' },
      { createdAt: ago(6), status: 'timeout', httpStatus: null, featureKey: 'resume_diagnosis' },
      { createdAt: ago(5), status: 'ok', httpStatus: 200, featureKey: 'resume_optimize' },
      { createdAt: ago(4), status: 'timeout', httpStatus: null, featureKey: 'mock_interview' },
      { createdAt: ago(3), status: 'timeout', httpStatus: null, featureKey: 'mock_interview' },
      { createdAt: ago(2), status: 'timeout', httpStatus: null, featureKey: 'career_plan' },
    ])
    collected = await collect()
    if (ofType(collected, 'ai_consecutive_failures').length !== 0) stop('中间夹成功，末尾不够 5 次，不得告警')
    if (problem) break aiCases

    await clear()
    await insert([
      ...[1, 2, 3, 4].map((minute) => ({ createdAt: ago(minute), status: 'timeout', httpStatus: null, featureKey: 'resume_diagnosis' })),
      { createdAt: ago(0.5), status: 'aborted', httpStatus: null, featureKey: 'resume_diagnosis' },
    ])
    collected = await collect()
    if (ofType(collected, 'ai_consecutive_failures').length !== 0) stop('aborted 不计，4 次超时加 1 次中止不得告警')
    if (problem) break aiCases

    await clear()
    await insert([
      ...[2, 3, 4, 5].map((minute) => ({ createdAt: ago(minute), status: 'timeout', httpStatus: null, featureKey: 'resume_diagnosis' })),
      { createdAt: ago(1), status: 'blocked', httpStatus: 200, featureKey: 'resume_diagnosis' },
    ])
    collected = await collect()
    if (ofType(collected, 'ai_consecutive_failures').length !== 0) stop('blocked 不计，4 次超时加 1 次拦截不得告警')
    if (problem) break aiCases

    await clear()
    await insert([
      { createdAt: ago(6), status: 'timeout', httpStatus: null, featureKey: 'resume_diagnosis' },
      { createdAt: ago(5), status: 'timeout', httpStatus: null, featureKey: 'mock_interview' },
      { createdAt: ago(4), status: 'aborted', httpStatus: null, featureKey: 'assistant_chat' },
      { createdAt: ago(3), status: 'timeout', httpStatus: null, featureKey: 'resume_optimize' },
      { createdAt: ago(2), status: 'blocked', httpStatus: 200, featureKey: 'career_plan' },
      { createdAt: ago(1), status: 'network_error', httpStatus: null, featureKey: 'assistant_chat' },
      { createdAt: ago(0.4), status: 'busy', httpStatus: 429, featureKey: 'mock_interview' },
    ])
    collected = await collect()
    noLeak(collected, '中止夹在中间')
    const skipped = ofType(collected, 'ai_consecutive_failures')
    if (skipped.length !== 1) stop('aborted / blocked 夹在中间应跳过，前后失败仍连续')
    else if (!skipped[0].title.includes('5 次') || !skipped[0].title.includes('繁忙')) stop(`跳过中止后的标题不对：${skipped[0].title}`)
    if (problem) break aiCases

    await clear()
    await insert([
      ...[1, 2, 3, 4].map((minute) => ({ createdAt: ago(minute), status: 'timeout', httpStatus: null, featureKey: 'resume_diagnosis' })),
      { createdAt: ago(0.3), status: 'upstream_error', httpStatus: 403, featureKey: 'mock_interview' },
    ])
    collected = await collect()
    consistent(collected, '两种同时')
    if (ofType(collected, 'ai_provider_unavailable').length !== 1) stop('账户失败与连续失败同时成立时应出第一种')
    if (ofType(collected, 'ai_consecutive_failures').length !== 0) stop('账户失败与连续失败同时成立时不得再出第二种')
    if (problem) break aiCases

    await clear()
    await insert([
      ...[12, 11].map((minute) => ({ createdAt: ago(minute), status: 'upstream_error', httpStatus: 402, featureKey: 'resume_diagnosis' })),
      { createdAt: ago(9), status: 'ok', httpStatus: 200, featureKey: 'assistant_chat' },
      ...[1, 2, 3, 4, 5].map((minute) => ({ createdAt: ago(minute), status: 'timeout', httpStatus: null, featureKey: 'career_plan' })),
    ])
    collected = await collect()
    if (ofType(collected, 'ai_provider_unavailable').length !== 0) stop('账户失败之后已有成功，不得再报账户不可用')
    if (ofType(collected, 'ai_consecutive_failures').length !== 1) stop('账户失败恢复后，末尾连续超时仍应报连续失败')
    if (problem) break aiCases

    await clear()
    const dayKey = beijingDayKey(new Date())
    budget.resetForTests()
    const baseline = await budget.spent(dayKey, { kind: 'global', id: null })
    const terminalCost = budget.limits.terminalCny + 1
    if (baseline + terminalCost >= budget.limits.globalCny) {
      stop(`当天已有花费 ${baseline}，加上单终端探针会碰到全站上限，这条断言分不清`)
      break aiCases
    }
    await insert([{
      createdAt: new Date(),
      status: 'ok',
      httpStatus: 200,
      featureKey: 'resume_generate',
      costCny: terminalCost,
      costMeasured: true,
      terminalId: `verify-ai-alert-term`,
      terminalVerified: true,
    }])
    collected = await collect()
    consistent(collected, '单终端上限')
    noLeak(collected, '单终端上限')
    if (ofType(collected, 'ai_budget_exhausted').length !== 0) stop('单终端达上限不得出 ai_budget_exhausted')
    if (problem) break aiCases

    const topUp = budget.limits.globalCny - baseline - terminalCost
    await insert([{
      createdAt: new Date(),
      status: 'ok',
      httpStatus: 200,
      featureKey: 'resume_generate',
      costCny: topUp,
      costMeasured: true,
    }])
    collected = await collect()
    consistent(collected, '全站上限')
    noLeak(collected, '全站上限')
    const exhausted = ofType(collected, 'ai_budget_exhausted')
    if (exhausted.length !== 1) stop(`全局花费达上限应出 ai_budget_exhausted，实际 ${exhausted.length} 条`)
    else {
      if (exhausted[0].severity !== 'error') stop('费用上限应为 error')
      if (exhausted[0].title !== '今天的 AI 费用上限已用完，AI 功能暂停到明天 0 点') stop(`费用上限标题不对：${exhausted[0].title}`)
      if (exhausted[0].episodeToken !== dayKey) stop(`费用上限回合应为当天日期，实际 ${exhausted[0].episodeToken}`)
      if (!exhausted[0].detail.includes(dayKey) || exhausted[0].detail.includes('元') || /\d+\.\d+/.test(exhausted[0].detail)) {
        stop(`费用上限明细只留日期，不写金额：${exhausted[0].detail}`)
      }
    }
    if (ago(20).getTime() > anchor.getTime() - AI_PROVIDER_UNAVAILABLE_WINDOW_MS) stop('窗口常量未按 15 分钟使用')
  } finally {
    await clear()
  }
  }
  // 抛错而不是 process.exit，好让 main 的 finally 清掉本轮终端和打印任务。
  // 断言仍会打出 FAIL，并由 main 的 catch 以退出码 1 结束。
  if (problem) {
    console.error(`  FAIL ${problem}`)
    throw new Error(problem)
  }
  pass('12. AI 账户不可用 / 连续失败 / 全站费用上限：判定、恢复、不计 aborted 与 blocked、单终端不报、firingTotal 与列表一致、文本不含用户输入')
}

async function main() {
  console.log('\n=== 阶段1E Admin 运营视图验证 ===')

  if (ONLINE_WINDOW_MS !== TERMINAL_ONLINE_WINDOW_MS || ONLINE_WINDOW_MS !== 5 * 60 * 1000) {
    fail('终端在线窗口必须统一引用五分钟心跳常量')
  }
  for (const relativePath of [
    'terminals/terminals-admin.service.ts',
    'terminals/terminal-toolbox.service.ts',
    'content/content.service.ts',
    'smart-campus/smart-campus.service.ts',
  ]) {
    const source = readFileSync(join(__dirname, '../src', relativePath), 'utf8')
    if (!source.includes('TERMINAL_ONLINE_WINDOW_MS') || /ONLINE_THRESHOLD_MS|ONLINE_WINDOW_MS = [235] \* 60 \* 1000/.test(source)) {
      fail(`终端读取点必须复用 TERMINAL_ONLINE_WINDOW_MS: ${relativePath}`)
    }
  }
  pass('SES-07 终端在线窗口统一为五分钟心跳常量')

  await verifyHealthyPrinterStatusesDoNotAlert()
  await verifyPrinterStatusLabelsAndShanghaiTime()
  await verifyPendingFeedbackAlert()
  await verifyPaidPendingFileUnavailableAlert()
  if (process.env.ADMIN_OPS_ALERT_HEALTH_ONLY === '1') return

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new AdminOpsService(prisma)
  const actions = new AdminAlertActionsService(prisma, new AuditService(prisma))

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const tOffline = `term_vop_off_${suffix}`
  const tOnline = `term_vop_on_${suffix}`
  const tPrinterIssue = `term_vop_pi_${suffix}`
  const adminId = `user_vop_adm_${suffix}`
  const taskOk = `pt_vop_ok_${suffix}`
  const taskFailed = `pt_vop_fail_${suffix}`
  const taskVerified = `pt_vop_verified_${suffix}`
  const taskRefunded = `pt_vop_refunded_${suffix}`
  const ordRefunded = `ord_vop_refunded_${suffix}`
  /** 第 7 节:被列表上限挤出去的观察目标。 */
  const taskTruncated = `pt_vop_trunc_${suffix}`
  /** 第 7 节:把观察目标挤出上限用的压量任务前缀。 */
  const fillerPrefix = `pt_vop_fill_${suffix}_`
  /** 第 8 节:从未被处置过的告警,用来验证 reopen 不凭空造记录。 */
  const taskFresh = `pt_vop_fresh_${suffix}`
  const limitProbePrefix = `pt_vop_limit_${suffix}_`
  const tPaid = `term_vop_paid_${suffix}`
  const paidEndUserId = `eu_vop_paid_${suffix}`
  const paidTaskIds: string[] = []
  const paidFileIds: string[] = []
  const paidOrderIds: string[] = []
  const paidSubjectKeys: string[] = []
  let paidTerminalReady = false
  let paidUserReady = false
  const tAnomaly = `term_vop_anom_${suffix}`
  let anomalyTerminalReady = false
  const subjectKeys = [
    `terminal_offline:${tOffline}`,
    `printer_issue:${tPrinterIssue}`,
    `print_failed:${taskFailed}`,
    `print_failed:${taskRefunded}`,
    `print_failed:${taskTruncated}`,
    `print_failed:${taskFresh}`,
  ]

  await prisma.user.create({
    data: {
      id: adminId,
      username: `vop_admin_${suffix}`,
      name: `VOP Admin ${suffix}`,
      passwordHash: 'hash',
      role: 'admin',
      enabled: true,
      tokenVersion: 0,
    },
  })

  // 终端:一台离线(40 分钟前心跳)、一台在线正常、一台在线但打印机缺纸
  await prisma.terminal.createMany({
    data: [
      { id: tOffline, terminalCode: `VOP-OFF-${suffix}`, agentToken: `tok_off_${suffix}`, deviceFingerprint: 'fp' },
      { id: tOnline, terminalCode: `VOP-ON-${suffix}`, agentToken: `tok_on_${suffix}`, deviceFingerprint: 'fp' },
      { id: tPrinterIssue, terminalCode: `VOP-PI-${suffix}`, agentToken: `tok_pi_${suffix}`, deviceFingerprint: 'fp' },
    ],
  })
  await prisma.terminalHeartbeat.createMany({
    data: [
      { terminalId: tOffline, printerStatus: 'ok', createdAt: new Date(Date.now() - 40 * 60 * 1000) },
      { terminalId: tOnline, printerStatus: 'ok', createdAt: new Date() },
      { terminalId: tPrinterIssue, printerStatus: 'ok', createdAt: new Date(Date.now() - 20 * 60 * 1000) },
      { terminalId: tPrinterIssue, printerStatus: 'paper_empty', createdAt: new Date() },
    ],
  })

  await prisma.printTask.createMany({
    data: [
      {
        id: taskOk, terminalId: tOnline, fileUrl: 'https://internal/secret-url', fileMd5: 'deadbeef',
        paramsJson: JSON.stringify({ fileName: '验证文件.pdf', copies: 2, colorMode: 'black_white', paperSize: 'A4' }),
        status: 'completed', completedAt: new Date(),
      },
      {
        id: taskFailed, terminalId: tOnline, fileUrl: 'https://internal/secret-url-2', fileMd5: 'cafebabe',
        paramsJson: '{broken json', status: 'failed', errorCode: 'PRINTER_OFFLINE', errorMessage: '内部细节不外露',
      },
      {
        id: taskVerified, terminalId: tOnline, fileUrl: 'https://internal/secret-url-3', fileMd5: 'verified',
        paramsJson: '{}', status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: 'printed',
      },
      {
        id: taskRefunded, terminalId: tOnline, fileUrl: 'https://internal/secret-url-4', fileMd5: 'refunded',
        paramsJson: '{}', status: 'failed', errorCode: 'PRINTER_OFFLINE',
      },
    ],
  })
  await prisma.order.create({
    data: {
      id: ordRefunded,
      orderNo: `ORD-VOP-R-${suffix.toUpperCase()}`,
      type: 'print',
      printTaskId: taskRefunded,
      terminalId: tOnline,
      amountCents: 100,
      currency: 'CNY',
      payStatus: 'refunded',
      taskStatus: 'failed',
      paymentSource: 'sandbox',
      discountCents: 0,
    },
  })

  const cleanup = async () => {
    await prisma.alertDisposition.deleteMany({ where: { subjectKey: { in: subjectKeys } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: subjectKeys } } })
    await prisma.order.deleteMany({ where: { id: ordRefunded } })
    await prisma.printTask.deleteMany({ where: { id: { startsWith: fillerPrefix } } })
    await prisma.printTask.deleteMany({
      where: { id: { in: [taskOk, taskFailed, taskVerified, taskRefunded, taskTruncated, taskFresh] } },
    })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [tOffline, tOnline, tPrinterIssue] } } })
    await prisma.terminal.deleteMany({ where: { id: { in: [tOffline, tOnline, tPrinterIssue] } } })
    await prisma.user.deleteMany({ where: { id: adminId } })
    if (paidSubjectKeys.length > 0) {
      await prisma.alertDisposition.deleteMany({ where: { subjectKey: { in: paidSubjectKeys } } })
      await prisma.auditLog.deleteMany({ where: { targetId: { in: paidSubjectKeys } } })
    }
    if (paidOrderIds.length > 0) await prisma.order.deleteMany({ where: { id: { in: paidOrderIds } } })
    if (paidTaskIds.length > 0) {
      await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: paidTaskIds } } })
      await prisma.printTask.deleteMany({ where: { id: { in: paidTaskIds } } })
    }
    if (paidFileIds.length > 0) await prisma.fileObject.deleteMany({ where: { id: { in: paidFileIds } } })
    if (paidUserReady) await prisma.endUser.deleteMany({ where: { id: paidEndUserId } })
    if (paidTerminalReady) await prisma.terminal.deleteMany({ where: { id: tPaid } })
    if (anomalyTerminalReady) await prisma.terminal.deleteMany({ where: { id: tAnomaly } })
  }

  try {
    // ── 1. 列表 + 过滤 + 分页 ──────────────────────────────────────────────
    {
      const all = await svc.listPrintTasks({ page: 1, pageSize: 100 })
      if (!all.data.some((t) => t.id === taskOk) || !all.data.some((t) => t.id === taskFailed)) fail('1. 列表缺测试任务')
      const failedOnly = await svc.listPrintTasks({ status: 'failed', page: 1, pageSize: 100 })
      if (failedOnly.data.some((t) => t.status !== 'failed')) fail('1. 状态过滤失效')
      if (failedOnly.pagination.total < 1) fail('1. 分页 total 异常')
      pass('1. 打印任务列表 + 状态过滤 + 分页')
    }

    // ── 2. 安全字段 ────────────────────────────────────────────────────────
    {
      const all = await svc.listPrintTasks({ page: 1, pageSize: 100 })
      const raw = JSON.stringify(all.data.filter((t) => t.id === taskOk || t.id === taskFailed))
      for (const banned of ['secret-url', 'deadbeef', 'cafebabe', 'fileUrl', 'fileMd5', 'paramsJson', 'errorMessage', '内部细节', 'endUserId']) {
        if (raw.includes(banned)) fail(`2. 响应泄露敏感字段: ${banned}`)
      }
      const ok = all.data.find((t) => t.id === taskOk)!
      if (ok.fileName !== '验证文件.pdf' || ok.copies !== 2 || ok.colorMode !== 'black_white') fail('2. 安全元数据提取错误')
      const broken = all.data.find((t) => t.id === taskFailed)!
      if (broken.fileName !== null || broken.copies !== null) fail('2. 损坏 paramsJson 应得 null')
      if (broken.errorCode !== 'PRINTER_OFFLINE') fail('2. errorCode 应保留(运维需要)')
      if (broken.ownerType !== 'anonymous') fail('2. 匿名任务归属应为 anonymous')
      pass('2. 安全字段收口(无文件链接/指纹/原文/内部错误细节),损坏 params 优雅降级')
    }

    // ── 3. 派生告警 ────────────────────────────────────────────────────────
    {
      const { data } = await svc.listDerivedAlerts()
      const offline = data.find((a) => a.id === `terminal_offline:${tOffline}`)
      if (!offline) fail('3. 缺少终端离线告警')
      if (offline.severity !== 'error') fail('3. 离线 40 分钟应为 error 级')
      const printerIssue = data.find((a) => a.id === `printer_issue:${tPrinterIssue}`)
      if (!printerIssue || printerIssue.severity !== 'warning') fail('3. 缺少打印机缺纸告警(warning)')
      const printFailed = data.find((a) => a.id === `print_failed:${taskFailed}`)
      if (!printFailed) fail('3. 缺少打印失败告警')
      // W-101：标题只放中文原因，错误码进明细。
      if (printFailed.title !== '打印任务失败：打印机离线') fail(`3. 打印失败告警标题应为中文原因，实际「${printFailed.title}」`)
      if (!printFailed.detail.includes('错误码 PRINTER_OFFLINE')) fail(`3. 错误码应保留在明细里，实际「${printFailed.detail}」`)
      if (data.some((a) => a.id === `print_failed:${taskVerified}`)) fail('3. 已核查任务不得再进失败告警')
      if (data.some((a) => a.terminalCode === `VOP-ON-${suffix}` && a.type !== 'print_failed')) {
        fail('3. 在线正常终端不应产生终端/打印机告警')
      }
      if (data.some((a) => a.id === `print_failed:${taskRefunded}`)) fail('3. 已退款失败单不得再进告警')
      if (offline.conditionState !== 'firing' || offline.handlingState !== 'open') fail('3. 新告警应为 firing + open')
      pass('3. 派生告警:离线(error)/缺纸(warning)/打印失败齐全,正常终端无告警')
    }

    // ── 4. 确认持久化，确认 ≠ 恢复 ──────────────────────────────────────
    {
      const openList = await svc.listDerivedAlerts('open')
      const offline = openList.data.find((a) => a.id === `terminal_offline:${tOffline}`)
      if (!offline) fail('4. 确认前应能看到离线告警')
      const first = await actions.dispose({
        subjectKey: offline.subjectKey,
        episodeToken: offline.episodeToken,
        action: 'acknowledge',
      }, adminId)
      if (first.idempotent || first.handlingState !== 'acknowledged' || first.conditionState !== 'firing') {
        fail(`4. 首次确认返回异常：${JSON.stringify(first)}`)
      }
      const again = await actions.dispose({
        subjectKey: offline.subjectKey,
        episodeToken: offline.episodeToken,
        action: 'acknowledge',
      }, adminId)
      if (!again.idempotent) fail('4. 重复确认应幂等')
      const afterOpen = await svc.listDerivedAlerts('open')
      if (afterOpen.data.some((a) => a.id === offline.id)) fail('4. 确认后不应再出现在待处理列表')
      const afterAck = await svc.listDerivedAlerts('acknowledged')
      const still = afterAck.data.find((a) => a.id === offline.id)
      if (!still) fail('4. 确认后应能在已确认列表看到')
      if (still.conditionState !== 'firing' || still.handlingState !== 'acknowledged') fail('4. 确认后不得把仍离线说成已恢复')
      if (afterAck.firingCount < 1) fail('4. firingCount 应计入仍在发生的已确认告警')
      try {
        await actions.dispose({
          subjectKey: offline.subjectKey,
          episodeToken: 'not-the-current-episode',
          action: 'acknowledge',
        }, adminId)
        fail('4. 错误 episode 应被拒绝')
      } catch (err) {
        if (errorCode(err) !== 'ALERT_EPISODE_CHANGED') fail(`4. 期望 ALERT_EPISODE_CHANGED，得到 ${errorCode(err)}`)
      }
      const audits = await prisma.auditLog.findMany({
        where: { action: 'alert.acknowledge', targetId: offline.subjectKey },
      })
      if (audits.length !== 1) fail(`4. 确认审计应写 1 条，实际 ${audits.length}`)
      pass('4. 确认持久化、待处理消失、仍标问题在发生、错 episode 拒绝、审计 1 条')
    }

    // ── 5. 静默 / 关闭 / 恢复后再发 ────────────────────────────────────
    {
      const failed = (await svc.listDerivedAlerts('open')).data.find((a) => a.id === `print_failed:${taskFailed}`)
      if (!failed) fail('5. 缺少可关闭的失败告警')
      await actions.dispose({
        subjectKey: failed.subjectKey,
        episodeToken: failed.episodeToken,
        action: 'close',
      }, adminId)
      const afterClose = await svc.listDerivedAlerts('open')
      if (afterClose.data.some((a) => a.id === failed.id)) fail('5. 关闭后待处理仍能看到失败告警')
      const hidden = (await svc.listDerivedAlerts('suppressed')).data.find((a) => a.id === failed.id)
      if (!hidden || hidden.handlingState !== 'closed' || hidden.conditionState !== 'firing') {
        fail('5. 关闭后仍应能看到「已关闭但问题仍在发生」')
      }
      const closeAudits = await prisma.auditLog.findMany({
        where: { action: 'alert.close', targetId: failed.subjectKey },
      })
      if (closeAudits.length !== 1) fail('5. 关闭审计未写入')

      const issue = (await svc.listDerivedAlerts('open')).data.find((a) => a.id === `printer_issue:${tPrinterIssue}`)
      if (!issue) fail('5. 缺少打印机异常告警')
      await actions.dispose({
        subjectKey: issue.subjectKey,
        episodeToken: issue.episodeToken,
        action: 'silence',
        duration: '1h',
      }, adminId)
      if ((await svc.listDerivedAlerts('open')).data.some((a) => a.id === issue.id)) fail('5. 静默后仍在待处理')
      const silenced = (await svc.listDerivedAlerts('suppressed')).data.find((a) => a.id === issue.id)
      if (!silenced || silenced.handlingState !== 'silenced' || !silenced.silencedUntil) fail('5. 静默态未持久化')

      const beforeRecoveryRow = await prisma.alertDisposition.findUnique({ where: { subjectKey: issue.subjectKey } })
      const recoveredAt = new Date()
      await prisma.terminalHeartbeat.create({
        data: { terminalId: tPrinterIssue, printerStatus: 'ok', createdAt: recoveredAt },
      })
      const recovered = await svc.listDerivedAlerts('all')
      if (recovered.data.some((a) => a.id === issue.id)) fail('5. 打印机恢复后不应再派生 printer_issue')
      // 旧行为是「派生列表里没有这条 → 写 recoveredAt」。那是用缺席反推恢复：
      // 缺席也可能只是被列表上限截断，会把仍在 firing 的告警标成已恢复，
      // 并在它重新进入列表时把操作员的处置无声撤销。现在 GET 一律不写库，
      // 「恢复后再发作」由 episodeToken 变化负责（下面几行断言）。
      const stale = await prisma.alertDisposition.findUnique({ where: { subjectKey: issue.subjectKey } })
      if (!stale) fail('5. GET 不得删除处置记录')
      if (stale.recoveredAt !== null) fail('5. GET 不得因「本次列表没看见」就写 recoveredAt')
      if (dispositionFingerprint(stale) !== dispositionFingerprint(beforeRecoveryRow)) {
        fail('5. GET 是只读端点，不得改动 AlertDisposition 任何字段')
      }
      await prisma.terminalHeartbeat.create({
        data: { terminalId: tPrinterIssue, printerStatus: 'paper_empty', createdAt: new Date(recoveredAt.getTime() + 1000) },
      })
      const recurred = (await svc.listDerivedAlerts('open')).data.find((a) => a.id === issue.id)
      if (!recurred) fail('5. 恢复后再缺纸应作为新一轮待处理告警')
      if (recurred.handlingState !== 'open') fail('5. 新一轮故障不得继承旧静默')
      if (recurred.episodeToken === issue.episodeToken) fail('5. 新一轮 episodeToken 应变化')
      pass('5. 关闭/静默持久化、恢复后消失(GET 不写库)、再发作为新一轮待处理')
    }

    // ── 5b. GET 只读：连查多次不得改动任何 disposition ────────────────────
    {
      const keys = [`terminal_offline:${tOffline}`, `print_failed:${taskFailed}`, `printer_issue:${tPrinterIssue}`]
      const snapshot = async () => {
        const rows = await prisma.alertDisposition.findMany({ where: { subjectKey: { in: keys } } })
        return keys
          .map((k) => `${k}=${dispositionFingerprint(rows.find((r) => r.subjectKey === k) ?? null)}`)
          .join('\n')
      }
      const before = await snapshot()
      for (const v of ['open', 'acknowledged', 'suppressed', 'all'] as const) {
        await svc.listDerivedAlerts(v)
      }
      const after = await snapshot()
      if (before !== after) fail(`5b. GET /admin/alerts 写了库：\n before=${before}\n after=${after}`)
      pass('5b. 连续 4 次列表查询不改动任何 AlertDisposition(读端点无副作用)')
    }

    // ── 6. HTTP：造告警 → 确认 → 再查列表 ────────────────────────────────
    if (process.env.ADMIN_OPS_SKIP_HTTP !== '1') {
      process.env['JWT_SECRET'] ||= 'dev-only-secret-please-replace-in-prod-min-16-chars'
      const jwtSecret = process.env['JWT_SECRET']
      const redisStub = {
        get: async () => null,
        del: async () => 0,
        setJsonIfVersionNotOlder: async () => 'stored' as const,
      }
      const httpPrisma = new PrismaService()
      await httpPrisma.onModuleInit()
      @Module({
        imports: [JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '30m' } })],
        controllers: [AdminOpsController],
        providers: [
          { provide: PrismaService, useValue: httpPrisma },
          AdminOpsService,
          AdminAlertActionsService,
          AuditService,
          JwtAuthGuard,
          RolesGuard,
          Reflector,
          { provide: RedisService, useValue: redisStub },
        ],
      })
      class AlertHttpModule {}

      const app = await NestFactory.create<NestExpressApplication>(AlertHttpModule, { logger: ['error'] })
      app.setGlobalPrefix('api/v1')
      app.useGlobalFilters(new HttpExceptionFilter())
      await app.listen(0, '127.0.0.1')
      try {
        const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
        const jwt = app.get(JwtService)
        const token = jwt.sign({ sub: adminId, ver: 0, jti: randomUUID() })
        const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

        const unauth = await fetch(`${base}/admin/alerts`)
        if (unauth.status !== 401) fail(`6. 无 token 应为 401，得到 ${unauth.status}`)

        const beforeRes = await fetch(`${base}/admin/alerts?view=open`, { headers: auth })
        const before = await beforeRes.json() as { data: Array<{ id: string; subjectKey: string; episodeToken: string; handlingState: string; conditionState: string }>; firingCount: number; openCount: number }
        if (beforeRes.status !== 200) fail(`6. GET open 失败：${beforeRes.status} ${JSON.stringify(before)}`)
        const target = before.data.find((a) => a.id === `printer_issue:${tPrinterIssue}`)
        if (!target) fail('6. HTTP 待处理列表缺少新一轮打印机异常')

        const postRes = await fetch(`${base}/admin/alerts/disposition`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectKey: target.subjectKey,
            episodeToken: target.episodeToken,
            action: 'acknowledge',
          }),
        })
        const posted = await postRes.json() as { handlingState?: string; conditionState?: string; idempotent?: boolean }
        if (postRes.status !== 200) fail(`6. POST 确认失败：${postRes.status} ${JSON.stringify(posted)}`)
        if (posted.handlingState !== 'acknowledged' || posted.conditionState !== 'firing' || posted.idempotent !== false) {
          fail(`6. POST 确认响应不诚实：${JSON.stringify(posted)}`)
        }

        const afterOpenRes = await fetch(`${base}/admin/alerts?view=open`, { headers: auth })
        const afterOpen = await afterOpenRes.json() as { data: Array<{ id: string }> }
        if (afterOpen.data.some((a) => a.id === target.id)) fail('6. HTTP 确认后待处理仍能看到该条')

        const afterAckRes = await fetch(`${base}/admin/alerts?view=acknowledged`, { headers: auth })
        const afterAck = await afterAckRes.json() as { data: Array<{ id: string; handlingState: string; conditionState: string }>; firingCount: number }
        const still = afterAck.data.find((a) => a.id === target.id)
        if (!still) fail('6. HTTP 确认后已确认列表看不到该条')
        if (still.handlingState !== 'acknowledged' || still.conditionState !== 'firing') fail('6. HTTP 确认后把仍在发生说成已恢复')
        if (afterAck.firingCount < 1) fail('6. HTTP firingCount 未计入仍在发生的已确认告警')
        pass('6. HTTP 造告警→确认→待处理消失、已确认仍标问题在发生')
      } finally {
        await app.close()
        await httpPrisma.onModuleDestroy?.()
      }
    } else {
      console.log('  SKIP 6. HTTP 子段（ADMIN_OPS_SKIP_HTTP=1，仅用于禁止监听端口的沙箱）')
    }

    // ── 7. 列表上限：精确计数 + 如实截断 + 被截断的告警仍可处置 ──────────
    //
    // 复现的是 M1：take:50 的截断 × 「不在列表即判恢复」。
    // 第 51 条以后的失败任务永远进不了列表，操作员既看不到也处置不了；
    // 更糟的是它早先被关闭过的话，下一次 GET 会把它标成已恢复，
    // 等它重新落回列表，处置就被无声撤销了。
    {
      const victimKey = `print_failed:${taskTruncated}`
      await prisma.printTask.create({
        data: {
          id: taskTruncated, terminalId: tOnline, fileUrl: 'https://internal/secret-url-5', fileMd5: 'trunc',
          paramsJson: '{}', status: 'failed', errorCode: 'PRINTER_OFFLINE',
          updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      })
      const seen = (await svc.listDerivedAlerts('open')).data.find((a) => a.id === victimKey)
      if (!seen) fail('7. 前置：目标失败告警应先可见')
      await actions.dispose({ subjectKey: victimKey, episodeToken: seen.episodeToken, action: 'close' }, adminId)

      // 压入 cap+3 条更新的失败任务，把观察目标挤出物化上限
      const fillerIds = Array.from({ length: PRINT_FAILED_LIST_CAP + 3 }, (_, i) => `${fillerPrefix}${i}`)
      const baseMs = Date.now()
      await prisma.printTask.createMany({
        data: fillerIds.map((id, i) => ({
          id, terminalId: tOnline, fileUrl: 'https://internal/secret-url-6', fileMd5: 'fill',
          paramsJson: '{}', status: 'failed', errorCode: 'PRINTER_OFFLINE',
          updatedAt: new Date(baseMs - i * 1000),
        })),
      })

      const listed = await svc.listDerivedAlerts('all')
      if (listed.data.some((a) => a.id === victimKey)) fail('7. 前置：目标应已被列表上限挤出')
      if (!listed.truncation) fail('7. 被截断时必须如实告知界面(truncation 不得为 null)')
      if (listed.truncation.cap !== PRINT_FAILED_LIST_CAP) fail('7. truncation.cap 应回真实上限')
      if (listed.truncation.type !== 'print_failed') fail('7. truncation 必须说明被截断的是哪一类')
      if (listed.listedCount !== listed.data.length) fail('7. listedCount 应等于本次实际列出的条数')
      if (listed.total !== listed.firingCount) fail('7. total 必须等于当前仍在发生的精确总数')
      if (!listed.truncated) fail('7. 截断时 truncated 必须为 true')
      if (listed.firingCount <= listed.listedCount) {
        fail(`7. 截断时 firingCount 必须大于已列出条数，不得把上限当成全部(${listed.firingCount}/${listed.listedCount})`)
      }
      // total 还含终端类告警；truncation.omitted 只统计 print_failed 的派生层上限。
      if (listed.truncation.omitted < 3) {
        fail(`7. 派生层 omitted 必须反映超过 PRINT_FAILED_LIST_CAP 的打印失败告警，实际=${listed.truncation.omitted}`)
      }
      if (listed.firingCount < PRINT_FAILED_LIST_CAP + 3) fail('7. firingCount 应是精确总数，不受列表上限影响')

      const defaultLimit = await svc.listDerivedAlerts('all')
      if (defaultLimit.data.length !== 50 || defaultLimit.total !== listed.total || !defaultLimit.truncated) {
        fail(`7. 默认 limit=50 必须保留总数并如实截断：${JSON.stringify({ length: defaultLimit.data.length, total: defaultLimit.total, truncated: defaultLimit.truncated })}`)
      }
      const raisedLimit = await svc.listDerivedAlerts('all', 100)
      if (raisedLimit.data.length !== 100 || raisedLimit.total !== listed.total || !raisedLimit.truncated) {
        fail(`7. limit=100 必须仍按上限截断：${JSON.stringify({ length: raisedLimit.data.length, total: raisedLimit.total, truncated: raisedLimit.truncated })}`)
      }

      // 真值：这条任务此刻确实仍然满足告警条件
      const truth = await prisma.printTask.findUnique({
        where: { id: taskTruncated },
        select: { status: true, printOutcome: true },
      })
      if (truth?.status !== 'failed' || truth.printOutcome !== null) fail('7. 前置：目标任务应仍是失败未核查')

      // 缺席不得被当成恢复
      const row = await prisma.alertDisposition.findUnique({ where: { subjectKey: victimKey } })
      if (!row) fail('7. 被截断的告警不得丢失处置记录')
      if (row.recoveredAt !== null) fail('7. 仍在 firing 的告警被截断后不得标成已恢复')
      if (row.action !== 'closed') fail('7. 被截断期间处置动作不得被改写')

      // 被截断的告警仍可处置：处置走单条正向查证，不扫列表
      const onTruncated = await actions.dispose(
        { subjectKey: victimKey, episodeToken: taskTruncated, action: 'acknowledge' },
        adminId,
      )
      if (onTruncated.handlingState !== 'acknowledged') fail('7. 被列表上限截断的告警仍应可处置')
      if (onTruncated.conditionState !== 'firing') fail('7. 被截断的告警仍在发生，不得报成已恢复')

      // 回到列表后处置态不得被撤销
      await prisma.printTask.deleteMany({ where: { id: { in: fillerIds } } })
      const backList = await svc.listDerivedAlerts('all')
      const back = backList.data.find((a) => a.id === victimKey)
      if (!back) fail('7. 压量任务删除后目标应重新出现在列表')
      if (back.handlingState !== 'acknowledged') fail(`7. 重新进入列表后处置被撤销：${back.handlingState}`)
      if (back.conditionState !== 'firing') fail('7. 目标仍在发生')
      if (backList.listedCount < PRINT_FAILED_LIST_CAP && backList.truncation !== null) {
        fail('7. 未触及上限时 truncation 应为 null')
      }
      if (backList.total !== backList.firingCount) fail('7. API total 必须等于 firingCount')
      if (backList.total <= 50 && (backList.truncated || backList.firingCount !== backList.listedCount)) {
        fail('7. 未触及 API 默认 50 条上限时，truncated 必须为 false 且 total 等于 listedCount')
      }
      pass('7. 列表上限如实告知(total/firingCount 精确、默认 50/可提至 100、truncated 一致)，被截断的告警不被判恢复、仍可处置、回列表后处置不丢')
    }

    // ── 8. reopen：关闭可撤销，不再是同一 episode 内的单向门 ──────────────
    {
      const offlineKey = `terminal_offline:${tOffline}`
      const target = (await svc.listDerivedAlerts('all')).data.find((a) => a.id === offlineKey)
      if (!target) fail('8. 前置：离线告警应仍在发生')
      await actions.dispose({ subjectKey: offlineKey, episodeToken: target.episodeToken, action: 'close' }, adminId)
      if ((await svc.listDerivedAlerts('open')).data.some((a) => a.id === offlineKey)) fail('8. 关闭后不应在待处理')

      const reopened = await actions.dispose(
        { subjectKey: offlineKey, episodeToken: target.episodeToken, action: 'reopen' },
        adminId,
      )
      if (reopened.handlingState !== 'open') fail(`8. reopen 后应回到待处理，得到 ${reopened.handlingState}`)
      if (reopened.action !== 'reopened') fail('8. reopen 应落 action=reopened')
      if (reopened.idempotent) fail('8. 首次 reopen 不应报幂等')
      if (reopened.conditionState !== 'firing') fail('8. reopen 不改变故障仍在发生这一事实')

      const backOpen = (await svc.listDerivedAlerts('open')).data.find((a) => a.id === offlineKey)
      if (!backOpen) fail('8. reopen 后应重新出现在待处理视图')
      if (backOpen.handlingState !== 'open') fail('8. reopen 后列表处置态应为 open')
      // POST 报出来的状态必须等于随后 GET 看到的状态
      if (backOpen.handlingState !== reopened.handlingState) fail('8. POST 与 GET 的 handlingState 不一致')
      const storedRow = await prisma.alertDisposition.findUnique({ where: { subjectKey: offlineKey } })
      if (storedRow?.action !== 'reopened') fail('8. reopen 应持久化，不只是内存态')
      if (storedRow.recoveredAt !== null) fail('8. reopen 不得把仍在发生的告警写成已恢复')

      const reopenAudits = await prisma.auditLog.findMany({ where: { action: 'alert.reopen', targetId: offlineKey } })
      if (reopenAudits.length !== 1) fail(`8. reopen 审计应写 1 条，实际 ${reopenAudits.length}`)

      const again = await actions.dispose(
        { subjectKey: offlineKey, episodeToken: target.episodeToken, action: 'reopen' },
        adminId,
      )
      if (!again.idempotent) fail('8. 重复 reopen 应幂等')
      const auditsAfter = await prisma.auditLog.findMany({ where: { action: 'alert.reopen', targetId: offlineKey } })
      if (auditsAfter.length !== 1) fail('8. 幂等 reopen 不得重复写审计')

      // 从未被处置过的告警上 reopen：是无操作，不该凭空造一行处置记录
      await prisma.printTask.create({
        data: {
          id: taskFresh, terminalId: tOnline, fileUrl: 'https://internal/secret-url-7', fileMd5: 'fresh',
          paramsJson: '{}', status: 'failed', errorCode: 'PRINTER_OFFLINE',
        },
      })
      const freshKey = `print_failed:${taskFresh}`
      const freshReopen = await actions.dispose(
        { subjectKey: freshKey, episodeToken: taskFresh, action: 'reopen' },
        adminId,
      )
      if (!freshReopen.idempotent) fail('8. 对本来就待处理的告警 reopen 应是幂等无操作')
      if (freshReopen.handlingState !== 'open') fail('8. 未处置过的告警 reopen 后仍应是 open')
      if (await prisma.alertDisposition.findUnique({ where: { subjectKey: freshKey } })) {
        fail('8. 无操作的 reopen 不得凭空写处置记录')
      }
      if ((await prisma.auditLog.findMany({ where: { action: 'alert.reopen', targetId: freshKey } })).length !== 0) {
        fail('8. 无操作的 reopen 不得写审计')
      }

      try {
        await actions.dispose({ subjectKey: offlineKey, episodeToken: target.episodeToken, action: 'resolve' }, adminId)
        fail('8. 未知动作应被拒绝')
      } catch (err) {
        if (errorCode(err) !== 'ALERT_ACTION_INVALID') fail(`8. 期望 ALERT_ACTION_INVALID，得到 ${errorCode(err)}`)
      }
      pass('8. reopen 可撤销关闭并回到待处理、持久化 + 审计 1 条、重复与无操作均幂等、未知动作仍拒绝')
    }

    // ── 9. API 响应上限：73 条 → 默认 50，limit=100 全量 ─────────────────
    {
      const now = new Date()
      const limitProbe = new AdminOpsService(mockOpsPrisma([], Array.from({ length: 73 }, (_, index) => ({
        id: `${limitProbePrefix}${index}`,
        errorCode: 'PRINTER_OFFLINE',
        updatedAt: new Date(now.getTime() - index * 1000),
        terminal: null,
        order: null,
      }))))
      const limitController = new AdminOpsController(limitProbe, {} as AdminAlertActionsService)
      const defaultPage = await limitController.listAlerts('all')
      const raisedPage = await limitController.listAlerts('all', '100')
      if (
        defaultPage.data.length !== 50
        || defaultPage.total !== 73
        || !defaultPage.truncated
        || raisedPage.data.length !== 73
        || raisedPage.total !== 73
        || raisedPage.truncated
      ) {
        fail(`9. 73 条告警 API 上限契约不成立：${JSON.stringify({ default: { count: defaultPage.data.length, total: defaultPage.total, truncated: defaultPage.truncated }, raised: { count: raisedPage.data.length, total: raisedPage.total, truncated: raisedPage.truncated } })}`)
      }
      pass('9. 73 条告警：默认返回 50 + total + truncated；limit=100 返回全部 73')
    }
    // ── 9b. truncated 必须按当前 view 判断：open 视图里存在已确认告警 ≠ 被截断 ──
    // 反例（2026-09-06 复核时发现的实现缺陷）：拿全视图的 total 去比 open 视图的 data，
    // 只要有 20 条已确认，open 视图就会永远显示「仅展示前 53 条，共 73 条」。
    {
      const now = new Date()
      const rows = Array.from({ length: 73 }, (_, index) => ({
        id: `${limitProbePrefix}view_${index}`,
        errorCode: 'PRINTER_OFFLINE',
        updatedAt: new Date(now.getTime() - index * 1000),
        terminal: null,
        order: null,
      }))
      const probeAll = new AdminOpsController(new AdminOpsService(mockOpsPrisma([], rows)), {} as AdminAlertActionsService)
      const everything = await probeAll.listAlerts('all', '100')
      const acknowledged = everything.data.slice(0, 20).map((item) => ({
        subjectKey: item.subjectKey,
        action: 'acknowledged',
        episodeToken: item.episodeToken,
        recoveredAt: null,
        silencedUntil: null,
        note: null,
        updatedAt: now,
      }))
      const mixed = new AdminOpsController(new AdminOpsService(mockOpsPrisma([], rows, acknowledged)), {} as AdminAlertActionsService)
      const openAll = await mixed.listAlerts('open', '100')
      const openDefault = await mixed.listAlerts('open')
      const ackAll = await mixed.listAlerts('acknowledged', '100')
      const snapshot = {
        openAll: { count: openAll.data.length, viewTotal: openAll.viewTotal, truncated: openAll.truncated, total: openAll.total },
        openDefault: { count: openDefault.data.length, viewTotal: openDefault.viewTotal, truncated: openDefault.truncated },
        ackAll: { count: ackAll.data.length, viewTotal: ackAll.viewTotal, truncated: ackAll.truncated },
      }
      if (openAll.data.length !== 53 || openAll.viewTotal !== 53 || openAll.truncated || openAll.total !== 73) {
        fail(`9b. open 视图未被截断时不得报 truncated：${JSON.stringify(snapshot)}`)
      }
      if (openDefault.data.length !== 50 || openDefault.viewTotal !== 53 || !openDefault.truncated) {
        fail(`9b. open 视图被 limit 截断时 truncated 必须为 true 且 viewTotal 精确：${JSON.stringify(snapshot)}`)
      }
      if (ackAll.data.length !== 20 || ackAll.viewTotal !== 20 || ackAll.truncated) {
        fail(`9b. acknowledged 视图 20 条全部列出时不得报 truncated：${JSON.stringify(snapshot)}`)
      }
      pass('9b. truncated / viewTotal 按当前 view 判断；total 仍是全部在发告警数（73）')
    }

    // ── 10. 真实库：已支付 pending 文件不可用 ─────────────────────────────
    {
      const signedUrl = `https://files.invalid/vop-signed-url-${suffix}`
      const shaCanary = `vop-sha-${suffix}`
      const pickupCanary = `vop-pickup-${suffix}`
      const ownerCanary = `vop-owner-${suffix}`
      const nameCanary = `vop-named-${suffix}.pdf`
      const amountCanary = 975311
      const paidCode = `VOP-PAID-${suffix}`
      const onlineCode = `VOP-ON-${suffix}`
      const past = new Date(Date.now() - 60 * 60 * 1000)
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const banned = [signedUrl, shaCanary, pickupCanary, ownerCanary, nameCanary, String(amountCanary), 'storageKey', 'fileUrl', 'fileMd5', 'sha256', 'pickupCode', 'amountCents', 'phoneEnc', 'phoneHash', 'endUserId', paidEndUserId, `vop-storage-${suffix}`]
      const publicKeys = ['id', 'subjectKey', 'episodeToken', 'type', 'severity', 'title', 'detail', 'terminalCode', 'occurredAt', 'conditionState', 'handlingState', 'acknowledgedAt', 'silencedUntil', 'note']

      await prisma.terminal.create({
        data: { id: tPaid, terminalCode: paidCode, agentToken: `tok_paid_${suffix}`, deviceFingerprint: 'fp' },
      })
      paidTerminalReady = true
      await prisma.endUser.create({
        data: { id: paidEndUserId, phoneHash: `phonehash_${suffix}`, phoneEnc: ownerCanary },
      })
      paidUserReady = true

      const seed = async (key: string, args: {
        terminalId: string
        file: { status: string; deletedAt?: Date | null; expiresAt?: Date | null } | null
        payStatus: string
        taskStatus?: string
        withOwner?: boolean
      }) => {
        const taskId = `pt_vop_paid_${suffix}_${key}`
        const fileId = args.file ? `file_vop_paid_${suffix}_${key}` : null
        if (fileId && args.file) {
          await prisma.fileObject.create({
            data: {
              id: fileId,
              storageKey: `vop-storage-${suffix}-${key}`,
              filename: nameCanary,
              mimeType: 'application/pdf',
              sizeBytes: 128,
              sha256: shaCanary,
              purpose: 'print',
              status: args.file.status,
              deletedAt: args.file.deletedAt ?? null,
              expiresAt: args.file.expiresAt ?? null,
              endUserId: args.withOwner ? paidEndUserId : null,
            },
          })
          paidFileIds.push(fileId)
        }
        await prisma.printTask.create({
          data: {
            id: taskId,
            terminalId: args.terminalId,
            endUserId: args.withOwner ? paidEndUserId : null,
            fileId,
            fileUrl: signedUrl,
            fileMd5: shaCanary,
            paramsJson: '{}',
            status: args.taskStatus ?? 'pending',
          },
        })
        paidTaskIds.push(taskId)
        const orderId = `ord_vop_paid_${suffix}_${key}`
        await prisma.order.create({
          data: {
            id: orderId,
            orderNo: `ORD-VOP-P-${key}-${suffix}`.toUpperCase(),
            type: 'print',
            printTaskId: taskId,
            terminalId: args.terminalId,
            endUserId: args.withOwner ? paidEndUserId : null,
            amountCents: amountCanary,
            currency: 'CNY',
            payStatus: args.payStatus,
            taskStatus: args.taskStatus ?? 'pending',
            paymentSource: args.payStatus === 'unpaid' ? null : 'sandbox',
            discountCents: 0,
            pickupCode: key === 'uploading' ? pickupCanary : null,
            sourceFileSha256: shaCanary,
          },
        })
        paidOrderIds.push(orderId)
        paidSubjectKeys.push(`paid_pending_file_unavailable:${taskId}`)
        return { taskId, fileId }
      }

      const active = await seed('active', { terminalId: tPaid, file: { status: 'active' }, payStatus: 'paid' })
      await seed('future', { terminalId: tPaid, file: { status: 'active', expiresAt: future }, payStatus: 'paid' })
      const uploading = await seed('uploading', { terminalId: tPaid, file: { status: 'uploading' }, payStatus: 'paid', withOwner: true })
      await seed('quarantined', { terminalId: tPaid, file: { status: 'quarantined' }, payStatus: 'paid' })
      await seed('deleted', { terminalId: tPaid, file: { status: 'active', deletedAt: past }, payStatus: 'paid' })
      await seed('expired', { terminalId: tPaid, file: { status: 'active', expiresAt: past }, payStatus: 'paid' })
      const setNull = await seed('setnull', { terminalId: tPaid, file: { status: 'active' }, payStatus: 'paid' })
      await seed('refunded', { terminalId: tPaid, file: { status: 'uploading' }, payStatus: 'refunded' })
      await seed('legacy', { terminalId: tPaid, file: null, payStatus: 'paid' })
      await seed('unpaid', { terminalId: tPaid, file: { status: 'uploading' }, payStatus: 'unpaid' })
      await seed('other', { terminalId: tOnline, file: { status: 'quarantined' }, payStatus: 'paid' })
      if (!setNull.fileId) fail('10. SET NULL 夹具必须先有文件')
      await prisma.fileObject.delete({ where: { id: setNull.fileId } })
      const cleared = await prisma.printTask.findUnique({
        where: { id: setNull.taskId },
        select: { fileId: true },
      })
      if (cleared?.fileId !== null) fail('10. 正常删除文件后 fileId 必须被 ON DELETE SET NULL 清空')

      const expected = [
        ['uploading', '文件仍在上传', paidCode],
        ['quarantined', '文件处于隔离状态', paidCode],
        ['deleted', '文件已删除', paidCode],
        ['expired', '文件已过期', paidCode],
        ['other', '文件处于隔离状态', onlineCode],
      ] as const
      const alertId = (key: string) => `paid_pending_file_unavailable:pt_vop_paid_${suffix}_${key}`
      const load = async (view: 'open' | 'acknowledged' | 'suppressed' | 'all') => svc.listDerivedAlerts(view, 100)
      const first = await load('open')
      const second = await load('open')
      const got = first.data
        .filter((item) => item.id.startsWith(`paid_pending_file_unavailable:pt_vop_paid_${suffix}_`))
        .map((item) => item.id)
        .sort()
      const want = expected.map(([key]) => alertId(key)).sort()
      if (got.join('|') !== want.join('|')) {
        fail(`10. 真实库误报或漏报：got=${got.join('|')} want=${want.join('|')}`)
      }
      for (const [key, reason, terminalCode] of expected) {
        const alert = first.data.find((item) => item.id === alertId(key))
        const again = second.data.find((item) => item.id === alertId(key))
        if (!alert || !again) fail(`10. 缺少 ${key} 告警`)
        if (alert.severity !== 'error' || alert.conditionState !== 'firing' || alert.handlingState !== 'open') {
          fail(`10. ${key} 初始状态错误`)
        }
        const subjectId = alert.subjectKey.slice('paid_pending_file_unavailable:'.length)
        if (subjectId !== `pt_vop_paid_${suffix}_${key}` || alert.subjectKey !== alert.id || alert.terminalCode !== terminalCode) {
          fail(`10. ${key} 归属不是对应任务/终端`)
        }
        if (!alert.detail.includes(reason) || !alert.detail.includes(terminalCode)) fail(`10. ${key} 详情未说明原因或终端`)
        if (again.episodeToken !== alert.episodeToken) fail(`10. ${key} 的 episodeToken 不稳定`)
        const encoded = JSON.stringify(alert)
        for (const secret of banned) {
          if (encoded.includes(secret)) fail(`10. ${key} 告警泄露 ${secret}`)
        }
        for (const field of Object.keys(alert)) {
          if (!publicKeys.includes(field)) fail(`10. ${key} 告警出现未声明字段 ${field}`)
        }
      }
      const uploadingAlert = first.data.find((item) => item.id === alertId('uploading'))!
      const resolved = await resolveDerivedAlert(prisma, 'paid_pending_file_unavailable', uploading.taskId, new Date())
      if (!resolved || resolved.subjectKey !== uploadingAlert.subjectKey || resolved.episodeToken !== uploadingAlert.episodeToken) {
        fail('10. 单条正向查证必须复用同一条真实库告警')
      }
      for (const absentId of [active.taskId, setNull.taskId, `pt_vop_paid_${suffix}_legacy`, `pt_vop_paid_${suffix}_refunded`, `pt_vop_paid_${suffix}_unpaid`, `pt_vop_paid_${suffix}_future`]) {
        if (await resolveDerivedAlert(prisma, 'paid_pending_file_unavailable', absentId, new Date())) {
          fail(`10. 不应正向查到 ${absentId}`)
        }
      }

      const acknowledged = await actions.dispose({
        subjectKey: uploadingAlert.subjectKey,
        episodeToken: uploadingAlert.episodeToken,
        action: 'acknowledge',
      }, adminId)
      if (acknowledged.idempotent || acknowledged.handlingState !== 'acknowledged' || acknowledged.conditionState !== 'firing') {
        fail('10. 首次确认返回异常')
      }
      if ((await load('open')).data.some((item) => item.id === uploadingAlert.id)) fail('10. 确认后仍在待处理')
      const ackRow = (await load('acknowledged')).data.find((item) => item.id === uploadingAlert.id)
      if (!ackRow || ackRow.handlingState !== 'acknowledged' || ackRow.conditionState !== 'firing') fail('10. 确认后已确认列表不诚实')
      if ((await prisma.auditLog.findMany({ where: { action: 'alert.acknowledge', targetId: uploadingAlert.subjectKey } })).length !== 1) {
        fail('10. 确认审计应只有 1 条')
      }
      if (!(await actions.dispose({
        subjectKey: uploadingAlert.subjectKey,
        episodeToken: uploadingAlert.episodeToken,
        action: 'acknowledge',
      }, adminId)).idempotent) fail('10. 重复确认应幂等')
      try {
        await actions.dispose({
          subjectKey: uploadingAlert.subjectKey,
          episodeToken: 'not-the-current-episode',
          action: 'acknowledge',
        }, adminId)
        fail('10. 错误 episode 应被拒绝')
      } catch (err) {
        if (errorCode(err) !== 'ALERT_EPISODE_CHANGED') fail(`10. 期望 ALERT_EPISODE_CHANGED，得到 ${errorCode(err)}`)
      }
      await actions.dispose({
        subjectKey: uploadingAlert.subjectKey,
        episodeToken: uploadingAlert.episodeToken,
        action: 'close',
      }, adminId)
      if ((await load('open')).data.some((item) => item.id === uploadingAlert.id)) fail('10. 关闭后仍在待处理')
      const closed = (await load('suppressed')).data.find((item) => item.id === uploadingAlert.id)
      if (!closed || closed.handlingState !== 'closed' || closed.conditionState !== 'firing') fail('10. 关闭后仍应可见且问题仍在发生')

      if (!uploading.fileId) fail('10. 上传中夹具缺少文件')
      await prisma.fileObject.update({
        where: { id: uploading.fileId },
        data: { status: 'active', deletedAt: null, expiresAt: null },
      })
      if ((await load('all')).data.some((item) => item.id === uploadingAlert.id)) fail('10. 文件恢复为 active 后告警必须消失')
      const beforeClearRead = await prisma.alertDisposition.findUnique({ where: { subjectKey: uploadingAlert.subjectKey } })
      if (!beforeClearRead || beforeClearRead.recoveredAt !== null) fail('10. 条件消失不得由读取写成已恢复')
      await load('all')
      const afterClearRead = await prisma.alertDisposition.findUnique({ where: { subjectKey: uploadingAlert.subjectKey } })
      if (dispositionFingerprint(afterClearRead) !== dispositionFingerprint(beforeClearRead)) {
        fail('10. 文件恢复后的 GET 不得改写处置记录')
      }
      await prisma.fileObject.update({
        where: { id: uploading.fileId },
        data: { status: 'uploading' },
      })
      const recurred = (await load('open')).data.find((item) => item.id === uploadingAlert.id)
      if (!recurred || recurred.handlingState !== 'open' || recurred.episodeToken === uploadingAlert.episodeToken) {
        fail('10. 文件再次不可用必须作为新一轮待处理，不得继承旧关闭')
      }
      const paidOrder = await prisma.order.findUnique({
        where: { id: `ord_vop_paid_${suffix}_uploading` },
        select: { payStatus: true },
      })
      const paidTask = await prisma.printTask.findUnique({
        where: { id: uploading.taskId },
        select: { status: true },
      })
      if (paidOrder?.payStatus !== 'paid' || paidTask?.status !== 'pending') fail('10. 告警读取和处置不得改写订单支付状态或任务状态')
      const otherAlert = first.data.find((item) => item.id === alertId('other'))!
      if (otherAlert.subjectKey.endsWith(uploading.taskId) || otherAlert.terminalCode === paidCode) fail('10. 另一终端的告警串到了本任务')
      pass('10. 真实库已支付文件不可用：误报/漏报、归属、消警、审计与信息最小化')
    }

    // ── 11. 缺纸 / 断电 / 未确认不走文件失效待退款 ─────────────────────────
    {
      const anomalyToken = `tok_anom_${suffix}`
      await prisma.terminal.create({
        data: { id: tAnomaly, terminalCode: `KSK-ANOM-${suffix}`, agentToken: anomalyToken, deviceFingerprint: 'fp-anom' },
      })
      anomalyTerminalReady = true
      const agent = new TerminalAgentService(prisma, new AuditService(prisma))
      const fileId = `file_vop_anom_${suffix}`
      await prisma.fileObject.create({
        data: {
          id: fileId,
          storageKey: `vop-anom-${suffix}`,
          filename: 'anom.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 64,
          sha256: 'a'.repeat(64),
          purpose: 'print',
          status: 'active',
          bucket: 'local-fs',
        },
      })
      paidFileIds.push(fileId)
      async function seedClaimed(label: string, claimExpiry: Date | null): Promise<{ taskId: string; orderId: string }> {
        const taskId = `pt_vop_anom_${suffix}_${label}`
        const orderId = `ord_vop_anom_${suffix}_${label}`
        await prisma.printTask.create({
          data: {
            id: taskId,
            terminalId: tAnomaly,
            fileId,
            fileUrl: 'https://internal/anom',
            fileMd5: 'b'.repeat(64),
            paramsJson: '{}',
            status: 'claimed',
            claimedAt: new Date(),
            claimExpiry,
          },
        })
        paidTaskIds.push(taskId)
        await prisma.order.create({
          data: {
            id: orderId,
            orderNo: `ORD-ANOM-${label}-${suffix}`.toUpperCase(),
            type: 'print',
            printTaskId: taskId,
            terminalId: tAnomaly,
            amountCents: 80,
            currency: 'CNY',
            payStatus: 'paid',
            taskStatus: 'claimed',
            paymentSource: 'offline',
            discountCents: 0,
          },
        })
        paidOrderIds.push(orderId)
        return { taskId, orderId }
      }
      const paper = await seedClaimed('paper', null)
      const unconfirmed = await seedClaimed('unconfirmed', null)
      const power = await seedClaimed('power', new Date(Date.now() - 60_000))
      await agent.patchTaskStatus(paper.taskId, { status: 'failed', errorCode: 'PAPER_EMPTY' }, `Bearer ${anomalyToken}`, tAnomaly)
      await agent.patchTaskStatus(unconfirmed.taskId, { status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED' }, `Bearer ${anomalyToken}`, tAnomaly)
      await agent.resetExpiredClaims()
      const rows = await prisma.order.findMany({
        where: { id: { in: [paper.orderId, unconfirmed.orderId, power.orderId] } },
        select: { id: true, payStatus: true, taskStatus: true, refundReason: true },
      })
      const byId = new Map(rows.map((row) => [row.id, row]))
      const paperRow = byId.get(paper.orderId)
      const unconfirmedRow = byId.get(unconfirmed.orderId)
      const powerRow = byId.get(power.orderId)
      const powerTask = await prisma.printTask.findUnique({ where: { id: power.taskId }, select: { status: true, errorCode: true } })
      const alerts = await svc.listDerivedAlerts('all', 200)
      const mixed = alerts.data.filter((item) =>
        item.type === 'paid_pending_file_unavailable' &&
        [paper.taskId, unconfirmed.taskId, power.taskId].includes(item.subjectId),
      )
      if (
        paperRow?.payStatus === 'paid' && paperRow.taskStatus === 'failed' && paperRow.refundReason == null &&
        unconfirmedRow?.payStatus === 'paid' && unconfirmedRow.taskStatus === 'failed' && unconfirmedRow.refundReason == null &&
        powerRow?.payStatus === 'paid' && powerRow.taskStatus === 'failed' && powerRow.refundReason == null &&
        powerTask?.status === 'failed' && powerTask.errorCode === 'PRINT_JOB_UNCONFIRMED' &&
        mixed.length === 0
      ) {
        pass('11. 缺纸、断电、未确认都不写成文件失效待退款，也不进文件不可用告警')
      } else {
        fail(`11. 去向串线 ${JSON.stringify({ paperRow, unconfirmedRow, powerRow, powerTask, mixed: mixed.map((item) => item.id) })}`)
      }
    }

    await verifyAiDerivedAlerts(prisma)

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
