// 风险与建议卡（M1.5）：定性三档 + reason + basis。空数组时给中性提示。
import { ShieldAlertIcon } from 'lucide-react'
import type { JobMasterRiskView } from './resultTypes'

const RISK_META: Record<JobMasterRiskView['level'], { label: string; cls: string }> = {
  low: { label: '关注度：较低', cls: 'bg-green-50 text-green-700' },
  medium: { label: '关注度：需注意', cls: 'bg-amber-50 text-amber-700' },
  high: { label: '关注度：需谨慎', cls: 'bg-red-50 text-red-700' },
}

export function RiskCard({ risks }: { risks: JobMasterRiskView[] }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlertIcon className="h-4 w-4 text-red-500" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-900">风险与建议</h2>
      </div>
      {risks.length === 0 ? (
        <p className="text-sm text-gray-500">未发现明显硬性门槛风险；仍建议到来源平台核实岗位完整信息。</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {risks.map((r, i) => {
            const rm = RISK_META[r.level] ?? RISK_META.medium
            return (
              <div key={r.title.slice(0, 24) + i} className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{r.title}</p>
                  <span className={['shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', rm.cls].join(' ')}>{rm.label}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">{r.reason}</p>
                <p className="mt-1 text-xs text-gray-400">依据：{r.basis}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
