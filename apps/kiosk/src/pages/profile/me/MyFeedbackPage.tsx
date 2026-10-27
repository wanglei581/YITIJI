import { useMemberCursorPage } from './useMemberCursorPage'
import { MemberLoadMore } from './MemberLoadMore'
// 我的意见反馈 — /me/feedback（本人）。
// 分类限定为设备 / 打印 / 文件处理 / 一般建议 / AI 内容投诉（C3），不涉及招聘闭环承诺。
// AI 内容投诉承诺 AI_COMPLAINT_REPLY_DAYS 个工作日内答复；其余分类不承诺回复时限。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../auth/useAuth'
import { API_MODE } from '../../../services/api/client'
import { MeErrorPack, MeLoadingPack, MeLoginGate } from '../touch/MeStatePacks'
import { MeTouchShell } from '../touch/MeTouchShell'
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
import { FeedbackDetailPanel } from './feedback/FeedbackDetailPanel'
import { FeedbackFormPanel } from './feedback/FeedbackFormPanel'
import { FeedbackListPanel } from './feedback/FeedbackListPanel'
import { AI_COMPLAINT_REPLY_DAYS } from './feedback/aiComplaint'
import { emptyFeedbackForm, parseFeedbackCategory, type FeedbackFormState } from './feedback/types'
import './styles/feedback-qx.css'

type FeedbackUiState =
  | 'login'
  | 'service-unavailable'
  | 'loading'
  | 'error'
  | 'list-empty'
  | 'form-list'
  | 'detail-loading'
  | 'detail-ready'

export function MyFeedbackPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState<FeedbackFormState>(emptyFeedbackForm)
  const [selected, setSelected] = useState<MemberFeedbackTicketDetail | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [busy, setBusy] = useState<'submit' | 'detail' | 'reply' | 'close' | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const canUseRemote = API_MODE === 'http' && Boolean(getToken())
  const selectedId = searchParams.get('ticket')
  const relatedPrintTaskId = searchParams.get('relatedPrintTaskId')?.trim() ?? ''
  const categoryFromQuery = parseFeedbackCategory(searchParams.get('category'))
  const loginFrom = '/me/feedback' // loginFrom="/me/feedback"
  // 从 AI 页面带着 ?category=ai_content 进来的游客：登录后回到同一分类，不丢投诉入口的意图。
  const loginReturnTo = categoryFromQuery ? `${loginFrom}?category=${categoryFromQuery}` : loginFrom

  const token = getToken()
  const fetchPage = useCallback((cursor?: string) => getMyFeedback(token, { pageSize: 50, cursor }), [token])
  const pagination = useMemberCursorPage<MemberFeedbackTicketItem>({ enabled: isLoggedIn, identityKey: token, reloadKey, fetchPage })
  const { items, state: loadState } = pagination

  useEffect(() => { setSelected(null) }, [token])

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

  const uiState: FeedbackUiState = !isLoggedIn
    ? 'login'
    : !canUseRemote
      ? 'service-unavailable'
      : loadState === 'loading'
        ? 'loading'
        : loadState === 'error'
          ? 'error'
          : selectedId && busy === 'detail'
            ? 'detail-loading'
            : selected
              ? 'detail-ready'
              : items.length === 0
                ? 'list-empty'
                : 'form-list'

  const status = uiState === 'error'
    ? { tone: 'bad' as const, label: '反馈列表这次没取到' }
    : uiState === 'loading' || uiState === 'detail-loading'
      ? { tone: 'unknown' as const, label: '正在读取本人工单' }
      : form.category === 'ai_content' && !relatedPrintTaskId
        ? { tone: 'unknown' as const, label: `AI 内容投诉 ${AI_COMPLAINT_REPLY_DAYS} 个工作日内答复` }
        : { tone: 'unknown' as const, label: '本人工单，不承诺回复时限' }

  return (
    <div
      className="fusion-w5 h-full"
      data-kiosk-screen="member-list"
      data-state={uiState}
      data-testid={`member-feedback-state-${uiState}`}
      data-login-from={loginFrom}
    >
      <MeTouchShell
        eyebrow="我的 · 意见反馈"
        title={uiState === 'login' ? '登录后看你的反馈' : uiState === 'loading' || uiState === 'detail-loading' ? '正在读取' : uiState === 'error' || uiState === 'service-unavailable' ? '这次没读到' : '遇到什么问题了？'}
        sub={form.category === 'ai_content' && !relatedPrintTaskId ? 'AI 内容投诉 5 个工作日内答复' : '其他反馈不承诺回复时限'}
        status={status}
        backLabel="返回我的"
        onBack={() => navigate('/profile')}
        ask={{ label: '问小青：投诉 AI 内容怎么写？', draft: '投诉 AI 内容怎么写？' }}
        primaryNode={(
          <FeedbackCta
            uiState={uiState}
            onLogin={() => navigate('/login', { state: { from: loginReturnTo } })}
            onRetry={refresh}
          />
        )}
      >
        <div className="qx-scroll qx-grow fb-page">
          {hint ? (
            <div role="status" className="fb-toast" data-tone={hint.includes('失败') ? 'bad' : undefined}>
              {hint}
            </div>
          ) : null}

          {uiState === 'login' ? (
            <div data-testid="member-feedback-fallback">
              <MeLoginGate page="feedback" />
            </div>
          ) : null}
          {uiState === 'service-unavailable' ? (
            <div data-testid="member-feedback-fallback">
              <p className="qxt-me-lead">反馈服务这次不可用。已填写的内容还在。这不是简历功能停用。</p>
              <MeErrorPack onRetry={refresh} />
            </div>
          ) : null}
          {uiState === 'loading' ? <MeLoadingPack rows={6} /> : null}
          {uiState === 'error' ? (
            <div data-testid="member-feedback-fallback">
              <MeErrorPack onRetry={refresh} />
            </div>
          ) : null}

          {uiState !== 'login' && uiState !== 'loading' && uiState !== 'error' && uiState !== 'service-unavailable' ? (
          <section className="fb-summary" aria-label="意见反馈概览">
            <div className="fb-summary-main">
              <b>服务反馈</b>
              <strong>{items.length}</strong>
              <span>本人设备、打印、文件处理、一般建议与 AI 内容投诉，不涉及招聘平台闭环承诺</span>
            </div>
            <div>
              <span className="fb-st">{canUseRemote ? '可提交' : '待登录'}</span>
              <p className="fb-legal" style={{ marginTop: 8 }}>{totalLabel}</p>
            </div>
          </section>
          ) : null}

          {canUseRemote && loadState === 'ready' ? (
            <>
              <FeedbackFormPanel
                form={form}
                relatedPrintTaskId={relatedPrintTaskId}
                submitBusy={busy === 'submit'}
                onFormChange={setForm}
                onSubmit={() => void submit()}
              />
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
            </>
          ) : null}

          <p className="fb-legal">
            <b>诚实说明</b>
            本页是登录后的本人反馈，与不用登录的一体机问题反馈不是同一条流程；AI 内容投诉 {AI_COMPLAINT_REPLY_DAYS} 个工作日内答复，其他反馈不承诺受理结论或回复时限。
          </p>
          {isLoggedIn && loadState === 'ready' && !selected ? <MemberLoadMore {...pagination} /> : null}
        </div>
      </MeTouchShell>
    </div>
  )
}

function FeedbackCta({
  uiState,
  onLogin,
  onRetry,
}: {
  uiState: FeedbackUiState
  onLogin: () => void
  onRetry: () => void
}) {
  if (uiState === 'login' || uiState === 'service-unavailable') {
    return (
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-feedback-primary" onClick={onLogin}>
        去登录
      </button>
    )
  }
  if (uiState === 'error') {
    return (
      <button type="button" className="qx-btn" data-variant="primary" onClick={onRetry}>重新加载</button>
    )
  }
  return null
}
