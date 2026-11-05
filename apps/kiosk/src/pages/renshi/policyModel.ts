import type { PolicyPostView, PublishedPoliciesResult } from '../../services/api/policies'

export const POLICY_CATEGORIES = [
  { key: 'graduate', label: '应届高校毕业生', icon: 'user' },
  { key: 'startup', label: '创业扶持', icon: 'landmark' },
  { key: 'flexible', label: '灵活就业人员', icon: 'folder' },
  { key: 'hardship', label: '困难群体就业援助', icon: 'shield' },
  { key: 'migrant', label: '返乡务工人员', icon: 'home' },
  { key: 'general', label: '通用', icon: 'book' },
] as const
export type PolicyAudience = typeof POLICY_CATEGORIES[number]['key']
export const POLICY_PAGE_SIZE = 4
export const POLICY_MISSING_FIELD = '发布机构没有提供这部分，请以原文为准'
export const POLICY_GENERAL_QUESTION = '这些政策怎么看？请说明怎样核对发布机构、条件、材料和原文入口，不判断我能不能领。'
export const POLICY_SOURCE_QUESTION = '政策原文怎么看？请说明原文里一般在哪里写条件、材料和办理地点，不判断我能不能领。'
/** 底栏问小青：首页与公告问「这些政策怎么看」，类别列表照稿问「政策原文怎么看」。 */
export const POLICY_ASK_HOME = { label: '问小青：这些政策怎么看？', draft: POLICY_GENERAL_QUESTION }
export const POLICY_ASK_LIST = { label: '问小青：政策原文怎么看？', draft: POLICY_SOURCE_QUESTION }

export function policyAudience(value: string | null): PolicyAudience | null {
  return POLICY_CATEGORIES.find((category) => category.key === value)?.key ?? null
}

export function policyPage(value: string | null): number {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

/** 汇总保留服务端 total；绝不用取回的一条推断全类条数。 */
export function policyCategorySummaries(results: PublishedPoliciesResult[]) {
  return POLICY_CATEGORIES.map((category, index) => {
    const result = results[index]
    return { ...category, total: result.total, latest: result.items[0], disabled: result.total === 0 }
  })
}

export function policyPagination(result: PublishedPoliciesResult) {
  const pages = Math.max(1, result.totalPages)
  return { page: result.page, pages, previous: result.page > 1, next: result.page < pages }
}

export function policyLines(value?: string | null): string[] {
  const lines = value?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? []
  return lines.length ? lines : [POLICY_MISSING_FIELD]
}

export function policySourceLink(policy: Pick<PolicyPostView, 'externalUrl' | 'externalUrlVerified'>):
  | { kind: 'verified'; url: string; host: string }
  | { kind: 'missing' | 'unverified'; message: string } {
  const url = policy.externalUrl?.trim()
  if (!url) return { kind: 'missing', message: '发布机构没有提供原文链接' }
  if (policy.externalUrlVerified === true) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) {
        return { kind: 'verified', url, host: parsed.host }
      }
    } catch { /* 格式无效时也不画二维码。 */ }
  }
  return { kind: 'unverified', message: '原文链接不在发布机构登记的官方网站内，暂不提供扫码' }
}

export function policyPrintButton(input: { busy: boolean; printerReady: boolean; printerLoading: boolean; blocked?: boolean }) {
  return {
    label: input.busy ? '正在生成办事清单…' : input.printerLoading ? '正在确认打印机状态…' : input.printerReady
      ? '打印办事清单（1 页）' : '打印机暂停服务 · 扫码把清单存到手机',
    disabled: input.busy || input.printerLoading || Boolean(input.blocked),
  }
}

export function policyFileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(0, Math.ceil(bytes / 1024))} KB`
}

export function policyPhoneExpiry(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '到期时刻未提供'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

/** 列表接口没有自带超时；未读到时进入可重试的失败态，不一直挂着读取中。 */
export async function policyRead<T>(request: Promise<T>, timeoutMs = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    request,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('policy read timeout')), timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}
