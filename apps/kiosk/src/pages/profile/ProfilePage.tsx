import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { BellIcon, ClockIcon, HelpCircleIcon, MessageSquareIcon, SettingsIcon, ShieldIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { whenMiniapp } from '../../copy/unattendedCopy'
import { useSupportContact } from '../../hooks/useSupportContact'
import { MeErrorPack, MeProfileGuest, MeProfileLoading } from './touch/MeStatePacks'
import { MeTouchShell } from './touch/MeTouchShell'
import { accountPhoneDisplay } from '../auth/accountUserMessage'
import { maskPhone, maskEmail } from '../../utils/maskPii'
import { getPendingTasks, type PendingTask } from '../../services/api/pendingTasks'
import { useMemberAssetCounts } from './assets/useMemberAssetCounts'
import { ProfileAssetGrid } from './components/ProfileAssetGrid'
import { ProfileContinueCard } from './components/ProfileContinueCard'
import { ProfileHeader } from './components/ProfileHeader'
import { ProfileSessionRecords } from './components/ProfileSessionRecords'
import type { AIRecord, IncomingState, ResumeItem, ScanItem } from './profileTypes'
import './styles/profile-qx.css'

type ProfileUiState = 'signed-out' | 'loading' | 'error' | 'empty' | 'member' | 'ready' | 'printing'

export function ProfilePage() {
  const { user } = useAuth()
  return <ProfileContent key={user?.id ?? 'guest'} />
}

function ProfileContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isLoggedIn, displayName, getToken } = useAuth()
  const support = useSupportContact()
  const miniappLine = whenMiniapp(support, '和手机小程序是同一个账号：简历、文档、AI 记录、打印订单、消息两边都能看到。')
  const { endKioskUse } = useKioskSessionControl()
  const incoming = (location.state ?? {}) as IncomingState
  const [reloadKey, setReloadKey] = useState(0)
  const assetOverview = useMemberAssetCounts(isLoggedIn, getToken, reloadKey)

  const [resumes, setResumes] = useState<ResumeItem[]>(() =>
    incoming.savedResume
      ? [{ id: `r-${Date.now()}`, ...incoming.savedResume, savedAt: incoming.savedAt ?? new Date().toISOString() }]
      : [],
  )
  const [scans, setScans] = useState<ScanItem[]>(() =>
    incoming.savedFile
      ? [{ id: `s-${Date.now()}`, ...incoming.savedFile, savedAt: incoming.savedAt ?? new Date().toISOString() }]
      : [],
  )
  const [aiRecords, setAiRecords] = useState<AIRecord[]>(() =>
    incoming.savedResumeAdvice
      ? [{
          id: `a-${Date.now()}`,
          label: '优化建议',
          detail: `${incoming.savedResumeAdvice.suggestions.length} 条建议`,
          fileName: incoming.savedResumeAdvice.file?.name ?? '简历',
          createdAt: incoming.savedResumeAdvice.savedAt,
        }]
      : [],
  )
  const [pendingTask, setPendingTask] = useState<PendingTask | null>(null)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState(false)

  useEffect(() => {
    if (!isLoggedIn) {
      setPendingTask(null)
      setTasksLoading(false)
      setTasksError(false)
      return
    }
    const token = getToken()
    if (!token) {
      setPendingTask(null)
      setTasksLoading(false)
      setTasksError(false)
      return
    }
    let alive = true
    setPendingTask(null)
    setTasksLoading(true)
    setTasksError(false)
    getPendingTasks(token)
      .then((tasks) => {
        if (!alive) return
        setPendingTask(tasks[0] ?? null)
      })
      .catch(() => {
        if (!alive) return
        setPendingTask(null)
        setTasksError(true)
      })
      .finally(() => {
        if (alive) setTasksLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isLoggedIn, getToken, reloadKey])

  const headerDisplayName = (user?.nickname?.trim() || displayName || '会员账号').replace(/1\d{10}/g, maskPhone).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, maskEmail)
  const headerPhoneMasked = accountPhoneDisplay(user?.phoneMasked ?? displayName)
  const goLogin = () => navigate('/login', { state: { from: location.pathname } })
  // 「本次记录」里的条目只有文件名和大小，没有可打印的文件凭证（全仓也没有页面往这里传记录）。
  // 打印交接只收带文件编号和打印链接的文件（商用收口 P0-5），所以不造一份空交接：
  // 打印台没有交接就落「这一页没有待处理的文件」，按钮带用户去选文件。
  const printFile = (file: { name: string; size: string; pages?: number }) => {
    void file
    navigate('/print/preview')
  }

  const uiState = deriveProfileState({
    isLoggedIn,
    countsLoading: assetOverview.loading,
    tasksLoading,
    countsMissing: assetOverview.allMissing,
    countsZero: assetOverview.allZero,
    tasksError,
    pendingTask,
  })

  const status = statusFor(uiState)

  const dock = uiState === 'member' || uiState === 'ready'
    ? (
      <button type="button" className="qx-btn" data-variant="danger" data-testid="profile-primary" onClick={() => endKioskUse('end_use')}>
        结束使用
      </button>
    )
    : (
      <ProfileCta
        uiState={uiState}
        pendingTask={pendingTask}
        onLogin={goLogin}
        onHome={() => navigate('/')}
        onRetry={() => setReloadKey((key) => key + 1)}
        onHelp={() => navigate('/help')}
        onProgress={() => {
          if (!pendingTask) return
          navigate('/print/progress', {
            state: {
              taskId: pendingTask.id,
              orderId: pendingTask.resume.orderId,
              orderNo: pendingTask.resume.orderNo,
              amountCents: pendingTask.resume.amountCents,
              paymentSessionToken: pendingTask.resume.paymentSessionToken,
            },
          })
        }}
      />
    )

  return (
    <div className="fusion-w5 h-full pf-root" data-kiosk-screen="profile" data-takeaway="本人资产、记录与待办" data-state={uiState} data-testid={`profile-state-${uiState}`}>
      <MeTouchShell
        title="我的"
        sub="简历、文档、订单、收藏与权益都在这里。"
        status={status}
        backLabel="返回首页"
        onBack={() => navigate('/')}
        ask={isLoggedIn
          ? { label: '问小青：我的记录在哪里找？', draft: '我的简历、文档和打印订单在哪里找？离开前应该怎样结束使用？' }
          : { label: '问小青：不登录能办什么？', draft: '不登录能办什么？' }}
        primaryNode={dock}
      >
        <div className="qx-scroll qx-grow pf-page">
          {isLoggedIn ? (
            <ProfileHeader
              isLoggedIn={isLoggedIn}
              displayName={headerDisplayName}
              phoneMasked={headerPhoneMasked}
              reserveBannerSpace={isLoggedIn && Boolean(pendingTask)}
              onLogin={goLogin}
              onOpenSettings={() => navigate('/me/settings')}
            />
          ) : null}
          {isLoggedIn && miniappLine ? <p className="qxt-me-sync">{miniappLine}</p> : null}

          {uiState === 'signed-out' ? <MeProfileGuest contact={support} /> : null}

          {uiState === 'loading' ? <MeProfileLoading /> : null}

          {uiState === 'error' ? (
            <div data-testid="profile-fallback">
              <h2>账号数据这次没取到</h2>
              <MeErrorPack reloadLabel="重新读取" onRetry={() => setReloadKey((key) => key + 1)} />
            </div>
          ) : null}

          {isLoggedIn && uiState !== 'loading' && uiState !== 'error' ? (
            <ProfileContinueCard task={pendingTask} tasksError={tasksError} />
          ) : null}

          {isLoggedIn ? (
            <ProfileAssetGrid counts={assetOverview.counts} loading={assetOverview.loading} />
          ) : null}

          {uiState === 'empty' ? (
            <div className="qx-state" data-tone="info" data-testid="profile-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">这个账号下还没有任何记录</div>
                <p className="qx-state-d">
                  你还没有保存过简历、生成过文档或下过打印订单。办过之后，会列在上面几项里。
                </p>
              </span>
            </div>
          ) : null}
          {uiState === 'empty' ? <EmptyStartRows /> : null}

          {isLoggedIn && (resumes.length + scans.length + aiRecords.length > 0 || uiState === 'member' || uiState === 'ready' || uiState === 'printing') ? (
            <ProfileSessionRecords
              resumes={resumes}
              scans={scans}
              aiRecords={aiRecords}
              onPrintFile={printFile}
              onDeleteResume={(id) => setResumes((prev) => prev.filter((item) => item.id !== id))}
              onDeleteScan={(id) => setScans((prev) => prev.filter((item) => item.id !== id))}
              onDeleteAiRecord={(id) => setAiRecords((prev) => prev.filter((item) => item.id !== id))}
            />
          ) : null}

          {isLoggedIn ? <AccountRows onEnd={() => endKioskUse('end_use')} primaryEnd={uiState === 'member' || uiState === 'ready'} /> : null}

          <p className="pf-truth">
            <span><b>结束使用会退出本机并清除临时信息。</b>已提交的订单与文件按保存期限管理。离开 3 分钟没操作会自动退出。</span>
            <button type="button" onClick={() => navigate('/legal/privacy')}>
              隐私说明
            </button>
          </p>
        </div>
      </MeTouchShell>
    </div>
  )
}

function deriveProfileState(input: {
  isLoggedIn: boolean
  countsLoading: boolean
  tasksLoading: boolean
  countsMissing: boolean
  countsZero: boolean
  tasksError: boolean
  pendingTask: PendingTask | null
}): ProfileUiState {
  if (!input.isLoggedIn) return 'signed-out'
  if (input.countsLoading || input.tasksLoading) return 'loading'
  if (input.countsMissing && input.tasksError) return 'error'
  if (input.pendingTask?.resume.kind === 'payment') return 'ready'
  if (input.pendingTask && (input.pendingTask.status === 'claimed' || input.pendingTask.status === 'printing')) {
    return 'printing'
  }
  if (input.countsZero && !input.pendingTask) return 'empty'
  return 'member'
}

function statusFor(state: ProfileUiState): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  if (state === 'signed-out') return { tone: 'unknown', label: '未登录' }
  if (state === 'error') return { tone: 'warn', label: '请重新读取账号数据' }
  if (state === 'loading') return { tone: 'unknown', label: '正在读取数量与待办' }
  if (state === 'printing') return { tone: 'warn', label: '有文件正在出纸' }
  if (state === 'ready') return { tone: 'warn', label: '有订单待付款' }
  return { tone: 'unknown', label: '已登录' }
}

function AccountRows({ onEnd, primaryEnd }: { onEnd: () => void; primaryEnd: boolean }) {
  const navigate = useNavigate()
  const rows = [
    { icon: ClockIcon, title: '浏览与跳转记录', desc: '只记录你看过和打开过的来源，不记录投递结果。', to: '/me/activity', testid: 'profile-activity' },
    { icon: BellIcon, title: '消息通知', desc: '系统下发的会员通知，已读与标记都会记录。', to: '/me/notifications', testid: 'profile-notifications' },
    { icon: HelpCircleIcon, title: '帮助中心', desc: '常见问题与服务电话', to: '/help', testid: 'profile-help' },
    { icon: MessageSquareIcon, title: '意见反馈', desc: '提交后能看到处理状态。', to: '/me/feedback', testid: 'profile-feedback' },
    { icon: ShieldIcon, title: '隐私请求', desc: '当前可撤回 AI 使用授权；注销账号、复制个人信息，请按《隐私政策》的联系方式申请。', to: '/me/privacy-requests', testid: 'profile-privacy' },
  ]
  return (
    <section>
      <div className="qx-sec-h">
        <span className="t">通知与支持</span>
        <span className="hint">只列已经能用的</span>
      </div>
      <div className="qx-rows pf-support-rows">
        {rows.map((row) => (
          <button
            type="button"
            key={row.to}
            className="qx-row"
            data-testid={row.testid}
            onClick={() => navigate(row.to)}
          >
            <span className="qx-row-ic">
              <row.icon size={24} aria-hidden />
            </span>
            <span className="qx-row-tx">
              <span className="qx-row-t">{row.title}</span>
              <span className="qx-row-d">{row.desc}</span>
            </span>
            <span className="qx-row-go">›</span>
          </button>
        ))}
        <button
          type="button"
          className="qx-row"
          data-testid="profile-account"
          onClick={() => navigate('/me/settings')}
        >
          <span className="qx-row-ic">
            <SettingsIcon size={24} aria-hidden />
          </span>
          <span className="qx-row-tx">
            <span className="qx-row-t">账号设置</span>
            <span className="qx-row-d">换号、授权和结束使用。</span>
          </span>
          <span className="qx-row-go">›</span>
        </button>
      </div>
      <div className="pf-support-actions">
        <p>离开前请点「结束使用」；这会退出登录并清掉本机这一次的临时信息。</p>
        {primaryEnd ? null : (
          <button type="button" className="qx-btn" data-variant="danger" data-testid="profile-end-use" onClick={onEnd}>结束使用</button>
        )}
      </div>
    </section>
  )
}

function EmptyStartRows() {
  const navigate = useNavigate()
  return (
    <section>
      <div className="qx-sec-h">
        <span className="t">从这里开始</span>
      </div>
      <div className="qx-rows">
        <button type="button" className="qx-row" onClick={() => navigate('/resume/source')}>
          <span className="qx-row-tx">
            <span className="qx-row-t">上传或扫描一份简历</span>
            <span className="qx-row-d">解析完就能诊断、优化和生成材料。</span>
          </span>
        </button>
        <button type="button" className="qx-row" onClick={() => navigate('/print/upload')}>
          <span className="qx-row-tx">
            <span className="qx-row-t">打印你带来的文件</span>
            <span className="qx-row-d">U 盘、手机传输或本机扫描都可以。</span>
          </span>
        </button>
        <button type="button" className="qx-row" onClick={() => navigate('/policy-service')}>
          <span className="qx-row-tx"><span className="qx-row-t">看看就业政策并收藏</span><span className="qx-row-d">查看办事指引，资格与办理以官方核验为准。</span></span>
        </button>
      </div>
    </section>
  )
}

function ProfileCta({
  uiState,
  pendingTask,
  onLogin,
  onHome,
  onRetry,
  onProgress,
}: {
  uiState: ProfileUiState
  pendingTask: PendingTask | null
  onLogin: () => void
  onHome: () => void
  onRetry: () => void
  onHelp: () => void
  onProgress: () => void
}) {
  if (uiState === 'signed-out') {
    return (
      <button type="button" className="qx-btn" data-variant="primary" data-grow="1" data-testid="profile-primary" onClick={onLogin}>
        <span data-testid="profile-login">去登录</span>
      </button>
    )
  }
  if (uiState === 'loading') {
    return (
      <><button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-primary" onClick={onHome}>回首页</button></>
    )
  }
  if (uiState === 'error') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onRetry}>
          重新读取
        </button>
      </>
    )
  }
  if (uiState === 'empty') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onHome}>
          回首页选服务
        </button>
      </>
    )
  }
  if (uiState === 'printing' && pendingTask) {
    return (
      <>
        <p className="why">出纸完成前不要离开取件口；离开这一页不会取消已经提交的打印。</p>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onProgress}>
          看出纸进度
        </button>
      </>
    )
  }
  return null
}
