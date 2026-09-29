import { QxAiHelp, QxStepActions } from '../../../components/qingxu/QxAiHelp'
import { InterviewShell } from '../InterviewShell'

export function InterviewSessionInvalid({ onRestart }: { onRestart: () => void }) {
  return (
    <InterviewShell
      title={<>这一场练习<em>已经过期</em>。</>}
      subtitle="这场练习是否过期，由当时的办理结果决定。过期后不能续答，也不能把没答完的一场说成已完成。"
      status={{ tone: 'bad', label: '这场练习已过期' }}
      ctabar={
        <div className="interview-qx-cta">
          <QxStepActions>
            <QxAiHelp label="问小青：练习过期了怎么办" draft="这场模拟面试已经过期。请告诉我怎样重新开始，不要替我创建练习。" />
          </QxStepActions>
          <button type="button" className="qx-btn" data-variant="primary" onClick={onRestart}>
            重新创建练习
          </button>
        </div>
      }
    >
      <div
        data-kiosk-domain="interview"
        data-kiosk-screen="interview-session"
        data-qx-interview=""
        className="interview-flow interview-session-invalid"
        data-visual-theme="service-desk"
        data-ux-density="touch"
      >
        <section className="iv-card iv-empty is-bad">
          <div>
            <h2>这场练习已过期，需要重新开始</h2>
            <p>公共终端上的这场练习有有效期。过期之后，旧的题目和还没提交的回答都不能继续使用。</p>
          </div>
        </section>
      </div>
    </InterviewShell>
  )
}
