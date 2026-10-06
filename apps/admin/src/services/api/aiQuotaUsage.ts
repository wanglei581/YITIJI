// 管理员「按人次数（今天）」：GET /admin/ai/quota-usage
// 只读。mock 模式不造数字。响应里不该有会员 id；这里也只抄白名单字段。

import type { AdminAiQuotaUsage } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

const PATH = '/admin/ai/quota-usage'
const BUCKETS = ['ai_resume', 'ai_assistant', 'ai_interview'] as const

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
}

function bucketOf(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (!BUCKETS.includes(row.bucket as (typeof BUCKETS)[number])) return null
  if (!fields.every((field) => isCount(row[field]))) return null
  return row
}

function malformed(): ApiHttpError {
  return new ApiHttpError('UNEXPECTED_RESPONSE', '服务端返回的按人次数不完整，请稍后重试', 200)
}

export function adminAiQuotaUsageFromResponse(body: unknown): AdminAiQuotaUsage {
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined
  if (!data || typeof data !== 'object') throw malformed()
  const record = data as Record<string, unknown>
  if (typeof record.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.day)) throw malformed()
  if (!Array.isArray(record.buckets) || !Array.isArray(record.extra)) throw malformed()
  const bucketsRaw = record.buckets as unknown[]
  const extraRaw = record.extra as unknown[]
  const guest = record.guest
  if (!guest || typeof guest !== 'object') throw malformed()
  const guestRow = guest as Record<string, unknown>
  const perTerminalDailyLimit = guestRow.perTerminalDailyLimit
  const terminalsUsed = guestRow.terminalsUsed
  const usedTotal = guestRow.usedTotal
  if (!isCount(perTerminalDailyLimit) || !isCount(terminalsUsed) || !isCount(usedTotal)) throw malformed()
  const buckets = BUCKETS.map((bucket) => {
    const row = bucketsRaw.find((item) => bucketOf(item, ['usedTotal', 'membersUsed', 'membersExhausted', 'dailyLimit'])?.bucket === bucket)
    const parsed = bucketOf(row, ['usedTotal', 'membersUsed', 'membersExhausted', 'dailyLimit'])
    if (!parsed) throw malformed()
    return {
      bucket,
      usedTotal: parsed.usedTotal as number,
      membersUsed: parsed.membersUsed as number,
      membersExhausted: parsed.membersExhausted as number,
      dailyLimit: parsed.dailyLimit as number,
    }
  })
  const extra = BUCKETS.map((bucket) => {
    const row = extraRaw.find((item) => bucketOf(item, ['remainingTotal', 'expiringWithin30Days'])?.bucket === bucket)
    const parsed = bucketOf(row, ['remainingTotal', 'expiringWithin30Days'])
    if (!parsed) throw malformed()
    return {
      bucket,
      remainingTotal: parsed.remainingTotal as number,
      expiringWithin30Days: parsed.expiringWithin30Days as number,
    }
  })
  return {
    day: record.day,
    buckets,
    guest: { perTerminalDailyLimit, terminalsUsed, usedTotal },
    extra,
  }
}

export function getAdminAiQuotaUsage(): Promise<AdminAiQuotaUsage> {
  if (API_MODE !== 'http') {
    return Promise.reject(new ApiHttpError('DEMO_MODE_NO_USAGE_DATA', '演示模式不连接按人次数', 501))
  }
  return (async () => {
    let res: Response
    try {
      res = await fetch(`${API_BASE_URL}${PATH}`, {
        method: 'GET',
        headers: { Accept: 'application/json', ...authHeader() },
        credentials: 'include',
      })
    } catch {
      throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
    }
    if (!res.ok) {
      let code = `HTTP_${res.status}`
      let message = '按人次数读取失败，请稍后重试'
      try {
        const body = await res.json() as { error?: { code?: string; message?: string } }
        if (body.error?.code) code = body.error.code
        if (body.error?.message) message = body.error.message
      } catch { /* 非 JSON 时保留上面的说明 */ }
      if (res.status === 401) redirectToLogin()
      throw new ApiHttpError(code, message, res.status)
    }
    return adminAiQuotaUsageFromResponse(await res.json())
  })()
}
