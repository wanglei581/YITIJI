import { EMPLOYMENT_INDUSTRY_SECTORS } from '@ai-job-print/shared'

interface ResumeIndustrySheetProps {
  value: string
  onChange: (value: string) => void
}

/** 整屏 20 个行业门类。点选立即写入，返回由底部按钮决定。 */
export function ResumeIndustrySheet({ value, onChange }: ResumeIndustrySheetProps) {
  return (
    <section className="qx-rt-industry" aria-labelledby="qx-rt-industry-h">
      <h2 className="qx-rt-sec-h" id="qx-rt-industry-h">选一个行业门类 <small>GB/T 4754 的 20 个门类，不预选</small></h2>
      <div className="qx-rt-sectors" role="group" aria-label="行业门类">
        <button type="button" className="qx-rt-chip" data-mute="true" aria-pressed={value === ''} onClick={() => onChange('')}>暂不指定</button>
        {EMPLOYMENT_INDUSTRY_SECTORS.map((item) => (
          <button type="button" key={item.code} className="qx-rt-sector" aria-pressed={value === item.label} onClick={() => onChange(item.label)}>
            <i>{item.code}</i>
            <b>{item.label}</b>
          </button>
        ))}
      </div>
    </section>
  )
}
