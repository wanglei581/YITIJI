import { useMemberCursorPage } from './useMemberCursorPage'
import { MemberLoadMore } from './MemberLoadMore'
// 我的消息通知 — /me/notifications 与 /notifications。
// 只展示设备 / 打印 / 文件 / 系统类消息；关联反馈仅跳到本人反馈页。
// 成功态由服务端回执驱动，不乐观改已读。

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BellIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  PrinterIcon,
  SparklesIcon,
  WrenchIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { API_MODE } from '../../../services/api/client'
import {
  deleteMyNotification,
  getMyNotifications,
  markAllMyNotificationsRead,
  markMyNotificationRead,
  type MemberNotificationItem,
} from '../../../services/api/memberNotifications'
import { formatTime } from '../assets/format'
import { MeAiChip, MeErrorPack, MeLoadingPack, MeLoginGate } from '../touch/MeStatePacks'
import { QxMeGuide, QxMePage, QxMeSummary } from './qx/QxMeChrome'
import './styles/notifications-qx.css'

const CATEGORY_META: Record<string, { label: string; icon: typeof BellIcon; tone: 'slate' | 'clay' | 'plum' | 'wheat' | undefined; hint: string }> = {
  print: { label: '打印', icon: PrinterIcon, tone: 'wheat', hint: '打印任务的进度、异常与取件提醒' },
  ai: { label: 'AI服务', icon: SparklesIcon, tone: undefined, hint: 'AI 服务任务完成或失败的提醒' },
  feedback: { label: '反馈', icon: MessageSquareIcon, tone: 'plum', hint: '本人反馈有新回复时的提醒' },
  maintenance: { label: '维护', icon: WrenchIcon, tone: 'slate', hint: '这台机器的维护与停用通知' },
  notice: { label: '公告', icon: MegaphoneIcon, tone: 'clay', hint: '服务公告与规则变更' },
  system: { label: '系统', icon: BellIcon, tone: 'clay', hint: '账号与安全相关的系统消息' },
}
const CAT_ORDER = ['print', 'ai', 'feedback', 'maintenance', 'notice', 'system'] as const

type LoadState = 'loading' | 'error' | 'ready'
type Toast = { tone: 'ok' | 'bad'; text: string }

function screenStateOf(opts: {
  isLoggedIn: boolean
  state: LoadState
  unreadOnly: boolean
  items: MemberNotificationItem[]
  busy: boolean
  toast: Toast | null
}): string {
  if (!opts.isLoggedIn) return 'login'
  if (opts.state === 'loading') return 'loading'
  if (opts.state === 'error') return 'error'
  if (opts.busy) return 'operation-busy'
  if (opts.toast?.tone === 'ok') return 'operation-toast'
  if (opts.items.length === 0) return opts.unreadOnly ? 'unread-empty' : 'all-empty'
  return opts.unreadOnly ? 'ready-unread' : 'ready-all'
}

export function MyNotificationsPage({ loginFrom = '/me/notifications' }: { loginFrom?: string }) {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const canUseRemote = API_MODE === 'http' && Boolean(getToken())

  const token = getToken()
  const fetchPage = useCallback((cursor?: string) => getMyNotifications(token, { pageSize: 50, cursor, unreadOnly }), [token, unreadOnly])
  const pagination = useMemberCursorPage<MemberNotificationItem, Awaited<ReturnType<typeof getMyNotifications>>>({ enabled: isLoggedIn, identityKey: token, reloadKey, fetchPage })
  const { items, state: state } = pagination
  const unreadCount = pagination.page?.unreadCount ?? 0

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const refresh = () => setReloadKey((k) => k + 1)
  const busy = busyId !== null
  const uiState = screenStateOf({ isLoggedIn, state, unreadOnly, items, busy, toast })

  const markAllRead = async () => {
    if (!canUseRemote || unreadCount === 0 || busy) return
    setBusyId('all')
    try {
      await markAllMyNotificationsRead(getToken())
      setToast({ tone: 'ok', text: '已标记全部已读' })
      refresh()
    } catch {
      setToast({ tone: 'bad', text: '操作失败，请稍后重试' })
    } finally {
      setBusyId(null)
    }
  }

  const markRead = async (item: MemberNotificationItem) => {
    if (busy) return
    setBusyId(`read-${item.kind}-${item.id}`)
    try {
      await markMyNotificationRead(getToken(), item.kind, item.id)
      refresh()
    } catch {
      setToast({ tone: 'bad', text: '操作失败，请稍后重试' })
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (item: MemberNotificationItem) => {
    if (busy) return
    setBusyId(`delete-${item.kind}-${item.id}`)
    try {
      await deleteMyNotification(getToken(), item.kind, item.id)
      setToast({ tone: 'ok', text: '消息已删除' })
      refresh()
    } catch {
      setToast({ tone: 'bad', text: '删除失败，请稍后重试' })
    } finally {
      setBusyId(null)
    }
  }

  const ctabar = notificationCtabar({
    uiState,
    canUseRemote,
    unreadCount,
    busy,
    loginFrom,
    navigate,
    markAllRead,
    refresh,
    onShowAll: () => setUnreadOnly(false),
  })

  let body: ReactNode
    if (!isLoggedIn) {
      body = (
        <>
          <div data-testid="notifications-list">
            <MeLoginGate page="notifications" />
          </div>
        </>
      )
    } else if (state === 'loading') {
      body = (
        <>
          <MeLoadingPack rows={6} />
        </>
      )
    } else if (state === 'error') {
      body = (
        <>
          <MeErrorPack onRetry={refresh} />
        </>
      )
    } else {
    const empty = !canUseRemote || items.length === 0
    body = (
      <>
        <QxMeSummary
          tone="clay"
          icon={<BellIcon size={32} />}
          label="消息中心"
          big={unreadCount}
          desc="未读消息来自本人设备、打印、文件与服务状态"
          minis={[`当前 ${items.length}`, canUseRemote ? '已连接' : '待登录']}
        />
        <div className="qx-me-tabbar" data-n="2" role="group" aria-label="消息筛选">
          {[
            { key: false, label: '全部', count: items.length, testid: 'notifications-tab-all' },
            { key: true, label: '未读', count: unreadCount, testid: 'notifications-tab-unread' },
          ].map((tab) => (
            <button key={String(tab.key)} type="button" className="qx-me-tab" aria-current={unreadOnly === tab.key ? 'true' : undefined} data-testid={tab.testid} onClick={() => setUnreadOnly(tab.key)}>
              {tab.label}<i>{tab.count}</i>
            </button>
          ))}
        </div>
        {empty ? (
          <section className="qx-me-list qx-me-grow" data-testid="notifications-list" aria-label="会出现在这里的消息类型">
            {CAT_ORDER.map((cat) => {
              const meta = CATEGORY_META[cat]
              const Icon = meta.icon
              return (
                <div key={cat} className="qx-me-row" data-notification-category={cat} data-slot-mode="empty" data-testid={`notifications-cat-${cat}`}>
                  <span className="qx-me-row-ico" data-tone={meta.tone} aria-hidden="true"><Icon size={28} /></span>
                  <span className="qx-me-row-main">
                    <span className="qx-me-row-title">{meta.label}消息</span>
                    <span className="qx-me-row-sub">{meta.hint}</span>
                  </span>
                  <span className="qx-me-acts"><span className="qx-me-slot">暂无</span></span>
                </div>
              )
            })}
            <div className="qx-me-legal">
              {unreadOnly ? '当前没有未读消息。未读筛选下没有消息；' : '当前没有消息通知。'}
              {canUseRemote ? '设备和服务状态有更新时，消息会按上面这几类出现在这里。' : '当前没有可读取的消息。连接真实服务并登录后，这里会显示本人消息。'}
            </div>
          </section>
        ) : (
          <section className="qx-me-list qx-me-grow" data-testid="notifications-list" aria-label="消息通知">
            {items.map((item) => (
              <NotificationRow
                key={`${item.kind}-${item.id}`}
                item={item}
                busy={busy}
                busyId={busyId}
                onRead={() => void markRead(item)}
                onDelete={() => void remove(item)}
                onFeedback={() => navigate(`/me/feedback?ticket=${encodeURIComponent(item.relatedId ?? '')}`)}
              />
            ))}
            <div className="qx-me-legal">只有与本人反馈关联的消息可以跳到反馈详情；其它消息不提供额外跳转，也不代表来源平台的处理结果。</div>
          </section>
        )}
        <QxMeGuide items={empty
          ? [['怎么产生', '服务状态有更新时', '打印、AI、文件与系统消息都会出现在这里'], ['刷新方式', '进入本页时读取', '本页没有实时推送，操作后会重新读取'], ['谁能看到', '只有本人', '退出后本机不留明细']]
          : [['刷新方式', '进入本页时读取', '本页没有实时推送，完成一次操作后会重新读取'], ['已读与删除', '以系统结果为准', '操作失败会明确提示，列表保持原样'], ['跳转边界', '只有关联反馈的那条消息可跳转', '其它消息与页面级按钮都不进反馈']]}
        />
      </>
    )
  }

  return (
    <QxMePage
      title="消息通知"
      view="notifications"
      screen="member-list"
      screenState={uiState}
      eyebrow="我的 · 消息"
      ask={<>本人设备与服务消息，<em>都在这里</em>。</>}
      doing={busy
        ? <>正在把操作发给系统。<b>结果返回前列表保持原样</b>，本页不会提前显示成功。</>
        : <>只显示<b>本人的打印、AI、文件与系统消息</b>；本页没有实时推送。</>}
      truth="消息只对当前登录账号可见；本页不推送广告，也不代表来源平台的处理结果。"
      toast={toast}
      ctabar={ctabar}
    >
      {body}
      {isLoggedIn && state === 'ready' ? <MemberLoadMore {...pagination} /> : null}
    </QxMePage>
  )
}

function notificationCtabar({
  uiState, canUseRemote, unreadCount, busy, loginFrom, navigate, markAllRead, refresh, onShowAll,
}: {
  uiState: string
  canUseRemote: boolean
  unreadCount: number
  busy: boolean
  loginFrom: string
  navigate: ReturnType<typeof useNavigate>
  markAllRead: () => void
  refresh: () => void
  onShowAll: () => void
}): ReactNode {
  if (uiState === 'error') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="notifications-primary" onClick={refresh}>重新加载</button>
      </>
    )
  }
  const primary = (() => {
    if (uiState === 'login') {
      return <button type="button" className="qx-btn" data-variant="primary" data-testid="notifications-primary" onClick={() => navigate('/login', { state: { from: loginFrom } })}>去登录</button>
    }
    if (uiState === 'loading') {
      return <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="notifications-primary">消息还未加载完成</span>
    }
    if (uiState === 'unread-empty') {
      return <button type="button" className="qx-btn" data-variant="primary" data-testid="notifications-primary" onClick={onShowAll}>看全部消息</button>
    }
    if (busy) {
      return <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="notifications-primary">正在标记全部已读…</span>
    }
    if (!canUseRemote || unreadCount === 0) {
      return <span className="qx-btn" data-variant="primary" aria-disabled="true" aria-label="全部已读（当前没有未读消息）" data-testid="notifications-primary"><CheckIcon size={24} aria-hidden />全部已读</span>
    }
    return (
      <button type="button" className="qx-btn" data-variant="primary" data-testid="notifications-primary" onClick={() => void markAllRead()}>
        <CheckIcon size={24} aria-hidden />全部标记为已读
      </button>
    )
  })()
  return primary
}

function NotificationRow({
  item, busy, busyId, onRead, onDelete, onFeedback,
}: {
  item: MemberNotificationItem
  busy: boolean
  busyId: string | null
  onRead: () => void
  onDelete: () => void
  onFeedback: () => void
}) {
  const meta = CATEGORY_META[item.category] ?? CATEGORY_META.system
  const Icon = meta.icon
  const feedbackRelated = item.relatedType === 'feedback_ticket' && item.relatedId
  const tid = `notifications-item-${item.id}`
  const reading = busyId === `read-${item.kind}-${item.id}`
  const deleting = busyId === `delete-${item.kind}-${item.id}`
  return (
    <div
      className="qx-me-row"
      data-notification-kind={item.kind}
      data-notification-category={item.category}
      data-notification-read={item.isRead ? 'read' : 'unread'}
      data-notification-related={item.relatedType ?? undefined}
      data-notification-related-id={item.relatedId ?? undefined}
    >
      <span className="qx-me-row-ico" data-tone={meta.tone} aria-hidden="true"><Icon size={28} /></span>
      <span className="qx-me-row-main">
        <span className="qx-me-row-head">
          {!item.isRead ? <span className="qx-me-unread" aria-label="未读" /> : null}
          <span className="qx-me-row-title">{item.title}</span>
          <span className="qx-me-chip">{meta.label}</span>
          {item.kind === 'broadcast' ? <span className="qx-me-chip">全站公告</span> : null}
        </span>
        {item.category === 'ai' ? <MeAiChip /> : null}
        <span className="qx-me-notice-body">{item.content}</span>
        <span className="qx-me-row-sub">{formatTime(item.createdAt)}</span>
        <span className="qx-me-row-foot">
          {feedbackRelated ? (
            <button type="button" className="qx-me-small" data-variant="primary" data-testid={`${tid}-feedback`} onClick={onFeedback}>
              查看相关反馈
            </button>
          ) : null}
          {!item.isRead ? (
            <button
              type="button"
              className="qx-me-small"
              data-testid={`${tid}-read`}
              aria-disabled={busy || undefined}
              onClick={busy ? undefined : onRead}
            >
              <CheckIcon size={19} aria-hidden />{reading ? '已读' : '已读'}
            </button>
          ) : null}
          <button
            type="button"
            className="qx-me-small"
            data-testid={`${tid}-delete`}
            aria-disabled={busy || undefined}
            onClick={busy ? undefined : onDelete}
          >
            <XIcon size={19} aria-hidden />{deleting ? '删除' : '删除'}
          </button>
        </span>
      </span>
    </div>
  )
}
