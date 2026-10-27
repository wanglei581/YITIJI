import { useEffect, useRef, useState, type ReactNode } from 'react'
import { QxTouchArtChecklist, QxTouchArtReport, QxTouchArtResume, QxTouchArtStack } from '../../../components/qingxu/touch/QxTouchArt'
import { QxTouchAskBar } from '../../../components/qingxu/touch/QxTouchAskBar'
import { QxTouchBand } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import { QxTouchTask } from '../../../components/qingxu/touch/QxTouchTask'
import { QxTouchTile } from '../../../components/qingxu/touch/QxTouchTile'
import { hasKioskSensitiveSession } from '../../../auth/kioskSensitiveSession'
import { homeStandbyNote, publicIdleLogoutLabel, resultIdleLogoutLabel } from '../../../auth/kioskIdleTiming'
import type { RecruitmentHostingState } from '../../../hooks/useRecruitmentHosting'
import type { SmartCampusCapabilityState } from '../../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../../hooks/useTerminalDeviceStatus'
import type { ToolboxCapabilityState } from '../../../hooks/useToolboxConfig'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import { useTerminalKiosk } from '../../../services/api/screensaver'
import { unitCentsFor, usePrintPriceConfig } from '../../../services/print/priceConfigApi'
import { printDomainStatus } from '../homeDomainStatus'
import type { HomeV6ActionId } from '../homeV6Domains'
import type { HomeJobFairHighlightState } from '../hooks/useHomeJobFairHighlight'
import type { HomeJobHighlightState } from '../hooks/useHomeJobHighlight'
import { campusCopy, capabilityMark, greetingWord, jobCopy } from '../homeTouchCopy'
import { HomeIdentityActions } from './HomeIdentityActions'

const ASSISTANT_VOICE_ENTRY = import.meta.env.VITE_USE_TRTC_CALL === 'true'
const HOME_ASK_DRAFT = '我想办一件事，请告诉我从哪一项开始。'

export interface HomeTouchDeviceStatus {
  tone: 'ok' | 'warn' | 'bad' | 'unknown'
  label: string
}

interface HomeTouchViewProps {
  isLoggedIn: boolean
  guestMode: boolean
  device: TerminalDeviceStatusView
  toolbox: ToolboxCapabilityState
  campus: SmartCampusCapabilityState
  jobFair: HomeJobFairHighlightState & { retry: () => void }
  jobs: HomeJobHighlightState & { retry: () => void }
  recruitment: RecruitmentHostingState
  officialChannelCount: number
  deviceStatus: HomeTouchDeviceStatus
  continueSlot?: ReactNode
  onAction: (actionId: HomeV6ActionId) => void
  onHome: () => void
  onOpenDevice: () => void
  onEndPrevious: () => void
}

export function HomeTouchView({
  isLoggedIn,
  guestMode,
  device,
  toolbox,
  campus,
  jobFair,
  jobs,
  recruitment,
  officialChannelCount,
  deviceStatus,
  continueSlot,
  onAction,
  onHome,
  onOpenDevice,
  onEndPrevious,
}: HomeTouchViewProps) {
  const kiosk = useTerminalKiosk()
  const price = usePrintPriceConfig()
  const bwUnit = unitCentsFor(price.config, 'black_white')
  const colorUnit = unitCentsFor(price.config, 'color')
  const priceKnown = price.status === 'ready' && bwUnit !== null && colorUnit !== null
  const paidPrint = priceKnown && (bwUnit > 0 || colorUnit > 0)
  const freePrint = priceKnown && bwUnit === 0 && colorUnit === 0
  const priceNotice = paidPrint && !freePrint ? '收费以现场公示为准' : null
  const [now, setNow] = useState(() => new Date())
  const [introDone, setIntroDone] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const pendingRises = () => node.getAnimations({ subtree: true }).filter((anim) => (
      anim instanceof CSSAnimation && anim.animationName === 'qxt-rise' && anim.playState !== 'finished'
    ))
    const onEnd = (event: AnimationEvent) => {
      if (event.animationName !== 'qxt-rise') return
      if (pendingRises().length === 0) setIntroDone(true)
    }
    node.addEventListener('animationend', onEnd)
    // 减弱动效时 rise 不会开始。超时只作收尾，不在首帧空列表上提前盖章。
    const timer = window.setTimeout(() => setIntroDone(true), 1600)
    return () => {
      node.removeEventListener('animationend', onEnd)
      window.clearTimeout(timer)
    }
  }, [])

  const printStatus = printDomainStatus({
    deviceLoading: device.loading,
    deviceReady: device.printerReady,
    deviceLabel: device.printerLabel,
    deviceNotice: device.printerNotice,
  })
  const job = jobCopy(jobs)
  const fair = campusCopy(jobFair)
  const toolboxReady = toolbox.status === 'ready' && Boolean(toolbox.configVersion) && toolbox.enabled
  const campusReady = campus.status === 'ready' && Boolean(campus.configVersion) && campus.enabled
  const recruitmentOpen = recruitment.enabled
  const channelsTile = !recruitmentOpen && officialChannelCount > 0
  const greeting = greetingWord(now)
  const standbyNote = homeStandbyNote({ isLoggedIn, guestMode, hasSensitiveSession: hasKioskSensitiveSession() }, publicIdleLogoutLabel())
  const printChip = device.loading ? printStatus.note : device.printerReady ? '先选材料再出纸 · 带走：打印件' : device.printerLabel
  const printNote = device.loading || device.printerReady ? undefined : printStatus.note
  const tileCount = 2 + (recruitmentOpen ? 2 : channelsTile ? 1 : 0) + (toolboxReady ? 1 : 0) + (campusReady ? 1 : 0)
  const dense = tileCount >= 4
  const boundary = recruitmentOpen
    ? '岗位与招聘会仅展示第三方或官方来源；本终端仅展示与跳转，不代收简历。'
    : channelsTile
      ? '岗位与招聘会请看本机构官方渠道，本终端不代收简历。'
      : recruitment.status === 'ready'
        ? '本终端未开放岗位与招聘会信息，也不代收简历。'
        : '本终端不代收简历。'

  let tileIndex = 5
  const nextTile = () => tileIndex++

  return (
    <QxTouchScreen
      rootRef={rootRef}
      testId="qx-home"
      pageId="home"
      intro={introDone ? 'done' : undefined}
      bodyClassName={['qxt-home', isLoggedIn ? 'qxt-home-on' : '', dense ? 'qxt-home-squeeze' : ''].filter(Boolean).join(' ')}
      markers={{
        recruitment: recruitmentOpen ? 'open' : 'closed',
        toolbox: capabilityMark(toolbox.status, toolbox.configVersion, toolboxReady),
        campus: capabilityMark(campus.status, campus.configVersion, campusReady),
        'official-channels': channelsTile ? 'shown' : undefined,
        'extra-services': toolboxReady || campusReady ? 'shown' : undefined,
      }}
      band={(
        <>
          <QxTouchBand
            kind="hero"
            live
            back={false}
            dense={dense}
            place="就业服务大厅"
            eyebrow={greeting}
            title="我是小青"
            sub="今天想办哪件事？下面选一项，或者直接问我"
            status={{ text: deviceStatus.label, tone: deviceStatus.tone }}
          />
          <QxTouchAskBar
            voice={ASSISTANT_VOICE_ENTRY}
            onClick={() => {
              rememberAssistantDraft(HOME_ASK_DRAFT)
              onAction('assistant')
            }}
          />
        </>
      )}
      nav={(
        <QxTouchNav
          current="home"
          onHome={onHome}
          onAdvisor={() => onAction('assistant')}
          onProfile={() => onAction('profile')}
        />
      )}
    >
      <div className="qxt-home-go" data-testid="home-context-region">{continueSlot}</div>
      <div className="qxt-home-tasks">
        <QxTouchTask actionId="resume-hub" icon="file" title="改简历" label="改简历" desc="上传或扫描，诊断、优化或生成新简历，改不改你定" chip="AI 诊断改写" chipAi take="带走：新简历" takeIcon="check" visual={<QxTouchArtResume />} index={1} onClick={() => onAction('resume-hub')} />
        <QxTouchTask actionId="interview-hub" icon="mic" title="练面试" label="练面试" desc="回答常见问题，当场看反馈，不做录用判断" chip="AI 模拟面试" chipAi take="带走：面试反馈" takeIcon="check" visual={<QxTouchArtReport />} index={2} onClick={() => onAction('interview-hub')} />
        <QxTouchTask
          actionId="print-hub"
          icon="printer"
          title="打印 · 扫描"
          desc="手机扫码传文件、插 U 盘，或扫描原件"
          chip={printChip}
          chipTone={device.printerReady && !device.loading ? 'ghost' : 'clay'}
          note={printNote}
          take="开始选择材料"
          takeIcon="check"
          label="打印 · 扫描"
          dark
          visual={<QxTouchArtStack />}
          index={3}
          dataAttrs={{ 'home-device-panel': '', 'panel-state': device.loading ? 'loading' : device.kind }}
          onClick={() => onAction('print-hub')}
        />
        <QxTouchTask actionId="policy-hub" icon="landmark" title="查政策" label="查政策" desc="补贴、社保怎么办，要带哪些材料，以官方发布为准" chip="官方发布" chipTone="slate" take="查看政策说明" takeIcon="check" visual={<QxTouchArtChecklist />} index={4} onClick={() => onAction('policy-hub')} />
      </div>
      <div className="qxt-home-tiles" data-count={tileCount}>
        <QxTouchTile chevron={false} layout="stack" icon="ticket" title="到机取件" desc="手机上下了单，来这里取" actionId="pickup-claim" index={nextTile()} onClick={() => onAction('pickup-claim')} />
        {recruitmentOpen ? (
          jobs.status === 'error' ? (
            <QxTouchTile key={`jobs-${jobs.status}`} chevron={false} layout="stack" icon="refresh" tone="slate" title="社会招聘" desc={job.description} badge={job.badge} label={`社会招聘 ${job.badge}`} actionId="jobs-retry" dataAttrs={{ 'home-jobs-panel': '', 'panel-state': 'error', 'jobs-badge': job.badge }} index={nextTile()} onClick={jobs.retry} />
          ) : (
            <QxTouchTile key={`jobs-${jobs.status}`} chevron={false} layout="stack" icon="clipboard" tone="slate" title="社会招聘" desc={job.description} badge={job.badge} actionId="jobs-hub" dataAttrs={{ 'home-jobs-panel': '', 'panel-state': jobs.status, 'jobs-badge': job.badge }} index={nextTile()} onClick={() => onAction('jobs-hub')} />
          )
        ) : null}
        {recruitmentOpen ? (
          jobFair.status === 'error' ? (
            <QxTouchTile key={`fair-${jobFair.status}`} chevron={false} layout="stack" icon="refresh" tone="slate" title="校园招聘" desc={fair.description} badge={fair.badge} label="招聘会 重新加载" actionId="fairs-retry" dataAttrs={{ 'home-job-fair-panel': '', 'panel-state': 'error' }} index={nextTile()} onClick={jobFair.retry} />
          ) : (
            <QxTouchTile key={`fair-${jobFair.status}`} chevron={false} layout="stack" icon="book" tone="slate" title="校园招聘" desc={fair.description} badge={fair.badge} actionId="campus-zone" dataAttrs={{ 'home-job-fair-panel': '', 'panel-state': jobFair.status }} index={nextTile()} onClick={() => onAction('campus-zone')} />
          )
        ) : null}
        {channelsTile ? (
          <QxTouchTile chevron={false} layout="stack" icon="qr" tone="slate" title="本机构官方渠道" desc={`本机有 ${officialChannelCount} 个渠道，扫码到机构官网`} actionId="official-channels" index={nextTile()} onClick={() => onAction('official-channels')} />
        ) : null}
        <QxTouchTile chevron={false} layout="stack" icon="help" tone="clay" title="帮助" desc="常见问题、服务电话" actionId="help" index={nextTile()} onClick={() => onAction('help')} />
        {toolboxReady ? (
          <QxTouchTile chevron={false} layout="stack" icon="layers" title="百宝箱" desc="按本机已上架的扩展服务进入" actionId="toolbox" index={nextTile()} onClick={() => onAction('toolbox')} />
        ) : null}
        {campusReady ? (
          <QxTouchTile chevron={false} layout="stack" icon="landmark" tone="slate" title="智慧校园" desc="按本机开通范围进入校园服务" actionId="smart-campus" index={nextTile()} onClick={() => onAction('smart-campus')} />
        ) : null}
      </div>
      <div className="qxt-home-id" data-member={isLoggedIn ? 'true' : undefined}>
        {isLoggedIn ? null : <p className="qxt-home-id-note">这台机器上没有待继续的办理 · {standbyNote}</p>}
        <HomeIdentityActions isLoggedIn={isLoggedIn} onLogin={() => onAction('login')} onEndPrevious={onEndPrevious} />
        <button type="button" className="qxt-home-mini" data-testid="home-device-status" onClick={onOpenDevice}>设备状态</button>
      </div>
      <footer className="qxt-home-foot">
        <p>
          {boundary}
          {' · AI 生成的内容都会标明，仅供参考'}
          {priceNotice ? ` · ${priceNotice}` : ''}
          {` · 离开 ${publicIdleLogoutLabel()} 无操作自动退出登录`}
          {' · 打开本人文档、诊断报告或优化结果后 '}
          {resultIdleLogoutLabel()}
          {' 无操作自动退出'}
        </p>
        <p className="qxt-home-icp">
          {kiosk ? <span>鲁ICP备2026023517号-2</span> : (<a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer noopener">鲁ICP备2026023517号-2</a>)}
          <span aria-hidden="true"> · </span>
          {kiosk ? <span>鲁公网安备37021402007308号</span> : (<a href="https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308" target="_blank" rel="noreferrer noopener">鲁公网安备37021402007308号</a>)}
        </p>
      </footer>
    </QxTouchScreen>
  )
}
