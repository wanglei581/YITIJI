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
  return record.targetId ? `${label} · 尾号 ${record.targetId.slice(-6)}` : label
}

export function auditIpText(value: string | null): string {
  return value?.replace(/^::ffff:/i, '') || '—'
}

// 来源：用户状态变更、打印建单、账号绑定、文件清理等既有审计写入结构。
export const PAYLOAD_LABELS: Record<string, string> = {
  reason: '原因', fromStatus: '原状态', toStatus: '新状态', sections: '查看范围',
  matched: '是否找到用户', queryType: '查询方式', fileId: '文件编号', fileName: '文件名',
  sourceFileId: '原文件编号', hasFileHash: '是否记录文件校验值', params: '打印参数',
  hasEndUser: '是否为登录用户', terminalId: '终端编号', orderId: '订单编号', orderNo: '订单号',
  partnerId: '机构账号编号', orgId: '机构编号', userId: '账号编号', endUserId: '用户编号',
  count: '数量', deletedCount: '删除数量', expiresAt: '过期时间', status: '状态',
  result: '结果', phase: '步骤', copies: '份数', duplex: '双面', color: '彩色',
  pageRange: '页范围', amountCents: '金额（分）', phoneMasked: '手机号',
  phone: '手机号', contactPhone: '联系电话', mobile: '手机号', email: '邮箱',
  password: '密码', token: '令牌', accessToken: '访问令牌', refreshToken: '刷新令牌',
  apiKey: '接口密钥', secret: '密钥', authorization: '身份验证信息', cookie: '登录凭据',
  action: '操作', rows: '行数', cleaned: '清理数量', enabled: '是否启用', field: '变更字段',
}

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
