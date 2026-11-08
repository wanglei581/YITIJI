// 游客用 AI 时，后台「用 AI 前先登录」开着，服务端回 401 AI_LOGIN_REQUIRED。
// 取数层（services/terminalAuth）只报一声，这里转给全局登录提示（AiLoginRequiredHost）。
// 页面自己的那句错误照旧显示；这里只补一个直接去登录的按钮，不替页面重试。
// 一次操作常常连发几个请求，1.5 秒内只算一次，免得提示反复弹。

type Listener = () => void

const listeners = new Set<Listener>()
let lastNotifiedAt = 0

export function notifyAiLoginRequired(): void {
  const now = Date.now()
  if (now - lastNotifiedAt < 1500) return
  lastNotifiedAt = now
  for (const listener of [...listeners]) listener()
}

export function subscribeAiLoginRequired(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
