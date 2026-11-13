import { LicenseLock } from '../../../layouts/LicenseLock'
import { useKioskLicense } from '../../../layouts/KioskLicenseContext'
import { useSupportContactSnapshot } from '../../../hooks/useSupportContact'
import { pickupEntryMiniappLine } from '../../../copy/miniappLinkCopy'
import { LICENSE_NO_NEW_TASK_REASON, machineUnusableLine } from '../../../copy/unattendedCopy'
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
import type { TerminalDeviceStatusView } from '../../../hooks/useTerminalDeviceStatus'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import { useTerminalKiosk } from '../../../services/api/screensaver'
import { unitCentsFor, usePrintPriceConfig } from '../../../services/print/priceConfigApi'
import { printDomainStatus } from '../homeDomainStatus'
import type { HomeV6ActionId } from '../homeV6Domains'
import type { HomeJobFairHighlightState } from '../hooks/useHomeJobFairHighlight'
import type { HomeJobHighlightState } from '../hooks/useHomeJobHighlight'
import { campusCopy, greetingWord, jobCopy } from '../homeTouchCopy'
import '../styles/home-touch.css'
import { HomeIdentityActions } from './HomeIdentityActions'

const RETRY_CUE = '点这里重新读取'

const ASSISTANT_VOICE_ENTRY = import.meta.env.VITE_USE_TRTC_CALL === 'true'
// 带去顾问页的预填问句：照首页四张大卡的名字问（改简历 / 练面试 / 打印 · 扫描 / 查政策），
// 小青才知道要在这四项里帮着挑；只填进输入框，用户自己按发送才会发出。
const HOME_ASK_DRAFT = '我想改简历、练面试、打印扫描或查政策，请帮我看看先从哪一项开始。'

export interface HomeTouchDeviceStatus {
  tone: 'ok' | 'warn' | 'bad' | 'unknown'
  label: string
}

interface HomeTouchViewProps {
  isLoggedIn: boolean
  guestMode: boolean
  device: TerminalDeviceStatusView
  jobFair: HomeJobFairHighlightState & { retry: () => void }
  jobs: HomeJobHighlightState & { retry: () => void }
  recruitment: RecruitmentHostingState
  officialChannelCount: number
  /** 页眉品牌名下的小字（placeLabel 算好的）：本机绑定的机构名，或中性说法；读取中为空串。 */
  place: string
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
  jobFair,
  jobs,
  recruitment,
  officialChannelCount,
  place,
  deviceStatus,
  continueSlot,
  onAction,
  onHome,
  onOpenDevice,
  onEndPrevious,
}: HomeTouchViewProps) {
  const { mode } = useKioskLicense()
  const contact = useSupportContactSnapshot()
  const winding = mode === 'winding-down'
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
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduced.matches) {
      setIntroDone(true)
      return
    }
    const pendingRises = () => node.getAnimations({ subtree: true }).filter((anim) => (
      anim instanceof CSSAnimation && anim.animationName === 'qxt-rise' && anim.playState !== 'finished'
    ))
    const finish = () => setIntroDone(true)
    const onEnd = (event: AnimationEvent) => {
      if (event.animationName !== 'qxt-rise') return
      if (pendingRises().length === 0) finish()
    }
    const onReduce = () => {
      if (reduced.matches) finish()
    }
    node.addEventListener('animationend', onEnd)
    reduced.addEventListener('change', onReduce)
    // 动效开着时，超时只作收尾，不在首帧空列表上提前盖章。
    const timer = window.setTimeout(finish, 1600)
    return () => {
      node.removeEventListener('animationend', onEnd)
      reduced.removeEventListener('change', onReduce)
      window.clearTimeout(timer)
    }
  }, [])

  // 读状态的请求本身没回来（服务断了、超时）：和「打印机离线」不是一回事，磁贴上单独写（10/29 本机走查 I-31）。
  const serviceDown = !device.loading && device.requestFailed === true
  const printStatus = printDomainStatus({
    deviceLoading: device.loading,
    deviceReady: device.printerReady,
    deviceLabel: device.printerLabel,
    deviceNotice: device.printerNotice,
    serviceDown,
  })
  const job = jobCopy(jobs)
  const fair = campusCopy(jobFair)
  const recruitmentOpen = recruitment.enabled
  // 2026-11-08 四核心收口：本机构官方渠道从首页磁贴挪进「查政策」页，首页只在底部说明里指过去。
  const channelsInPolicy = !recruitmentOpen && officialChannelCount > 0
  const greeting = greetingWord(now)
  const standbyNote = homeStandbyNote({ isLoggedIn, guestMode, hasSensitiveSession: hasKioskSensitiveSession() }, publicIdleLogoutLabel())
  const printChip = device.loading ? printStatus.note : device.printerReady ? '先选材料再出纸 · 带走：打印件' : serviceDown ? '服务暂时连不上' : device.printerLabel
  const printNote = device.loading || device.printerReady ? undefined : printStatus.note
  // 百宝箱、智慧校园停放（2026-11-04 产品负责人定）、官方渠道挪进查政策（11/08），都不再计入：小磁贴只剩到机取件、帮助和招聘类。
  const tileCount = 2 + (recruitmentOpen ? 2 : 0)
  const dense = tileCount >= 4
  const boundary = recruitmentOpen
    ? '岗位与招聘会仅展示第三方或官方来源；本终端仅展示与跳转，不代收简历。'
    : channelsInPolicy
      ? '岗位与招聘会请看「查政策」里的本机构官方渠道，本终端不代收简历。'
      : recruitment.status === 'ready'
        ? '本终端未开放岗位与招聘会信息，也不代收简历。'
        : '本终端不代收简历。'

  let tileIndex = 5
  const nextTile = () => tileIndex++

  return (
    <QxTouchScreen
      rootRef={rootRef}
      testId="qx-home"
      page="home"
      intro={introDone ? 'done' : undefined}
      bodyClassName={['qxt-home', isLoggedIn ? 'qxt-home-on' : '', dense ? 'qxt-home-squeeze' : ''].filter(Boolean).join(' ')}
      dataAttrs={{
        recruitment: recruitmentOpen ? 'open' : 'closed',
        // 停放标记给门禁和用例认：首页任何配置下都不摆这两块。
        toolbox: 'parked',
        campus: 'parked',
      }}
      band={(
        <>
          <QxTouchBand
            kind="hero"
            live
            back={false}
            dense={dense}
            place={place}
            eyebrow={greeting}
            title="我是小青"
            sub="今天想办哪件事？下面选一项，或者直接问我"
            status={{ text: deviceStatus.label, tone: deviceStatus.tone }}
          />
          <LicenseLock>
          <QxTouchAskBar
            testId="home-primary"
            voice={ASSISTANT_VOICE_ENTRY}
            prompt={ASSISTANT_VOICE_ENTRY ? '问小青：说一句你想办的事' : '问小青：打一句你想办的事'}
            hint={ASSISTANT_VOICE_ENTRY ? '可打字；语音以本机检测为准' : undefined}
            mark="AI 数字人"
            onClick={() => {
              rememberAssistantDraft(HOME_ASK_DRAFT)
              onAction('assistant')
            }}
          />
          </LicenseLock>
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
      {winding ? <p className="qxt-remind" role="status">{machineUnusableLine(contact)}</p> : null}
      <div className="qxt-home-go" data-testid="home-context-region">{continueSlot}</div>
      <div className="qxt-home-tasks">
        <QxTouchTask held={winding} note={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} actionId="resume-hub" icon="file" title="改简历" desc="上传或扫描，诊断、优化或生成新简历，改不改你定" chip="AI 诊断改写" chipAi take="带走：新简历" takeIcon="check" visual={<QxTouchArtResume />} index={1} onClick={() => onAction('resume-hub')} />
        <QxTouchTask held={winding} note={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} actionId="interview-hub" icon="mic" title="练面试" desc="回答常见问题，当场看反馈，不做录用判断" chip="AI 模拟面试" chipAi take="带走：面试反馈" takeIcon="check" visual={<QxTouchArtReport />} index={2} onClick={() => onAction('interview-hub')} />
        <QxTouchTask
          held={winding}
          actionId="print-hub"
          icon="printer"
          title="打印 · 扫描"
          desc="手机扫码传文件、插 U 盘，或扫描原件"
          chip={printChip}
          chipTone={device.printerReady && !device.loading ? 'ghost' : 'clay'}
          note={winding ? LICENSE_NO_NEW_TASK_REASON : printNote}
          take="开始选择材料"
          takeIcon="check"
          dark
          visual={<QxTouchArtStack />}
          index={3}
          dataAttrs={{ 'home-device-panel': '', 'panel-state': device.loading ? 'loading' : serviceDown ? 'unreachable' : device.kind }}
          onClick={() => onAction('print-hub')}
        />
        <QxTouchTask held={winding} note={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} actionId="policy-hub" icon="landmark" title="查政策" desc="补贴、社保怎么办，要带哪些材料，以官方发布为准" chip="官方发布" chipTone="slate" take="查看政策说明" takeIcon="check" visual={<QxTouchArtChecklist />} index={4} onClick={() => onAction('policy-hub')} />
      </div>
      <div className="qxt-home-tiles" data-count={tileCount}>
        <QxTouchTile off={winding} reason={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} chevron={false} layout="stack" icon="ticket" title="到机取件" desc={pickupEntryMiniappLine(contact) || '手机上下了单，来这里取'} actionId="pickup-claim" index={nextTile()} onClick={() => onAction('pickup-claim')} />
        {recruitmentOpen ? (
          jobs.status === 'error' ? (
            <QxTouchTile off={winding} reason={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} key={`jobs-${jobs.status}`} chevron={false} layout="stack" icon="refresh" tone="slate" title="社会招聘" desc={job.description} badge={job.badge} cue={RETRY_CUE} label={`社会招聘，${RETRY_CUE}`} actionId="jobs-retry" dataAttrs={{ 'home-jobs-panel': '', 'panel-state': 'error', 'jobs-badge': job.badge }} index={nextTile()} onClick={jobs.retry} />
          ) : (
            <QxTouchTile off={winding} reason={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} key={`jobs-${jobs.status}`} chevron={false} layout="stack" icon="clipboard" tone="slate" title="社会招聘" desc={job.description} badge={job.badge} actionId="jobs-hub" dataAttrs={{ 'home-jobs-panel': '', 'panel-state': jobs.status, 'jobs-badge': job.badge }} index={nextTile()} onClick={() => onAction('jobs-hub')} />
          )
        ) : null}
        {recruitmentOpen ? (
          jobFair.status === 'error' ? (
            <QxTouchTile off={winding} reason={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} key={`fair-${jobFair.status}`} chevron={false} layout="stack" icon="refresh" tone="slate" title="校园招聘" desc={fair.description} badge={fair.badge} cue={RETRY_CUE} label={`校园招聘，${RETRY_CUE}`} actionId="fairs-retry" dataAttrs={{ 'home-job-fair-panel': '', 'panel-state': 'error' }} index={nextTile()} onClick={jobFair.retry} />
          ) : (
            <QxTouchTile off={winding} reason={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} key={`fair-${jobFair.status}`} chevron={false} layout="stack" icon="book" tone="slate" title="校园招聘" desc={fair.description} badge={fair.badge} actionId="campus-zone" dataAttrs={{ 'home-job-fair-panel': '', 'panel-state': jobFair.status }} index={nextTile()} onClick={() => onAction('campus-zone')} />
          )
        ) : null}
        <QxTouchTile off={winding} reason={winding ? LICENSE_NO_NEW_TASK_REASON : undefined} chevron={false} layout="stack" icon="help" tone="clay" title="帮助" desc="常见问题、服务电话" actionId="help" index={nextTile()} onClick={() => onAction('help')} />
      </div>
      <div className="qxt-home-id" data-member={isLoggedIn ? 'true' : undefined}>
        <p className="qxt-home-id-note">{isLoggedIn ? standbyNote : <>这台机器上没有待继续的办理 · {standbyNote}</>}</p>
        <HomeIdentityActions isLoggedIn={isLoggedIn} onLogin={() => onAction('login')} onEndPrevious={onEndPrevious} />
        <button type="button" className="qxt-home-mini" data-testid="home-device-status" aria-label={`设备状态：${deviceStatus.label}`} onClick={onOpenDevice}>设备状态</button>
      </div>
      <footer className="qxt-home-foot">
        <p>
          <span data-testid="home-recruitment-boundary">{boundary}</span>
          {' · 本机不替你投递 · AI 生成的内容都会标明，仅供参考'}
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
