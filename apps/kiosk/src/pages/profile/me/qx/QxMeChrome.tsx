import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { QxTouchAsk } from '../../../../components/qingxu/touch/QxTouchDock'
import { whenMiniapp } from '../../../../copy/unattendedCopy'
import { useSupportContact } from '../../../../hooks/useSupportContact'
import { MeSeg } from '../../touch/MeKit'
import { MeTouchShell, type MeBandStatus } from '../../touch/MeTouchShell'
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

type QxMeTab = { key: QxMeView; label: string; to: string }

/* 稿 REC：简历、收藏、AI 记录、足迹四个记录分类。 */
const RECORD_VIEWS: QxMeTab[] = [
  { key: 'resumes', label: '简历', to: '/me/resumes' },
  { key: 'favorites', label: '收藏', to: '/me/favorites' },
  { key: 'ai-records', label: 'AI 记录', to: '/me/ai-records' },
  { key: 'activity', label: '足迹', to: '/me/activity' },
]

/* 稿 ASSET：文档与订单是同一块「本人资产」的两个分域，互相切换，不混进上面四个记录分类。 */
const ASSET_VIEWS: QxMeTab[] = [
  { key: 'documents', label: '文档', to: '/me/documents' },
  { key: 'orders', label: '订单', to: '/me/print-orders' },
]

export function QxMePage({
  title,
  view,
  screen,
  screenState,
  eyebrow,
  sub,
  fine,
  toast,
  ctabar,
  live = true,
  onBack,
  backLabel,
  hideTabs = false,
  overlay,
  children,
}: {
  title: string
  view: QxMeView
  screen: 'member-list' | 'activity-detail' | 'member-settings'
  screenState: string
  eyebrow: string
  /** 意图带副题。不传时按页面给一句稿上的副题。 */
  sub?: string
  /** 列表下面的一行小字（保留期、自动退出时间等）。登录门、读取中、读不到时不画。 */
  fine?: ReactNode
  toast?: { tone: 'ok' | 'bad'; text: string } | null
  ctabar: ReactNode
  /** 整页 aria-live。定时刷新的页（打印订单每 5 秒同步）传 false，否则读屏会反复播报整块列表。 */
  live?: boolean
  onBack?: () => void
  backLabel?: string
  /** 活动详情这类从记录页点进来的页不挂分类分段。 */
  hideTabs?: boolean
  /** 弹层（例如确认保存期限）。盖在这一屏上，底下的内容变成不可点。 */
  overlay?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  // 未登录登录门不读服务电话：这条请求也是 /api/v1/，账号资产页未登录必须是 0 条。
  const contact = useSupportContact(!/(?:^|-)login$/.test(screenState))
  const isAssetView = view === 'documents' || view === 'orders'
  /* 账号设置（稿 30 ?screen=settings）不是记录分类，也不属本人资产分域：不挂分类 Tab。 */
  const isSettingsView = view === 'settings'
  const tabs = isAssetView ? ASSET_VIEWS : hideTabs ? [] : view === 'notifications' || isSettingsView ? [] : RECORD_VIEWS
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
  const status: MeBandStatus | undefined = showPrinter
    ? phase === 'error' ? { tone: 'warn', label: '这次没读到' } : undefined
    : { tone: 'unknown', label: '以你账号里的实际记录为准' }

  return (
    <MeTouchShell
      eyebrow={eyebrow}
      title={bandTitle}
      sub={bandSub}
      showPrinter={showPrinter && phase !== 'error'}
      status={status}
      backLabel={backLabel ?? (view === 'activity-detail' ? '返回记录' : '返回我的')}
      onBack={goBack}
      ask={ME_ASK[view]}
      primaryNode={ctabar}
      overlay={overlay}
    >
      <div
        className={`me-page ${pageClass}`}
        data-kiosk-domain="profile"
        data-kiosk-screen={screen}
        data-state={screenState}
        data-testid={`${testScope}-state-${screenState}`}
        aria-live={live ? 'polite' : undefined}
      >
        {tabs.length > 0 ? (
          <MeSeg
            className="qx-me-viewtabs"
            label={isAssetView ? '我的文档与打印订单' : '我的记录分类'}
            current={view === 'activity-detail' ? 'activity' : view}
            items={tabs.map((item) => ({
              id: item.key,
              label: item.label,
              testId: isAssetView ? `member-assets-tab-${item.key}` : `member-records-view-${item.key}`,
            }))}
            onPick={(id) => navigate(tabs.find((item) => item.key === id)?.to ?? '/profile')}
          />
        ) : null}

        {toast ? (
          <div className="qx-me-toast me-toast" role="status" data-tone={toast.tone} data-testid={`${testScope}-toast`}>
            {toast.text}
          </div>
        ) : null}

        {phase === 'ready' && miniLine ? <p className="me-sync">{miniLine}</p> : null}

        {children}

        {phase === 'ready' && fine ? <p className="me-fine">{fine}</p> : null}
      </div>
    </MeTouchShell>
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
