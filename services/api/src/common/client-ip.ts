/**
 * 解析客户端 IP：只信任 Express 在 trust proxy 配置后填充的 req.ip。
 * 禁止读取未受信的 X-Forwarded-For（客户端可伪造）。
 */

function asRecord(req: unknown): Record<string, unknown> | null {
  if (!req || typeof req !== 'object') return null
  return req as Record<string, unknown>
}

export function resolveClientIp(req: unknown): string | null {
  const record = asRecord(req)
  if (!record) return null

  const fromExpress = typeof record.ip === 'string' ? record.ip.trim() : ''
  if (fromExpress) return fromExpress

  const socket = asRecord(record.socket)
  const remote =
    socket && typeof socket.remoteAddress === 'string'
      ? socket.remoteAddress.trim()
      : ''
  return remote || null
}

export function resolveClientIpOrUnknown(req: unknown): string {
  return resolveClientIp(req) ?? 'unknown'
}
