import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { accountPhoneDisplay } from '../auth/accountUserMessage'
import { getPendingTasks, type PendingTask } from '../../services/api/pendingTasks'
import { useMemberAssetCounts } from './assets/useMemberAssetCounts'
import { ProfileAssetGrid } from './components/ProfileAssetGrid'
import { ProfileContinueCard } from './components/ProfileContinueCard'
import { ProfileHeader } from './components/ProfileHeader'
import {
  EmptyStartRows,
  ProfileCta,
  ProfileErrorFacts,
  ProfileLoadingFacts,
  ProfileStateBanner,
  ProfileSupportRows,
  SignedOutBody,
  profileChrome,
  type ProfileUiState,
} from './components/ProfileHomeStates'
import { ProfileSessionRecords } from './components/ProfileSessionRecords'
import { QxMemberNavbar } from './components/QxMemberNavbar'
import type { AIRecord, IncomingState, ResumeItem, ScanItem } from './profileTypes'
import './styles/profile-qx.css'

export function ProfilePage() {
  const { user } = useAuth()
  return <ProfileContent key={user?.id ?? 'guest'} />
}

function ProfileContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isLoggedIn, getToken } = useAuth()
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

  const headerPhoneMasked = accountPhoneDisplay(user?.phoneMasked ?? '')
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
  const chrome = profileChrome(uiState)

  return (
    <div className="fusion-w5 h-full pf-root" data-kiosk-screen="profile" data-takeaway="本人资产、记录与待办" data-state={uiState} data-testid={`profile-state-${uiState}`}>
      <QxPageFrame
        title="我的"
        subtitle={chrome.subtitle}
        status={chrome.status}
        back={{ label: '返回首页', onBack: () => navigate('/') }}
        ctabar={
          <ProfileCta
            uiState={uiState}
            pendingTask={pendingTask}
            onLogin={goLogin}
            onHome={() => navigate('/')}
            onRetry={() => setReloadKey((key) => key + 1)}
            onHelp={() => navigate('/help')}
            onSettings={() => navigate('/me/settings')}
            onEnd={() => endKioskUse('end_use')}
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
            phoneMasked={headerPhoneMasked}
            reserveBannerSpace={isLoggedIn && Boolean(pendingTask)}
            onLogin={goLogin}
          />

          {uiState === 'signed-out' ? <SignedOutBody /> : null}

          {uiState === 'loading' ? (
            <div className="pf-loading-head">
              <div className="qx-card" aria-busy="true">
                <div className="pf-skel" style={{ width: '40%' }} />
                <div className="pf-skel" style={{ width: '66%', marginTop: 14 }} />
              </div>
              <p className="pf-reading-note">正在取你的资产数量与待办。数量返回前显示「—」，不显示上一次的数字。</p>
            </div>
          ) : null}

          {uiState === 'error' ? (
            <ProfileStateBanner tone="error" title="账号数据这次没取到">
              数量与待办都没有返回。入口还能点，但<b>本机不会拿上一次的数字冒充当前账号</b>，所以卡片上一律显示「—」。
            </ProfileStateBanner>
          ) : null}

          {isLoggedIn && uiState !== 'loading' && uiState !== 'error' ? (
            <ProfileContinueCard task={pendingTask} tasksError={tasksError} />
          ) : null}

          {isLoggedIn ? (
            <ProfileAssetGrid counts={assetOverview.counts} loading={assetOverview.loading} />
          ) : null}

          {uiState === 'loading' ? <ProfileLoadingFacts /> : null}
          {uiState === 'error' ? <ProfileErrorFacts /> : null}

          {uiState === 'empty' ? (
            <ProfileStateBanner tone="info" title="这个账号下还没有任何记录">
              你还没有保存过简历、生成过文档或下过打印订单。办过之后，会列在上面这几项里。
            </ProfileStateBanner>
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

          {isLoggedIn ? <ProfileSupportRows /> : null}

          <p className="pf-truth">
            <span><b>结束这次使用，只清除本机登录和这一次的临时信息。</b>已经提交的订单与文件按各自的保存期限管理。</span>
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
