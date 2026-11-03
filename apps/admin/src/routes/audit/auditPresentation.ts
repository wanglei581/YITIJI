import type { AuditLogRecord } from '../../services/api/audit'
import { USER_STATUS_LABELS } from '../users/userPresentation'
import { taskStatusLabel } from '../screen/metricLabels'
import { getAuditRoleLabel, getAuditTargetLabel } from '../../lib/auditActionLabels'

export function auditActorText(record: AuditLogRecord): string {
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

// 手机号前后不能紧挨别的数字：13 位时间戳、长编号里碰巧含 11 位不算手机号。
const PHONE_PATTERN = /(?<!\d)(?:\+?86[\s-]*)?1[3-9](?:[\s-]*\d){9}(?!\d)/
// 系统生成的编号与校验值：十六进制里的字母会让碰巧出现的 11 位数字被认成手机号。
// 只有整段值完全是下列格式之一才不按手机号判断，不看键名——登录名这类字段的值本身就可能是手机号。
// · 32/40/64 位十六进制（同一大小写，可带一对英文双引号）：文件、上传会话、AI 会话编号，对象存储与报告、安装包校验值，证书指纹
// · 标准 UUID：服务端生成的请求编号、会话编号
// · 小写字母前缀加「-」或「_」再加 16/24/32 位十六进制：自我探索任务 sa-、终端 t_、终端凭据 tc_、打印任务 ptask_
const SYSTEM_ID_PATTERNS = [
  /^("?)(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9A-F]{32}|[0-9A-F]{40}|[0-9A-F]{64})\1$/,
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,
  /^[a-z]+(?:_[a-z]+)*[-_](?:[0-9a-f]{16}|[0-9a-f]{24}|[0-9a-f]{32})$/,
]
// 12 位短摘要单看格式分不清（一个字母加手机号也是 12 位），只在这三个服务端算出的摘要字段里放行。
const SHORT_DIGEST_KEYS = new Set(['fileIdDigest', 'previousHashPrefix', 'deviceFingerprintPrefix'])

function isSystemGeneratedId(value: string, key: string): boolean {
  if (SYSTEM_ID_PATTERNS.some((pattern) => pattern.test(value))) return true
  return SHORT_DIGEST_KEYS.has(key) && /^[0-9a-f]{12}$/.test(value)
}

export function safeAuditText(value: string, fieldKey = ''): string {
  // 字符串里的 JSON 也按结构脱敏；解析失败不回显原始记录。
  const trimmed = value.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.stringify(sanitizeAuditValue(JSON.parse(value))) }
    catch { return invalidAuditPayloadText(value.length) }
  }
  if (!isSystemGeneratedId(value, fieldKey) && PHONE_PATTERN.test(value)) return '已隐藏'
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|bearer\s+\S+/i.test(value)) return '已隐藏'
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
  const safe = safeAuditText(value, key)
  if (safe !== value) return safe
  if (key === 'sections') return Object.prototype.hasOwnProperty.call(SECTION_LABELS, value) ? SECTION_LABELS[value] : value
  if (['fromStatus', 'toStatus', 'status', 'result'].includes(key)) {
    const label = USER_STATUS_LABELS[value as keyof typeof USER_STATUS_LABELS] ?? taskStatusLabel(value)
    return typeof label === 'string' ? label : value
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
