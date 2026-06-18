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
}

export interface AdminFeedbackTicketItem extends MemberFeedbackTicketItem {
  endUserId: string
  phoneMasked: string
  nickname: string | null
}

export interface AdminFeedbackTicketDetail extends AdminFeedbackTicketItem {
  replies: FeedbackReplyItem[]
}
