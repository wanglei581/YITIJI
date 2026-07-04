import { Button, Card, EmptyState } from '@ai-job-print/ui'
import { MessageSquareIcon } from 'lucide-react'
import { KIcon } from '../../../../components/kiosk-icon'
import type { FeedbackReplyItem, MemberFeedbackTicketDetail } from '../../../../services/api/memberFeedback'
import { formatTime } from '../../assets/format'
import { CATEGORY_META, feedbackInputClass, STATUS_META } from './types'

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
      <Card className="me-empty-card">
        <EmptyState
          icon={MessageSquareIcon}
          title={loading ? '正在读取详情' : '选择一条反馈查看详情'}
          description="可查看回复、补充描述或关闭反馈"
          className="py-12"
        />
      </Card>
    )
  }

  const status = STATUS_META[detail.status]
  const category = CATEGORY_META[detail.category]
  const canWrite = detail.status !== 'closed'

  return (
    <Card className="me-benefit-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={['me-chip', `me-tone-${category.tone}`].join(' ')}>{category.label}</span>
          <h2 className="mt-3 text-base font-extrabold text-[color:var(--ink)]">{detail.title || '未填写标题'}</h2>
          <p className="mt-1 text-xs text-[color:var(--muted)]">提交于 {formatTime(detail.createdAt)}</p>
        </div>
        <span className={['me-status', status.cls].join(' ')}>{status.label}</span>
      </div>

      <div className="me-note mt-4 p-3 text-sm leading-6 text-[color:var(--ink-2)]">{detail.content}</div>

      <div className="mt-4 flex flex-col gap-3">
        <h3 className="text-sm font-extrabold text-[color:var(--ink)]">沟通记录</h3>
        {detail.replies.length === 0 ? (
          <p className="me-note px-3 py-4 text-sm text-[color:var(--muted)]">暂无补充描述或回复</p>
        ) : (
          detail.replies.map((reply) => <ReplyBubble key={reply.id} reply={reply} />)
        )}
      </div>

      {canWrite && (
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs font-bold text-[color:var(--muted)]">补充描述</span>
          <textarea
            className={`${feedbackInputClass} min-h-[88px] resize-none`}
            value={replyContent}
            onChange={(event) => onReplyChange(event.target.value)}
            maxLength={500}
            placeholder="补充设备、打印或文件处理相关信息"
          />
        </label>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {canWrite && (
          <Button variant="outline" disabled={replyBusy} onClick={onAddReply} className="me-ripple rounded-full">
            <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
              <KIcon name="send" />
            </span>
            追加描述
          </Button>
        )}
        {canWrite ? (
          <Button variant="secondary" disabled={closeBusy} onClick={onClose} className="me-ripple rounded-full">
            <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
              <KIcon name="check" />
            </span>
            关闭反馈
          </Button>
        ) : (
          <span className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-[rgba(16,48,43,0.07)] px-3 text-sm font-bold text-[color:var(--muted)]">
            <KIcon name="close" className="h-4 w-4" />
            已关闭
          </span>
        )}
      </div>
    </Card>
  )
}

function ReplyBubble({ reply }: { reply: FeedbackReplyItem }) {
  const fromUser = reply.senderType === 'user'
  return (
    <div className={['rounded-2xl px-3 py-2', fromUser ? 'bg-[rgba(220,238,230,0.72)]' : 'bg-[rgba(16,48,43,0.06)]'].join(' ')}>
      <div className="flex items-center justify-between gap-2">
        <span className={['text-xs font-bold', fromUser ? 'text-[#246556]' : 'text-[color:var(--muted)]'].join(' ')}>
          {fromUser ? '我的补充' : '服务回复'}
        </span>
        <span className="text-xs text-[color:var(--muted)]">{formatTime(reply.createdAt)}</span>
      </div>
      <p className="mt-1 text-sm leading-6 text-[color:var(--ink-2)]">{reply.content}</p>
    </div>
  )
}
