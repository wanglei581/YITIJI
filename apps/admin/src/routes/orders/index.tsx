import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, StatusBadge, Drawer, EmptyState, LoadingState, ErrorState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { PackageIcon, RefreshCwIcon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'
import {
  listOrders, getOrder, updateOrderStatus, refundOrder,
  type AdminOrderListItem, type AdminOrderDetail,
} from '../../services/api'

// ─── 展示映射 ───────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = { print: '打印', scan: '扫描', photo: '证件照', ai: 'AI简历' }
const TYPE_STYLES: Record<string, string> = {
  print: 'bg-blue-50 text-blue-600',
  scan: 'bg-purple-50 text-purple-600',
  photo: 'bg-green-50 text-green-600',
  ai: 'bg-orange-50 text-orange-600',
}

type Badge = 'success' | 'warning' | 'error' | 'info' | 'default'

const PAY_MAP: Record<string, { badge: Badge; label: string }> = {
  unpaid: { badge: 'warning', label: '未支付' },
  paid: { badge: 'success', label: '已支付' },
  refunded: { badge: 'default', label: '已标记退款' },
  failed: { badge: 'error', label: '支付失败' },
}
const TASK_MAP: Record<string, { badge: Badge; label: string }> = {
  pending: { badge: 'default', label: '排队中' },
  claimed: { badge: 'info', label: '已认领' },
  printing: { badge: 'info', label: '打印中' },
  completed: { badge: 'success', label: '已完成' },
  failed: { badge: 'error', label: '失败' },
  cancelled: { badge: 'default', label: '已取消' },
}
const COLOR_LABELS: Record<string, string> = { black_white: '黑白', color: '彩色' }
const DUPLEX_LABELS: Record<string, string> = {
  simplex: '单面', duplex_long_edge: '双面（长边）', duplex_short_edge: '双面（短边）',
}

function payView(s: string) { return PAY_MAP[s] ?? { badge: 'default' as Badge, label: s } }
function taskView(s: string) { return TASK_MAP[s] ?? { badge: 'default' as Badge, label: s } }
function amountText(amountCents: number): string {
  return amountCents > 0 ? `¥${(amountCents / 100).toFixed(2)}` : '未计费'
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const TYPE_FILTERS: { label: string; value: string }[] = [
  { label: '全部', value: '' },
  { label: '打印', value: 'print' },
  { label: '扫描', value: 'scan' },
  { label: '证件照', value: 'photo' },
  { label: 'AI简历', value: 'ai' },
]
const PAY_FILTERS: { label: string; value: string }[] = [
  { label: '全部支付状态', value: '' },
  { label: '未支付', value: 'unpaid' },
  { label: '已支付', value: 'paid' },
  { label: '已标记退款', value: 'refunded' },
  { label: '支付失败', value: 'failed' },
]

// 运营视图任务状态可选值（admin 改 Order.taskStatus，不动 PrintTask）。
const TASK_STATUS_OPTIONS = ['pending', 'claimed', 'printing', 'completed', 'failed', 'cancelled']

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [items, setItems] = useState<AdminOrderListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [payFilter, setPayFilter] = useState('')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // 详情抽屉
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refundMode, setRefundMode] = useState(false)
  const [refundReason, setRefundReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  // 搜索防抖（变更同时回到第 1 页）
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 250)
    return () => clearTimeout(t)
  }, [search, setPage])

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listOrders({
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(payFilter ? { payStatus: payFilter } : {}),
        ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载订单失败')
    } finally {
      setLoading(false)
    }
  }, [typeFilter, payFilter, debouncedSearch, page, pageSize])

  useEffect(() => { void loadList() }, [loadList])

  const openDetail = (id: string) => {
    setDetailOpen(true)
    setDetail(null)
    setDetailError(null)
    setRefundMode(false)
    setRefundReason('')
    setDetailLoading(true)
    getOrder(id)
      .then(setDetail)
      .catch((e) => setDetailError(e instanceof Error ? e.message : '加载详情失败'))
      .finally(() => setDetailLoading(false))
  }

  const closeDetail = () => { setDetailOpen(false); setNotice(null) }

  const runMutation = async (fn: () => Promise<AdminOrderDetail>, okMsg: string) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const updated = await fn()
      setDetail(updated)
      setRefundMode(false)
      setRefundReason('')
      setNotice(okMsg)
      void loadList()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const onChangeTypeFilter = (v: string) => { setTypeFilter(v); setPage(1) }
  const onChangePayFilter = (v: string) => { setPayFilter(v); setPage(1) }

  return (
    <Page
      title="订单管理"
      subtitle="打印运营订单（不接在线支付，金额暂未计费；支付状态为线下运营标记，退款为「标记退款」仅作运营记录）"
      actions={
        <Button size="sm" variant="outline" className="flex items-center gap-1.5" onClick={() => void loadList()} disabled={loading}>
          <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      }
    >
      {/* 筛选 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => onChangeTypeFilter(f.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                typeFilter === f.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
          <select
            value={payFilter}
            onChange={(e) => onChangePayFilter(e.target.value)}
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
          >
            {PAY_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索订单号…"
          className="h-8 w-56 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
        />
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        {loading ? (
          <LoadingState text="加载订单中…" className="py-16" />
        ) : error ? (
          <ErrorState title="加载订单失败" message={error} onRetry={() => void loadList()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={debouncedSearch || typeFilter || payFilter ? '未找到匹配的订单' : '暂无订单数据'}
            description={debouncedSearch || typeFilter || payFilter ? '请调整筛选条件或关键词' : '用户在一体机完成打印后将自动生成订单'}
            icon={PackageIcon}
            className="py-16"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  {['订单号', '类型', '用户', '终端', '金额', '支付状态', '任务状态', '创建时间', '操作'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((o) => {
                  const pay = payView(o.payStatus)
                  const task = taskView(o.taskStatus)
                  return (
                    <tr key={o.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openDetail(o.id)}>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{o.orderNo}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[o.type] ?? 'bg-gray-100 text-gray-600'}`}>
                          {TYPE_LABELS[o.type] ?? o.type}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{o.userLabel}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{o.terminalCode ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500">{amountText(o.amountCents)}</td>
                      <td className="px-4 py-3"><StatusBadge status={pay.badge} label={pay.label} /></td>
                      <td className="px-4 py-3"><StatusBadge status={task.badge} label={task.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{fmtTime(o.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          onClick={(e) => { e.stopPropagation(); openDetail(o.id) }}
                        >
                          查看详情
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
        )}
      </Card>
      <p className="mt-3 text-xs text-gray-400">
        金额暂未计费（本阶段不接在线支付）；支付状态为线下运营标记。「标记退款」仅用于运营记录、不发生真实资金退款；
        任务状态可由管理员标记为运营视图状态，不影响真实打印任务。
      </p>

      {/* 详情抽屉 */}
      <Drawer open={detailOpen} onClose={closeDetail} title="订单详情" size="lg">
        {detailLoading ? (
          <LoadingState text="加载详情中…" className="py-16" />
        ) : detailError ? (
          <ErrorState title="加载详情失败" message={detailError} />
        ) : detail ? (
          <OrderDetailBody
            detail={detail}
            busy={busy}
            notice={notice}
            refundMode={refundMode}
            refundReason={refundReason}
            onRefundReasonChange={setRefundReason}
            onMarkPaid={() => void runMutation(() => updateOrderStatus(detail.id, { payStatus: 'paid' }), '已标记为「已支付」')}
            onMarkFailed={() => void runMutation(() => updateOrderStatus(detail.id, { payStatus: 'failed' }), '已标记为「支付失败」')}
            onUpdateTaskStatus={(taskStatus) => void runMutation(() => updateOrderStatus(detail.id, { taskStatus }), '运营视图任务状态已更新（不影响真实打印任务）')}
            onStartRefund={() => { setRefundMode(true); setNotice(null) }}
            onCancelRefund={() => { setRefundMode(false); setRefundReason('') }}
            onConfirmRefund={() => void runMutation(() => refundOrder(detail.id, refundReason.trim()), '已标记退款（仅运营记录，未发生真实资金退款）')}
          />
        ) : null}
      </Drawer>
    </Page>
  )
}

// ─── 详情正文 ───────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-50 py-2 text-sm">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  )
}

interface DetailBodyProps {
  detail: AdminOrderDetail
  busy: boolean
  notice: string | null
  refundMode: boolean
  refundReason: string
  onRefundReasonChange: (v: string) => void
  onMarkPaid: () => void
  onMarkFailed: () => void
  onUpdateTaskStatus: (taskStatus: string) => void
  onStartRefund: () => void
  onCancelRefund: () => void
  onConfirmRefund: () => void
}

function OrderDetailBody(p: DetailBodyProps) {
  const { detail: d } = p
  const pay = payView(d.payStatus)
  const task = taskView(d.taskStatus)
  const [taskDraft, setTaskDraft] = useState(d.taskStatus)
  // 详情切换/刷新后同步草稿到最新任务状态。
  useEffect(() => { setTaskDraft(d.taskStatus) }, [d.taskStatus])

  return (
    <div className="space-y-5">
      {/* 基本信息 */}
      <section>
        <Row label="订单号" value={<span className="font-mono text-xs">{d.orderNo}</span>} />
        <Row label="类型" value={TYPE_LABELS[d.type] ?? d.type} />
        <Row label="用户" value={<span>{d.userLabel}{d.endUserId ? <span className="ml-1 font-mono text-xs text-gray-400">#{d.endUserId.slice(-6)}</span> : null}</span>} />
        <Row label="终端" value={<span className="font-mono text-xs">{d.terminalCode ?? d.terminalId ?? '—'}</span>} />
        <Row label="金额" value={amountText(d.amountCents)} />
        <Row label="支付状态" value={<StatusBadge status={pay.badge} label={pay.label} />} />
        <Row label="任务状态" value={<StatusBadge status={task.badge} label={task.label} />} />
        <Row label="创建时间" value={<span className="text-xs text-gray-500">{fmtTime(d.createdAt)}</span>} />
        {d.payStatus === 'refunded' && (
          <>
            <Row label="标记退款时间" value={<span className="text-xs text-gray-500">{fmtTime(d.refundedAt)}</span>} />
            <Row label="标记退款原因" value={<span className="text-xs">{d.refundReason ?? '—'}</span>} />
          </>
        )}
      </section>

      {/* 打印信息 */}
      {d.print && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">打印信息</h4>
          <Row label="文件名" value={<span className="break-all text-xs">{d.print.fileName ?? '—'}</span>} />
          <Row label="份数" value={d.print.copies ?? '—'} />
          <Row label="色彩" value={d.print.colorMode ? (COLOR_LABELS[d.print.colorMode] ?? d.print.colorMode) : '—'} />
          <Row label="单双面" value={d.print.duplex ? (DUPLEX_LABELS[d.print.duplex] ?? d.print.duplex) : '—'} />
          <Row label="纸张" value={d.print.paperSize ?? '—'} />
          <Row label="页码范围" value={d.print.pageRange ?? '全部页面'} />
          <Row label="打印状态" value={<StatusBadge status={taskView(d.print.status).badge} label={taskView(d.print.status).label} />} />
          <Row label="完成时间" value={<span className="text-xs text-gray-500">{fmtTime(d.print.completedAt)}</span>} />
          {d.print.errorCode && (
            <Row label="错误" value={<span className="text-xs text-red-600">{d.print.errorCode}{d.print.errorMessage ? `：${d.print.errorMessage}` : ''}</span>} />
          )}
        </section>
      )}

      {/* 状态流转 */}
      {d.statusLogs.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">状态流转</h4>
          <ol className="space-y-1.5">
            {d.statusLogs.map((l, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">
                  {taskView(l.fromStatus).label} <span className="text-gray-300">→</span> {taskView(l.toStatus).label}
                  {l.errorCode ? <span className="ml-1 text-red-500">（{l.errorCode}）</span> : null}
                </span>
                <span className="text-gray-400">{fmtTime(l.createdAt)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 操作 */}
      <section className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="text-xs text-gray-500">
          本终端不接在线支付，支付状态为线下运营标记；「标记退款」仅用于运营记录、不发生真实资金退款。
        </p>
        {p.notice && <p className="text-xs font-medium text-primary-600">{p.notice}</p>}

        {/* 支付状态操作 */}
        {!p.refundMode ? (
          <div className="flex flex-wrap items-center gap-2">
            {(d.payStatus === 'unpaid' || d.payStatus === 'failed') && (
              <Button size="sm" variant="primary" disabled={p.busy} onClick={p.onMarkPaid}>标记已支付</Button>
            )}
            {d.payStatus === 'unpaid' && (
              <Button size="sm" variant="outline" disabled={p.busy} onClick={p.onMarkFailed}>标记支付失败</Button>
            )}
            {d.payStatus === 'paid' && (
              <Button size="sm" variant="danger" disabled={p.busy} onClick={p.onStartRefund}>标记退款</Button>
            )}
            {d.payStatus === 'refunded' && <span className="text-xs text-gray-400">订单已标记退款，无可用支付操作。</span>}
          </div>
        ) : (
          // 标记退款确认区（无独立弹窗组件，内嵌确认；文案统一「标记退款」+ 明确不动真实资金）
          <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/60 p-3">
            <p className="text-sm font-semibold text-red-900">标记退款</p>
            <p className="text-xs text-red-700">
              当前系统尚未接入真实支付退款，本操作仅用于运营记录，将订单标记为「已标记退款」，不会发生真实资金退款。
            </p>
            <textarea
              value={p.refundReason}
              onChange={(e) => p.onRefundReasonChange(e.target.value)}
              placeholder="请填写标记退款原因（必填）…"
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="danger" disabled={p.busy || p.refundReason.trim().length === 0} onClick={p.onConfirmRefund}>确认标记退款</Button>
              <Button size="sm" variant="outline" disabled={p.busy} onClick={p.onCancelRefund}>取消</Button>
            </div>
          </div>
        )}

        {/* 运营视图任务状态（仅改 Order，不影响真实打印任务）*/}
        {!p.refundMode && (
          <div className="border-t border-gray-100 pt-3">
            <p className="mb-1.5 text-xs text-gray-500">运营视图任务状态（仅运营记录，不影响真实打印任务）</p>
            <div className="flex items-center gap-2">
              <select
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                disabled={p.busy}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
              >
                {TASK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{taskView(s).label}</option>)}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={p.busy || taskDraft === d.taskStatus}
                onClick={() => p.onUpdateTaskStatus(taskDraft)}
              >
                更新任务状态
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
