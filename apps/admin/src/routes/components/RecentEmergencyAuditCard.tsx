import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { getAuditLogs, type AuditLogRecord } from '../../services/api/audit'
import { getAuditActorLabel, getAuditTargetLabel } from '../../lib/auditActionLabels'
import { getUser } from '../../services/auth'

export const RECRUITMENT_AUDIT_ACTIONS = ['recruitment.emergency_takedown', 'recruitment.circuit_break'] as const
export const POLICY_AUDIT_ACTIONS = ['policy.emergency_takedown'] as const

function reasonOf(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson) as { reasonText?: unknown }
    if (typeof parsed.reasonText === 'string' && parsed.reasonText.trim()) return parsed.reasonText.trim()
  } catch {
    /* 事由缺失时不编造 */
  }
  return '事由未写入记录'
}

/** 招聘紧急下架组与政策信息源底部的只读处置记录。任一动作读失败则整张卡失败。 */
export function RecentEmergencyAuditCard({ actions }: { actions: readonly string[] }) {
  const [rows, setRows] = useState<AuditLogRecord[] | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const cancelRef = useRef<(() => void) | null>(null)

  const load = useCallback(() => {
    cancelRef.current?.()
    let cancelled = false
    cancelRef.current = () => { cancelled = true }
    setLoading(true)
    setError(false)
    void Promise.all(actions.map((action) => getAuditLogs({ action, limit: 10, offset: 0 })))
      .then((pages) => {
        if (cancelled) return
        const ranked = pages
          .flatMap((page) => page.items)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        const merged = ranked.filter((_, index) => index < 10)
        setRows(merged)
      })
      .catch(() => {
        if (!cancelled) {
          setRows(null)
          setError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
  }, [actions])

  useEffect(() => {
    load()
    return () => { cancelRef.current?.() }
  }, [load])

  return (
    <section aria-label="最近 10 次紧急下架 / 熔断记录" className="mt-6 rounded-lg border border-neutral-200 bg-surface p-4">
      <h2 className="text-sm font-bold text-neutral-900">最近 10 次紧急下架 / 熔断记录</h2>
      {loading && <p className="mt-3 text-sm text-neutral-500">正在读取</p>}
      {!loading && error && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-error-fg">这类这次没读到</p>
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-11 items-center rounded-lg border border-neutral-200 px-3 text-sm font-semibold text-neutral-800"
          >
            重试
          </button>
        </div>
      )}
      {!loading && !error && rows && rows.length === 0 && (
        <p className="mt-3 text-sm text-neutral-500">还没有紧急下架或熔断记录</p>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100">
          {rows.map((row) => {
            const actor = getAuditActorLabel({
              actorRole: row.actorRole,
              actorId: row.actorId,
              payloadJson: row.payloadJson,
              currentUser: getUser(),
              record: row,
            })
            const target = getAuditTargetLabel(row.targetType) || '其他对象'
            return (
              <li key={row.id} className="py-3 text-sm">
                <p className="font-medium text-neutral-900">{formatDateTime(row.createdAt)}</p>
                <p className="mt-1 text-neutral-700">
                  {actor} · {target}
                </p>
                <p className="mt-1 text-neutral-600">{reasonOf(row.payloadJson)}</p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
