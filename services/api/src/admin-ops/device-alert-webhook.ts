/**
 * 机构设备告警的群机器人地址。
 * 只接受企业微信、钉钉、飞书三家的 https 地址；不跟随重定向；超时 5 秒。
 * 地址当密钥：校验失败的文案不带回主机名，日志也不写地址。
 */

const ALLOWED_HOSTS = new Set(['qyapi.weixin.qq.com', 'oapi.dingtalk.com', 'open.feishu.cn'])
const MAX_URL_LENGTH = 500

export class DeviceAlertWebhookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceAlertWebhookError'
  }
}

export function assertDeviceAlertWebhookUrl(raw: string): string {
  const url = raw.trim()
  if (url.length === 0) throw new DeviceAlertWebhookError('请填写通知地址')
  if (url.length > MAX_URL_LENGTH) throw new DeviceAlertWebhookError('通知地址过长')
  if (url.includes('密钥已隐藏') || url.includes('…')) {
    throw new DeviceAlertWebhookError('请填写完整的通知地址。页面上打码后的地址不能再次保存')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new DeviceAlertWebhookError('通知地址只接受企业微信、钉钉或飞书的群机器人')
  }
  if (parsed.username || parsed.password) {
    throw new DeviceAlertWebhookError('通知地址不能带账号或密码')
  }
  if (parsed.protocol !== 'https:') {
    throw new DeviceAlertWebhookError('通知地址只能使用 https')
  }
  if (parsed.port && parsed.port !== '443') {
    throw new DeviceAlertWebhookError('通知地址只接受企业微信、钉钉或飞书的群机器人')
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new DeviceAlertWebhookError('通知地址只接受企业微信、钉钉或飞书的群机器人')
  }
  return url
}

/** 保存后只回显打码地址。查询串（机器人密钥）整段不出现。 */
export function maskWebhookUrl(url: string): string {
  const parsed = new URL(url)
  const path = parsed.pathname
  const head = path.length <= 16 ? path : `${path.slice(0, 12)}…`
  return `https://${parsed.host}${head}（密钥已隐藏）`
}

export function groupRobotBody(url: string, text: string): Record<string, unknown> {
  const host = new URL(url).hostname
  if (host === 'open.feishu.cn') return { msg_type: 'text', content: { text } }
  return { msgtype: 'text', text: { content: text } }
}

function vendorAccepted(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const record = body as Record<string, unknown>
  if (typeof record.errcode === 'number') return record.errcode === 0
  if (typeof record.code === 'number') return record.code === 0
  return false
}

/**
 * 发一条文本。redirect=manual：3xx 当失败，不读取 Location，也不再请求。
 * 失败文案是固定中文，不带地址、不带对方返回体。
 */
export async function postGroupRobot(url: string, text: string, fetchImpl: typeof fetch): Promise<void> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(groupRobotBody(url, text)),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    throw new DeviceAlertWebhookError('测试消息没有发出去，请核对地址后重试')
  }
  if (response.status >= 300 && response.status < 400) {
    throw new DeviceAlertWebhookError('测试消息没有发出去，请核对地址后重试')
  }
  if (!response.ok) throw new DeviceAlertWebhookError('测试消息没有发出去，请核对地址后重试')
  const body = await response.json().catch(() => null)
  if (!vendorAccepted(body)) throw new DeviceAlertWebhookError('测试消息没有发出去，请核对地址后重试')
}
