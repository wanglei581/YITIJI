// 我的意见反馈 — /me/feedback（本人）。
// 分类限定为设备 / 打印 / 文件处理 / 一般建议，不涉及招聘闭环承诺。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../auth/useAuth'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { API_MODE } from '../../../services/api/client'
import { getTerminalCode } from '../../../services/api/screensaver'
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
import { QxMemberNavbar } from '../components/QxMemberNavbar'
import { FeedbackDetailPanel } from './feedback/FeedbackDetailPanel'
import { FeedbackFormPanel } from './feedback/FeedbackFormPanel'
import { FeedbackListPanel } from './feedback/FeedbackListPanel'
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
  const [items, setItems] = useState<MemberFeedbackTicketItem[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
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

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setItems([])
      setSelected(null)
      setLoadState('ready')
      return
    }
    setLoadState('loading')
    getMyFeedback(getToken(), { pageSize: 50 })
      .then((page) => {
        setItems(page.items)
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
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
      : { tone: 'unknown' as const, label: '本人工单，不承诺回复时限' }

  return (
    <div
      className="fusion-w5 h-full"
      data-kiosk-screen="member-list"
      data-state={uiState}
      data-testid={`member-feedback-state-${uiState}`}
      data-login-from={loginFrom}
    >
      <QxPageFrame
        title="意见反馈"
        subtitle="登录后提交的是本人工单，可以查看进度、追加描述和关闭。"
        status={status}
        terminalLabel={getTerminalCode() || '就业服务大厅'}
        ctabar={
          <FeedbackCta
            uiState={uiState}
            onLogin={() => navigate('/login', { state: { from: loginFrom } })}
            onRetry={refresh}
            onHome={() => navigate('/profile')}
          />
        }
        navbar={<QxMemberNavbar current="profile" />}
      >
        <div className="qx-scroll qx-grow fb-page">
          <section className="fb-xq">
            <div className="fb-xq-eyebrow">MY FEEDBACK</div>
            <h2 className="fb-xq-ask">设备和服务哪里不顺，<em>直接告诉我们</em>。</h2>
            <p className="fb-xq-doing">登录后提交的是<b>本人工单</b>，可以查看进度、追加描述和关闭。</p>
          </section>

          {hint ? (
            <div role="status" className="fb-toast" data-tone={hint.includes('失败') ? 'bad' : undefined}>
              {hint}
            </div>
          ) : null}

          <section className="fb-summary" aria-label="意见反馈概览">
            <div className="fb-summary-main">
              <b>服务反馈</b>
              <strong>{items.length}</strong>
              <span>本人设备、打印、文件处理与一般建议，不涉及招聘平台闭环承诺</span>
            </div>
            <div>
              <span className="fb-st">{canUseRemote ? '可提交' : '待登录'}</span>
              <p className="fb-legal" style={{ marginTop: 8 }}>{totalLabel}</p>
            </div>
          </section>

          {uiState === 'login' || uiState === 'service-unavailable' ? (
            <div className="qx-state" data-tone="info" data-testid="member-feedback-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">{uiState === 'login' ? '请先登录' : '当前无法提交反馈'}</div>
                <p className="qx-state-d">
                  {uiState === 'login'
                    ? '登录后可查看和提交本人反馈。本页是会员工单，与免登录的一体机问题反馈不是同一条链路。'
                    : '连接真实服务并登录后，可查看和提交本人反馈'}
                </p>
              </span>
            </div>
          ) : null}

          {uiState === 'loading' ? (
            <div className="qx-state" data-tone="info">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">正在加载本人记录</div>
                <p className="qx-state-d">请稍候，不会展示其他账号的数据</p>
              </span>
            </div>
          ) : null}

          {uiState === 'error' ? (
            <div className="qx-state" data-tone="error" data-testid="member-feedback-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">暂时无法加载</div>
                <p className="qx-state-d">请检查网络后重试。这次加载失败不会删除任何工单。</p>
              </span>
            </div>
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
            本页是登录后的本人工单，与免登录的一体机问题反馈不是同一条链路；不承诺受理结论或回复时限。
          </p>
        </div>
      </QxPageFrame>
    </div>
  )
}

function FeedbackCta({
  uiState,
  onLogin,
  onRetry,
  onHome,
}: {
  uiState: FeedbackUiState
  onLogin: () => void
  onRetry: () => void
  onHome: () => void
}) {
  if (uiState === 'login' || uiState === 'service-unavailable') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onHome}>返回我的</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="member-feedback-primary" onClick={onLogin}>
          手机号登录
        </button>
      </>
    )
  }
  if (uiState === 'error') {
    return (
      <button type="button" className="qx-btn" data-variant="primary" onClick={onRetry}>重新加载</button>
    )
  }
  return (
    <button type="button" className="qx-btn" data-variant="ghost" onClick={onHome}>返回我的</button>
  )
}
