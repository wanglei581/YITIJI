import { ForbiddenException, Logger } from '@nestjs/common'
import { BlockList, isIP } from 'node:net'

/**
 * 管理员来源 IP 限制（P1-4，2026-09-29；feature-scope §七 #27「管理员登录没有二次验证与来源 IP 限制」）。
 *
 * `ADMIN_IP_ALLOWLIST`：逗号分隔的 IP 或 CIDR（IPv4 / IPv6，例如 `203.0.113.7, 198.51.100.0/24`）。
 * - 不设置或为空：不限制（今天的行为）。试点前由产品负责人在服务器 `.env` 里按办公网络出口配置。
 * - 设置后：管理员角色的**每一个**已登录请求与管理员入口的登录请求，都必须来自名单内的地址；
 *   合作机构与一体机内部账号不受影响。
 * - 配置写错（任何一项解析不了）：失败关闭——管理员一律被拒，错误码写明是配置问题，
 *   不能因为一处笔误就变成「谁都能进」。
 *
 * 客户端 IP 只信 Express 在 trust proxy 配置后填的 `req.ip`（`common/client-ip.ts`）；
 * 生产的反代跳数由启动闸门强制显式声明（`config/trust-proxy.ts`）。
 *
 * 为什么单独成文件：它要被登录（auth.service）与鉴权（optional-internal-user）两条路径共用，
 * 放进任何一边都会让另一边反向依赖。
 */

export const ADMIN_IP_ALLOWLIST_ENV = 'ADMIN_IP_ALLOWLIST'

type AllowlistState =
  | { kind: 'off' }
  | { kind: 'active'; list: BlockList; raw: string }
  | { kind: 'invalid'; raw: string; bad: string }

const logger = new Logger('AdminIpAllowlist')
let cache: { raw: string; state: AllowlistState } | null = null

function parse(raw: string): AllowlistState {
  const entries = raw.split(',').map((item) => item.trim()).filter(Boolean)
  if (entries.length === 0) return { kind: 'off' }
  const list = new BlockList()
  for (const entry of entries) {
    const slash = entry.indexOf('/')
    const address = slash >= 0 ? entry.slice(0, slash) : entry
    const family = isIP(address)
    if (family === 0) return { kind: 'invalid', raw, bad: entry }
    const type = family === 4 ? 'ipv4' : 'ipv6'
    if (slash < 0) {
      list.addAddress(address, type)
      continue
    }
    const prefixText = entry.slice(slash + 1)
    const prefix = Number(prefixText)
    const max = family === 4 ? 32 : 128
    if (!/^\d{1,3}$/.test(prefixText) || !Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      return { kind: 'invalid', raw, bad: entry }
    }
    list.addSubnet(address, prefix, type)
  }
  return { kind: 'active', list, raw }
}

function currentState(): AllowlistState {
  const raw = process.env[ADMIN_IP_ALLOWLIST_ENV]?.trim() ?? ''
  if (cache && cache.raw === raw) return cache.state
  const state = parse(raw)
  if (state.kind === 'invalid') {
    // 只记出错的那一项，不回显整串（可能含内部网段规划）。
    logger.error(`ADMIN_IP_ALLOWLIST_INVALID entry=${JSON.stringify(state.bad.slice(0, 64))}：管理员请求将一律被拒，直到修正配置`)
  }
  cache = { raw, state }
  return state
}

/** `::ffff:1.2.3.4` 这类 IPv4 映射地址按 IPv4 判定（双栈监听时 Express 会给出这种形式）。 */
function normalizeClientIp(ip: string): { address: string; type: 'ipv4' | 'ipv6' } | null {
  let value = ip.trim()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value)
  if (mapped) value = mapped[1]!
  const family = isIP(value)
  if (family === 0) return null
  return { address: value, type: family === 4 ? 'ipv4' : 'ipv6' }
}

export type AdminIpDecision = 'unrestricted' | 'allowed' | 'denied' | 'config_invalid'

/** 纯判定，不抛错；调用方决定如何拒绝。 */
export function decideAdminIp(clientIp: string | null | undefined): AdminIpDecision {
  const state = currentState()
  if (state.kind === 'off') return 'unrestricted'
  if (state.kind === 'invalid') return 'config_invalid'
  const normalized = clientIp ? normalizeClientIp(clientIp) : null
  if (!normalized) return 'denied'
  return state.list.check(normalized.address, normalized.type) ? 'allowed' : 'denied'
}

/**
 * 针对某个账号角色的放行判定（不抛错）：非管理员一律放行；管理员按名单。
 * 给「找回密码」这类不能泄露账号角色的入口用——拒绝时由调用方回通用失败，不回 403。
 */
export function isAdminIpAllowedForRole(role: string, clientIp: string | null | undefined): boolean {
  if (role !== 'admin') return true
  const decision = decideAdminIp(clientIp)
  return decision === 'unrestricted' || decision === 'allowed'
}

/** 管理员请求的来源地址不在名单内时抛 403；未配置名单时不做任何事。 */
export function assertAdminIpAllowed(clientIp: string | null | undefined): void {
  const decision = decideAdminIp(clientIp)
  if (decision === 'unrestricted' || decision === 'allowed') return
  if (decision === 'config_invalid') {
    throw new ForbiddenException({
      error: {
        code: 'AUTH_ADMIN_IP_CONFIG_INVALID',
        message: '管理员访问地址名单配置有误，暂时无法进入管理后台，请联系系统维护人员修正',
      },
    })
  }
  throw new ForbiddenException({
    error: {
      code: 'AUTH_ADMIN_IP_FORBIDDEN',
      message: '当前网络不在管理员允许的访问地址范围内，请在指定网络下使用管理后台',
    },
  })
}

/** 仅供门禁复位缓存。 */
export function resetAdminIpAllowlistCacheForTests(): void {
  cache = null
}
