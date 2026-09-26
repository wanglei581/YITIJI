// ============================================================
// 我的打印订单 — /me/print-orders（本人，只读）。视觉真值：稿 38-member-assets（青序流光）。
// 展示安全元数据（文件名 / 状态 / 份数 / 彩黑 / 幅面 / 时间）
// + C5-1 订单支付安全字段（金额 / 支付状态 / 支付来源 / 计费页数 / 取件码）
// + API-20 待退款信号（refundRequired，由服务端派生）。
// 诚实口径（C5 P0b）：
// - 支付字段全部来自后端关联 Order；历史订单无 Order（payStatus 为 null）
//   显示「暂无支付信息」，不显示金额 0、不推断。
// - 支付来源只可能是 线下收款 / 免费 / 人工确认（无 live 网关）。
// - 取件码仅后端返回时展示，前端不做可见性推断。
// - 「再打一份」不从订单侧直连，详单内引导「去我的文档再打印」（新任务新订单）。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { ChevronDownIcon, FilesIcon, Loader2Icon, MessageSquareIcon, PrinterIcon, ReceiptIcon, TicketIcon } from 'lucide-react'
import { getMyPrintOrders } from '../../../services/api/memberPrintOrders'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { QxMeGuide, QxMePage, QxMeSummary, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock, QxMeStartRow, QxMeStructRow } from './qx/QxMeStateBits'
import { OrderPaymentSummary } from './printOrders/OrderPaymentSummary'
import {
  duplexShortLabel,
  formatAmountCents,
  memberPayStatusLabel,
  paymentSourceLabel,
  PENDING_REFUND_LABEL,
} from './printOrders/paymentCopy'
import {
  MEMBER_ORDERS_POLL_MS,
  hasActivePrintOrders,
  isActivePrintStatus,
  mergePrintOrderRefresh,
  nextPrintOrdersPollDelay,
} from './printOrders/statusRefresh'
import './styles/member-records-qx.css'

const PAGE_SIZE = 20
const MAX_REFRESH_PAGE_SIZE = 50

type LoadState = 'loading' | 'error' | 'ready'

/** tone 对应 .qx-me-st 的 data-tone：wait 排队 / run 处理中 / bad 失败 / off 已结束；缺省为完成青。 */
const STATUS_META: Record<MemberPrintOrderItem['status'], { label: string; tone?: 'wait' | 'run' | 'bad' | 'off' }> = {
  pending: { label: '排队中', tone: 'wait' },
  claimed: { label: '已领取', tone: 'run' },
  printing: { label: '打印中', tone: 'run' },
  completed: { label: '已完成' },
  failed: { label: '失败', tone: 'bad' },
  cancelled: { label: '已取消', tone: 'off' },
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
  const duplex = duplexShortLabel(item.duplex)
  if (duplex) parts.push(duplex)
  if (item.paperSize) parts.push(item.paperSize)
  parts.push(formatTime(item.completedAt ?? item.createdAt))
  return parts.join(' · ')
}

/** 卡片上的支付概要一行：金额 · 支付状态（来源）；历史无 Order 显示「暂无支付信息」。 */
function paymentLine(item: MemberPrintOrderItem): string {
  if (item.payStatus == null) return '暂无支付信息'
  const parts: string[] = []
  if (typeof item.amountCents === 'number') parts.push(formatAmountCents(item.amountCents))
  const sourceLabel = item.paymentSource ? paymentSourceLabel(item.paymentSource) : undefined
  const source = sourceLabel ? `（${sourceLabel}）` : ''
  parts.push(`${memberPayStatusLabel(item).label}${source}`)
  return parts.join(' · ')
}

export function MyPrintOrdersPage() {
  const { isLoggedIn, getToken } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<MemberPrintOrderItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<LoadState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [autoRefreshFailed, setAutoRefreshFailed] = useState(false)
  const [autoRefreshChecking, setAutoRefreshChecking] = useState(false)
  const [autoRefreshSyncedAt, setAutoRefreshSyncedAt] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [filterKey, setFilterKey] = useState<FilterKey>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const itemsRef = useRef(items)
  const loadingMoreRef = useRef(loadingMore)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    setLoadMoreError(false)
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
    setLoadMoreError(false)
    getMyPrintOrders(getToken(), { cursor: nextCursor, pageSize: PAGE_SIZE })
      .then((r) => {
        setItems((prev) => [...prev, ...r.items])
        setNextCursor(r.nextCursor)
        setTotal(r.total)
      })
      .catch(() => {
        // 追加失败保持已加载列表不变；显示内联错误提示，用户可再次点击重试。
        setLoadMoreError(true)
      })
      .finally(() => setLoadingMore(false))
  }, [nextCursor, loadingMore, getToken])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    loadingMoreRef.current = loadingMore
  }, [loadingMore])

  const activeOrderCount = useMemo(
    () => items.slice(0, MAX_REFRESH_PAGE_SIZE).filter((item) => isActivePrintStatus(item.status)).length,
    [items],
  )

  useEffect(() => {
    if (!isLoggedIn || activeOrderCount === 0 || typeof document === 'undefined') return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let delay = MEMBER_ORDERS_POLL_MS
    let inFlight = false

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const schedule = (ms: number) => {
      clearTimer()
      timer = setTimeout(() => void tick(), ms)
    }

    const tick = async () => {
      if (cancelled || inFlight) return
      if (document.visibilityState !== 'visible' || loadingMoreRef.current) {
        schedule(delay)
        return
      }

      inFlight = true
      setAutoRefreshChecking(true)
      try {
        const refreshPageSize = Math.min(MAX_REFRESH_PAGE_SIZE, Math.max(PAGE_SIZE, itemsRef.current.length))
        const r = await getMyPrintOrders(getToken(), { pageSize: refreshPageSize })
        if (cancelled) return
        setItems((prev) => mergePrintOrderRefresh(prev, r.items))
        setTotal(r.total)
        setAutoRefreshFailed(false)
        setAutoRefreshSyncedAt(new Date().toISOString())
        delay = MEMBER_ORDERS_POLL_MS
      } catch {
        if (cancelled) return
        setAutoRefreshFailed(true)
        delay = nextPrintOrdersPollDelay(delay)
      } finally {
        inFlight = false
        if (!cancelled) {
          setAutoRefreshChecking(false)
          schedule(delay)
        }
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      clearTimer()
      void tick()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    schedule(MEMBER_ORDERS_POLL_MS)

    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activeOrderCount, getToken, isLoggedIn])

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

  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 ? 'empty' : 'ready'
  const summary = (
    <QxMeSummary
      tone="clay"
      icon={<PrinterIcon size={32} />}
      label="打印记录"
      big={total}
      desc="只展示本人打印任务与订单安全信息；支付状态和金额以真实订单数据为准"
      minis={[`已加载 ${items.length}`, `进行中 ${activeOrderCount}`, `筛选 ${filtered.length}`]}
    />
  )
  const structMode = !isLoggedIn ? 'lock' : 'error'
  const struct = (
    <>
      <QxMeStructRow icon={PrinterIcon} title="打印内容与参数" desc="文件名、份数、彩色/黑白、单双面与幅面" mode={structMode} testid="member-assets-struct-orders-0" />
      <QxMeStructRow icon={ReceiptIcon} title="支付状态与金额" desc="只显示订单真实记录；历史订单没有支付记录时如实说明" mode={structMode} testid="member-assets-struct-orders-1" />
      <QxMeStructRow icon={TicketIcon} title="处理进度与取件码" desc="取件码只在服务端返回时显示" mode={structMode} testid="member-assets-struct-orders-2" />
    </>
  )

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看打印订单" desc="公共一体机不会在未登录时展示文件名、订单金额或取件码；游客打印不会自动归入你的账号。" struct={struct} onJobs={() => navigate('/jobs')} onPrint={() => navigate('/print-scan')} />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载打印订单" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock title="打印订单这次没有加载出来" desc="当前列表没有更新。请检查网络后重试；已建立的订单不会因为这次失败而消失。" struct={struct} />
  } else if (items.length === 0) {
    body = (
      <>
        {summary}
        <section className="qx-me-banner" data-testid="qx-me-fallback" data-kind="empty">
          <span className="qx-me-banner-ico" aria-hidden="true"><PrinterIcon size={34} /></span>
          <span className="qx-me-banner-main">
            <h2 className="qx-me-banner-t">还没有打印订单</h2>
            <span className="qx-me-banner-p">完成一次打印后，这里会显示你的打印记录。<b>空就是空</b>，本页不会造几条记录让页面好看。</span>
          </span>
          <span className="qx-me-banner-mini"><i>共 0</i></span>
        </section>
        <section className="qx-me-list qx-me-grow" aria-label="从这里开始打印">
          <QxMeStartRow icon={PrinterIcon} tone="wheat" title="发起一次打印" desc="选文件、定参数、确认价格后建立订单" label="去打印" route="/print-scan" testid="member-assets-start-print" onClick={() => navigate('/print-scan')} />
          <QxMeStartRow icon={FilesIcon} tone="slate" title="先从我的文档选文件" desc="已保存的文件可以直接拿来打印，会新建一笔订单" label="去文档" route="/me/documents" testid="member-assets-start-docs" onClick={() => navigate('/me/documents')} />
          <div className="qx-me-legal">确认打印并建单后，可以回到这里查看处理进度与结果。</div>
        </section>
        <QxMeGuide items={[['怎么产生', '确认打印并建单后', '订单在确认打印后建立'], ['能看到什么', '处理进度与支付记录', '状态一律由服务端返回'], ['再打印', '会新建订单', '重新核价后建立一笔新订单']]} />
      </>
    )
  } else {
    body = (
      <>
        {summary}
        {/* 任务状态筛选（对已加载数据过滤，计数为已加载条数） */}
        <div className="qx-me-tabbar" data-n={STATUS_FILTERS.length} role="group" aria-label="按任务状态筛选">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilterKey(f.key)} aria-pressed={filterKey === f.key} className="qx-me-tab">
              {f.label}
              {filterCounts[f.key] > 0 && <i>{filterCounts[f.key]}</i>}
            </button>
          ))}
        </div>

        {hasActivePrintOrders(items) && (
          <div className="qx-me-legal qx-me-asset-refresh">
            {autoRefreshChecking ? (
              <Loader2Icon size={20} className="animate-spin" aria-hidden="true" />
            ) : (
              <span className="qx-me-asset-live" aria-hidden="true" />
            )}
            {autoRefreshFailed ? (
              <span role="status" aria-live="polite">
                自动刷新失败，稍后自动重试；当前列表已保留
              </span>
            ) : (
              <span>
                {autoRefreshChecking
                  ? '正在同步进行中任务…'
                  : autoRefreshSyncedAt
                    ? `进行中任务自动更新中，上次同步 ${formatTime(autoRefreshSyncedAt)}`
                    : '进行中任务每 5 秒自动更新'}
              </span>
            )}
          </div>
        )}

        <section className="qx-me-list qx-me-grow" data-testid="member-assets-list" aria-label="我的打印订单">
          {filtered.length === 0 && (
            <div className="qx-me-legal">
              {filterKey !== 'all' && nextCursor ? '已加载记录中暂无此类，点「加载更多」继续查找' : '当前筛选下暂无记录'}
            </div>
          )}

          {filtered.map((item) => {
            const status = STATUS_META[item.status]
            const canCreateFeedback = item.status === 'completed' || item.status === 'failed'
            const expanded = expandedId === item.id
            return (
              <article key={item.id} className="qx-me-asset-item" data-server-slot="print-order" data-order-status={item.status} data-testid="member-assets-order">
                <div className="qx-me-asset-main">
                  <span className="qx-me-row-ico" data-tone="clay" aria-hidden="true"><PrinterIcon size={28} /></span>
                  <div className="qx-me-row-main">
                    <div className="qx-me-row-head">
                      <p className="qx-me-row-title qx-me-asset-name">{item.fileName ?? '未命名文件'}</p>
                      <span className="qx-me-st" data-tone={status.tone}>{status.label}</span>
                    </div>
                    <p className="qx-me-row-sub">{metaLine(item)}</p>
                    <div className="qx-me-row-foot">
                      <span className="qx-me-chip">{paymentLine(item)}</span>
                      {item.refundRequired === true && <span className="qx-me-chip" data-tone="warn">{PENDING_REFUND_LABEL}</span>}
                      {item.pickupCode && (
                        <span className="qx-me-chip" data-tone="ok">
                          <TicketIcon size={16} aria-hidden="true" />
                          取件码
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="qx-me-acts">
                    {canCreateFeedback && (
                      <button type="button" onClick={() => openFeedback(item.id)} className="qx-me-small" aria-label={`反馈打印订单 ${item.fileName ?? '未命名订单'}`}>
                        <MessageSquareIcon size={19} aria-hidden="true" />
                        反馈
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? '收起' : '查看'}订单详单 ${item.fileName ?? '未命名订单'}`}
                      className="qx-me-small"
                    >
                      详单
                      <ChevronDownIcon size={19} className={expanded ? 'rotate-180' : undefined} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {expanded && <OrderPaymentSummary item={item} />}
              </article>
            )
          })}

          {nextCursor && (
            <div className="qx-me-asset-more">
              <button type="button" onClick={loadMore} disabled={loadingMore} className="qx-me-small">
                {loadingMore && <Loader2Icon size={19} className="animate-spin" aria-hidden="true" />}
                加载更多（已加载 {items.length} / 共 {total} 条）
              </button>
              {loadMoreError && (
                <p className="qx-me-reason" data-tone="bad" role="alert">
                  加载失败，请点「加载更多」重试
                </p>
              )}
            </div>
          )}

          <div className="qx-me-legal">
            仅展示本人打印任务与订单的安全信息，不含文件内容；金额与支付状态为真实订单数据。再次打印会重新选择文件、确认参数与价格，并<b>建立一笔新订单</b>。
          </div>
        </section>
      </>
    )
  }

  const ctabar = recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/print-orders', uiState === 'empty' ? '发起打印' : '发起新打印', () => navigate('/print-scan'))

  return (
    <QxMePage
      title="打印订单"
      view="orders"
      screen="member-list"
      screenState={`orders-${uiState}`}
      eyebrow="MY FILES & ORDERS"
      ask={<>打印到哪一步，<em>一眼看清</em>。</>}
      doing={DOING[uiState]}
      truth="这里只显示当前登录账号的打印订单；状态、金额与取件码一律由服务端返回。"
      ctabar={ctabar}
      live={false}
    >
      {body}
    </QxMePage>
  )
}

const DOING: Record<'login' | 'loading' | 'error' | 'empty' | 'ready', ReactNode> = {
  login: <>登录后才会显示你的订单；<b>未登录不展示任何订单或取件码</b>。</>,
  loading: <>正在读取最新记录，<b>返回前一律显示「—」</b>。</>,
  error: <>列表这次没有更新，<b>重试不会重复创建订单</b>。</>,
  empty: <>还没有打印订单。<b>确认打印并建单后</b>，可以从这里查看进度。</>,
  ready: <>进行中的订单会自动同步，<b>完成后仍可查看详单</b>。</>,
}
