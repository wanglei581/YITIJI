// ============================================================
// 我的消息通知 — /me/notifications（本人）。
// 只展示设备 / 打印 / 文件 / 系统类消息；关联反馈仅跳到本人反馈页。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState } from '@ai-job-print/ui'
import {
  BellIcon,
  CheckCheckIcon,
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  MessageSquareIcon,
  PrinterIcon,
  SparklesIcon,
  Trash2Icon,
  type LucideIcon,
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
import { MeListShell, type MeListState } from './MeListShell'

const CATEGORY_META: Record<string, { label: string; icon: LucideIcon; bg: string; color: string }> = {
  print: { label: '打印', icon: PrinterIcon, bg: 'bg-amber-50', color: 'text-amber-600' },
  ai: { label: 'AI服务', icon: SparklesIcon, bg: 'bg-violet-50', color: 'text-violet-600' },
  feedback: { label: '反馈', icon: MessageSquareIcon, bg: 'bg-blue-50', color: 'text-blue-600' },
  maintenance: { label: '维护', icon: FileTextIcon, bg: 'bg-gray-100', color: 'text-gray-600' },
  notice: { label: '公告', icon: BellIcon, bg: 'bg-sky-50', color: 'text-sky-600' },
  system: { label: '系统', icon: BellIcon, bg: 'bg-sky-50', color: 'text-sky-600' },
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
    <MeListShell
      title="消息通知"
      subtitle="本人设备、打印、文件与服务消息"
      loginFrom="/me/notifications"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={refresh}
    >
      {hint && (
        <div role="status" className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {hint}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-full bg-white p-1 ring-1 ring-gray-200">
          {[
            { key: false, label: '全部' },
            { key: true, label: '未读' },
          ].map((tab) => (
            <button
              key={String(tab.key)}
              type="button"
              onClick={() => setUnreadOnly(tab.key)}
              className={[
                'min-h-[40px] rounded-full px-4 text-sm font-medium transition-colors',
                unreadOnly === tab.key ? 'bg-primary-600 text-white' : 'text-gray-500',
              ].join(' ')}
            >
              {tab.label}
              {tab.key && unreadCount > 0 && <span className="ml-1">{unreadCount}</span>}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canUseRemote || unreadCount === 0 || busyId === 'all'}
          onClick={() => void markAllRead()}
        >
          <CheckCheckIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
          全部已读
        </Button>
      </div>

      {!canUseRemote ? (
        <Card className="p-4">
          <EmptyState
            icon={BellIcon}
            title="当前没有可读取的消息"
            description="连接真实服务并登录后，这里会显示本人消息"
            className="py-12"
          />
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={BellIcon} title={visibleEmptyText} description="设备和服务状态有更新时会显示在这里" className="py-12" />
        </Card>
      ) : (
        items.map((item) => {
          const meta = CATEGORY_META[item.category] ?? CATEGORY_META.system
          const Icon = meta.icon
          const feedbackRelated = item.relatedType === 'feedback_ticket' && item.relatedId
          return (
            <Card key={`${item.kind}-${item.id}`} className="p-4">
              <div className="flex items-start gap-4">
                <div className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', meta.bg].join(' ')}>
                  <Icon className={['h-6 w-6', meta.color].join(' ')} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!item.isRead && <span className="h-2 w-2 rounded-full bg-primary-600" aria-label="未读" />}
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{item.title}</p>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-gray-600">{item.content}</p>
                  <p className="mt-2 text-xs text-gray-400">{formatTime(item.createdAt)}</p>
                  {feedbackRelated && (
                    <button
                      type="button"
                      onClick={() => navigate(`/me/feedback?ticket=${encodeURIComponent(item.relatedId ?? '')}`)}
                      className="mt-3 inline-flex min-h-[40px] items-center gap-1 rounded-full bg-blue-50 px-3 text-sm font-medium text-blue-600 active:bg-blue-100"
                    >
                      查看相关反馈
                      <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                {!item.isRead && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === `read-${item.kind}-${item.id}`}
                    onClick={() => void markRead(item)}
                  >
                    <CheckIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    已读
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === `delete-${item.kind}-${item.id}`}
                  onClick={() => void remove(item)}
                >
                  <Trash2Icon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  删除
                </Button>
              </div>
            </Card>
          )
        })
      )}
    </MeListShell>
  )
}
