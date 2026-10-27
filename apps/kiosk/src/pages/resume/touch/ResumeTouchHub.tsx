import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchOverlay } from '../../../components/qingxu/touch/QxTouchOverlay'
import { QxTouchSlab } from '../../../components/qingxu/touch/QxTouchSlab'
import { QxTouchTile } from '../../../components/qingxu/touch/QxTouchTile'
import type { QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import type { QxTouchStatus } from '../../../components/qingxu/touch/QxTouchBand'
import { helpNeededLine } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import {
  unavailableReason,
  type HubAvailability,
  type HubCapability,
  type HubIconKey,
  type ServiceHubSpec,
} from '../../service-hubs/serviceHubModel'
import { ResumeTouchPage } from './ResumeTouchPage'

const ICONS: Record<HubIconKey, QxTouchIconName> = {
  file: 'file',
  search: 'eye',
  edit: 'pen',
  brief: 'clipboard',
  building: 'layout',
  calendar: 'ticket',
  map: 'map',
  mic: 'mic',
  chart: 'target',
  shield: 'shield',
  bot: 'sparkle',
  printer: 'printer',
  user: 'user',
  external: 'arrowR',
}

const DIAGNOSE = '/resume/source?intent=diagnose'
const OPTIMIZE = '/resume/source?intent=optimize'
const GENERATE = '/resume/generate'
const MATERIALS = '/resume/materials'
const CAREER = '/resume/career-plan'
const SELF = '/resume/self-assessment/intro'
const FIT = '/resume/job-fit'
const TEMPLATES = '/resume/templates'
const PRINT = '/print/upload?source=resume'
const MINE = '/me/resumes'
const RECORDS = '/me/ai-records'

const ASK_DRAFT = '我手头有没有简历还没定。请先问我现在最想完成什么，再告诉我该进哪一条。不要替我生成简历，也不要替我投递。'

function bandStatus(state: HubAvailability, label: string): QxTouchStatus {
  if (state.apiDown) return { text: '在线服务不可用', tone: 'warn' }
  if (state.apiChecking) return { text: '正在确认在线服务', tone: 'unknown' }
  if (state.deviceOff) return { text: '本机设备不可用', tone: 'warn' }
  if (state.deviceChecking) return { text: '正在确认本机设备', tone: 'unknown' }
  return { text: label }
}

function readinessOf(state: HubAvailability): 'unavailable' | 'degraded' | 'checking' | 'ready' {
  if (state.apiDown) return 'unavailable'
  if (state.deviceOff) return 'degraded'
  if (state.apiChecking || state.deviceChecking) return 'checking'
  return 'ready'
}

/**
 * 简历服务台触屏版。岗位、招聘会、面试、政策仍走 QxServiceHubPage 原来的返回。
 * 主卡「有，帮我改一改」不是第二张诊断卡：走查用的诊断卡在「其余」里。
 */
export function ResumeTouchHub({
  spec,
  availability,
  apiBlocked,
  deviceProbe,
  retryApi,
  contract,
  notice,
  pill,
}: {
  spec: ServiceHubSpec
  availability: HubAvailability
  apiBlocked: boolean
  deviceProbe: 'on' | 'off'
  retryApi: () => void
  contract: HubCapability | null
  notice: { title: string; detail: string }
  pill: { label: string }
}) {
  const navigate = useNavigate()
  const help = helpNeededLine(useSupportContact())
  const [moreOpen, setMoreOpen] = useState(false)
  const readiness = readinessOf(availability)
  const caps = new Map(spec.capabilities.map((item) => [item.route, item]))
  const quick = new Map(spec.quickLinks.map((item) => [item.route, item]))
  const cap = (route: string) => caps.get(route)
  const reasonFor = (item: { kind: HubCapability['kind']; route: string }) =>
    unavailableReason(item.kind, item.route, availability)

  const open = (route: string, reason: string | null) => {
    if (reason) return
    navigate(route)
  }

  const sheetSpecs: HubCapability[] = [
    cap(DIAGNOSE),
    cap(OPTIMIZE),
    cap(TEMPLATES),
    cap(PRINT),
    quick.get(MINE) as HubCapability | undefined,
    quick.get(RECORDS) as HubCapability | undefined,
    contract ?? undefined,
  ].filter((item): item is HubCapability => Boolean(item))

  const sheetCount = 6 + (contract ? 1 : 0)

  const tile = (item: HubCapability, kind: 'card' | 'quick', index: number) => {
    const reason = reasonFor(item)
    return (
      <QxTouchTile
        key={`${kind}-${item.route}`}
        icon={item.route === SELF ? 'compass' : ICONS[item.icon]}
        title={item.title}
        desc={reason ?? item.description}
        tone={item.kind === 'ai' ? 'teal' : 'slate'}
        off={Boolean(reason)}
        index={index}
        onClick={() => open(item.route, reason)}
        hub={{ kind, title: item.title, reason }}
      />
    )
  }

  const sheet = (
    <div className="qxt-hub-hold">
      {sheetSpecs.map((item, index) => tile(
        item,
        item.route === MINE || item.route === RECORDS ? 'quick' : 'card',
        index,
      ))}
    </div>
  )

  const showNotice = readiness !== 'ready' && !availability.apiDown
  const diagnose = cap(DIAGNOSE)
  const generate = cap(GENERATE)
  const diagnoseReason = diagnose ? reasonFor(diagnose) : null
  const generateReason = generate ? reasonFor(generate) : null

  let body: ReactNode
  if (availability.apiDown) {
    body = (
      <div className="qxt-hub-hold">
        {spec.capabilities.map((item, index) => tile(item, 'card', index))}
        {spec.quickLinks.map((item, index) => tile(item as HubCapability, 'quick', index))}
        <p className="qxt-resume-fine">{help}</p>
      </div>
    )
  } else {
    const materials = cap(MATERIALS)
    const career = cap(CAREER)
    const fit = cap(FIT)
    const self = quick.get(SELF)
    body = (
      <>
        <div className="qxt-resume-pair">
          {diagnose ? (
            <QxTouchSlab
              title="有，帮我改一改"
              desc="上传后做诊断或优化，改不改你定"
              chip="AI 诊断改写"
              take="问题清单和改法"
              visual={<div className="qxt-resume-art" />}
              off={Boolean(diagnoseReason)}
              lock={diagnoseReason ?? undefined}
              onClick={() => open(DIAGNOSE, diagnoseReason)}
              index={0}
            />
          ) : null}
          {generate ? (
            <QxTouchSlab
              title="没有，帮我写一份"
              desc="从零生成一份可核对的草稿"
              chip="AI 起草"
              take="一份新简历"
              visual={<div className="qxt-resume-art" />}
              off={Boolean(generateReason)}
              lock={generateReason ?? undefined}
              onClick={() => open(GENERATE, generateReason)}
              hub={{ kind: 'card', title: '从零生成简历', reason: generateReason }}
              index={1}
            />
          ) : null}
        </div>
        <div className="qxt-resume-sec">
          <b>也可以直接用</b>
          <small>不用先诊断</small>
          <button type="button" className="qxt-resume-more" onClick={() => setMoreOpen(true)}>
            其余 {sheetCount} 项
          </button>
        </div>
        <div className="qxt-resume-grid">
          {materials ? tile(materials, 'card', 2) : null}
          {career ? tile(career, 'card', 3) : null}
          {self ? tile(self as HubCapability, 'quick', 4) : null}
          {fit ? tile(fit, 'card', 5) : null}
        </div>
        {moreOpen ? null : <div hidden>{sheet}</div>}
      </>
    )
  }

  return (
    <ResumeTouchPage
      eyebrow={availability.apiDown ? '改简历' : 'AI简历服务'}
      title={availability.apiDown ? '在线服务暂时连不上' : '你手上有简历吗？'}
      subtitle={availability.apiDown
        ? '网络断开时，这台机器暂时办不了需要联网的事，请稍后再来。'
        : '有就帮你诊断改写，没有就一步步写一份。'}
      status={bandStatus(availability, pill.label)}
      showRail={false}
      seal={availability.apiDown ? null : 'idle'}
      bandKind="std"
      navCurrent="home"
      backLabel="返回"
      onBack={() => navigate('/')}
      ask={availability.apiDown
        ? { label: '小青也要联网，恢复后再问', disabled: true }
        : { label: '问小青：我该选哪一个？', draft: ASK_DRAFT }}
      primary={availability.apiDown
        ? { label: '重新检测', onClick: retryApi, kind: 'sec', noArrow: true }
        : undefined}
      overlay={moreOpen ? (
        <QxTouchOverlay
          kind="sheet"
          title="其余简历服务"
          onClose={() => setMoreOpen(false)}
          actions={<button type="button" className="qxt-btn qxt-btn-sec" onClick={() => setMoreOpen(false)}>收起</button>}
        >
          {sheet}
        </QxTouchOverlay>
      ) : null}
    >
      <div
        data-qx-page="service-hub"
        data-hub="resume"
        data-hub-api-blocked={apiBlocked ? 'true' : 'false'}
        data-hub-device-probe={deviceProbe}
        data-readiness={readiness}
      >
        {showNotice ? (
          <div className="qx-hub-notice" data-readiness={readiness} role="status" aria-live="polite">
            <span className="qx-hub-notice-copy">
              <b>{notice.title}</b>
              <span>{notice.detail}</span>
            </span>
          </div>
        ) : null}
        {body}
        <p className="qxt-resume-fine">
          {spec.truthTitle}{spec.truth}{spec.note}
        </p>
      </div>
    </ResumeTouchPage>
  )
}
