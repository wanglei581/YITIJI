import { timingSafeEqual } from 'crypto'

export function allowedOrigins(configured?: string[]): string[] {
  return [...new Set((configured ?? []).map((item) => item.trim()).filter(Boolean))]
}

export function isOriginAllowed(origin: string | undefined, allowed: string[]): origin is string {
  if (!origin) return false
  return allowed.includes(origin)
}

/**
 * U 盘本地网桥专用鉴权：Origin 白名单只挡浏览器发起的跨源请求，挡不住本机
 * 任意进程伪造 Origin 头直接调用文件读取接口。设计文档要求文件桥必须再加一层
 * 静态共享令牌（安装时随 Kiosk 构建和 Agent 配置一起下发，不走网络协商）。
 * 未配置令牌时一律判定为不可用（fail-closed），不得静默放行。
 */
export function isLocalBridgeTokenValid(
  headerValue: string | string[] | undefined,
  configuredToken: string | undefined,
): boolean {
  const token = configuredToken?.trim()
  if (!token) return false
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!provided) return false
  const providedBuf = Buffer.from(provided)
  const tokenBuf = Buffer.from(token)
  if (providedBuf.length !== tokenBuf.length) return false
  return timingSafeEqual(providedBuf, tokenBuf)
}
