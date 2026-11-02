import { QxTouchIcon } from './QxTouchIcon'

export function QxTouchNav({
  onHome,
  onAdvisor,
  onProfile,
  current,
  testIds,
  className,
}: {
  onHome: () => void
  onAdvisor: () => void
  onProfile: () => void
  current?: 'home' | 'advisor' | 'profile'
  /** 三个按钮各自的 data-testid。不传就不写。 */
  testIds?: { home?: string; advisor?: string; profile?: string }
  /** 追加到主导航上的类名。 */
  className?: string
}) {
  return (
    <nav className={['qxt-nav', className].filter(Boolean).join(' ')} aria-label="主导航">
      <button type="button" className={current === 'home' ? 'qxt-on' : undefined} onClick={onHome} aria-current={current === 'home' ? 'page' : undefined} data-testid={testIds?.home}>
        <QxTouchIcon name="home" size={36} strokeWidth={2} />
        <span>首页</span>
      </button>
      <button type="button" className={current === 'advisor' ? 'qxt-on' : undefined} onClick={onAdvisor} aria-current={current === 'advisor' ? 'page' : undefined} data-testid={testIds?.advisor}>
        <QxTouchIcon name="sparkle" size={36} strokeWidth={2} />
        <span>AI 顾问</span>
      </button>
      <button type="button" className={current === 'profile' ? 'qxt-on' : undefined} data-route="/profile" onClick={onProfile} aria-current={current === 'profile' ? 'page' : undefined} data-testid={testIds?.profile}>
        <QxTouchIcon name="user" size={36} strokeWidth={2} />
        <span>我的</span>
      </button>
    </nav>
  )
}
