// 技能命中/缺口标签墙 + 关键词覆盖（M1.5）。关键词只列命中/待补状态，不算任何比率。
import { CheckCircle2Icon, TrendingUpIcon } from 'lucide-react'
import type { JobMasterFitView } from './resultTypes'

export function FitSkillMap({ fit }: { fit: JobMasterFitView }) {
  const kc = fit.keywordCoverage
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">岗位适配度</h2>
      {fit.summary && <p className="mt-2 text-sm leading-relaxed text-gray-700">{fit.summary}</p>}

      <div className="mt-3">
        <div className="mb-2 flex items-center gap-1.5">
          <CheckCircle2Icon className="h-4 w-4 text-green-600" aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-800">已具备</span>
        </div>
        <div className="flex flex-col gap-2">
          {fit.matchedSkills.map((m, i) => (
            <div key={m.skill.slice(0, 24) + i} className="rounded-xl bg-green-50/60 px-4 py-3">
              <p className="text-sm font-medium text-gray-900">{m.skill}</p>
              <p className="mt-1 text-xs text-gray-500">原文依据：“{m.evidence}”</p>
            </div>
          ))}
        </div>
      </div>

      {fit.gapSkills.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-1.5">
            <TrendingUpIcon className="h-4 w-4 text-orange-500" aria-hidden="true" />
            <span className="text-sm font-semibold text-gray-800">建议补足</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {fit.gapSkills.map((g, i) => (
              <span key={g.skill.slice(0, 24) + i} className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700">{g.skill}</span>
            ))}
          </div>
        </div>
      )}

      {kc && (kc.matched.length > 0 || kc.missing.length > 0) && (
        <div className="mt-3">
          <span className="text-sm font-semibold text-gray-800">关键词覆盖</span>
          {kc.matched.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {kc.matched.map((w) => <span key={`m-${w}`} className="rounded-md bg-green-50 px-2 py-1 text-xs text-green-700">✓ {w}</span>)}
            </div>
          )}
          {kc.missing.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {kc.missing.map((w) => <span key={`x-${w}`} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">✗ {w}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
