// 晋升路径时间轴（M1.5）：当前 → 1-3年 → 3-5年，含依据/待补技能/第一步。
// 可选字段（rationale / target.firstStep）缺失时不渲染对应行。
import { TargetIcon } from 'lucide-react'
import type { JobMasterCareerPathView } from './resultTypes'

export function CareerTimeline({ careerPath }: { careerPath: JobMasterCareerPathView }) {
  const cp = careerPath
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <TargetIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-900">晋升路径参考</h2>
      </div>
      <ol className="flex flex-col gap-3">
        <li className="rounded-xl bg-gray-50 px-4 py-3">
          <p className="text-xs font-semibold text-gray-400">当前</p>
          <p className="text-sm font-medium text-gray-900">{cp.current.title}</p>
          <p className="mt-1 text-xs text-gray-500">依据：{cp.current.evidence}</p>
        </li>
        <li className="rounded-xl bg-primary-50/60 px-4 py-3">
          <p className="text-xs font-semibold text-primary-500">1-3 年</p>
          <p className="text-sm font-medium text-gray-900">{cp.next.title}</p>
          {cp.next.skillsToBuild.length > 0 && <p className="mt-1 text-xs text-gray-600">待补技能：{cp.next.skillsToBuild.join('、')}</p>}
          <p className="mt-1 text-xs text-gray-600">第一步：{cp.next.firstStep}</p>
          {cp.next.rationale && <p className="mt-1 text-xs text-gray-500">依据：{cp.next.rationale}</p>}
        </li>
        <li className="rounded-xl bg-primary-50/60 px-4 py-3">
          <p className="text-xs font-semibold text-primary-500">3-5 年</p>
          <p className="text-sm font-medium text-gray-900">{cp.target.title}</p>
          {cp.target.skillsToBuild.length > 0 && <p className="mt-1 text-xs text-gray-600">待补技能：{cp.target.skillsToBuild.join('、')}</p>}
          {cp.target.rationale && <p className="mt-1 text-xs text-gray-500">依据：{cp.target.rationale}</p>}
          {cp.target.firstStep && <p className="mt-1 text-xs text-gray-600">第一步：{cp.target.firstStep}</p>}
        </li>
      </ol>
    </div>
  )
}
