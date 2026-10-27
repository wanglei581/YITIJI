import type { KioskScreensaverItem } from '@ai-job-print/shared'
import type { StandbyPhase } from './standbyModel'

/** 触屏稿 standby：胶囊不是按钮，整屏只有一处唤醒。 */
const CHIPS = ['改简历', '练面试', '打印扫描', '查政策'] as const

/** 背景光带：纯装饰，只用令牌色，路径全部落在 0–1200 内。 */
function Flow() {
  return (
    <div className="sb-flow" aria-hidden="true">
      <svg viewBox="0 0 1200 1920" preserveAspectRatio="none">
        <path className="sb-flow-a" d="M0 1500 C 260 960, 520 1880, 820 1190 S 1150 570, 1200 840" />
        <path className="sb-flow-b" d="M0 1730 C 300 1270, 560 2040, 860 1420 S 1160 880, 1200 1110" />
        <path className="sb-flow-c" d="M0 690 C 340 230, 640 960, 900 500 S 1180 40, 1200 270" />
      </svg>
    </div>
  )
}

export function StandbyView({
  phase,
  terminalName,
  date,
  time,
  current,
  mediaUrl,
  loopVideo,
  slideIndex = 0,
  slideCount = 0,
  onAdvance,
  onMediaError,
  onWake,
}: {
  phase: StandbyPhase
  terminalName: string
  date: string
  time: string
  current: KioskScreensaverItem | undefined
  mediaUrl: string | null
  loopVideo: boolean
  /** 当前第几条、一共几条可播素材；多于一条时画轮播点。默认不画。 */
  slideIndex?: number
  slideCount?: number
  onAdvance: () => void
  /** 素材本身加载失败（不是播完）：由页面记下并跳过，全部失败时显示「暂无宣传内容」。 */
  onMediaError: () => void
  onWake: () => void
}) {
  const playing = phase === 'playing' && current && mediaUrl

  return (
    <div className="sb-stage" data-screen="standby" data-state={phase} data-testid={`standby-state-${phase}`}>
      <div className="sb-halo-bg" aria-hidden="true" />
      <Flow />
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
        <div className="sb-time">{time}</div>
        <div className="sb-date">{date}</div>
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
            onError={() => onMediaError()}
            onCanPlay={(e) => { void e.currentTarget.play().catch(() => onAdvance()) }}
          />
        ) : null}
        {playing && current.type === 'image' ? (
          <img key={current.id} src={mediaUrl} alt="" onError={() => onMediaError()} />
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

      {slideCount > 1 ? (
        <div className="sb-dots" aria-hidden="true">
          {Array.from({ length: slideCount }, (_, i) => <i key={i} className={i === slideIndex ? 'on' : undefined} />)}
        </div>
      ) : null}

      <div className="sb-chips" aria-label="进门后可办">
        <span className="sb-chips-lead">进门后可办</span>
        {CHIPS.map((chip) => <span key={chip} className="sb-chip">{chip}</span>)}
      </div>

      <section className="sb-cta-zone" aria-hidden="true">
        <div className="screensaver-wake-prompt sb-cta">
          <span className="sb-ring">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a5.5 5.5 0 0 1-4.6-2.5L3.6 14a1.5 1.5 0 0 1 2.5-1.7L8 15" />
            </svg>
          </span>
          <span className="sb-cta-txt">
            <strong>轻触屏幕，开始办事</strong>
            <span>AI 帮你改简历、练面试；还能打印、扫描材料</span>
          </span>
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
