import { HomeIcon, SparklesIcon, UserIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function ResumeOptimizeNavbar() {
  const navigate = useNavigate()

  return (
    <>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/')} data-route="/" data-testid="resume-optimize-nav-home">
        <HomeIcon size={32} aria-hidden="true" />首页
      </button>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/assistant')} data-route="/assistant" data-testid="resume-optimize-nav-advisor">
        <SparklesIcon size={32} aria-hidden="true" />AI 顾问
      </button>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')} data-route="/profile" data-testid="resume-optimize-nav-profile">
        <UserIcon size={32} aria-hidden="true" />我的
      </button>
    </>
  )
}
