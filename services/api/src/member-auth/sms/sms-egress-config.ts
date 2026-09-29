import { BlockList, isIP } from 'node:net'

/**
 * 会员短信「受信出口」的启动校验与地址匹配。
 *
 * 为什么单独成文件：`main.ts` 必须在装载 Nest 之前拒绝不合格配置。
 * 本文件只依赖 `node:net`，不能引入 Redis、告警或数据库，
 * 否则启动检查会把整套业务提前拉起来。
 * 请求路径只读这里缓存的结果，不再读环境变量，避免跑起来之后改环境把进程打崩。
 */

export const SMS_TRUSTED_EGRESS_CIDRS_ENV = 'SMS_TRUSTED_EGRESS_CIDRS'
export const SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT_ENV = 'SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT'
export const SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT_ENV = 'SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT'

export const DEFAULT_TRUSTED_EGRESS_HOURLY_LIMIT = 100
export const MAX_TRUSTED_EGRESS_HOURLY_LIMIT = 200
export const DEFAULT_TRUSTED_EGRESS_MINUTE_LIMIT = 15
export const MAX_TRUSTED_EGRESS_MINUTE_LIMIT = 30

/** 不带已验签终端、也不在受信地址段里时，每个地址每小时的条数。 */
export const IP_HOURLY_MAX = 20
/** 已验签终端每小时条数。不做成环境变量，避免大厅被配成没有上限。 */
export const TERMINAL_HOURLY_MAX = 30

const IPV4_MIN_PREFIX = 24
const IPV6_MIN_PREFIX = 56

export interface TrustedEgressRule {
  token: string
  prefix: number
  family: 'ipv4' | 'ipv6'
  list: BlockList
}

export interface SmsTrustedEgressConfig {
  enabled: boolean
  hourlyLimit: number
  minuteLimit: number
  rules: readonly TrustedEgressRule[]
}

type Env = Record<string, string | undefined>

const disabledConfig = (): SmsTrustedEgressConfig => ({
  enabled: false,
  hourlyLimit: DEFAULT_TRUSTED_EGRESS_HOURLY_LIMIT,
  minuteLimit: DEFAULT_TRUSTED_EGRESS_MINUTE_LIMIT,
  rules: [],
})

let active: SmsTrustedEgressConfig = disabledConfig()

function sliceRaw(value: string): string {
  return value.length > 32 ? `${value.slice(0, 32)}…` : value
}

function quote(value: string): string {
  return `「${sliceRaw(value)}」`
}

/** 正整数，拒绝前导零、小数、正负号。空串表示用默认值。 */
function positiveInt(raw: string | undefined, ceiling: number, label: string, problems: string[]): number | null {
  const text = raw?.trim() ?? ''
  if (!text) return null
  if (!/^[1-9]\d*$/.test(text)) {
    problems.push(`${label}必须是 1 到 ${ceiling} 的整数，现在写的是${quote(text)}。`)
    return null
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value > ceiling) {
    problems.push(`${label}必须是 1 到 ${ceiling} 的整数，现在写的是${quote(text)}。`)
    return null
  }
  return value
}

function isStrictIpv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
}

function parseCidr(token: string, problems: string[]): TrustedEgressRule | null {
  const slash = token.indexOf('/')
  if (slash <= 0) {
    problems.push(`${quote(token)}不是合法的地址段。请写成 203.0.113.0/24 或 2001:db8:abcd::/56，多段用英文逗号隔开。`)
    return null
  }
  const address = token.slice(0, slash)
  const prefixText = token.slice(slash + 1)
  if (address.includes('%') || !/^([0-9]|[1-9]\d{1,2})$/.test(prefixText)) {
    problems.push(`${quote(token)}不是合法的地址段。请写成 203.0.113.0/24 或 2001:db8:abcd::/56，多段用英文逗号隔开。`)
    return null
  }
  // IPv4 映射进 IPv6 的写法（::ffff:10.0.0.0/96）不能当受信段，否则会把所有 IPv4 都放进来。
  if (address.includes(':') && address.includes('.')) {
    problems.push(`${quote(token)}是 IPv4 映射写法，请直接写 IPv4 地址段。`)
    return null
  }
  const prefix = Number(prefixText)
  if (isStrictIpv4(address)) {
    if (prefix > 32) {
      problems.push(`${quote(token)}不是合法的地址段。请写成 203.0.113.0/24 或 2001:db8:abcd::/56，多段用英文逗号隔开。`)
      return null
    }
    if (prefix < IPV4_MIN_PREFIX) {
      problems.push(`${quote(token)}比 /24 更宽。IPv4 地址段只允许 /24 到 /32。`)
      return null
    }
    const list = new BlockList()
    list.addSubnet(address, prefix, 'ipv4')
    return { token, prefix, family: 'ipv4', list }
  }
  if (isIP(address) !== 6) {
    problems.push(`${quote(token)}不是合法的地址段。请写成 203.0.113.0/24 或 2001:db8:abcd::/56，多段用英文逗号隔开。`)
    return null
  }
  if (prefix > 128) {
    problems.push(`${quote(token)}不是合法的地址段。请写成 203.0.113.0/24 或 2001:db8:abcd::/56，多段用英文逗号隔开。`)
    return null
  }
  if (prefix < IPV6_MIN_PREFIX) {
    problems.push(`${quote(token)}比 /56 更宽。IPv6 地址段只允许 /56 到 /128。`)
    return null
  }
  const list = new BlockList()
  list.addSubnet(address, prefix, 'ipv6')
  return { token, prefix, family: 'ipv6', list }
}

export function parseSmsTrustedEgressConfig(env: Env): SmsTrustedEgressConfig {
  const problems: string[] = []
  const hourly = positiveInt(
    env[SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT_ENV],
    MAX_TRUSTED_EGRESS_HOURLY_LIMIT,
    '每小时上限',
    problems,
  )
  const minute = positiveInt(
    env[SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT_ENV],
    MAX_TRUSTED_EGRESS_MINUTE_LIMIT,
    '每分钟上限',
    problems,
  )
  const raw = env[SMS_TRUSTED_EGRESS_CIDRS_ENV]?.trim() ?? ''
  const tokens = raw.split(',').map((item) => item.trim()).filter(Boolean)
  const rules: TrustedEgressRule[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    if (seen.has(token)) continue
    seen.add(token)
    const rule = parseCidr(token, problems)
    if (rule) rules.push(rule)
  }
  if (problems.length > 0) {
    throw new Error(`短信受信出口没配好，服务先不启动：${problems.join('')}`)
  }
  if (rules.length === 0) {
    return {
      enabled: false,
      hourlyLimit: hourly ?? DEFAULT_TRUSTED_EGRESS_HOURLY_LIMIT,
      minuteLimit: minute ?? DEFAULT_TRUSTED_EGRESS_MINUTE_LIMIT,
      rules: [],
    }
  }
  return {
    enabled: true,
    hourlyLimit: hourly ?? DEFAULT_TRUSTED_EGRESS_HOURLY_LIMIT,
    minuteLimit: minute ?? DEFAULT_TRUSTED_EGRESS_MINUTE_LIMIT,
    rules,
  }
}

/**
 * 启动时调用。校验失败抛错，且不会替换已经生效的配置。
 * 不传参时读当前进程的环境变量。
 */
export function assertSmsTrustedEgressConfig(env: Env = process.env): SmsTrustedEgressConfig {
  const next = parseSmsTrustedEgressConfig(env)
  active = next
  return next
}

export function currentSmsTrustedEgressConfig(): SmsTrustedEgressConfig {
  return active
}

/** 门禁用：回到「未配置」，不读环境变量。 */
export function resetSmsTrustedEgressConfigForTests(): void {
  active = disabledConfig()
}

/** `::ffff:203.0.113.9`、方括号地址按真实地址判定。认不出的（含 `unknown`）不算命中。 */
export function normalizeSmsClientIp(ip: string): { address: string; family: 'ipv4' | 'ipv6' } | null {
  let value = ip.trim()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value)
  if (mapped?.[1]) value = mapped[1]
  if (value.includes('%')) return null
  if (isStrictIpv4(value)) return { address: value, family: 'ipv4' }
  if (value.includes('.') || isIP(value) !== 6) return null
  return { address: value, family: 'ipv6' }
}

/** 最长前缀优先。未配置或地址对不上时返回 null。 */
export function matchTrustedEgress(ip: string): { token: string; prefix: number } | null {
  if (!active.enabled) return null
  const normalized = normalizeSmsClientIp(ip)
  if (!normalized) return null
  let best: { token: string; prefix: number } | null = null
  for (const rule of active.rules) {
    if (rule.family !== normalized.family) continue
    if (!rule.list.check(normalized.address, normalized.family)) continue
    if (!best || rule.prefix > best.prefix) best = { token: rule.token, prefix: rule.prefix }
  }
  return best
}
