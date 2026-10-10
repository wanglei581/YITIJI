import type { FeedbackCategory } from '../../../../services/api/memberFeedback'

export type FeedbackUiState =
  | 'login'
  | 'service-unavailable'
  | 'loading'
  | 'error'
  | 'list-empty'
  | 'form-list'
  | 'submit-busy'
  | 'success'
  | 'failure'
  | 'detail-loading'
  | 'detail-ready'
  | 'reply-busy'
  | 'close-busy'

const STATE_SCREENS = ['login', 'service-unavailable', 'loading', 'error', 'detail-loading'] as const
export type FeedbackStateScreen = (typeof STATE_SCREENS)[number]

export function isFeedbackStateScreen(state: FeedbackUiState): state is FeedbackStateScreen {
  return (STATE_SCREENS as readonly string[]).includes(state)
}

export const DETAIL_STATES: readonly FeedbackUiState[] = [
  'detail-loading',
  'detail-ready',
  'reply-busy',
  'close-busy',
  'success',
]

export const FORM_STATES: readonly FeedbackUiState[] = [
  'list-empty',
  'form-list',
  'submit-busy',
  'failure',
]

/** 稿 40：空号或 11 位大陆手机号才算填对。 */
export function feedbackPhoneOk(phone: string): boolean {
  const value = phone.trim()
  return value === '' || /^1[3-9]\d{9}$/.test(value)
}

/** 稿 40 的按钮原因。空字符串表示可以提交。 */
export function feedbackSubmitWhy(length: number, categoryChosen: boolean, phoneOk: boolean): string {
  if (!categoryChosen && length < 10) return '请先选择分类，并写满 10 个字'
  if (!categoryChosen) return '请先选择一个分类'
  if (length < 10) return '请再写满 10 个字'
  if (!phoneOk) return '联系电话需为 11 位大陆手机号，或留空'
  return ''
}

export const CATEGORY_TONE: Record<FeedbackCategory, string | undefined> = {
  device: 'slate',
  print: 'wheat',
  file_process: undefined,
  general: 'plum',
  ai_content: 'plum',
}

export const AI_HELP_DRAFT = '我想反馈一个问题，怎么写才能说清楚？'
