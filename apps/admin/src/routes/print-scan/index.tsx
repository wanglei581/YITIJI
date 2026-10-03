// Admin 打印扫描运维中心（Task 10）。
//
// 三个板块：
//   任务中心   — print/scan/document_process 真实聚合；photo/copy/材料包/格式转换/
//               签章无数据模型，如实显示"未上线"，不伪造行数据。
//   设备能力   — 终端 × 能力键开关（fail-closed：仅 available 对普通用户开放），
//               终端 Agent 版本/降级/打印机状态为心跳真实值。实现在 ./CapabilityCenter.tsx。
//   商业化控制 — 定价/权益复用既有 billing、benefit 页面入口；补贴标签与退款
//               异常工作流当前未建设，如实标注。

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDateTime } from '@ai-job-print/shared'
import { ConsoleTable, Drawer, EmptyState, LoadingState, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { printErrorText } from '../../lib/printErrorText'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import { PrinterIcon, RefreshCwIcon, SlidersHorizontalIcon, WalletIcon } from 'lucide-react'
import { CapabilityCenter } from './CapabilityCenter'
import { CloseUnpaidPrintTaskForm } from './CloseUnpaidPrintTaskForm'
import { PrintRetryButton } from './PrintRetryButton'
import {
  adminPrintScanService,
  type AdminPrintScanTaskDetail,
  type AdminPrintScanTaskItem,
  type AdminPrintScanTaskPage,
  type PrintScanTaskType,
} from '../../services/api/printScan'

// ─── 展示映射 ─────────────────────────────────────────────────────────────────

const TASK_TYPE_TABS: { value: PrintScanTaskType; label: string; implemented: boolean }[] = [
  { value: 'print', label: '打印', implemented: true },
  { value: 'scan', label: '扫描', implemented: true },
  { value: 'document_process', label: '文档处理', implemented: true },
  { value: 'photo', label: '证件照', implemented: false },
  { value: 'copy', label: '复印', implemented: false },
  { value: 'material_pack', label: '材料包', implemented: false },
  { value: 'format_conversion', label: '格式转换', implemented: false },
  { value: 'signature_stamp', label: '签名', implemented: false },
]

const TASK_STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending: { badge: 'warning', label: '待领取' },
  claimed: { badge: 'info', label: '已领取' },
  printing: { badge: 'info', label: '打印中' },
  processing: { badge: 'info', label: '处理中' },
  waiting: { badge: 'warning', label: '等待扫描' },
  matched: { badge: 'info', label: '已匹配' },
  completed: { badge: 'success', label: '已完成' },
  failed: { badge: 'error', label: '失败' },
  expired: { badge: 'default', label: '已过期' },
  cancelled: { badge: 'default', label: '已取消' },
  abandoned: { badge: 'default', label: '已废弃' },
}

const STATUS_FILTERS: Record<'print' | 'scan' | 'document_process', { label: string; value: string }[]> = {
  print: [
    { label: '全部', value: '' },
    { label: '待领取', value: 'pending' },
    { label: '已领取', value: 'claimed' },
    { label: '打印中', value: 'printing' },
    { label: '已完成', value: 'completed' },
    { label: '失败', value: 'failed' },
    { label: '已取消', value: 'cancelled' },
    { label: '已废弃', value: 'abandoned' },
  ],
  scan: [
    { label: '全部', value: '' },
    { label: '等待扫描', value: 'waiting' },
    { label: '已匹配', value: 'matched' },
    { label: '已完成', value: 'completed' },
    { label: '已过期', value: 'expired' },
    { label: '已取消', value: 'cancelled' },
    { label: '失败', value: 'failed' },
  ],
  document_process: [
    { label: '全部', value: '' },
    { label: '待处理', value: 'pending' },
    { label: '处理中', value: 'processing' },
    { label: '已完成', value: 'completed' },
    { label: '失败', value: 'failed' },
    { label: '已取消', value: 'cancelled' },
  ],
}

const CLOSE_UNPAID_BLOCK_REASON_LABELS: Record<NonNullable<Extract<AdminPrintScanTaskDetail, { type: 'print' }>['closeUnpaidBlockReason']>, string> = {
  no_associated_order: '未找到关联订单',
  task_not_pending: '任务不再处于待处理状态',
  task_claimed: '任务已被终端领取或正在处理',
  order_not_unpaid: '关联订单已不是未支付状态',
  order_task_not_pending: '关联订单任务状态已变化',
  payment_attempt_exists: '订单已存在支付尝试，请先完成对账或退款处理',
}

const OWNER_LABELS: Record<string, string> = { member: '会员', anonymous: '游客' }

function fmt(iso: string | null): string {
  return formatDateTime(iso)
}

function taskSummary(item: AdminPrintScanTaskItem): string {
  if (item.type === 'print') return item.fileName ?? '（无文件名）'
  if (item.type === 'scan') return `扫描类型：${item.scanType}${item.hasResultFile ? ' · 已产出文件' : ''}`
  return `处理类型：${item.kind}${item.hasResultFile ? ' · 已产出文件' : ''}`
}

interface RetryColumn {
  /** 正在重试的任务编号（忙碌时同一行按钮显示处理中）。 */
  busyTaskId: string | null
  onRetry: (item: AdminPrintScanTaskItem) => void
}

function taskColumns(openDetail: (item: AdminPrintScanTaskItem) => Promise<void>, retry: RetryColumn | null): ConsoleColumn<AdminPrintScanTaskItem>[] {
  const columns: ConsoleColumn<AdminPrintScanTaskItem>[] = [
    { id: 'task', header: '任务', headerClassName: 'w-[24%]', truncate: true, title: taskSummary,
      cell: (item) => <button type="button" title={`任务编号：${item.taskId}\n${taskSummary(item)}`}
        aria-label={`查看打印任务 ${item.taskId}`} onClick={() => void openDetail(item)}
        className="block w-full max-w-64 truncate text-left font-semibold text-primary-700 hover:underline">{taskSummary(item)}</button> },
    { id: 'terminal', header: '终端', headerClassName: 'w-[10%]', cellClassName: 'whitespace-nowrap', cell: (item) => item.terminalCode ?? '—' },
    { id: 'owner', header: '归属', headerClassName: 'w-[6%]', cellClassName: 'whitespace-nowrap', cell: (item) => OWNER_LABELS[item.ownerType] },
    { id: 'status', header: '状态', headerClassName: 'w-[10%]', cellClassName: 'whitespace-nowrap', cell: (item) => {
      const meta = TASK_STATUS_MAP[item.status] ?? { badge: 'default' as const, label: '未归类' }
      return <StatusBadge status={meta.badge} label={meta.label} />
    } },
    { id: 'error', header: '失败原因', headerClassName: 'w-[14%]', truncate: true,
      title: (item) => item.errorCode ? `${printErrorText(item.errorCode, item.type)}（${item.errorCode}）` : undefined,
      cell: (item) => printErrorText(item.errorCode, item.type) },
    { id: 'created', header: '创建时间', headerClassName: 'w-[18%]', cellClassName: 'whitespace-nowrap tabular-nums', cell: (item) => fmt(item.createdAt) },
    { id: 'expires', header: '过期时间', headerClassName: 'w-[18%]', cellClassName: 'whitespace-nowrap tabular-nums', cell: (item) => fmt(item.expiresAt) },
  ]
  if (!retry) return columns
  // 打印任务列表的「重试」列：能不能点由服务端 retryBlockedReason 事先决定（W-86），不能点时写明原因。
  return [...columns, {
    id: 'retry', header: '重试', headerClassName: 'w-[12%]', sticky: true,
    cell: (item) => item.type === 'print' ? (
      <PrintRetryButton
        retryBlockedReason={item.retryBlockedReason}
        legacyVisible={false}
        busy={retry.busyTaskId === item.taskId}
        onRetry={() => retry.onRetry(item)}
        label="重试"
        layout="list"
      />
    ) : null,
  }]
}

// ─── 页面 ─────────────────────────────────────────────────────────────────────

type Section = 'tasks' | 'capabilities' | 'commercial'

export default function PrintScanOpsPage() {
  const [section, setSection] = useState<Section>('tasks')

  return (
    <Page
      title="打印扫描运维"
      subtitle="统一任务中心 · 终端能力开关 · 商业化控制入口"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip active={section === 'tasks'} label="任务中心" onClick={() => setSection('tasks')} />
        <FilterChip active={section === 'capabilities'} label="设备能力" onClick={() => setSection('capabilities')} />
        <FilterChip active={section === 'commercial'} label="商业化控制" onClick={() => setSection('commercial')} />
      </div>
      {section === 'tasks' && <TaskCenter />}
      {section === 'capabilities' && <CapabilityCenter />}
      {section === 'commercial' && <CommercialControls />}
    </Page>
  )
}

// ─── 任务中心 ─────────────────────────────────────────────────────────────────

function TaskCenter() {
  const [taskType, setTaskType] = useState<PrintScanTaskType>('print')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [data, setData] = useState<AdminPrintScanTaskPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminPrintScanTaskDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionTaskId, setActionTaskId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionErrorScope, setActionErrorScope] = useState<'list' | 'detail'>('detail')

  const implemented = TASK_TYPE_TABS.find((t) => t.value === taskType)?.implemented ?? false

  // 请求序号防竞态：快速切换类型/筛选时，旧的慢响应不得覆盖新状态。
  const queryKey = [taskType, status, String(page), String(pageSize)].join('\u0000')
  const queryKeyRef = useRef(queryKey)
  queryKeyRef.current = queryKey
  const loadSeq = useRef(0)
  const load = useCallback(async (): Promise<'success' | 'failed' | 'stale'> => {
    const requestQueryKey = queryKey
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const result = await adminPrintScanService.listTasks({ type: taskType, status: status || undefined, page, pageSize })
      if (seq !== loadSeq.current || queryKeyRef.current !== requestQueryKey) return 'stale'
      setData(result)
      return 'success'
    } catch (e) {
      if (seq !== loadSeq.current || queryKeyRef.current !== requestQueryKey) return 'stale'
      setError(e instanceof Error ? e.message : '加载失败')
      return 'failed'
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [taskType, status, page, pageSize, queryKey])

  useEffect(() => {
    void load()
  }, [load])

  const detailSeq = useRef(0)
  const openDetail = async (item: AdminPrintScanTaskItem) => {
    const seq = ++detailSeq.current
    setDetailOpen(true)
    setDetail(null)
    setActionError(null)
    setActionErrorScope('detail')
    try {
      const result = await adminPrintScanService.getTaskDetail(item.type, item.taskId)
      if (seq === detailSeq.current) setDetail(result)
    } catch (e) {
      if (seq === detailSeq.current) setActionError(e instanceof Error ? e.message : '详情加载失败')
    }
  }

  const applyAction = async (
    action: 'retry' | 'cancel',
    target?: { type: AdminPrintScanTaskDetail['type']; taskId: string },
  ) => {
    const subject = target ?? (detail ? { type: detail.type, taskId: detail.taskId } : null)
    if (!subject || actionBusy) return
    const fromDetail = !target
    const confirmText = action === 'retry' ? '确认将该失败任务重新排队打印？' : '确认取消该等待中的扫描任务？'
    if (!window.confirm(confirmText)) return
    const actionQueryKey = queryKeyRef.current
    setActionBusy(true)
    setActionTaskId(subject.taskId)
    setActionError(null)
    setActionErrorScope(fromDetail ? 'detail' : 'list')
    try {
      await adminPrintScanService.applyTaskAction(subject.type, subject.taskId, action)
    } catch (e) {
      if (actionQueryKey === queryKeyRef.current) {
        setActionError(e instanceof Error ? e.message : '操作失败')
      }
      setActionBusy(false)
      setActionTaskId(null)
      return
    }
    // 动作已在服务端执行成功；仅仍处在原查询条件时才刷新。stale 表示用户已切换筛选，
    // 不应以旧闭包覆盖新列表，也不应误报刷新失败。
    try {
      if (detail && detail.taskId === subject.taskId && detail.type === subject.type) {
        const refreshedDetail = await adminPrintScanService.getTaskDetail(subject.type, subject.taskId)
        if (actionQueryKey !== queryKeyRef.current) return
        setDetail(refreshedDetail)
      }
      if (actionQueryKey !== queryKeyRef.current) return
      const refreshResult = await load()
      if (actionQueryKey !== queryKeyRef.current) return
      if (refreshResult === 'failed') {
        setActionError('操作已执行成功，但页面刷新失败，请手动刷新查看最新状态')
      }
    } catch {
      if (actionQueryKey === queryKeyRef.current) {
        setActionError('操作已执行成功，但页面刷新失败，请手动刷新查看最新状态')
      }
    } finally {
      setActionBusy(false)
      setActionTaskId(null)
    }
  }

  const refreshAfterCloseUnpaid = async () => {
    if (!detail) return
    try {
      setDetail(await adminPrintScanService.getTaskDetail(detail.type, detail.taskId))
      await load()
    } catch {
      setActionError('任务已取消成功，但页面刷新失败，请手动刷新查看最新状态')
    }
  }

  const statusFilters = implemented ? STATUS_FILTERS[taskType as 'print' | 'scan' | 'document_process'] : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TASK_TYPE_TABS.map((tab) => (
          <FilterChip
            key={tab.value}
            active={taskType === tab.value}
            label={tab.implemented ? tab.label : `${tab.label}（未上线）`}
            onClick={() => {
              setTaskType(tab.value)
              setStatus('')
              setPage(1)
            }}
          />
        ))}
      </div>

      {implemented && (
        <div className="flex flex-wrap items-center gap-2">
          {statusFilters.map((f) => (
            <FilterChip
              key={f.value}
              active={status === f.value}
              label={f.label}
              onClick={() => {
                setStatus(f.value)
                setPage(1)
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto inline-flex h-[30px] items-center gap-1.5 rounded-full border border-neutral-900/10 bg-surface px-[13px] text-[12.5px] font-bold text-neutral-700 hover:border-primary-600/40"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" /> 刷新
          </button>
        </div>
      )}

      {implemented && taskType === 'print' && (
        <p className="text-[12px] leading-relaxed text-neutral-500">
          后台不提供强制重打；需要补打请让用户另下新单。
        </p>
      )}

      {actionError && actionErrorScope === 'list' && (
        <div role="alert" className="rounded-lg bg-error-bg px-3 py-2 text-[12.5px] font-bold text-error-text">{actionError}</div>
      )}

      {!implemented ? (
        <EmptyState
          title="该任务类型尚未上线"
          description="该能力尚未开放，目前没有可查看的真实任务。"
        />
      ) : (
        <ConsoleTable items={data?.items ?? []} columns={taskColumns(openDetail, taskType === 'print' ? { busyTaskId: actionBusy ? actionTaskId : null, onRetry: (item) => void applyAction('retry', item) } : null)}
          loading={loading} error={error ? { title: '任务加载失败', message: error, onRetry: () => void load() } : null}
          empty={{ title: '暂无任务', description: '当前筛选条件下没有任务记录。' }}
          page={page} pageSize={pageSize} total={data?.pagination.total ?? 0} onPageChange={setPage} onPageSizeChange={setPageSize}
          className="overflow-hidden rounded-xl border border-neutral-900/10 bg-surface [&_table]:table-fixed [&_th]:px-2 [&_td]:px-2 [&_td]:text-xs"
        />
      )}

      <Drawer open={detailOpen} onClose={() => setDetailOpen(false)} title="任务详情">
        {!detail && !actionError && <LoadingState text="正在加载详情" />}
        {actionError && actionErrorScope === 'detail' && <div role="alert" className="mb-3 rounded-lg bg-error-bg px-3 py-2 text-[12.5px] font-bold text-error-text">{actionError}</div>}
        {detail && (
          <TaskDetailBody
            detail={detail}
            busy={actionBusy && actionTaskId === detail.taskId}
            onAction={(action) => void applyAction(action)}
            onCloseUnpaid={refreshAfterCloseUnpaid}
          />
        )}
      </Drawer>
    </div>
  )
}

function TaskDetailBody({
  detail,
  busy,
  onAction,
  onCloseUnpaid,
}: {
  detail: AdminPrintScanTaskDetail
  busy: boolean
  onAction: (action: 'retry' | 'cancel') => void
  onCloseUnpaid: () => Promise<void> | void
}) {
  const statusMeta = TASK_STATUS_MAP[detail.status] ?? { badge: 'default' as const, label: detail.status }
  const isUnconfirmed = detail.type === 'print' && detail.errorCode === 'PRINT_JOB_UNCONFIRMED'
  const needsManualCheck = isUnconfirmed && detail.type === 'print' && !detail.printOutcome
  const canRetry = detail.type === 'print' && detail.status === 'failed' && !isUnconfirmed
  const retryFieldPresent = detail.type === 'print' && detail.retryBlockedReason !== undefined
  const showRetry = retryFieldPresent || canRetry
  const canCancel = detail.type === 'scan' && detail.status === 'waiting'
  const closeUnpaidBlockReason = detail.type === 'print' ? detail.closeUnpaidBlockReason : null

  const rows: [string, React.ReactNode][] = [
    ['任务编号', detail.taskId],
    ['类型', TASK_TYPE_TABS.find((t) => t.value === detail.type)?.label ?? detail.type],
    ['状态', <StatusBadge key="s" status={statusMeta.badge} label={statusMeta.label} />],
    ['终端', detail.terminalCode ?? '—'],
    ['归属', OWNER_LABELS[detail.ownerType]],
    ['失败原因', <span key="error" title={detail.errorCode ?? undefined}>{printErrorText(detail.errorCode, detail.type)}</span>],
    ['创建时间', fmt(detail.createdAt)],
    ['更新时间', fmt(detail.updatedAt)],
  ]
  if (detail.type === 'print') {
    rows.push(
      ['文件名', detail.fileName ?? '—'],
      ['份数 / 色彩 / 纸型', `${detail.copies ?? '—'} 份 · ${detail.colorMode === 'color' ? '彩色' : detail.colorMode === 'black_white' ? '黑白' : '—'} · ${detail.paperSize ?? '—'}`],
      ['关联订单', detail.orderNo ?? '—'],
      ['完成时间', fmt(detail.completedAt)],
      ['核查结果', detail.printOutcome === 'printed' ? '已核查·已出纸' : detail.printOutcome === 'not_printed' ? '已核查·未出纸' : '未核查'],
    )
  }
  if (detail.type === 'scan') {
    rows.push(['扫描类型', detail.scanType], ['产出文件', detail.fileId ?? '未产出'], ['过期时间', fmt(detail.expiresAt)])
  }
  if (detail.type === 'document_process') {
    rows.push(['处理类型', detail.kind], ['源文件', detail.sourceFileId], ['结果文件', detail.resultFileId ?? '未产出'], ['过期时间', fmt(detail.expiresAt)])
  }

  return (
    <div className="space-y-4">
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 text-[13px]">
            <dt className="shrink-0 text-neutral-500">{label}</dt>
            <dd className="break-all text-right font-bold text-neutral-800">{value}</dd>
          </div>
        ))}
      </dl>

      {detail.type === 'print' && detail.statusLogs.length > 0 && (
        <div>
          <div className="mb-1.5 text-[12px] font-bold text-neutral-500">状态流转</div>
          <ul className="space-y-1 text-[12px] text-neutral-600">
            {detail.statusLogs.map((log, i) => (
              <li key={i}>
                {fmt(log.createdAt)} · {log.fromStatus} → {log.toStatus}
                {log.errorCode && <span title={log.errorCode}>（{printErrorText(log.errorCode, detail.type)}）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {needsManualCheck && (
        <div className="rounded-lg border border-error-text/25 bg-error-bg px-3 py-2.5 text-[12.5px] leading-relaxed text-error-text">
          <p className="font-bold">打印结果未确认，禁止重试，避免重复出纸。</p>
          <p className="mt-1">
            请先核对现场出纸情况，再前往{' '}
            <Link to="/orders" className="font-bold underline underline-offset-2">
              订单管理核查
            </Link>
            ，并按实际情况决定是否全额退款。
          </p>
        </div>
      )}
      {isUnconfirmed && !needsManualCheck && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-[12.5px] leading-relaxed text-neutral-600">
          已完成现场核查，仍禁止重新排队。
        </p>
      )}

      {(showRetry || canCancel) && (
        <div className="border-t border-neutral-900/10 pt-3">
          {showRetry && detail.type === 'print' && (
            <PrintRetryButton
              retryBlockedReason={detail.retryBlockedReason}
              legacyVisible={canRetry}
              busy={busy}
              onRetry={() => onAction('retry')}
              label="重试该失败任务（重新排队到原终端）"
              layout="detail"
            />
          )}
          {canCancel && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('cancel')}
              className="h-10 w-full rounded-lg border border-error-text/30 bg-error-bg text-[13px] font-bold text-error-text disabled:opacity-50"
            >
              {busy ? '处理中…' : '取消该等待中的扫描任务'}
            </button>
          )}
        </div>
      )}

      {detail.type === 'print' && detail.closeUnpaidEligible === true && (
        <CloseUnpaidPrintTaskForm
          taskId={detail.taskId}
          expectedUpdatedAt={detail.updatedAt}
          onClosed={onCloseUnpaid}
        />
      )}

      {detail.type === 'print' && detail.closeUnpaidEligible === false && closeUnpaidBlockReason && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-[12.5px] leading-relaxed text-neutral-600">
          当前不能取消未支付打印任务：{CLOSE_UNPAID_BLOCK_REASON_LABELS[closeUnpaidBlockReason]}
        </p>
      )}
    </div>
  )
}

// ─── 商业化控制 ───────────────────────────────────────────────────────────────

function CommercialControls() {
  const cards = [
    {
      icon: WalletIcon,
      title: '定价管理',
      desc: '打印服务单价、启停由计费页统一管理（唯一合法改价路径）；扫描等其他能力的计费尚未建设。',
      to: '/billing',
      linkLabel: '前往计费与对账',
    },
    {
      icon: SlidersHorizontalIcon,
      title: '权益券与免费额度',
      desc: '权益活动模板、发放与核销记录复用既有权益体系。',
      to: '/benefit-activities',
      linkLabel: '前往权益活动',
    },
    {
      icon: PrinterIcon,
      title: '会员权益',
      desc: '会员打印权益余量与发放明细。',
      to: '/member-benefits',
      linkLabel: '前往会员权益',
    },
  ]
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.title} className="rounded-xl border border-neutral-900/10 bg-surface p-4">
            <card.icon className="mb-2 h-5 w-5 text-primary-700" />
            <div className="text-[14px] font-bold text-neutral-800">{card.title}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">{card.desc}</p>
            <Link to={card.to} className="mt-2 inline-block text-[12.5px] font-bold text-primary-700">
              {card.linkLabel} →
            </Link>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-dashed border-neutral-900/15 bg-surface/60 p-4 text-[12.5px] leading-relaxed text-neutral-500">
        <span className="font-bold text-neutral-700">尚未建设：</span>
        补贴标签与退款异常处置流程尚未建设。现有退款记录和账本差异可在计费页查看。
        目前请通过现有计费与权益入口管理。
      </div>
    </div>
  )
}
