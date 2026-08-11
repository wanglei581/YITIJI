// HomePage — V6 首页运行时纵切。
// 视觉真值：docs/design/kiosk-ai-os-v3-2026-08/01-home-v6.html。
// 本页只负责读取真实状态与执行封闭 action；视图不复制原型脚本或伪造任务进度。

import { KioskPageFrame } from '@ai-job-print/ui'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../hooks/useTerminalDeviceStatus'
import { useToolboxConfig } from '../../hooks/useToolboxConfig'
import { ContinuePanel } from './components/ContinuePanel'
import { V6HomeView } from './components/V6HomeView'
import { HOME_V6_ROUTES, type HomeV6ActionId } from './homeV6Domains'
import './styles/home-v6.css'

const ASSISTANT_TOPICS: Partial<Record<HomeV6ActionId, 'resume' | 'jobfair'>> = {
  'assistant-resume': 'resume',
  'assistant-jobfair': 'jobfair',
}

export function HomePage() {
  const navigate = useNavigate()
  const auth = useAuth()
  const device = useOutletContext<TerminalDeviceStatusView>()
  const toolbox = useToolboxConfig()
  const campus = useSmartCampusConfig()

  const handleAction = (actionId: HomeV6ActionId) => {
    if (actionId === 'smart-campus' && !campus.enabled) return
    if (actionId === 'toolbox' && !toolbox.enabled) return

    if (actionId === 'login') {
      navigate('/login', { state: { from: '/' } })
      return
    }

    const topic = ASSISTANT_TOPICS[actionId]
    navigate(HOME_V6_ROUTES[actionId], topic ? { state: { topic } } : undefined)
  }

  return (
    <KioskPageFrame className="v6-home-page">
      <V6HomeView
        isLoggedIn={auth.isLoggedIn}
        displayName={auth.displayName}
        deviceLabel={device.loading ? '设备检查中' : device.printerLabel}
        deviceReady={device.printerReady}
        deviceLoading={device.loading}
        toolboxEnabled={toolbox.enabled}
        campusEnabled={campus.enabled}
        continueSlot={<ContinuePanel />}
        onAction={handleAction}
      />
    </KioskPageFrame>
  )
}
