// ============================================================
// 我的打印订单 — /me/print-orders（本人，只读）。
// 展示安全元数据（文件名 / 状态 / 份数 / 彩黑 / 幅面 / 时间）
// + C5-1 订单支付安全字段（金额 / 支付状态 / 支付来源 / 计费页数 / 取件码）。
// 诚实口径（C5 P0b）：
// - 支付字段全部来自后端关联 Order；历史订单无 Order（payStatus 为 null）
//   显示「暂无支付信息」，不显示金额 0、不推断。
// - 支付来源只可能是 线下收款 / 免费 / 人工确认（无 live 网关）。
// - 取件码仅后端返回时展示，前端不做可见性推断。
// - 「再打一份」不从订单侧直连，详单内引导「去我的文档再打印」（新任务新订单）。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@ai-job-print/ui'
import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { ChevronDownIcon, Loader2Icon, MessageSquareIcon, PrinterIcon, TicketIcon } from 'lucide-react'
import { getMyPrintOrders } from '../../../services/api/memberPrintOrders'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import { OrderPaymentSummary } from './printOrders/OrderPaymentSummary'
import { formatAmountCents, PAY_STATUS_META, PAYMENT_SOURCE_LABEL } from './printOrders/paymentCopy'

const PAGE_SIZE = 20

const STATUS_META: Record<MemberPrintOrderItem['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-warning-bg text-warning-fg' },
  claimed: { label: '已接单', cls: 'bg-primary-50 text-primary-600' },
  printing: { label: '打印中', cls: 'bg-primary-50 text-primary-600' },
  completed: { label: '已完成', cls: 'bg-success-bg text-success-fg' },
  failed: { label: '失败', cls: 'bg-error-bg text-error-fg' },
  cancelled: { label: '已取消', cls: 'bg-neutral-100 text-neutral-500' },
}

/** 任务状态筛选（客户端过滤已加载数据；「进行中」= pending/claimed/printing）。 */
const STATUS_FILTERS = [
  { key: 'all', label: '全部', match: () => true },
  { key: 'active', label: '进行中', match: (s: MemberPrintOrderItem['status']) => s === 'pending' || s === 'claimed' || s === 'printing' },
  { key: 'completed', label: '已完成', match: (s: MemberPrintOrderItem['status']) => s === 'completed' },
  { key: 'failed', label: '失败', match: (s: MemberPrintOrderItem['status']) => s === 'failed' },
  { key: 'cancelled', label: '已取消', match: (s: MemberPrintOrderItem['status']) => s === 'cancelled' },
] as const

type FilterKey = (typeof STATUS_FILTERS)[number]['key']

function metaLine(item: MemberPrintOrderItem): string {
  const parts: string[] = []
  if (item.copies) parts.push(`${item.copies} 份`)
  if (item.colorMode) parts.push(item.colorMode === 'color' ? '彩色' : '黑白')
  if (item.paperSize) parts.push(item.paperSize)
  parts.push(formatTime(item.completedAt ?? item.createdAt))
  return parts.join(' · ')
}

/** 卡片上的支付概要一行：金额 · 支付状态（来源）；历史无 Order 显示「暂无支付信息」。 */
function paymentLine(item: MemberPrintOrderItem): string {
  if (item.payStatus == null) return '暂无支付信息'
  const parts: string[] = []
  if (typeof item.amountCents === 'number') parts.push(formatAmountCents(item.amountCents))
  const source = item.paymentSource ? `（${PAYMENT_SOURCE_LABEL[item.paymentSource]}）` : ''
  parts.push(`${PAY_STATUS_META[item.payStatus].label}${source}`)
  return parts.join(' · ')
}

export function MyPrintOrdersPage() {
  const { isLoggedIn, getToken } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<MemberPrintOrderItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<MeListState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [filterKey, setFilterKey] = useState<FilterKey>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    getMyPrintOrders(getToken(), { pageSize: PAGE_SIZE })
      .then((r) => {
        setItems(r.items)
        setNextCursor(r.nextCursor)
        setTotal(r.total)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    getMyPrintOrders(getToken(), { cursor: nextCursor, pageSize: PAGE_SIZE })
      .then((r) => {
        setItems((prev) => [...prev, ...r.items])
        setNextCursor(r.nextCursor)
        setTotal(r.total)
      })
      .catch(() => {
        /* 追加失败保持已加载列表不变，用户可再次点击重试 */
      })
      .finally(() => setLoadingMore(false))
  }, [nextCursor, loadingMore, getToken])

  const openFeedback = useCallback(
    (printTaskId: string) => {
      const params = new URLSearchParams({ category: 'print', relatedPrintTaskId: printTaskId })
      navigate(`/me/feedback?${params.toString()}`)
    },
    [navigate],
  )

  const filterCounts = useMemo(() => {
    const counts = {} as Record<FilterKey, number>
    for (const f of STATUS_FILTERS) counts[f.key] = items.filter((i) => f.match(i.status)).length
    return counts
  }, [items])

  const filtered = useMemo(() => {
    const f = STATUS_FILTERS.find((x) => x.key === filterKey) ?? STATUS_FILTERS[0]
    return items.filter((i) => f.match(i.status))
  }, [items, filterKey])

  return (
    <MeListShell
      title="打印订单"
      subtitle="本人打印任务与订单记录（仅本人可见）"
      loginFrom="/me/print-orders"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={() => setReloadKey((k) => k + 1)}
      isEmpty={items.length === 0}
      emptyIcon={PrinterIcon}
      emptyTitle="还没有打印订单"
      emptyDescription="完成一次打印后，这里会显示你的打印记录"
    >
      {/* 任务状态筛选（对已加载数据过滤，计数为已加载条数） */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilterKey(f.key)}
            aria-pressed={filterKey === f.key}
            className={[
              'flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-4 text-sm font-medium transition-colors',
              filterKey === f.key ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200',
            ].join(' ')}
          >
            {f.label}
            {filterCounts[f.key] > 0 && <span className="text-xs opacity-80">{filterCounts[f.key]}</span>}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card className="p-6 text-center text-sm text-neutral-500">当前筛选下暂无记录</Card>
      )}

      {filtered.map((item) => {
        const status = STATUS_META[item.status]
        const canCreateFeedback = item.status === 'completed' || item.status === 'failed'
        const expanded = expandedId === item.id
        return (
          <Card key={item.id} className="flex flex-col gap-3 p-4">
            <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning-bg">
                <PrinterIcon className="h-6 w-6 text-warning-fg" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">{item.fileName ?? '未命名文件'}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-400">{metaLine(item)}</p>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-neutral-500">
                  {paymentLine(item)}
                  {item.pickupCode && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                      <TicketIcon className="h-3 w-3" aria-hidden="true" />
                      取件码
                    </span>
                  )}
                </p>
              </div>
              <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
                {canCreateFeedback && (
                  <button
                    type="button"
                    onClick={() => openFeedback(item.id)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-warning/20 bg-surface px-3 text-xs font-semibold text-warning-fg transition-colors hover:bg-warning-bg focus:outline-none focus:ring-2 focus:ring-warning/30"
                    aria-label={`反馈打印订单 ${item.fileName ?? '未命名订单'}`}
                  >
                    <MessageSquareIcon className="h-4 w-4" aria-hidden="true" />
                    反馈
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? '收起' : '查看'}订单详单 ${item.fileName ?? '未命名订单'}`}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-neutral-200 bg-surface px-3 text-xs font-semibold text-neutral-600 transition-colors hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-300"
                >
                  详单
                  <ChevronDownIcon
                    className={['h-4 w-4 transition-transform', expanded ? 'rotate-180' : ''].join(' ')}
                    aria-hidden="true"
                  />
                </button>
                <span className={['shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', status.cls].join(' ')}>
                  {status.label}
                </span>
              </div>
            </div>
            {expanded && <OrderPaymentSummary item={item} />}
          </Card>
        )
      })}

      {nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 text-sm font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-60"
        >
          {loadingMore && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
          加载更多（已加载 {items.length} / 共 {total} 条）
        </button>
      )}

      <p className="mt-1 text-center text-xs text-neutral-400">
        仅展示本人打印任务与订单的安全信息，不含文件内容；金额与支付状态为真实订单数据
      </p>
    </MeListShell>
  )
}
