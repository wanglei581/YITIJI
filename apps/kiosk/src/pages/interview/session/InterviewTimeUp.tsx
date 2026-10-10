import { InterviewShell } from '../InterviewShell'
import { InterviewCardHead, InterviewNotice, InterviewOptList, InterviewRail, InterviewStatus } from '../interviewQxParts'
import '../interview-service-desk.css'
import '../styles/interview-workbench-qx.css'
import '../styles/interview-qx2.css'

/**
 * 到点收尾后停住的一屏：没有记下回答，或报告没生成出来。
 * 这一场已经封了，所以这里没有输入框，也没有「继续答题」。版式照「这场练习已过期」那一屏。
 */
export function InterviewTimeUp({ variant, answersRecorded, onLeave, onRestart, onRetry, onOpenTips }: {
  variant: 'no-answers' | 'report-failed'
  /** 本场亲眼见过非跳过的回答提交成功。没见过就不说「已保存」。 */
  answersRecorded: boolean
  onLeave: () => void
  onRestart: () => void
  onRetry: () => void
  onOpenTips: () => void
}) {
  const noAnswers = variant === 'no-answers'
  const subtitle = noAnswers
    ? '没有记下的回答就没有报告。可以再练一场，或直接离开。'
    : answersRecorded
      ? '这一场已结束。报告现在生成不了，你的回答已保存，可以再试一次。'
      : '这一场已结束。报告现在生成不了，可以再试一次。'
  return (
    <InterviewShell
      title={<>练习时间到了，<em>{noAnswers ? '这一场没有记下回答' : '报告还没生成'}</em>。</>}
      subtitle={subtitle}
      status={{ tone: 'warn', label: '练习时间已到' }}
      ctabar={
        <div className="interview-qx-cta">
          <div className="iv-cta-row">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={onLeave}>离开</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={noAnswers ? onRestart : onRetry}>
              {noAnswers ? '再练一场' : '再试一次生成报告'}
            </button>
          </div>
        </div>
      }
    >
      <div
        data-testid="interview-time-up"
        data-time-up-variant={variant}
        data-kiosk-domain="interview"
        data-kiosk-screen="interview-session"
        data-qx-interview=""
        className="interview-flow interview-expired"
        data-visual-theme="service-desk"
        data-ux-density="touch"
      >
        <div className="interview-flow__scroll">
          <InterviewStatus
            label="这一场的状态"
            items={[
              { k: '本场作答', v: '已结束', tone: 'off' },
              { k: '到点前提交的回答', v: noAnswers ? '没有' : answersRecorded ? '已保存' : '以系统记录为准' },
              { k: '练习报告', v: noAnswers ? '不生成' : '还没生成', tone: 'off' },
            ]}
          />
          <section className="iv-card iv-empty">
            <div>
              <div className="iv-empty-mark" aria-hidden="true">!</div>
              <h2>{noAnswers ? '这一场没有记下回答' : '报告还没生成'}</h2>
              <p>到点时还没提交的文字、没录完的语音、没确认的转写，都不算进这一场。</p>
            </div>
          </section>
          <section className="iv-card">
            <InterviewCardHead title="接下来" hint="选一条" />
            <InterviewOptList
              rows={[
                noAnswers
                  ? { k: '练', title: '重新创建一场练习', desc: '岗位、面试官、时长重新选一次。', onClick: onRestart, go: true }
                  : { k: '报', title: '用已提交的回答生成报告', desc: '用到点前已经提交的回答生成，不用重新作答。', onClick: onRetry, go: true },
                { k: '技', title: '查看公开面试技巧', desc: '准备清单与 STAR 方法随时可读。', onClick: onOpenTips },
              ]}
            />
          </section>
          <section className="iv-card">
            <InterviewCardHead title="这一场留下了什么" hint="按系统记录" />
            <div className="iv-fields">
              <div className="iv-field"><small>到点前提交的回答</small><b>{noAnswers ? '没有' : '按系统记录保留'}</b></div>
              <div className="iv-field"><small>没提交的这一题</small><b>不保留</b></div>
              <div className="iv-field"><small>本场练习报告</small><b>{noAnswers ? '不生成' : '还没生成，可以再试'}</b></div>
              <div className="iv-field"><small>上传过的简历</small><b>按文件留存期限管理</b></div>
            </div>
          </section>
          <InterviewNotice>
            这一场已经封存，不能再补答，也不会把没提交的内容并进报告。
          </InterviewNotice>
          <InterviewRail />
        </div>
      </div>
    </InterviewShell>
  )
}
