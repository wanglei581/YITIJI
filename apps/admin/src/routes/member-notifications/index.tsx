import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { MegaphoneIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { Page } from '../Page'
import {
  memberNotificationsAdminApi,
  type AdminBroadcastItem,
  type SystemBroadcastCategory,
} from '../../services/api/memberNotificationsAdmin'

const CATEGORIES: { value: SystemBroadcastCategory; label: string; hint: string }[] = [
  { value: 'system', label: '系统通知', hint: '账号、页面、基础服务提示' },
  { value: 'maintenance', label: '系统维护', hint: '维护窗口、设备服务暂停提示' },
  { value: 'notice', label: '服务公告', hint: '文件、打印、现场服务说明' },
]

const CATEGORY_LABEL: Record<SystemBroadcastCategory, string> = {
  system: '系统通知',
  maintenance: '系统维护',
  notice: '服务公告',
}

const CATEGORY_CLASS: Record<SystemBroadcastCategory, string> = {
  system: 'bg-blue-50 text-blue-600',
  maintenance: 'bg-amber-50 text-amber-600',
  notice: 'bg-emerald-50 text-emerald-600',
}

function fmt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

export default function MemberNotificationsPage() {
  const [items, setItems] = useState<AdminBroadcastItem[]>([])
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [title, setTitle] = useState('系统维护提醒')
  const [content, setContent] = useState('系统维护期间，部分设备服务可能暂不可用。')
  const [category, setCategory] = useState<SystemBroadcastCategory>('maintenance')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    setMessage(null)
    try {
      const res = await memberNotificationsAdminApi.listBroadcasts()
      setItems(res.items)
      setState('ready')
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : '广播列表加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const nextTitle = title.trim()
    const nextContent = content.trim()
    if (nextTitle.length < 2 || nextContent.length < 2) {
      setMessage('标题和内容至少填写 2 个字符')
      return
    }
    setSubmitting(true)
    setMessage(null)
    try {
      await memberNotificationsAdminApi.createBroadcast({ title: nextTitle, content: nextContent, category })
      setMessage('广播已创建')
      setTitle('')
      setContent('')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '广播创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (item: AdminBroadcastItem) => {
    if (item.deletedAt) return
    const confirmed = window.confirm(`确认撤回「${item.title}」？撤回后用户端不再显示该广播。`)
    if (!confirmed) return
    setSubmitting(true)
    setMessage(null)
    try {
      await memberNotificationsAdminApi.deleteBroadcast(item.id)
      setMessage('广播已撤回')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '广播撤回失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page
      title="消息通知"
      subtitle="创建系统维护、设备服务、文件与打印处理相关的用户广播"
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-4 w-4" />
          刷新
        </button>
      }
    >
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
        广播内容用于系统维护、设备服务、文件处理和打印服务说明；后端会拦截不合规内容并在此显示错误。
      </div>

      {message && (
        <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">{message}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <PlusIcon className="h-4 w-4 text-primary-600" />
            <p className="text-sm font-semibold text-neutral-900">创建广播</p>
          </div>

          <form onSubmit={(event) => void create(event)} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-neutral-500">分类</label>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as SystemBroadcastCategory)}
                className="mt-1 h-10 w-full rounded-lg border border-neutral-200 px-3 text-sm"
              >
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label} · {item.hint}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500">标题</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary-500"
                maxLength={80}
                placeholder="例如：系统维护提醒"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500">内容</label>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="mt-1 min-h-[150px] w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-500"
                maxLength={800}
                placeholder="填写系统维护、设备服务、文件处理或打印服务说明"
              />
              <p className="mt-1 text-right text-xs text-neutral-400">{content.length} / 800</p>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:bg-neutral-300"
            >
              <MegaphoneIcon className="h-4 w-4" />
              {submitting ? '提交中…' : '创建广播'}
            </button>
          </form>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-neutral-900">广播列表</p>
            <p className="text-xs text-neutral-400">{items.length} 条</p>
          </div>

          {state === 'loading' && <LoadingState className="py-24" />}
          {state === 'error' && <ErrorState className="py-24" onRetry={() => void load()} />}
          {state === 'ready' && items.length === 0 && (
            <EmptyState icon={MegaphoneIcon} title="暂无广播" description="创建后会在这里显示广播记录" className="py-24" />
          )}
          {state === 'ready' && items.length > 0 && (
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <div key={item.id} className={['rounded-lg border p-4', item.deletedAt ? 'border-neutral-100 bg-neutral-50' : 'border-neutral-100'].join(' ')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-neutral-900">{item.title}</p>
                        <span className={['rounded-full px-2.5 py-1 text-xs font-medium', CATEGORY_CLASS[item.category]].join(' ')}>
                          {CATEGORY_LABEL[item.category]}
                        </span>
                        {item.deletedAt && (
                          <span className="rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-500">已撤回</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-neutral-400">创建于 {fmt(item.createdAt)}{item.deletedAt ? ` · 撤回于 ${fmt(item.deletedAt)}` : ''}</p>
                    </div>
                    <button
                      type="button"
                      disabled={submitting || Boolean(item.deletedAt)}
                      onClick={() => void remove(item)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-300"
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                      撤回
                    </button>
                  </div>
                  <p className={['mt-3 whitespace-pre-wrap text-sm leading-relaxed', item.deletedAt ? 'text-neutral-400' : 'text-neutral-600'].join(' ')}>
                    {item.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}
