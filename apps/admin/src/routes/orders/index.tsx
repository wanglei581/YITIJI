import { useState } from 'react'
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { ConsoleTable } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import { RefreshCwIcon, SearchIcon } from 'lucide-react'
import { adminOrdersReadonlyService, type AdminOrderReadonlyItem } from '../../services/api/adminOrdersReadonly'
import { STATUS_FILTERS, PAY_FILTERS } from './orderDisplay'
import { orderColumns } from './orderColumns'
import { useOrderDetail } from './useOrderDetail'
import { OrderDetailDrawer } from './OrderDetailDrawer'

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState('')
  const [payStatus, setPayStatus] = useState('')
  const [refundRequiredFilter, setRefundRequiredFilter] = useState(false)
  const [opsAttentionFilter, setOpsAttentionFilter] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const ordersKey = `admin:orders:${statusFilter}:${payStatus}:${refundRequiredFilter}:${opsAttentionFilter}:${search}:${page}:${pageSize}`

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
      refundRequired: refundRequiredFilter || undefined,
      opsAttention: opsAttentionFilter || undefined,
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

  const controls = useOrderDetail(refresh)
  const { detailState } = controls
  useInteractionLock(detailState === 'loading' || detailState === 'ready', [ordersKey], 'hard')

  const items = orderPage?.items ?? []
  const total = orderPage?.pagination.total ?? 0
  const state: 'loading' | 'error' | 'ready' =
    status === 'error' && !orderPage ? 'error' :
    status === 'loading' && !orderPage ? 'loading' :
    orderPage ? 'ready' : 'loading'

  return (
    <Page
      title="订单管理"
      subtitle={`打印 / 扫描订单 · 状态随终端上报自动更新 · 共 ${total} 条`}
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
        展示真实订单与打印任务安全信息。未支付订单可由管理员在线下实际收款后确认入账；已支付订单可由管理员发起全额退款，退款渠道由订单支付来源决定。
      </div>

      <section className="overflow-hidden rounded-lg border border-neutral-900/[0.06] bg-surface shadow-sm">
        <div className="px-5 pt-[18px]">
          {/* 工具条：搜索 + 任务状态 chips */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
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
                onClick={() => { setStatusFilter(f.value); setRefundRequiredFilter(false); setOpsAttentionFilter(false); setPage(1) }}
              />
            ))}
          </div>
          {/* 支付状态 chips */}
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            {PAY_FILTERS.map((f) => (
              <FilterChip
                key={f.label}
                active={payStatus === f.value}
                label={f.label}
                onClick={() => { setPayStatus(f.value); setRefundRequiredFilter(false); setOpsAttentionFilter(false); setPage(1) }}
              />
            ))}
            <FilterChip
              active={statusFilter === 'failed' && payStatus === 'paid' && !refundRequiredFilter && !opsAttentionFilter}
              label="已支付失败待核查"
              onClick={() => { setStatusFilter('failed'); setPayStatus('paid'); setRefundRequiredFilter(false); setOpsAttentionFilter(false); setPage(1) }}
            />
            {/*
              待退款覆盖**两类**信号单（服务端 refundRequired 的 OR 两支）：
                ① 已付款未出纸       payStatus=paid    + PAID_UNFULFILLED_PENDING_REFUND
                ② 渠道已收款未转 paid payStatus∈{closed,unpaid,paying} + ONLINE_PAID_PENDING_REFUND
              ② 永远不是 paid。旧写法这里钉死 setPayStatus('paid')，后端收到
              refundRequired=true + payStatus=paid 后只查 ①，于是「渠道已经收了钱、
              却没有出款路径」的那一类整体被挡在筛选之外 —— 页面不报错，只是查不到。
              所以这里必须**清空** payStatus，让后端走 OR 两支。
            */}
            <FilterChip
              active={refundRequiredFilter}
              label="待退款（已收款未出纸）"
              onClick={() => { setRefundRequiredFilter(true); setOpsAttentionFilter(false); setPayStatus(''); setStatusFilter(''); setPage(1) }}
            />
            {/*
              需运营关注 = 服务端 opsAttention 的**三支 OR**：待退款、退款中、
              渠道已受理但本地确认未落地。后两支在本页此前完全没有入口。

              与上面那条同一个坑，必须再说一遍：这里**不能**顺手补 payStatus。
              `channel_accepted_unconfirmed` 的 payStatus 是 paying / closed ——
              渠道收了钱、本地没转成已支付。钉任何 payStatus 都会把这一类
              整体挡在筛选外，而页面不会报错，只是查不到；那正是最该被看见的一类。
            */}
            <FilterChip
              active={opsAttentionFilter}
              label="需运营关注"
              onClick={() => { setOpsAttentionFilter(true); setRefundRequiredFilter(false); setPayStatus(''); setStatusFilter(''); setPage(1) }}
            />
          </div>
        </div>

        <ConsoleTable items={items} columns={orderColumns(controls.openDetail)}
          loading={state === 'loading'} error={state === 'error' ? { onRetry: () => void refresh() } : null}
          empty={{ title: '暂无订单', description: '一体机创建打印订单后会出现在这里' }}
          page={page} pageSize={pageSize} total={total} onPageChange={setPage}
          className="[&_table]:table-fixed [&_th]:px-2 [&_td]:px-2 [&_td]:text-xs"
        />
      </section>

      <OrderDetailDrawer controls={controls} />
    </Page>
  )
}
