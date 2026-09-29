import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatDateTime } from '@ai-job-print/shared'
import { Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { MessageSquareIcon, RefreshCwIcon, SendIcon } from 'lucide-react'
import { Page } from '../Page'
import { AI_CONTENT_COMPLAINT_SLA_WORKDAYS } from './feedbackSla'
import { DetailSla, FeedbackListChips } from './FeedbackSlaBadges'
import {
  memberFeedbackAdminApi,
  type AdminFeedbackTicketDetail,
  type AdminFeedbackTicketItem,
  type FeedbackCategory,
  type FeedbackStatus,
  type FeedbackSubmitterType,
} from '../../services/api/memberFeedbackAdmin'

const CATEGORIES: { value: FeedbackCategory | 'all'; label: string }[] = [
  { value: 'all', label: '全部分类' },
  { value: 'device', label: '设备服务' },
  { value: 'print', label: '打印处理' },
  { value: 'file_process', label: '文件处理' },
  { value: 'general', label: '其他事项' },
  { value: 'ai_content', label: 'AI 内容投诉' },
]

const STATUSES: { value: FeedbackStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待查看' },
  { value: 'processing', label: '处理中' },
  { value: 'replied', label: '已回复' },
  { value: 'closed', label: '已关闭' },
]

const SUBMITTER_TYPES: { value: FeedbackSubmitterType | 'all'; label: string }[] = [
  { value: 'all', label: '全部来源' },
  { value: 'anonymous_kiosk', label: '一体机匿名' },
  { value: 'member', label: '会员提交' },
]

/** 打印完成页满意度三档；null = 未评价，不显示。 */
const SATISFACTION_LABEL: Record<'good' | 'fair' | 'bad', string> = {
  good: '满意',
  fair: '一般',
  bad: '不满意',
}

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  pending: '待查看',
  processing: '处理中',
  replied: '已回复',
  closed: '已关闭',
}

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  pending: 'bg-warning-bg text-warning-fg',
  processing: 'bg-info-bg text-info-fg',
  replied: 'bg-success-bg text-success-fg',
  closed: 'bg-neutral-100 text-neutral-500',
}

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  device: '设备服务',
  print: '打印处理',
  file_process: '文件处理',
  general: '其他事项',
  ai_content: 'AI 内容投诉',
}

function isCategory(value: string | null): value is FeedbackCategory {
  return CATEGORIES.some((item) => item.value !== 'all' && item.value === value)
}

function isStatus(value: string | null): value is FeedbackStatus {
  return STATUSES.some((item) => item.value !== 'all' && item.value === value)
}

const REPLY_SENDER_LABEL: Record<AdminFeedbackTicketDetail['replies'][number]['senderType'], string> = {
  user: '用户',
  admin: '管理员',
  system: '系统',
}

function fmt(iso: string): string {
  return formatDateTime(iso)
}

/**
 * 提交方标识。一体机匿名工单（PR #612）没有账号归属，`phoneMasked` / `nickname`
 * 服务端一律返回 null 且不编造占位值；此前这里直接渲染 `{item.phoneMasked}`，
 * 匿名工单会渲染成空白并留下一个孤立的分隔点。
 * 匿名工单改为标注来源终端，让运营知道该去哪台机器现场处置——它没有账号可通知，
 * 后台只能记录处理结果（用户看不到）。
 */
function submitterLabel(item: Pick<AdminFeedbackTicketItem, 'submitterType' | 'phoneMasked' | 'nickname' | 'terminalId'>): string {
  if (item.submitterType === 'anonymous_kiosk') {
    return item.terminalId ? `一体机匿名 · ${item.terminalId}` : '一体机匿名'
  }
  return `${item.phoneMasked ?? '手机号缺失'} · ${item.nickname ?? '未设置昵称'}`
}

function brief(text: string): string {
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

export default function MemberFeedbackPage() {
  // 状态与分类以地址栏为准：告警中心「去处理」带 ?category=ai_content 进来即是筛好的列表，
  // 刷新或转发链接也不丢筛选。改筛选用 replace，不在浏览器历史里堆一串中间态。
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  const categoryParam = searchParams.get('category')
  const status: FeedbackStatus | 'all' = isStatus(statusParam) ? statusParam : 'all'
  const category: FeedbackCategory | 'all' = isCategory(categoryParam) ? categoryParam : 'all'
  const setFilter = (key: 'status' | 'category', value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value === 'all') next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }
  const [submitterType, setSubmitterType] = useState<FeedbackSubmitterType | 'all'>('all')
  const [items, setItems] = useState<AdminFeedbackTicketItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminFeedbackTicketDetail | null>(null)
  const [listState, setListState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 查看完整联系电话（每次服务端留痕）；换一条工单就清掉。
  const [revealedPhone, setRevealedPhone] = useState<{ id: string; phone: string } | null>(null)

  const loadList = useCallback(async () => {
    setListState('loading')
    setMessage(null)
    try {
      const res = await memberFeedbackAdminApi.list({ status, category, submitterType })
      setItems(res.items)
      setTotal(res.total)
      setListState('ready')
    } catch (error) {
      setListState('error')
      setMessage(error instanceof Error ? error.message : '反馈列表加载失败')
    }
  }, [category, status, submitterType])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (!selectedId || listState !== 'ready') return
    if (items.some((item) => item.id === selectedId)) return
    setSelectedId(null)
    setDetail(null)
    setDetailState('idle')
  }, [items, listState, selectedId])

  const loadDetail = async (id: string) => {
    setSelectedId(id)
    setDetailState('loading')
    setMessage(null)
    setRevealedPhone(null)
    try {
      const next = await memberFeedbackAdminApi.get(id)
      setDetail(next)
      setDetailState('ready')
    } catch (error) {
      setDetailState('error')
      setMessage(error instanceof Error ? error.message : '反馈详情加载失败')
    }
  }

  const revealPhone = async () => {
    if (!detail) return
    setMessage(null)
    try {
      const res = await memberFeedbackAdminApi.revealContactPhone(detail.id)
      setRevealedPhone({ id: detail.id, phone: res.phone })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '联系电话查看失败')
    }
  }

  const submitReply = async (event: FormEvent) => {
    event.preventDefault()
    if (!detail) return
    const content = reply.trim()
    const anonymous = detail.submitterType === 'anonymous_kiosk'
    if (!content) {
      setMessage(anonymous ? '请填写处理结果' : '请填写回复内容')
      return
    }
    setSubmitting(true)
    setMessage(null)
    try {
      const next = await memberFeedbackAdminApi.reply(detail.id, content)
      setDetail(next)
      setReply('')
      setMessage(anonymous ? '处理记录已保存' : '回复已发送')
      await loadList()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : anonymous ? '处理记录保存失败' : '回复发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  const updateStatus = async (nextStatus: FeedbackStatus) => {
    if (!detail || nextStatus === detail.status) return
    setSubmitting(true)
    setMessage(null)
    try {
      const next = await memberFeedbackAdminApi.updateStatus(detail.id, nextStatus)
      setDetail(next)
      setMessage('状态已更新')
      await loadList()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '状态更新失败')
    } finally {
      setSubmitting(false)
    }
  }

  const anonymousDetail = detail?.submitterType === 'anonymous_kiosk'

  return (
    <Page
      title="意见反馈"
      subtitle="处理一体机「意见反馈」弹层（匿名提交）与会员在「我的 → 意见反馈」（一体机、小程序）提交的反馈：看详情、改状态、回复会员或记录处理结果"
      actions={
        <button
          type="button"
          onClick={() => void loadList()}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-4 w-4" />
          刷新
        </button>
      }
    >
      <div className="mb-4 rounded-lg border border-info/20 bg-info-bg px-4 py-2.5 text-sm text-info-fg">
        联系号码默认只显示脱敏号码；只有 AI 内容投诉可以查看完整号码，每次查看都会留痕。
        AI 内容投诉须在 {AI_CONTENT_COMPLAINT_SLA_WORKDAYS} 个工作日内答复（提交当天不算，已扣除法定节假日）；还没答复的会同时出现在告警中心。
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(event) => setFilter('status', event.target.value)}
          className="h-10 rounded-lg border border-neutral-200 px-3 text-sm"
          aria-label="按状态筛选"
        >
          {STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select
          value={category}
          onChange={(event) => setFilter('category', event.target.value)}
          className="h-10 rounded-lg border border-neutral-200 px-3 text-sm"
          aria-label="按分类筛选"
        >
          {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select
          value={submitterType}
          onChange={(event) => setSubmitterType(event.target.value as FeedbackSubmitterType | 'all')}
          className="h-10 rounded-lg border border-neutral-200 px-3 text-sm"
          aria-label="按提交来源筛选"
        >
          {SUBMITTER_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>

      {message && (
        <div className="mb-4 rounded-lg border border-warning/20 bg-warning-bg px-4 py-2.5 text-sm text-warning-fg">{message}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-neutral-900">反馈列表</p>
            <p className="text-xs text-neutral-400">{total} 条{total > items.length ? ` · 仅显示最近 ${items.length} 条` : ''}</p>
          </div>

          {listState === 'loading' && <LoadingState className="py-20" />}
          {listState === 'error' && <ErrorState className="py-20" onRetry={() => void loadList()} />}
          {listState === 'ready' && items.length === 0 && (
            <EmptyState icon={MessageSquareIcon} title="暂无反馈" description="当前筛选条件下没有反馈记录" className="py-20" />
          )}
          {listState === 'ready' && items.length > 0 && (
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadDetail(item.id)}
                  className={[
                    'rounded-lg border p-3 text-left transition-colors',
                    selectedId === item.id ? 'border-primary-200 bg-primary-50' : 'border-neutral-100 hover:bg-neutral-50',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900">{item.title ?? CATEGORY_LABEL[item.category]}</p>
                      <p className="mt-1 text-xs text-neutral-400">
                        {submitterLabel(item)} · {fmt(item.createdAt)}
                      </p>
                    </div>
                    <span className={['shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CLASS[item.status]].join(' ')}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </div>
                  <FeedbackListChips item={item} categoryLabel={CATEGORY_LABEL[item.category]} />
                  <p className="mt-2 text-xs leading-relaxed text-neutral-500">{brief(item.content)}</p>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          {!selectedId && detailState === 'idle' && (
            <EmptyState icon={MessageSquareIcon} title="选择一条反馈" description="在左侧列表中选择反馈后查看详情、回复和更新状态" className="py-24" />
          )}
          {detailState === 'loading' && <LoadingState className="py-24" />}
          {detailState === 'error' && selectedId && <ErrorState className="py-24" onRetry={() => void loadDetail(selectedId)} />}
          {detailState === 'ready' && detail && (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-neutral-900">{detail.title ?? CATEGORY_LABEL[detail.category]}</p>
                  <p className="mt-1 text-sm text-neutral-500">
                    {CATEGORY_LABEL[detail.category]} · 创建于 {fmt(detail.createdAt)} · 更新于 {fmt(detail.updatedAt)}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    {detail.submitterType === 'anonymous_kiosk'
                      ? `${submitterLabel(detail)} · 联系号码 ${revealedPhone?.id === detail.id ? revealedPhone.phone : detail.contactPhoneMasked ?? '未填写'}`
                      : `用户 ${submitterLabel(detail)} · 联系号码 ${revealedPhone?.id === detail.id ? revealedPhone.phone : detail.contactPhoneMasked ?? '未填写'}`}
                    {detail.category === 'ai_content' && detail.contactPhoneMasked && revealedPhone?.id !== detail.id && (
                      <button type="button" onClick={() => void revealPhone()} className="ml-2 min-h-12 px-2 text-sm font-medium text-primary-700 underline">
                        查看完整号码（会留痕）
                      </button>
                    )}
                  </p>
                  {detail.submitterType === 'anonymous_kiosk' && (
                    <p className="mt-1 text-sm text-amber-700">
                      {detail.contactPhoneMasked
                        ? '匿名工单没有账号归属，后台写的内容用户看不到。提交人留了手机号：请电话告知处理结果，再在下方「记录处理结果」里记下（不要写手机号）。'
                        : '匿名工单没有账号归属，也没有留手机号，无法通知提交人：请到该终端现场处置，再在下方「记录处理结果」里记下。'}
                    </p>
                  )}
                </div>
                <select
                  value={detail.status}
                  disabled={submitting}
                  onChange={(event) => void updateStatus(event.target.value as FeedbackStatus)}
                  className="h-10 rounded-lg border border-neutral-200 px-3 text-sm"
                >
                  {STATUSES.filter((item) => item.value !== 'all').map((item) => {
                    // 「已回复」只能由写入回复带出；没有回复记录时不可手选（服务端同样拒绝，FEEDBACK_REPLY_REQUIRED）。
                    const needsReply = item.value === 'replied' && detail.status !== 'replied' && !detail.replies.some((reply) => reply.senderType === 'admin')
                    return (
                      <option key={item.value} value={item.value} disabled={needsReply}>
                        {needsReply ? `${item.label}（先填写回复）` : item.label}
                      </option>
                    )
                  })}
                </select>
              </div>

              <DetailSla detail={{ ...detail, hasAdminReply: detail.replies.some((reply) => reply.senderType === 'admin') }} />

              <div className="mt-4 rounded-lg border border-neutral-100 bg-neutral-50 p-4 text-sm leading-relaxed text-neutral-700">
                {detail.content}
              </div>

              {/* 处置上下文。没有这块，管理员看到「卡住没出完」也无从核实是哪一次打印。
                  只渲染服务端真的给了值的行 —— 缺失项不显示，也不填占位符。 */}
              {(detail.terminalId || detail.relatedPrintTaskId || detail.relatedScanTaskId || detail.satisfaction) && (
                <dl className="mt-4 grid gap-x-6 gap-y-2 rounded-lg border border-neutral-100 p-4 text-sm sm:grid-cols-2">
                  {detail.terminalId && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-neutral-400">来源终端</dt>
                      <dd className="font-medium text-neutral-800">{detail.terminalId}</dd>
                    </div>
                  )}
                  {detail.satisfaction && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-neutral-400">满意度</dt>
                      <dd className="font-medium text-neutral-800">{SATISFACTION_LABEL[detail.satisfaction]}</dd>
                    </div>
                  )}
                  {detail.relatedPrintTaskId && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-neutral-400">打印任务</dt>
                      <dd className="break-all font-mono text-xs text-neutral-800">{detail.relatedPrintTaskId}</dd>
                    </div>
                  )}
                  {detail.relatedScanTaskId && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-neutral-400">扫描任务</dt>
                      <dd className="break-all font-mono text-xs text-neutral-800">{detail.relatedScanTaskId}</dd>
                    </div>
                  )}
                </dl>
              )}

              {/* 退款不在本页执行。裁决后走「订单管理」既有的 admin 退款入口
                  （POST /admin/orders/:id/refund → RefundService，含 refundEligible 判定、
                  幂等与审计）。在工单页另开一个退款按钮等于绕开那套账本，绝对不做。 */}
              <p className="mt-3 text-xs leading-relaxed text-neutral-400">
                本页只做工单处置与状态记录，不执行退款。如核实后需要退款，
                请依据上方打印任务号在「订单管理」中找到对应订单，使用该页的退款入口操作。
              </p>

              <div className="mt-5">
                <p className="mb-3 text-sm font-semibold text-neutral-900">沟通记录</p>
                {detail.replies.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-neutral-200 py-8 text-center text-sm text-neutral-400">暂无回复记录</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {detail.replies.map((item) => (
                      <div key={item.id} className="rounded-lg border border-neutral-100 p-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-neutral-600">{REPLY_SENDER_LABEL[item.senderType]}</span>
                          <span className="text-xs text-neutral-400">{fmt(item.createdAt)}</span>
                        </div>
                        <p className="text-sm leading-relaxed text-neutral-700">{item.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 匿名一体机工单没有 endUser 关联行：写进来的内容不会送达、也不推通知（服务端
                  addAdminReply 只对有账号的工单发通知）。所以匿名工单的表单不叫「回复用户」，
                  而是「记录处理结果」，并把「用户看不到」写在表单上 —— CLAUDE.md §9「不伪造能力」。 */}
              <form onSubmit={(event) => void submitReply(event)} className="mt-5">
                <label htmlFor="feedback-reply" className="text-sm font-semibold text-neutral-900">
                  {anonymousDetail ? '记录处理结果' : '回复用户'}
                </label>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                  {anonymousDetail
                    ? '匿名工单没有账号，这条记录用户看不到；电话告知后在这里记下处理结果，不要写手机号。'
                    : '会员会在「我的 → 意见反馈」看到这条回复，并收到一条消息通知。'}
                </p>
                <textarea
                  id="feedback-reply"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  disabled={detail.status === 'closed' || submitting}
                  className="mt-2 min-h-[120px] w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-500 disabled:bg-neutral-50"
                  maxLength={500}
                  placeholder={anonymousDetail
                    ? '例如：已电话告知提交人问题原因和处理方式；或到现场处置后的结果'
                    : '写给用户的处理说明：问题原因、已经做了什么、接下来怎么办'}
                />
                <button
                  type="submit"
                  disabled={detail.status === 'closed' || submitting}
                  className="mt-3 flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:bg-neutral-300"
                >
                  <SendIcon className="h-4 w-4" />
                  {anonymousDetail
                    ? (submitting ? '保存中…' : '保存处理记录')
                    : (submitting ? '发送中…' : '发送回复')}
                </button>
              </form>
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}
