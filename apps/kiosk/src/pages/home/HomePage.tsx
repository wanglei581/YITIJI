// HomePage — 青序流光 2.0 首页。视觉真值：docs/design/kiosk-redesign-2026-08-v2/01-home.html。
// 本页只负责读取真实状态与执行封闭 action；展示细节交给 QxHomeView。

import { useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useOfficialChannels } from '../../hooks/useOfficialChannels'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { useSmartCampusCapabilityState } from '../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../hooks/useTerminalDeviceStatus'
import { useToolboxCapabilityState } from '../../hooks/useToolboxConfig'
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
  // 3.14：读到「托管关闭」且本机构至少有一个已启用渠道，才摆「机构官方渠道」。
  // 托管还没读到、渠道读取中 / 失败 / 为空、本机没有终端身份：一律 0，不摆，也不会先闪出来再收回。
  const channels = useOfficialChannels()
  const officialChannelCount = recruitment.status === 'ready' && !recruitment.enabled && channels.status === 'ready' ? channels.items.length : 0

  const handleAction = (actionId: HomeV6ActionId) => {
    if (actionId === 'smart-campus' && !(campus.status === 'ready' && campus.enabled)) return
    if (actionId === 'toolbox' && !(toolbox.status === 'ready' && toolbox.enabled)) return
    if ((actionId === 'jobs-hub' || actionId === 'fairs-hub') && !recruitment.enabled) return
    if (actionId === 'official-channels' && officialChannelCount === 0) return

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
          guestMode={auth.guestMode}
          displayName={auth.displayName}
          device={device}
          toolbox={toolbox}
          campus={campus}
          jobFair={jobFair}
          jobs={jobs}
          recruitment={recruitment}
          officialChannelCount={officialChannelCount}
          deviceStatus={deviceStatus}
          continueSlot={<ContinuePanel />}
          onAction={handleAction}
          onOpenDevice={() => navigate('/error-offline')}
        />
        <nav className="qx-navbar" aria-label="主导航">
          <QxHomeNavbar onAction={handleAction} />
        </nav>
      </div>
    </div>
  )
}
