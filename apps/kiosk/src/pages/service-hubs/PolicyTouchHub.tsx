import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import {
  capabilityKindFor,
  hubUsesDevice,
  unavailableReason,
  type CapabilityKind,
  type HubAvailability,
} from './serviceHubModel'
import { SERVICE_HUB_SPECS } from './serviceHubSpecs'
import './policy-touch.css'

const GOAL_DESC: Record<string, string> = {
  '/renshi?tab=policy': '就业、创业和灵活就业',
  '/renshi?tab=eligibility': '一次一问，共 9 项，不作资格认定',
  '/renshi?tab=social': '参保、证明、备案和社保卡',
  '/renshi?tab=register': '失业登记、就业登记和档案转移',
}

const QUICK = [
  { title: '浏览记录', description: '最近看过的政策', route: '/me/activity', kind: 'account' as CapabilityKind },
  { title: 'AI 服务记录', description: '本人的 AI 办理记录', route: '/me/ai-records', kind: 'account' as CapabilityKind },
  { title: '政策收藏', description: '你收藏过的政策', route: '/me/favorites?tab=policy', kind: 'info' as CapabilityKind },
  { title: '全部服务', description: '返回服务目录', route: '/', kind: 'info' as CapabilityKind },
]

function policyNotice(state: HubAvailability): { title: string; detail: string; readiness: string } {
  if (state.apiDown) {
    return {
      title: '在线服务暂不可用。',
      detail: '需要联网的入口先停用；社保指南、就业登记和回首页仍可进入。',
      readiness: 'unavailable',
    }
  }
  if (state.apiChecking) {
    return {
      title: '正在确认在线服务。',
      detail: '确认完成前，需要联网的入口先不开放。',
      readiness: 'checking',
    }
  }
  return {
    title: '先选要办的事。',
    detail: '进入之后再确认来源和条件，这一页不预报名额或结果。',
    readiness: 'ready',
  }
}

function policyStatus(state: HubAvailability): { text: string; tone: 'ok' | 'warn' | 'unknown' } {
  if (state.apiDown) return { text: '在线服务不可用', tone: 'warn' }
  if (state.apiChecking) return { text: '正在确认在线服务', tone: 'unknown' }
  return { text: '能力与设备状态以办理时确认为准', tone: 'ok' }
}

/**
 * 政策服务台触屏版。主卡、四个目标、四个常用入口。
 * 不重复铺七张能力卡。放行仍走 unavailableReason。
 */
export function PolicyTouchHub() {
  const navigate = useNavigate()
  const spec = SERVICE_HUB_SPECS.policy
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const deviceAware = hubUsesDevice(spec)
  const device = useTerminalDeviceStatus(deviceAware)
  const availability: HubAvailability = {
    apiDown: apiStatus === 'unavailable',
    apiChecking: apiStatus === 'checking',
    deviceOff: deviceAware && (device.kind === 'offline' || device.kind === 'error'),
    deviceChecking: deviceAware && device.loading,
  }
  const notice = policyNotice(availability)
  const status = policyStatus(availability)
  const mainRoute = '/renshi?tab=policy'
  const mainReason = unavailableReason('info', mainRoute, availability)

  const go = (route: string) => navigate(route)

  return (
    <QxTouchScreen
      testId="policy-touch-hub"
      stateId={notice.readiness}
      bodyClassName="qxt-body-scroll"
      band={(
        <QxTouchBand
          seal={null}
          eyebrow={spec.eyebrow}
          title={spec.title}
          sub={spec.subtitle}
          onBack={() => navigate('/')}
          status={status}
        />
      )}
      dock={(
        <QxTouchDock
          onBack={() => navigate('/')}
          backLabel="返回首页"
          ask={{
            label: '问小青：这一步怎么看来源？',
            draft: '我想了解政策和办事材料。请只做说明，不要判断我能不能领。',
          }}
        />
      )}
      nav={(
        <QxTouchNav
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      )}
    >
      <div
        className="p10-hub"
        data-qx-page="service-hub"
        data-hub="policy"
        data-hub-api-blocked={apiStatus === 'ready' ? 'false' : 'true'}
        data-hub-device-probe={deviceAware ? 'on' : 'off'}
      >
        <div className="p10-notice" data-hub-notice="" data-readiness={notice.readiness} role="status">
          <div className="p10-notice-copy">
            <b>{notice.title}</b>
            <span>{notice.detail}</span>
          </div>
          {availability.apiDown ? (
            <button type="button" className="p10-retry" onClick={retryApi}>重新检测</button>
          ) : null}
        </div>

        <div className="p10-entry" data-hub-entry="">
          <QxTouchTile
            icon="file"
            title="查政策与公告"
            desc={mainReason ?? '就业政策和公告都在下一页，按分区查看'}
            off={Boolean(mainReason)}
            onClick={() => go(mainRoute)}
            label={mainReason ? `查政策与公告：${mainReason}` : undefined}
          />
        </div>

        <section className="p10-sec" aria-label="四个目标">
          <div className="p10-grid">
            {spec.goals.map((goal, index) => {
              const kind = capabilityKindFor(spec, goal.route)
              const reason = unavailableReason(kind, goal.route, availability)
              return (
                <div key={goal.route} data-hub-goal="">
                  <QxTouchTile
                    icon={goal.route.includes('eligibility') ? 'clipboard' : 'file'}
                    title={goal.label}
                    desc={reason ?? (GOAL_DESC[goal.route] ?? goal.label)}
                    off={Boolean(reason)}
                    onClick={() => go(goal.route)}
                    index={index}
                    label={reason ? `${goal.label}：${reason}` : undefined}
                  />
                </div>
              )
            })}
          </div>
        </section>

        <section className="p10-sec" aria-label="常用入口">
          <h2>常用入口</h2>
          <div className="p10-grid">
            {QUICK.map((link, index) => {
              const reason = unavailableReason(link.kind, link.route, availability)
              return (
                <div key={link.route} data-hub-quick="">
                  <QxTouchTile
                    icon="file"
                    title={link.title}
                    desc={reason ?? link.description}
                    tone="slate"
                    off={Boolean(reason)}
                    onClick={() => go(link.route)}
                    index={index}
                    label={reason ? `${link.title}：${reason}` : undefined}
                  />
                </div>
              )
            })}
          </div>
        </section>

        <div className="p10-notes">
          <p className="p10-note">政策内容以来源发布为准。这里不判断你能不能领。</p>
          <p className="p10-note">AI顾问不替主管部门作资格判断。</p>
          <p className="p10-note">结束这次办理或闲置超时，会清除本机登录和临时信息。</p>
        </div>
      </div>
    </QxTouchScreen>
  )
}
