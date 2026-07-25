import type { AdminUserActivityItem, AdminUserDetailResult } from '@ai-job-print/shared'
import { Card, Drawer, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { XIcon } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ApiHttpError } from '../../services/api/client'
import { getDetail } from '../../services/api/adminUsers'
import { ACTIVITY_TYPE_LABELS, formatUserDateTime } from './userPresentation'

interface UserDetailDrawerProps {
  endUserId: string | null
  onClose: () => void
  onMissing: () => void
}

type DetailState = 'idle' | 'loading' | 'ready' | 'error' | 'notfound'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-neutral-800">{value}</dd>
    </div>
  )
}

function ActivityCard({ activity }: { activity: AdminUserActivityItem }) {
  return (
    <li className="rounded-lg border border-neutral-100 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-neutral-800">{ACTIVITY_TYPE_LABELS[activity.type]}</span>
        <time className="text-xs text-neutral-400">{formatUserDateTime(activity.occurredAt)}</time>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <DetailField label="类别" value={activity.category ?? '—'} />
        <DetailField label="动作" value={activity.action ?? '—'} />
        <DetailField label="状态" value={activity.status || '—'} />
        <DetailField label="终端" value={activity.terminalId ?? '—'} />
      </dl>
    </li>
  )
}

export function UserDetailDrawer({ endUserId, onClose, onMissing }: UserDetailDrawerProps) {
  const [state, setState] = useState<DetailState>('idle')
  const [detail, setDetail] = useState<AdminUserDetailResult | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const requestSequence = useRef(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!endUserId) {
      requestSequence.current += 1
      setState('idle')
      setDetail(null)
      return
    }

    let cancelled = false
    const requestId = ++requestSequence.current
    setState('loading')
    setDetail(null)
    void getDetail(endUserId)
      .then((result) => {
        if (cancelled || requestId !== requestSequence.current) return
        setDetail(result)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled || requestId !== requestSequence.current) return
        setState(error instanceof ApiHttpError && error.code === 'ADMIN_USER_NOT_FOUND' ? 'notfound' : 'error')
      })

    return () => {
      cancelled = true
    }
  }, [endUserId, retryKey])

  useEffect(() => {
    if (!endUserId) return
    const frame = requestAnimationFrame(() => titleRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [endUserId])

  const close = useCallback(() => {
    if (state === 'notfound') onMissing()
    onClose()
  }, [onClose, onMissing, state])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const content = contentRef.current
    if (!content) return

    const focusableElements = Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const firstFocusable = focusableElements[0]
    const lastFocusable = focusableElements[focusableElements.length - 1]
    if (!firstFocusable || !lastFocusable) {
      event.preventDefault()
      titleRef.current?.focus()
      return
    }

    const activeElement = document.activeElement
    if (activeElement === titleRef.current) {
      event.preventDefault()
      const nextFocusable = event.shiftKey ? lastFocusable : firstFocusable
      nextFocusable.focus()
      return
    }
    if (event.shiftKey && (activeElement === firstFocusable || !content.contains(activeElement))) {
      event.preventDefault()
      lastFocusable.focus()
      return
    }
    if (!event.shiftKey && (activeElement === lastFocusable || !content.contains(activeElement))) {
      event.preventDefault()
      firstFocusable.focus()
    }
  }

  const stats = detail
    ? [
        ['文件', detail.stats.fileCount],
        ['打印任务', detail.stats.printTaskCount],
        ['AI 结果', detail.stats.aiResultCount],
        ['浏览', detail.stats.browseCount],
        ['外部跳转', detail.stats.externalJumpCount],
      ] as const
    : []

  return (
    <Drawer open={endUserId !== null} onClose={close} ariaLabel="用户详情" size="lg">
      <div ref={contentRef} onKeyDown={handleKeyDown}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 ref={titleRef} tabIndex={-1} className="text-lg font-semibold text-neutral-900 outline-none">
              用户详情
            </h2>
            <p className="mt-1 text-sm text-neutral-500">只读查看用户基本信息与服务使用概况</p>
          </div>
          <button type="button" onClick={close} aria-label="关闭用户详情" className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100">
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {(state === 'idle' || state === 'loading') && (
          <div role="status" aria-live="polite">
            <LoadingState text="正在加载用户详情…" className="py-24" />
          </div>
        )}
        {state === 'error' && (
          <div role="alert">
            <ErrorState
              title="用户详情加载失败"
              message="请稍后重试"
              onRetry={() => setRetryKey((value) => value + 1)}
              className="py-24"
            />
          </div>
        )}
        {state === 'notfound' && (
          <div role="alert" className="py-24 text-center">
            <p className="text-base font-medium text-neutral-900">用户不存在或已被移除</p>
            <button type="button" onClick={close} className="mt-4 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              关闭并刷新列表
            </button>
          </div>
        )}
        {state === 'ready' && detail && (
          <div className="space-y-5">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-neutral-900">基本信息</h3>
              <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailField label="昵称" value={detail.user.nickname?.trim() || '未设置昵称'} />
                <DetailField label="手机号" value={detail.user.maskedPhone} />
                <DetailField label="账号状态" value={detail.user.enabled ? '正常' : '已停用'} />
                <DetailField label="最近登录" value={detail.user.lastLoginAt ? formatUserDateTime(detail.user.lastLoginAt) : '暂无登录记录'} />
                <DetailField label="注册时间" value={formatUserDateTime(detail.user.createdAt)} />
                <DetailField label="更新时间" value={formatUserDateTime(detail.user.updatedAt)} />
              </dl>
            </Card>

            <section aria-labelledby="user-stats-title">
              <h3 id="user-stats-title" className="text-sm font-semibold text-neutral-900">服务使用统计</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {stats.map(([label, value]) => (
                  <Card key={label} className="p-3 text-center">
                    <p className="text-xl font-semibold text-neutral-900">{value}</p>
                    <p className="mt-1 text-xs text-neutral-500">{label}</p>
                  </Card>
                ))}
              </div>
            </section>

            <section aria-labelledby="recent-activities-title">
              <h3 id="recent-activities-title" className="text-sm font-semibold text-neutral-900">最近活动</h3>
              {detail.recentActivities.length === 0 ? (
                <EmptyState title="暂无当前留存活动" className="mt-3 py-12" />
              ) : (
                <ol className="mt-3 space-y-2">
                  {detail.recentActivities.slice(0, 20).map((activity) => <ActivityCard key={activity.id} activity={activity} />)}
                </ol>
              )}
            </section>

            <div className="rounded-lg border border-info/20 bg-info-bg px-4 py-3 text-sm text-info-fg">
              {detail.retentionNotice}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}
