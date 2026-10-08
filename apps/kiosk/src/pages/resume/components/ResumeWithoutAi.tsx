import { FileTextIcon, SparklesIcon } from 'lucide-react'

/** 稿 21「不用 AI 也能办完」：直接打印原件、现场生成一份简历。来源首屏的两张卡不走这里。 */
export function ResumeWithoutAi({ onGenerate, onPrint }: { onGenerate: () => void; onPrint: () => void }) {
  return (
    <section className="qx-rt-block" data-testid="resume-without-ai" aria-labelledby="qx-rt-noai-h">
      <h2 className="qx-rt-sec-h" id="qx-rt-noai-h">不用 AI 也能办完 <small>这两条现在就能走</small></h2>
      <div className="qx-rt-quick-exits">
        <button type="button" className="qx-rt-alt" onClick={onPrint}>
          <FileTextIcon size={30} aria-hidden="true" />
          <span>
            <strong>直接打印原件</strong>
            <small>跳过诊断，把手里的材料按原样打出来。</small>
          </span>
          <span className="go">去打印 →</span>
        </button>
        <button type="button" className="qx-rt-alt" onClick={onGenerate}>
          <SparklesIcon size={30} aria-hidden="true" />
          <span>
            <strong>现场生成一份简历</strong>
            <small>没有电子简历，点选着填，填完可直接打印。</small>
          </span>
          <span className="go">去生成 →</span>
        </button>
      </div>
    </section>
  )
}
