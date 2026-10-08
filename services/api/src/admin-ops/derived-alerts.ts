import { formatBeijingMinute } from '../common/beijing-display-time'
import { describePrinterFault } from '../terminals/admin-printer-status'
import type { PrismaService } from '../prisma/prisma.service'
import { HEALTHY_PRINTER_STATUS_VALUES, isHealthyPrinterStatus, isLowPaperWarning } from '../terminals/printer-status'
import { TERMINAL_ONLINE_WINDOW_MS } from '../terminals/printer-availability'
import { collectPrintQuotaAlerts, resolvePrintQuotaAlert } from './derived-print-quota-alerts'
import {
  buildSubjectKey,
  offlineEpisodeToken,
  paidPendingFileUnavailableEpisodeToken,
  feedbackPendingEpisodeToken,
  printerIssueEpisodeToken,
  printFailedEpisodeToken,
  type DerivedAlertType,
} from './derived-alert-identity'

/** 与终端心跳五分钟窗口同口径。 */
export const ONLINE_WINDOW_MS = TERMINAL_ONLINE_WINDOW_MS
/** 打印失败告警回看窗口。 */
export const FAILED_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * print_failed 单次列表的物化上限。
 *
 * 为什么还留上限:24 小时内的失败任务数没有天然边界(批量打印事故会几百上千条),
 * 而告警中心是被反复轮询的读端点,无上限 findMany 等于把内存和响应体大小交给故障
 * 规模决定。
 *
 * 为什么上限不再等于「事实」:
 *   1. firingCount 走同一 where 的 count(),是精确总数,不受本上限影响;
 *   2. 超出部分通过 omitted 如实告知界面,不让操作员以为列表就是全部(CLAUDE.md §9);
 *   3. 能否处置某一条与本上限无关——处置走 resolveDerivedAlert() 的单条正向查证,
 *      不再扫列表,所以第 501 条同样可以被确认 / 静默 / 关闭。
 */
export const PRINT_FAILED_LIST_CAP = 500

/**
 * 心跳 printerStatus → 告警标题。取值来源：Terminal Agent 上报 ready|offline|error|low_paper|unknown
 * （apps/terminal-agent/src/agent/wmi.ts mapWin32PrinterQuery），外加历史心跳里的 paper_empty / not_found，
 * 以及队列闸门的 queue_cleanup_failed / queue_pause_failed。告警按最近心跳实时派生，恢复后不再出现。
 * ready / idle / ok 由 isHealthyPrinterStatus 判为健康，根本不会走到这里。
 *
 * - low_paper：WMI DetectedErrorState 3（纸少）或 5（墨粉少）都映射到它 —— Agent 分不开，
 *   标题如实写「纸张或墨粉不足」。还能打印（一体机照常接单），所以只是 warning。
 * - unknown：Agent 读不到打印机状态（WMI 查询失败或无法判定）。一体机对 unknown 一律显示
 *   「状态未知」、不当作可打印（apps/kiosk/src/hooks/useTerminalDeviceStatus.ts），用户实际打不了，
 *   所以仍然出告警、仍是 error，只是标题说人话，不再显示「打印机状态异常(unknown)」。
 * 未登记的新取值仍走兜底标题，保证新的故障态不会被静默吞掉。
 */
const PRINTER_STATUS_LABELS: Record<string, string> = {
  offline: '打印机离线',
  paper_empty: '打印机缺纸',
  low_paper: '打印机纸张或墨粉不足',
  error: '打印机故障',
  not_found: '打印机未找到',
  unknown: '打印机状态读取不到',
  queue_cleanup_failed: '开机清理失败，暂停接打印单',
  queue_pause_failed: '暂停队列失败，暂停接打印单',
}

/** 只是提醒、还能出纸的打印机状态；其余非健康状态按 error。 */
const PRINTER_WARNING_STATUSES = new Set(['paper_empty', 'low_paper'])

/**
 * 告警文案里的时间一律按北京时间写（与后台页面 formatDateTime 同一时区）。
 * 只影响给人看的 detail 文案；occurredAt、episodeToken、去重键仍用 UTC 时刻，不受影响。
 */
export function formatShanghaiMinute(date: Date): string {
  return formatBeijingMinute(date)
}

/**
 * 「多久以前」给人看：不满 1 小时写分钟，不满 1 天写小时加分钟，1 天以上写天加小时。
 * 终端离线几天时以前会写成「5211 分钟前」，值班人员还得自己换算。
 */
export function formatElapsedAgo(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分钟前` : `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days} 天 ${hours % 24} 小时前` : `${days} 天前`
}

/** 打印失败告警正文。时刻只出现在这句话里，occurredAt 仍是 UTC。 */
export function printFailedAlertDetail(task: {
  id: string
  terminalCode: string | null
  updatedAt: Date
  errorCode?: string | null
}): string {
  const terminal = task.terminalCode ? ` · 终端 ${task.terminalCode}` : ''
  const code = task.errorCode ? ` · 错误码 ${task.errorCode}` : ''
  return `任务 ${task.id}${terminal},失败于 ${formatShanghaiMinute(task.updatedAt)}${code}`
}

export interface DerivedAlert {
  id: string
  subjectKey: string
  subjectId: string
  episodeToken: string
  type: DerivedAlertType
  severity: 'error' | 'warning'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
}

export interface DerivedAlertCollection {
  /** 本次实际物化出来的告警。 */
  alerts: DerivedAlert[]
  /** 当前满足条件的告警总数(精确计数,不受列表上限影响)。 */
  firingTotal: number
  /** 因列表上限未被物化的条数;0 表示 alerts 就是全部。 */
  omitted: number
  /** 触发截断的上限值,便于界面如实说明。 */
  cap: number
  /**
   * 本次纳入终端类告警考察的主题键(只含正常运营的终端,每台两种类型)。推送据此区分
   * 「真恢复」与「因转为计划中 / 退役 / 停用 / 删除而不再考察」:后者不推「已恢复」。
   */
  terminalSubjectKeysInScope: string[]
}

type TerminalRow = {
  id: string
  terminalCode: string
  registeredAt: Date
  heartbeats: Array<{ createdAt: Date; printerStatus: string | null }>
}

type FailedTaskRow = {
  id: string
  errorCode: string | null
  updatedAt: Date
  terminal: { terminalCode: string } | null
  order: { payStatus: string } | null
}

type PaidPendingFileUnavailableTaskRow = {
  id: string
  fileId: string | null
  updatedAt: Date
  terminal: { terminalCode: string } | null
  order: { payStatus: string } | null
  file: {
    status: string
    deletedAt: Date | null
    expiresAt: Date | null
    updatedAt: Date
  } | null
}

type PendingFeedbackSummary = { count: number; earliest: Date | null; latest: Date | null }

/**
 * C3：待处理的 AI 内容投诉（新提交或处理中；以及旧数据里被标成「已回复」却没有任何管理员回复记录的）。
 * 只取条数与提交时间，不取正文与手机号。
 */
const PENDING_AI_CONTENT_FEEDBACK = {
  category: 'ai_content',
  OR: [
    { status: { in: ['pending', 'processing'] } },
    { status: 'replied', replies: { none: { senderType: 'admin' } } },
  ],
}

/** 计数 + 最早、最新各一条：不全表拉取，积压或被刷单时也不拖垮整张告警列表。 */
async function pendingAiContentFeedback(prisma: PrismaService): Promise<PendingFeedbackSummary> {
  const [count, oldest, newest] = await Promise.all([
    prisma.feedbackTicket.count({ where: PENDING_AI_CONTENT_FEEDBACK }),
    prisma.feedbackTicket.findFirst({ where: PENDING_AI_CONTENT_FEEDBACK, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.feedbackTicket.findFirst({ where: PENDING_AI_CONTENT_FEEDBACK, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ])
  return { count, earliest: oldest?.createdAt ?? null, latest: newest?.createdAt ?? null }
}

const TERMINAL_SELECT = {
  id: true,
  terminalCode: true,
  registeredAt: true,
  heartbeats: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true, printerStatus: true },
  },
} as const

const FAILED_TASK_SELECT = {
  id: true,
  errorCode: true,
  updatedAt: true,
  terminal: { select: { terminalCode: true } },
  order: { select: { payStatus: true } },
} as const

const PAID_PENDING_FILE_UNAVAILABLE_SELECT = {
  id: true,
  fileId: true,
  updatedAt: true,
  terminal: { select: { terminalCode: true } },
  order: { select: { payStatus: true } },
  file: { select: { status: true, deletedAt: true, expiresAt: true, updatedAt: true } },
} as const

/**
 * 打印失败告警的判定条件。列表 / 计数 / 单条查证共用同一份,
 * 避免「列表里没有」和「其实还在 firing」因为条件漂移而不一致。
 *
 * 退款排除:RefundService 完成路径只写 Order.payStatus='refunded',
 * 明确不改 PrintTask / printOutcome。这里按订单退款态过滤,禁止伪造出纸结果。
 */
function failedTaskWhere(nowMs: number) {
  return {
    status: 'failed',
    updatedAt: { gte: new Date(nowMs - FAILED_LOOKBACK_MS) },
    // SQL 的 NOT IN 不匹配 NULL,必须显式收未核查任务,否则普通失败告警会全灭。
    AND: [
      {
        OR: [
          { printOutcome: null },
          { printOutcome: { notIn: ['printed', 'not_printed'] } },
        ],
      },
      // 已退款订单不再报警。退款路径写的是 Order.payStatus,不是 printOutcome。
      { NOT: { order: { payStatus: 'refunded' } } },
    ],
  }
}

/**
 * 仅关注现代任务(fileId 非空)的已支付待处理单。历史 fileId=null 任务仍由兼容 claim 路径处理，
 * 不能因为缺少新血缘字段就误报；有 fileId 但关联被 SetNull 清理的任务则必须可见。
 */
function paidPendingFileUnavailableWhere(now: Date) {
  return {
    status: 'pending',
    order: { payStatus: 'paid' },
    fileId: { not: null },
    OR: [
      { file: null },
      {
        file: {
          OR: [
            { status: { not: 'active' } },
            { deletedAt: { not: null } },
            { expiresAt: { lte: now } },
          ],
        },
      },
    ],
  }
}

/** 终端类告警(离线 / 打印机异常)的唯一判定入口。 */
function buildTerminalAlert(
  terminal: TerminalRow,
  lastHealthyAt: Date | null,
  nowMs: number,
): DerivedAlert | null {
  const lastHeartbeat = terminal.heartbeats[0]
  const lastSeen = lastHeartbeat?.createdAt ?? terminal.registeredAt
  const offlineMs = nowMs - lastSeen.getTime()

  if (offlineMs >= ONLINE_WINDOW_MS) {
    const subjectKey = buildSubjectKey('terminal_offline', terminal.id)
    return {
      id: subjectKey,
      subjectKey,
      subjectId: terminal.id,
      episodeToken: offlineEpisodeToken(lastSeen),
      type: 'terminal_offline',
      severity: offlineMs >= 30 * 60 * 1000 ? 'error' : 'warning',
      title: `终端 ${terminal.terminalCode} 离线`,
      detail: `最近一次心跳在 ${formatElapsedAgo(offlineMs)}(${formatShanghaiMinute(lastSeen)})`,
      terminalCode: terminal.terminalCode,
      occurredAt: lastSeen.toISOString(),
    }
  }

  if (lastHeartbeat?.printerStatus && !isHealthyPrinterStatus(lastHeartbeat.printerStatus)) {
    const lowPaper = isLowPaperWarning(lastHeartbeat.printerStatus)
    const label = lowPaper
      ? '纸张或墨粉不足，可打印、需补充'
      : (PRINTER_STATUS_LABELS[lastHeartbeat.printerStatus] ?? `打印机状态异常(${lastHeartbeat.printerStatus})`)
    const subjectKey = buildSubjectKey('printer_issue', terminal.id)
    const healthyAt = lastHealthyAt ?? terminal.registeredAt
    return {
      id: subjectKey,
      subjectKey,
      subjectId: terminal.id,
      episodeToken: printerIssueEpisodeToken(lastHeartbeat.printerStatus, healthyAt),
      type: 'printer_issue',
      severity: PRINTER_WARNING_STATUSES.has(lastHeartbeat.printerStatus) ? 'warning' : 'error',
      title: `终端 ${terminal.terminalCode} ${label}`,
      detail: lowPaper
        ? '终端在线，打印机报纸张或墨粉不足（本机分不清是哪一样），仍可打印，请检查并补充。'
        : `终端在线，${describePrinterFault(true, lastHeartbeat.printerStatus)}`,
      terminalCode: terminal.terminalCode,
      occurredAt: lastHeartbeat.createdAt.toISOString(),
    }
  }

  return null
}

/**
 * 打印失败错误码 → 后台告警标题用的中文原因。标题只放中文，错误码放进明细，
 * 方便排障时照码检索；未登记的错误码标题只写「打印任务失败」。
 */
const PRINT_FAILED_ALERT_REASONS: Record<string, string> = {
  DOWNLOAD_HASH_MISMATCH: '文件校验未通过',
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_OFFLINE: '打印机离线',
  PAPER_EMPTY: '缺纸',
  PRINTER_ERROR: '打印机故障或卡纸',
  PRINT_JOB_UNCONFIRMED: '出纸未确认',
  PARTIAL_OUTPUT: '只打出了一部分',
  PRINT_TIMEOUT: '打印超时',
  PRINT_COMMAND_FAILED: '打印命令执行失败',
  UNSUPPORTED_FILE_TYPE: '文件格式不支持',
  FILE_NOT_FOUND: '打印文件已失效',
}

function printFailedAlertTitle(errorCode: string | null): string {
  const reason = errorCode && Object.prototype.hasOwnProperty.call(PRINT_FAILED_ALERT_REASONS, errorCode)
    ? PRINT_FAILED_ALERT_REASONS[errorCode]
    : null
  return reason ? `打印任务失败：${reason}` : '打印任务失败'
}

/** 打印失败告警的唯一构造入口。 */
function buildPrintFailedAlert(task: FailedTaskRow): DerivedAlert {
  const subjectKey = buildSubjectKey('print_failed', task.id)
  return {
    id: subjectKey,
    subjectKey,
    subjectId: task.id,
    episodeToken: printFailedEpisodeToken(task.id),
    type: 'print_failed',
    severity: 'warning',
    title: printFailedAlertTitle(task.errorCode),
    detail: printFailedAlertDetail({
      id: task.id,
      terminalCode: task.terminal?.terminalCode ?? null,
      updatedAt: task.updatedAt,
      errorCode: task.errorCode,
    }),
    terminalCode: task.terminal?.terminalCode ?? null,
    occurredAt: task.updatedAt.toISOString(),
  }
}

function fileUnavailableReason(task: PaidPendingFileUnavailableTaskRow, nowMs: number): string | null {
  if (task.fileId === null) return null
  if (!task.file) return '关联文件记录缺失'
  if (task.file.deletedAt) return '文件已删除'
  if (task.file.expiresAt && task.file.expiresAt.getTime() <= nowMs) return '文件已过期'
  if (task.file.status === 'uploading') return '文件仍在上传'
  if (task.file.status === 'quarantined') return '文件处于隔离状态'
  if (task.file.status !== 'active') return '文件不可用'
  return null
}

/** 已支付待处理任务的文件不可用告警；不触碰退款或订单状态机。 */
function buildPaidPendingFileUnavailableAlert(
  task: PaidPendingFileUnavailableTaskRow,
  nowMs: number,
): DerivedAlert | null {
  const reason = fileUnavailableReason(task, nowMs)
  if (!reason || task.order?.payStatus !== 'paid' || task.fileId === null) return null

  const observedAt = task.file?.updatedAt ?? task.updatedAt
  const subjectKey = buildSubjectKey('paid_pending_file_unavailable', task.id)
  return {
    id: subjectKey,
    subjectKey,
    subjectId: task.id,
    episodeToken: paidPendingFileUnavailableEpisodeToken({
      status: task.file?.status ?? null,
      deletedAt: task.file?.deletedAt ?? null,
      expiresAt: task.file?.expiresAt ?? null,
      observedAt,
    }),
    type: 'paid_pending_file_unavailable',
    severity: 'error',
    title: '已支付打印任务的文件不可用',
    detail: `任务 ${task.id}${task.terminal?.terminalCode ? ` · 终端 ${task.terminal.terminalCode}` : ''}：${reason}`,
    terminalCode: task.terminal?.terminalCode ?? null,
    occurredAt: observedAt.toISOString(),
  }
}

function buildPendingFeedbackAlert(summary: PendingFeedbackSummary): DerivedAlert | null {
  if (!summary.earliest || !summary.latest || summary.count <= 0) return null
  const subjectId = 'ai-content'
  const subjectKey = buildSubjectKey('feedback_pending', subjectId)
  return {
    id: subjectKey,
    subjectKey,
    subjectId,
    episodeToken: feedbackPendingEpisodeToken(summary.latest),
    type: 'feedback_pending',
    severity: 'warning',
    title: '有待处理的 AI 内容投诉',
    detail: `共 ${summary.count} 条，最早提交于 ${formatShanghaiMinute(summary.earliest)}`,
    terminalCode: null,
    occurredAt: summary.earliest.toISOString(),
  }
}

/** 最近一次健康心跳时间;用于 printer_issue 的 episodeToken。 */
async function lastHealthyHeartbeatAt(prisma: PrismaService, terminalId: string): Promise<Date | null> {
  const row = await prisma.terminalHeartbeat.findFirst({
    where: { terminalId, printerStatus: { in: [...HEALTHY_PRINTER_STATUS_VALUES] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return row?.createdAt ?? null
}

/**
 * 只根据实时数据算出当前仍在发生的告警。不读处理表,也不写任何东西。
 *
 * 返回值同时给出精确总数与截断条数:调用方可以列出一部分,但必须如实说有多少条。
 */
export async function collectDerivedAlerts(
  prisma: PrismaService,
  now: Date,
): Promise<DerivedAlertCollection> {
  const nowMs = now.getTime()
  const alerts: DerivedAlert[] = []

  // 终端类告警只看正常运营的终端(与 pickup-order.service.ts 的放行口径一致):
  // 计划中、调试中、维护中、已暂停、已退役、停用的机器没人用,不算「离线」或「打印机异常」。
  // 10/4 线上第一轮推送就把一台从没开过机的计划中终端 new01 报成了离线。
  const terminals = (await prisma.terminal.findMany({
    where: { enabled: true, lifecycleStatus: 'active' },
    select: TERMINAL_SELECT,
  })) as unknown as TerminalRow[]

  const printerIssueIds: string[] = []
  for (const t of terminals) {
    const lastHeartbeat = t.heartbeats[0]
    const lastSeen = lastHeartbeat?.createdAt ?? t.registeredAt
    const offlineMs = nowMs - lastSeen.getTime()
    if (offlineMs < ONLINE_WINDOW_MS && lastHeartbeat?.printerStatus && !isHealthyPrinterStatus(lastHeartbeat.printerStatus)) {
      printerIssueIds.push(t.id)
    }
  }

  const lastHealthyAt = new Map<string, Date>()
  if (printerIssueIds.length > 0) {
    const grouped = await prisma.terminalHeartbeat.groupBy({
      by: ['terminalId'],
      where: {
        terminalId: { in: printerIssueIds },
        printerStatus: { in: [...HEALTHY_PRINTER_STATUS_VALUES] },
      },
      _max: { createdAt: true },
    })
    for (const row of grouped) {
      if (row._max.createdAt) lastHealthyAt.set(row.terminalId, row._max.createdAt)
    }
  }

  for (const t of terminals) {
    const alert = buildTerminalAlert(t, lastHealthyAt.get(t.id) ?? null, nowMs)
    if (alert) alerts.push(alert)
  }
  // 终端类告警一台终端最多一条,总数就是列表长度,不存在截断。
  const terminalAlertCount = alerts.length

  const where = failedTaskWhere(nowMs)
  const [failedTasks, failedTotal] = await Promise.all([
    prisma.printTask.findMany({
      where,
      select: FAILED_TASK_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: PRINT_FAILED_LIST_CAP,
    }) as unknown as Promise<FailedTaskRow[]>,
    prisma.printTask.count({ where }),
  ])
  for (const task of failedTasks) {
    if (task.order?.payStatus === 'refunded') continue
    alerts.push(buildPrintFailedAlert(task))
  }

  // 这类告警不设置物化上限：每一条已支付但无法履约的任务都必须对运营人员可见。
  // 失败任务仍沿用既有 500 条上限，omitted/truncation 继续只描述 print_failed。
  const unavailableTasks = (await prisma.printTask.findMany({
    where: paidPendingFileUnavailableWhere(now),
    select: PAID_PENDING_FILE_UNAVAILABLE_SELECT,
    orderBy: { updatedAt: 'asc' },
  })) as unknown as PaidPendingFileUnavailableTaskRow[]
  for (const task of unavailableTasks) {
    const alert = buildPaidPendingFileUnavailableAlert(task, nowMs)
    if (alert) alerts.push(alert)
  }

  const feedbackAlert = buildPendingFeedbackAlert(await pendingAiContentFeedback(prisma))
  if (feedbackAlert) alerts.push(feedbackAlert)

  alerts.push(...await collectPrintQuotaAlerts(prisma, now))

  alerts.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
  // count() 与 findMany 之间可能有新失败写入,omitted 用 max(0,…) 兜底,不出现负数。
  const omitted = Math.max(0, failedTotal - failedTasks.length)
  return {
    alerts,
    firingTotal: terminalAlertCount + Math.max(failedTotal, failedTasks.length) + unavailableTasks.reduce((count, task) => (
      count + (buildPaidPendingFileUnavailableAlert(task, nowMs) ? 1 : 0)
    ), 0) + (feedbackAlert ? 1 : 0) + alerts.filter((alert) => alert.type === 'print_terminal_quota_high').length,
    omitted,
    cap: PRINT_FAILED_LIST_CAP,
    terminalSubjectKeysInScope: terminals.flatMap((t) => [
      buildSubjectKey('terminal_offline', t.id),
      buildSubjectKey('printer_issue', t.id),
    ]),
  }
}

/**
 * 单条正向查证:直接问「这一个主体现在还满足告警条件吗」。
 *
 * 处置端点用它而不是扫 collectDerivedAlerts 的列表,原因有二:
 *   1. 列表有物化上限,用列表判定会让被截断的告警变成「不存在」,操作员既看不到
 *      也处置不了;
 *   2. 这是正向查证——回 null 表示我们确实查过这个主体并且条件不成立,
 *      而不是「这次列表里没看见」。缺席不能当证据。
 */
export async function resolveDerivedAlert(
  prisma: PrismaService,
  type: DerivedAlertType,
  subjectId: string,
  now: Date,
): Promise<DerivedAlert | null> {
  const nowMs = now.getTime()

  if (type === 'print_failed') {
    const task = (await prisma.printTask.findFirst({
      where: { id: subjectId, ...failedTaskWhere(nowMs) },
      select: FAILED_TASK_SELECT,
    })) as unknown as FailedTaskRow | null
    if (!task || task.order?.payStatus === 'refunded') return null
    return buildPrintFailedAlert(task)
  }

  if (type === 'paid_pending_file_unavailable') {
    const task = (await prisma.printTask.findFirst({
      where: { id: subjectId, ...paidPendingFileUnavailableWhere(now) },
      select: PAID_PENDING_FILE_UNAVAILABLE_SELECT,
    })) as unknown as PaidPendingFileUnavailableTaskRow | null
    return task ? buildPaidPendingFileUnavailableAlert(task, nowMs) : null
  }

  if (type === 'feedback_pending') {
    return buildPendingFeedbackAlert(await pendingAiContentFeedback(prisma))
  }

  if (type === 'print_terminal_quota_high') {
    return resolvePrintQuotaAlert(prisma, subjectId, now)
  }

  const terminal = (await prisma.terminal.findUnique({
    where: { id: subjectId },
    select: TERMINAL_SELECT,
  })) as unknown as TerminalRow | null
  if (!terminal) return null

  const needsHealthy = type === 'printer_issue'
  const alert = buildTerminalAlert(
    terminal,
    needsHealthy ? await lastHealthyHeartbeatAt(prisma, terminal.id) : null,
    nowMs,
  )
  // 同一台终端只会命中离线或打印机异常之一;类型对不上说明这一类当前没有在发生。
  return alert && alert.type === type ? alert : null
}
