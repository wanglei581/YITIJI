// 决策摘要条（M1.5）：岗位标题 + 三档适配度徽章（无百分比）+ 一句话结论 + 锚点跳转。
// 锚点用 onJump callback + section 配置，不在组件内操作全局状态。
import type { JobMasterFitView } from './resultTypes'

const FIT_META: Record<JobMasterFitView['level'], { label: string; cls: string }> = {
  reference_high: { label: '参考匹配度：较高', cls: 'bg-green-50 text-green-700' },
  reference_medium: { label: '参考匹配度：中等', cls: 'bg-blue-50 text-blue-700' },
  reference_low: { label: '参考匹配度：偏低', cls: 'bg-orange-50 text-orange-700' },
}

interface DecisionSummaryBarProps {
  jobTitle: string
  company?: string | null
  fitLevel?: JobMasterFitView['level']
  summary?: string
  sections?: Array<{ id: string; label: string }>
  onJump?: (sectionId: string) => void
}

export function DecisionSummaryBar({ jobTitle, company, fitLevel, summary, sections, onJump }: DecisionSummaryBarProps) {
  const fit = fitLevel ? FIT_META[fitLevel] : null
  return (
    <div className="rounded-2xl border border-primary-100 bg-primary-50/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary-500">岗位决策参考</p>
          <p className="mt-0.5 truncate text-base font-bold text-gray-900">{jobTitle}{company ? ` · ${company}` : ''}</p>
        </div>
        {fit && <span className={['shrink-0 rounded-full px-3 py-1 text-sm font-semibold', fit.cls].join(' ')}>{fit.label}</span>}
      </div>
      {summary && <p className="mt-2 text-sm leading-relaxed text-gray-700">{summary}</p>}
      {sections && sections.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onJump?.(s.id)}
              className="flex min-h-[48px] items-center rounded-full border border-primary-200 bg-white px-4 text-xs font-medium text-primary-700"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
