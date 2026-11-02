import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
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

  const onEnd = () => endKioskUse('end_use')
  // 底栏右边的主按钮：未登录去登录；读不到重新读取；读取中不放主按钮；其余都是「结束使用」，
  // 待办里的「继续付款 / 看出纸进度 / 去首页开始」在待办卡上。
  const dock = uiState === 'signed-out'
    ? (
      <button type="button" className="qx-btn" data-variant="primary" data-grow="1" data-testid="profile-primary" onClick={goLogin}>
        <span data-testid="profile-login">去登录</span>
      </button>
    )
    : uiState === 'error'
      ? (
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={() => setReloadKey((key) => key + 1)}>
          重新读取
        </button>
      )
      : uiState === 'loading'
        ? null
        : (
          <button type="button" className="qx-btn" data-variant="danger" data-testid="profile-primary" onClick={onEnd}>
            结束使用
          </button>
        )

  const signedIn = isLoggedIn
  const bandTitle = uiState === 'error' ? '账号数据这次没取到' : '我的'
  const bandSub = uiState === 'error'
    ? '可以再试一次'
    : uiState === 'loading' ? '正在读取数量与待办' : '简历、文档、订单、收藏与权益都在这里。'

  return (
    <div className="fusion-w5 h-full pf-root" data-kiosk-screen="profile" data-takeaway="本人资产、记录与待办" data-state={uiState} data-testid={`profile-state-${uiState}`}>
      <MeTouchShell
        title={bandTitle}
        sub={bandSub}
        status={status}
        backLabel="返回首页"
        onBack={() => navigate('/')}
        ask={signedIn
          ? { label: '问小青：我的记录在哪里找？', draft: '我的简历、文档和打印订单在哪里找？离开前应该怎样结束使用？' }
          : { label: '问小青：不登录能办什么？', draft: '不登录能办什么？' }}
        primaryNode={dock}
      >
        <div className="qx-scroll qx-grow me-page">
          {uiState === 'signed-out' ? <MeProfileGuest contact={support} /> : null}

          {uiState === 'loading' ? <MeProfileLoading /> : null}

          {uiState === 'error' ? (
            <div data-testid="profile-fallback" className="me-state">
              <MeErrorPack reloadLabel="重新读取" onRetry={() => setReloadKey((key) => key + 1)} />
            </div>
          ) : null}

          {signedIn && uiState !== 'loading' && uiState !== 'error' ? (
            <>
              <ProfileHeader
                isLoggedIn={isLoggedIn}
                displayName={headerDisplayName}
                phoneMasked={headerPhoneMasked}
                reserveBannerSpace={Boolean(pendingTask)}
                onLogin={goLogin}
                onOpenSettings={() => navigate('/me/settings')}
              />
              {miniappLine ? <p className="me-sync">{miniappLine}</p> : null}
              <ProfileAssetGrid counts={assetOverview.counts} loading={assetOverview.loading} />
              <ProfileContinueCard task={pendingTask} tasksError={tasksError} empty={uiState === 'empty'} />
              {uiState === 'empty' ? <EmptyStartRows /> : null}
              {resumes.length + scans.length + aiRecords.length > 0 ? (
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
              <AccountRows few={uiState === 'empty'} />
              <p className="me-fine">
                结束使用会退出本机并清除临时信息。已提交的订单与文件按保存期限管理。离开 3 分钟没操作会自动退出。
              </p>
            </>
          ) : null}
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

function AccountRows({ few }: { few: boolean }) {
  const navigate = useNavigate()
  const rows = [
    { title: '浏览与跳转记录', desc: '你看过的政策，和打开过的来源', to: '/me/activity', testid: 'profile-activity' },
    { title: '消息通知', desc: '打印、反馈和公告', to: '/me/notifications', testid: 'profile-notifications' },
    { title: '帮助中心', desc: '常见问题与服务电话', to: '/help', testid: 'profile-help' },
    { title: '意见反馈', desc: '提交后能看到处理状态', to: '/me/feedback', testid: 'profile-feedback' },
    { title: '隐私请求', desc: '可撤回 AI 使用授权', to: '/me/privacy-requests', testid: 'profile-privacy' },
    { title: '账号设置', desc: '换绑、协议、结束使用', to: '/me/settings', testid: 'profile-account' },
  ]
  return (
    <section className={`me-rows${few ? ' me-few me-links' : ''}`} aria-label="通知与支持">
      {rows.map((row) => (
        <button type="button" key={row.to} className="me-line" data-testid={row.testid} onClick={() => navigate(row.to)}>
          <b>{row.title}</b>
          <small>{row.desc}</small>
        </button>
      ))}
    </section>
  )
}

function EmptyStartRows() {
  const navigate = useNavigate()
  return (
    <section className="me-trio" aria-label="从这里开始">
      <button type="button" className="me-line" onClick={() => navigate('/resume/source')}>
        <b>上传或扫描简历</b>
        <small>解析完可以诊断</small>
      </button>
      <button type="button" className="me-line" onClick={() => navigate('/print/upload')}>
        <b>打印带来的文件</b>
        <small>U 盘、手机或扫描</small>
      </button>
      <button type="button" className="me-line" onClick={() => navigate('/policy-service')}>
        <b>看看就业政策</b>
        <small>以官方原文为准</small>
      </button>
    </section>
  )
}
