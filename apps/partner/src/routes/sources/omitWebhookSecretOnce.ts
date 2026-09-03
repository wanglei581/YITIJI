/**
 * 创建响应里的一次性明文密钥不得进入列表 state。
 * 列表不渲染该字段，但对象会在整页生命周期内存活——同页 XSS / 日志序列化都能读到仍有效的密钥。
 */
export function omitWebhookSecretOnce<T extends { webhookSecretOnce?: string }>(
  source: T,
): Omit<T, 'webhookSecretOnce'> {
  const { webhookSecretOnce: _once, ...rest } = source
  return rest
}
