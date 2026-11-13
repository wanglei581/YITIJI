import { isParkedRoute } from '../../../routes/parkedRoutes'
import { LICENSE_NO_NEW_TASK_REASON } from '../../../copy/unattendedCopy'
import { useKioskLicense } from '../../../layouts/KioskLicenseContext'
import { useState, type ReactNode } from 'react'
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
import { useKioskAiPause } from '../../../hooks/useKioskAiPause'
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
const PRINT = '/print/upload?source=resume'
const MINE = '/me/resumes'
const RECORDS = '/me/ai-records'

/** 后台把 AI 暂停时，要 AI 的入口写这一句（稿 resume 的 ?ai=down）。 */
const AI_PAUSED_REASON = 'AI能力当前不可用'
/** 首屏三步（与稿 screens.js 简历入口一致）。 */
const RESUME_HUB_STEPS = ['导入', '出初稿', '确认'] as const

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

/** 单项能力沿用规格图标。 */
function iconFor(item: HubCapability): QxTouchIconName {
  return ICONS[item.icon]
}

/**
 * 简历服务台触屏版（稿 resume / resume-more / st-unavailable）。
 * 岗位、招聘会、面试、政策四个服务台仍走 QxServiceHubPage 原来的旧返回，不经过这里。
 * AI简历诊断的走查钩子挂在第一张大卡上，不重复计数。
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
  const winding = useKioskLicense().mode === 'winding-down'
  const navigate = useNavigate()
  const contact = useSupportContact()
  const help = contact.servicePhone ? helpNeededLine(contact) : ''
  const [moreOpen, setMoreOpen] = useState(false)
  // 后台「AI 暂停」打开时，要 AI 的入口先在服务台置灰并写原因，不等人点进去才在失败屏知道（走查 I-35）。
  // 只认明确读到 paused === true：没读到、读失败都当没暂停，不把「没读到」说成「不可用」。
  const aiPaused = useKioskAiPause() === 'paused'
  const readiness = readinessOf(availability)
  const caps = new Map(spec.capabilities.filter((item) => !isParkedRoute(item.route)).map((item) => [item.route, item]))
  const quick = new Map(spec.quickLinks.filter((item) => !isParkedRoute(item.route)).map((item) => [item.route, item]))
  const cap = (route: string) => caps.get(route)
  const reasonFor = (item: { kind: HubCapability['kind']; route: string }) =>
    (winding ? LICENSE_NO_NEW_TASK_REASON : null) ?? unavailableReason(item.kind, item.route, availability) ?? (aiPaused && item.kind === 'ai' ? AI_PAUSED_REASON : null)
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
  const sheetItems: Array<{ item: HubCapability; kind: 'card' | 'quick' }> = contract ? [{ item: contract, kind: 'card' }] : []

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
      primaryTitle="简历能力"
      primaryHint="要联网的先停"
      primary={[...caps.values()].map((item) => {
        const reason = reasonFor(item)
        return { icon: iconFor(item), title: item.title, desc: reason ?? item.description, tone: tone(item), off: Boolean(reason), hub: { kind: 'card' as const, title: item.title, reason } }
      })}
      secondaryTitle="常用入口"
      secondaryHint="同样要联网"
      secondary={[...quick.values()].map((item) => {
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
  // 因 AI 暂停置灰的大卡改成稿里 ?ai=down 的行式小卡（不画「带走」和箭头），腾出高度给卡下的出路条。
  // 11/08 首屏用三步说清（导入、出初稿、确认），流程不变只缩短说法；稿 screens.js 同步补了。
  // 至少一张主卡能用才写：两张都停用（AI 暂停、授权收尾等）或连不上服务时，不介绍一条走不通的路。
  const showSteps = !availability.apiDown && Boolean((diagnose && !diagnoseReason) || (generate && !generateReason))
  const diagnosePaused = diagnoseReason === AI_PAUSED_REASON
  const generatePaused = generateReason === AI_PAUSED_REASON
  /** 大卡因 AI 暂停置灰时，卡下给一条不用 AI 的出路（稿：有简历先打印原件，没有先填内容导出原样草稿）。 */
  const exitLink = (label: string, route: string) => (
    <button type="button" className="qxt-hub-out" onClick={() => navigate(route)}>{label}</button>
  )
  /** 有出路条就把它和大卡并成一组；没有就原样，正常态的版面一点不动。 */
  const withExit = (slab: ReactNode, exit: ReactNode) => (exit ? <div className="qxt-hub-pair">{slab}{exit}</div> : slab)
  const optimize = cap(OPTIMIZE)
  const print = cap(PRINT)
  const mine = quick.get(MINE) as HubCapability | undefined
  const records = quick.get(RECORDS) as HubCapability | undefined
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
      {diagnose ? withExit(
        <QxTouchSlab
          title="有，帮我改一改"
          desc="上传后做诊断或优化，改不改你定"
          chip="AI 诊断改写"
          chipAi
          take={diagnosePaused ? undefined : '问题清单和改法'}
          takeStyle={diagnosePaused ? 'plain' : 'object'}
          row={diagnosePaused}
          visual={<ResumePaperArt width={150} state="annot" />}
          off={Boolean(diagnoseReason)}
          lock={diagnoseReason ?? undefined}
          onClick={() => open(DIAGNOSE, diagnoseReason)}
          hub={{ kind: 'card', title: diagnose.title, reason: diagnoseReason }}
          index={0}
        />,
        diagnosePaused ? exitLink('可以先打印原件', PRINT) : null,
      ) : null}
      {generate ? withExit(
        <QxTouchSlab
          title="没有，帮我写一份"
          desc="从零生成一份可核对的草稿"
          chip="AI 起草"
          chipAi
          take={generatePaused ? undefined : '一份新简历'}
          takeStyle={generatePaused ? 'plain' : 'object'}
          row={generatePaused}
          visual={<ResumePaperArt width={150} state="blank" />}
          off={Boolean(generateReason)}
          lock={generateReason ?? undefined}
          onClick={() => open(GENERATE, generateReason)}
          hub={{ kind: 'card', title: generate.title, reason: generateReason }}
          index={1}
        />,
        generatePaused ? exitLink('可以先填内容，导出原样草稿', GENERATE) : null,
      ) : null}
      <div className="qxt-hub-group">
        <div className="qxt-sec qxt-rise" style={{ ['--i' as string]: 3 }}>
          也可以直接用<small>不用先诊断</small>
          {sheetItems.length > 0 ? <button type="button" className="qxt-hub-more" onClick={() => setMoreOpen(true)}>
            其余 {sheetItems.length} 项
            <QxTouchIcon name="chevR" size={24} strokeWidth={2.4} />
          </button> : null}
        </div>
        <div className="qxt-grid2">
          {optimize ? tile(optimize, 'card', 4) : null}
          {print ? tile(print, 'card', 5) : null}
          {mine ? tile(mine, 'quick', 6) : null}
          {records ? tile(records, 'quick', 7) : null}
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
      path={showSteps ? RESUME_HUB_STEPS : undefined}
      seal={availability.apiDown ? null : 'idle'}
      bandKind="std"
      navCurrent="home"
      backLabel="返回"
      onBack={() => navigate('/')}
      ask={winding ? { label: '问小青', disabled: true } : availability.apiDown
        ? { label: '小青也要联网，恢复后再问', disabled: true }
        : { label: '问小青：我该选哪一个？', draft: ASK_DRAFT }}
      primary={availability.apiDown
        ? { label: '重新检测', onClick: retryApi }
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
