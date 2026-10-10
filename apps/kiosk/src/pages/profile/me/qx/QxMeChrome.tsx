import { createContext, useContext, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRightIcon,
  BellIcon,
  ChevronLeftIcon,
  ClockIcon,
  LockIcon,
  LogInIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { QxPageFrame } from '../../../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../../../components/qingxu/QxAppNavbar'
import { useRecruitmentHosting } from '../../../../hooks/useRecruitmentHosting'
import { rememberAssistantDraft } from '../../../../services/assistantDraft'
import { getTerminalCode } from '../../../../services/api/terminalConfig'
import '../styles/qx-me-shared.css'

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

type QxMeTab = { key: QxMeView; label: string; hint: string; to: string }

/** 顶栏胶囊写页名。机器状态仍在首页和机器状态页，不在这几页重复。 */
const QX_ME_CAPSULE: Record<QxMeView, string> = {
  notifications: '消息通知',
  documents: '我的文档',
  orders: '我的打印订单',
  resumes: '我的简历',
  favorites: '我的收藏',
  'ai-records': 'AI服务记录',
  activity: '浏览与跳转记录',
  'activity-detail': '记录详情',
  settings: '账号设置',
}

/** 稿 38「带走」六格。文档 / 订单两个视图用这组。 */
const QX_ME_TAKE_ASSETS: readonly (readonly [string, string])[] = [
  ['带走', '同一份文件接着预览或打印'],
  ['订单', '看到进行到哪一步'],
  ['只给你', '文件名只在登录后出现'],
  ['留存', '要长期留下，请自己打印'],
  ['价格', '以现场公示为准'],
  ['问小青', '不知道下一步可以问怎么打'],
]

const QX_ME_ASK = {
  notifications: { label: '问小青', draft: '收到这条通知，接下来我该怎么做？' },
  assets: { label: '问小青：怎么打', draft: '我的文档怎么打印？打印前要注意什么？' },
  records: { label: '问小青', draft: '这里的记录能存多久？删掉会怎样？' },
} as const

/** 39 有内容的状态只有两个键；未登录、加载、空、失败（含 not-found）才加问小青。 */
const QX_ME_SPARSE = /(?:^|-)(?:login|loading|empty|error|not-found)(?:$|-)/

type QxMeAsk = { label: string; draft: string }

function takeFor(view: QxMeView): readonly (readonly [string, string])[] | null {
  if (view === 'documents' || view === 'orders') return QX_ME_TAKE_ASSETS
  // 稿 39 的四个记录页签及详情头图均不放六格。
  return null
}

function askFor(view: QxMeView, screenState: string): QxMeAsk | null {
  if (view === 'notifications') return QX_ME_ASK.notifications
  if (view === 'documents' || view === 'orders') return QX_ME_ASK.assets
  if (view === 'resumes' || view === 'favorites' || view === 'ai-records' || view === 'activity' || view === 'activity-detail') {
    return QX_ME_SPARSE.test(screenState) ? QX_ME_ASK.records : null
  }
  return null
}

const QxMeChromeContext = createContext<{ view: QxMeView; screenState: string } | null>(null)

function useMeAsk(): QxMeAsk | null {
  const ctx = useContext(QxMeChromeContext)
  return ctx ? askFor(ctx.view, ctx.screenState) : null
}

const RECORD_VIEWS: QxMeTab[] = [
  { key: 'resumes', label: '简历', hint: '诊断与生成', to: '/me/resumes' },
  { key: 'favorites', label: '收藏', hint: '岗位·招聘会·政策', to: '/me/favorites' },
  // 稿 39：页签副标题写「名称和状态」，不写「元数据」（v2 规则 4，2026-09-30 A 批）。
  { key: 'ai-records', label: 'AI记录', hint: '名称和状态', to: '/me/ai-records' },
  { key: 'activity', label: '足迹', hint: '浏览·跳转·进度', to: '/me/activity' },
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
  ask,
  doing,
  truth,
  toast,
  ctabar,
  live = true,
  ordersHint,
  children,
}: {
  title: string
  view: QxMeView
  screen: 'member-list' | 'activity-detail' | 'member-settings'
  screenState: string
  eyebrow: string
  ask: ReactNode
  doing: ReactNode
  truth: string
  toast?: { tone: 'ok' | 'bad'; text: string } | null
  ctabar: ReactNode
  /** 整页 aria-live。定时刷新的页（打印订单每 5 秒同步）传 false，否则读屏会反复播报整块列表。 */
  live?: boolean
  /** 打印订单页在已加载订单全部为 0 元时，把「进度·支付·取件」换成不提钱的说法。 */
  ordersHint?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  // 招聘内容托管（3.13）关闭时收藏里只有政策：分类提示不再写岗位与招聘会。
  const hostingOpen = useRecruitmentHosting().enabled
  const terminalLabel = getTerminalCode() || '设备未绑定'
  const isAssetView = view === 'documents' || view === 'orders'
  /* 账号设置（稿 30 ?screen=settings）不是记录分类，也不属本人资产分域：不挂分类 Tab。 */
  const isSettingsView = view === 'settings'
  const tabs = isAssetView ? ASSET_VIEWS : view === 'notifications' || isSettingsView ? [] : RECORD_VIEWS
  const take = takeFor(view)
  const testScope = view === 'notifications'
    ? 'notifications'
    : isSettingsView
      ? 'member-settings'
      : isAssetView ? 'member-assets' : 'member-records'
  const pageClass = isAssetView ? 'qx-me-page qx-me-assets' : isSettingsView ? 'qx-me-page qx-me-settings' : 'qx-me-page'
  const back = view === 'activity-detail'
    ? { label: '返回足迹', onBack: () => navigate('/me/activity') }
    : { label: '返回我的', onBack: () => navigate('/profile') }

  return (
    <QxMeChromeContext.Provider value={{ view, screenState }}>
    <QxPageFrame
      title={title}
      back={back}
      status={{ tone: 'unknown', label: QX_ME_CAPSULE[view] }}
      terminalLabel={terminalLabel}
      ctabar={<QxMeCtaStack truth={truth}>{ctabar}</QxMeCtaStack>}
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
        className={pageClass}
        data-kiosk-domain="profile"
        data-kiosk-screen={screen}
        data-state={screenState}
        data-testid={`${testScope}-state-${screenState}`}
        aria-live={live ? 'polite' : undefined}
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
          {take ? (
            <ol className="qx-me-take" data-testid="qx-me-take">
              {take.map(([label, body]) => <li key={label}><b>{label}</b>{body}</li>)}
            </ol>
          ) : null}
        </section>

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
      </div>
    </QxPageFrame>
    </QxMeChromeContext.Provider>
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

export function QxMeAskButton({ label, draft }: QxMeAsk) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="qx-btn"
      data-testid="qx-me-ask"
      data-route="/assistant"
      onClick={() => {
        rememberAssistantDraft(draft)
        navigate('/assistant')
      }}
    >
      <SparklesIcon size={24} aria-hidden />
      {label}
    </button>
  )
}

/** 操作条两行：上面整行按钮，下面通栏「本人可见」。不改子元素。 */
function QxMeCtaStack({ truth, children }: { truth: string; children: ReactNode }) {
  return (
    <div className="qx-me-cta-stack">
      <div className="qx-me-cta-row">{children}</div>
      <p className="qx-me-truth"><b>本人可见</b><span>{truth}</span></p>
    </div>
  )
}

/** 按当前页和状态放「问小青」。没有该问的状态渲染为空。 */
export function QxMeAskSlot() {
  const ask = useMeAsk()
  return ask ? <QxMeAskButton {...ask} /> : null
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
  const ask = useMeAsk()
  return (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" data-route={secondaryRoute} onClick={onSecondary}>
        <ChevronLeftIcon size={24} aria-hidden />
        {secondaryLabel}
      </button>
      {ask ? <QxMeAskButton {...ask} /> : null}
      {primary}
    </>
  )
}

function QxMeBackToProfile({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="ghost" data-route="/profile" onClick={onClick}>
      <ChevronLeftIcon size={24} aria-hidden />
      返回我的
    </button>
  )
}

/** 记录类底栏。每个状态的键和图标写在分支里，渲染时才读问小青（此时已在壳的 Provider 下）。 */
function QxMeRecordsCta({
  uiState,
  navigate,
  retry,
  loginFrom,
  readyLabel,
  onReady,
}: {
  uiState: string
  navigate: ReturnType<typeof useNavigate>
  retry: () => void
  loginFrom: string
  readyLabel: string
  onReady: () => void
}) {
  const ask = useMeAsk()
  const askButton = ask ? <QxMeAskButton {...ask} /> : null
  if (uiState === 'error' || uiState.endsWith('error')) {
    return (
      <>
        <button type="button" className="qx-btn" data-route="/help" onClick={() => navigate('/help')}>帮助中心</button>
        {askButton}
        <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={retry}>
          <RefreshCwIcon size={24} aria-hidden />
          重新加载
        </button>
      </>
    )
  }
  if (uiState === 'login' || uiState.endsWith('login')) {
    return (
      <>
        <QxMeBackToProfile onClick={() => navigate('/profile')} />
        {askButton}
        <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => navigate('/login', { state: { from: loginFrom } })}>
          <LogInIcon size={24} aria-hidden />
          手机号登录
        </button>
      </>
    )
  }
  if (uiState === 'loading' || uiState.endsWith('loading')) {
    return (
      <>
        <QxMeBackToProfile onClick={() => navigate('/profile')} />
        {askButton}
        <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="member-records-primary">
          <ClockIcon size={24} aria-hidden />
          记录还未加载完成
        </span>
      </>
    )
  }
  return (
    <>
      <QxMeBackToProfile onClick={() => navigate('/profile')} />
      {askButton}
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={onReady}>
        <ArrowRightIcon size={24} aria-hidden />
        {readyLabel}
      </button>
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
  return (
    <QxMeRecordsCta
      uiState={uiState}
      navigate={navigate}
      retry={retry}
      loginFrom={loginFrom}
      readyLabel={readyLabel}
      onReady={onReady}
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
    ['显示规则', '先显示「—」', '离开前请点结束使用，否则一段时间无操作后才会自动退出'],
    ['失败怎么办', '保留重试入口', '读取失败不会改动任何已有数据'],
  ],
} as const satisfies Record<string, [string, string, string][]>
