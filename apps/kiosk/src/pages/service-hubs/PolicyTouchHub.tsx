import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon, type QxTouchIconName } from '../../components/qingxu/touch/QxTouchIcon'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { QxTouchTask } from '../../components/qingxu/touch/QxTouchTask'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import {
  capabilityKindFor,
  hubUsesDevice,
  unavailableReason,
  type HubAvailability,
  type HubCapability,
  type HubIconKey,
} from './serviceHubModel'
import { SERVICE_HUB_SPECS } from './serviceHubSpecs'
import './policy-touch.css'

const TOUCH_ICON: Record<HubIconKey, QxTouchIconName> = {
  file: 'file',
  search: 'file',
  edit: 'pen',
  brief: 'clipboard',
  building: 'folder',
  calendar: 'ticket',
  map: 'map',
  mic: 'mic',
  chart: 'layers',
  shield: 'idcard',
  bot: 'sparkle',
  printer: 'printer',
  user: 'user',
  external: 'arrowR',
}

function policyNotice(state: HubAvailability): { title: string; detail: string; readiness: string } {
  if (state.apiDown) {
    return {
      title: '在线服务暂不可用。',
      detail: '已暂停需要联网处理的入口；线上平台目录、面试技巧、社保与档案指引等不联网内容仍可进入。',
      readiness: 'unavailable',
    }
  }
  if (state.apiChecking) {
    return {
      title: '正在确认在线服务。',
      detail: '检查完成前，需要在线处理的入口暂不开放。',
      readiness: 'checking',
    }
  }
  return {
    title: '进入具体服务后再确认实时能力。',
    detail: '本页只负责分流，不预报在线、名额、价格或办理结果。',
    readiness: 'ready',
  }
}

function policyStatus(state: HubAvailability): { text: string; tone: 'ok' | 'warn' | 'unknown' } {
  if (state.apiDown) return { text: '在线服务不可用', tone: 'warn' }
  if (state.apiChecking) return { text: '正在确认在线服务', tone: 'unknown' }
  return { text: '能力与设备状态以办理时确认为准', tone: 'unknown' }
}

function visibleDesc(cap: HubCapability): string {
  if (cap.route === '/renshi?tab=register') return '失业登记、就业登记和档案转移'
  return cap.description
}

/**
 * 政策服务台触屏版。规格仍读 SERVICE_HUB_SPECS.policy，不改稿 16 抽取表。
 * 七个入口和三条常用入口都在；在线的在确认完成前不可点，社保与档案指引除外。
 */
export function PolicyTouchHub() {
  const navigate = useNavigate()
  const spec = SERVICE_HUB_SPECS.policy
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const deviceAware = hubUsesDevice(spec)
  useTerminalDeviceStatus(deviceAware)
  const availability: HubAvailability = {
    apiDown: apiStatus === 'unavailable',
    apiChecking: apiStatus === 'checking',
    deviceOff: false,
    deviceChecking: false,
  }
  const notice = policyNotice(availability)
  const status = policyStatus(availability)
  const main = spec.capabilities.find((cap) => cap.route === '/renshi?tab=policy') ?? spec.capabilities[0]
  const mainReason = unavailableReason(main.kind, main.route, availability)

  const go = (route: string) => navigate(route)

  return (
    <QxTouchScreen
      testId="policy-touch-hub"
      stateId={notice.readiness}
      bodyClassName="qxt-body-scroll"
      band={(
        <QxTouchBand
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
            label: '问小青',
            draft: '我想了解政策和办事材料。请只做说明，不要判断我能不能领。',
          }}
          primary={{
            label: '查政策与公告',
            disabled: Boolean(mainReason),
            onClick: () => go(main.route),
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
        <p className="p10-truth">{spec.truth}</p>
        <div className="p10-notice" data-hub-notice="" data-readiness={notice.readiness} role="status">
          <b>{notice.title}</b>
          <span>{notice.detail}</span>
          {availability.apiDown ? (
            <button type="button" className="p10-retry" onClick={retryApi}>重新检测</button>
          ) : null}
        </div>

        <QxTouchTask
          dark
          icon="file"
          title="查政策与公告"
          desc={mainReason ?? '就业政策与发布方公告分开看，以来源原文为准。'}
          chip={mainReason ? '暂不开放' : '来源内容'}
          chipTone={mainReason ? 'clay' : 'teal'}
          held={Boolean(mainReason)}
          onClick={mainReason ? undefined : () => go('/renshi?tab=policy')}
          label={mainReason ? `查政策与公告：${mainReason}` : '查政策与公告'}
        />

        <section className="qxt-sec" aria-label="想办的事">
          <h2>想办的事</h2>
          <div className="qxt-grid2">
            {spec.goals.map((goal, index) => {
              const kind = capabilityKindFor(spec, goal.route)
              const reason = unavailableReason(kind, goal.route, availability)
              return (
                <div key={goal.route} data-hub-goal="">
                  <QxTouchTile
                    icon={goal.route.includes('eligibility') ? 'clipboard' : 'file'}
                    title={goal.label}
                    desc={reason ?? '进入后看本机已发布的内容'}
                    off={Boolean(reason)}
                    onClick={() => go(goal.route)}
                    index={index}
                    label={reason ? `${goal.label}：${reason}` : goal.label}
                  />
                  {reason ? <span className="p10-why" data-hub-reason="">{reason}</span> : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="qxt-sec" aria-label={spec.sectionTitle}>
          <h2>{spec.sectionTitle}</h2>
          <div className="p10-list">
            {spec.capabilities.map((cap, index) => {
              const reason = unavailableReason(cap.kind, cap.route, availability)
              return (
                <div key={cap.route + cap.title} data-hub-entry="">
                  <QxTouchTile
                    icon={TOUCH_ICON[cap.icon]}
                    title={cap.title}
                    desc={visibleDesc(cap)}
                    tone={cap.kind === 'ai' ? 'clay' : 'teal'}
                    off={Boolean(reason)}
                    onClick={() => go(cap.route)}
                    index={index}
                    label={reason ? `${cap.title}：${reason}` : cap.title}
                  />
                  {reason ? <span className="p10-why" data-hub-reason="">{reason}</span> : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="qxt-sec" aria-label="常用入口">
          <h2>常用入口</h2>
          <div className="p10-list">
            {spec.quickLinks.map((link, index) => {
              const reason = unavailableReason(link.kind, link.route, availability)
              return (
                <div key={link.route} data-hub-quick="">
                  <QxTouchTile
                    icon={TOUCH_ICON[link.icon]}
                    title={link.title}
                    desc={link.description}
                    tone="slate"
                    off={Boolean(reason)}
                    onClick={() => go(link.route)}
                    index={index}
                    label={reason ? `${link.title}：${reason}` : link.title}
                  />
                  {reason ? <span className="p10-why" data-hub-reason="">{reason}</span> : null}
                </div>
              )
            })}
          </div>
        </section>

        <p className="p10-note">
          <QxTouchIcon name="alert" size={28} />
          <span><b>{spec.noteTitle}</b>{spec.note}</span>
        </p>
      </div>
    </QxTouchScreen>
  )
}
