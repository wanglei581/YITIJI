export type MemberNotificationCategory = 'system' | 'print' | 'ai' | 'feedback'
export type SystemBroadcastCategory = 'system' | 'maintenance' | 'notice'
export type NotificationKind = 'personal' | 'broadcast'
export type MemberNotificationRelatedType = 'feedback_ticket' | 'print_task' | 'ai_resume_result'

export interface MemberNotificationItem {
  id: string
  kind: NotificationKind
  title: string
  content: string
  category: MemberNotificationCategory | SystemBroadcastCategory
  relatedType: MemberNotificationRelatedType | null
  relatedId: string | null
  isRead: boolean
  createdAt: string
}

export interface MemberNotificationPage {
  items: MemberNotificationItem[]
  nextCursor: string | null
  total: number
  unreadCount: number
}

export interface AdminBroadcastItem {
  id: string
  title: string
  content: string
  category: SystemBroadcastCategory
  deletedAt: string | null
  createdBy: string | null
  createdAt: string
}
