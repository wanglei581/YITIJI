import type { AuditLogRecord } from '../../services/api/audit'
import { USER_STATUS_LABELS } from '../users/userPresentation'
import { taskStatusLabel } from '../screen/metricLabels'
import { PAY_STATUS_MAP, STATUS_MAP } from '../orders/orderDisplay'
import { getAuditRoleLabel, getAuditTargetLabel } from '../../lib/auditActionLabels'
import { auditScopedValue } from './auditPayloadLabels'

/** 操作人：服务端给了显示名就用；没有（系统、会员、已删除账号、旧接口）退回「角色 · 尾号」。显示名若像手机号等敏感文本也退回。 */
export function auditActorText(record: AuditLogRecord): string {
  const name = record.actorDisplayName?.trim()
  if (name && safeAuditText(name) === name) return name
  const role = getAuditRoleLabel(record.actorRole)
  if (role === '系统') return '系统'
  return record.actorId ? `${role} · 尾号 ${record.actorId.slice(-6)}` : role
}

export function auditTargetText(record: AuditLogRecord): string {
  const label = getAuditTargetLabel(record.targetType)
  if (record.targetType === 'terminal') {
    const parsed = parseAuditPayload(record.payloadJson).value
    return auditTerminalText(record.targetId, parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {})
  }
  return record.targetId ? `${label} · 尾号 ${record.targetId.slice(-6)}` : label
}

export function auditIpText(value: string | null): string {
  return value?.replace(/^::ffff:/i, '') || '—'
}

// 来源：用户状态变更、打印建单、账号绑定、文件清理等既有审计写入结构。
export { PAYLOAD_LABELS } from './auditPayloadLabels'

const SENSITIVE_WORDS = new Set([
  'password', 'passwd', 'pwd', 'token', 'secret', 'credential', 'authorization',
  'cookie', 'phone', 'mobile', 'telephone', 'email', 'signature', 'sign', 'tel', 'mail',
])
const KEY_PREFIXES = new Set(['api', 'secret', 'access', 'private', 'sign', 'encryption'])
const SECTION_LABELS: Record<string, string> = { summary: '概要', stats: '统计', recent_activity: '最近动态' }

export function isSensitiveAuditKey(key: string): boolean {
  if (/手机号|电话|邮箱|密码|令牌|密钥/.test(key)) return true
  const words = key.replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\s-]+/)
  return words.some((word, i) => SENSITIVE_WORDS.has(word)
    || (word === 'key' && KEY_PREFIXES.has(words[i - 1])))
}

export function invalidAuditPayloadText(length: number): string {
  return `详情无法解析（原始记录约 ${length} 个字符，需要时请联系技术人员从服务器查看）`
}

export function safeAuditText(value: string): string {
  // 字符串里的 JSON 也按结构脱敏；解析失败不回显原始记录。
  const trimmed = value.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.stringify(sanitizeAuditValue(JSON.parse(value))) }
    catch { return invalidAuditPayloadText(value.length) }
  }
  if (/(?<!\d)(?:\+?86[\s-]*)?1[3-9](?:[\s-]*\d){9}(?!\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|bearer\s+\S+/i.test(value)) return '已隐藏'
  // 手机号前后不能紧挨别的数字：13 位时间戳、长编号里碰巧含 11 位不算手机号。
  // 兼容参数、普通键值对及嵌入文本的 JSON 写法，签名 URL 整段隐藏。
  const pairs = value.matchAll(/(?:^|[\s?&,;{[])['"]?([\w\u4e00-\u9fff-]+)['"]?\s*[=:]\s*/g)
  for (const [, key] of pairs) {
    if (isSensitiveAuditKey(key) || key.toLowerCase() === 'sig') return '已隐藏'
  }
  return value
}

export function sanitizeAuditValue(value: unknown, key = ''): unknown {
  if (isSensitiveAuditKey(key)) return '已隐藏'
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeAuditValue(item, name)]))
  }
  if (typeof value !== 'string') return value
  const safe = safeAuditText(value)
  if (safe !== value) return safe
  if (key === 'sections') return Object.prototype.hasOwnProperty.call(SECTION_LABELS, value) ? SECTION_LABELS[value] : value
  const scoped = auditScopedValue(key, value)
  if (scoped) return scoped
  if (['fromStatus', 'toStatus', 'status', 'result', 'oldStatus', 'newStatus', 'previousStatus', 'nextStatus'].includes(key)) {
    if (Object.prototype.hasOwnProperty.call(USER_STATUS_LABELS, value)) {
      return USER_STATUS_LABELS[value as keyof typeof USER_STATUS_LABELS]
    }
    const screenLabel = taskStatusLabel(value)
    if (typeof screenLabel === 'string' && screenLabel !== value) return screenLabel
    if (Object.prototype.hasOwnProperty.call(STATUS_MAP, value)) return STATUS_MAP[value].label
    if (Object.prototype.hasOwnProperty.call(PAY_STATUS_MAP, value)) return PAY_STATUS_MAP[value].label
    return value
  }
  return value
}

export function parseAuditPayload(raw: string): { value: unknown; invalid: boolean; length: number } {
  try {
    return { value: sanitizeAuditValue(JSON.parse(raw)), invalid: false, length: raw.length }
  } catch {
    return { value: null, invalid: true, length: raw.length }
  }
}

/** 编号优先；没有编号时仅显示内部 ID 尾号，完整原值由抽屉悬停保留。 */
export function auditTerminalText(value: unknown, payload: Record<string, unknown>): string {
  const code = payload.terminalCode
  if (typeof code === 'string' && code.trim()) return safeAuditText(code)
  return typeof value === 'string' && value ? `终端（尾号 ${value.slice(-6)}）` : '—'
}
