import { QxTouchDock } from '../../../components/qingxu/touch/QxTouchDock'
import { InterviewArt } from '../InterviewArt'
import { InterviewShell } from '../InterviewShell'

/**
 * 到点后停住的一屏。没有记下回答，或报告没生成出来。
 * 不能回到作答，也不能把没提交的内容说成这一场的回答。
 */
export function InterviewTimeUp({
  variant,
  answersRecorded,
  busy,
  onLeave,
  onRestart,
  onRetry,
  onOpenTips,
}: {
  variant: 'no-answers' | 'report-failed'
  /** 本场亲眼见过非跳过的回答提交成功。没见过就不说「已保存」。 */
  answersRecorded: boolean
  busy?: boolean
  onLeave: () => void
  onRestart: () => void
  onRetry: () => void
  onOpenTips: () => void
}) {
  const noAnswers = variant === 'no-answers'
  const subtitle = noAnswers
    ? '没有记下的回答就没有报告。可以再练一场，或直接离开。'
    : answersRecorded
      ? '报告现在生成不了。到点前提交的回答已保存，可以再试一次。'
      : '报告现在生成不了，可以再试一次。'
  return (
    <InterviewShell
      eyebrow="练面试 · 到点"
      title="这一场已经结束"
      subtitle={subtitle}
      status={{ tone: 'warn', label: '已经结束' }}
      ctabar={
        <QxTouchDock
          onBack={onLeave}
          backLabel="离开"
          ask={{
            label: '问小青：练习结束后怎么办',
            draft: '这场模拟面试已经结束。请告诉我怎样再练一场，不要替我创建练习，也不要替我编造回答。',
          }}
          primary={{
            label: busy ? '正在生成练习报告…' : noAnswers ? '再练一场' : '再试一次生成报告',
            onClick: noAnswers ? onRestart : onRetry,
            disabled: busy,
          }}
        />
      }
    >
      <div
        data-testid="interview-time-up"
        data-time-up-variant={variant}
        data-kiosk-domain="interview"
        data-kiosk-screen="interview-session"
        data-qx-interview=""
        className="interview-flow interview-session-expired"
        data-visual-theme="service-desk"
        data-ux-density="touch"
      >
        <div className="interview-flow__scroll">
          <InterviewArt title={noAnswers ? '这一场没有记下回答' : '报告还没生成'}>
            这一场已经结束，不能再补答，也不会把没提交的内容并进报告。到点时还没提交的文字、没录完的语音、没确认的转写，都不算进这一场。
          </InterviewArt>
          <button type="button" className="qxt-iv-wide" onClick={onOpenTips}>
            <b>查看公开面试技巧</b>
            <small>准备清单与 STAR 方法随时可读，不依赖这场练习。</small>
          </button>
        </div>
      </div>
    </InterviewShell>
  )
}
