// HomePage — 青序流光首页运行时纵切。
// 视觉真值：docs/design/kiosk-redesign-2026-08/01-home.html。
// 本页只负责读取真实状态与执行封闭 action；展示细节交给 QxHomeView。

import { useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useSmartCampusCapabilityState } from '../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../hooks/useTerminalDeviceStatus'
import { useToolboxCapabilityState } from '../../hooks/useToolboxConfig'
import { getTerminalCode } from '../../services/api/terminalConfig'
import { ContinuePanel } from './components/ContinuePanel'
import { QxHomeNavbar, QxHomeView } from './components/QxHomeView'
import { HOME_V6_ROUTES, type HomeV6ActionId } from './homeV6Domains'
import { useHomeJobFairHighlight } from './hooks/useHomeJobFairHighlight'
import './styles/home-qx.css'

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
  const terminalCode = getTerminalCode() || '设备未绑定'

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

  const deviceStatus = device.loading
    ? { tone: 'unknown' as const, label: '设备检查中' }
    : device.printerReady
      ? { tone: 'ok' as const, label: device.printerLabel }
      : device.kind === 'error'
        ? { tone: 'bad' as const, label: device.printerLabel }
        : device.kind === 'offline'
          ? { tone: 'warn' as const, label: device.printerLabel }
          : { tone: 'unknown' as const, label: '状态未知' }

  return (
    <div className="qx-home-host">
      <QxPageFrame
        title="首页"
        terminalLabel={`就业服务大厅 · ${terminalCode}`}
        status={deviceStatus}
        navbar={
          <QxHomeNavbar
            isLoggedIn={auth.isLoggedIn}
            displayName={auth.displayName}
            onAction={handleAction}
          />
        }
      >
        <QxHomeView
          isLoggedIn={auth.isLoggedIn}
          displayName={auth.displayName}
          device={device}
          toolbox={toolbox}
          campus={campus}
          jobFair={jobFair}
          continueSlot={<ContinuePanel />}
          onAction={handleAction}
          onOpenFair={(fairId) => navigate(`/job-fairs/${encodeURIComponent(fairId)}`)}
        />
      </QxPageFrame>
    </div>
  )
}
