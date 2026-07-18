import { useState } from 'react'
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { Drawer, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import { FileTextIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import {
  adminOrdersReadonlyService,
  type AdminOrderReadonlyDetail,
  type AdminOrderReadonlyItem,
} from '../../services/api/adminOrdersReadonly'

// ─── Display maps ─────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending:   { badge: 'warning', label: '待领取' },
  claimed:   { badge: 'info',    label: '已领取' },
  printing:  { badge: 'info',    label: '打印中' },
  completed: { badge: 'success', label: '已完成' },
  failed:    { badge: 'error',   label: '失败' },
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

// ─── 原型规范局部件 ───────────────────────────────────────────────────────────

const TH_CLS = 'whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/80 px-2.5 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500'
const TD_CLS = 'whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-[11px]'

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11.5px] font-bold tracking-[0.03em] text-neutral-500">{label}</p>
      <p className="mt-1 text-[13.5px] font-semibold text-neutral-900">{value}</p>
    </div>
  )
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
    try {
      const data = await adminOrdersReadonlyService.getById(id)
      setDetail(data)
      setDetailState('ready')
    } catch {
      setDetailState('error')
    }
  }

  const closeDetail = () => {
    setDetail(null)
    setDetailState('idle')
  }

  return (
    <Page
      title="订单管理"
      subtitle={`打印 / 扫描订单只读视图 · 状态由 Terminal Agent 回报落库 · 共 ${total} 条`}
      actions={
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </button>
      }
    >
      {/* 诚实说明:只读订单视图 */}
      <div className="mb-4 rounded-[9px] border border-info/20 bg-info-bg px-4 py-2.5 text-[13px] text-info-fg">
        当前展示真实订单与打印任务安全元数据。支付 / 退款 / 对账域尚未上线，本页只读展示金额、支付状态和任务状态，不提供标记支付、退款或改状态操作。
      </div>

      <section className="overflow-hidden rounded-lg border border-neutral-900/[0.06] bg-surface shadow-sm">
        <div className="px-5 pt-[18px]">
          {/* 工具条：搜索 + 任务状态 chips */}
          <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
            <form
              className="flex h-[34px] min-w-[240px] items-center gap-2 rounded-[9px] border border-neutral-900/10 bg-surface px-3"
              onSubmit={(e) => { e.preventDefault(); setSearch(searchDraft.trim()); setPage(1) }}
            >
              <SearchIcon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="搜索订单号"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-500"
              />
            </form>
            {STATUS_FILTERS.map((f) => (
              <FilterChip
                key={f.label}
                active={statusFilter === f.value}
                label={f.label}
                onClick={() => { setStatusFilter(f.value); setPage(1) }}
              />
            ))}
          </div>
          {/* 支付状态 chips */}
          <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
            {PAY_FILTERS.map((f) => (
              <FilterChip
                key={f.label}
                active={payStatus === f.value}
                label={f.label}
                onClick={() => { setPayStatus(f.value); setPage(1) }}
              />
            ))}
          </div>
        </div>

        {state === 'loading' && <LoadingState className="py-24" />}
        {state === 'error' && <ErrorState className="py-24" onRetry={() => void refresh()} />}

        {state === 'ready' && (
          <>
            <div className="overflow-x-auto px-5">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {['订单号', '文件名', '用户', '终端', '金额', '支付状态', '任务状态', '错误码', '创建时间'].map((h) => (
                      <th key={h} className={TH_CLS}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
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
                        <tr
                          key={order.id}
                          className="cursor-pointer transition-colors hover:bg-neutral-50"
                          onClick={() => void openDetail(order.id)}
                        >
                          <td className={`${TD_CLS} font-bold text-primary-700`}>{order.orderNo}</td>
                          <td className={`${TD_CLS} max-w-56 truncate font-semibold text-neutral-900`}>{order.printFileName ?? '未记录'}</td>
                          <td className={`${TD_CLS} text-xs text-neutral-500`}>{OWNER_LABELS[order.ownerType]} · {order.userLabel}</td>
                          <td className={`${TD_CLS} font-mono text-xs text-neutral-500`}>{order.terminalCode ?? '—'}</td>
                          <td className={`${TD_CLS} tabular-nums text-neutral-700`}>{amountText(order.amountCents, order.currency)}</td>
                          <td className={TD_CLS}><StatusBadge dot status={pay.badge} label={pay.label} /></td>
                          <td className={TD_CLS}><StatusBadge dot status={taskStatus.badge} label={taskStatus.label} /></td>
                          <td className={`${TD_CLS} font-mono text-xs text-error-fg`}>{order.errorCode ?? '—'}</td>
                          <td className={`${TD_CLS} tabular-nums text-xs text-neutral-500`}>{fmt(order.createdAt)}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 服务端分页 */}
            <div className="flex items-center justify-between px-5 pb-4 pt-3.5 text-[12.5px] text-neutral-500">
              <span>第 {page} / {totalPages} 页 · 共 {total} 条</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="grid h-7 min-w-7 place-items-center rounded-lg border border-neutral-900/10 bg-surface px-2 text-[12.5px] font-bold text-neutral-700 transition-colors hover:border-primary-600/40 disabled:opacity-40 disabled:hover:border-neutral-900/10"
                  aria-label="上一页"
                >
                  ‹
                </button>
                <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-primary-600 px-2 text-[12.5px] font-bold text-white">
                  {page}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="grid h-7 min-w-7 place-items-center rounded-lg border border-neutral-900/10 bg-surface px-2 text-[12.5px] font-bold text-neutral-700 transition-colors hover:border-primary-600/40 disabled:opacity-40 disabled:hover:border-neutral-900/10"
                  aria-label="下一页"
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* 详情抽屉（原型 dr-h/info-grid/dr-sec 规范） */}
      <Drawer
        open={detailState !== 'idle'}
        onClose={closeDetail}
        title={detail ? `订单详情 · ${detail.orderNo}` : '订单详情'}
        size="md"
      >
        {detailState === 'loading' && <LoadingState className="py-16" />}
        {detailState === 'error' && <ErrorState className="py-16" onRetry={closeDetail} />}
        {detailState === 'ready' && detail && (
          <>
            <p className="text-xs text-neutral-500">只读详情，不提供支付、退款或任务状态写入。</p>
            <div className="my-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Info label="订单类型" value={detail.type} />
              <Info label="金额" value={amountText(detail.amountCents, detail.currency)} />
              <Info label="支付状态" value={PAY_STATUS_MAP[detail.payStatus]?.label ?? detail.payStatus} />
              <Info label="任务状态" value={STATUS_MAP[detail.taskStatus]?.label ?? detail.taskStatus} />
              <Info label="用户" value={`${OWNER_LABELS[detail.ownerType]} · ${detail.userLabel}`} />
              <Info label="终端" value={detail.terminalCode ?? '—'} />
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

            <h3 className="mb-2 mt-5 text-[12.5px] font-extrabold text-neutral-700 [font-family:var(--font-heading,inherit)]">
              状态流转
            </h3>
            {detail.statusLogs.length === 0 ? (
              <p className="text-xs text-neutral-500">暂无状态流转记录</p>
            ) : (
              <div className="space-y-2">
                {detail.statusLogs.map((log) => (
                  <div
                    key={`${log.fromStatus}-${log.toStatus}-${log.createdAt}`}
                    className="rounded-[9px] bg-neutral-50 px-3 py-2 text-xs text-neutral-700"
                  >
                    <span className="font-semibold">
                      {STATUS_MAP[log.fromStatus]?.label ?? log.fromStatus} → {STATUS_MAP[log.toStatus]?.label ?? log.toStatus}
                    </span>
                    {log.errorCode ? <span className="ml-2 font-mono text-error-fg">{log.errorCode}</span> : null}
                    <span className="ml-2 tabular-nums text-neutral-500">{fmt(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Drawer>

      <p className="mt-3 text-xs text-neutral-500">
        仅展示安全元数据:不含文件链接、文件指纹、原始打印参数、内部错误详情或用户/终端内部 ID。文件内容访问仍走文件管理并记录审计。
      </p>
    </Page>
  )
}
