import { useNavigate } from 'react-router-dom'
import { QxTouchDock } from '../../../components/qingxu/touch/QxTouchDock'
import { InterviewArt } from '../InterviewArt'
import { InterviewShell } from '../InterviewShell'

export function InterviewSessionInvalid({ onRestart }: { onRestart: () => void }) {
  const navigate = useNavigate()
  return (
    <InterviewShell
      eyebrow="练面试 · 作答"
      title="这一场练习已经过期。"
      subtitle="这场练习是否过期，由当时的办理结果决定。过期后不能续答，也不能把没答完的一场说成已完成。"
      status={{ tone: 'bad', label: '这场练习已过期' }}
      ctabar={
        <QxTouchDock
          onBack={() => navigate('/interview-service')}
          ask={{ label: '问小青：练习过期了怎么办', draft: '这场模拟面试已经过期。请告诉我怎样重新开始，不要替我创建练习。' }}
          primary={{ label: '重新创建练习', onClick: onRestart }}
        />
      }
    >
      <div
        data-kiosk-domain="interview"
        data-kiosk-screen="interview-session"
        data-qx-interview=""
        className="interview-flow interview-session-expired"
        data-visual-theme="service-desk"
        data-ux-density="touch"
      >
        <div className="interview-flow__scroll">
          <InterviewArt title="这场练习已过期，需要重新开始">
            公共终端上的这场练习有有效期。过期之后，旧的题目和还没提交的回答都不能继续使用。不能把没答完的一场说成已完成。重新创建会回到岗位与经验。
          </InterviewArt>
        </div>
      </div>
    </InterviewShell>
  )
}
