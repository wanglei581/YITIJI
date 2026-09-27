import type { KioskScreensaverItem } from '@ai-job-print/shared'
import type { StandbyPhase } from './standbyModel'

/** 稿 00：胶囊不是按钮，整屏只有一处唤醒。 */
const CHIPS = ['改简历', '练面试', '打印扫描', '查政策'] as const

export function StandbyView({
  phase,
  terminalName,
  date,
  time,
  current,
  mediaUrl,
  loopVideo,
  onAdvance,
  onWake,
}: {
  phase: StandbyPhase
  terminalName: string
  date: string
  time: string
  current: KioskScreensaverItem | undefined
  mediaUrl: string | null
  loopVideo: boolean
  onAdvance: () => void
  onWake: () => void
}) {
  const playing = phase === 'playing' && current && mediaUrl

  return (
    <div className="sb-stage" data-screen="standby" data-state={phase} data-testid={`standby-state-${phase}`}>
      <header className="sb-topbar">
        <div className="sb-brand">
          <div className="sb-seal">职</div>
          <div>
            <div className="sb-name">职易达</div>
            <div className="sb-sub">{terminalName}</div>
          </div>
        </div>
        <div className="sb-ready"><i />轻触即可开始</div>
      </header>

      <section className="sb-clock" aria-label="当前时间">
        <div className="sb-date">{date}</div>
        <div className="sb-time">{time}</div>
      </section>

      <section className="sb-media" data-testid="standby-material-slot" aria-label="宣传内容区域">
        <div className="sb-media-label"><i />宣传内容</div>
        {playing && current.type === 'video' ? (
          <video
            key={current.id}
            src={mediaUrl}
            autoPlay
            muted
            playsInline
            loop={loopVideo}
            onEnded={() => { if (!loopVideo) onAdvance() }}
            onError={() => onAdvance()}
            onCanPlay={(e) => { void e.currentTarget.play().catch(() => onAdvance()) }}
          />
        ) : null}
        {playing && current.type === 'image' ? (
          <img key={current.id} src={mediaUrl} alt="" onError={() => onAdvance()} />
        ) : null}
        {!playing ? (
          <div className="sb-fallback" data-testid="standby-material-fallback">
            <b>{phase === 'loading' ? '正在读取宣传内容' : '暂无宣传内容'}</b>
            <span>
              {phase === 'loading'
                ? '素材还没就绪。轻触屏幕仍可进入首页。'
                : '宣传物料未下发或暂不可用。不影响打印、简历与信息查询入口。'}
            </span>
          </div>
        ) : null}
      </section>

      <div className="sb-chips" aria-label="进门后可办">
        <span className="sb-chips-lead">进门后可办</span>
        {CHIPS.map((chip) => <span key={chip} className="sb-chip">{chip}</span>)}
      </div>

      <section className="sb-cta-zone" aria-hidden="true">
        <div className="sb-halo" />
        <div className="sb-halo sb-halo-b" />
        <div className="screensaver-wake-prompt sb-cta">
          <strong>轻触屏幕，开始办事</strong>
          <span>AI 帮你改简历、练面试；还能打印、扫描材料</span>
        </div>
      </section>

      <footer className="sb-bottom">
        <div className="sb-boundary" data-disclaimer="true">
          <strong>本机不代收简历 · 不替你投递</strong>
          {' · AI 内容会标明 · 闲置后自动退出'}
        </div>
      </footer>

      <button
        className="wake-target"
        type="button"
        aria-label="轻触屏幕进入职易达首页"
        data-testid="standby-primary"
        onClick={onWake}
      />
    </div>
  )
}
