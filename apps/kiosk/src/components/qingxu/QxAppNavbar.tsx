import { HomeIcon, SparklesIcon, UserRoundIcon } from 'lucide-react'

export function QxAppNavbar({
  onHome,
  onAdvisor,
  onProfile,
}: {
  onHome: () => void
  onAdvisor: () => void
  onProfile: () => void
}) {
  return (
    <>
      <button type="button" className="qx-nav-item" onClick={onHome} data-route="/">
        <HomeIcon size={34} aria-hidden />
        首页
      </button>
      <button type="button" className="qx-nav-item" onClick={onAdvisor} data-route="/assistant">
        <SparklesIcon size={34} aria-hidden />
        AI 顾问
      </button>
      <button type="button" className="qx-nav-item" onClick={onProfile} data-route="/profile">
        <UserRoundIcon size={34} aria-hidden />
        我的
      </button>
    </>
  )
}
