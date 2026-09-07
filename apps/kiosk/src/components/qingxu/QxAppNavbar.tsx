import { HomeIcon, SparklesIcon, UserIcon } from 'lucide-react'

/**
 * 青序流光底部三项导航。51 页共用这一份，不要在业务页再内联一份
 * `.qx-nav-item`。传进 `QxPageFrame` 的 `navbar` 槽。
 */
export function QxAppNavbar({
  onHome,
  onAdvisor,
  onProfile,
  current,
}: {
  onHome: () => void
  onAdvisor: () => void
  onProfile: () => void
  current?: 'home' | 'advisor' | 'profile'
}) {
  return (
    <>
      <button
        type="button"
        className="qx-nav-item"
        onClick={onHome}
        data-route="/"
        aria-current={current === 'home' ? 'page' : undefined}
      >
        <HomeIcon size={34} aria-hidden />
        首页
      </button>
      <button
        type="button"
        className="qx-nav-item"
        onClick={onAdvisor}
        data-route="/assistant"
        aria-current={current === 'advisor' ? 'page' : undefined}
      >
        <SparklesIcon size={34} aria-hidden />
        AI 顾问
      </button>
      <button
        type="button"
        className="qx-nav-item"
        onClick={onProfile}
        data-route="/profile"
        aria-current={current === 'profile' ? 'page' : undefined}
      >
        <UserIcon size={34} aria-hidden />
        我的
      </button>
    </>
  )
}
