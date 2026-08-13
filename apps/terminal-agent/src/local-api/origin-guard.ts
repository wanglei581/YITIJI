import { timingSafeEqual } from 'crypto'

export function allowedOrigins(configured?: string[]): string[] {
  return [...new Set((configured ?? []).map((item) => item.trim()).filter(Boolean))]
}

export function isOriginAllowed(origin: string | undefined, allowed: string[]): origin is string {
  if (!origin) return false
  return allowed.includes(origin)
}

/**
 * 旧终端静态网桥令牌的兼容校验。新安装使用 bridge-session.ts 签发的
 * Origin-bound 短期会话，不再把共享令牌放进 MSI 或公开 Kiosk 构建产物。
 *
 * 静态令牌不构成对本机任意进程的安全边界；未配置时本函数始终拒绝，调用方
 * 必须再显式校验短期会话，不能因为静态配置为空而直接放行。
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
