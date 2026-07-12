import { timingSafeEqual } from 'crypto'

export function allowedOrigins(configured?: string[]): string[] {
  return [...new Set((configured ?? []).map((item) => item.trim()).filter(Boolean))]
}

export function isOriginAllowed(origin: string | undefined, allowed: string[]): origin is string {
  if (!origin) return false
  return allowed.includes(origin)
}

/**
 * U 盘本地网桥专用鉴权：Origin 白名单只挡浏览器发起的跨源请求。静态共享令牌
 * （安装时随 Kiosk 构建和 Agent 配置一起下发，不走网络协商）在其上追加一层
 * 防误调用 / 防非 Kiosk 页面直连的门槛。
 *
 * 诚实的威胁模型边界：令牌随 Kiosk 构建产物明文分发，本机上能读取静态资源的
 * 恶意进程可以提取它——这层令牌不构成对"本机任意进程"的安全边界；若该威胁
 * 在范围内，需换用 Windows Named Pipe + ACL 或运行期会话凭证（二期评估）。
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
