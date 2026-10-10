import type { ReactNode } from 'react'
import { InterviewShell } from './InterviewShell'
import { InterviewCardHead, InterviewNotice, InterviewOptList, InterviewRail, InterviewStatus, InterviewSteps } from './interviewQxParts'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'

/**
 * 设置阶段的 AI 停用整屏。出题与报告都不做；
 * 打印题目单、技巧和回首页由调用方接上现有出路。
 */
export function InterviewAiDownScreen({
  voiceReason,
  error,
  onOpenTips,
  onHome,
  onReviewSetup,
  fallback,
}: {
  voiceReason: string
  error: string | null
  onOpenTips: () => void
  onHome: () => void
  onReviewSetup: () => void
  fallback: ReactNode
}) {
  return (
    <InterviewShell
      title={<>AI 面试官暂时<em>不能出题</em>。</>}
      subtitle="现在不编造一场练习，也不生成练习报告。不依赖出题的准备和通用题目单还可以用。"
      status={{ tone: 'bad', label: 'AI 暂时不能出题' }}
      ctabar={
        <div className="interview-qx-cta">
          {error ? <p className="iv-alert" role="alert">{error}</p> : null}
          <div className="iv-cta-row">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={onOpenTips}>
              查看面试技巧
            </button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={onHome}>
              回首页
            </button>
          </div>
        </div>
      }
    >
      <div
        data-kiosk-domain="interview"
        data-kiosk-screen="interview-setup"
        data-qx-interview=""
        data-interview-state="ai-down"
        className="interview-flow interview-setup"
        data-visual-theme="service-desk"
        data-ux-density="touch"
      >
        <div className="interview-flow__scroll">
          <InterviewStatus
            label="当前能力状态"
            items={[
              { k: 'AI 出题与追问', v: '不可用', tone: 'off' },
              { k: '练习报告', v: '不可生成', tone: 'off' },
              { k: '文字练习与技巧', v: '可用', tone: 'ok' },
            ]}
          />
          <section className="iv-card">
            <InterviewCardHead title="不靠 AI 也能做的事" hint="现在就能开始" />
            <InterviewOptList
              rows={[
                {
                  k: '1',
                  title: '用 STAR 结构写一题',
                  desc: '公开清单可勾选，写完自己核对背景、行动与结果。',
                  onClick: onOpenTips,
                  go: true,
                },
                {
                  k: '2',
                  title: '查看练习说明与设置项',
                  desc: '回到刚才的设置，服务恢复后可以再试一次开始练习。',
                  onClick: onReviewSetup,
                },
                {
                  k: '3',
                  title: '回首页',
                  desc: '这一场先不创建。首页上的其他入口不受影响。',
                  onClick: onHome,
                },
              ]}
            />
          </section>
          <section className="iv-card" data-testid="interview-interaction-mode">
            <InterviewCardHead title="语音回合" hint="这一场先不开放" />
            <div className="iv-chips">
              <button type="button" className="qx-btn" aria-disabled="true">
                语音回合（文字兜底）
              </button>
            </div>
            <p className="iv-hint" role="status" data-testid="interview-mode-voice-reason">{voiceReason}</p>
          </section>
          <section className="iv-card">
            <InterviewCardHead title="恢复后才重新开放" hint="现在都不做" />
            <InterviewSteps rows={[
              ['恢复后', '按配置出题', '针对岗位和面试官类型生成题目。'],
              ['恢复后', '追问与澄清', '根据你的回答继续提问。'],
              ['恢复后', '生成练习报告', '完成这场练习后才请求报告。'],
            ]} />
          </section>
          <section className="iv-card">
            <InterviewCardHead title="能力边界" hint="恢复前后不同" />
            <div className="iv-mini-list">
              <div><small>仍可用</small><p>公开技巧、准备清单，以及已建立这场练习时的通用题目单。</p></div>
              <div><small>受限</small><p>通用题目单不含点评，也不是这场模拟面试的替代。</p></div>
              <div><small>不可用</small><p>针对本场配置的出题、追问与报告。</p></div>
            </div>
          </section>
          {fallback}
          <InterviewNotice tone="danger">
            恢复时间以实际服务状态为准。通用题目单不展示通过率或评分。
          </InterviewNotice>
          <InterviewRail />
        </div>
      </div>
    </InterviewShell>
  )
}
