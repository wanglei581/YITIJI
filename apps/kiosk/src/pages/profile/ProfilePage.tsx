import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { BellIcon, HelpCircleIcon, MessageSquareIcon, ShieldIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { getPendingTasks, type PendingTask } from '../../services/api/pendingTasks'
import { getTerminalCode } from '../../services/api/screensaver'
import { useMemberAssetCounts } from './assets/useMemberAssetCounts'
import { ProfileAssetGrid } from './components/ProfileAssetGrid'
import { ProfileContinueCard } from './components/ProfileContinueCard'
import { ProfileHeader } from './components/ProfileHeader'
import { ProfileSessionRecords } from './components/ProfileSessionRecords'
import { savePrintMaterialSession } from '../print/printMaterialSession'
import { QxMemberNavbar } from './components/QxMemberNavbar'
import type { AIRecord, IncomingState, ResumeItem, ScanItem } from './profileTypes'
import './styles/profile-qx.css'

type ProfileUiState = 'signed-out' | 'loading' | 'error' | 'empty' | 'member' | 'ready' | 'printing'

export function ProfilePage() {
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

  const headerDisplayName = user?.nickname?.trim() || displayName || '会员账号'
  const headerPhoneMasked = user?.phoneMasked ?? displayName
  const goLogin = () => navigate('/login', { state: { from: location.pathname } })
  const printFile = (file: { name: string; size: string; pages?: number }) => {
    const next = { name: file.name, size: file.size, pages: file.pages ?? 1 }
    // 必须落 sessionStorage：/print/preview 现在重定向到 /print/desk?step=preview，
    // 打印台首屏从 readPrintMaterialSession() 复水。只传 route state 的话，
    // 一体机看门狗自动 reload 之后文件就没了——那正是打印台合并要避免的死局。
    savePrintMaterialSession({ file: next })
    navigate('/print/preview', { state: { file: next } })
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
  const terminalLabel = getTerminalCode() || '就业服务大厅'

  return (
    <div className="fusion-w5 h-full" data-kiosk-screen="profile" data-state={uiState} data-testid={`profile-state-${uiState}`}>
      <QxPageFrame
        title="我的"
        subtitle="简历、文档、订单、收藏与权益都在这里；数量以服务端返回为准。"
        status={status}
        terminalLabel={terminalLabel}
        ctabar={
          <ProfileCta
            uiState={uiState}
            pendingTask={pendingTask}
            onLogin={goLogin}
            onHome={() => navigate('/')}
            onRetry={() => setReloadKey((key) => key + 1)}
            onEnd={() => clearSessionTo({ path: '/profile' })}
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
            stats={{
              aiRecords: assetOverview.counts.ai,
              favorites: assetOverview.counts.favorites,
              documents: assetOverview.counts.documents,
            }}
            statsLoading={assetOverview.loading}
            reserveBannerSpace={isLoggedIn && Boolean(pendingTask)}
            onLogin={goLogin}
            onLogout={() => clearSessionTo({ path: '/profile' })}
            onOpenSettings={() => navigate('/me/settings')}
            onOpenNotifications={() => navigate('/me/notifications')}
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
                  数量与待办都没有返回。入口还能点，但<b>本机不会拿上一次的数字冒充当前账号</b>，所以卡片上一律显示「—」。
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
                  你还没有在本机保存过简历、生成过文档或下过打印订单，所以<b>六项都是空的</b>。空就是空，本机不会造几条记录让页面好看。
                </p>
              </span>
            </div>
          ) : null}

          {isLoggedIn && uiState !== 'signed-out' && uiState !== 'empty' ? (
            <ProfileContinueCard task={pendingTask} tasksError={tasksError} />
          ) : null}

          {isLoggedIn ? (
            <ProfileAssetGrid counts={assetOverview.counts} loading={assetOverview.loading} />
          ) : (
            <ProfileAssetGrid counts={assetOverview.counts} loading={false} />
          )}

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
            <span>
              <b>结束会话只清除本机登录态与临时会话信息。</b>
              已提交到服务端的订单与文件按服务端留存期限管理，删除以服务端返回为准。
            </span>
            <button type="button" onClick={() => navigate('/legal/privacy')}>
              隐私说明
            </button>
          </p>
        </div>
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
  if (state === 'error') return { tone: 'bad', label: '账号数据这次没取到' }
  if (state === 'loading') return { tone: 'unknown', label: '正在读取数量与待办' }
  if (state === 'printing') return { tone: 'warn', label: '有文件正在出纸' }
  return { tone: 'unknown', label: '数量与记录均由服务端返回' }
}

function AccountRows() {
  const navigate = useNavigate()
  const rows = [
    { icon: BellIcon, title: '消息通知', desc: '服务端下发的会员通知，读与标记均落库。', to: '/me/notifications', testid: 'profile-notifications' },
    { icon: ShieldIcon, title: '隐私请求', desc: '当前可提交岗位 AI 授权撤回；数据导出与账号注销尚未开放。', to: '/me/privacy-requests', testid: 'profile-privacy' },
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
  return (
    <>
      <div className="pf-note">
        <div className="pf-note-t">不登录也能用的服务</div>
        <p>
          打印、扫描、岗位与招聘会浏览、政策查询都<b>不需要账号</b>。需要本人身份、跨设备保存或会员权益的功能，会在进入时再要求登录。
        </p>
      </div>
      <section>
        <div className="qx-sec-h">
          <span className="t">登录之后会出现</span>
          <span className="hint">现在不预渲染任何人的数据</span>
        </div>
        <div className="qx-rows">
          <button type="button" className="qx-row" onClick={() => navigate('/login', { state: { from: '/me/resumes' } })}>
            <span className="qx-row-tx">
              <span className="qx-row-t">你自己的简历与文档</span>
              <span className="qx-row-d">解析过的简历、生成的材料与扫描件。</span>
            </span>
          </button>
          <button type="button" className="qx-row" onClick={() => navigate('/login', { state: { from: '/me/print-orders' } })}>
            <span className="qx-row-tx">
              <span className="qx-row-t">打印订单与办理进度</span>
              <span className="qx-row-d">订单状态由服务端返回，可继续办理。</span>
            </span>
          </button>
          <button type="button" className="qx-row" onClick={() => navigate('/login', { state: { from: '/me/benefits' } })}>
            <span className="qx-row-tx">
              <span className="qx-row-t">权益台账与活动记录</span>
              <span className="qx-row-d">是否有可用权益由接口判定。</span>
            </span>
          </button>
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
        <button type="button" className="qx-row" onClick={() => navigate('/jobs')}>
          <span className="qx-row-tx">
            <span className="qx-row-t">看看岗位并收藏</span>
            <span className="qx-row-d">收藏只记录你自己的浏览，不发送给任何单位。</span>
          </span>
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
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onLogin}>
          手机号登录
        </button>
      </>
    )
  }
  if (uiState === 'loading') {
    return (
      <button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-primary" onClick={onHome}>
        回首页
      </button>
    )
  }
  if (uiState === 'error') {
    return (
      <>
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
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onSettings}>账号设置</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onHome}>
          回首页选服务
        </button>
      </>
    )
  }
  if (uiState === 'printing' && pendingTask) {
    return (
      <>
        <p className="why">出纸完成前不要离开取件口；离开会话不会取消已提交的打印。</p>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="profile-primary" onClick={onProgress}>
          看出纸进度
        </button>
      </>
    )
  }
  return (
    <>
      <p className="why">离开前请点「结束使用」；这会退出登录并清掉本机这一趟的临时会话信息。</p>
      <button type="button" className="qx-btn" data-variant="danger" data-testid="profile-primary" onClick={onEnd}>
        结束使用
      </button>
    </>
  )
}
