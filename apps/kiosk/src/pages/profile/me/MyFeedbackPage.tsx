import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../auth/useAuth'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { helpNeededLine } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
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
import { QxMemberNavbar } from '../components/QxMemberNavbar'
import { AI_COMPLAINT_REPLY_DAYS } from './feedback/aiComplaint'
import { FeedbackCtaBar } from './feedback/FeedbackCtaBar'
import { FeedbackDetailPanel } from './feedback/FeedbackDetailPanel'
import { FeedbackDetailGuide, FeedbackStateBody } from './feedback/FeedbackStateBody'
import { FeedbackFormPanel } from './feedback/FeedbackFormPanel'
import { FeedbackListPanel } from './feedback/FeedbackListPanel'
import {
  DETAIL_STATES,
  feedbackPhoneOk,
  feedbackSubmitWhy,
  FORM_STATES,
  isFeedbackStateScreen,
  type FeedbackUiState,
} from './feedback/feedbackRules'
import { emptyFeedbackForm, parseFeedbackCategory, type FeedbackFormState } from './feedback/types'
import { useMemberCursorPage } from './useMemberCursorPage'
import './styles/feedback-qx.css'

// 我的意见反馈 — /me/feedback（本人）。
// 分类限定为设备 / 打印 / 文件处理 / 一般建议 / AI 内容投诉（C3），不涉及招聘闭环承诺。
// AI 内容投诉承诺 AI_COMPLAINT_REPLY_DAYS 个工作日内答复；其余分类不承诺回复时限。

export function MyFeedbackPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const contact = useSupportContact()
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState<FeedbackFormState>(emptyFeedbackForm)
  const [categoryChosen, setCategoryChosen] = useState(false)
  const [selected, setSelected] = useState<MemberFeedbackTicketDetail | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [busy, setBusy] = useState<'submit' | 'detail' | 'reply' | 'close' | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [submitFailed, setSubmitFailed] = useState(false)
  const [successId, setSuccessId] = useState<string | null>(null)
  const [detailFailed, setDetailFailed] = useState(false)
  const skipDetailFetch = useRef<string | null>(null)

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
    if (!hint || submitFailed || successId) return
    const timer = window.setTimeout(() => setHint(null), 3200)
    return () => window.clearTimeout(timer)
  }, [hint, submitFailed, successId])

  useEffect(() => {
    setDetailFailed(false)
  }, [selectedId])

  useEffect(() => {
    if (!selectedId || !canUseRemote) return
    if (skipDetailFetch.current === selectedId) {
      skipDetailFetch.current = null
      return
    }
    let cancel = false
    setBusy('detail')
    setDetailFailed(false)
    getMyFeedbackDetail(getToken(), selectedId)
      .then((detail) => {
        if (cancel) return
        if (!detail) {
          setDetailFailed(true)
          setHint('反馈详情读取失败')
          return
        }
        setSelected(detail)
      })
      .catch(() => {
        if (!cancel) {
          setDetailFailed(true)
          setHint('反馈详情读取失败')
        }
      })
      .finally(() => {
        if (!cancel) setBusy((current) => (current === 'detail' ? null : current))
      })
    return () => { cancel = true }
  }, [canUseRemote, getToken, selectedId])

  useEffect(() => {
    if (!relatedPrintTaskId && !categoryFromQuery) return
    setCategoryChosen(true)
    setForm((value) => {
      const nextCategory = relatedPrintTaskId ? 'print' : (categoryFromQuery ?? value.category)
      const nextTitle = relatedPrintTaskId && value.title.trim().length === 0 ? '打印订单问题反馈' : value.title
      if (value.category === nextCategory && value.title === nextTitle) return value
      return { ...value, category: nextCategory, title: nextTitle }
    })
  }, [categoryFromQuery, relatedPrintTaskId])

  const refresh = () => setReloadKey((key) => key + 1)
  const contentLength = form.content.trim().length
  const phoneOk = feedbackPhoneOk(form.contactPhone)
  const submitWhy = feedbackSubmitWhy(contentLength, categoryChosen || Boolean(relatedPrintTaskId), phoneOk)
  const submitReady = submitWhy === ''

  const showingDetail = Boolean(selected && selectedId && selected.id === selectedId)
  const uiState: FeedbackUiState = !isLoggedIn
    ? 'login'
    : !canUseRemote
      ? 'service-unavailable'
      : showingDetail && successId === selected?.id
        ? 'success'
        : showingDetail && busy === 'reply'
          ? 'reply-busy'
          : showingDetail && busy === 'close'
            ? 'close-busy'
            : showingDetail
              ? 'detail-ready'
              : selectedId && !detailFailed
                ? 'detail-loading'
                : loadState === 'loading'
                  ? 'loading'
                  : loadState === 'error'
                    ? 'error'
                    : busy === 'submit'
                      ? 'submit-busy'
                      : submitFailed
                        ? 'failure'
                        : items.length === 0
                          ? 'list-empty'
                          : 'form-list'

  const inDetail = DETAIL_STATES.includes(uiState)
  const badHint = Boolean(hint && (hint.includes('失败') || hint.includes('无权') || hint.includes('请')))

  const backToList = () => {
    setSuccessId(null)
    setDetailFailed(false)
    setReplyContent('')
    setHint(null)
    setSelected(null)
    const next = new URLSearchParams(searchParams)
    next.delete('ticket')
    setSearchParams(next)
  }

  const submit = async () => {
    const content = form.content.trim()
    if (!categoryChosen && !relatedPrintTaskId) {
      setHint('请先选择一个分类')
      return
    }
    if (content.length < 10) {
      setHint('请填写至少 10 个字的反馈内容')
      return
    }
    if (!feedbackPhoneOk(form.contactPhone)) {
      setHint('联系电话需为 11 位大陆手机号，或留空')
      return
    }
    setSubmitFailed(false)
    setBusy('submit')
    try {
      const detail = await createMyFeedback(getToken(), {
        category: relatedPrintTaskId ? 'print' : form.category,
        title: form.title.trim() || undefined,
        content,
        contactPhone: form.contactPhone.trim() || undefined,
        relatedPrintTaskId: relatedPrintTaskId || undefined,
      })
      skipDetailFetch.current = detail.id
      setForm(emptyFeedbackForm)
      setCategoryChosen(false)
      setSuccessId(detail.id)
      setSelected(detail)
      setReplyContent('')
      setSearchParams({ ticket: detail.id })
      setHint('反馈已提交')
      refresh()
    } catch (error) {
      setSubmitFailed(true)
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
    setDetailFailed(false)
    setSubmitFailed(false)
    try {
      const detail = await getMyFeedbackDetail(getToken(), id)
      if (!detail) {
        setDetailFailed(true)
        setHint('反馈详情读取失败')
        return
      }
      skipDetailFetch.current = id
      setSelected(detail)
      setReplyContent('')
      setSuccessId(null)
      setSearchParams({ ticket: id })
    } catch {
      setDetailFailed(true)
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
      setSuccessId(null)
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
      setSuccessId(null)
      setHint('反馈已关闭')
      refresh()
    } catch {
      setHint('关闭失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  const stateScreen = isFeedbackStateScreen(uiState)

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
        status={{ tone: uiState === 'error' ? 'bad' : 'unknown', label: '我的反馈' }}
        back={{
          label: inDetail ? '返回反馈列表' : '返回我的',
          onBack: inDetail ? backToList : () => navigate('/profile'),
        }}
        ctabar={(
          <div className="fb-cta">
            <div className="fb-cta-row">
              <FeedbackCtaBar
                uiState={uiState}
                submitReady={submitReady}
                submitWhy={submitWhy}
                submitFailed={submitFailed}
                replyContent={replyContent}
                detail={showingDetail ? selected : null}
                onHome={() => navigate('/profile')}
                onHelp={() => navigate('/help')}
                onLogin={() => navigate('/login', { state: { from: loginReturnTo } })}
                onRetry={refresh}
                onSubmit={() => void submit()}
                onBackToList={backToList}
                onAddReply={() => void addReply()}
                onClose={() => void close()}
              />
            </div>
            <p className="fb-truth">
              <b>诚实说明</b>
              <span>
                本页是登录后的本人反馈，与不用登录的一体机问题反馈不是同一条流程；AI 内容投诉 {AI_COMPLAINT_REPLY_DAYS} 个工作日内答复，其他反馈不承诺受理结论或回复时限。
                {uiState === 'error' || uiState === 'service-unavailable' ? helpNeededLine(contact) : ''}
              </span>
            </p>
          </div>
        )}
        navbar={<QxMemberNavbar current="profile" />}
      >
        <div className="qx-me-page fb-page">
          <section className="qx-me-xq" aria-label="意见反馈">
            <div className="qx-me-xq-row">
              <div className="qx-me-xq-face" aria-hidden="true">青</div>
              <div>
                <div className="qx-me-xq-eyebrow">意见反馈</div>
                <h2 className="qx-me-xq-ask">设备和服务哪里不顺，<em>直接告诉我们</em>。</h2>
                <p className="qx-me-xq-doing">登录后提交的是<b>本人工单</b>，可以查看进度、追加描述和关闭。</p>
              </div>
            </div>
          </section>

          {hint ? (
            <div role="status" className="fb-toast" data-tone={badHint ? 'bad' : undefined}>{hint}</div>
          ) : null}

          {stateScreen ? <FeedbackStateBody state={uiState} contact={contact} /> : null}

          {FORM_STATES.includes(uiState) ? (
            <>
              <section className="qx-me-summary" aria-label="意见反馈概览">
                <span className="qx-me-summary-main">
                  <b>服务反馈</b>
                  <strong>{items.length}</strong>
                  <span>本人设备、打印、文件处理、一般建议与 AI 内容投诉，不涉及招聘平台闭环承诺</span>
                </span>
                <span className="qx-me-summary-mini">
                  <i>{canUseRemote ? '可提交' : '待登录'}</i>
                  <i>{items.length > 0 ? `${items.length} 条反馈` : '暂无反馈记录'}</i>
                </span>
              </section>
              <FeedbackFormPanel
                form={form}
                categoryChosen={categoryChosen || Boolean(relatedPrintTaskId)}
                relatedPrintTaskId={relatedPrintTaskId}
                submitBusy={uiState === 'submit-busy'}
                onFormChange={setForm}
                onCategoryChosen={(category) => {
                  setCategoryChosen(true)
                  setForm((value) => ({ ...value, category }))
                }}
              />
              <FeedbackListPanel
                items={items}
                selected={selected}
                selectedId={selectedId}
                loading={busy === 'detail'}
                onOpen={(id) => void openDetail(id)}
                nextCursor={pagination.nextCursor}
                loadingMore={pagination.loadingMore}
                loadMoreError={pagination.loadMoreError}
                loadMore={() => void pagination.loadMore()}
              />
            </>
          ) : null}

          {showingDetail && selected && !stateScreen ? (
            <>
              <FeedbackDetailPanel
                detail={selected}
                replyContent={replyContent}
                onReplyChange={setReplyContent}
                replyBusy={busy === 'reply'}
                closeBusy={busy === 'close'}
                onNewTicket={backToList}
              />
              <FeedbackDetailGuide />
            </>
          ) : null}
        </div>
      </QxPageFrame>
    </div>
  )
}
