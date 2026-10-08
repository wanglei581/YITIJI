interface ResumeIntentSwitchProps {
  heading: string
  intent: 'diagnose' | 'optimize'
  disabled?: boolean
  onChange: (intent: 'diagnose' | 'optimize') => void
}

/** 首屏意图。诊断和优化仍走同一条上传链路。 */
export function ResumeIntentSwitch({ heading, intent, disabled = false, onChange }: ResumeIntentSwitchProps) {
  return (
    <section aria-labelledby="resume-intent-title" data-testid="resume-intent">
      <h2 className="qx-rt-sec-h" id="resume-intent-title">{heading} <small>选错了随时能改</small></h2>
      <div className="qx-rt-seg" role="group" aria-label="这次要做的事">
        <button type="button" aria-pressed={intent === 'diagnose'} disabled={disabled} onClick={() => onChange('diagnose')}>
          <b>AI 诊断</b>
          <small>读你的简历，逐条指出问题</small>
        </button>
        <button type="button" aria-pressed={intent === 'optimize'} disabled={disabled} onClick={() => onChange('optimize')}>
          <b>AI 优化</b>
          <small>先完成诊断，再基于原文重写表达</small>
        </button>
      </div>
    </section>
  )
}
