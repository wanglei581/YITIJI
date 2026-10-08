import { ResumeWithoutAi } from './ResumeWithoutAi'

/** 稿 21 `unknown`：地址里的画面认不出时，不猜内容，只给这台机器上真有的入口。 */
export function ResumeUnrecognized({
  helpLine, onSource, onHome, onProfile, onAssistant, onGenerate, onPrint,
}: {
  helpLine: string
  onSource: () => void
  onHome: () => void
  onProfile: () => void
  onAssistant: () => void
  onGenerate: () => void
  onPrint: () => void
}) {
  return (
    <div className="qx-rt-work" data-testid="resume-unrecognized">
      <section className="qx-rt-fail" data-tone="warn">
        <h2 className="qx-rt-fail-t">无法识别的页面状态</h2>
        <p>这一页只处理简历取件、诊断方向和确认办理。这里不会猜你想去哪一步，也不把认不出的内容显示出来。</p>
      </section>
      <section className="qx-rt-block" aria-label="回到正轨">
        <h2 className="qx-rt-sec-h">从这些入口回到正轨</h2>
        <div className="qx-rt-quick-exits">
          <button type="button" className="qx-rt-alt" onClick={onSource}>
            <span><strong>回到来源选择</strong><small>重新挑一种取件方式。</small></span>
            <span className="go">去选择 →</span>
          </button>
          <button type="button" className="qx-rt-alt" onClick={onHome}>
            <span><strong>回首页换一项</strong><small>打印扫描和其他服务都在首页。</small></span>
            <span className="go">回首页 →</span>
          </button>
          <button type="button" className="qx-rt-alt" onClick={onProfile}>
            <span><strong>我的记录</strong><small>本人的文档、打印订单与 AI 服务记录。</small></span>
            <span className="go">去我的 →</span>
          </button>
          <button type="button" className="qx-rt-alt" onClick={onAssistant}>
            <span><strong>问一句小青</strong><small>说不清要办什么，先问该走哪一步。</small></span>
            <span className="go">去问 →</span>
          </button>
        </div>
      </section>
      <ResumeWithoutAi onGenerate={onGenerate} onPrint={onPrint} />
      <p className="qx-rt-hint" data-testid="resume-help-line">{helpLine}</p>
    </div>
  )
}
