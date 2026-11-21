/**
 * 审计记录的操作人显示名（从 auditActionLabels.ts 拆出，口径不变）。
 * 记录或载荷里有可读的人名就用人名；当前登录的自己显示自己的名字；都没有时只显示角色。
 */
import { ROLE_LABELS } from './auditActionLabels'

const ACTOR_NAME_KEYS = ['actorName', 'operatorName', 'userName', 'username', 'displayName', 'realName']

export interface AuditActorInput {
  actorRole: string
  actorId: string | null
  payloadJson?: string | null
  currentUser?: { id: string; name: string } | null
  /** 列表记录上若多带了姓名字段，从这里读；没有就只显示角色。 */
  record?: object | null
}

function looksLikeOpaqueId(value: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return true
  if (/^c[a-z0-9]{20,}$/i.test(value)) return true
  if (/^[0-9a-f]{24,}$/i.test(value)) return true
  return value.length >= 16 && /^[A-Za-z0-9_-]+$/.test(value)
}

function readablePersonName(value: unknown, actorId: string | null): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > 40) return null
  if (actorId && text === actorId) return null
  if (looksLikeOpaqueId(text)) return null
  return text
}

function nameFromRecord(record: object | null | undefined, actorId: string | null): string | null {
  if (!record) return null
  const bag = record as Record<string, unknown>
  for (const key of ACTOR_NAME_KEYS) {
    const name = readablePersonName(bag[key], actorId)
    if (name) return name
  }
  return null
}

function nameFromPayload(payloadJson: string | null | undefined, actorId: string | null): string | null {
  if (!payloadJson) return null
  try {
    const parsed = JSON.parse(payloadJson) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return nameFromRecord(parsed, actorId)
  } catch {
    return null
  }
}

export function getAuditActorLabel(input: AuditActorInput): string {
  const fromRecord = nameFromRecord(input.record, input.actorId)
  if (fromRecord) return fromRecord
  const fromPayload = nameFromPayload(input.payloadJson, input.actorId)
  if (fromPayload) return fromPayload
  const me = input.currentUser
  if (me && input.actorId && me.id === input.actorId) {
    const mine = readablePersonName(me.name, input.actorId)
    if (mine) return mine
  }
  return ROLE_LABELS[input.actorRole] ?? '其他'
}
