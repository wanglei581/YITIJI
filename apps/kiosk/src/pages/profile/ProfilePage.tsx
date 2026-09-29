import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { BellIcon, FileTextIcon, GiftIcon, HelpCircleIcon, LockIcon, MessageSquareIcon, PrinterIcon, ShieldIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { accountPhoneDisplay } from '../auth/accountUserMessage'
import { maskPhone, maskEmail } from '../../utils/maskPii'
import { getPendingTasks, type PendingTask } from '../../services/api/pendingTasks'
import { useMemberAssetCounts } from './assets/useMemberAssetCounts'
import { ProfileAssetGrid } from './components/ProfileAssetGrid'
import { ProfileContinueCard } from './components/ProfileContinueCard'
import { ProfileHeader } from './components/ProfileHeader'
import { ProfileSessionRecords } from './components/ProfileSessionRecords'
import { QxMemberNavbar } from './components/QxMemberNavbar'
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
  const { clearSessionTo } = useKioskSessionControl()
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

  return (
    <div className="fusion-w5 h-full pf-root" data-kiosk-screen="profile" data-takeaway="本人资产、记录与待办" data-state={uiState} data-testid={`profile-state-${uiState}`}>
      <QxPageFrame
        title="我的"
        subtitle="简历、文档、订单、收藏与权益都在这里；以实际记录为准。"
        status={status}
        back={{ label: '返回首页', onBack: () => navigate('/') }}
        ctabar={
          <ProfileCta
            uiState={uiState}
            pendingTask={pendingTask}
            onLogin={goLogin}
            onHome={() => navigate('/')}
            onRetry={() => setReloadKey((key) => key + 1)}
            onEnd={() => clearSessionTo({ path: '/' })}
            onSettings={() => navigate('/me/settings')}
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
        }
        navbar={<QxMemberNavbar current="profile" />}
      >
        <div className="qx-scroll qx-grow pf-page">
          <ProfileHeader
            isLoggedIn={isLoggedIn}
            displayName={headerDisplayName}
            phoneMasked={headerPhoneMasked}
            reserveBannerSpace={isLoggedIn && Boolean(pendingTask)}
            onLogin={goLogin}
            onOpenSettings={() => navigate('/me/settings')}
          />

          {uiState === 'signed-out' ? <SignedOutBody /> : null}

          {uiState === 'loading' ? (
            <div className="qx-card" aria-busy="true">
              <div className="pf-skel" style={{ width: '40%' }} />
              <div className="pf-skel" style={{ width: '66%', marginTop: 14 }} />
            </div>
          ) : null}

          {uiState === 'error' ? (
            <div className="qx-state" data-tone="error" data-testid="profile-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">账号数据这次没取到</div>
                <p className="qx-state-d">
                  数量与待办这次没有取到。可以重新加载，或点进各项查看。
                </p>
              </span>
            </div>
          ) : null}

          {uiState === 'empty' ? (
            <div className="qx-state" data-tone="info" data-testid="profile-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">这个账号下还没有任何记录</div>
                <p className="qx-state-d">
                  你还没有保存过简历、生成过文档或下过打印订单。办过之后，会列在下面几项里。
                </p>
              </span>
            </div>
          ) : null}

          {isLoggedIn && uiState !== 'loading' && uiState !== 'error' ? (
            <ProfileContinueCard task={pendingTask} tasksError={tasksError} />
          ) : null}

          {isLoggedIn ? (
            <ProfileAssetGrid counts={assetOverview.counts} loading={assetOverview.loading} />
          ) : null}

          {uiState === 'empty' ? <EmptyStartRows /> : null}

          {isLoggedIn ? (
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

          {isLoggedIn ? <AccountRows /> : null}

          <p className="pf-truth">
            <span><b>结束使用会退出本机并清除临时信息。</b>已提交的订单与文件按保存期限管理。</span>
            <button type="button" onClick={() => navigate('/legal/privacy')}>
              隐私说明
            </button>
          </p>
        </div>
        <QxStepActions onPrev={() => navigate('/')} prevLabel="返回首页">
          <QxAiHelp label="问小青：我的记录在哪里找？" draft="我的简历、文档和打印订单在哪里找？离开前应该怎样结束使用？" />
        </QxStepActions>
      </QxPageFrame>
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
  if (state === 'error') return { tone: 'bad', label: '请重新读取账号数据' }
  if (state === 'loading') return { tone: 'unknown', label: '正在读取数量与待办' }
  if (state === 'printing') return { tone: 'warn', label: '有文件正在出纸' }
  return { tone: 'unknown', label: '以你账号里的实际记录为准' }
}

function AccountRows() {
  const navigate = useNavigate()
  const rows = [
    { icon: BellIcon, title: '消息通知', desc: '系统下发的会员通知，已读与标记都会记录。', to: '/me/notifications', testid: 'profile-notifications' },
    { icon: ShieldIcon, title: '隐私请求', desc: '当前可撤回 AI 使用授权；数据导出与账号注销尚未开放。', to: '/me/privacy-requests', testid: 'profile-privacy' },
    { icon: HelpCircleIcon, title: '帮助中心', desc: '服务台位置、常见问题与找人处理。', to: '/help', testid: 'profile-help' },
    { icon: MessageSquareIcon, title: '意见反馈', desc: '提交后能看到处理状态。', to: '/me/feedback', testid: 'profile-feedback' },
  ]
  return (
    <section>
      <div className="qx-sec-h">
        <span className="t">通知与支持</span>
        <span className="hint">只列已经能用的</span>
      </div>
      <div className="qx-rows">
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
      </div>
    </section>
  )
}

function SignedOutBody() {
  const navigate = useNavigate()
  const rows = [
    { icon: FileTextIcon, title: '你自己的简历与文档', desc: '解析过的简历、生成的材料与扫描件。', from: '/me/resumes' },
    { icon: PrinterIcon, title: '打印订单与办理进度', desc: '订单状态以系统记录为准，可继续办理。', from: '/me/print-orders' },
    { icon: GiftIcon, title: '权益台账与活动记录', desc: '是否有可用权益由系统判定。', from: '/me/benefits' },
  ]
  const bounds = [
    ['不需要账号', '打印、扫描、复印与文件转换'],
    ['不需要账号', '机构官方渠道与政策查询'],
    ['需要登录', '跨设备保存的简历、文档与打印订单'],
    ['需要登录', '会员权益、隐私请求与消息通知'],
    ['现在显示的数量', '没有 —— 未登录时本机不预渲染任何人的数据'],
    ['登录之后', '数量与待办按你本人的账号显示'],
  ]
  return (
    <>
      <div className="pf-note">
        <div className="pf-note-t"><LockIcon size={24} aria-hidden />不登录也能用的服务</div>
        <p>
          打印、扫描、政策查询都<b>不需要账号</b>。需要本人身份、跨设备保存或会员权益的功能，会在进入时再要求登录。
        </p>
      </div>
      <section>
        <div className="qx-sec-h">
          <span className="t">登录之后会出现</span>
          <span className="hint">现在不预渲染任何人的数据</span>
        </div>
        <div className="qx-rows">
          {rows.map((row) => (
            <button
              type="button"
              key={row.from}
              className="qx-row"
              onClick={() => navigate('/login', { state: { from: row.from } })}
            >
              <span className="qx-row-ic" aria-hidden="true"><row.icon size={24} /></span>
              <span className="qx-row-tx">
                <span className="qx-row-t">{row.title}</span>
                <span className="qx-row-d">{row.desc}</span>
              </span>
              <span className="qx-row-go" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label="登录与不登录的分界">
        <div className="qx-sec-h">
          <span className="t">登录与不登录的分界</span>
          <span className="hint">按功能划线，不按页面划线</span>
        </div>
        <div className="pf-meta2">
          {bounds.map(([label, value]) => (
            <div key={value}><small>{label}</small><b>{value}</b></div>
          ))}
        </div>
      </section>
    </>
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
  onEnd,
  onSettings,
  onHelp,
  onProgress,
}: {
  uiState: ProfileUiState
  pendingTask: PendingTask | null
  onLogin: () => void
  onHome: () => void
  onRetry: () => void
  onEnd: () => void
  onSettings: () => void
  onHelp: () => void
  onProgress: () => void
}) {
  if (uiState === 'signed-out') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onHome}>回首页</button>
        <button type="button" className="qx-btn" data-variant="primary" data-grow="1" data-testid="profile-primary" onClick={onLogin}>
          <span data-testid="profile-login">去登录</span>
        </button>
      </>
    )
  }
  if (uiState === 'loading') {
    return (
      <><button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-account" onClick={onSettings}>账号设置</button>
      <button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-primary" onClick={onHome}>回首页</button></>
    )
  }
  if (uiState === 'error') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-account" onClick={onSettings}>账号设置</button>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onHelp}>找工作人员</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onRetry}>
          重新加载
        </button>
      </>
    )
  }
  if (uiState === 'empty') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-account" onClick={onSettings}>账号设置</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onHome}>
          回首页选服务
        </button>
      </>
    )
  }
  if (uiState === 'printing' && pendingTask) {
    return (
      <>
<button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-account" onClick={onSettings}>账号设置</button>
        <p className="why">出纸完成前不要离开取件口；离开这一页不会取消已经提交的打印。</p>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onProgress}>
          看出纸进度
        </button>
      </>
    )
  }
  return (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-account" onClick={onSettings}>账号设置</button>
      <p className="why">离开前请点「结束使用」；这会退出登录并清掉本机这一次的临时信息。</p>
      <button type="button" className="qx-btn" data-variant="danger" data-testid="profile-primary" onClick={onEnd}>
        结束使用
      </button>
    </>
  )
}
