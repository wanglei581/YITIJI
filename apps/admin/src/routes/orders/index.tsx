import { useState, useCallback } from 'react'
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { formatDateTime } from '@ai-job-print/shared'
import { Drawer, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import { FileTextIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import {
  adminOrdersReadonlyService,
  type AdminOrderMarkPaidResult,
  type AdminOrderMarkPaidSource,
  type AdminOrderReadonlyDetail,
  type AdminOrderReadonlyItem,
} from '../../services/api/adminOrdersReadonly'
import { adminPrintJobsService } from '../../services/api/adminPrintJobs'
import { ApiHttpError } from '../../services/api/client'
import { userMessageOf } from '../../services/api/userErrorMessage'

// ─── Display maps ─────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending:   { badge: 'warning', label: '待领取' },
  claimed:   { badge: 'info',    label: '已领取' },
  printing:  { badge: 'info',    label: '打印中' },
  completed: { badge: 'success', label: '已完成' },
  failed:    { badge: 'error',   label: '失败' },
  cancelled: { badge: 'default', label: '已取消' },
  abandoned: { badge: 'default', label: '已废弃' },
}

const PAY_STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'default'; label: string }> = {
  unpaid:           { badge: 'warning', label: '未支付' },
  paying:           { badge: 'warning', label: '支付中' },
  paid:             { badge: 'success', label: '已支付' },
  refunding:        { badge: 'warning', label: '退款中' },
  refunded:         { badge: 'default', label: '已退款' },
  partial_refunded: { badge: 'default', label: '部分退款' },
  failed:           { badge: 'error',   label: '支付失败' },
  closed:           { badge: 'default', label: '已关闭' },
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
  { label: '支付中', value: 'paying' },
  { label: '已支付', value: 'paid' },
  { label: '退款中', value: 'refunding' },
  { label: '部分退款', value: 'partial_refunded' },
  { label: '已退款', value: 'refunded' },
  { label: '支付失败', value: 'failed' },
  { label: '已关闭', value: 'closed' },
] as const

const COLOR_LABELS: Record<string, string> = { black_white: '黑白', color: '彩色' }
const OWNER_LABELS: Record<string, string> = { member: '会员', anonymous: '游客' }

// 收款入账来源：后端 AdminMarkPaidDto 只放行这两个（free 由 0 元建单自动产生，
// 线上通道各走各的回调路径），文案与「我的」订单侧的来源展示保持一致。
const MARK_PAID_SOURCES: ReadonlyArray<{ value: AdminOrderMarkPaidSource; label: string; hint: string }> = [
  { value: 'offline', label: '线下收款', hint: '现场向用户实际收到现金' },
  { value: 'manual_confirmed', label: '人工确认', hint: '非现场现金，已另行核实到账后由管理员确认' },
]

function markPaidSourceLabel(source: string | null): string {
  return MARK_PAID_SOURCES.find((s) => s.value === source)?.label ?? source ?? '未标注'
}

// 后端错误码 → 可读解释；原始码始终一并展示，便于现场上报排查。
const MARK_PAID_ERROR_TEXT: Record<string, string> = {
  ORDER_ALREADY_PAID: '该订单已由其它来源入账，本次未重复记账',
  ORDER_INVALID_TRANSITION: '该订单当前支付状态不允许入账（已退款 / 已关闭 / 支付失败等）',
  ORDER_NOT_FOUND: '订单不存在',
  // 后端两道防线：ValidationPipe 先拒非法取值（VALIDATION_FAILED），
  // controller / service 再各有一层白名单（*_NOT_ADMIN_ALLOWED / *_INVALID）。
  VALIDATION_FAILED: '请求被后端校验拒绝（收款来源仅支持线下收款 / 人工确认）',
  PAYMENT_SOURCE_NOT_ADMIN_ALLOWED: '收款来源不被后端允许',
  PAYMENT_SOURCE_INVALID: '收款来源不被后端允许',
  PICKUP_CODE_UNAVAILABLE: '取件码生成失败，订单未入账，可稍后重试',
}

// M1：渠道展示。null = 存量单**无法可靠判定**（一体机与小程序建单写的字段相同），
// 必须显示「未标注」——不得按 terminalId 猜成一体机，那会污染统计。
function channelText(channel: string | null): string {
  if (channel === 'kiosk') return '一体机现场'
  if (channel === 'miniapp_cloud') return '小程序云打印'
  return '未标注'
}

// M2：取件状态展示。一体机现场即时出纸，**业务上不存在取件环节**，显示「—」而非「无数据」。
const PICKUP_LABELS: Record<string, string> = {
  pending: '待取件', claimed: '已亮码', used: '已取件',
  expired: '已过期', cancelled: '已取消',
}
function pickupText(order: { pickupStatus: string; channel: string | null }): string {
  if (order.pickupStatus === 'none') return '—'
  return PICKUP_LABELS[order.pickupStatus] ?? order.pickupStatus
}

function fmt(iso: string | null): string {
  return formatDateTime(iso)
}

function amountText(amountCents: number, currency: string): string {
  // 0 元 ≠ 未计费。系统里存在合法的 0 元单：会员权益抵扣、0 元活动、
  // paymentSource === 'free' 的免费单 —— 它们是「已定价为 0」，不是「还没定价」。
  // 此前 `<= 0` 一律兜成「未计费」，把两件事说成一件，运营无法判断这单是免费
  // 还是计费流程出了问题。负值才是真异常，单独如实标出而不是伪装成未计费。
  if (amountCents === 0) return '¥ 0.00（免费）'
  if (amountCents < 0) return `金额异常（${amountCents}）`
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

  // 退款对话框状态
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundReason, setRefundReason] = useState('')
  const [refundSubmitting, setRefundSubmitting] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

  // 线下 / 人工确认收款对话框状态（入口仅 payStatus==='unpaid' 可见；结论只认服务端返回）
  const [markPaidOpen, setMarkPaidOpen] = useState(false)
  const [markPaidSource, setMarkPaidSource] = useState<AdminOrderMarkPaidSource>('offline')
  const [markPaidSubmitting, setMarkPaidSubmitting] = useState(false)
  const [markPaidError, setMarkPaidError] = useState<string | null>(null)
  const [markPaidResult, setMarkPaidResult] = useState<AdminOrderMarkPaidResult | null>(null)

  // 废弃孤单对话框状态（仅 pending + claimedAt=null 任务可见）
  const [abandonConfirmOpen, setAbandonConfirmOpen] = useState(false)
  const [abandonSubmitting, setAbandonSubmitting] = useState(false)
  const [abandonError, setAbandonError] = useState<string | null>(null)
  const [verifyOpen, setVerifyOpen] = useState<'printed' | 'not_printed' | null>(null)
  const [verifyConfirm, setVerifyConfirm] = useState('')
  const [verifySubmitting, setVerifySubmitting] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
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
    // 收款结论只属于刚操作过的那一单，换单必须清掉，避免把上一单的入账结果显示在这一单上。
    setMarkPaidOpen(false)
    setMarkPaidSource('offline')
    setMarkPaidError(null)
    setMarkPaidResult(null)
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
    setRefundOpen(false)
    setRefundReason('')
    setRefundError(null)
    setMarkPaidOpen(false)
    setMarkPaidSource('offline')
    setMarkPaidError(null)
    setMarkPaidResult(null)
    setAbandonConfirmOpen(false)
    setAbandonError(null)
    setVerifyOpen(null)
    setVerifyConfirm('')
    setVerifyError(null)
  }

  const handleRefund = useCallback(async () => {
    if (!detail || !refundReason.trim()) return
    setRefundSubmitting(true)
    setRefundError(null)
    try {
      await adminOrdersReadonlyService.refundOrder(detail.id, refundReason.trim())
      setRefundOpen(false)
      setRefundReason('')
      void refresh()
      try {
        setDetail(await adminOrdersReadonlyService.getById(detail.id))
      } catch {
        /* 退款已受理；详情刷新失败不得显示成退款失败 */
      }
    } catch (err) {
      setRefundError(userMessageOf(err, '退款失败，请稍后重试'))
    } finally {
      setRefundSubmitting(false)
    }
  }, [detail, refundReason, refresh])

  const handleMarkPaid = useCallback(async () => {
    if (!detail) return
    setMarkPaidSubmitting(true)
    setMarkPaidError(null)
    setMarkPaidResult(null)
    try {
      // 入账结论完全取自服务端返回（payStatus / paymentSource / paidAt），前端不拼状态、不推断金额。
      const result = await adminOrdersReadonlyService.markPaidOrder(detail.id, markPaidSource)
      setMarkPaidResult(result)
      void refresh()
      const updated = await adminOrdersReadonlyService.getById(detail.id)
      setDetail(updated)
      setMarkPaidOpen(false)
    } catch (err) {
      const code = err instanceof ApiHttpError ? err.code : ''
      const hint = MARK_PAID_ERROR_TEXT[code]
      setMarkPaidError(hint ? `${hint}（${code}）` : code || '操作失败，请重试')
      // 失败常见于本地状态已过期（并发入账 / 退款），重拉一次服务端真值；
      // 重拉本身失败不覆盖上面的错误提示——收款失败必须留在页面上。
      try {
        setDetail(await adminOrdersReadonlyService.getById(detail.id))
      } catch { /* 保留原错误 */ }
    } finally {
      setMarkPaidSubmitting(false)
    }
  }, [detail, markPaidSource, refresh])

  const handleAbandon = useCallback(async () => {
    if (!detail?.printTaskId) return
    setAbandonSubmitting(true)
    setAbandonError(null)
    try {
      await adminPrintJobsService.abandonPending(detail.printTaskId)
      void refresh()
      const updated = await adminOrdersReadonlyService.getById(detail.id)
      setDetail(updated)
      setAbandonConfirmOpen(false)
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.message : '操作失败，请重试'
      setAbandonError(msg)
    } finally {
      setAbandonSubmitting(false)
    }
  }, [detail, refresh])

  const handleVerifyOutcome = useCallback(async () => {
    if (!detail?.printTaskId || !verifyOpen) return
    setVerifySubmitting(true)
    setVerifyError(null)
    try {
      await adminPrintJobsService.verifyOutcome(detail.printTaskId, {
        outcome: verifyOpen,
        confirm: verifyConfirm.trim(),
      })
      void refresh()
      const updated = await adminOrdersReadonlyService.getById(detail.id)
      setDetail(updated)
      setVerifyOpen(null)
      setVerifyConfirm('')
    } catch (err) {
      setVerifyError(err instanceof ApiHttpError ? err.message : '操作失败，请重试')
    } finally {
      setVerifySubmitting(false)
    }
  }, [detail, refresh, verifyConfirm, verifyOpen])

  return (
    <Page
      title="订单管理"
      subtitle={`打印 / 扫描订单 · 状态由 Terminal Agent 回报落库 · 共 ${total} 条`}
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
      {/* 说明横幅 */}
      <div className="mb-4 rounded-[9px] border border-info/20 bg-info-bg px-4 py-2.5 text-[13px] text-info-fg">
        展示真实订单与打印任务安全元数据。未支付订单可由管理员在线下实际收款后确认入账；已支付订单可由管理员发起全额退款，退款渠道由订单支付来源决定。
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
            <FilterChip
              active={statusFilter === 'failed' && payStatus === 'paid'}
              label="已支付失败待核查"
              onClick={() => { setStatusFilter('failed'); setPayStatus('paid'); setPage(1) }}
            />
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
                    {['订单号', '文件名', '用户', '渠道', '终端', '金额', '支付状态', '任务状态', '取件', '错误码', '创建时间'].map((h) => (
                      <th key={h} className={TH_CLS}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={11}>
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
                          className="cursor-pointer transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                          onClick={() => void openDetail(order.id)}
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openDetail(order.id) } }}
                          aria-label={`查看订单 ${order.orderNo}`}
                        >
                          <td className={`${TD_CLS} font-bold text-primary-700`}>{order.orderNo}</td>
                          <td className={`${TD_CLS} max-w-56 truncate font-semibold text-neutral-900`}>{order.printFileName ?? '未记录'}</td>
                          <td className={`${TD_CLS} text-xs text-neutral-500`}>{OWNER_LABELS[order.ownerType]} · {order.userLabel}</td>
                          <td className={`${TD_CLS} text-xs`}>{channelText(order.channel)}</td>
                          <td className={`${TD_CLS} font-mono text-xs text-neutral-500`}>{order.terminalCode ?? '—'}</td>
                          <td className={`${TD_CLS} tabular-nums text-neutral-700`}>{amountText(order.amountCents, order.currency)}</td>
                          <td className={TD_CLS}><StatusBadge dot status={pay.badge} label={pay.label} /></td>
                          <td className={TD_CLS}><StatusBadge dot status={taskStatus.badge} label={taskStatus.label} /></td>
                          <td className={`${TD_CLS} text-xs`}>{pickupText(order)}</td>
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
              {detail.refundedAt && (
                <Info label="退款时间" value={fmt(detail.refundedAt)} />
              )}
              {detail.refundReason && (
                <Info label="退款原因" value={detail.refundReason} />
              )}
            </div>

            {detail.aftercareStatus === 'manual_check_required' && (
              <div className="mt-4 rounded-[9px] border border-error/30 bg-error-bg px-4 py-3 text-[12.5px] leading-relaxed text-error-fg">
                <p className="font-extrabold">高风险：打印结果未确认</p>
                <p className="mt-1">
                  系统已禁止重新排队，避免重复出纸。请先核查现场出纸情况，再决定是否使用下方既有入口发起全额退款。
                </p>
                {detail.printTaskId && !verifyOpen && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setVerifyOpen('printed'); setVerifyConfirm(''); setVerifyError(null) }}
                      className="inline-flex h-9 items-center rounded-[9px] bg-neutral-800 px-4 text-[13px] font-bold text-white"
                    >
                      已核查·已出纸
                    </button>
                    <button
                      type="button"
                      onClick={() => { setVerifyOpen('not_printed'); setVerifyConfirm(''); setVerifyError(null) }}
                      className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700"
                    >
                      已核查·未出纸
                    </button>
                  </div>
                )}
                {verifyOpen && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs">
                      输入确认短语{' '}
                      <span className="font-mono font-semibold">
                        {verifyOpen === 'printed' ? 'VERIFY_PRINTED' : 'VERIFY_NOT_PRINTED'}
                      </span>
                    </p>
                    <input
                      value={verifyConfirm}
                      onChange={(e) => setVerifyConfirm(e.target.value)}
                      className="w-full rounded-[9px] border border-neutral-900/10 bg-surface px-3 py-2 text-[13px] text-neutral-900"
                    />
                    {verifyError && <p className="text-xs font-semibold text-error-fg">{verifyError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!verifyConfirm.trim() || verifySubmitting}
                        onClick={() => void handleVerifyOutcome()}
                        className="inline-flex h-9 items-center rounded-[9px] bg-neutral-800 px-4 text-[13px] font-bold text-white disabled:opacity-40"
                      >
                        {verifySubmitting ? '处理中…' : '确认核查'}
                      </button>
                      <button
                        type="button"
                        disabled={verifySubmitting}
                        onClick={() => { setVerifyOpen(null); setVerifyConfirm(''); setVerifyError(null) }}
                        className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 disabled:opacity-40"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {detail.printOutcome === 'printed' && (
              <div className="mt-4 rounded-[9px] border border-neutral-900/10 bg-neutral-50 px-4 py-3 text-[12.5px] text-neutral-700">
                已核查：现场确认已出纸。不可退款、不可重新排队。
              </div>
            )}
            {detail.printOutcome === 'not_printed' && (
              <div className="mt-4 rounded-[9px] border border-neutral-900/10 bg-neutral-50 px-4 py-3 text-[12.5px] text-neutral-700">
                已核查：现场确认未出纸。可走下方全额退款。不可重新排队。
              </div>
            )}

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

            {/* 废弃孤单操作区：仅 taskStatus===pending（未被 Agent 领取的历史孤单）显示 */}
            {detail.taskStatus === 'pending' && detail.printTaskId && (
              <div className="mt-6 rounded-[9px] border border-neutral-900/10 bg-neutral-50 px-4 py-3.5">
                {!abandonConfirmOpen ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-neutral-800">处置历史孤单</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        该任务尚未被 Terminal Agent 领取，可由管理员受控废弃。操作不可撤销。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setAbandonConfirmOpen(true); setAbandonError(null) }}
                      className="ml-4 inline-flex h-9 shrink-0 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-100"
                    >
                      废弃
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[13px] font-bold text-neutral-800">确认废弃此打印孤单？</p>
                    <p className="text-xs text-neutral-500">
                      打印任务将标记为 <span className="font-mono font-semibold text-neutral-700">abandoned</span>，写入审计日志，操作不可撤销。
                    </p>
                    {abandonError && (
                      <p className="text-xs font-semibold text-error-fg">{abandonError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={abandonSubmitting}
                        onClick={() => void handleAbandon()}
                        className="inline-flex h-9 items-center rounded-[9px] bg-neutral-800 px-4 text-[13px] font-bold text-white transition-colors hover:bg-neutral-700 disabled:opacity-40"
                      >
                        {abandonSubmitting ? '处理中…' : '确认废弃'}
                      </button>
                      <button
                        type="button"
                        disabled={abandonSubmitting}
                        onClick={() => { setAbandonConfirmOpen(false); setAbandonError(null) }}
                        className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/*
              收款入账结果：与下方入口**分开渲染**。入账成功后 payStatus 变为 paid、入口随即消失，
              若把结论放在入口内部，成功/失败提示会一起消失变成静默。
            */}
            {markPaidResult && (
              <div className="mt-6 rounded-[9px] border border-success/30 bg-success-bg px-4 py-3 text-[12.5px] leading-relaxed text-success-fg">
                <p className="font-extrabold">收款已入账（服务端确认）</p>
                <p className="mt-1">
                  支付状态 {PAY_STATUS_MAP[markPaidResult.payStatus]?.label ?? markPaidResult.payStatus}
                  {' · '}来源 {markPaidSourceLabel(markPaidResult.paymentSource)}
                  {' · '}入账时间 {fmt(markPaidResult.paidAt)}
                </p>
              </div>
            )}
            {markPaidError && (
              <div className="mt-6 rounded-[9px] border border-error/30 bg-error-bg px-4 py-3 text-[12.5px] leading-relaxed text-error-fg">
                <p className="font-extrabold">收款未入账</p>
                <p className="mt-1">{markPaidError}</p>
                <p className="mt-1">订单支付状态以上方「支付状态」为准；如现场已收钱，请核对后重试或人工处理。</p>
              </div>
            )}

            {/*
              线下 / 人工确认收款入口：对应 POST /admin/orders/:id/mark-paid（admin 角色）。
              后端只允许 unpaid → paid，因此入口只在服务端返回的 payStatus 为 unpaid 时出现；
              已支付 / 已退款 / 支付失败等状态下不渲染，避免给出后端必然拒绝的按钮。
            */}
            {detail.payStatus === 'unpaid' && (
              <div className="mt-6 rounded-[9px] border border-warning/30 bg-warning-bg px-4 py-3.5">
                {!markPaidOpen ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-neutral-800">确认线下收款</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        订单尚未入账。仅当线下已实际收到该笔款项时才可确认；确认后订单转为已支付并写入审计日志，不可撤销
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setMarkPaidOpen(true); setMarkPaidError(null); setMarkPaidResult(null) }}
                      className="ml-4 inline-flex h-9 shrink-0 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white transition-colors hover:bg-warning/90"
                    >
                      确认收款
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {/* 文案随所选来源变化：选了「人工确认（非现场现金）」却让管理员签署
                        「已收到现金」，是逼他为一件没发生的事背书。两种来源的事实不同，
                        确认语就必须不同。 */}
                    <p className="text-[13px] font-bold text-neutral-800">
                      {markPaidSource === 'manual_confirmed' ? '确认该笔款项已另行核实到账？' : '确认已在线下收到现金？'}
                    </p>
                    <p className="text-xs leading-relaxed text-neutral-600">
                      本单应收 <span className="font-bold text-neutral-900">{amountText(detail.amountCents, detail.currency)}</span>。
                      点击确认即表示
                      <span className="font-bold text-neutral-900">
                        {markPaidSource === 'manual_confirmed'
                          ? '你已通过其它渠道核实该笔款项确已到账'
                          : '现场已实际收到该笔现金'}
                      </span>
                      ，系统随即把订单支付状态置为已支付并写入审计日志。操作不可撤销，如需退回只能另行发起全额退款。
                    </p>
                    <fieldset className="space-y-1.5">
                      <legend className="text-xs font-bold text-neutral-700">收款方式</legend>
                      {MARK_PAID_SOURCES.map((source) => (
                        <label
                          key={source.value}
                          className="flex cursor-pointer items-start gap-2 rounded-[9px] border border-neutral-900/10 bg-surface px-3 py-2"
                        >
                          <input
                            type="radio"
                            name="mark-paid-source"
                            value={source.value}
                            checked={markPaidSource === source.value}
                            disabled={markPaidSubmitting}
                            onChange={() => setMarkPaidSource(source.value)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-[13px] font-bold text-neutral-800">{source.label}</span>
                            <span className="block text-xs text-neutral-500">{source.hint}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    {markPaidError && (
                      <p className="text-xs font-semibold text-error-fg">{markPaidError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={markPaidSubmitting}
                        onClick={() => void handleMarkPaid()}
                        className="inline-flex h-9 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white transition-colors hover:bg-warning/90 disabled:opacity-40"
                      >
                        {markPaidSubmitting
                          ? '处理中…'
                          : markPaidSource === 'manual_confirmed' ? '确认已核实到账' : '确认已收到现金'}
                      </button>
                      <button
                        type="button"
                        disabled={markPaidSubmitting}
                        onClick={() => { setMarkPaidOpen(false); setMarkPaidError(null) }}
                        className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Gate 0.3B 售后退款入口：资格由服务端只读派生，执行仍复用 canonical RefundService。 */}
            {detail.refundEligible && (
              <div className="mt-6 rounded-[9px] border border-warning/30 bg-warning-bg px-4 py-3.5">
                {!refundOpen ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-neutral-800">发起全额退款</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        退款 {amountText(detail.amountCents, detail.currency)}，操作不可撤销，仅 admin 可执行
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setRefundOpen(true); setRefundError(null) }}
                      className="ml-4 inline-flex h-9 shrink-0 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white transition-colors hover:bg-warning/90"
                    >
                      退款
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[13px] font-bold text-neutral-800">确认全额退款</p>
                    <textarea
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder="请填写退款原因（必填）"
                      rows={3}
                      maxLength={500}
                      className="w-full resize-none rounded-[9px] border border-neutral-900/10 bg-surface px-3 py-2 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-primary-600/50"
                    />
                    {refundError && (
                      <p className="text-xs font-semibold text-error-fg">{refundError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!refundReason.trim() || refundSubmitting}
                        onClick={() => void handleRefund()}
                        className="inline-flex h-9 items-center rounded-[9px] bg-error px-4 text-[13px] font-bold text-white transition-colors hover:bg-error/90 disabled:opacity-40"
                      >
                        {refundSubmitting ? '处理中…' : '确认退款'}
                      </button>
                      <button
                        type="button"
                        disabled={refundSubmitting}
                        onClick={() => { setRefundOpen(false); setRefundReason(''); setRefundError(null) }}
                        className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
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
