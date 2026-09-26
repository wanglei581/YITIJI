import { useEffect, useState } from 'react'
import { formatDateTime, RECRUITMENT_EMERGENCY_REASON_LABELS, RECRUITMENT_EMERGENCY_TARGET_LABELS } from '@ai-job-print/shared'
import { Card, EmptyState, LoadingState } from '@ai-job-print/ui'
import { BellIcon, ShieldAlertIcon } from 'lucide-react'
import { getOrgNotices, type PartnerOrgNotice, type PartnerOrgNoticeList } from '../../services/api/orgNotices'

function noticeMeta(notice: PartnerOrgNotice): { target?: string; reason?: string } {
  try {
    const payload = JSON.parse(notice.payloadJson) as { targetType?: string; reasonCode?: string }
    return {
      target: payload.targetType
        ? RECRUITMENT_EMERGENCY_TARGET_LABELS[payload.targetType as keyof typeof RECRUITMENT_EMERGENCY_TARGET_LABELS]
        : undefined,
      reason: payload.reasonCode
        ? RECRUITMENT_EMERGENCY_REASON_LABELS[payload.reasonCode as keyof typeof RECRUITMENT_EMERGENCY_REASON_LABELS]
        : undefined,
    }
  } catch {
    return {}
  }
}

/**
 * 平台处置通知（3.13）。平台对本机构内容紧急下架或按机构 / 来源熔断时，服务端逐条写一条通知。
 * 读失败如实说「没读到」，不当成「没有通知」；服务端截断时写出总数。
 */
export function OrgNoticesSection() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [data, setData] = useState<PartnerOrgNoticeList | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setState('loading')
    getOrgNotices()
      .then((list) => {
        if (!alive) return
        setData(list)
        setState('ready')
      })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [reloadKey])

  return (
    <section aria-label="平台处置通知">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-error" aria-hidden="true" />
        <h2 className="text-[13px] font-bold text-neutral-700">平台处置通知</h2>
        <span className="text-[11.5px] text-neutral-400">平台紧急下架或熔断本机构内容时在这里留记录</span>
      </div>

      <Card className="overflow-hidden p-0">
        {state === 'loading' && <LoadingState text="正在读取处置通知…" className="py-8" />}

        {state === 'error' && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-warning-fg" role="alert">
            <span>处置通知这次没有读到，不代表没有通知。</span>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="shrink-0 rounded-md border border-warning/40 px-2.5 py-1 text-xs font-semibold hover:bg-warning-bg"
            >
              重新读取
            </button>
          </div>
        )}

        {state === 'ready' && data && data.items.length === 0 && (
          <EmptyState icon={BellIcon} title="暂无平台处置通知" description="本机构目前没有被平台紧急下架或熔断的内容。" className="py-8" />
        )}

        {state === 'ready' && data && data.items.length > 0 && (
          <>
            {data.truncated && (
              <p className="border-b border-warning/20 bg-warning-bg px-5 py-2.5 text-xs text-warning-fg" role="status">
                共 <strong className="tabular-nums">{data.total}</strong> 条处置通知，这里只显示最新 {data.items.length} 条。其余通知没有丢失，如需完整记录请联系平台运营。
              </p>
            )}
            <ul className="divide-y divide-neutral-900/[0.06]">
              {data.items.map((notice) => {
                const meta = noticeMeta(notice)
                return (
                  <li key={notice.id} className="flex gap-3 px-5 py-3.5">
                    <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-error-fg" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-neutral-800">
                        {notice.title}
                        {meta.target && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">{meta.target}</span>}
                        {meta.reason && <span className="rounded bg-error-bg px-1.5 py-0.5 text-[11px] font-medium text-error-fg">{meta.reason}</span>}
                      </p>
                      <p className="mt-0.5 break-words text-xs leading-relaxed text-neutral-600">{notice.body}</p>
                    </div>
                    <time className="shrink-0 whitespace-nowrap text-xs tabular-nums text-neutral-400" dateTime={notice.createdAt}>
                      {formatDateTime(notice.createdAt)}
                    </time>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>
    </section>
  )
}
