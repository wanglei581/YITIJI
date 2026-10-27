import { useMemberCursorPage } from './useMemberCursorPage'
import { MemberLoadMore } from './MemberLoadMore'
// 我的消息通知 — /me/notifications 与 /notifications。
// 只展示设备 / 打印 / 文件 / 系统类消息；关联反馈仅跳到本人反馈页。
// 成功态由服务端回执驱动，不乐观改已读。

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { MeActs, MeBtn, MeKinds, MeRow, MeRows, MeSeg } from '../touch/MeKit'
import { MeAiChip, MeEmptyPack, MeErrorPack, MeExitCard, MeLoadingPack, MeLoginGate } from '../touch/MeStatePacks'
import { QxMePage } from './qx/QxMeChrome'
import './styles/notifications-qx.css'

const CATEGORY_LABEL: Record<string, string> = {
  print: '打印',
  ai: 'AI 服务',
  feedback: '反馈',
  maintenance: '维护',
  notice: '公告',
  system: '系统',
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
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [armKey, setArmKey] = useState<string | null>(null)

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

  const empty = !canUseRemote || items.length === 0
  let body: ReactNode
  if (!isLoggedIn) {
    body = (
      <div data-testid="notifications-list" className="me-state">
        <MeLoginGate page="notifications" />
      </div>
    )
  } else if (state === 'loading') {
    body = <MeLoadingPack rows={6} />
  } else if (state === 'error') {
    body = <MeErrorPack onRetry={refresh} />
  } else if (empty && !unreadOnly) {
    body = (
      <div data-testid="notifications-list" className="me-state">
        <MeEmptyPack
          sentence={canUseRemote ? '还没有消息。' : '当前没有可读取的消息。连接真实服务并登录后，这里会显示本人消息。'}
          note={<MeKinds items={CAT_ORDER.map((cat) => ({ title: CATEGORY_LABEL[cat], note: '暂无' }))} />}
        >
          <MeExitCard art="usb" artWidth={120} title="去打印" desc="打印和扫描不需要先有消息" onClick={() => navigate('/print-scan')} />
          <MeExitCard art="checklist" artWidth={120} title="去提反馈" desc="设备、打印或文件上的问题可以写在这里" onClick={() => navigate('/me/feedback')} />
        </MeEmptyPack>
      </div>
    )
  } else if (empty) {
    body = (
      <div data-testid="notifications-list" className="me-state">
        <MeEmptyPack sentence="未读里没有消息。">
          <MeExitCard art="checklist" artWidth={120} title="查看全部" desc="已读的消息也在全部里" onClick={() => setUnreadOnly(false)} />
          <MeExitCard art="usb" artWidth={120} title="去打印" desc="打印和扫描现在就能办" onClick={() => navigate('/print-scan')} />
        </MeEmptyPack>
      </div>
    )
  } else {
    body = (
      <>
        <MeRows few={items.length < 7} testId="notifications-list" label="消息通知">
          {items.map((item) => {
            const key = `${item.kind}-${item.id}`
            return (
              <NotificationRow
                key={key}
                item={item}
                open={openKey === key}
                armed={armKey === key}
                busy={busy}
                busyId={busyId}
                onToggle={() => { setOpenKey(openKey === key ? null : key); setArmKey(null) }}
                onRead={() => void markRead(item)}
                onArm={() => setArmKey(key)}
                onDisarm={() => setArmKey(null)}
                onDelete={() => { setArmKey(null); void remove(item) }}
                onFeedback={() => navigate(`/me/feedback?ticket=${encodeURIComponent(item.relatedId ?? '')}`)}
              />
            )
          })}
        </MeRows>
        {items.length < 7 && openKey === null ? (
          <div className="me-stack">
            <MeExitCard art="checklist" artWidth={110} title="去提反馈" desc="打印或设备上的问题可以写下来" onClick={() => navigate('/me/feedback')} />
            <MeExitCard art="usb" artWidth={110} title="去打印" desc="不看消息也能打印、扫描" onClick={() => navigate('/print-scan')} />
          </div>
        ) : null}
      </>
    )
  }

  const bandTitle = !isLoggedIn || state !== 'ready'
    ? '消息通知'
    : items.length === 0 && !unreadOnly
      ? '还没有消息'
      : unreadCount > 0 ? `${unreadCount} 条未读` : '消息都看过了'

  return (
    <QxMePage
      title={bandTitle}
      view="notifications"
      screen="member-list"
      screenState={uiState}
      eyebrow="我的 · 消息"
      toast={toast}
      ctabar={ctabar}
    >
      {isLoggedIn && state === 'ready' ? (
        <MeSeg
          mode="pressed"
          label="消息筛选"
          current={unreadOnly ? 'unread' : 'all'}
          items={[
            { id: 'all', label: '全部', testId: 'notifications-tab-all' },
            { id: 'unread', label: '未读', testId: 'notifications-tab-unread' },
          ]}
          onPick={(id) => setUnreadOnly(id === 'unread')}
        />
      ) : null}
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
      <button type="button" className="qx-btn" data-variant="primary" data-testid="notifications-primary" onClick={refresh}>重新加载</button>
    )
  }
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
    return <span className="qx-btn" data-variant="primary" aria-disabled="true" aria-label="全部已读（当前没有未读消息）" data-testid="notifications-primary">全部已读</span>
  }
  return (
    <button type="button" className="qx-btn" data-variant="primary" data-testid="notifications-primary" onClick={() => void markAllRead()}>
      全部标为已读
    </button>
  )
}

function NotificationRow({
  item, open, armed, busy, busyId, onToggle, onRead, onArm, onDisarm, onDelete, onFeedback,
}: {
  item: MemberNotificationItem
  open: boolean
  armed: boolean
  busy: boolean
  busyId: string | null
  onToggle: () => void
  onRead: () => void
  onArm: () => void
  onDisarm: () => void
  onDelete: () => void
  onFeedback: () => void
}) {
  const feedbackRelated = item.relatedType === 'feedback_ticket' && item.relatedId
  const tid = `notifications-item-${item.id}`
  const reading = busyId === `read-${item.kind}-${item.id}`
  const deleting = busyId === `delete-${item.kind}-${item.id}`
  const label = CATEGORY_LABEL[item.category] ?? CATEGORY_LABEL.system
  return (
    <MeRow
      data-testid={tid}
      open={open}
      onToggle={onToggle}
      data-notification-kind={item.kind}
      data-notification-category={item.category}
      data-notification-read={item.isRead ? 'read' : 'unread'}
      data-notification-related={item.relatedType ?? undefined}
      data-notification-related-id={item.relatedId ?? undefined}
      title={<>{!item.isRead ? <span className="me-unread" aria-label="未读">未读 · </span> : null}{item.title}</>}
      lines={[`${label}${item.kind === 'broadcast' ? ' · 全站公告' : ''} · ${item.content} · ${formatTime(item.createdAt)}`]}
      chips={item.category === 'ai' ? <MeAiChip /> : undefined}
      actions={(
        <MeActs>
          {feedbackRelated ? (
            <MeBtn v="sec" data-testid={`${tid}-feedback`} onClick={onFeedback}>查看相关反馈</MeBtn>
          ) : null}
          {!item.isRead ? (
            <MeBtn v="sec" data-testid={`${tid}-read`} aria-disabled={busy || undefined} onClick={busy ? undefined : onRead}>
              {reading ? '正在标记…' : '已读'}
            </MeBtn>
          ) : null}
          {armed ? (
            <>
              <MeBtn v="danger" data-testid={`${tid}-delete`} aria-disabled={busy || undefined} onClick={busy ? undefined : onDelete}>
                {deleting ? '正在删除…' : '再点一次确认删除'}
              </MeBtn>
              <MeBtn v="sec" onClick={onDisarm}>取消</MeBtn>
            </>
          ) : (
            <MeBtn v="sec" data-testid={`${tid}-delete`} aria-disabled={busy || undefined} onClick={busy ? undefined : onArm}>删除</MeBtn>
          )}
        </MeActs>
      )}
    />
  )
}
