// ============================================================
// 我的意见反馈 — /me/feedback（本人）。
// 分类限定为设备 / 打印 / 文件处理 / 一般建议，不涉及招聘闭环承诺。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, EmptyState } from '@ai-job-print/ui'
import { MessageSquareIcon } from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { KIcon } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { API_MODE } from '../../../services/api/client'
import {
  addMyFeedbackReply,
  closeMyFeedback,
  createMyFeedback,
  getMyFeedback,
  getMyFeedbackDetail,
  MemberFeedbackApiError,
  type MemberFeedbackTicketDetail,
  type MemberFeedbackTicketItem,
} from '../../../services/api/memberFeedback'
import { MeListShell, type MeListState } from './MeListShell'
import { FeedbackDetailPanel } from './feedback/FeedbackDetailPanel'
import { FeedbackFormPanel } from './feedback/FeedbackFormPanel'
import { FeedbackListPanel } from './feedback/FeedbackListPanel'
import { emptyFeedbackForm, parseFeedbackCategory, type FeedbackFormState } from './feedback/types'
import './me-detail-inkpaper.css'

export function MyFeedbackPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberFeedbackTicketItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState<FeedbackFormState>(emptyFeedbackForm)
  const [selected, setSelected] = useState<MemberFeedbackTicketDetail | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [busy, setBusy] = useState<'submit' | 'detail' | 'reply' | 'close' | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  useInkRipple('.me-inkdetail .me-ripple')

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
    const timer = setTimeout(() => setHint(null), 3200)
    return () => clearTimeout(timer)
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

  const refresh = () => setReloadKey((key) => key + 1)

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
      setForm(emptyFeedbackForm)
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
    <div className="me-inkdetail me-inkdetail-feedback h-full">
      <MeListShell
        title="意见反馈"
        subtitle="提交设备、打印、文件处理与一般建议"
        loginFrom="/me/feedback"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={refresh}
      >
        {hint && (
          <div role="status" className="me-toast fixed left-1/2 top-4 z-50 -translate-x-1/2 px-5 py-2.5">
            {hint}
          </div>
        )}

        <section className="me-detail-summary" aria-label="意见反馈概览">
          <span className="me-summary-icon me-tone-rose" aria-hidden="true">
            <KIcon name="feedback" />
          </span>
          <div className="min-w-0 flex-1">
            <p>服务反馈</p>
            <strong>{items.length}</strong>
            <span>本人设备、打印、文件处理与一般建议，不涉及招聘平台闭环承诺</span>
          </div>
          <div className="me-summary-mini" aria-label="反馈状态">
            <span>{canUseRemote ? '可提交' : '待登录'}</span>
            <span>{totalLabel}</span>
          </div>
        </section>

        {!canUseRemote ? (
          <Card className="me-empty-card">
            <EmptyState
              icon={MessageSquareIcon}
              title="当前无法提交反馈"
              description="连接真实服务并登录后，可查看和提交本人反馈"
              className="py-12"
            />
          </Card>
        ) : (
          <>
            <FeedbackFormPanel
              form={form}
              relatedPrintTaskId={relatedPrintTaskId}
              submitBusy={busy === 'submit'}
              onFormChange={setForm}
              onSubmit={() => void submit()}
            />

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
              <FeedbackListPanel
                items={items}
                selected={selected}
                selectedId={selectedId}
                loading={busy === 'detail'}
                totalLabel={totalLabel}
                onOpen={(id) => void openDetail(id)}
              />

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
    </div>
  )
}
