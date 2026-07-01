import { useState } from 'react'
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FileTextIcon, RefreshCwIcon, SearchIcon, XCircleIcon } from 'lucide-react'
import {
  adminOrdersReadonlyService,
  type AdminOrderReadonlyDetail,
  type AdminOrderReadonlyItem,
} from '../../services/api/adminOrdersReadonly'
import { getTerminals, type AdminTerminalRecord } from '../../services/api/devices'

// ─── Display maps ─────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending:   { badge: 'warning', label: '待领取' },
  claimed:   { badge: 'info',    label: '已领取' },
  printing:  { badge: 'info',    label: '打印中' },
  completed: { badge: 'success', label: '已完成' },
  failed:    { badge: 'error',   label: '失败' },
  cancelled: { badge: 'default', label: '已取消' },
}

const PAY_STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'default'; label: string }> = {
  unpaid:   { badge: 'warning', label: '未支付' },
  paid:     { badge: 'success', label: '已支付' },
  refunded: { badge: 'default', label: '已退款记录' },
  failed:   { badge: 'error',   label: '支付失败' },
}

const STATUS_FILTERS = [
  { label: '全部', value: '' },
  { label: '待领取', value: 'pending' },
  { label: '已领取', value: 'claimed' },
  { label: '打印中', value: 'printing' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
] as const

const PAY_FILTERS = [
  { label: '全部支付状态', value: '' },
  { label: '未支付', value: 'unpaid' },
  { label: '已支付', value: 'paid' },
  { label: '已退款记录', value: 'refunded' },
  { label: '支付失败', value: 'failed' },
] as const

const COLOR_LABELS: Record<string, string> = { black_white: '黑白', color: '彩色' }
const OWNER_LABELS: Record<string, string> = { member: '会员', anonymous: '游客' }

function fmt(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—'
}

function amountText(amountCents: number, currency: string): string {
  if (amountCents <= 0) return '未计费'
  return `${currency === 'CNY' ? '¥' : currency} ${(amountCents / 100).toFixed(2)}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [detail, setDetail] = useState<AdminOrderReadonlyDetail | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [statusFilter, setStatusFilter] = useState('')
  const [payStatus, setPayStatus] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [terminalOptions, setTerminalOptions] = useState<AdminTerminalRecord[]>([])
  const [reassignTerminalId, setReassignTerminalId] = useState('')
  const [operationState, setOperationState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle')
  const [operationMessage, setOperationMessage] = useState('')
  const pageSize = 20
  const ordersKey = `admin:orders:${statusFilter}:${payStatus}:${search}:${page}:${pageSize}`

  const {
    data: orderPage,
    status,
    refresh,
  } = useRefreshable(
    ordersKey,
    () => adminOrdersReadonlyService.list({
      taskStatus: statusFilter || undefined,
      payStatus: payStatus || undefined,
      search: search || undefined,
      page,
      pageSize,
    }),
    {
      intervalMs: 30_000,
      merge: (current, incoming) => {
        const items = mergeById<AdminOrderReadonlyItem>((item) => item.id)(
          current?.items,
          incoming.items,
        )
        if (
          current &&
          items === current.items &&
          current.pagination.page === incoming.pagination.page &&
          current.pagination.pageSize === incoming.pagination.pageSize &&
          current.pagination.total === incoming.pagination.total &&
          current.pagination.totalPages === incoming.pagination.totalPages
        ) {
          return current
        }
        return { ...incoming, items }
      },
      failPolicy: 'keep-last',
    },
  )

  useInteractionLock(detailState === 'loading' || detailState === 'ready', [ordersKey], 'hard')

  const items = orderPage?.items ?? []
  const total = orderPage?.pagination.total ?? 0
  const totalPages = orderPage?.pagination.totalPages ?? 1
  const state: 'loading' | 'error' | 'ready' =
    status === 'error' && !orderPage ? 'error' :
    status === 'loading' && !orderPage ? 'loading' :
    orderPage ? 'ready' : 'loading'

  const openDetail = async (id: string) => {
    setDetailState('loading')
    setDetail(null)
    setOperationState('idle')
    setOperationMessage('')
    setReassignTerminalId('')
    try {
      const data = await adminOrdersReadonlyService.getById(id)
      setDetail(data)
      setDetailState('ready')
      if (data.print) {
        try {
          const terminals = await getTerminals()
          setTerminalOptions(terminals.terminals.filter((terminal) => terminal.enabled))
        } catch {
          setTerminalOptions([])
        }
      }
    } catch {
      setDetailState('error')
    }
  }

  const refreshOpenDetail = async (id: string) => {
    const data = await adminOrdersReadonlyService.getById(id)
    setDetail(data)
    return data
  }

  const handleCancelPrintTask = async () => {
    if (!detail || !detail.print?.operations.canCancel) return
    if (!window.confirm(`确认取消打印任务 ${detail.orderNo}？`)) return
    setOperationState('loading')
    setOperationMessage('')
    try {
      const next = await adminOrdersReadonlyService.cancelPrintTask(detail.id, '后台工作人员取消打印任务')
      setDetail(next)
      setOperationState('success')
      setOperationMessage('打印任务已取消')
      void refresh()
    } catch (error) {
      setOperationState('error')
      setOperationMessage(error instanceof Error ? error.message : '取消失败，请刷新后重试')
      void refreshOpenDetail(detail.id).catch(() => undefined)
    }
  }

  const handleReassignPrintTask = async () => {
    if (!detail || !detail.print?.operations.canReassign) return
    if (!reassignTerminalId) {
      setOperationState('error')
      setOperationMessage('请选择目标终端')
      return
    }
    setOperationState('loading')
    setOperationMessage('')
    try {
      const next = await adminOrdersReadonlyService.reassignPrintTask(
        detail.id,
        reassignTerminalId,
        '后台工作人员重分配打印终端',
      )
      setDetail(next)
      setOperationState('success')
      setOperationMessage('打印任务已重分配到目标终端')
      setReassignTerminalId('')
      void refresh()
    } catch (error) {
      setOperationState('error')
      setOperationMessage(error instanceof Error ? error.message : '重分配失败，请刷新后重试')
      void refreshOpenDetail(detail.id).catch(() => undefined)
    }
  }

  return (
    <Page
      title="订单管理"
      subtitle={`订单与打印运营 — 共 ${total} 条`}
      actions={
        <button
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCwIcon className="h-4 w-4" />
          刷新
        </button>
      }
    >
      {/* 诚实说明:订单与支付仍只读，打印任务仅开放受限运营动作 */}
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
        当前展示真实订单与打印任务安全元数据。支付 / 退款 / 对账域尚未上线，本页不提供标记支付或退款；打印任务仅支持取消与重分配终端两类受控运营动作。
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => { setStatusFilter(f.value); setPage(1) }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {PAY_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => { setPayStatus(f.value); setPage(1) }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                payStatus === f.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <form
          className="ml-auto flex min-w-[260px] items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); setSearch(searchDraft.trim()); setPage(1) }}
        >
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
            <SearchIcon className="h-4 w-4 text-gray-400" />
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="搜索订单号"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <button className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700">
            搜索
          </button>
        </form>
      </div>

      {state === 'loading' && <LoadingState className="py-24" />}
      {state === 'error' && <ErrorState className="py-24" onRetry={() => void refresh()} />}

      {state === 'ready' && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  {['订单号', '文件名', '用户', '终端', '金额', '支付状态', '任务状态', '错误码', '创建时间'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState title="暂无订单" description="一体机创建打印订单后会出现在这里" icon={FileTextIcon} className="py-12" />
                    </td>
                  </tr>
                ) : (
                  items.map((order) => {
                    const taskStatus = STATUS_MAP[order.taskStatus] ?? { badge: 'default' as const, label: order.taskStatus }
                    const pay = PAY_STATUS_MAP[order.payStatus] ?? { badge: 'default' as const, label: order.payStatus }
                    return (
                      <tr key={order.id} className="cursor-pointer hover:bg-gray-50" onClick={() => void openDetail(order.id)}>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{order.orderNo}</td>
                        <td className="max-w-56 truncate px-4 py-3 font-medium text-gray-800">{order.printFileName ?? '未记录'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{OWNER_LABELS[order.ownerType]} · {order.userLabel}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{order.terminalCode ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{amountText(order.amountCents, order.currency)}</td>
                        <td className="px-4 py-3"><StatusBadge status={pay.badge} label={pay.label} /></td>
                        <td className="px-4 py-3"><StatusBadge status={taskStatus.badge} label={taskStatus.label} /></td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-red-400">{order.errorCode ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{fmt(order.createdAt)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 服务端分页 */}
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-400">第 {page} / {totalPages} 页 · 共 {total} 条</p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                上一页
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        </Card>
      )}

      {detailState === 'loading' && <LoadingState className="py-8" />}
      {detailState === 'error' && <ErrorState className="mt-4 py-8" onRetry={() => setDetailState('idle')} />}
      {detailState === 'ready' && detail && (
        <Card className="mt-4 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">订单详情 · {detail.orderNo}</h2>
              <p className="mt-1 text-xs text-gray-400">支付与退款只读；打印任务按当前状态开放运营处理</p>
            </div>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              onClick={() => { setDetail(null); setDetailState('idle') }}
            >
              关闭
            </button>
          </div>
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <Info label="订单类型" value={detail.type} />
            <Info label="金额" value={amountText(detail.amountCents, detail.currency)} />
            <Info label="支付状态" value={PAY_STATUS_MAP[detail.payStatus]?.label ?? detail.payStatus} />
            <Info label="任务状态" value={STATUS_MAP[detail.taskStatus]?.label ?? detail.taskStatus} />
            <Info label="文件名" value={detail.print?.fileName ?? '未记录'} />
            <Info
              label="打印参数"
              value={
                [
                  detail.print?.copies ? `${detail.print.copies} 份` : null,
                  detail.print?.colorMode ? COLOR_LABELS[detail.print.colorMode] : null,
                  detail.print?.paperSize,
                  detail.print?.duplex,
                  detail.print?.pageRange ? `页码 ${detail.print.pageRange}` : null,
                ].filter(Boolean).join(' · ') || '—'
              }
            />
          </div>

          {detail.print && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">打印运营处理</h3>
                  {detail.print.operations.reason ? (
                    <p className="mt-1 text-xs text-gray-500">{detail.print.operations.reason}</p>
                  ) : null}
                </div>
                {operationMessage ? (
                  <p
                    className={[
                      'text-xs',
                      operationState === 'error' ? 'text-red-500' : 'text-emerald-600',
                    ].join(' ')}
                  >
                    {operationMessage}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void handleCancelPrintTask()}
                  disabled={!detail.print.operations.canCancel || operationState === 'loading'}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <XCircleIcon className="h-4 w-4" />
                  取消打印任务
                </button>
                <select
                  value={reassignTerminalId}
                  onChange={(event) => setReassignTerminalId(event.target.value)}
                  disabled={!detail.print.operations.canReassign || operationState === 'loading'}
                  className="min-h-[36px] min-w-[220px] rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 outline-none disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <option value="">选择目标终端</option>
                  {terminalOptions.map((terminal) => (
                    <option key={terminal.id} value={terminal.id}>
                      {terminal.terminalCode}{terminal.locationLabel ? ` · ${terminal.locationLabel}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void handleReassignPrintTask()}
                  disabled={!detail.print.operations.canReassign || !reassignTerminalId || operationState === 'loading'}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCwIcon className="h-4 w-4" />
                  重分配终端
                </button>
              </div>
            </div>
          )}

          <div className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">状态流转</h3>
            {detail.statusLogs.length === 0 ? (
              <p className="text-xs text-gray-400">暂无状态流转记录</p>
            ) : (
              <div className="space-y-2">
                {detail.statusLogs.map((log) => (
                  <div key={`${log.fromStatus}-${log.toStatus}-${log.createdAt}`} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    {log.fromStatus} → {log.toStatus}
                    {log.errorCode ? <span className="ml-2 font-mono text-red-400">{log.errorCode}</span> : null}
                    <span className="ml-2 text-gray-400">{fmt(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      <p className="mt-3 text-xs text-gray-400">
        仅展示安全元数据:不含文件链接、文件指纹、原始打印参数、内部错误详情或用户/终端内部 ID。文件内容访问仍走文件管理并记录审计。
      </p>
    </Page>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-gray-700">{value}</p>
    </div>
  )
}
