import { KIcon } from '../../../../components/kiosk-icon'
import type { FeedbackReplyItem, MemberFeedbackTicketDetail } from '../../../../services/api/memberFeedback'
import { formatTime } from '../../assets/format'
import { CATEGORY_META, STATUS_META } from './types'

export function FeedbackDetailPanel({
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
      <section className="qx-card">
        <div className="qx-state" data-tone="empty">
          <span className="qx-state-ic" />
          <span>
            <div className="qx-state-t">{loading ? '正在读取详情' : '选择一条反馈查看详情'}</div>
            <p className="qx-state-d">可查看回复、补充描述或关闭反馈</p>
          </span>
        </div>
      </section>
    )
  }

  const status = STATUS_META[detail.status]
  const category = CATEGORY_META[detail.category]
  const canWrite = detail.status !== 'closed'

  return (
    <section className="qx-card">
      <div className="qx-sec-h">
        <h2 className="t">{detail.title || '未填写标题'}</h2>
        <span className="fb-st">{status.label}</span>
      </div>
      <p className="qx-row-d">{category.label} · 提交于 {formatTime(detail.createdAt)}</p>
      <p className="fb-note" style={{ marginTop: 14 }}>{detail.content}</p>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 className="qx-row-t">沟通记录</h3>
        {detail.replies.length === 0 ? (
          <p className="fb-legal">暂无补充描述或回复</p>
        ) : (
          detail.replies.map((reply) => <ReplyBubble key={reply.id} reply={reply} />)
        )}
      </div>

      {canWrite ? (
        <label className="fb-field" style={{ marginTop: 16 }}>
          <span className="fb-field-label">补充描述</span>
          <textarea
            className="fb-textarea"
            value={replyContent}
            onChange={(event) => onReplyChange(event.target.value)}
            maxLength={500}
            placeholder="补充设备、打印或文件处理相关信息"
          />
        </label>
      ) : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        {canWrite ? (
          <button type="button" className="qx-btn" data-variant="ghost" disabled={replyBusy} onClick={onAddReply}>
            <KIcon name="send" />
            追加描述
          </button>
        ) : null}
        {canWrite ? (
          <button type="button" className="qx-btn" data-variant="ghost" disabled={closeBusy} onClick={onClose}>
            <KIcon name="check" />
            关闭反馈
          </button>
        ) : (
          <span className="fb-st">已关闭</span>
        )}
      </div>
    </section>
  )
}

function ReplyBubble({ reply }: { reply: FeedbackReplyItem }) {
  const fromUser = reply.senderType === 'user'
  return (
    <div className="qx-card" data-mine={fromUser ? 'true' : undefined}>
      <div className="qx-sec-h">
        <span className="t">{fromUser ? '我的补充' : '服务回复'}</span>
        <span className="hint">{formatTime(reply.createdAt)}</span>
      </div>
      <p className="qx-row-d">{reply.content}</p>
    </div>
  )
}
