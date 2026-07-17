// ============================================================
// 我的消息通知 — /me/notifications（本人）。
// 只展示设备 / 打印 / 文件 / 系统类消息；关联反馈仅跳到本人反馈页。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, EmptyState } from '@ai-job-print/ui'
import {
  BellIcon,
  ChevronRightIcon,
} from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { API_MODE } from '../../../services/api/client'
import {
  deleteMyNotification,
  getMyNotifications,
  markAllMyNotificationsRead,
  markMyNotificationRead,
  type MemberNotificationItem,
} from '../../../services/api/memberNotifications'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import './me-detail-inkpaper.css'

const CATEGORY_META: Record<string, { label: string; icon: KioskIconName; tone: string }> = {
  print: { label: '打印', icon: 'printer', tone: 'wheat' },
  ai: { label: 'AI服务', icon: 'sparkle', tone: 'teal' },
  feedback: { label: '反馈', icon: 'feedback', tone: 'rose' },
  maintenance: { label: '维护', icon: 'files', tone: 'slate' },
  notice: { label: '公告', icon: 'bell', tone: 'clay' },
  system: { label: '系统', icon: 'bell', tone: 'clay' },
}

export function MyNotificationsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberNotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [state, setState] = useState<MeListState>('loading')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  useInkRipple('.me-inkdetail .me-ripple')

  const canUseRemote = API_MODE === 'http' && Boolean(getToken())

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setItems([])
      setUnreadCount(0)
      setState('ready')
      return
    }
    setState('loading')
    getMyNotifications(getToken(), { pageSize: 50, unreadOnly })
      .then((page) => {
        setItems(page.items)
        setUnreadCount(page.unreadCount)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [getToken, isLoggedIn, unreadOnly])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  const visibleEmptyText = useMemo(
    () => (unreadOnly ? '当前没有未读消息' : '当前没有消息通知'),
    [unreadOnly],
  )

  const refresh = () => setReloadKey((k) => k + 1)

  const markAllRead = async () => {
    setBusyId('all')
    try {
      await markAllMyNotificationsRead(getToken())
      setHint('已标记全部已读')
      refresh()
    } catch {
      setHint('操作失败，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  const markRead = async (item: MemberNotificationItem) => {
    setBusyId(`read-${item.kind}-${item.id}`)
    try {
      await markMyNotificationRead(getToken(), item.kind, item.id)
      refresh()
    } catch {
      setHint('操作失败，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (item: MemberNotificationItem) => {
    setBusyId(`delete-${item.kind}-${item.id}`)
    try {
      await deleteMyNotification(getToken(), item.kind, item.id)
      setHint('消息已删除')
      refresh()
    } catch {
      setHint('删除失败，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="me-inkdetail me-inkdetail-notifications h-full">
      <MeListShell
        title="消息通知"
        subtitle="本人设备、打印、文件与服务消息"
        loginFrom="/me/notifications"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={refresh}
      >
        {hint && (
          <div role="status" className="me-toast fixed left-1/2 top-4 z-50 -translate-x-1/2 px-5 py-2.5">
            {hint}
          </div>
        )}

        <section className="me-detail-summary" aria-label="消息通知概览">
          <span className="me-summary-icon me-tone-plum" aria-hidden="true">
            <KIcon name="bell" />
          </span>
          <div className="min-w-0 flex-1">
            <p>消息中心</p>
            <strong>{unreadCount}</strong>
            <span>未读消息来自本人设备、打印、文件与服务状态</span>
          </div>
          <div className="me-summary-mini" aria-label="消息状态">
            <span>当前 {items.length}</span>
            <span>{canUseRemote ? '已连接' : '待登录'}</span>
          </div>
        </section>

        <div className="me-notification-toolbar">
          <div className="me-tabbar">
            {[
              { key: false, label: '全部' },
              { key: true, label: '未读' },
            ].map((tab) => {
              const active = unreadOnly === tab.key
              return (
                <button
                  key={String(tab.key)}
                  type="button"
                  onClick={() => setUnreadOnly(tab.key)}
                  className={['me-tab me-ripple', active ? 'is-active' : ''].join(' ')}
                  aria-pressed={active}
                >
                  {tab.label}
                  {tab.key && unreadCount > 0 && <span>{unreadCount}</span>}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            disabled={!canUseRemote || unreadCount === 0 || busyId === 'all'}
            onClick={() => void markAllRead()}
            className={[
              'me-ripple me-notification-action',
              !canUseRemote || unreadCount === 0 || busyId === 'all'
                ? 'is-disabled'
                : '',
            ].join(' ')}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
              <KIcon name="check" />
            </span>
            全部已读
          </button>
        </div>

        {!canUseRemote ? (
          <Card className="me-empty-card">
            <EmptyState
              icon={BellIcon}
              title="当前没有可读取的消息"
              description="连接真实服务并登录后，这里会显示本人消息"
              className="py-12"
            />
          </Card>
        ) : items.length === 0 ? (
          <Card className="me-empty-card">
            <EmptyState icon={BellIcon} title={visibleEmptyText} description="设备和服务状态有更新时会显示在这里" className="py-12" />
          </Card>
        ) : (
          items.map((item) => {
            const meta = CATEGORY_META[item.category] ?? CATEGORY_META.system
            const feedbackRelated = item.relatedType === 'feedback_ticket' && item.relatedId
            return (
              <Card
                key={`${item.kind}-${item.id}`}
                className={['me-benefit-card me-notification-card', !item.isRead ? 'is-unread' : ''].join(' ')}
              >
                <div className="flex items-start gap-4">
                  <span className={['me-row-icon', `me-tone-${meta.tone}`].join(' ')} aria-hidden="true">
                    <KIcon name={meta.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!item.isRead && <span className="me-notification-dot" aria-label="未读" />}
                      <span className="me-row-title min-w-0 flex-1">{item.title}</span>
                      <span className="me-chip">{meta.label}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--ink-2)]">{item.content}</p>
                    <p className="mt-2 text-xs text-[color:var(--muted)]">{formatTime(item.createdAt)}</p>
                    {feedbackRelated && (
                      <button
                        type="button"
                        onClick={() => navigate(`/me/feedback?ticket=${encodeURIComponent(item.relatedId ?? '')}`)}
                        className="me-ripple me-notification-action mt-3"
                      >
                        查看相关反馈
                        <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="me-notification-actions">
                  {!item.isRead && (
                    <button
                      type="button"
                      disabled={busyId === `read-${item.kind}-${item.id}`}
                      onClick={() => void markRead(item)}
                      className="me-notification-action me-ripple"
                    >
                      <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
                        <KIcon name="check" />
                      </span>
                      已读
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === `delete-${item.kind}-${item.id}`}
                    onClick={() => void remove(item)}
                    className="me-delete-button me-ripple"
                  >
                    <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
                      <KIcon name="close" />
                    </span>
                    删除
                  </button>
                </div>
              </Card>
            )
          })
        )}
      </MeListShell>
    </div>
  )
}
