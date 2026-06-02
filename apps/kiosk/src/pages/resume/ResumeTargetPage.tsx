// ============================================================
// ResumeTargetPage — 选择目标方向（/resume/target）
//
// 用户在生成诊断前选择行业 / 目标岗位 / 经验级别 / 求职场景，
// 也可"暂不指定，通用诊断"。选择写入 location.state.targetContext，
// 传递到 /resume/parse → /resume/report / optimize 展示摘要。
//
// 合规：仅用于求职准备方向，不做企业匹配/录用预测；不收集敏感个人信息。
// ============================================================

import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, PageHeader } from '@ai-job-print/ui'
import type { ResumeTargetContext } from '@ai-job-print/shared'

const INDUSTRIES = [
  '互联网/科技', '制造业', '教育', '金融',
  '医疗健康', '电商/零售', '政府/事业单位', '通用',
]

const EXPERIENCES = ['应届', '1-3年', '3-5年', '5年以上']

const SCENES = ['校招', '社招', '转岗', '招聘会现场']

// 通用单选 chip 组
function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string | undefined
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(active ? '' : opt)}
            className={[
              'min-h-[48px] rounded-xl border-2 px-4 text-base font-medium transition-colors',
              active
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 active:bg-gray-50',
            ].join(' ')}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

export function ResumeTargetPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // 承接来源页传入的 source / file / fileId
  const incoming = (location.state ?? {}) as Record<string, unknown>

  const [industry, setIndustry] = useState<string>('')
  const [targetJob, setTargetJob] = useState<string>('')
  const [experience, setExperience] = useState<string>('')
  const [scene, setScene] = useState<string>('')

  const goParse = (targetContext: ResumeTargetContext) => {
    navigate('/resume/parse', { state: { ...incoming, targetContext } })
  }

  const handleNext = () => {
    goParse({
      industry: industry || undefined,
      targetJob: targetJob.trim() || undefined,
      experience: experience || undefined,
      scene: scene || undefined,
      skipped: false,
    })
  }

  const handleSkip = () => {
    goParse({ skipped: true })
  }

  const hasAnySelection =
    Boolean(industry) || Boolean(targetJob.trim()) || Boolean(experience) || Boolean(scene)

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="选择目标方向"
        subtitle="帮助 AI 更有针对性地给出诊断与优化建议（可跳过）"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/resume')}>
            返回
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-7">
        {/* 行业方向 */}
        <section>
          <p className="mb-3 text-base font-semibold text-gray-900">行业方向</p>
          <ChipGroup options={INDUSTRIES} value={industry} onChange={setIndustry} />
        </section>

        {/* 目标岗位 */}
        <section>
          <p className="mb-3 text-base font-semibold text-gray-900">目标岗位（可选）</p>
          <input
            type="text"
            value={targetJob}
            onChange={(e) => setTargetJob(e.target.value)}
            placeholder="例如：前端工程师、运营专员"
            maxLength={40}
            className="min-h-[56px] w-full rounded-xl border-2 border-gray-200 px-4 text-base text-gray-900 placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20"
          />
        </section>

        {/* 经验级别 */}
        <section>
          <p className="mb-3 text-base font-semibold text-gray-900">经验级别</p>
          <ChipGroup options={EXPERIENCES} value={experience} onChange={setExperience} />
        </section>

        {/* 求职场景 */}
        <section>
          <p className="mb-3 text-base font-semibold text-gray-900">求职场景</p>
          <ChipGroup options={SCENES} value={scene} onChange={setScene} />
        </section>
      </div>

      {/* 操作区 */}
      <div className="mt-8 flex gap-3">
        <Button size="lg" variant="secondary" className="flex-1" onClick={handleSkip}>
          暂不指定，通用诊断
        </Button>
        <Button size="lg" className="flex-1" onClick={handleNext} disabled={!hasAnySelection}>
          下一步
        </Button>
      </div>
    </div>
  )
}
