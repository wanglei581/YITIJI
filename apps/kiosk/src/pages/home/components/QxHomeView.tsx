import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRightIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  FileTextIcon,
  GraduationCapIcon,
  HistoryIcon,
  HomeIcon,
  LandmarkIcon,
  MicIcon,
  PrinterIcon,
  QrCodeIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react'
import type { RecruitmentHostingState } from '../../../hooks/useRecruitmentHosting'
import type { SmartCampusCapabilityState } from '../../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../../hooks/useTerminalDeviceStatus'
import type { ToolboxCapabilityState } from '../../../hooks/useToolboxConfig'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import { useTerminalKiosk } from '../../../services/api/screensaver'
import type { HomeV6ActionId } from '../homeV6Domains'
import { printDomainStatus } from '../homeDomainStatus'
import type { HomeJobFairHighlightState } from '../hooks/useHomeJobFairHighlight'
import type { HomeJobHighlightState } from '../hooks/useHomeJobHighlight'
import { HomeHeroHeader, type HomeDeviceStatus } from './HomeHeroHeader'
import { HomeTile } from './HomeTile'

const ASSISTANT_VOICE_ENTRY = import.meta.env.VITE_USE_TRTC_CALL === 'true'
const HOME_ASK_DRAFT = '我想办一件事，请告诉我从哪一项开始。'

function idleLogoutMinutes(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_LOGOUT_IDLE_SEC)
  const sec = Number.isFinite(raw) && raw > 0 ? raw : 180
  return Math.max(1, Math.round(sec / 60))
}

function greetingWord(date: Date): string {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function capabilityMark(
  status: string,
  configVersion: string,
  ready: boolean,
): 'loading' | 'on' | 'off' | 'unknown' {
  if (status === 'loading') return 'loading'
  if (status === 'ready' && configVersion) return ready ? 'on' : 'off'
  return 'unknown'
}

interface QxHomeViewProps {
  isLoggedIn: boolean
  displayName: string
  device: TerminalDeviceStatusView
  toolbox: ToolboxCapabilityState
  campus: SmartCampusCapabilityState
  jobFair: HomeJobFairHighlightState & { retry: () => void }
  jobs: HomeJobHighlightState & { retry: () => void }
  /** 招聘内容托管（3.13）。没打开（含还没读到）时不摆岗位 / 招聘会磁贴。 */
  recruitment: RecruitmentHostingState
  officialChannelCount: number
  deviceStatus: HomeDeviceStatus
  continueSlot?: ReactNode
  onAction: (actionId: HomeV6ActionId) => void
  onOpenDevice: () => void
}

function fairCopy(state: QxHomeViewProps['jobFair']): {
  description: string
  badge: string
  statusText?: string
} {
  if (state.status === 'ready') {
    return {
      description: state.fair.name,
      badge: state.fair.status === 'ongoing' ? '正在进行' : '即将开始',
      statusText: state.fair.venue || '地点以来源页面为准',
    }
  }
  if (state.status === 'loading') return { description: '正在读取已发布场次', badge: '读取中' }
  if (state.status === 'error') return { description: '暂时无法获取真实场次', badge: '读取失败' }
  return { description: '暂无进行中或即将开始的场次', badge: '暂无场次' }
}

function jobCopy(state: QxHomeViewProps['jobs']): { description: string; badge: string } {
  if (state.status === 'ready') return { description: '查看来源与更新时间，去来源平台投递', badge: `${state.total} 个在招` }
  if (state.status === 'loading') return { description: '正在读取已发布岗位', badge: '读取中' }
  if (state.status === 'error') return { description: '暂时无法获取岗位数量', badge: '读取失败' }
  return { description: '暂无在招岗位', badge: '暂无岗位' }
}

export function QxHomeNavbar({ onAction }: Pick<QxHomeViewProps, 'onAction'>) {
  return (
    <>
      <Link className="qx-nav-item" aria-current="page" to="/">
        <HomeIcon aria-hidden="true" />
        <span>首页</span>
      </Link>
      <button type="button" className="qx-nav-item" onClick={() => onAction('assistant')}>
        <BotIcon aria-hidden="true" />
        <span>AI 顾问</span>
      </button>
      {/* 直达 /profile：未登录态在「我的」页自己说明，导航上不设登录闸门。 */}
      <button type="button" className="qx-nav-item" data-route="/profile" onClick={() => onAction('profile')}>
        <UserIcon aria-hidden="true" />
        <span>我的</span>
      </button>
    </>
  )
}

export function QxHomeView({
  isLoggedIn,
  displayName,
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
  onOpenDevice,
}: QxHomeViewProps) {
  const kiosk = useTerminalKiosk()
  const [now, setNow] = useState(() => new Date())
  const [introDone, setIntroDone] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  const printStatus = printDomainStatus({
    deviceLoading: device.loading,
    deviceReady: device.printerReady,
    deviceLabel: device.printerLabel,
  })
  const fair = fairCopy(jobFair)
  const job = jobCopy(jobs)
  const toolboxKnown = toolbox.status === 'ready' && Boolean(toolbox.configVersion)
  const campusKnown = campus.status === 'ready' && Boolean(campus.configVersion)
  const toolboxReady = toolboxKnown && toolbox.enabled
  const campusReady = campusKnown && campus.enabled
  const extraCount = (toolboxReady ? 1 : 0) + (campusReady ? 1 : 0)
  const printEyebrow = device.loading ? printStatus.note : device.printerReady ? '进入后核验打印与扫描能力' : device.printerLabel
  const recruitmentOpen = recruitment.enabled
  const channelsTile = !recruitmentOpen && officialChannelCount > 0
  const greeting = greetingWord(now)
  const hello = isLoggedIn && displayName ? `${displayName}，${greeting}` : greeting

  return (
    <div
      className="qx-home qx-scroll"
      data-qx-page="home"
      data-testid="qx-home"
      data-recruitment={recruitmentOpen ? 'open' : 'closed'}
      data-official-channels={channelsTile ? 'shown' : undefined}
      data-toolbox={capabilityMark(toolbox.status, toolbox.configVersion, toolboxReady)}
      data-campus={capabilityMark(campus.status, campus.configVersion, campusReady)}
      data-qx-intro={introDone ? 'done' : undefined}
      onAnimationEnd={(event) => { if (event.animationName === 'qx-home-sheen') setIntroDone(true) }}
    >
      <section className="qx-home-hero" aria-label="小青助手">
        <HomeHeroHeader deviceStatus={deviceStatus} />
        <div className="qx-home-assistant">
          <span className="qx-home-avatar" aria-hidden="true">青</span>
          <div>
            <h2>{hello}，我是<em>小青</em></h2>
            <span>今天想办哪件事？下面选一项，或者直接问我</span>
          </div>
        </div>
        <p className="qx-home-hero-law">AI 生成的内容都会标明，仅供参考 · 本机不替你投递 · 收费以现场公示为准</p>
      </section>

      <section className="qx-home-board" aria-labelledby="qx-home-services-title">
        <button
          type="button"
          className="qx-home-voice"
          data-testid="home-primary"
          onClick={() => {
            rememberAssistantDraft(HOME_ASK_DRAFT)
            onAction('assistant')
          }}
        >
          <span className="qx-home-voice-icon"><MicIcon aria-hidden="true" /></span>
          <span>问小青：说一句你想办的事</span>
          <span className="qx-home-voice-tag">AI 数字人</span>
          <small>{ASSISTANT_VOICE_ENTRY ? '可打字；语音以本机检测为准' : '打字咨询'}</small>
        </button>

        <div className="qx-home-continue" data-testid="home-context-region">
          {continueSlot}
          <div className="qx-home-empty-context" role="status">
            <span className="qx-home-context-icon" aria-hidden="true"><HistoryIcon /></span>
            <span>
              <strong>这台机器上没有待继续的办理</strong>
              <small>从下面选一项重新开始，不会显示上一位使用者的资料</small>
            </span>
          </div>
        </div>

        <header className="qx-home-section-head">
          <div>
            <h2 id="qx-home-services-title">直接办</h2>
            <span>每项最后都会给你一样东西</span>
          </div>
          <div className="qx-home-section-actions">
            <button
              type="button"
              className="qx-home-identity"
              data-testid="home-identity"
              onClick={() => onAction(isLoggedIn ? 'profile' : 'login')}
            >
              <UserIcon aria-hidden="true" />
              <span>{isLoggedIn ? `${displayName || '本人'} · 进入我的` : '登录后查看本人记录'}</span>
            </button>
            <button type="button" className="qx-home-device-link" data-testid="home-device-status" onClick={onOpenDevice}>
              设备状态
            </button>
          </div>
        </header>

        <div className="qx-home-tiles">
          <HomeTile actionId="resume-hub" title="改简历" description="上传或扫描，诊断、优化或生成新简历，改不改你定" foot="带走：新简历" badge="AI 诊断改写" icon={FileTextIcon} onAction={onAction} />
          <HomeTile actionId="interview-hub" title="练面试" description="回答常见问题，可以跳过此题，当场看反馈，不做录用判断" foot="带走：面试反馈" badge="AI 模拟面试" icon={MicIcon} onAction={onAction} />
          <HomeTile
            actionId="print-hub"
            title="打印 · 扫描"
            description="手机扫码、U 盘或扫描原件，先看价格再出纸"
            foot="开始选择材料"
            badge={printEyebrow}
            statusText={device.loading ? undefined : printStatus.note}
            icon={PrinterIcon}
            size="feature"
            panelAttrs={{ 'data-home-device-panel': '', 'data-panel-state': device.loading ? 'loading' : device.kind }}
            onAction={onAction}
          />
          {recruitmentOpen ? (<>
            {jobs.status === 'error' ? (
              <button type="button" className="qx-home-tile" data-action="jobs-retry" data-tone="slate" data-home-jobs-panel="" data-panel-state="error" onClick={jobs.retry}>
                <span className="qx-home-tile-head"><span className="qx-home-tile-icon"><RotateCwIcon aria-hidden="true" /></span><span className="qx-home-tile-badge">{job.badge}</span></span>
                <strong>岗位信息</strong>
                <span className="qx-home-tile-desc">{job.description}</span>
                <span className="qx-home-tile-foot">重新加载 <RotateCwIcon aria-hidden="true" /></span>
              </button>
            ) : (
              <HomeTile actionId="jobs-hub" title="岗位信息" description={job.description} foot="查看岗位" badge={job.badge} icon={BriefcaseBusinessIcon} tone="slate" panelAttrs={{ 'data-home-jobs-panel': '', 'data-panel-state': jobs.status }} onAction={onAction} />
            )}
            {jobFair.status === 'error' ? (
              <button type="button" className="qx-home-tile" data-action="fairs-retry" data-tone="clay" data-home-job-fair-panel="" data-panel-state="error" onClick={jobFair.retry}>
                <span className="qx-home-tile-head"><span className="qx-home-tile-icon"><RotateCwIcon aria-hidden="true" /></span><span className="qx-home-tile-badge">读取失败</span></span>
                <strong>招聘会</strong>
                <span className="qx-home-tile-desc">没有使用缓存或示例数据，请稍后重试。</span>
                <span className="qx-home-tile-foot">重新加载 <RotateCwIcon aria-hidden="true" /></span>
              </button>
            ) : (
              <button type="button" className="qx-home-tile" data-action="fairs-hub" data-tone="clay" data-home-job-fair-panel="" data-panel-state={jobFair.status} onClick={() => onAction('fairs-hub')}>
                <span className="qx-home-tile-head"><span className="qx-home-tile-icon"><CalendarDaysIcon aria-hidden="true" /></span><span className="qx-home-tile-badge">{fair.badge}</span></span>
                <strong>招聘会</strong>
                <span className="qx-home-tile-desc">{fair.description}</span>
                {fair.statusText ? <span className="qx-home-tile-status">{fair.statusText}</span> : null}
                <span className="qx-home-tile-foot">查看招聘会 <ArrowRightIcon aria-hidden="true" /></span>
              </button>
            )}
          </>) : null}
          <HomeTile actionId="policy-hub" title="查政策" description="补贴、社保怎么办，要带哪些材料，以官方发布为准" foot="带走：材料清单" badge="官方发布" icon={LandmarkIcon} tone="slate" onAction={onAction} />
          {channelsTile ? (
            <HomeTile actionId="official-channels" title="机构官方渠道" description={`本机有 ${officialChannelCount} 个渠道，扫码到机构官网`} foot="扫码前往" badge="机构提供" icon={QrCodeIcon} tone="slate" onAction={onAction} />
          ) : null}
          {toolboxReady ? (
            <HomeTile actionId="toolbox" title="百宝箱" description="按本机已上架的扩展服务进入" foot="进入已开通的服务" badge="受控开放" icon={WrenchIcon} tone="neutral" span={extraCount === 1 ? 'full' : undefined} onAction={onAction} />
          ) : null}
          {campusReady ? (
            <HomeTile actionId="smart-campus" title="智慧校园" description="按本机开通范围进入校园服务" foot="进入校园服务" badge="受控开放" icon={GraduationCapIcon} tone="neutral" span={extraCount === 1 ? 'full' : undefined} onAction={onAction} />
          ) : null}
        </div>
      </section>

      <footer className="qx-home-truth">
        <ShieldCheckIcon aria-hidden="true" />
        <div>
          <p><strong>能力状态以真实接口为准。</strong>{recruitmentOpen ? '岗位与招聘会仅展示第三方或官方来源；本终端仅展示与跳转，不代收简历。' : channelsTile ? '岗位与招聘会请看本机构官方渠道，本终端不代收简历。' : recruitment.status === 'ready' ? '本终端未开放岗位与招聘会信息，也不代收简历。' : '本终端不代收简历。'}</p>
          <p className="qx-home-legal">
            {kiosk ? <span>鲁ICP备2026023517号-2</span> : (<a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer noopener">鲁ICP备2026023517号-2</a>)}
            <span aria-hidden="true">·</span>
            {kiosk ? <span>鲁公网安备37021402007308号</span> : (<a href="https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308" target="_blank" rel="noreferrer noopener">鲁公网安备37021402007308号</a>)}
            <span aria-hidden="true">·</span>
            <span>离开 {idleLogoutMinutes()} 分钟自动退出登录</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
