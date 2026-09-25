// HomePage — 青序流光首页运行时纵切。
// 视觉真值：docs/design/kiosk-redesign-2026-08/01-home.html。
// 本页只负责读取真实状态与执行封闭 action；展示细节交给 QxHomeView。

import { useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { useSmartCampusCapabilityState } from '../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../hooks/useTerminalDeviceStatus'
import { useToolboxCapabilityState } from '../../hooks/useToolboxConfig'
import { getTerminalCode } from '../../services/api/terminalConfig'
import { ContinuePanel } from './components/ContinuePanel'
import { QxHomeNavbar, QxHomeView } from './components/QxHomeView'
import { HOME_V6_ROUTES, type HomeV6ActionId } from './homeV6Domains'
import { useHomeJobFairHighlight } from './hooks/useHomeJobFairHighlight'
import { useHomeJobHighlight } from './hooks/useHomeJobHighlight'
import '../../styles/qingxu/index.css'
import './styles/home-qx.css'
import './styles/home-qx-mobile.css'

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
  // 招聘内容托管（3.13）：没打开时首页不摆岗位、招聘会入口；两个 hook 自己也不发请求。
  const recruitment = useRecruitmentHosting()
  const jobFair = useHomeJobFairHighlight()
  const jobs = useHomeJobHighlight()
  const terminalCode = getTerminalCode() || '设备未绑定'

  const handleAction = (actionId: HomeV6ActionId) => {
    if (actionId === 'smart-campus' && !(campus.status === 'ready' && campus.enabled)) return
    if (actionId === 'toolbox' && !(toolbox.status === 'ready' && toolbox.enabled)) return
    if ((actionId === 'jobs-hub' || actionId === 'fairs-hub') && !recruitment.enabled) return

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
      {/* 首页专属舞台：原稿 01-home 的品牌与时间在 Hero 内，不用 QxPageFrame 的独立顶栏。 */}
      <div className="qx-stage" data-qx-frame="true">
        <QxHomeView
          isLoggedIn={auth.isLoggedIn}
          displayName={auth.displayName}
          device={device}
          toolbox={toolbox}
          campus={campus}
          jobFair={jobFair}
          jobs={jobs}
          recruitmentOpen={recruitment.enabled}
          terminalCode={terminalCode}
          deviceStatus={deviceStatus}
          continueSlot={<ContinuePanel />}
          onAction={handleAction}
        />
        <nav className="qx-navbar" aria-label="主导航">
          <QxHomeNavbar onAction={handleAction} />
        </nav>
      </div>
    </div>
  )
}
