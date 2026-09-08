import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BellIcon,
  ClockIcon,
  LockIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { QxPageFrame } from '../../../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../../../components/qingxu/QxAppNavbar'
import { useTerminalDeviceStatus } from '../../../../hooks/useTerminalDeviceStatus'
import { getTerminalCode } from '../../../../services/api/terminalConfig'
import '../styles/qx-me-shared.css'

export type QxMeView = 'notifications' | 'resumes' | 'favorites' | 'ai-records' | 'activity' | 'activity-detail'

export type QxMeStatusTone = 'ok' | 'warn' | 'bad' | 'unknown'

function qxStatusFromDevice(device: ReturnType<typeof useTerminalDeviceStatus>): {
  tone: QxMeStatusTone
  label: string
} {
  if (device.loading || device.kind === 'unknown') return { tone: 'unknown', label: '状态未知' }
  if (device.printerReady) return { tone: device.kind === 'low_paper' ? 'warn' : 'ok', label: device.printerLabel }
  if (device.kind === 'offline') return { tone: 'bad', label: device.printerLabel }
  return { tone: 'bad', label: device.printerLabel }
}

const RECORD_VIEWS: { key: Exclude<QxMeView, 'notifications' | 'activity-detail'>; label: string; hint: string; to: string }[] = [
  { key: 'resumes', label: '简历', hint: '诊断与生成', to: '/me/resumes' },
  { key: 'favorites', label: '收藏', hint: '岗位·招聘会·政策', to: '/me/favorites' },
  { key: 'ai-records', label: 'AI记录', hint: '服务元数据', to: '/me/ai-records' },
  { key: 'activity', label: '足迹', hint: '浏览·跳转·进度', to: '/me/activity' },
]

export function QxMePage({
  title,
  view,
  screen,
  screenState,
  eyebrow,
  ask,
  doing,
  truth,
  toast,
  ctabar,
  children,
}: {
  title: string
  view: QxMeView
  screen: 'member-list' | 'activity-detail'
  screenState: string
  eyebrow: string
  ask: ReactNode
  doing: ReactNode
  truth: string
  toast?: { tone: 'ok' | 'bad'; text: string } | null
  ctabar: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  const device = useTerminalDeviceStatus()
  const status = qxStatusFromDevice(device)
  const terminalLabel = getTerminalCode() || '设备未绑定'
  const showViewTabs = view !== 'notifications'

  return (
    <QxPageFrame
      title={title}
      status={status}
      terminalLabel={terminalLabel}
      ctabar={ctabar}
      navbar={
        <QxAppNavbar
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
          current="profile"
        />
      }
    >
      <div
        className="qx-me-page"
        data-kiosk-domain="profile"
        data-kiosk-screen={screen}
        data-state={screenState}
        data-testid={`${view === 'notifications' ? 'notifications' : 'member-records'}-state-${screenState}`}
        aria-live="polite"
      >
        <section className="qx-me-xq">
          <div className="qx-me-xq-row">
            <div className="qx-me-xq-face" aria-hidden="true">青</div>
            <div>
              <div className="qx-me-xq-eyebrow">{eyebrow}</div>
              <p className="qx-me-xq-ask">{ask}</p>
              <p className="qx-me-xq-doing">{doing}</p>
            </div>
          </div>
        </section>

        {showViewTabs ? (
          <nav className="qx-me-viewtabs" aria-label="我的记录分类">
            {RECORD_VIEWS.map((item) => {
              const active = item.key === view || (view === 'activity-detail' && item.key === 'activity')
              return (
                <button
                  key={item.key}
                  type="button"
                  className="qx-me-vtab"
                  data-route={item.to}
                  data-testid={`member-records-view-${item.key}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => navigate(item.to)}
                >
                  {item.label}
                  <span>{item.hint}</span>
                </button>
              )
            })}
          </nav>
        ) : null}

        {toast ? (
          <div className="qx-me-toast" role="status" data-tone={toast.tone} data-testid={view === 'notifications' ? 'notifications-toast' : 'member-records-toast'}>
            {toast.text}
          </div>
        ) : null}

        {children}

        <p className="qx-me-truth"><b>本人可见</b>{truth}</p>
      </div>
    </QxPageFrame>
  )
}

export function QxMeBanner({
  tone,
  title,
  desc,
  minis,
}: {
  tone: 'lock' | 'warn' | 'calm' | 'empty'
  title: string
  desc: ReactNode
  minis?: string[]
}) {
  const Icon = tone === 'lock' ? LockIcon : tone === 'warn' ? TriangleAlertIcon : tone === 'calm' ? ClockIcon : BellIcon
  return (
    <section className="qx-me-banner" data-testid="qx-me-fallback" data-kind={tone}>
      <span className="qx-me-banner-ico" data-tone={tone} aria-hidden="true"><Icon size={34} /></span>
      <span className="qx-me-banner-main">
        <h2 className="qx-me-banner-t">{title}</h2>
        <span className="qx-me-banner-p">{desc}</span>
      </span>
      {minis && minis.length > 0 ? (
        <span className="qx-me-banner-mini">
          {minis.map((item) => <i key={item}>{item}</i>)}
        </span>
      ) : null}
    </section>
  )
}

export function QxMeSummary({
  tone,
  icon,
  label,
  big,
  desc,
  minis,
}: {
  tone?: 'plum' | 'clay' | 'slate'
  icon: ReactNode
  label: string
  big: ReactNode
  desc: ReactNode
  minis: string[]
}) {
  return (
    <section className="qx-me-summary" aria-label={`${label}概览`}>
      <span className="qx-me-summary-ico" data-tone={tone} aria-hidden="true">{icon}</span>
      <span className="qx-me-summary-main">
        <b>{label}</b>
        <strong>{big}</strong>
        <span>{desc}</span>
      </span>
      <span className="qx-me-summary-mini">
        {minis.map((item) => <i key={item}>{item}</i>)}
      </span>
    </section>
  )
}

export function QxMeGuide({ items }: { items: [string, string, string][] }) {
  return (
    <section className="qx-me-guide" aria-label="说明">
      {items.map(([k, t, p]) => (
        <div className="qx-me-guide-item" key={k}>
          <div className="qx-me-guide-k">{k}</div>
          <div className="qx-me-guide-t">{t}</div>
          <div className="qx-me-guide-p">{p}</div>
        </div>
      ))}
    </section>
  )
}

export function QxMeCta({
  secondaryLabel,
  onSecondary,
  secondaryRoute,
  primary,
}: {
  secondaryLabel: string
  onSecondary: () => void
  secondaryRoute: string
  primary: ReactNode
}) {
  return (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" data-route={secondaryRoute} onClick={onSecondary}>
        {secondaryLabel}
      </button>
      {primary}
    </>
  )
}

export function recordsCtabar(
  uiState: string,
  navigate: ReturnType<typeof useNavigate>,
  retry: () => void,
  loginFrom: string,
  readyLabel: string,
  onReady: () => void,
): ReactNode {
  if (uiState === 'error' || uiState.endsWith('error')) {
    return (
      <>
        <button type="button" className="qx-btn" data-route="/help" onClick={() => navigate('/help')}>联系工作人员</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={retry}>重新加载</button>
      </>
    )
  }
  const primary = uiState === 'login' || uiState.endsWith('login')
    ? <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => navigate('/login', { state: { from: loginFrom } })}>手机号登录</button>
    : uiState === 'loading' || uiState.endsWith('loading')
      ? <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="member-records-primary">记录还未加载完成</span>
      : <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={onReady}>{readyLabel}</button>
  return (
    <QxMeCta
      secondaryLabel="返回我的"
      secondaryRoute="/profile"
      onSecondary={() => navigate('/profile')}
      primary={primary}
    />
  )
}

export const QX_ME_GUIDE = {
  login: [
    ['隐私', '只对本人可见', '退出或超时后，本机不保留任何明细'],
    ['登录方式', '手机号 + 验证码', '也可以在登录页用手机扫码登录'],
    ['边界', '本机不代收简历', '岗位与招聘会只做来源信息入口'],
  ],
  loading: [
    ['读取范围', '只读当前账号', '不会展示其他账号的数据'],
    ['显示规则', '不闪回旧记录', '上一位用户的内容不会残留在屏幕上'],
    ['失败怎么办', '保留重试入口', '读取失败不会改动任何已有数据'],
  ],
  error: [
    ['数据', '已保存内容不受影响', '这次加载失败不会删除任何记录'],
    ['先试这个', '检查网络后重试', '重试不会重复创建记录'],
    ['仍不行', '联系现场工作人员', '可在帮助页找到联系方式'],
  ],
} as const satisfies Record<string, [string, string, string][]>
