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
import { getMyPrintOrders } from '../../../services/api/memberPrintOrders'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { whenMiniapp } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { QxMePage, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock } from './qx/QxMeStateBits'
import { MeActs, MeBtn, MeP, MeRow, MeRows, MeSeg } from '../touch/MeKit'
import { MeEmptyPack, MeExitCard } from '../touch/MeStatePacks'
import { OrderPaymentSummary } from './printOrders/OrderPaymentSummary'
import {
  formatAmountCents,
  isFreeMemberOrder,
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

const STATUS_LABEL: Record<MemberPrintOrderItem['status'], string> = {
  pending: '排队中',
  claimed: '已领取',
  printing: '打印中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
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

/** 卡片上的支付概要一行。历史无 Order 显示「暂无支付信息」。
 *  0 元或免费来源不写「已支付」：待退款仍优先，其余只写免费。收费单保持金额 · 支付状态（来源）。
 */
function paymentLine(item: MemberPrintOrderItem): string {
  if (item.payStatus == null) return '暂无支付信息'
  if (item.amountCents === 0 || item.paymentSource === 'free') {
    if (item.refundRequired === true) return `0 元（免费试运营） · ${PENDING_REFUND_LABEL}`
    return '0 元（免费试运营） · 免费'
  }
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

  const filtered = useMemo(() => {
    const f = STATUS_FILTERS.find((x) => x.key === filterKey) ?? STATUS_FILTERS[0]
    return items.filter((i) => f.match(i.status))
  }, [items, filterKey])

  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 ? 'empty' : 'ready'
  const miniOn = whenMiniapp(useSupportContact(isLoggedIn), 'on') !== ''
  const allLoadedFree = items.length > 0 && items.every(isFreeMemberOrder)

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看打印订单" />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载打印订单" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock onRetry={() => setReloadKey((k) => k + 1)} />
  } else if (items.length === 0) {
    body = (
      <div className="me-state" data-testid="qx-me-fallback">
        <MeEmptyPack sentence="还没有打印订单。没登录时在这台机器上打的单不会进这个账号。">
          <MeExitCard art="usb" artWidth={120} title="去打印" desc="U 盘、手机或扫描都可以" onClick={() => navigate('/print-scan')} />
          {miniOn
            ? <MeExitCard art="phone" artWidth={96} title="输到机码取件" desc="手机上下的到店单，到机器上输入到机码" onClick={() => navigate('/print/pickup-claim')} />
            : <MeExitCard art="stack" artWidth={120} title="看看我的文档" desc="选一份已保存的文件再打" onClick={() => navigate('/me/documents')} />}
        </MeEmptyPack>
      </div>
    )
  } else {
    const syncNote = autoRefreshChecking
        ? '正在同步进行中的订单…'
        : autoRefreshSyncedAt
          ? `进行中的订单会自动刷新，上次同步 ${formatTime(autoRefreshSyncedAt)}。没登录时在这台机器上打的单不会进这个账号。`
          : '进行中的订单会自动刷新。没登录时在这台机器上打的单不会进这个账号。'
    body = (
      <>
        {miniOn ? (
          <button type="button" className="me-line" onClick={() => navigate('/print/pickup-claim')}>
            <b>手机上下的到店单，到机器上输到机码取件</b>
            <small>还没核销出打印任务的单，不在下面的列表里</small>
          </button>
        ) : null}
        {/* 任务状态筛选（对已加载数据过滤） */}
        <MeSeg
          mode="pressed"
          label="按任务状态筛选"
          current={filterKey}
          items={STATUS_FILTERS.map((f) => ({ id: f.key, label: f.label }))}
          onPick={(id) => setFilterKey(id as FilterKey)}
        />

        {filtered.length === 0 ? (
          <div className="me-state">
            <MeP>{filterKey !== 'all' && nextCursor ? '已加载记录中暂无此类，点「加载更多」继续查找。' : '这个筛选下没有订单。'}</MeP>
            <div className="me-stack">
              <MeExitCard art="checklist" artWidth={120} title="查看全部" desc="全部订单都在「全部」里" onClick={() => setFilterKey('all')} />
              <MeExitCard art="usb" artWidth={120} title="去打印" desc="打一份新的，会新建一张打印任务" onClick={() => navigate('/print-scan')} />
            </div>
          </div>
        ) : (
          <MeRows few={filtered.length < 7 && expandedId === null} testId="member-assets-list" label="我的打印订单">
            {filtered.map((item) => {
              const canCreateFeedback = item.status === 'completed' || item.status === 'failed'
              const expanded = expandedId === item.id
              const name = item.fileName ?? '未命名订单'
              const pay = paymentLine(item)
              const refund = item.refundRequired === true && !pay.includes(PENDING_REFUND_LABEL) ? ` · ${PENDING_REFUND_LABEL}` : ''
              return (
                <MeRow
                  key={item.id}
                  data-testid="member-assets-order"
                  data-server-slot="print-order"
                  data-order-status={item.status}
                  open={expanded}
                  onToggle={() => setExpandedId(expanded ? null : item.id)}
                  toggleLabel={`${expanded ? '收起' : '查看'}订单详单 ${name}`}
                  title={<span className="qx-me-asset-name">{item.fileName ?? '未命名文件'}</span>}
                  lines={[<>{STATUS_LABEL[item.status]} · {formatTime(item.completedAt ?? item.createdAt)} · {pay}{refund}{item.pickupCode && ' · 到机码'}</>]}
                  actions={(
                    <>
                      <OrderPaymentSummary item={item} />
                      {canCreateFeedback ? (
                        <MeActs>
                          <MeBtn v="sec" onClick={() => openFeedback(item.id)} aria-label={`反馈打印订单 ${name}`}>反馈问题</MeBtn>
                        </MeActs>
                      ) : null}
                    </>
                  )}
                />
              )
            })}
          </MeRows>
        )}

        {nextCursor && (
          <div className="me-more">
            {loadMoreError && (
              <p className="me-reason" role="alert">
                加载失败，请点「加载更多」重试
              </p>
            )}
            <MeBtn v="sec" className="me-wide" onClick={loadMore} disabled={loadingMore} aria-label={`加载更多（已加载 ${items.length} / 共 ${total} 条）`}>
              {loadingMore ? '正在加载更多…' : '加载更多'}
            </MeBtn>
          </div>
        )}

        {hasActivePrintOrders(items) ? (
          <QxTouchCallout kind="remind" icon="alert">
            {autoRefreshFailed ? (
              <span role="status" aria-live="polite">刚才这次刷新没成功，过一会儿会再试。没登录时在这台机器上打的单不会进这个账号。</span>
            ) : (
              <span>{syncNote}</span>
            )}
          </QxTouchCallout>
        ) : null}

        {filtered.length > 0 && filtered.length < 7 && expandedId === null ? (
          <div className="me-stack">
            <MeExitCard art="usb" artWidth={110} title="去打印" desc="打一份新的，会新建一张打印任务" onClick={() => navigate('/print-scan')} />
            <MeExitCard art="stack" artWidth={110} title="去我的文档" desc="从已保存的文件里再选一份" onClick={() => navigate('/me/documents')} />
          </div>
        ) : null}
      </>
    )
  }

  const ctabar = recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/print-orders', '去打印', () => navigate('/print-scan'))

  return (
    <QxMePage
      title="打印订单"
      view="orders"
      screen="member-list"
      screenState={`orders-${uiState}`}
      eyebrow="我的 · 打印订单"
      sub={items.length > 0 ? `共 ${total} 条已产生打印任务的单` : uiState === 'empty' ? '还没有归入账号的打印任务' : undefined}
      fine={allLoadedFree ? '只显示当前登录账号的打印订单；状态与到机码一律由系统返回。' : undefined}
      ctabar={ctabar}
      live={false}
    >
      {body}
    </QxMePage>
  )
}
