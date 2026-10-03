import type { AuditLogRecord } from '../../services/api/audit'
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

export function isSensitiveAuditKey(key: string): boolean {
  return /phone|mobile|tel(?:ephone)?|email|mail|password|passwd|pwd|token|secret|key|credential|authorization|cookie|手机号|电话|邮箱|密码|令牌|密钥/i.test(key)
}

export function safeAuditText(value: string): string {
  // 防止个人联系方式或签名链接藏在未知键、错误原文及浏览器标识中。
  if (/(?:\+?86[- ]?)?1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:bearer\s+|(?:token|password|secret|api[_-]?key|sig)=)/i.test(value)) return '已隐藏'
  return value
}

export function sanitizeAuditValue(value: unknown, key = ''): unknown {
  if (isSensitiveAuditKey(key)) return '已隐藏'
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeAuditValue(item, name)]))
  }
  return typeof value === 'string' ? safeAuditText(value) : value
}

export function parseAuditPayload(raw: string): { value: unknown; invalid: boolean; raw: string } {
  try {
    return { value: sanitizeAuditValue(JSON.parse(raw)), invalid: false, raw: '' }
  } catch {
    // 坏 JSON 不能可靠定位值；出现敏感键时整段隐藏，避免折叠区泄漏。
    const safeRaw = isSensitiveAuditKey(raw) ? '已隐藏' : safeAuditText(raw)
    return { value: null, invalid: true, raw: safeRaw }
  }
}
