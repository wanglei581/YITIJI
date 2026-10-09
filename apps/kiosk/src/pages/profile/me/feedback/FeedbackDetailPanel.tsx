import type { FeedbackReplyItem, MemberFeedbackTicketDetail } from '../../../../services/api/memberFeedback'
import { formatTime } from '../../assets/format'
import { AI_COMPLAINT_REPLY_DAYS } from './aiComplaint'
import { FeedbackMark } from './FeedbackMark'
import { CATEGORY_META, STATUS_META } from './types'

export function FeedbackDetailPanel({
  detail,
  replyContent,
  onReplyChange,
  replyBusy,
  closeBusy,
  onNewTicket,
}: {
  detail: MemberFeedbackTicketDetail
  replyContent: string
  onReplyChange: (value: string) => void
  replyBusy: boolean
  closeBusy: boolean
  onNewTicket: () => void
}) {
  const status = STATUS_META[detail.status]
  const category = CATEGORY_META[detail.category]
  const canWrite = detail.status !== 'closed'
  const tone = detail.status === 'pending' ? 'wait' : detail.status === 'processing' ? 'run' : undefined
  const locked = replyBusy || closeBusy
  return (
    <div className="fb-detail">
      <section className="qx-me-summary" aria-label="反馈详情">
        <FeedbackMark category={detail.category} />
        <span className="qx-me-summary-main">
          <b>{category.label}</b>
          <h2 className="fb-detail-title">{detail.title || '未填写标题'}</h2>
          <span>提交于 {formatTime(detail.createdAt)} · 仅本人可见</span>
        </span>
        <span className="qx-me-summary-mini">
          <i className="qx-me-st" data-tone={tone}>{status.label}</i>
        </span>
      </section>

      <section className="fb-detail-scroll" data-testid="member-feedback-detail">
        <p className="fb-note">{detail.content}</p>
        <div className="fb-sec">工单信息</div>
        <dl className="fb-dl" data-testid="member-feedback-detail-meta">
          <div><dt>工单编号</dt><dd>{detail.id}</dd></div>
          <div><dt>提交时间</dt><dd>{formatTime(detail.createdAt)}</dd></div>
          <div><dt>反馈分类</dt><dd>{category.label}</dd></div>
          <div><dt>关联打印订单</dt><dd>{detail.relatedPrintTaskId || '未关联'}</dd></div>
        </dl>
        <div className="fb-sec">沟通记录</div>
        <div className="fb-thread" data-testid="member-feedback-thread" data-reply-count={detail.replies.length}>
          {detail.replies.length === 0 ? (
            <p className="fb-thread-empty">还没有补充描述或回复。有回复会显示在这里；AI 内容投诉 {AI_COMPLAINT_REPLY_DAYS} 个工作日内答复，其他反馈不承诺回复时间。</p>
          ) : (
            detail.replies.map((reply) => <ReplyBubble key={reply.id} reply={reply} />)
          )}
        </div>
        {canWrite ? (
          <label className="fb-field" htmlFor="fb-reply">
            <span className="fb-field-row">
              <span className="fb-field-label">补充描述</span>
              <span className="fb-count">{replyContent.length} / 500</span>
            </span>
            <textarea
              id="fb-reply"
              className="fb-textarea"
              aria-label="补充描述"
              value={replyContent}
              disabled={locked}
              onChange={(event) => onReplyChange(event.target.value)}
              maxLength={500}
              placeholder="补充设备、打印或文件处理相关信息"
            />
          </label>
        ) : (
          <>
            <p className="fb-closed-note">这条反馈已关闭，不能再追加描述。</p>
            <button type="button" className="fb-new" onClick={onNewTicket}>
              再提一条新的反馈
              <i>回到列表并填写</i>
            </button>
          </>
        )}
      </section>
    </div>
  )
}

export function FeedbackDetailActions({
  detail,
  replyContent,
  replyBusy,
  closeBusy,
  onAddReply,
  onClose,
  onBack,
}: {
  detail: MemberFeedbackTicketDetail
  replyContent: string
  replyBusy: boolean
  closeBusy: boolean
  onAddReply: () => void
  onClose: () => void
  onBack: () => void
}) {
  const canWrite = detail.status !== 'closed'
  const replyReady = replyContent.trim().length >= 2
  return (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={onBack} aria-label="返回列表">
        <span aria-hidden="true">‹</span>
        返回列表
      </button>
      {canWrite ? (
        <button
          type="button"
          className={replyBusy || replyReady ? 'qx-btn' : 'qx-btn fb-hold'}
          disabled={replyBusy || closeBusy || !replyReady}
          aria-label={!replyBusy && !replyReady ? '追加描述（请填写补充描述）' : undefined}
          onClick={onAddReply}
        >
          <span>{replyBusy ? '正在提交…' : '追加描述'}</span>
          {!replyBusy && !replyReady ? <small>请填写补充描述</small> : null}
        </button>
      ) : null}
      {canWrite ? (
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          disabled={replyBusy || closeBusy}
          onClick={onClose}
        >
          {closeBusy ? '正在关闭…' : '关闭反馈'}
        </button>
      ) : (
        <button type="button" className="qx-btn fb-hold" data-variant="primary" disabled aria-label="已关闭（这条反馈已关闭，不能再追加或重复关闭）">
          <span>已关闭</span>
          <small>这条反馈已关闭，不能再追加或重复关闭</small>
        </button>
      )}
    </>
  )
}

function ReplyBubble({ reply }: { reply: FeedbackReplyItem }) {
  const fromUser = reply.senderType === 'user'
  return (
    <div className={fromUser ? 'fb-bubble fb-bubble-mine' : 'fb-bubble'}>
      <div className="fb-bubble-head">
        <span>{fromUser ? '我的补充' : '服务回复'}</span>
        <span>{formatTime(reply.createdAt)}</span>
      </div>
      <p>{reply.content}</p>
    </div>
  )
}
