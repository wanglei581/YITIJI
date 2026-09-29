import { BadRequestException } from '@nestjs/common'
import * as net from 'net'
import { evaluateAiEndpoint, type AiEndpointRejectReason } from '../../common/outbound/ai-endpoint-allowlist'

const NOT_APPROVED_REASON_TEXT: Record<AiEndpointRejectReason, string> = {
  host_not_allowed: '这个模型地址不在已核准的服务商名单里',
  insecure_protocol: '模型地址必须以 https:// 开头',
  loopback_in_production: '正式环境的模型地址不能指向本机',
  invalid_url: '模型地址不是合法网址',
  unverifiable: '看不出这个模型地址会连到哪里',
}

/**
 * 模型地址必须在出站白名单里（common/outbound/ai-endpoint-allowlist.ts，与运行时
 * llmFetchJson 用的是同一个判定函数）。后台「保存」与「连通性测试」都调它：
 * 不在单内就拒绝 —— 不落盘、不发请求。
 *
 * 与下面的 assertPublicLlmBaseUrl 分开写：那个只管「内网 / 本机」，它的门禁
 * （verify:ai-config 7i）钉住了「不做 DNS、字面公网名放行」；白名单是另一道、更严的闸。
 */
export function assertApprovedLlmBaseUrl(raw: string, action: '保存' | '测试'): void {
  const verdict = evaluateAiEndpoint(raw.trim())
  if (verdict.allowed) return
  const reason = NOT_APPROVED_REASON_TEXT[verdict.reason ?? 'host_not_allowed']
  const outcome = action === '保存' ? '未保存' : '未测试，也没有发出请求'
  const hint = verdict.reason === 'host_not_allowed'
    ? '。请改选已核准的服务商；需要新增服务商时，先完成备案核准，再请技术人员加入名单'
    : ''
  throw new BadRequestException({
    error: { code: 'AI_BASE_URL_NOT_ALLOWED', message: `${reason}，${outcome}${hint}。` },
  })
}

/**
 * 管理员配置的模型 baseURL 不得指向本机 / 内网 / 链路本地。
 * 只做字面主机名与 IP 判断，不在写入路径做 DNS（避免把配置页变成慢探测）。
 * 连通性测试端点会再拦一次，防止环境变量里已有的内网地址被「测试」打到。
 *
 * 已知边界：不做 DNS，因此 `http://127.0.0.1.nip.io` 这类解析到内网的公网名会放行。
 */
export function assertPublicLlmBaseUrl(raw: string): void {
  const value = raw.trim()
  if (!value) {
    throw new BadRequestException({
      error: { code: 'AI_BASE_URL_INVALID', message: '模型地址不能为空' },
    })
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new BadRequestException({
      error: { code: 'AI_BASE_URL_INVALID', message: '模型地址不是合法 URL' },
    })
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException({
      error: { code: 'AI_BASE_URL_INVALID', message: '模型地址只允许 http 或 https' },
    })
  }
  if (isBlockedLlmHost(parsed.hostname)) {
    throw new BadRequestException({
      error: { code: 'AI_BASE_URL_PRIVATE', message: '模型地址不能指向本机或内网' },
    })
  }
}

/** URL.hostname 对 IPv6 带方括号（`[::1]`），且可能带 FQDN 末尾点（`localhost.`）。 */
function normalizeLlmHost(hostname: string): string {
  let host = hostname.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }
  while (host.endsWith('.')) host = host.slice(0, -1)
  return host
}

export function isBlockedLlmHost(hostname: string): boolean {
  const host = normalizeLlmHost(hostname)
  if (!host) return true
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true
  }
  if (!net.isIP(host)) return false
  if (net.isIPv6(host)) {
    return (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:')
    )
  }
  return (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
  )
}
