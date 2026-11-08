import { isParkedRoute } from '../../../routes/parkedRoutes'
import { LICENSE_NO_NEW_TASK_REASON } from '../../../copy/unattendedCopy'
import { useKioskLicense } from '../../../layouts/KioskLicenseContext'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import { QxTouchTile } from '../../../components/qingxu/touch/QxTouchTile'
import type { QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import {
  unavailableReason,
  type CapabilityKind,
  type HubAvailability,
} from '../../service-hubs/serviceHubModel'
import { assistantOffAsk, useInterviewAiCapabilities, type InterviewAiKey } from '../useInterviewAiCapabilities'
import { InterviewScrollCue } from '../interviewQxParts'
import '../styles/interview-touch.css'
import '../styles/interview-touch-hub.css'

const ASK_DRAFT = '我想练面试。请先问我现在最想完成哪一项，不要替我开始练习。'

type Entry = {
  title: string
  desc: string
  icon: QxTouchIconName
  route: string
  kind: CapabilityKind
  /** kind 为 ai 的入口各自依赖哪一项 AI 能力；服务端配置明确可用才放行。 */
  capability?: InterviewAiKey
}

const TILES: Entry[] = [
  { title: '面试技巧', desc: '查看通用问答与沟通要点', icon: 'book', route: '/interview/tips', kind: 'info' },
  { title: '训练报告', desc: '查看模拟面试报告', icon: 'receipt', route: '/interview/reports', kind: 'info' },
  { title: 'AI服务记录', desc: '查看本人AI调用记录', icon: 'sparkle', route: '/me/ai-records', kind: 'account' },
  { title: '简历服务', desc: '先完善求职材料', icon: 'file', route: '/resume-service', kind: 'info' },
]

const PRACTICE_STEPS = [
  ['1 创建配置', '记下岗位、面试官和时长'],
  ['2 逐题作答', '默认文字回答，语音进入后检测'],
  ['3 生成练习报告', '练完再生成，到点不自动交卷'],
] as const

function readinessOf(state: HubAvailability): string {
  if (state.apiDown) return 'unavailable'
  if (state.deviceOff) return 'degraded'
  if (state.apiChecking || state.deviceChecking) return 'checking'
  return 'ready'
}

export function InterviewHubTouch({
  availability,
  apiBlocked,
  onRetry,
  status,
  notice,
}: {
  availability: HubAvailability
  apiBlocked: boolean
  onRetry: () => void
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  notice: { title: string; detail: string }
}) {
  const winding = useKioskLicense().mode === 'winding-down'
  const navigate = useNavigate()
  const capabilities = useInterviewAiCapabilities()
  const goBack = () => navigate('/')
  // 在线服务的原因优先（更具体）；服务可达但这一项 AI 能力没确认可用时，用能力状态的原因。
  const mainReason = (winding ? LICENSE_NO_NEW_TASK_REASON : null) ?? unavailableReason('ai', '/interview/setup', availability) ?? capabilities.reason('mock_interview')
  const assistantState = capabilities.state('assistant_chat')

  const tiles = (list: Entry[], withTestId: boolean) => list.filter((entry) => !isParkedRoute(entry.route)).map((entry, index) => {
    const reason = (winding ? LICENSE_NO_NEW_TASK_REASON : null) ?? unavailableReason(entry.kind, entry.route, availability)
      ?? (entry.capability ? capabilities.reason(entry.capability) : null)
    return (
      <QxTouchTile
        key={entry.title}
        icon={entry.icon}
        title={entry.title}
        desc={entry.desc}
        tone="teal"
        titleAs="h3"
        index={index}
        off={Boolean(reason)}
        reason={reason ?? undefined}
        testId={withTestId && entry.title === '面试技巧' ? 'hub-interview-grid-面试技巧' : undefined}
        onClick={() => navigate(entry.route)}
      />
    )
  })

  return (
    <QxTouchScreen
      page="interview"
      gallery={false}
      motion="none"
      bodyClassName="qxt-body-iv qxt-body-hub"
      band={
        <QxTouchBand
          kind="std"
          eyebrow="AI面试训练"
          title="把表达练熟，不替你下结论"
          sub="模拟问答、技巧与历史报告，用于练习和复盘，不代表真实面试结果。"
          seal="idle"
          place=" "
          status={{ text: status.label, tone: status.tone }}
          path={['创建配置', '逐题作答', '生成练习报告']}
          pathLabel="一场练习"
          onBack={goBack}
        />
      }
      dock={
        <QxTouchDock
          onBack={goBack}
          backLabel="返回"
          ask={winding ? { label: '问小青', disabled: true } : assistantState === 'available'
            ? { label: '问小青：先练哪一项？', draft: ASK_DRAFT }
            : assistantOffAsk(assistantState, '先看面试技巧')}
        />
      }
      nav={
        <QxTouchNav
          current="home"
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      <div
        className="qxt-ivhub"
        data-qx-page="service-hub"
        data-hub="interview"
        data-hub-api-blocked={apiBlocked ? 'true' : 'false'}
        data-hub-device-probe="off"
      >
        <div className={mainReason ? 'qx-hub-grid is-off' : 'qx-hub-grid'}>
          {mainReason ? (
            <div className="qxt-iv-dead" role="group" aria-disabled="true" aria-label="马上练一场">
              <span className="qxt-iv-lead">
                <span className="qxt-iv-chip">AI · 练习</span>
                <h3>马上练一场</h3>
                <p>选择岗位类型与难度后进入训练</p>
                <span className="qx-hub-why">{mainReason}</span>
              </span>
              <PracticeSteps />
            </div>
          ) : (
            <button type="button" className="qxt-iv-main" onClick={() => navigate('/interview/setup')}>
              <span className="qxt-iv-lead">
                <span className="qxt-iv-chip">AI · 练习</span>
                <b>马上练一场</b>
                <small>选择岗位类型与难度后进入训练</small>
              </span>
              <PracticeSteps />
            </button>
          )}
          {mainReason && !winding ? (
            <button type="button" className="qxt-iv-out" onClick={() => navigate('/interview/tips')}>
              可以先看面试技巧
            </button>
          ) : null}
          {tiles(TILES, true)}
        </div>
        <div
          className="qx-hub-notice qxt-iv-note"
          data-readiness={readinessOf(availability)}
          role="status"
          aria-live="polite"
        >
          <span className="qx-hub-notice-copy">
            <b>{notice.title}</b>
            <span>{notice.detail}</span>
          </span>
          <span><b>AI训练不是企业面试。</b>不进行录用判断，不向企业推荐候选人。不排名，不预测录用。报告仅供本人练习参考，不对外共享。</span>
        </div>
        {availability.apiDown ? (
          <button type="button" className="qxt-iv-wide" onClick={onRetry}>
            <b>重新检测</b>
            <small>检测完之前，需要联网的入口仍不开放</small>
          </button>
        ) : null}
      </div>
      <InterviewScrollCue />
    </QxTouchScreen>
  )
}

function PracticeSteps() {
  return (
    <span className="qxt-iv-steps">
      {PRACTICE_STEPS.map(([title, detail]) => (
        <i key={title}>
          <b>{title}</b>
          <em>{detail}</em>
        </i>
      ))}
    </span>
  )
}
