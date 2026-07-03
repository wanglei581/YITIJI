// 面试预判卡（M1.5）：问题 + 为什么问 + 准备提示。只做练习准备，不承诺通过。
// CTA「去练模拟面试」用可选 onPracticeInterview callback，Task 8 再接 navigate。
import { HelpCircleIcon } from 'lucide-react'
import type { JobMasterInterviewPrepView } from './resultTypes'

interface InterviewPrepCardProps {
  items: JobMasterInterviewPrepView[]
  onPracticeInterview?: () => void
}

export function InterviewPrepCard({ items, onPracticeInterview }: InterviewPrepCardProps) {
  if (items.length === 0) return null
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <HelpCircleIcon className="h-4 w-4 text-sky-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-900">面试准备参考</h2>
      </div>
      <div className="flex flex-col gap-2.5">
        {items.map((it, i) => (
          <div key={it.question.slice(0, 24) + i} className="rounded-xl bg-sky-50/50 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">{it.question}</p>
            {it.whyAsked && <p className="mt-1 text-xs text-gray-500">为什么问：{it.whyAsked}</p>}
            <p className="mt-1 text-xs leading-relaxed text-gray-600">准备：{it.prepHint}</p>
          </div>
        ))}
      </div>
      {onPracticeInterview && (
        <button
          type="button"
          onClick={onPracticeInterview}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sm font-semibold text-sky-700"
        >
          去练模拟面试
        </button>
      )}
    </div>
  )
}
