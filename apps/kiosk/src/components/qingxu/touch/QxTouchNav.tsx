import { QxTouchIcon } from './QxTouchIcon'

export function QxTouchNav({
  onHome,
  onAdvisor,
  onProfile,
  current,
  testIdPrefix,
}: {
  onHome: () => void
  onAdvisor: () => void
  onProfile: () => void
  current?: 'home' | 'advisor' | 'profile'
  /** 不传不出 data-testid。传了则是 `${prefix}-home|advisor|profile`。 */
  testIdPrefix?: string
}) {
  const testId = (name: string) => (testIdPrefix ? `${testIdPrefix}-${name}` : undefined)
  return (
    <nav className="qxt-nav" aria-label="主导航">
      <button type="button" className={current === 'home' ? 'qxt-on' : undefined} onClick={onHome} aria-current={current === 'home' ? 'page' : undefined} data-testid={testId('home')}>
        <QxTouchIcon name="home" size={36} strokeWidth={2} />
        <span>首页</span>
      </button>
      <button type="button" className={current === 'advisor' ? 'qxt-on' : undefined} onClick={onAdvisor} aria-current={current === 'advisor' ? 'page' : undefined} data-testid={testId('advisor')}>
        <QxTouchIcon name="sparkle" size={36} strokeWidth={2} />
        <span>AI 顾问</span>
      </button>
      <button type="button" className={current === 'profile' ? 'qxt-on' : undefined} onClick={onProfile} aria-current={current === 'profile' ? 'page' : undefined} data-testid={testId('profile')}>
        <QxTouchIcon name="user" size={36} strokeWidth={2} />
        <span>我的</span>
      </button>
    </nav>
  )
}
