import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { PublicArt } from '../public-touch/PublicArt'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import { getPendingTasks, type PendingTask } from '../../services/api/pendingTasks'
import { SessionResumeView } from './SessionResumeView'
import {
  deriveResumeScreen,
  resumeContinueRoute,
  resumeVerdict,
} from './sessionResumeModel'
import './styles/session-resume-qx.css'
import './session-resume-touch.css'

export function SessionResumePage() {
  const navigate = useNavigate()
  const { ready, isLoggedIn, getToken } = useAuth()
  const [tasks, setTasks] = useState<PendingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const goLogin = () => {
    navigate('/login', { replace: true, state: { from: '/session-resume' } })
  }

  const reload = () => {
    const token = getToken()
    if (!isLoggedIn || !token) {
      goLogin()
      return
    }
    setLoading(true)
    setError(false)
    void getPendingTasks(token)
      .then((data) => { setTasks(data) })
      .catch(() => { setError(true) })
      .finally(() => { setLoading(false) })
  }

  useEffect(() => {
    if (!ready) return
    const token = getToken()
    if (!isLoggedIn || !token) {
      setLoading(false)
      return
    }
    let cancelled = false
    getPendingTasks(token)
      .then((data) => { if (!cancelled) setTasks(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [getToken, isLoggedIn, navigate, ready])

  const screen = deriveResumeScreen({
    authReady: ready,
    isLoggedIn,
    loading,
    error,
    taskCount: tasks.length,
  })

  const continueTask = (task: PendingTask) => {
    const verdict = resumeVerdict(task)
    if (!verdict.ok) return
    const state = {
      taskId: task.id,
      file: task.fileName ? { name: task.fileName, size: '待识别' } : undefined,
      orderId: task.resume.orderId,
      orderNo: task.resume.orderNo,
      amountCents: task.resume.amountCents,
      paymentSessionToken: task.resume.paymentSessionToken,
      ...(task.resume.kind === 'payment' ? { priceLines: task.resume.priceLines } : {}),
    }
    const dest = resumeContinueRoute(verdict.dest)
    if (dest === '/print/cashier') {
      navigate('/print/cashier', { state })
      return
    }
    navigate('/print/progress', { state })
  }

  const guest = ready && !isLoggedIn
  const status = !ready || (loading && !guest)
    ? { tone: 'unknown' as const, label: '正在读取' }
    : guest
      ? { tone: 'unknown' as const, label: '登录后继续' }
      : screen === 'unavailable'
        ? { tone: 'warn' as const, label: '没读到未完成任务' }
        : screen === 'empty'
          ? { tone: 'ok' as const, label: '名下没有未完成任务' }
          : { tone: 'warn' as const, label: '继续打印任务' }

  return (
    <PublicTouchFrame
      title="继续打印任务"
      sub="只列你名下没办完的打印任务。继续回到这一单原来那一步，不重新建单。"
      eyebrow="打印"
      status={status}
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      navCurrent="profile"
      screen="session-resume"
      dock={(
        <footer className="qxt-dock">
          <button type="button" className="qxt-btn qxt-btn-sec" onClick={() => navigate('/')}>返回首页</button>
          {guest ? (
            <button type="button" className="qxt-btn qxt-btn-pri qxt-wide" data-testid="session-resume-primary" onClick={goLogin}>
              去登录
            </button>
          ) : screen === 'unavailable' || screen === 'list' ? (
            <button type="button" className="qxt-btn qxt-btn-pri qxt-wide" data-testid="session-resume-primary" onClick={reload}>
              重新读取列表
            </button>
          ) : (
            <button type="button" className="qxt-btn qxt-btn-pri qxt-wide" data-testid="session-resume-primary" onClick={() => navigate('/print-scan')}>
              去打印扫描
            </button>
          )}
        </footer>
      )}
    >
      {guest ? (
        <div className="qxp-grow" data-screen="session-resume" data-state="guest" data-testid="session-resume-state-guest">
          <div className="qxp-card">
            <p className="qxp-k">先登录，再看你的任务</p>
            <p className="qxp-note">还没登录。登录之后才能看到你名下没办完的打印。登录成功会回到这一页，不重新建单。</p>
          </div>
          <p className="qxp-k">登录后在这一页能</p>
          <div className="sr-recs">
            <div className="qxp-hit"><span><b>看没办完的打印</b><small>只列还没办完的，已经完成的不在这里</small></span></div>
            <div className="qxp-hit"><span><b>接着付款或取件</b><small>回到这一单原来那一步。这一页不判定付成没有</small></span></div>
            <div className="qxp-hit"><span><b>不能继续的会写原因</b><small>按钮会停住，并写明原因，不写价钱</small></span></div>
          </div>
          <p className="qxp-k">不登录也能办</p>
          <div className="qxp-pair">
            <button type="button" className="qxp-card" onClick={() => navigate('/print-scan')}>
              <p className="qxp-k">打印与扫描</p>
              <p className="qxp-note">上传文件或扫描原件，不用登录也能开始</p>
              <span className="qxp-art"><PublicArt kind="stack" /></span>
            </button>
            <button type="button" className="qxp-card" onClick={() => navigate('/print/pickup-claim')}>
              <p className="qxp-k">到机码</p>
              <p className="qxp-note">手机上已经下过的单，凭码继续</p>
              <span className="qxp-art"><PublicArt kind="phone" /></span>
            </button>
          </div>
          <button type="button" className="qxp-hit" onClick={() => navigate('/help')}>
            <span><b>帮助</b><small>常见问题。服务电话读得到时写在帮助页上</small></span>
          </button>
        </div>
      ) : (
        <SessionResumeView
          screen={screen}
          tasks={tasks}
          onContinue={continueTask}
          onExit={(route) => navigate(route)}
        />
      )}
    </PublicTouchFrame>
  )
}
