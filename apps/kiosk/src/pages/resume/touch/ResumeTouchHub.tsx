import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxTouchChip } from '../../../components/qingxu/touch/QxTouchChip'
import { QxTouchIcon, type QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import { QxTouchOverlay } from '../../../components/qingxu/touch/QxTouchOverlay'
import { QxTouchSlab } from '../../../components/qingxu/touch/QxTouchSlab'
import { QxTouchStateUnavailable } from '../../../components/qingxu/touch/QxTouchStates'
import { QxTouchTile } from '../../../components/qingxu/touch/QxTouchTile'
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
import { ResumePaperArt } from './ResumeTouchArt'
import { ResumeTouchPage } from './ResumeTouchPage'
import './hub.css'

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

/** 草稿只放问法，不替用户选，也不替用户生成或投递。 */
const ASK_DRAFT = '我手头有没有简历还没定。请先问我现在最想完成什么，再告诉我该进哪一条。不要替我生成简历，也不要替我投递。'

type HubPill = { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }

function bandStatus(pill: HubPill): QxTouchStatus {
  return { text: pill.label, tone: pill.tone === 'ok' ? 'ok' : pill.tone === 'unknown' ? 'unknown' : 'warn' }
}

function readinessOf(state: HubAvailability): 'unavailable' | 'degraded' | 'checking' | 'ready' {
  if (state.apiDown) return 'unavailable'
  if (state.deviceOff) return 'degraded'
  if (state.apiChecking || state.deviceChecking) return 'checking'
  return 'ready'
}

/** 单项能力的图标：稿里「简历素材库」用版式图标，「自我探索」用罗盘，其余按规格键。 */
function iconFor(item: HubCapability): QxTouchIconName {
  if (item.route === TEMPLATES) return 'layout'
  if (item.route === SELF) return 'compass'
  return ICONS[item.icon]
}

/**
 * 简历服务台触屏版（稿 resume / resume-more / st-unavailable）。
 * 岗位、招聘会、面试、政策四个服务台仍走 QxServiceHubPage 原来的旧返回，不经过这里。
 * 「有，帮我改一改」与「其余」里的 AI简历诊断是同一条路由，走查钩子只挂在后者上，不重复计数。
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
  pill: HubPill
}) {
  const navigate = useNavigate()
  const contact = useSupportContact()
  const help = contact.servicePhone ? helpNeededLine(contact) : ''
  const [moreOpen, setMoreOpen] = useState(false)
  const readiness = readinessOf(availability)
  const caps = new Map(spec.capabilities.map((item) => [item.route, item]))
  const quick = new Map(spec.quickLinks.map((item) => [item.route, item]))
  const cap = (route: string) => caps.get(route)
  const reasonFor = (item: { kind: HubCapability['kind']; route: string }) =>
    unavailableReason(item.kind, item.route, availability)
  const open = (route: string, reason: string | null) => {
    if (!reason) navigate(route)
  }
  const tone = (item: HubCapability) => (item.route === MINE ? 'slate' as const : 'teal' as const)

  const tile = (item: HubCapability, kind: 'card' | 'quick', index: number) => {
    const reason = reasonFor(item)
    return (
      <QxTouchTile
        key={`${kind}-${item.route}`}
        icon={iconFor(item)}
        title={item.title}
        desc={reason ?? item.description}
        tone={tone(item)}
        off={Boolean(reason)}
        index={index}
        onClick={() => open(item.route, reason)}
        hub={{ kind, title: item.title, reason }}
      />
    )
  }

  /** 其余项：规格里没摆在首屏的几项，加上默认关的合同审查。 */
  const sheetItems = ([
    { item: cap(DIAGNOSE), kind: 'card' },
    { item: cap(OPTIMIZE), kind: 'card' },
    { item: cap(TEMPLATES), kind: 'card' },
    { item: cap(PRINT), kind: 'card' },
    { item: quick.get(MINE) as HubCapability | undefined, kind: 'quick' },
    { item: quick.get(RECORDS) as HubCapability | undefined, kind: 'quick' },
    { item: contract ?? undefined, kind: 'card' },
  ] as Array<{ item: HubCapability | undefined; kind: 'card' | 'quick' }>)
    .filter((entry): entry is { item: HubCapability; kind: 'card' | 'quick' } => Boolean(entry.item))

  const sheetRow = ({ item, kind }: { item: HubCapability; kind: 'card' | 'quick' }) => {
    const reason = reasonFor(item)
    const badge = (item as { badge?: string }).badge ?? ''
    const ai = badge.startsWith('AI')
    return (
      <button
        key={`${kind}-${item.route}`}
        type="button"
        className={`qxt-tile qxt-hub-row${reason ? ' qxt-off qxt-hold' : ''}`}
        aria-disabled={reason ? true : undefined}
        data-hub-card={kind === 'card' ? '' : undefined}
        data-hub-quick={kind === 'quick' ? '' : undefined}
        data-hub-title={item.title}
        data-hub-reason={reason || undefined}
        onClick={() => {
          if (reason) return
          setMoreOpen(false)
          navigate(item.route)
        }}
      >
        <span className="qxt-ic"><QxTouchIcon name={iconFor(item)} size={32} strokeWidth={2} /></span>
        <span className="qxt-tx">
          <b>
            {item.title}
            {kind === 'card' && badge ? <QxTouchChip tone={ai ? 'teal' : 'slate'} ai={ai}>{badge}</QxTouchChip> : null}
          </b>
          <small>{reason ?? item.description}</small>
        </span>
        {reason ? null : <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>}
      </button>
    )
  }

  const unavailableBody = (
    <QxTouchStateUnavailable
      primaryTitle={spec.sectionTitle}
      primaryHint="要联网的先停"
      primary={spec.capabilities.map((item) => {
        const reason = reasonFor(item)
        return { icon: iconFor(item), title: item.title, desc: reason ?? item.description, tone: tone(item), off: Boolean(reason), hub: { kind: 'card' as const, title: item.title, reason } }
      })}
      secondaryTitle="常用入口"
      secondaryHint="同样要联网"
      secondary={spec.quickLinks.map((item) => {
        const reason = reasonFor(item)
        return { icon: iconFor(item as HubCapability), title: item.title, desc: reason ?? item.description, tone: tone(item as HubCapability), off: Boolean(reason), hub: { kind: 'quick' as const, title: item.title, reason } }
      })}
      remind={help}
    />
  )

  const diagnose = cap(DIAGNOSE)
  const generate = cap(GENERATE)
  const diagnoseReason = diagnose ? reasonFor(diagnose) : null
  const generateReason = generate ? reasonFor(generate) : null
  const materials = cap(MATERIALS)
  const career = cap(CAREER)
  const fit = cap(FIT)
  const self = quick.get(SELF) as HubCapability | undefined
  const showNotice = readiness !== 'ready' && !availability.apiDown

  const normalBody = (
    <>
      {showNotice ? (
        <div
          className={readiness === 'degraded' ? 'qxt-remind' : 'qxt-howto'}
          data-hub-notice=""
          data-readiness={readiness}
          role="status"
          aria-live="polite"
        >
          <QxTouchIcon name={readiness === 'degraded' ? 'alert' : 'clock'} size={34} strokeWidth={2} />
          <span>
            <b data-hub-notice-title="">{notice.title}</b>
            <span data-hub-notice-detail="">{notice.detail}</span>
          </span>
        </div>
      ) : null}
      {diagnose ? (
        <QxTouchSlab
          title="有，帮我改一改"
          desc="上传后做诊断或优化，改不改你定"
          chip="AI 诊断改写"
          chipAi
          take="问题清单和改法"
          visual={<ResumePaperArt width={150} state="annot" />}
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
          chipAi
          take="一份新简历"
          visual={<ResumePaperArt width={150} state="blank" />}
          off={Boolean(generateReason)}
          lock={generateReason ?? undefined}
          onClick={() => open(GENERATE, generateReason)}
          hub={{ kind: 'card', title: generate.title, reason: generateReason }}
          index={1}
        />
      ) : null}
      <div className="qxt-hub-group">
        <div className="qxt-sec qxt-rise" style={{ ['--i' as string]: 3 }}>
          也可以直接用<small>不用先诊断</small>
          <button type="button" className="qxt-hub-more" onClick={() => setMoreOpen(true)}>
            其余 {sheetItems.length} 项
            <QxTouchIcon name="chevR" size={24} strokeWidth={2.4} />
          </button>
        </div>
        <div className="qxt-grid2">
          {materials ? tile(materials, 'card', 4) : null}
          {career ? tile(career, 'card', 5) : null}
          {self ? tile(self, 'quick', 6) : null}
          {fit ? tile(fit, 'card', 7) : null}
        </div>
      </div>
      <QxTouchCallout kind="fine">{spec.truthTitle}{spec.truth}{spec.note}</QxTouchCallout>
    </>
  )

  return (
    <ResumeTouchPage
      eyebrow={availability.apiDown ? '改简历' : spec.eyebrow}
      title={availability.apiDown ? '在线服务暂时连不上' : '你手上有简历吗？'}
      subtitle={availability.apiDown
        ? '网络断开时，这台机器暂时办不了需要联网的事，请稍后再来。'
        : '有就帮你诊断改写，没有就一步步写一份。'}
      status={bandStatus(pill)}
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
        ? { label: '重新检测', onClick: retryApi, noArrow: true }
        : undefined}
      overlay={moreOpen ? (
        <QxTouchOverlay
          kind="sheet"
          title="其余简历服务"
          onClose={() => setMoreOpen(false)}
          actions={<button type="button" className="qxt-btn qxt-btn-sec qxt-hub-close" onClick={() => setMoreOpen(false)}>收起</button>}
        >
          <div className="qxt-hub-sheet" data-qx-page="resume-more">
            {sheetItems.map(sheetRow)}
          </div>
        </QxTouchOverlay>
      ) : null}
    >
      <div
        data-qx-page="resume"
        data-kiosk-domain="resume"
        data-hub="resume"
        data-hub-api-blocked={apiBlocked ? 'true' : 'false'}
        data-hub-device-probe={deviceProbe}
        data-readiness={readiness}
      >
        {availability.apiDown ? unavailableBody : normalBody}
      </div>
    </ResumeTouchPage>
  )
}
