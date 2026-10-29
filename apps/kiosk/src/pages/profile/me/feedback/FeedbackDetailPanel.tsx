import { KIcon } from '../../../../components/kiosk-icon'
import type { FeedbackReplyItem, MemberFeedbackTicketDetail } from '../../../../services/api/memberFeedback'
import { formatTime } from '../../assets/format'
import { MeActs, MeBtn, MeP } from '../../touch/MeKit'
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
      <section className="me-static">
        <b>{loading ? '正在读取详情' : '选择一条反馈查看详情'}</b>
        <small>可查看回复、补充描述或关闭反馈</small>
      </section>
    )
  }

  const status = STATUS_META[detail.status]
  const category = CATEGORY_META[detail.category]
  const canWrite = detail.status !== 'closed'

  return (
    <section className="me-form" aria-label="反馈详情">
      <b className="me-form-t">{detail.title || '未填写标题'}</b>
      <p className="me-p">{category.label} · 提交于 {formatTime(detail.createdAt)} · {status.label}</p>
      <p className="me-p">{detail.content}</p>

      <b className="me-form-t">沟通记录</b>
      {detail.replies.length === 0 ? (
        <MeP>暂无补充描述或回复</MeP>
      ) : (
        detail.replies.map((reply) => <ReplyBubble key={reply.id} reply={reply} />)
      )}

      {canWrite ? (
        <label className="fb-field">
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

      <MeActs>
        {canWrite ? (
          <MeBtn v="sec" disabled={replyBusy} onClick={onAddReply}>
            <KIcon name="send" />
            追加描述
          </MeBtn>
        ) : null}
        {canWrite ? (
          <MeBtn v="sec" disabled={closeBusy} onClick={onClose}>
            <KIcon name="check" />
            关闭反馈
          </MeBtn>
        ) : (
          <span className="me-chip">已关闭</span>
        )}
      </MeActs>
    </section>
  )
}

function ReplyBubble({ reply }: { reply: FeedbackReplyItem }) {
  const fromUser = reply.senderType === 'user'
  return (
    <div className="me-static" data-mine={fromUser ? 'true' : undefined}>
      <b>{fromUser ? '我的补充' : '服务回复'}</b>
      <small>{formatTime(reply.createdAt)}</small>
      <p className="me-p">{reply.content}</p>
    </div>
  )
}
