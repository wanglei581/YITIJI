export type FeedbackCategory = 'device' | 'print' | 'file_process' | 'general'
export type FeedbackStatus = 'pending' | 'processing' | 'replied' | 'closed'
export type FeedbackSenderType = 'user' | 'admin' | 'system'

export interface FeedbackReplyItem {
  id: string
  senderType: FeedbackSenderType
  actorId: string | null
  content: string
  createdAt: string
}

/** member = 会员经 /me/feedback 提交；anonymous_kiosk = 一体机经 /kiosk/feedback 匿名提交。 */
export type FeedbackSubmitterType = 'member' | 'anonymous_kiosk'

export interface MemberFeedbackTicketItem {
  id: string
  category: FeedbackCategory
  title: string | null
  content: string
  contactPhoneMasked: string | null
  terminalId: string | null
  relatedPrintTaskId: string | null
  status: FeedbackStatus
  createdAt: string
  updatedAt: string
}

export interface MemberFeedbackTicketDetail extends MemberFeedbackTicketItem {
  replies: FeedbackReplyItem[]
}

export interface MemberFeedbackPage {
  items: MemberFeedbackTicketItem[]
  nextCursor: string | null
  total: number
  truncated: boolean
}

export interface AdminFeedbackTicketPage {
  items: AdminFeedbackTicketItem[]
  total: number
  truncated: boolean
}

export interface AdminFeedbackTicketItem extends MemberFeedbackTicketItem {
  submitterType: FeedbackSubmitterType
  /** 匿名一体机工单为 null —— 没有账号归属，不能回复、不能推通知，只能现场处置。 */
  endUserId: string | null
  phoneMasked: string | null
  nickname: string | null
  relatedScanTaskId: string | null
  /** 打印完成页满意度三档；null = 未评价。 */
  satisfaction: 'good' | 'fair' | 'bad' | null
}

export interface AdminFeedbackTicketDetail extends AdminFeedbackTicketItem {
  replies: FeedbackReplyItem[]
}
