import { useNavigate } from 'react-router-dom'
import { HomeIcon, SparklesIcon, UserIcon } from 'lucide-react'

export function QxMemberNavbar({ current }: { current: 'home' | 'assistant' | 'profile' }) {
  const navigate = useNavigate()
  return (
    <>
      <button
        type="button"
        className="qx-nav-item"
        data-route="/"
        data-testid="qx-nav-home"
        aria-current={current === 'home' ? 'page' : undefined}
        onClick={() => navigate('/')}
      >
        <HomeIcon size={34} aria-hidden />
        首页
      </button>
      <button
        type="button"
        className="qx-nav-item"
        data-route="/assistant"
        data-testid="qx-nav-advisor"
        aria-current={current === 'assistant' ? 'page' : undefined}
        onClick={() => navigate('/assistant')}
      >
        <SparklesIcon size={34} aria-hidden />
        AI 顾问
      </button>
      <button
        type="button"
        className="qx-nav-item"
        data-route="/profile"
        data-testid="qx-nav-profile"
        aria-current={current === 'profile' ? 'page' : undefined}
        onClick={() => navigate('/profile')}
      >
        <UserIcon size={34} aria-hidden />
        我的
      </button>
    </>
  )
}
