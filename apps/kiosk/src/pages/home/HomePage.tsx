// HomePage — 触屏版首页。本页只读取真实状态并执行封闭 action；展示交给 HomeTouchView。

import { useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { useOfficialChannels } from '../../hooks/useOfficialChannels'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { useSmartCampusCapabilityState } from '../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../hooks/useTerminalDeviceStatus'
import { useToolboxCapabilityState } from '../../hooks/useToolboxConfig'
import { ContinuePanel } from './components/ContinuePanel'
import { HomeTouchView } from './components/HomeTouchView'
import { HOME_V6_ROUTES, type HomeV6ActionId } from './homeV6Domains'
import { useHomeJobFairHighlight } from './hooks/useHomeJobFairHighlight'
import { useHomeJobHighlight } from './hooks/useHomeJobHighlight'

const ASSISTANT_TOPICS: Partial<Record<HomeV6ActionId, 'resume' | 'jobfair'>> = {
  'assistant-resume': 'resume',
  'assistant-jobfair': 'jobfair',
}

export function HomePage() {
  const navigate = useNavigate()
  const auth = useAuth()
  const { endKioskUse } = useKioskSessionControl()
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
    if ((actionId === 'jobs-hub' || actionId === 'fairs-hub' || actionId === 'campus-zone') && !recruitment.enabled) return
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
    <HomeTouchView
      isLoggedIn={auth.isLoggedIn}
      guestMode={auth.guestMode}
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
      onHome={() => navigate('/')}
      onOpenDevice={() => navigate('/error-offline')}
      onEndPrevious={() => endKioskUse('handover')}
    />
  )
}
