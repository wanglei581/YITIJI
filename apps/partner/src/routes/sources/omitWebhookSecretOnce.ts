/**
 * 创建响应里的一次性明文密钥不得进入列表 state。
 * 列表不渲染该字段，但对象会在整页生命周期内存活——同页 XSS / 日志序列化都能读到仍有效的密钥。
 */
export function omitWebhookSecretOnce<T extends { webhookSecretOnce?: string }>(
  source: T,
): Omit<T, 'webhookSecretOnce'> {
  // 用 delete 而非解构丢弃：解构写法会留下一个未使用变量，
  // 而本仓 eslint 未配 `_` 前缀忽略，会被 no-unused-vars 判红。
  // 不为这一处去放宽全局 lint 规则 —— 那等于为一个写法偏好拆掉一条真在起作用的检查。
  const rest = { ...source }
  delete (rest as { webhookSecretOnce?: string }).webhookSecretOnce
  return rest
}
