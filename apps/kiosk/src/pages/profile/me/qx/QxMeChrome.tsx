import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BellIcon,
  ClockIcon,
  LockIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import type { QxTouchAsk } from '../../../../components/qingxu/touch/QxTouchDock'
import { helpNeededLine, whenMiniapp } from '../../../../copy/unattendedCopy'
import { useRecruitmentHosting } from '../../../../hooks/useRecruitmentHosting'
import { useSupportContact } from '../../../../hooks/useSupportContact'
import { MeTouchShell } from '../../touch/MeTouchShell'
import '../styles/qx-me-shared.css'
import '../../touch/me-touch.css'

export type QxMeView =
  | 'notifications'
  | 'resumes'
  | 'favorites'
  | 'ai-records'
  | 'activity'
  | 'activity-detail'
  | 'documents'
  | 'orders'
  | 'settings'

export type QxMeStatusTone = 'ok' | 'warn' | 'bad' | 'unknown'

const ME_ASK: Record<QxMeView, QxTouchAsk> = {
  notifications: { label: '问小青：未读消息在哪里？', draft: '未读消息在哪里？' },
  resumes: { label: '问小青：哪一份还能打开？', draft: '哪一份简历还能打开？' },
  favorites: { label: '问小青：收藏的政策在哪里看？', draft: '收藏的政策在哪里看？' },
  'ai-records': { label: '问小青：打不开的记录怎么办？', draft: '打不开的 AI 记录怎么办？' },
  activity: { label: '问小青：这些记录会发给企业吗？', draft: '这些浏览和跳转记录会发给企业吗？' },
  'activity-detail': { label: '问小青：这些记录会发给企业吗？', draft: '这条记录会发给企业吗？' },
  documents: { label: '问小青：哪一种文件能打？', draft: '哪一种文件能打印？' },
  orders: { label: '问小青：失败的订单怎么办？', draft: '失败的打印订单怎么办？' },
  settings: { label: '问小青：怎么注销账号？', draft: '怎么注销账号？' },
}

type QxMeTab = { key: QxMeView; label: string; hint: string; to: string }

const RECORD_VIEWS: QxMeTab[] = [
  { key: 'resumes', label: '简历', hint: '诊断与生成', to: '/me/resumes' },
  { key: 'favorites', label: '收藏', hint: '岗位·招聘会·政策', to: '/me/favorites' },
  // 稿 39：页签副标题写「名称和状态」，不写「元数据」（v2 规则 4，2026-09-30 A 批）。
  { key: 'ai-records', label: 'AI记录', hint: '名称和状态', to: '/me/ai-records' },
  { key: 'activity', label: '足迹', hint: '浏览·跳转', to: '/me/activity' },
]

/* 稿 38：文档与打印订单是同一块「本人资产」的两个分域，互相切换，不混进上面四个记录分类。 */
const ASSET_VIEWS: QxMeTab[] = [
  { key: 'documents', label: '我的文档', hint: '预览·打印·留存', to: '/me/documents' },
  { key: 'orders', label: '打印订单', hint: '进度·支付·取件', to: '/me/print-orders' },
]

export function QxMePage({
  title,
  view,
  screen,
  screenState,
  eyebrow,
  sub,
  truth,
  toast,
  ctabar,
  live = true,
  ordersHint,
  onBack,
  backLabel,
  children,
}: {
  title: string
  view: QxMeView
  screen: 'member-list' | 'activity-detail' | 'member-settings'
  screenState: string
  eyebrow: string
  /** 意图带副题。不传时按页面给一句稿上的副题。 */
  sub?: string
  ask: ReactNode
  doing: ReactNode
  truth: string
  toast?: { tone: 'ok' | 'bad'; text: string } | null
  ctabar: ReactNode
  /** 整页 aria-live。定时刷新的页（打印订单每 5 秒同步）传 false，否则读屏会反复播报整块列表。 */
  live?: boolean
  /** 打印订单页在已加载订单全部为 0 元时，把「进度·支付·取件」换成不提钱的说法。 */
  ordersHint?: string
  onBack?: () => void
  backLabel?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  // 未登录登录门不读服务电话：这条请求也是 /api/v1/，账号资产页未登录必须是 0 条。
  const contact = useSupportContact(!/(?:^|-)login$/.test(screenState))
  // 招聘内容托管（3.13）关闭时收藏里只有政策：分类提示不再写岗位与招聘会。
  const hostingOpen = useRecruitmentHosting().enabled
  const isAssetView = view === 'documents' || view === 'orders'
  /* 账号设置（稿 30 ?screen=settings）不是记录分类，也不属本人资产分域：不挂分类 Tab。 */
  const isSettingsView = view === 'settings'
  const tabs = isAssetView ? ASSET_VIEWS : view === 'notifications' || isSettingsView ? [] : RECORD_VIEWS
  const testScope = view === 'notifications'
    ? 'notifications'
    : isSettingsView
      ? 'member-settings'
      : isAssetView ? 'member-assets' : 'member-records'
  const pageClass = isAssetView ? 'qx-me-page qx-me-assets' : isSettingsView ? 'qx-me-page qx-me-settings' : 'qx-me-page'
  const showPrinter = view !== 'settings' && view !== 'activity-detail'
  const goBack = onBack ?? (() => navigate(view === 'activity-detail' ? '/me/activity' : '/profile'))
  const phase = /(?:^|-)login$/.test(screenState)
    ? 'login'
    : /(?:^|-)loading$/.test(screenState)
      ? 'loading'
      : /(?:^|-)error$/.test(screenState)
        ? 'error'
        : 'ready'
  const loginWhat: Partial<Record<QxMeView, string>> = {
    notifications: '消息',
    resumes: '简历',
    favorites: '收藏',
    'ai-records': 'AI 服务记录',
    activity: '浏览与跳转记录',
    'activity-detail': '这条记录',
    documents: '文档',
    orders: '打印订单',
  }
  const readySub: Partial<Record<QxMeView, string>> = {
    notifications: '只有你本人能看到',
    resumes: '不显示简历原文',
    favorites: '只收藏政策',
    'ai-records': '列表不显示原文、提示词和输出全文',
    activity: '只记录浏览和打开，不记录你在别的平台办了什么',
    'activity-detail': '只记你在这台机器上看过的',
    documents: '文件名、大小、上传时间和保存期限',
    orders: '进度和到机码',
  }
  const bandTitle = phase === 'login' && loginWhat[view]
    ? `登录后看你的${loginWhat[view]}`
    : phase === 'error'
      ? '这次没读到'
      : phase === 'loading'
        ? '正在读取'
        : title
  const bandSub = phase === 'login'
    ? '只有你本人能看到'
    : phase === 'error'
      ? '可以再试一次'
      : phase === 'loading'
        ? '请稍等'
        : (sub ?? readySub[view])
  const miniLine = view === 'orders'
    ? whenMiniapp(contact, '打印订单在手机小程序里也能看到。')
    : view === 'documents'
      ? whenMiniapp(contact, '这些文档在手机小程序里也能看到。')
      : ''

  return (
    <MeTouchShell
      eyebrow={eyebrow}
      title={bandTitle}
      sub={bandSub}
      showPrinter={showPrinter}
      status={showPrinter ? undefined : { tone: 'unknown', label: '以你账号里的实际记录为准' }}
      backLabel={backLabel ?? (view === 'activity-detail' ? '返回记录' : '返回我的')}
      onBack={goBack}
      ask={ME_ASK[view]}
      primaryNode={ctabar}
    >
      <div
        className={pageClass}
        data-kiosk-domain="profile"
        data-kiosk-screen={screen}
        data-state={screenState}
        data-testid={`${testScope}-state-${screenState}`}
        aria-live={live ? 'polite' : undefined}
      >
        {tabs.length > 0 ? (
          <nav
            className="qx-me-viewtabs"
            data-n={tabs.length}
            aria-label={isAssetView ? '我的文档与打印订单' : '我的记录分类'}
          >
            {tabs.map((item) => {
              const active = item.key === view || (view === 'activity-detail' && item.key === 'activity')
              return (
                <button
                  key={item.key}
                  type="button"
                  className="qx-me-vtab"
                  data-route={item.to}
                  data-testid={isAssetView ? `member-assets-tab-${item.key}` : `member-records-view-${item.key}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => navigate(item.to)}
                >
                  {item.label}
                  <span>{item.key === 'orders' && ordersHint ? ordersHint : item.key === 'favorites' && !hostingOpen ? '政策' : item.hint}</span>
                </button>
              )
            })}
          </nav>
        ) : null}

        {toast ? (
          <div className="qx-me-toast" role="status" data-tone={toast.tone} data-testid={`${testScope}-toast`}>
            {toast.text}
          </div>
        ) : null}

        {children}

        {phase === 'login' ? null : (
          <>
            {miniLine ? <p className="qxt-me-sync">{miniLine}</p> : null}
            <p className="qxt-fine">{helpNeededLine(contact)}</p>
            <p className="qx-me-truth"><b>本人可见</b><span>{truth}</span></p>
          </>
        )}
      </div>
    </MeTouchShell>
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
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={retry}>重新加载</button>
    )
  }
  if (uiState === 'login' || uiState.endsWith('login')) {
    return <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => navigate('/login', { state: { from: loginFrom } })}>去登录</button>
  }
  if (uiState === 'loading' || uiState.endsWith('loading')) {
    return <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="member-records-primary">记录还未加载完成</span>
  }
  return <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={onReady}>{readyLabel}</button>
}

export const QX_ME_GUIDE = {
  login: [
    ['隐私', '只对本人可见', '退出或超时后，本机不保留任何明细'],
    ['登录方式', '手机号 + 验证码', '也可以在登录页用手机扫码登录'],
    ['边界', '本机不代收简历', '岗位与招聘会只做来源信息入口'],
  ],
  loading: [
    ['读取范围', '只读当前账号', '不会展示其他账号的数据'],
    ['显示规则', '先显示「—」', '离开前请点结束使用，否则一段时间无操作后才会自动退出'],
    ['失败怎么办', '保留重试入口', '读取失败不会改动任何已有数据'],
  ],
  error: [
    ['数据', '已保存内容不受影响', '这次加载失败不会删除任何记录'],
    ['先试这个', '检查网络后重试', '重试不会重复创建记录'],
    ['仍不行', '先去办别的', '回到首页继续打印、扫描或查政策'],
  ],
} as const satisfies Record<string, [string, string, string][]>
