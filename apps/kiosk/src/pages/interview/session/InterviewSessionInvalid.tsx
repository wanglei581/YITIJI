import { AlertCircleIcon } from 'lucide-react'
import { InterviewShell } from '../InterviewShell'

export function InterviewSessionInvalid({ onRestart }: { onRestart: () => void }) {
  return (
    <InterviewShell
      title={<>这一场练习<em>已经过期</em>。</>}
      subtitle="会话过期由服务端判定。过期后不能续答，也不能把没答完的一场说成已完成。"
      status={{ tone: 'bad', label: '会话已失效' }}
      ctabar={
        <button type="button" className="qx-btn" data-variant="primary" onClick={onRestart}>
          重新开始练习
        </button>
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
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-error-bg text-error-fg">
          <AlertCircleIcon className="h-9 w-9" aria-hidden="true" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">会话已失效，请重新开始</h1>
          <p className="mt-2 text-base text-neutral-500">没有有效会话时不能续答。刷新后若仍回到这一步，请重新创建练习。</p>
        </div>
      </div>
    </InterviewShell>
  )
}
