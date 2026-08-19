import type { ReactNode } from 'react'
import {
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  FileTextIcon,
  GraduationCapIcon,
  LandmarkIcon,
  MicIcon,
  PrinterIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react'
import { HOME_V6_DOMAINS, type HomeV6ActionId, type HomeV6Domain } from '../homeV6Domains'
import { printDomainStatus } from '../homeDomainStatus'

const ICONS: Record<HomeV6Domain['icon'], LucideIcon> = {
  printer: PrinterIcon,
  resume: FileTextIcon,
  briefcase: BriefcaseBusinessIcon,
  calendar: CalendarDaysIcon,
  mic: MicIcon,
  policy: LandmarkIcon,
  toolbox: WrenchIcon,
  campus: GraduationCapIcon,
}

interface V6HomeViewProps {
  isLoggedIn: boolean
  displayName: string
  deviceLabel: string
  deviceReady: boolean
  deviceLoading: boolean
  toolboxEnabled: boolean
  campusEnabled: boolean
  continueSlot?: ReactNode
  footerSlot?: ReactNode
  onAction: (actionId: HomeV6ActionId) => void
}

function DomainCard({
  domain,
  disabled,
  disabledReason,
  statusNote,
  unavailableQuickActions,
  onAction,
}: {
  domain: HomeV6Domain
  disabled: boolean
  disabledReason?: string
  /** 卡面如实说明（与 disabledReason 互斥）与确实做不了的叶子动作，见 ../homeDomainStatus。 */
  statusNote?: string
  unavailableQuickActions?: ReadonlySet<HomeV6ActionId>
  onAction: (actionId: HomeV6ActionId) => void
}) {
  const Icon = ICONS[domain.icon]
  return (
    <article
      className={`v6-home-domain v6-home-domain--${domain.size} v6-home-domain--${domain.accent}${disabled ? ' is-disabled' : ''}`}
      data-domain-id={domain.id}
    >
      <button
        type="button"
        className="v6-home-domain__main"
        onClick={() => onAction(domain.actionId)}
        disabled={disabled}
        aria-describedby={disabledReason ? `v6-domain-reason-${domain.id}` : undefined}
      >
        <span className="v6-home-domain__icon">
          <Icon aria-hidden="true" />
        </span>
        <span className="v6-home-domain__copy">
          <strong>{domain.title}</strong>
          <span>{domain.description}</span>
        </span>
        <ArrowRightIcon className="v6-home-domain__arrow" aria-hidden="true" />
      </button>

      {domain.quickActions && !disabled ? (
        <div className="v6-home-domain__quick" aria-label={`${domain.title}快捷入口`}>
          {/* 叶子级门控理由见 ../homeDomainStatus。 */}
          {domain.quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={unavailableQuickActions?.has(action.id) ?? false}
              onClick={() => onAction(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      {disabledReason || statusNote ? (
        <p id={`v6-domain-reason-${domain.id}`} className="v6-home-domain__reason" role="status">
          {disabledReason ?? statusNote}
        </p>
      ) : null}
      <span className="v6-home-domain__sheen" aria-hidden="true" />
    </article>
  )
}

export function V6HomeView({
  isLoggedIn,
  displayName,
  deviceLabel,
  deviceReady,
  deviceLoading,
  toolboxEnabled,
  campusEnabled,
  continueSlot,
  footerSlot,
  onAction,
}: V6HomeViewProps) {
  const printStatus = printDomainStatus({ deviceLoading, deviceReady, deviceLabel })

  return (
    <div className="v6-home" data-v6-page="home">
      <section className="v6-home-hero" aria-labelledby="v6-home-title">
        <div className="v6-home-hero__field" aria-hidden="true" />
        <div className="v6-home-hero__copy">
          <span className="v6-home-kicker">今天想办什么</span>
          <h1 id="v6-home-title">
            说出你的处境，<em>顺序我来排</em>
          </h1>
          <p>一句话就够。先盘点材料，再排办理顺序，每一步都由你确认后继续。</p>
        </div>
        <div className="v6-home-advisor" aria-hidden="true">
          <span className="v6-home-orbit v6-home-orbit--one">
            <PrinterIcon />
          </span>
          <span className="v6-home-orbit v6-home-orbit--two">
            <BriefcaseBusinessIcon />
          </span>
          <span className="v6-home-orbit v6-home-orbit--three">
            <GraduationCapIcon />
          </span>
          <img src="/assets/ai-advisor.png" alt="" />
        </div>
      </section>

      <section className="v6-home-command" aria-label="AI 顾问入口">
        <button
          type="button"
          className="v6-home-command__prompt"
          onClick={() => onAction('assistant')}
        >
          <SparklesIcon aria-hidden="true" />
          <span>告诉小青你要办什么，例如：准备招聘会材料并打印</span>
          <MicIcon aria-hidden="true" />
        </button>
        <button
          type="button"
          className="v6-home-command__cta"
          onClick={() => onAction('assistant')}
        >
          排出办理顺序 <ArrowRightIcon aria-hidden="true" />
        </button>
      </section>

      <div className="v6-home-scenes" aria-label="常用需求">
        <button type="button" onClick={() => onAction('assistant-jobfair')}>
          周三招聘会，简历还没改
        </button>
        <button type="button" onClick={() => onAction('print-phone')}>
          打印手机里的文件
        </button>
        <button type="button" onClick={() => onAction('assistant')}>
          我不知道从哪开始
        </button>
      </div>

      <section className="v6-home-status" aria-label="本机服务状态" aria-live="polite">
        <span
          className={`v6-home-status__dot${deviceReady ? ' is-ready' : ''}`}
          aria-hidden="true"
        />
        <div>
          <strong>{deviceLoading ? '正在确认本机服务' : deviceLabel}</strong>
          <span>
            {deviceReady ? '可进入打印扫描，纸张与参数在提交前再次确认' : '其余信息服务仍可使用'}
          </span>
        </div>
        <button type="button" onClick={() => onAction(isLoggedIn ? 'profile' : 'login')}>
          <UserIcon aria-hidden="true" />
          {isLoggedIn ? `${displayName} · 进入我的` : '登录后查看本人记录'}
        </button>
      </section>

      {continueSlot}

      <section className="v6-home-services" aria-labelledby="v6-home-services-title">
        <div className="v6-home-services__head">
          <div>
            <span>八个正式服务域</span>
            <h2 id="v6-home-services-title">选一件事，直接开始</h2>
          </div>
          {/* 原文「绿色入口可办理」办不到：打印机离线时打印域照样是绿的。 */}
          <p>可进入查看；受限或锁定的会在卡片上说明原因。</p>
        </div>
        <div className="v6-home-services__primary">
          {HOME_V6_DOMAINS.filter((domain) => domain.size === 'large').map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              disabled={false}
              statusNote={domain.id === 'print' ? printStatus.note : undefined}
              unavailableQuickActions={domain.id === 'print' ? printStatus.unavailableActions : undefined}
              onAction={onAction}
            />
          ))}
        </div>
        <div className="v6-home-services__secondary">
          {HOME_V6_DOMAINS.filter((domain) => domain.size === 'small').map((domain) => {
            const disabled =
              domain.id === 'toolbox'
                ? !toolboxEnabled
                : domain.id === 'campus'
                  ? !campusEnabled
                  : false
            const disabledReason = disabled
              ? domain.id === 'campus'
                ? '本机默认关闭，学校接入并完成配置后开放'
                : '本机尚未上架扩展服务'
              : undefined
            return (
              <DomainCard
                key={domain.id}
                domain={domain}
                disabled={disabled}
                disabledReason={disabledReason}
                onAction={onAction}
              />
            )
          })}
        </div>
      </section>

      {footerSlot}

      <footer className="v6-home-boundary">
        <ShieldCheckIcon aria-hidden="true" />
        <p>
          岗位与招聘会信息来自第三方或官方来源。本终端仅展示与跳转，不代收简历；投递、预约请到来源平台办理。
        </p>
      </footer>
    </div>
  )
}
