// HomePage — 首页运行时纵切。
// 视觉真值：docs/design/kiosk-redesign-2026-08/01-home.html（青序流光，2026-09-02 定为上线口径）。
// 旧引用 docs/design/kiosk-ai-os-v3-2026-08/01-home-v6.html 已降级为只读历史参考；
// 本页当前实现仍停在 V6 版式，属待迁移项，勿据旧稿继续施工。
// 本页只负责读取真实状态与执行封闭 action；视图不复制原型脚本或伪造任务进度。

import { KioskPageFrame } from '@ai-job-print/ui'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useSmartCampusCapabilityState } from '../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../hooks/useTerminalDeviceStatus'
import { useToolboxCapabilityState } from '../../hooks/useToolboxConfig'
import { ContinuePanel } from './components/ContinuePanel'
import { V6HomeFooterPanels } from './components/V6HomeFooterPanels'
import { V6HomeView } from './components/V6HomeView'
import { HOME_V6_ROUTES, type HomeV6ActionId } from './homeV6Domains'
import { useHomeJobFairHighlight } from './hooks/useHomeJobFairHighlight'
import './styles/home-v6.css'
import './styles/home-v6-footer.css'

const ASSISTANT_TOPICS: Partial<Record<HomeV6ActionId, 'resume' | 'jobfair'>> = {
  'assistant-resume': 'resume',
  'assistant-jobfair': 'jobfair',
}

export function HomePage() {
  const navigate = useNavigate()
  const auth = useAuth()
  const device = useOutletContext<TerminalDeviceStatusView>()
  const toolbox = useToolboxCapabilityState()
  const campus = useSmartCampusCapabilityState()
  const jobFair = useHomeJobFairHighlight()

  const handleAction = (actionId: HomeV6ActionId) => {
    if (actionId === 'smart-campus' && !(campus.status === 'ready' && campus.enabled)) return
    if (actionId === 'toolbox' && !(toolbox.status === 'ready' && toolbox.enabled)) return

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
        toolboxEnabled={toolbox.status === 'ready' && toolbox.enabled}
        campusEnabled={campus.status === 'ready' && campus.enabled}
        continueSlot={<ContinuePanel />}
        footerSlot={
          <V6HomeFooterPanels
            jobFair={jobFair}
            device={device}
            onAction={handleAction}
            onOpenFair={(fairId) => navigate(`/job-fairs/${encodeURIComponent(fairId)}`)}
          />
        }
        onAction={handleAction}
      />
    </KioskPageFrame>
  )
}
