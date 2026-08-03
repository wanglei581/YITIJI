import { CheckIcon } from 'lucide-react'

const STEPS = ['选择类型', '扫描指引', '扫描中', '完成'] as const

/** Shared 4-step strip for /scan/* — visual only; does not invent progress. */
export function ScanFlowSteps({ activeIndex }: { activeIndex: 0 | 1 | 2 | 3 }) {
  return (
    <div className="w2-scan-steps" aria-label="扫描流程">
      {STEPS.map((label, index) => (
        <div
          key={label}
          className={index < activeIndex ? 'is-done' : index === activeIndex ? 'is-active' : undefined}
        >
          <span>{index < activeIndex ? <CheckIcon aria-hidden="true" /> : index + 1}</span>
          {label}
        </div>
      ))}
    </div>
  )
}
