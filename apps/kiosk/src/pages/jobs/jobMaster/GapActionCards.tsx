// 差距行动卡（M1.5）：差距 + 建议 +（展开）学习方向 + 第一步。
// 展开/收起用组件内局部 state（不触碰全局状态）；缺 learningDirection/firstStep 时不显示展开。
import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import type { JobMasterGapSkillView } from './resultTypes'

export function GapActionCards({ gapSkills }: { gapSkills: JobMasterGapSkillView[] }) {
  if (gapSkills.length === 0) return null
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">差距与行动</h2>
      <div className="mt-3 flex flex-col gap-2.5">
        {gapSkills.map((g, i) => <GapRow key={g.skill.slice(0, 24) + i} gap={g} />)}
      </div>
    </div>
  )
}

function GapRow({ gap }: { gap: JobMasterGapSkillView }) {
  const hasMore = Boolean(gap.learningDirection || gap.firstStep)
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl bg-orange-50/50 px-4 py-3">
      <p className="text-sm font-medium text-gray-900">{gap.skill}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-600">{gap.suggestion}</p>
      {hasMore && (
        <>
          {open && (
            <div className="mt-2 flex flex-col gap-1 border-t border-orange-100 pt-2">
              {gap.learningDirection && <p className="text-xs text-gray-600">方向：{gap.learningDirection}</p>}
              {gap.firstStep && <p className="text-xs text-gray-600">第一步：{gap.firstStep}</p>}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="mt-1 flex min-h-[48px] items-center gap-1 text-xs font-medium text-orange-700"
          >
            {open ? '收起' : '展开学习方向 / 第一步'}
            <ChevronDownIcon className={['h-3.5 w-3.5 transition-transform', open ? 'rotate-180' : ''].join(' ')} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}
