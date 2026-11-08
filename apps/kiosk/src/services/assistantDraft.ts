// 页面把一句问题交给 AI 顾问页（青序流光 2.0 的约定，见 v2 稿 05-ai-cockpit）：
// 只写 sessionStorage 的一个键；顾问页读到就填进输入框并立刻删掉，用户自己按发送才会发出。
// 清场也会删这个键（kioskSensitiveSession），换人后看不到上一位留下的问题。

import { useEffect } from 'react'

export const ASSISTANT_DRAFT_KEY = 'kiosk-assistant-draft'

export function rememberAssistantDraft(draft: string): void {
  try {
    sessionStorage.setItem(ASSISTANT_DRAFT_KEY, draft)
  } catch {
    // 写不进草稿也不拦跳转；顾问页照样可以自己提问。
  }
}

export function clearAssistantDraft(): void {
  try {
    sessionStorage.removeItem(ASSISTANT_DRAFT_KEY)
  } catch {
    // 存储不可用时本来也没写进去。
  }
}

// ── 「问小青这条」（2026-11-05 政策最小闭环）──────────────────────────────
// 政策详情把这条政策的编号和标题交给顾问页：顾问页读到后在输入框上方挂一个
// 「按《标题》原文讲解」的标记，用户发出的问题带上 policyId（AssistantChatRequestDto.policyId），
// 服务端按编号重新读已发布原文交给小青，前端不传正文。读一次就删；清场同样会删。

export const ASSISTANT_POLICY_KEY = 'kiosk-assistant-policy'

export interface AssistantPolicyContext {
  policyId: string
  title: string
}

/** 政策详情的「问小青这条」：写入政策标记和一句预填问题，由调用方再跳到 /assistant。 */
export function rememberAssistantPolicyQuestion(policy: { id: string; title: string }): void {
  const policyId = policy.id.trim()
  const title = policy.title.trim()
  if (!policyId) return
  try {
    sessionStorage.setItem(ASSISTANT_POLICY_KEY, JSON.stringify({ policyId, title } satisfies AssistantPolicyContext))
  } catch {
    // 写不进就只剩预填问题；小青照样能答通用问题。
  }
  rememberAssistantDraft(title ? `请用通俗的话讲讲这条政策：《${title}》` : '请用通俗的话讲讲这条政策')
}

/** 顾问页读一次就删；没有或读不出时返回 null。 */
export function takeAssistantPolicyContext(): AssistantPolicyContext | null {
  try {
    const raw = sessionStorage.getItem(ASSISTANT_POLICY_KEY)
    sessionStorage.removeItem(ASSISTANT_POLICY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AssistantPolicyContext>
    if (typeof parsed.policyId !== 'string' || !parsed.policyId.trim() || parsed.policyId.trim().length > 64) return null
    if (typeof parsed.title !== 'string') return null
    return { policyId: parsed.policyId.trim(), title: typeof parsed.title === 'string' ? parsed.title : '' }
  } catch {
    return null
  }
}

export function clearAssistantPolicyContext(): void {
  try {
    sessionStorage.removeItem(ASSISTANT_POLICY_KEY)
  } catch {
    // 存储不可用时本来也没写进去。
  }
}

/** 读一次就删；没有草稿或存储不可用时返回空串。 */
export function takeAssistantDraft(): string {
  try {
    const draft = sessionStorage.getItem(ASSISTANT_DRAFT_KEY) ?? ''
    sessionStorage.removeItem(ASSISTANT_DRAFT_KEY)
    return draft.trim()
  } catch {
    return ''
  }
}

/**
 * 顾问页挂载时收下草稿、填进输入框。放在 effect 里而不是 useState 初始化函数里：
 * StrictMode 会把初始化函数调两次，第一次已经删掉了键，第二次拿到空串就把草稿丢了。
 */
export function useAssistantDraftHandoff(fill: (draft: string) => void, maxLength: number): void {
  useEffect(() => {
    const draft = takeAssistantDraft()
    if (draft) fill(draft.slice(0, maxLength))
  }, [fill, maxLength])
}
