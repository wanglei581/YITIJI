// 简历改写卡（M1.5）：针对该岗位的表达改写要点（area + suggestion）。
// CTA「去优化简历」用可选 onOptimizeResume callback，Task 8 再接 navigate。
import { PencilLineIcon } from 'lucide-react'
import type { JobMasterResumeRewriteView } from './resultTypes'

interface ResumeRewriteCardProps {
  items: JobMasterResumeRewriteView[]
  onOptimizeResume?: () => void
}

export function ResumeRewriteCard({ items, onOptimizeResume }: ResumeRewriteCardProps) {
  if (items.length === 0) return null
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <PencilLineIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-900">简历改写要点</h2>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={it.area.slice(0, 24) + i} className="flex items-start gap-2 text-sm leading-relaxed text-gray-700">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden="true" />
            <span><span className="font-medium text-gray-900">{it.area}：</span>{it.suggestion}</span>
          </li>
        ))}
      </ul>
      {onOptimizeResume && (
        <button
          type="button"
          onClick={onOptimizeResume}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-xl border border-primary-200 bg-primary-50 text-sm font-semibold text-primary-700"
        >
          去优化简历
        </button>
      )}
    </div>
  )
}
