import { formatCount, formatDateTime } from '@ai-job-print/shared'
import { useCallback, useEffect, useState } from 'react'
import { ErrorState, LoadingState, SectionCard } from '@ai-job-print/ui'
import { Page } from '../Page'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import {
  getAiUsage,
  getFairSources,
  getFileLifecycleSummary,
  getJobSources,
  type AdminAiUsage,
  type AdminFairSourceRecord,
  type AdminFileLifecycleSummary,
  type AdminJobSourceRecord,
} from '../../services/api'
import { getAuditLogs, type AuditLogRecord } from '../../services/api/audit'
import { getPrinters, getTerminals, type AdminPrinterRecord, type AdminTerminalRecord } from '../../services/api/devices'
import { adminOpsService, type AdminAlertsResult, type AdminPrintTaskPage } from '../../services/api/adminOps'
import { memberFeedbackAdminApi, type AdminFeedbackTicketItem } from '../../services/api/memberFeedbackAdmin'
import { adminPrivacyRequestsService, type AdminDataRequestPage } from '../../services/api/adminPrivacyRequests'
import { useRecruitmentHosting } from '../components/recruitment/useRecruitmentHosting'
import { aiComplaintSla } from '../member-feedback/feedbackSla'
import { recruitmentStockKpi, recruitmentStockTodo } from './recruitmentStock'
import { BlockError } from './DashboardWidgets'
import { RecentPrintTasks } from './RecentPrintTasks'
import { RecentActivity } from './RecentActivity'
import { DashboardDeviceStatus } from './DashboardDeviceStatus'
import { printerActionHint, printerIssueParts, summarizePrinters } from './printerStatusSummary'
import { formatCny } from '../ai-services/aiUsageDisplay'
import { buildAlertRows } from './dashboardRows'
import { useIncidentQueue, useReportQueue, useUnconfirmedPrintCount } from '../../components/first-order/useServiceQueues'
import { incidentTodayRows, reportTodayRows, unconfirmedTodayRows, type TodayRow as ServiceTodayRow } from './todayServiceRows'

/**
 * 工作台分区降级模型（OPS-05）：
 * 各来源各自独立成败，任一块失败只在那一块写「这类这次没读到」并提供重试，
 * 不再用 Promise.all 把整页拖进「工作台数据加载失败」。
 */
type BlockKey =
  | 'terminals'
  | 'printers'
  | 'jobSources'
  | 'fairSources'
  | 'files'
  | 'feedback'
  | 'privacy'
  | 'aiUsage'
  | 'auditLogs'
  | 'printTasks'
  | 'alerts'

const ALL_BLOCKS: BlockKey[] = [
  'terminals',
  'printers',
  'jobSources',
  'fairSources',
  'files',
  'feedback',
  'privacy',
  'aiUsage',
  'auditLogs',
  'printTasks',
  'alerts',
]

interface BlockEntry<V = unknown> {
  value: V | null
  error: string | null
  loading: boolean
}

function initialBlock<V>(loading = true): BlockEntry<V> {
  return { value: null, error: null, loading }
}

interface TodayRow extends ServiceTodayRow {
  retry?: BlockKey[]
  loading?: boolean
}

const PRIMARY_ACTION =
  'inline-flex h-14 min-h-14 shrink-0 items-center justify-center rounded-[9px] bg-primary-600 px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(16,48,43,0.18)] hover:bg-primary-700'
const SECONDARY_ACTION =
  'inline-flex min-h-11 shrink-0 items-center justify-center rounded-[9px] border border-neutral-200 bg-surface px-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50'

/**
 * 每个 key 对应一次独立请求；loadBlocks 用 Promise.allSettled 聚合结果，
 * 失败只落该 key 的 error，成功块照常渲染。
 */
const LOADERS: Record<BlockKey, () => Promise<unknown>> = {
  terminals: () => getTerminals().then((res) => res.terminals),
  printers: () => getPrinters().then((res) => res.printers),
  jobSources: () => getJobSources(),
  fairSources: () => getFairSources(),
  files: () => getFileLifecycleSummary(),
  feedback: () => memberFeedbackAdminApi.list({ category: 'ai_content' }),
  privacy: () => adminPrivacyRequestsService.list({ status: 'pending', limit: 100 }),
  aiUsage: () => getAiUsage(),
  auditLogs: () => getAuditLogs({ limit: 6, offset: 0 }).then((res) => res.items),
  printTasks: () => adminOpsService.listPrintTasks({ page: 1, pageSize: 5 }),
  alerts: () => adminOpsService.listAlerts(),
}

export default function DashboardPage() {
  const hosting = useRecruitmentHosting()
  const incidents = useIncidentQueue()
  const reports = useReportQueue()
  const unconfirmedPrints = useUnconfirmedPrintCount()
  const hostingOpen = hosting.status === 'ready' && hosting.enabled
  const [blocks, setBlocks] = useState<Partial<Record<BlockKey, BlockEntry>>>({})
  const [initialLoading, setInitialLoading] = useState(true)

  const patchBlock = useCallback(<V,>(key: BlockKey, patch: Partial<BlockEntry<V>>) => {
    setBlocks((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? initialBlock<V>()), ...patch },
    }))
  }, [])

  const loadBlocks = useCallback(
    async (keys: BlockKey[]) => {
      keys.forEach((key) => patchBlock(key, { loading: true, error: null }))
      const results = await Promise.allSettled(keys.map((key) => LOADERS[key]()))
      results.forEach((result, index) => {
        const key = keys[index]
        if (result.status === 'fulfilled') {
          patchBlock(key, { value: result.value as never, error: null, loading: false })
        } else {
          const message = result.reason instanceof Error ? result.reason.message : '加载失败'
          patchBlock(key, { value: null, error: message, loading: false })
        }
      })
    },
    [patchBlock],
  )

  const loadAll = useCallback(() => {
    void loadBlocks(ALL_BLOCKS)
  }, [loadBlocks])

  useEffect(() => {
    void loadBlocks(ALL_BLOCKS).finally(() => setInitialLoading(false))
  }, [loadBlocks])

  const today = formatDateTime(new Date(), { style: 'zh-date-weekday' })
  const subtitle = `${today} · 先处理今天要做的事。只展示已经读到的记录。`

  const entry = <K extends BlockKey>(key: K): BlockEntry =>
    blocks[key] ?? { value: null, error: null, loading: true }
  const hasValue = <K extends BlockKey,>(key: K): boolean => entry(key).value !== null && entry(key).error === null
  const anyLoading = ALL_BLOCKS.some((key) => entry(key).loading)

  const terminals = hasValue('terminals') ? (entry('terminals').value as AdminTerminalRecord[]) : null
  const printers = hasValue('printers') ? (entry('printers').value as AdminPrinterRecord[]) : null
  const jobSources = hasValue('jobSources') ? (entry('jobSources').value as AdminJobSourceRecord[]) : null
  const fairSources = hasValue('fairSources') ? (entry('fairSources').value as AdminFairSourceRecord[]) : null
  const files = hasValue('files') ? (entry('files').value as AdminFileLifecycleSummary) : null
  const feedback = hasValue('feedback') ? (entry('feedback').value as { items: AdminFeedbackTicketItem[]; total: number }) : null
  const privacy = hasValue('privacy') ? (entry('privacy').value as AdminDataRequestPage) : null
  const aiUsage = hasValue('aiUsage') ? (entry('aiUsage').value as AdminAiUsage) : null
  const auditLogs = hasValue('auditLogs') ? (entry('auditLogs').value as AuditLogRecord[]) : null
  const printTaskPage = hasValue('printTasks') ? (entry('printTasks').value as AdminPrintTaskPage) : null
  const alerts = hasValue('alerts') ? (entry('alerts').value as AdminAlertsResult) : null

  const queueUseful = [incidents.state, reports.state, unconfirmedPrints.state].some((state) => state.status === 'ready' || state.status === 'preview')
  const loadedAny = ALL_BLOCKS.some((key) => hasValue(key)) || queueUseful
  const readyPrinters = printers?.filter((printer) => printer.status === 'online').length ?? 0
  const stockKpi = recruitmentStockKpi({
    hostingOpen,
    jobs: jobSources ? jobSources.length : null,
    fairs: fairSources ? fairSources.length : null,
    printers: printers ? { ready: readyPrinters, total: printers.length } : null,
  })
  const stockTodo = jobSources && fairSources
    ? recruitmentStockTodo({ hostingOpen, jobs: jobSources.length, fairs: fairSources.length })
    : null

  const retry = (keys: BlockKey[]) => () => void loadBlocks(keys)
  const alertCount = alerts?.firingCount ?? 0
  const alertRows = alerts ? buildAlertRows(alerts.data) : []
  const paidPendingAlertCount = alerts?.data.filter((alert) => alert.type === 'paid_pending_file_unavailable').length ?? 0

  const refreshButton = (
    <button
      type="button"
      onClick={loadAll}
      disabled={anyLoading}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
    >
      <RefreshCwIcon className={'h-3.5 w-3.5' + (anyLoading ? ' animate-spin' : '')} aria-hidden="true" />
      刷新
    </button>
  )

  if (initialLoading) {
    return (
      <Page title="工作台" subtitle={subtitle}>
        <LoadingState text="正在加载工作台数据…" className="py-24" />
      </Page>
    )
  }

  if (!loadedAny) {
    return (
      <Page title="工作台" subtitle={subtitle} actions={refreshButton}>
        <ErrorState
          title="工作台数据加载失败"
          message="各来源均未返回数据，请稍后重试；已经读到的板块会正常显示。"
          onRetry={loadAll}
          className="py-24"
        />
      </Page>
    )
  }

  const todayRows: TodayRow[] = []
  const hold = (keys: BlockKey[], label: string): boolean => {
    if (keys.some((key) => entry(key).loading || (entry(key).value === null && entry(key).error === null))) {
      todayRows.push({ key: `${label}-loading`, title: label, detail: '正在读取', action: '', loading: true })
      return true
    }
    const failed = keys.filter((key) => entry(key).error !== null)
    if (failed.length > 0) {
      todayRows.push({ key: `${label}-error`, title: label, detail: '这类这次没读到', action: '重试', retry: failed })
      return true
    }
    return false
  }

  if (!hold(['alerts'], '已支付但文件不可用')) {
    const count = alerts?.data.filter((alert) => alert.type === 'paid_pending_file_unavailable').length ?? 0
    if (count > 0) {
      todayRows.push({
        key: 'paid-file',
        title: `已支付但文件不可用 ${formatCount(count)} 条`,
        detail: '需要人工处理',
        href: '/alerts',
        action: '去处理',
      })
    }
  }
  if (!hold(['feedback'], 'AI 内容投诉')) {
    const items = feedback?.items ?? []
    const overdue = items.filter((item) => {
      const sla = aiComplaintSla(item)
      return sla?.kind === 'running' && sla.urgency === 'overdue'
    }).length
    const truncated = (feedback?.total ?? 0) > items.length
    if (truncated) {
      todayRows.push({
        key: 'ai-complaint',
        title: overdue > 0 ? `最近 100 条里超期 ${formatCount(overdue)} 件` : '最近 100 条里没有超期',
        detail: '更早的请到意见反馈查看',
        href: '/member-feedback?category=ai_content',
        action: '去意见反馈查看全部',
      })
    } else if (overdue > 0) {
      todayRows.push({
        key: 'ai-complaint',
        title: `AI 内容投诉超期 ${formatCount(overdue)} 件`,
        detail: '按 5 个工作日计算',
        href: '/member-feedback?category=ai_content',
        action: '去处理',
      })
    }
  }
  todayRows.push(...incidentTodayRows(incidents.state, incidents.retry))
  if (!hold(['terminals'], '离线终端')) {
    const offline = terminals?.filter((terminal) => !terminal.online).length ?? 0
    if (offline > 0) {
      todayRows.push({
        key: 'offline-terminals',
        title: `离线终端 ${formatCount(offline)} 台`,
        detail: '按终端名单统计',
        href: '/alerts',
        action: '去处理',
      })
    }
  }
  if (!hold(['printers'], '打印机')) {
    const counts = summarizePrinters(printers ?? [])
    const parts = printerIssueParts(counts)
    if (parts.length > 0) {
      todayRows.push({
        key: 'printers',
        title: parts.join('，'),
        detail: printerActionHint(counts),
        href: '/devices',
        action: '去查看',
      })
    }
  }
  todayRows.push(...unconfirmedTodayRows(unconfirmedPrints.state, unconfirmedPrints.retry))
  if (!hold(['privacy'], '数据权利')) {
    const seen = privacy?.items.length ?? 0
    if (privacy?.nextCursor) {
      todayRows.push({
        key: 'privacy',
        title: `已看到 ${formatCount(seen)} 条待处理，后面还有`,
        detail: '待处理的数据权利申请',
        href: '/privacy-requests',
        action: '去查看全部',
      })
    } else if (seen > 0) {
      todayRows.push({
        key: 'privacy',
        title: `数据权利待处理 ${formatCount(seen)} 条`,
        detail: '待处理的数据权利申请',
        href: '/privacy-requests',
        action: '去查看',
      })
    }
  }
  if (!hold(['files'], '过期文件')) {
    const expired = files?.expiredPendingCleanup ?? 0
    if (expired > 0) {
      todayRows.push({
        key: 'expired-files',
        title: `过期文件 ${formatCount(expired)} 个`,
        detail: '按全库统计',
        href: '/files',
        action: '去查看',
      })
    }
  }
  todayRows.push(...reportTodayRows(reports.state, incidents.state, reports.retry))
  if (!hold(['jobSources', 'fairSources'], '招聘存量') && stockTodo && !stockKpi.failed) {
    todayRows.push({
      key: stockTodo.key,
      title: stockTodo.title,
      detail: stockTodo.sub,
      href: stockTodo.href,
      action: stockTodo.actionLabel,
    })
  }

  let actionSeen = 0

  return (
    <Page
      title="工作台"
      subtitle={subtitle}
      actions={
        <div className="flex items-center gap-2.5">
          {refreshButton}
          {alerts && alertCount > 0 && (
            <a
              href="/alerts"
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-primary-600 px-4 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(16,48,43,0.18)] transition-transform hover:-translate-y-px hover:bg-primary-700 active:scale-[0.97]"
            >
              <AlertTriangleIcon className="h-3.5 w-3.5" aria-hidden="true" />
              处理告警 ({formatCount(alertCount)})
            </a>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.7fr_1fr]">
          <SectionCard title="今天要处理">
            <div className="flex flex-col">
              {todayRows.map((row) => {
                const actionClass = (active: boolean) => {
                  if (!active) return SECONDARY_ACTION
                  const primary = actionSeen === 0
                  actionSeen += 1
                  return primary ? PRIMARY_ACTION : SECONDARY_ACTION
                }
                const headerClass = actionClass(row.action !== '' && Boolean(row.href || row.retry || row.onRetry))
                return (
                  <div key={row.key} className="flex items-start gap-3 border-t border-neutral-900/[0.06] py-3 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-neutral-900">{row.title}</p>
                      {row.detail && <p className="mt-1 text-xs leading-relaxed text-neutral-500">{row.detail}</p>}
                      {row.note && <p className="mt-1 text-xs leading-relaxed text-neutral-500">{row.note}</p>}
                      {row.lines?.map((line) => {
                        const lineClass = actionClass(line.action !== '')
                        return (
                          <div key={line.key} className="mt-2 flex items-center gap-3">
                            <p className="min-w-0 flex-1 text-xs leading-relaxed text-neutral-700">{line.text}</p>
                            {line.action !== '' && <a href={line.href} className={lineClass}>{line.action}</a>}
                          </div>
                        )
                      })}
                    </div>
                    {row.href && row.action !== '' && (
                      <a href={row.href} className={headerClass}>{row.action}</a>
                    )}
                    {row.retry && (
                      <button type="button" onClick={retry(row.retry)} className={headerClass}>{row.action}</button>
                    )}
                    {row.onRetry && (
                      <button type="button" onClick={row.onRetry} className={headerClass}>{row.action}</button>
                    )}
                  </div>
                )
              })}
              {todayRows.length === 0 && (
                <p className="py-8 text-center text-sm text-neutral-500">今天没有要处理的事</p>
              )}
              {alertCount > alertRows.length && (
                <p className="border-t border-neutral-900/[0.06] pt-2.5 text-[11.5px] text-neutral-500">
                  当前共 {formatCount(alertCount)} 条告警仍在发生（含已确认/静默与截断部分），以上仅列 {formatCount(alertRows.length)} 条
                  {paidPendingAlertCount > 0 ? `，本次加载的待处理告警中有 ${formatCount(paidPendingAlertCount)} 条已支付文件不可用、已优先列出` : ''}
                  ，完整清单见告警中心。
                </p>
              )}
            </div>
          </SectionCard>

          <div className="flex flex-col gap-4">
            <DashboardDeviceStatus
              terminals={terminals}
              printers={printers}
              terminalError={Boolean(entry('terminals').error)}
              printerError={Boolean(entry('printers').error)}
              terminalLoading={entry('terminals').loading && terminals === null}
              printerLoading={entry('printers').loading && printers === null}
              onRetryTerminals={retry(['terminals'])}
              onRetryPrinters={retry(['printers'])}
            />
            <SectionCard title="AI 近 24 小时">
              {entry('aiUsage').loading && aiUsage === null ? (
                <p className="py-6 text-center text-sm text-neutral-500">正在读取</p>
              ) : aiUsage === null ? (
                <BlockError message="这类这次没读到" onRetry={retry(['aiUsage'])} />
              ) : aiUsage.totalCalls === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-500">近 24 小时暂无调用</p>
              ) : (
                <div className="flex flex-col gap-2 text-sm text-neutral-800">
                  <p>调用 {formatCount(aiUsage.totalCalls)} 次{aiUsage.totalCalls >= 10_000 ? '（只统计最近 1 万次）' : ''}</p>
                  <p>近 24 小时 · 成功率 {aiUsage.successRate}%</p>
                  <p>成功 {formatCount(aiUsage.successCount)} / 失败 {formatCount(aiUsage.failCount)}</p>
                  <p>{aiUsage.unmeasuredCalls === aiUsage.totalCalls
                    ? `这 ${formatCount(aiUsage.totalCalls)} 次调用都没有费用数据`
                    : aiUsage.unmeasuredCalls > 0
                      ? `已计量部分约 ${formatCny(aiUsage.estimatedCostCny)}；另有 ${formatCount(aiUsage.unmeasuredCalls)} 次没有费用数据，实际花费会更高`
                      : `估算费用约 ${formatCny(aiUsage.estimatedCostCny)}`}</p>
                </div>
              )}
            </SectionCard>
            <RecentActivity
              logs={auditLogs ?? []}
              loading={entry('auditLogs').loading}
              error={Boolean(entry('auditLogs').error)}
              onRetry={retry(['auditLogs'])}
            />
          </div>
        </div>
        <RecentPrintTasks
          tasks={printTaskPage?.data ?? []}
          total={printTaskPage?.pagination.total ?? 0}
          loading={entry('printTasks').loading}
          error={Boolean(entry('printTasks').error)}
          onRetry={retry(['printTasks'])}
        />
      </div>
    </Page>
  )
}
