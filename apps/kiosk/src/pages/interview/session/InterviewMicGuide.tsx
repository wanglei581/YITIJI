import type { ReactNode } from 'react'
import { InterviewCardHead, InterviewNotice, InterviewOptList, InterviewStatus } from '../interviewQxParts'

/**
 * 作答阶段麦克风不可用。文字回答仍是这一场的主路径。
 * 原因句由调用方传入，沿用麦克风能力表里的现有原句。
 */
export function InterviewMicGuide({
  active,
  reason,
  onRecheck,
  onOpenTips,
  onUseText,
  children,
}: {
  active: boolean
  reason: string | null
  onRecheck: () => void
  onOpenTips: () => void
  onUseText: () => void
  children: ReactNode
}) {
  if (!active) return children
  return (
    <div data-interview-state="mic-denied">
      <InterviewStatus
        label="当前能力状态"
        items={[
          { k: '语音回答', v: '不可用', tone: 'off' },
          { k: '文字回答', v: '可用', tone: 'ok' },
          { k: '本题', v: '尚未提交' },
        ]}
      />
      <section className="iv-card">
        <InterviewCardHead title="这一场可以继续用文字答" hint="三条路都在本页" />
        <InterviewOptList
          rows={[
            {
              k: '字',
              title: '改用文字输入回答本题',
              desc: '文字不依赖麦克风，是本场练习的主路径。',
              onClick: onUseText,
              go: true,
            },
            {
              k: '检',
              title: '重新检测麦克风',
              desc: '插好设备或改过权限后再检测，由检测结果决定是否放开语音。',
              onClick: onRecheck,
            },
            {
              k: '练',
              title: '先看回答结构提示',
              desc: '公开的 STAR 方法与准备清单不依赖语音能力。',
              onClick: onOpenTips,
            },
          ]}
        />
      </section>
      <section className="iv-card">
        <InterviewCardHead title="用文字答这一题" hint="不依赖麦克风" />
        {children}
      </section>
      <section className="iv-card">
        <InterviewCardHead title="重新检测前先排查" hint="三项常见原因" />
        <div className="iv-mini-list">
          <div><small>浏览器权限</small><p>站点麦克风权限被拒绝或未询问。</p></div>
          <div><small>音频输入</small><p>当前设备没有可用音频输入。</p></div>
          <div><small>设备占用</small><p>麦克风被其他程序占用未释放。</p></div>
        </div>
        {reason ? <p className="iv-copy">这一台机器现在的检测结果：{reason}</p> : null}
      </section>
      <InterviewNotice tone="danger">
        不预报恢复时间，也不显示「正在录音」。是否恢复语音，以重新检测的实际结果为准。
      </InterviewNotice>
    </div>
  )
}
