import { InterviewCardHead, InterviewNotice, InterviewOptList, InterviewRail, InterviewStatus, InterviewSteps } from '../interviewQxParts'

/**
 * 本题提交因网络失败。重试就是再交一次输入框里的回答；
 * 三种结果只作说明，不做成会跳到假页面的按钮。
 */
export function InterviewNetworkError({
  error,
  onBackToText,
  onOpenTips,
}: {
  error: string | null
  onBackToText: () => void
  onOpenTips: () => void
}) {
  return (
    <div data-interview-state="network-error">
      <InterviewStatus
        label="本次提交状态"
        items={[
          { k: '本题回答', v: '提交失败', tone: 'off' },
          { k: '下一题', v: '未获取' },
          { k: '练习报告', v: '未生成' },
        ]}
      />
      <section className="iv-card">
        <InterviewCardHead title="重试提交本题" hint="只重发这一次请求" />
        <p className="iv-copy">重试不会另外开一场练习，也不会重复提交上一题。再交一次之后，页面按实际返回往下走。</p>
        {error ? <p className="interview-session__error" role="alert">{error}</p> : null}
      </section>
      <section className="iv-card">
        <InterviewCardHead title="这三种结果分别意味着" hint="按实际返回分流" />
        <InterviewSteps rows={[
          ['取到下一题', '回到作答页', '本题按系统返回记为已提交，题号前进一题。'],
          ['本场已答完', '进入报告生成', '不再出题，转去请求本场练习报告。'],
          ['这场练习已过期', '回到练习设置', '上一场不能接着答，需要重新创建一场练习。'],
        ]} />
      </section>
      <section className="iv-card">
        <InterviewCardHead title="不想重试的话" hint="两条不挑网络的路" />
        <InterviewOptList
          rows={[
            {
              k: '字',
              title: '改用文字输入重新回答',
              desc: '刚才写下的内容还在输入框里，改完可以再交一次。',
              onClick: onBackToText,
              go: true,
            },
            {
              k: '练',
              title: '先按 STAR 整理这题要点',
              desc: '公开技巧页可以先写清背景、行动和结果，回来再提交。',
              onClick: onOpenTips,
            },
          ]}
        />
      </section>
      <InterviewNotice tone="danger">
        失败时不自动跳到「报告已生成」，也不承诺本场回答已经保存。
      </InterviewNotice>
      <InterviewRail />
    </div>
  )
}

export function InterviewNetworkBar({
  voiceAvailable,
  voiceReason,
  onBackToText,
  onRetryVoice,
}: {
  voiceAvailable: boolean
  voiceReason: string | null
  onBackToText: () => void
  onRetryVoice: () => void
}) {
  return (
    <div className="interview-qx-cta">
      <div className="iv-cta-row">
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onBackToText}>
          返回文字回答
        </button>
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          aria-disabled={!voiceAvailable || undefined}
          onClick={() => {
            if (!voiceAvailable) return
            onRetryVoice()
          }}
        >
          重新语音作答
        </button>
      </div>
      {!voiceAvailable && voiceReason ? (
        <p className="iv-hint" role="status">{voiceReason}</p>
      ) : null}
    </div>
  )
}
