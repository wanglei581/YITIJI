import { QxTouchIcon } from './QxTouchIcon'

export function QxTouchNav({
  onHome,
  onAdvisor,
  onProfile,
  current,
  className,
}: {
  onHome: () => void
  onAdvisor: () => void
  onProfile: () => void
  current?: 'home' | 'advisor' | 'profile'
  /** 叠在主导航上。默认不传。 */
  className?: string
}) {
  return (
    <nav className={['qxt-nav', className].filter(Boolean).join(' ')} aria-label="主导航">
      <button type="button" className={current === 'home' ? 'qxt-on' : undefined} onClick={onHome} aria-current={current === 'home' ? 'page' : undefined}>
        <QxTouchIcon name="home" size={36} strokeWidth={2} />
        <span>首页</span>
      </button>
      <button type="button" className={current === 'advisor' ? 'qxt-on' : undefined} onClick={onAdvisor} aria-current={current === 'advisor' ? 'page' : undefined}>
        <QxTouchIcon name="sparkle" size={36} strokeWidth={2} />
        <span>AI 顾问</span>
      </button>
      <button type="button" className={current === 'profile' ? 'qxt-on' : undefined} onClick={onProfile} aria-current={current === 'profile' ? 'page' : undefined}>
        <QxTouchIcon name="user" size={36} strokeWidth={2} />
        <span>我的</span>
      </button>
    </nav>
  )
}
