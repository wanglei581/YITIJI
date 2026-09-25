/**
 * 小青按渠道过滤跳转。
 *
 * 页面清单单独放在这里，是为了和 apps/miniapp/app.json（含分包）对账。
 * 对账逻辑在 verify 里读 app.json；清单继续堆进 llm-chat.service 会把那个文件顶过行数线。
 */
import { containsForbiddenWord } from './llm-guard'

export type AssistantChannel = 'kiosk' | 'miniapp'

export interface ChannelAction {
  label: string
  route: string
}

/** 与 apps/miniapp/app.json 的 pages + subpackages 一致，不含前导斜杠。 */
export const MINIAPP_REGISTERED_PAGES = [
  'pages/home/home',
  'pages/launch/launch',
  'pages/ai/ai',
  'pages/print/print',
  'pages/me/me',
  'pages/assistant/assistant',
  'pages/package-create/package-create',
  'pages/store-select/store-select',
  'pages/package-confirm/package-confirm',
  'pages/package-code/package-code',
  'pages/print-upload/print-upload',
  'pages/print-store/print-store',
  'pages/print-pay/print-pay',
  'pages/print-pickup/print-pickup',
  'pages/resume-build/resume-build',
  'pages/resume-voice/resume-voice',
  'pages/resume-upload/resume-upload',
  'pages/resume-diagnose/resume-diagnose',
  'pages/resume-optimize/resume-optimize',
  'pages/interview-entry/interview-entry',
  'pages/interview-qa/interview-qa',
  'pages/interview-result/interview-result',
  'pages/career-plan/career-plan',
  'pages/self-explore/self-explore',
  'pages/job-fit/job-fit',
  'pages/print-preview/print-preview',
  'pages/usb-import/usb-import',
  'pages/resume-parse/resume-parse',
  'pages/resumes/resumes',
  'pages/documents/documents',
  'pages/job-materials/job-materials',
  'pages/orders/orders',
  'pages/order-detail/order-detail',
  'pages/ai-records/ai-records',
  'pages/settings/settings',
  'pages/privacy/privacy',
  'pages/help/help',
  'pages/about/about',
  'pages/legal/legal',
  'pages/notifications/notifications',
  'pages/kiosk-login/kiosk-login',
  'pages/kiosk-send/kiosk-send',
  'pages/daily-report/daily-report',
  'pages/feedback/feedback',
] as const

const MINIAPP_PAGE_SET = new Set<string>(MINIAPP_REGISTERED_PAGES)

/** 一体机 route（无 query）→ 小程序已注册页面。没有对应页的不出现在表里。 */
const KIOSK_ROUTE_TO_MINIAPP_PAGE: Record<string, string> = {
  '/resume/source': 'pages/resume-upload/resume-upload',
  '/resume/report': 'pages/resume-diagnose/resume-diagnose',
  '/resume/optimize': 'pages/resume-optimize/resume-optimize',
  '/print/upload': 'pages/print-upload/print-upload',
  '/print': 'pages/print/print',
  '/resume-service': 'pages/ai/ai',
  '/interview/setup': 'pages/interview-entry/interview-entry',
  '/resume/self-assessment/intro': 'pages/self-explore/self-explore',
  '/career-plan': 'pages/career-plan/career-plan',
  '/job-fit': 'pages/job-fit/job-fit',
}

const LABEL_BLOCK = /招聘会|查看岗位|浏览岗位|岗位信息|岗位列表|找企业|查看企业|企业资料|人社|政策/

const REPLY_FORBIDDEN_BASE = [
  '招聘会',
  '查看岗位',
  '看看岗位',
  '去看岗位',
  '浏览岗位',
  '岗位列表',
  '岗位信息',
  '找企业',
  '查看企业',
  '企业资料',
  '企业展示',
  '去看企业',
] as const

const POLICY_FORBIDDEN = ['政策', '人社专区', '人社政策'] as const

const POLICY_PAGE_HINT = /(?:^|\/)(?:policy|policies|renshi)(?:\/|$)/i

export const MINIAPP_REPLY_FALLBACK = '我可以帮你整理简历、准备面试或打印材料。请换一个具体问题。'

export function resolveAssistantChannel(channel: string | undefined): AssistantChannel {
  return channel === 'miniapp' ? 'miniapp' : 'kiosk'
}

export function miniappPolicyPage(pages: readonly string[] = MINIAPP_REGISTERED_PAGES): string | null {
  return pages.find((page) => POLICY_PAGE_HINT.test(page)) ?? null
}

export function miniappReplyForbiddenWords(pages: readonly string[] = MINIAPP_REGISTERED_PAGES): string[] {
  return miniappPolicyPage(pages) ? [...REPLY_FORBIDDEN_BASE] : [...REPLY_FORBIDDEN_BASE, ...POLICY_FORBIDDEN]
}

export function miniappChannelConstraint(pages: readonly string[] = MINIAPP_REGISTERED_PAGES): string {
  const policyPage = miniappPolicyPage(pages)
  const policyLine = policyPage
    ? `如需提及政策，只能引导到已注册页面 /${policyPage}，不要引导岗位、招聘会或企业。`
    : '不要提及政策、补贴办理入口或人社专区。本渠道没有政策页面。'
  return [
    '当前请求来自小程序。',
    '不要引导用户查看岗位、招聘会或企业资料，也不要给出这些内容的入口。',
    policyLine,
    '可以继续帮助整理简历、准备面试、打印材料和职业规划。',
  ].join('\n')
}

export function scrubMiniappReply(reply: string, pages: readonly string[] = MINIAPP_REGISTERED_PAGES): string {
  const words = miniappReplyForbiddenWords(pages)
  if (!containsForbiddenWord(reply, words)) return reply
  if (!containsForbiddenWord(MINIAPP_REPLY_FALLBACK, words)) return MINIAPP_REPLY_FALLBACK
  return '请换一个问题。'
}

export function filterAssistantActions(
  actions: ChannelAction[] | undefined,
  channel: AssistantChannel,
): ChannelAction[] | undefined {
  if (channel !== 'miniapp') return actions
  if (!actions?.length) return undefined
  const kept: ChannelAction[] = []
  for (const action of actions) {
    const path = action.route.split('?')[0]
    const page = KIOSK_ROUTE_TO_MINIAPP_PAGE[path]
    if (!page || !MINIAPP_PAGE_SET.has(page)) continue
    if (LABEL_BLOCK.test(action.label)) continue
    kept.push({ label: action.label, route: `/${page}` })
  }
  return kept.length ? kept : undefined
}

export function applyAssistantChannel<T extends { reply: string; actions?: ChannelAction[] }>(
  output: T,
  channel: string | undefined,
): T {
  const resolved = resolveAssistantChannel(channel)
  if (resolved === 'kiosk') return output
  return {
    ...output,
    reply: scrubMiniappReply(output.reply),
    actions: filterAssistantActions(output.actions, 'miniapp'),
  } as T
}
