// ============================================================
// 我的意见反馈 — /me/feedback（本人）。
// 分类限定为设备 / 打印 / 文件处理 / 一般建议，不涉及招聘闭环承诺。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState } from '@ai-job-print/ui'
import {
  CheckCircleIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  PlusIcon,
  SendIcon,
  XCircleIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { API_MODE } from '../../../services/api/client'
import {
  addMyFeedbackReply,
  closeMyFeedback,
  createMyFeedback,
  type FeedbackCategory,
  type FeedbackReplyItem,
  type FeedbackStatus,
  getMyFeedback,
  getMyFeedbackDetail,
  MemberFeedbackApiError,
  type MemberFeedbackTicketDetail,
  type MemberFeedbackTicketItem,
} from '../../../services/api/memberFeedback'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

const CATEGORY_OPTIONS: { value: FeedbackCategory; label: string; hint: string }[] = [
  { value: 'device', label: '设备使用', hint: '屏幕、扫码、外设等设备问题' },
  { value: 'print', label: '打印服务', hint: '打印、取件、纸张等问题' },
  { value: 'file_process', label: '文件处理', hint: '上传、预览、扫描文件处理' },
  { value: 'general', label: '一般建议', hint: '页面体验或服务建议' },
]

const CATEGORY_META: Record<FeedbackCategory, { label: string; bg: string; color: string; icon: LucideIcon }> = {
  device: { label: '设备使用', bg: 'bg-info-bg', color: 'text-info', icon: MessageSquareIcon },
  print: { label: '打印服务', bg: 'bg-warning-bg', color: 'text-warning-fg', icon: MessageSquareIcon },
  file_process: { label: '文件处理', bg: 'bg-primary-50', color: 'text-primary-600', icon: MessageSquareIcon },
  general: { label: '一般建议', bg: 'bg-success-bg', color: 'text-success-fg', icon: MessageSquareIcon },
}

const STATUS_META: Record<FeedbackStatus, { label: string; cls: string }> = {
  pending: { label: '已提交', cls: 'bg-warning-bg text-warning-fg' },
  processing: { label: '处理中', cls: 'bg-primary-50 text-primary-600' },
  replied: { label: '已回复', cls: 'bg-success-bg text-success-fg' },
  closed: { label: '已关闭', cls: 'bg-neutral-100 text-neutral-500' },
}

const inputCls = 'w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100'

interface FormState {
  category: FeedbackCategory
  title: string
  content: string
  contactPhone: string
}

const emptyForm: FormState = {
  category: 'print',
  title: '',
  content: '',
  contactPhone: '',
}

function parseFeedbackCategory(value: string | null): FeedbackCategory | null {
  if (!value) return null
  return CATEGORY_OPTIONS.some((option) => option.value === value) ? (value as FeedbackCategory) : null
}

export function MyFeedbackPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberFeedbackTicketItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [selected, setSelected] = useState<MemberFeedbackTicketDetail | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [busy, setBusy] = useState<'submit' | 'detail' | 'reply' | 'close' | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const canUseRemote = API_MODE === 'http' && Boolean(getToken())
  const selectedId = searchParams.get('ticket')
  const relatedPrintTaskId = searchParams.get('relatedPrintTaskId')?.trim() ?? ''
  const categoryFromQuery = parseFeedbackCategory(searchParams.get('category'))

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setItems([])
      setSelected(null)
      setState('ready')
      return
    }
    setState('loading')
    getMyFeedback(getToken(), { pageSize: 50 })
      .then((page) => {
        setItems(page.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [getToken, isLoggedIn])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3200)
    return () => clearTimeout(t)
  }, [hint])

  useEffect(() => {
    if (!selectedId || !canUseRemote) return
    setBusy('detail')
    getMyFeedbackDetail(getToken(), selectedId)
      .then((detail) => setSelected(detail))
      .catch(() => setHint('反馈详情读取失败'))
      .finally(() => setBusy(null))
  }, [canUseRemote, getToken, selectedId])

  useEffect(() => {
    if (!relatedPrintTaskId && !categoryFromQuery) return
    setForm((value) => {
      const nextCategory = relatedPrintTaskId ? 'print' : (categoryFromQuery ?? value.category)
      const nextTitle = relatedPrintTaskId && value.title.trim().length === 0 ? '打印订单问题反馈' : value.title
      if (value.category === nextCategory && value.title === nextTitle) return value
      return { ...value, category: nextCategory, title: nextTitle }
    })
  }, [categoryFromQuery, relatedPrintTaskId])

  const refresh = () => setReloadKey((k) => k + 1)

  const submit = async () => {
    const content = form.content.trim()
    if (content.length < 10) {
      setHint('请填写至少 10 个字的反馈内容')
      return
    }
    setBusy('submit')
    try {
      const detail = await createMyFeedback(getToken(), {
        category: relatedPrintTaskId ? 'print' : form.category,
        title: form.title.trim() || undefined,
        content,
        contactPhone: form.contactPhone.trim() || undefined,
        relatedPrintTaskId: relatedPrintTaskId || undefined,
      })
      setForm(emptyForm)
      setSelected(detail)
      setSearchParams({ ticket: detail.id })
      setHint('反馈已提交')
      refresh()
    } catch (error) {
      if (error instanceof MemberFeedbackApiError && error.code === 'FEEDBACK_PRINT_TASK_INVALID') {
        setHint('关联打印订单不存在或无权反馈')
      } else {
        setHint('提交失败，请检查登录状态或稍后重试')
      }
    } finally {
      setBusy(null)
    }
  }

  const openDetail = async (id: string) => {
    setBusy('detail')
    try {
      const detail = await getMyFeedbackDetail(getToken(), id)
      setSelected(detail)
      setSearchParams({ ticket: id })
    } catch {
      setHint('反馈详情读取失败')
    } finally {
      setBusy(null)
    }
  }

  const addReply = async () => {
    if (!selected) return
    const content = replyContent.trim()
    if (content.length < 2) {
      setHint('请填写补充描述')
      return
    }
    setBusy('reply')
    try {
      const detail = await addMyFeedbackReply(getToken(), selected.id, content)
      setSelected(detail)
      setReplyContent('')
      setHint('补充描述已提交')
      refresh()
    } catch {
      setHint('提交失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  const close = async () => {
    if (!selected) return
    setBusy('close')
    try {
      const detail = await closeMyFeedback(getToken(), selected.id)
      setSelected(detail)
      setHint('反馈已关闭')
      refresh()
    } catch {
      setHint('关闭失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  const totalLabel = useMemo(() => (items.length > 0 ? `${items.length} 条反馈` : '暂无反馈记录'), [items.length])

  return (
    <MeListShell
      title="意见反馈"
      subtitle="提交设备、打印、文件处理与一般建议"
      loginFrom="/me/feedback"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={refresh}
    >
      {hint && (
        <div role="status" className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {hint}
        </div>
      )}

      {!canUseRemote ? (
        <Card className="p-4">
          <EmptyState
            icon={MessageSquareIcon}
            title="当前无法提交反馈"
            description="连接真实服务并登录后，可查看和提交本人反馈"
            className="py-12"
          />
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">提交反馈</h2>
                <p className="mt-1 text-sm text-neutral-500">请描述设备、打印、文件处理或页面建议</p>
              </div>
              <PlusIcon className="h-5 w-5 text-neutral-300" aria-hidden="true" />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-neutral-500">分类</span>
                <select
                  className={inputCls}
                  value={form.category}
                  disabled={Boolean(relatedPrintTaskId)}
                  onChange={(e) => setForm((v) => ({ ...v, category: e.target.value as FeedbackCategory }))}
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {relatedPrintTaskId && <span className="text-xs text-warning-fg">关联打印订单时固定为打印服务</span>}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-neutral-500">联系电话（选填）</span>
                <input
                  className={inputCls}
                  value={form.contactPhone}
                  onChange={(e) => setForm((v) => ({ ...v, contactPhone: e.target.value }))}
                  inputMode="tel"
                  maxLength={11}
                  placeholder="便于必要时联系确认设备或文件问题"
                />
              </label>
            </div>

            {relatedPrintTaskId && (
              <div className="mt-3 rounded-xl border border-warning/20 bg-warning-bg px-4 py-3">
                <p className="text-xs font-semibold text-warning-fg">已关联打印订单</p>
                <p className="mt-1 break-all text-xs text-warning-fg">{relatedPrintTaskId}</p>
              </div>
            )}

            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-neutral-500">标题（选填）</span>
              <input
                className={inputCls}
                value={form.title}
                onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))}
                maxLength={80}
                placeholder="如：打印预览页显示不完整"
              />
            </label>

            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-neutral-500">反馈内容</span>
              <textarea
                className={`${inputCls} min-h-[112px] resize-none`}
                value={form.content}
                onChange={(e) => setForm((v) => ({ ...v, content: e.target.value }))}
                maxLength={500}
                placeholder="请说明遇到的情况、发生页面或希望改进的地方"
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-neutral-400">{CATEGORY_OPTIONS.find((i) => i.value === form.category)?.hint}</p>
              <Button disabled={busy === 'submit'} onClick={() => void submit()}>
                <SendIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                提交反馈
              </Button>
            </div>
          </Card>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-neutral-900">我的反馈</h2>
                <span className="text-xs text-neutral-400">{totalLabel}</span>
              </div>
              {items.length === 0 ? (
                <EmptyState
                  icon={MessageSquareIcon}
                  title="还没有反馈记录"
                  description="提交反馈后，这里会显示处理状态与回复"
                  className="py-12"
                />
              ) : (
                <div className="divide-y divide-neutral-100">
                  {items.map((item) => (
                    <FeedbackRow
                      key={item.id}
                      item={item}
                      active={selected?.id === item.id || selectedId === item.id}
                      loading={busy === 'detail'}
                      onOpen={() => void openDetail(item.id)}
                    />
                  ))}
                </div>
              )}
            </Card>

            <FeedbackDetailPanel
              detail={selected}
              loading={busy === 'detail'}
              replyContent={replyContent}
              onReplyChange={setReplyContent}
              onAddReply={() => void addReply()}
              onClose={() => void close()}
              replyBusy={busy === 'reply'}
              closeBusy={busy === 'close'}
            />
          </div>
        </>
      )}
    </MeListShell>
  )
}

function FeedbackRow({
  item,
  active,
  loading,
  onOpen,
}: {
  item: MemberFeedbackTicketItem
  active: boolean
  loading: boolean
  onOpen: () => void
}) {
  const category = CATEGORY_META[item.category]
  const status = STATUS_META[item.status]
  const Icon = category.icon
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onOpen}
      className={[
        'flex w-full items-center gap-3 py-3 text-left transition-colors',
        active ? 'bg-primary-50/70 px-3' : 'hover:bg-neutral-50',
      ].join(' ')}
    >
      <div className={['flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', category.bg].join(' ')}>
        <Icon className={['h-5 w-5', category.color].join(' ')} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-neutral-900">{item.title || item.content}</p>
        <p className="mt-0.5 truncate text-xs text-neutral-400">
          {category.label} · {formatTime(item.updatedAt)}
        </p>
      </div>
      <span className={['shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', status.cls].join(' ')}>
        {status.label}
      </span>
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-neutral-300" aria-hidden="true" />
    </button>
  )
}

function FeedbackDetailPanel({
  detail,
  loading,
  replyContent,
  onReplyChange,
  onAddReply,
  onClose,
  replyBusy,
  closeBusy,
}: {
  detail: MemberFeedbackTicketDetail | null
  loading: boolean
  replyContent: string
  onReplyChange: (value: string) => void
  onAddReply: () => void
  onClose: () => void
  replyBusy: boolean
  closeBusy: boolean
}) {
  if (!detail) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={MessageSquareIcon}
          title={loading ? '正在读取详情' : '选择一条反馈查看详情'}
          description="可查看回复、补充描述或关闭反馈"
          className="py-12"
        />
      </Card>
    )
  }

  const status = STATUS_META[detail.status]
  const category = CATEGORY_META[detail.category]
  const canWrite = detail.status !== 'closed'
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-neutral-400">{category.label}</p>
          <h2 className="mt-1 text-base font-semibold text-neutral-900">{detail.title || '未填写标题'}</h2>
          <p className="mt-1 text-xs text-neutral-400">提交于 {formatTime(detail.createdAt)}</p>
        </div>
        <span className={['shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', status.cls].join(' ')}>
          {status.label}
        </span>
      </div>

      <div className="mt-4 rounded-xl bg-neutral-50 p-3 text-sm leading-6 text-neutral-700">{detail.content}</div>

      <div className="mt-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-900">沟通记录</h3>
        {detail.replies.length === 0 ? (
          <p className="rounded-xl bg-neutral-50 px-3 py-4 text-sm text-neutral-500">暂无补充描述或回复</p>
        ) : (
          detail.replies.map((reply) => <ReplyBubble key={reply.id} reply={reply} />)
        )}
      </div>

      {canWrite && (
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-500">补充描述</span>
          <textarea
            className={`${inputCls} min-h-[88px] resize-none`}
            value={replyContent}
            onChange={(e) => onReplyChange(e.target.value)}
            maxLength={500}
            placeholder="补充设备、打印或文件处理相关信息"
          />
        </label>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {canWrite && (
          <Button variant="outline" disabled={replyBusy} onClick={onAddReply}>
            <SendIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
            追加描述
          </Button>
        )}
        {canWrite ? (
          <Button variant="secondary" disabled={closeBusy} onClick={onClose}>
            <CheckCircleIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
            关闭反馈
          </Button>
        ) : (
          <span className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-neutral-100 px-3 text-sm font-medium text-neutral-500">
            <XCircleIcon className="h-4 w-4" aria-hidden="true" />
            已关闭
          </span>
        )}
      </div>
    </Card>
  )
}

function ReplyBubble({ reply }: { reply: FeedbackReplyItem }) {
  const fromUser = reply.senderType === 'user'
  return (
    <div className={['rounded-xl px-3 py-2', fromUser ? 'bg-primary-50' : 'bg-neutral-50'].join(' ')}>
      <div className="flex items-center justify-between gap-2">
        <span className={['text-xs font-medium', fromUser ? 'text-primary-600' : 'text-neutral-500'].join(' ')}>
          {fromUser ? '我的补充' : '服务回复'}
        </span>
        <span className="text-xs text-neutral-400">{formatTime(reply.createdAt)}</span>
      </div>
      <p className="mt-1 text-sm leading-6 text-neutral-700">{reply.content}</p>
    </div>
  )
}
