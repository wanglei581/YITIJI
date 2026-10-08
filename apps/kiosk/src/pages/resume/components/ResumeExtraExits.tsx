import { FileTextIcon, SparklesIcon } from 'lucide-react'

interface ResumeExtraExitsProps {
  onGenerate: () => void
  onPrint: () => void
}

/** 两条不走诊断的出口：去生成一份新简历，或只打印原件。 */
export function ResumeExtraExits({ onGenerate, onPrint }: ResumeExtraExitsProps) {
  return (
    <div className="qx-rt-quick-exits" data-testid="resume-extra-exits">
      <button type="button" onClick={onGenerate} className="qx-rt-alt">
        <SparklesIcon size={30} aria-hidden="true" />
        <span>
          <strong>没有电子简历</strong>
          <small>让小青帮你整理经历</small>
        </span>
        <span className="go">带走新简历 →</span>
      </button>
      <button type="button" className="qx-rt-alt" onClick={onPrint}>
        <FileTextIcon size={30} aria-hidden="true" />
        <span>
          <strong>只想打印原件</strong>
          <small>选好参数，确认价格</small>
        </span>
        <span className="go">带走打印件 →</span>
      </button>
    </div>
  )
}
