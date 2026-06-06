/**
 * 宣传屏「外部视频直链」URL 校验(服务端)。
 *
 * 合规/安全边界:
 *   - 只允许 https 直链(http 明文 / data:/ blob:/ file: 等一律拒绝)
 *   - 只允许 mp4 / webm 直链;不支持 iframe、B站/抖音/YouTube 等页面链接
 *   - SSRF 防护:禁止 localhost / 回环 / 私网 / 链路本地 / 内网域名,
 *     即使本期由 Kiosk 浏览器直接拉流(非服务端 fetch),也不允许把内网地址
 *     落库展示——避免泄露内网拓扑、避免终端被诱导访问内网资源。
 *   - 可选白名单:ALLOWED_EXTERNAL_VIDEO_HOSTS(逗号分隔 host),配置后
 *     只允许名单内主机;留空则放行所有通过私网检查的公网主机。
 *
 * 注意:本期不做服务端探测(HEAD/Range),不验证对端真实 Content-Type;
 * 只基于 URL 形态做静态校验,真实可播性由 Kiosk 播放时兜底(onError 跳过)。
 */

export type ExternalVideoMime = 'video/mp4' | 'video/webm'

export type ExternalVideoValidateResult =
  | { ok: true; normalizedUrl: string; mimeType: ExternalVideoMime; ext: 'mp4' | 'webm' }
  | { ok: false; code: string; message: string }

const EXT_TO_MIME: Record<string, ExternalVideoMime> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
}

/** 内网/保留域名后缀(单标签主机如 'intranet' 也按内网处理)。 */
const INTERNAL_TLDS = ['.local', '.localhost', '.internal', '.intranet', '.lan', '.corp', '.home', '.localdomain']

function fail(code: string, message: string): ExternalVideoValidateResult {
  return { ok: false, code, message }
}

/** 读取 ALLOWED_EXTERNAL_VIDEO_HOSTS 白名单(小写、去空、去端口)。空数组表示未配置。 */
function allowedHosts(): string[] {
  const raw = process.env['ALLOWED_EXTERNAL_VIDEO_HOSTS']
  if (!raw) return []
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0)
}

/** IPv4 私网 / 回环 / 链路本地 / 保留地址。 */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const o = m.slice(1, 5).map(Number)
  if (o.some((n) => n > 255)) return true // 非法 IPv4 一律拒绝
  const [a, b] = o as [number, number, number, number]
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 回环
  if (a === 169 && b === 254) return true // 169.254.0.0/16 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a >= 224) return true // 224.0.0.0/4 组播 + 240.0.0.0/4 保留
  return false
}

/** IPv6 回环 / 唯一本地 / 链路本地 / 未指定。host 不含方括号。 */
function isPrivateIPv6(host: string): boolean {
  if (!host.includes(':')) return false
  const h = host.toLowerCase()
  if (h === '::1' || h === '::') return true // 回环 / 未指定
  if (h.startsWith('fe80:') || h.startsWith('fe80::')) return true // 链路本地 fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd')) return true // 唯一本地 fc00::/7
  // IPv4-mapped (::ffff:10.0.0.1 等):取末段按 IPv4 判定
  const tail = h.split(':').pop() ?? ''
  if (tail.includes('.') && isPrivateIPv4(tail)) return true
  return false
}

function isInternalHostname(host: string): boolean {
  if (host === 'localhost') return true
  // 单标签主机(无点)视为内网短名,如 'router' / 'nas'
  if (!host.includes('.')) return true
  return INTERNAL_TLDS.some((tld) => host.endsWith(tld))
}

/**
 * 校验外部视频直链。通过则返回归一化 URL + 推断的 mime/ext。
 */
export function validateExternalVideoUrl(rawUrl: string): ExternalVideoValidateResult {
  const input = (rawUrl ?? '').trim()
  if (!input) {
    return fail('EXTERNAL_VIDEO_URL_REQUIRED', '外部视频链接不能为空')
  }
  if (input.length > 2048) {
    return fail('EXTERNAL_VIDEO_URL_TOO_LONG', '外部视频链接过长(上限 2048 字符)')
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return fail('EXTERNAL_VIDEO_URL_INVALID', '链接格式不合法')
  }

  if (url.protocol !== 'https:') {
    return fail('EXTERNAL_VIDEO_URL_NOT_HTTPS', '仅支持 HTTPS 直链')
  }
  // URL 内嵌账号密码可被用于绕过/钓鱼,直接拒绝
  if (url.username || url.password) {
    return fail('EXTERNAL_VIDEO_URL_HAS_CREDENTIALS', '链接不允许包含账号密码')
  }

  // hostname:去掉 IPv6 方括号,统一小写
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) {
    return fail('EXTERNAL_VIDEO_URL_INVALID', '链接缺少主机名')
  }
  if (isInternalHostname(host) || isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return fail('EXTERNAL_VIDEO_URL_PRIVATE_HOST', '不允许内网 / 本机 / 保留地址的链接')
  }

  const whitelist = allowedHosts()
  if (whitelist.length > 0 && !whitelist.includes(host)) {
    return fail('EXTERNAL_VIDEO_URL_HOST_NOT_ALLOWED', '该域名不在允许的外部视频白名单内')
  }

  // 扩展名:取 pathname 末段,忽略 query/hash(URL 已剥离)
  const ext = url.pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  const mimeType = EXT_TO_MIME[ext]
  if (!mimeType) {
    return fail(
      'EXTERNAL_VIDEO_URL_NOT_DIRECT',
      '仅支持 .mp4 / .webm 视频直链(不支持网页 / iframe / B站 / 抖音 / YouTube 链接)',
    )
  }

  return { ok: true, normalizedUrl: url.toString(), mimeType, ext: ext as 'mp4' | 'webm' }
}
