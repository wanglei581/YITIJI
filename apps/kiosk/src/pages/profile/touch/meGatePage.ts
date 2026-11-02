/** 我的各页的登录门要认出是哪一页；纯类型与映射，不放组件，免得拖累热更新。 */
export type MeGatePage =
  | 'notifications'
  | 'my-resumes'
  | 'my-orders'
  | 'my-docs'
  | 'my-ai'
  | 'my-activity'
  | 'my-fav'
  | 'my-benefits'
  | 'feedback'
  | 'privacy'

export function gatePageFromTitle(title: string): MeGatePage {
  if (title.includes('文档')) return 'my-docs'
  if (title.includes('简历')) return 'my-resumes'
  if (title.includes('订单')) return 'my-orders'
  if (title.includes('AI')) return 'my-ai'
  if (title.includes('收藏')) return 'my-fav'
  if (title.includes('消息')) return 'notifications'
  if (title.includes('权益')) return 'my-benefits'
  if (title.includes('反馈')) return 'feedback'
  if (title.includes('隐私')) return 'privacy'
  return 'my-activity'
}
