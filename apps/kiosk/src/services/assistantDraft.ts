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
