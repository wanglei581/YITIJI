import { EMPLOYMENT_INDUSTRY_SECTORS } from '@ai-job-print/shared'

interface ResumeIndustrySheetProps {
  value: string
  onChange: (value: string) => void
}

/** 整屏 20 个行业门类。点选只写入当前值，回不回上一步由底部主按钮决定。 */
export function ResumeIndustrySheet({ value, onChange }: ResumeIndustrySheetProps) {
  return (
    <section className="qx-rt-industry" aria-labelledby="qx-rt-industry-h">
      <h2 className="qx-rt-sec-h" id="qx-rt-industry-h">选择行业门类 <small>当前：{value || '暂不指定'}</small></h2>
      <button type="button" className="qx-rt-lead" aria-pressed={value === ''} onClick={() => onChange('')}>
        暂不指定（不按行业看，只看简历本身的表达）
      </button>
      <h3 className="qx-rt-sec-h">全部 20 个门类 <small>A–T 门类，点一个再由底部按钮回上一步</small></h3>
      <div className="qx-rt-sectors" role="group" aria-label="行业门类">
        {EMPLOYMENT_INDUSTRY_SECTORS.map((item) => (
          <button type="button" key={item.code} className="qx-rt-sector" aria-pressed={value === item.label} onClick={() => onChange(item.label)}>
            <i>{item.code}</i>
            <b>{item.label}</b>
          </button>
        ))}
      </div>
      <div className="qx-rt-report">
        <p>这张表就是国家标准 GB/T 4754-2017 的 20 个门类，一个不多一个不少；左边的 A–T 只是门类编号，方便你按顺序找，选中的是中文门类名。</p>
        <p>行业只用来排简历表达的建议顺序；这台机器不因此提供岗位，也不代表能投递。</p>
      </div>
    </section>
  )
}
