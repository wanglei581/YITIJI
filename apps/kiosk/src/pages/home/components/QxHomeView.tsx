import { useEffect, useState, type ReactNode } from 'react'
import { HomeTile } from './HomeTile'
import { Link } from 'react-router-dom'
import {
  ArrowRightIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  FileTextIcon,
  GraduationCapIcon,
  HomeIcon,
  LandmarkIcon,
  MicIcon,
  PrinterIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react'
import type { SmartCampusCapabilityState } from '../../../hooks/useSmartCampusConfig'
import type { TerminalDeviceStatusView } from '../../../hooks/useTerminalDeviceStatus'
import type { ToolboxCapabilityState } from '../../../hooks/useToolboxConfig'
import type { HomeV6ActionId } from '../homeV6Domains'
import { printDomainStatus } from '../homeDomainStatus'
import type { HomeJobFairHighlightState } from '../hooks/useHomeJobFairHighlight'

interface QxHomeViewProps {
  isLoggedIn: boolean
  displayName: string
  device: TerminalDeviceStatusView
  toolbox: ToolboxCapabilityState
  campus: SmartCampusCapabilityState
  jobFair: HomeJobFairHighlightState & { retry: () => void }
  continueSlot?: ReactNode
  onAction: (actionId: HomeV6ActionId) => void
  onOpenFair: (fairId: string) => void
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

function QxHomeClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <time className="qx-home-clock" dateTime={now.toISOString()}>
      <strong>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}</strong>
      <span>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(now)}</span>
    </time>
  )
}

export function QxHomeNavbar({
  isLoggedIn,
  displayName,
  onAction,
}: Pick<QxHomeViewProps, 'isLoggedIn' | 'displayName' | 'onAction'>) {
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
      <button type="button" className="qx-nav-item" onClick={() => onAction(isLoggedIn ? 'profile' : 'login')}>
        <UserIcon aria-hidden="true" />
        <span>{isLoggedIn ? displayName || '我的' : '我的'}</span>
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
  continueSlot,
  onAction,
  onOpenFair,
}: QxHomeViewProps) {
  const printStatus = printDomainStatus({
    deviceLoading: device.loading,
    deviceReady: device.printerReady,
    deviceLabel: device.printerLabel,
  })
  const fair = fairCopy(jobFair)
  const toolboxKnown = toolbox.status === 'ready' && Boolean(toolbox.configVersion)
  const campusKnown = campus.status === 'ready' && Boolean(campus.configVersion)
  const toolboxReady = toolboxKnown && toolbox.enabled
  const campusReady = campusKnown && campus.enabled

  return (
    <main className="qx-home qx-scroll" data-qx-page="home" data-testid="qx-home">
      <section className="qx-home-hero" aria-label="小青助手">
        <div className="qx-home-assistant">
          <span className="qx-home-avatar" aria-hidden="true">青</span>
          <div>
            <h2>{isLoggedIn && displayName ? `${displayName}，你好，我是小青` : '你好，我是小青'}</h2>
            <span>说一句你想办的事，我带你一步一步办</span>
          </div>
          <QxHomeClock />
        </div>
        <button
          type="button"
          className="qx-home-voice"
          onClick={() => onAction('assistant')}
          data-testid="home-primary"
        >
          <span className="qx-home-voice-icon"><MicIcon aria-hidden="true" /></span>
          <span>点这里说话，比如“帮我打一份简历”</span>
          <small>进入助手</small>
        </button>
        <div className="qx-home-quick" aria-label="常用服务快捷入口">
          <span>也可以直接选：</span>
          <button type="button" onClick={() => onAction('resume-hub')}>改简历</button>
          <button type="button" onClick={() => onAction('jobs-hub')}>找工作</button>
          <button type="button" onClick={() => onAction('policy-hub')}>查政策</button>
          <button type="button" disabled title="全部服务目录尚未迁入运行时路由">更多服务（目录迁移中）</button>
        </div>
        <div className="qx-home-continue" data-testid="home-context-region">
          {continueSlot}
          <button
            type="button"
            className="qx-home-empty-context"
            disabled
            title="全部服务目录尚未迁入运行时路由"
          >
            <span>
              <strong>这台机器上没有待继续的办理</strong>
              <small>全部服务目录迁移中；可直接选择下方真实服务</small>
            </span>
            目录迁移中 <ArrowRightIcon aria-hidden="true" />
          </button>
        </div>
        <p className="qx-home-hero-law">AI 建议仅供参考 · 不替你投递 · 收费以现场公示价为准</p>
      </section>

      <section className="qx-home-board" aria-labelledby="qx-home-services-title">
        <header className="qx-home-section-head">
          <div>
            <h2 id="qx-home-services-title">直接办</h2>
            <span>选择一项真实服务开始</span>
          </div>
          <button type="button" disabled title="全部服务目录尚未迁入运行时路由">
            查看全部服务（目录迁移中）
          </button>
        </header>

        <div className="qx-home-tiles">
          <HomeTile
            actionId="print-hub"
            title="打印 · 扫描"
            description="简历、证明材料与照片，进入后核验打印与扫描能力"
            foot="开始选择材料"
            badge={device.loading ? '状态读取中' : device.printerReady ? '打印机在线' : device.printerLabel}
            statusText={printStatus.note}
            icon={PrinterIcon}
            size="feature"
            /* 设备状态面板标记。判据沿用 V6HomeFooterPanels.tsx:119 的
               `device.loading ? 'loading' : device.kind`，状态语义逐字一致，
               只是青序流光把它挂在打印磁贴上而不是首页底部的独立面板。 */
            panelAttrs={{ 'data-home-device-panel': '', 'data-panel-state': device.loading ? 'loading' : device.kind }}
            onAction={onAction}
          />
          <HomeTile actionId="resume-hub" title="AI 简历" description="诊断、逐条优化、生成新版本" foot="进入简历服务" badge="AI 服务" icon={FileTextIcon} onAction={onAction} />
          <HomeTile actionId="interview-hub" title="模拟面试" description="问答对练，可跳过，不做录用判断" foot="进入面试服务" badge="练习服务" icon={MicIcon} onAction={onAction} />
          <HomeTile actionId="jobs-hub" title="岗位信息" description="查看来源与更新时间，去来源平台投递" foot="查看岗位" badge="第三方来源" icon={BriefcaseBusinessIcon} tone="slate" onAction={onAction} />
          {jobFair.status === 'error' ? (
            <button
              type="button"
              className="qx-home-tile"
              data-action="fairs-retry"
              data-tone="clay"
              data-home-job-fair-panel=""
              data-panel-state="error"
              onClick={jobFair.retry}
            >
              <span className="qx-home-tile-head">
                <span className="qx-home-tile-icon"><RotateCwIcon aria-hidden="true" /></span>
                <span className="qx-home-tile-badge">读取失败</span>
              </span>
              <strong>招聘会</strong>
              <span className="qx-home-tile-desc">没有使用缓存或示例数据，请稍后重试。</span>
              <span className="qx-home-tile-foot">重新加载 <RotateCwIcon aria-hidden="true" /></span>
            </button>
          ) : (
            <button
              type="button"
              className="qx-home-tile"
              data-action="fairs-hub"
              data-tone="clay"
              data-home-job-fair-panel=""
              data-panel-state={jobFair.status}
              onClick={() => jobFair.status === 'ready' ? onOpenFair(jobFair.fair.id) : onAction('fairs-hub')}
            >
              <span className="qx-home-tile-head">
                <span className="qx-home-tile-icon"><CalendarDaysIcon aria-hidden="true" /></span>
                <span className="qx-home-tile-badge">{fair.badge}</span>
              </span>
              <strong>招聘会</strong>
              <span className="qx-home-tile-desc">{fair.description}</span>
              {fair.statusText ? <span className="qx-home-tile-status">{fair.statusText}</span> : null}
              <span className="qx-home-tile-foot">查看招聘会 <ArrowRightIcon aria-hidden="true" /></span>
            </button>
          )}
          <HomeTile actionId="policy-hub" title="就业政策" description="资格与办理条件以官方核验为准" icon={LandmarkIcon} tone="slate" size="slim" onAction={onAction} />
          <HomeTile
            actionId="toolbox"
            title="百宝箱"
            description={toolbox.status === 'loading' ? '正在读取本机上架配置' : !toolboxKnown ? '暂时无法确认本机上架配置' : toolboxReady ? '进入本机已上架的扩展服务' : '本机尚未上架扩展服务'}
            badge={toolbox.status === 'loading' ? '读取中' : !toolboxKnown ? '状态未知' : toolboxReady ? '已上架' : '未开放'}
            icon={WrenchIcon}
            tone="neutral"
            size="slim"
            disabled={!toolboxReady}
            onAction={onAction}
          />
          <HomeTile
            actionId="smart-campus"
            title="智慧校园"
            description={campus.status === 'loading' ? '正在读取终端授权' : !campusKnown ? '暂时无法确认终端授权状态' : campusReady ? '进入本机已授权的校园服务' : '需终端或机构授权后使用'}
            badge={campus.status === 'loading' ? '读取中' : !campusKnown ? '状态未知' : campusReady ? '已授权' : '未开放'}
            icon={GraduationCapIcon}
            tone="neutral"
            size="slim"
            disabled={!campusReady}
            onAction={onAction}
          />
        </div>
      </section>

      <footer className="qx-home-truth">
        <ShieldCheckIcon aria-hidden="true" />
        <div>
          <p><strong>能力状态以真实接口为准。</strong>岗位与招聘会仅展示第三方或官方来源；本终端仅展示与跳转，不代收简历。</p>
          <p className="qx-home-legal">
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer noopener">鲁ICP备2026023517号-2</a>
            <span aria-hidden="true">·</span>
            <a href="https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308" target="_blank" rel="noreferrer noopener">鲁公网安备37021402007308号</a>
          </p>
        </div>
      </footer>
    </main>
  )
}
