import { useKioskLicense } from '../../../layouts/KioskLicenseContext'
import { LICENSE_NO_NEW_TASK_REASON } from '../../../copy/unattendedCopy'
import { LicenseLock } from '../../../layouts/LicenseLock'
// ============================================================
// 我的订单 / 打印订单 — /me/print-orders（本人，只读）。
// 免费机且无收费/服务单时保持「打印订单」原口径；收费机或存在服务单/实付打印单时升级为
// 「我的订单」并混排 AI/扫描服务单与「开发票」入口（对照 pay-1113.js:516-537）。
// ============================================================

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberPrintOrderItem, MemberServiceOrderItem } from '@ai-job-print/shared'
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
import { PendingPickupSection, usePendingPickupOrders } from './printOrders/PendingPickupSection'
import { mobilePickupBanner, pendingPickupExitCards } from './printOrders/pendingPickupExits'
import {
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
import {
  PrintOrderInvoiceAction,
  ServiceOrderRow,
  ServiceOrdersMoreAction,
} from './orders/ServiceOrderRow'
import {
  canShowPrintOrderInvoiceButton,
  effectivePrintPayableCents,
  formatOrderYuan,
  hasChargedPrintOrder,
  invoiceDetailPath,
  matchesServiceOrderFilter,
  mergeOrdersNewestFirst,
  printOrderInvoiceHint,
} from './orders/orderInvoiceCopy'
import { useMemberServiceOrders } from './orders/useMemberServiceOrders'
import './styles/member-records-qx.css'
import './orders/order-invoice.css'

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

/** 任务状态筛选（客户端过滤已加载数据；「进行中」= pending/claimed/printing 与退款处理中服务单）。 */
const STATUS_FILTERS = [
  { key: 'all', label: '全部', match: () => true },
  { key: 'active', label: '进行中', match: (s: MemberPrintOrderItem['status']) => s === 'pending' || s === 'claimed' || s === 'printing' },
  { key: 'completed', label: '已完成', match: (s: MemberPrintOrderItem['status']) => s === 'completed' },
  { key: 'failed', label: '失败', match: (s: MemberPrintOrderItem['status']) => s === 'failed' },
  { key: 'cancelled', label: '已取消', match: (s: MemberPrintOrderItem['status']) => s === 'cancelled' },
] as const

type FilterKey = (typeof STATUS_FILTERS)[number]['key']

export function MyPrintOrdersPage() {
  const { isLoggedIn, user, getToken } = useAuth()
  const endUserId = user?.id ?? null
  const navigate = useNavigate()
  const winding = useKioskLicense().mode === 'winding-down'
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

  const svc = useMemberServiceOrders(isLoggedIn, getToken, reloadKey, endUserId)

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

  const openServiceInvoice = useCallback((item: MemberServiceOrderItem) => {
    navigate(invoiceDetailPath('service', item.id), { state: { amountCents: item.amountCents, serviceName: item.serviceName } })
  }, [navigate])

  const openPrintInvoice = useCallback((item: MemberPrintOrderItem) => {
    if (!item.orderId) return
    const payable = effectivePrintPayableCents(item)
    navigate(invoiceDetailPath('print', item.orderId), {
      state: { amountCents: payable ?? undefined, serviceName: item.fileName ?? '打印订单' },
    })
  }, [navigate])

  const ordersMode = useMemo(
    () => isLoggedIn && (svc.hasAnyPositivePrice || svc.serviceOrders.length > 0 || hasChargedPrintOrder(items)),
    [isLoggedIn, svc.hasAnyPositivePrice, svc.serviceOrders.length, items],
  )

  /** 卡片上的支付概要一行：历史无 Order 写「暂无支付信息」；收费单优先用后端实付真源 payableAmountCents，缺省回退下单金额，绝不前端减算。 */
  const paymentLine = useCallback((item: MemberPrintOrderItem): string => {
    if (item.payStatus == null) return '暂无支付信息'
    if (item.amountCents === 0 || item.paymentSource === 'free') {
      if (ordersMode) return item.refundRequired === true ? PENDING_REFUND_LABEL : '免费'
      if (item.refundRequired === true) return `0 元（免费试运营） · ${PENDING_REFUND_LABEL}`
      return '0 元（免费试运营） · 免费'
    }
    const parts: string[] = []
    const displayCents = effectivePrintPayableCents(item) ?? (typeof item.amountCents === 'number' ? item.amountCents : null)
    if (displayCents !== null) parts.push(formatOrderYuan(displayCents))
    const sourceLabel = item.paymentSource ? paymentSourceLabel(item.paymentSource) : undefined
    const source = sourceLabel ? `（${sourceLabel}）` : ''
    parts.push(`${memberPayStatusLabel(item).label}${source}`)
    return parts.join(' · ')
  }, [ordersMode])

  const mergedEntries = useMemo(() => {
    const f = STATUS_FILTERS.find((x) => x.key === filterKey) ?? STATUS_FILTERS[0]
    const filteredPrint = items.filter((i) => f.match(i.status))
    const filteredService = svc.serviceOrders.filter((s) => matchesServiceOrderFilter(s.status, filterKey))
    return mergeOrdersNewestFirst(filteredPrint, filteredService)
  }, [items, svc.serviceOrders, filterKey])

  const hasAnyOrders = items.length > 0 || svc.serviceOrders.length > 0
  const pendingPickup = usePendingPickupOrders(isLoggedIn ? getToken() : null)
  const pendingBlocking = isLoggedIn && state === 'ready' && !hasAnyOrders
    && (svc.serviceLoading || pendingPickup.presence === 'loading' || pendingPickup.presence === 'off')
  const uiState = !isLoggedIn
    ? 'login'
    : state === 'loading' || pendingBlocking
      ? 'loading'
      : state === 'error'
        ? 'error'
        : state === 'ready' && !hasAnyOrders && pendingPickup.presence === 'hidden'
          ? 'empty'
          : 'ready'
  const miniOn = whenMiniapp(useSupportContact(isLoggedIn), 'on') !== ''
  const allLoadedFree = items.length > 0 && svc.serviceOrders.length === 0 && items.every(isFreeMemberOrder)
  const pickupBanner = mobilePickupBanner(miniOn, pendingPickup.presence)
  const pickupBlock = (
    <>
      {pickupBanner ? (
        <button type="button" className="me-line" disabled={winding} title={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} onClick={() => navigate('/print/pickup-claim')}>
          <b>{pickupBanner.title}</b>
          {pickupBanner.note ? <small>{pickupBanner.note}</small> : null}
        </button>
      ) : null}
      <PendingPickupSection
        presence={pendingPickup.presence}
        rows={pendingPickup.rows}
        hasTasks={hasAnyOrders}
        reloading={pendingPickup.reloading}
        onReload={pendingPickup.reload}
      />
    </>
  )

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看打印订单" />
  } else if (state === 'loading' || pendingBlocking) {
    body = <QxMeLoadingBlock title="正在加载打印订单" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock onRetry={() => setReloadKey((k) => k + 1)} />
  } else if (!hasAnyOrders && pendingPickup.presence === 'hidden') {
    body = (
      <div className="me-state" data-testid="qx-me-fallback">
        <MeEmptyPack exitsClassName="me-orders-exits" sentence="还没有打印订单。没登录时在这台机器上打的单不会进这个账号。">
          <LicenseLock><MeExitCard art="usb" artWidth={120} title="去打印" desc="U 盘、手机或扫描都可以" onClick={() => navigate('/print-scan')} /></LicenseLock>
          {miniOn
            ? <LicenseLock><MeExitCard art="phone" artWidth={96} title="输到机码取件" desc="手机上下的到店单，到机器上输入到机码" onClick={() => navigate('/print/pickup-claim')} /></LicenseLock>
            : <MeExitCard art="stack" artWidth={120} title="看看我的文档" desc="选一份已保存的文件再打" onClick={() => navigate('/me/documents')} />}
        </MeEmptyPack>
      </div>
    )
  } else if (!hasAnyOrders) {
    const exits = pendingPickupExitCards({
      printTaskCount: items.length,
      presence: pendingPickup.presence,
      miniOn,
    })
    body = (
      <>
        {pickupBlock}
        {exits.length > 0 ? (
          <div className="me-stack me-orders-exits" data-testid="pending-pickup-exits">
            {exits.map((card) => {
              const node = (
                <MeExitCard
                  art={card.art}
                  artWidth={card.artWidth}
                  title={card.title}
                  desc={card.desc}
                  onClick={() => navigate(card.to)}
                />
              )
              return card.locked
                ? <LicenseLock key={card.to}>{node}</LicenseLock>
                : <Fragment key={card.to}>{node}</Fragment>
            })}
          </div>
        ) : null}
      </>
    )
  } else {
    const syncNote = autoRefreshChecking
      ? '正在同步进行中的订单…'
      : autoRefreshSyncedAt
        ? `进行中的订单会自动刷新，上次同步 ${formatTime(autoRefreshSyncedAt)}。没登录时在这台机器上打的单不会进这个账号。`
        : '进行中的订单会自动刷新。没登录时在这台机器上打的单不会进这个账号。'
    body = (
      <>
        {pickupBlock}
        {/* 任务状态筛选（对已加载数据过滤） */}
        <MeSeg
          mode="pressed"
          label="按任务状态筛选"
          current={filterKey}
          items={STATUS_FILTERS.map((f) => ({ id: f.key, label: f.label }))}
          onPick={(id) => setFilterKey(id as FilterKey)}
        />

        {mergedEntries.length === 0 ? (
          <div className="me-state">
            <MeP>{filterKey !== 'all' && nextCursor ? '已加载记录中暂无此类，点「加载更多」继续查找。' : '这个筛选下没有订单。'}</MeP>
            <div className="me-stack me-orders-exits">
              <MeExitCard art="checklist" artWidth={120} title="查看全部" desc="全部订单都在「全部」里" onClick={() => setFilterKey('all')} />
              <LicenseLock><MeExitCard art="usb" artWidth={120} title="去打印" desc="打一份新的，会新建一张打印任务" onClick={() => navigate('/print-scan')} /></LicenseLock>
            </div>
          </div>
        ) : (
          <MeRows few={mergedEntries.length < 7 && expandedId === null} testId="member-assets-list" label={ordersMode ? '我的订单' : '我的打印订单'}>
            {mergedEntries.map((entry) => {
              if (entry.kind === 'service') {
                return <ServiceOrderRow key={`svc-${entry.id}`} item={entry.item} onInvoice={openServiceInvoice} />
              }
              const item = entry.item
              const canCreateFeedback = item.status === 'completed' || item.status === 'failed'
              const expanded = expandedId === item.id
              const name = item.fileName ?? '未命名订单'
              const pay = paymentLine(item)
              const refund = item.refundRequired === true && !pay.includes(PENDING_REFUND_LABEL) ? ` · ${PENDING_REFUND_LABEL}` : ''
              const invoiceHint = printOrderInvoiceHint(item)
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
                  lines={[<>{STATUS_LABEL[item.status]} · {formatTime(item.completedAt ?? item.createdAt)} · {pay}{refund}{invoiceHint ? ` · ${invoiceHint}` : ''}{item.pickupCode && ' · 到机码'}</>]}
                  aside={canShowPrintOrderInvoiceButton(item) ? <PrintOrderInvoiceAction item={item} name={name} onInvoice={openPrintInvoice} /> : undefined}
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

        <ServiceOrdersMoreAction
          hasMore={Boolean(svc.serviceNextCursor)}
          loading={svc.loadingMoreServices}
          onMore={svc.loadMoreServices}
        />

        {hasActivePrintOrders(items) ? (
          <QxTouchCallout kind="remind" icon="alert">
            {autoRefreshFailed ? (
              <span role="status" aria-live="polite">刚才这次刷新没成功，过一会儿会再试。没登录时在这台机器上打的单不会进这个账号。</span>
            ) : (
              <span>{syncNote}</span>
            )}
          </QxTouchCallout>
        ) : null}

        {mergedEntries.length > 0 && mergedEntries.length < 7 && expandedId === null ? (
          <div className="me-stack me-orders-exits">
            <LicenseLock><MeExitCard art="usb" artWidth={110} title="去打印" desc="打一份新的，会新建一张打印任务" onClick={() => navigate('/print-scan')} /></LicenseLock>
            <MeExitCard art="stack" artWidth={110} title="去我的文档" desc="从已保存的文件里再选一份" onClick={() => navigate('/me/documents')} />
          </div>
        ) : null}
      </>
    )
  }

  const ctabar = uiState === 'login' || uiState === 'loading' || uiState === 'error' ? recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/print-orders', '去打印', () => navigate('/print-scan')) : <LicenseLock>{recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/print-orders', '去打印', () => navigate('/print-scan'))}</LicenseLock>
  const combinedTotal = total + svc.serviceTotal
  const pageSub = hasAnyOrders
    ? (ordersMode ? `共 ${combinedTotal} 条` : `共 ${total} 条已产生打印任务的单`)
    : uiState === 'empty' || (!hasAnyOrders && (pendingPickup.presence === 'rows' || pendingPickup.presence === 'error'))
      ? '还没有归入账号的打印任务'
      : undefined

  return (
    <QxMePage
      title={ordersMode ? '我的订单' : '打印订单'}
      view="orders"
      screen="member-list"
      screenState={`orders-${uiState}`}
      eyebrow={ordersMode ? '我的 · 订单' : '我的 · 打印订单'}
      sub={pageSub}
      fine={allLoadedFree && !ordersMode ? '只显示当前登录账号的打印订单；状态与到机码一律由系统返回。' : undefined}
      ctabar={ctabar}
      live={false}
    >
      {body}
    </QxMePage>
  )
}
