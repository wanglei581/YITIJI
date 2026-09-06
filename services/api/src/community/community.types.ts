export type CommunityFeedKind = 'policy' | 'benefit' | 'broadcast'

export type CommunityFeedItem = {
  id: string
  kind: CommunityFeedKind
  title: string
  summary: string
  sourceName: string
  publishedAt: string
  action: {
    label: '查看政策' | '查看权益' | '查看通知'
    route: string
  }
}

export type CommunityFeedPage = {
  items: CommunityFeedItem[]
  nextCursor: string | null
  commentsEnabled: false
}
