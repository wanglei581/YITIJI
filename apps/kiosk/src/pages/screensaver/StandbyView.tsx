import type { KioskScreensaverItem } from '@ai-job-print/shared'
import type { StandbyPhase } from './standbyModel'

const CHIPS = ['材料打印', '简历服务', '岗位信息', '招聘会信息'] as const

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

      <div className="sb-chips" aria-label="可进入的服务类别">
        {CHIPS.map((chip) => <span key={chip} className="sb-chip">{chip}</span>)}
      </div>

      <section className="sb-cta-zone" aria-hidden="true">
        <div className="screensaver-wake-prompt sb-cta">
          <strong>轻触屏幕，开始办事</strong>
          <span>触摸屏幕开始使用 · 服务状态进入具体页面后核验</span>
        </div>
      </section>

      <footer className="sb-bottom">
        <div className="sb-truth" data-disclaimer="true">
          <span>不预报设备状态</span>
          <span>不展示虚构数量</span>
          <span>异常会如实提示</span>
        </div>
        <div className="sb-boundary">
          本机提供求职材料服务与第三方信息入口：<strong>不代收简历 · 不替你投递</strong>
          <br />
          公共终端，结束办理后请清空本次资料
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
