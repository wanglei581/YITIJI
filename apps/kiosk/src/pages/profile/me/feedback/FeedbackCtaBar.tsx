import { QxAiHelp } from '../../../../components/qingxu/QxAiHelp'
import type { MemberFeedbackTicketDetail } from '../../../../services/api/memberFeedback'
import { FeedbackDetailActions } from './FeedbackDetailPanel'
import { FeedbackSubmitButton } from './FeedbackFormPanel'
import { AI_HELP_DRAFT, FORM_STATES, type FeedbackUiState } from './feedbackRules'

export function FeedbackCtaBar({
  uiState,
  submitReady,
  submitWhy,
  submitFailed,
  replyContent,
  detail,
  onHome,
  onHelp,
  onLogin,
  onRetry,
  onSubmit,
  onBackToList,
  onAddReply,
  onClose,
}: {
  uiState: FeedbackUiState
  submitReady: boolean
  submitWhy: string
  submitFailed: boolean
  replyContent: string
  detail: MemberFeedbackTicketDetail | null
  onHome: () => void
  onHelp: () => void
  onLogin: () => void
  onRetry: () => void
  onSubmit: () => void
  onBackToList: () => void
  onAddReply: () => void
  onClose: () => void
}) {
  if (uiState === 'login' || uiState === 'service-unavailable') {
    return (
      <>
        {uiState === 'login' ? <BackHome onHome={onHome} /> : (
          <button type="button" className="qx-btn" data-variant="ghost" onClick={onHelp}>帮助中心</button>
        )}
        <button type="button" className="qx-btn" data-variant="primary" data-testid="member-feedback-primary" data-login-from="/me/feedback" onClick={onLogin}>
          手机号登录
        </button>
      </>
    )
  }
  if (uiState === 'error') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onHelp}>帮助中心</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="member-feedback-primary" onClick={onRetry}>重新加载</button>
      </>
    )
  }
  if (uiState === 'loading') {
    return (
      <>
        <BackHome onHome={onHome} />
        <button type="button" className="qx-btn" data-variant="primary" disabled>反馈还未加载完成</button>
      </>
    )
  }
  if (uiState === 'detail-loading') {
    return (
      <>
        <BackList onBack={onBackToList} />
        <button type="button" className="qx-btn" data-variant="primary" disabled>详情还未加载完成</button>
      </>
    )
  }
  if ((uiState === 'detail-ready' || uiState === 'reply-busy' || uiState === 'close-busy' || uiState === 'success') && detail) {
    return (
      <FeedbackDetailActions
        detail={detail}
        replyContent={replyContent}
        replyBusy={uiState === 'reply-busy'}
        closeBusy={uiState === 'close-busy'}
        onAddReply={onAddReply}
        onClose={onClose}
        onBack={onBackToList}
      />
    )
  }
  if (FORM_STATES.includes(uiState)) {
    return (
      <>
        <BackHome onHome={onHome} />
        {uiState !== 'list-empty' ? <QxAiHelp label="✧ 问小青：怎么写" draft={AI_HELP_DRAFT} testId="member-feedback-ask" /> : null}
        <FeedbackSubmitButton
          ready={submitReady}
          why={submitWhy}
          busy={uiState === 'submit-busy'}
          failed={submitFailed || uiState === 'failure'}
          onSubmit={onSubmit}
        />
      </>
    )
  }
  return <BackHome onHome={onHome} />
}

function BackHome({ onHome }: { onHome: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="ghost" onClick={onHome} aria-label="返回我的">
      <span aria-hidden="true">‹</span>
      返回我的
    </button>
  )
}

function BackList({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="ghost" onClick={onBack} aria-label="返回列表">
      <span aria-hidden="true">‹</span>
      返回列表
    </button>
  )
}
