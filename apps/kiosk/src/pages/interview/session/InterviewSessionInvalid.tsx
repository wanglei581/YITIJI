import { QxAiHelp } from '../../../components/qingxu/QxAiHelp'
import { useAuth } from '../../../auth/useAuth'
import { InterviewShell } from '../InterviewShell'
import { InterviewCardHead, InterviewNotice, InterviewOptList, InterviewRail, InterviewStatus } from '../interviewQxParts'
import '../interview-service-desk.css'
import '../styles/interview-workbench-qx.css'
import '../styles/interview-qx2.css'

export function InterviewSessionInvalid({
  onRestart,
  onOpenReports,
}: {
  onRestart: () => void
  onOpenReports: () => void
}) {
  const { isLoggedIn } = useAuth()
  return (
    <InterviewShell
      title={<>这一场练习<em>已经过期</em>。</>}
      subtitle="这场练习是否过期，由当时的办理结果决定。过期后不能续答，也不能把没答完的一场说成已完成。"
      status={{ tone: 'bad', label: '这场练习已过期' }}
      ctabar={
        <div className="interview-qx-cta">
          <QxAiHelp label="问小青：练习过期了怎么办" draft="这场模拟面试已经过期。请告诉我怎样重新开始，不要替我创建练习。" />
          <div className="iv-cta-row">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={onOpenReports}>
              查看练习记录
            </button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={onRestart}>
              重新创建练习<em aria-hidden="true">→</em>
            </button>
          </div>
        </div>
      }
    >
      <div
        data-kiosk-domain="interview"
        data-kiosk-screen="interview-session"
        data-qx-interview=""
        data-testid="interview-expired"
        className="interview-flow interview-expired"
        data-visual-theme="service-desk"
        data-ux-density="touch"
      >
        <div className="interview-flow__scroll">
          <InterviewStatus
            label="这场练习的状态"
            items={[
              { k: '这场练习', v: '已过期', tone: 'off' },
              { k: '未提交的回答', v: '已失效' },
              { k: '已生成的报告', v: '不受影响', tone: 'ok' },
            ]}
          />
          <section className="iv-card iv-empty is-bad">
            <div>
              <div className="iv-empty-mark" aria-hidden="true">!</div>
              <h2>这场练习已过期，需要重新开始</h2>
              <p>公共终端上的这场练习有有效期。过期之后，旧的题目和还没提交的回答都不能继续使用。</p>
            </div>
          </section>
          <section className="iv-card">
            <InterviewCardHead title="接下来" hint="选一条" />
            <InterviewOptList
              rows={[
                {
                  k: '练',
                  title: '重新创建一场练习',
                  desc: '岗位、面试官、时长可以沿用刚才的选择，重新填一次即可。',
                  onClick: onRestart,
                  go: true,
                },
                {
                  k: '录',
                  title: '查看本人练习记录',
                  desc: isLoggedIn
                    ? '过期前已经生成过的报告仍按保存规则保留。'
                    : '登录后可保存练习报告。现在没有本人记录可看。',
                  onClick: onOpenReports,
                },
              ]}
            />
          </section>
          <section className="iv-card">
            <InterviewCardHead title="这一场留下了什么" hint="按系统记录" />
            <div className="iv-fields">
              <div className="iv-field"><small>已提交的回答</small><b>按系统记录保留</b></div>
              <div className="iv-field"><small>未提交的这一题</small><b>不保留</b></div>
              <div className="iv-field"><small>本场练习报告</small><b>未生成则不会补生成</b></div>
              <div className="iv-field"><small>上传过的简历</small><b>按文件留存期限管理</b></div>
            </div>
            <p className="iv-copy">过期只影响能不能继续答题，不代表已提交的内容被删除；具体留存以系统为准。</p>
          </section>
          <InterviewNotice>
            本页不保留上一场的题目和回答，也不会把它们并进新的一场。
          </InterviewNotice>
          <InterviewRail />
        </div>
      </div>
    </InterviewShell>
  )
}
