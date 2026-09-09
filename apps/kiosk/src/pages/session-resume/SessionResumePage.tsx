import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { getPendingTasks, type PendingTask } from '../../services/api/pendingTasks'
import { SessionResumeView } from './SessionResumeView'
import {
  deriveResumeScreen,
  resumeContinueRoute,
  resumeVerdict,
} from './sessionResumeModel'
import './styles/session-resume-qx.css'

export function SessionResumePage() {
  const navigate = useNavigate()
  const { ready, isLoggedIn, getToken } = useAuth()
  const [tasks, setTasks] = useState<PendingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = () => {
    const token = getToken()
    if (!isLoggedIn || !token) {
      navigate('/login', { replace: true, state: { from: '/session-resume' } })
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
      navigate('/login', { replace: true, state: { from: '/session-resume' } })
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

  const status = screen === 'loading'
    ? { tone: 'unknown' as const, label: '正在读取' }
    : screen === 'unavailable'
      ? { tone: 'bad' as const, label: '没读到未完成任务' }
      : screen === 'empty'
        ? { tone: 'ok' as const, label: '名下没有未完成任务' }
        : { tone: 'warn' as const, label: '继续打印任务' }

  return (
    <QxPageFrame
      title="继续打印任务"
      subtitle="只列你名下没办完的打印任务。继续回到这一单原来那一步，不重新建单。"
      status={status}
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      ctabar={
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/')}>返回首页</button>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print-scan')}>去打印扫描</button>
          {screen === 'unavailable' || screen === 'list' ? (
            <button type="button" className="qx-btn" data-variant="primary" data-testid="session-resume-primary" onClick={reload}>
              重新读取列表
            </button>
          ) : (
            <button type="button" className="qx-btn" data-variant="primary" data-testid="session-resume-primary" onClick={() => navigate('/print-scan')}>
              去打印扫描
            </button>
          )}
        </>
      }
    >
      <SessionResumeView
        screen={screen}
        tasks={tasks}
        onContinue={continueTask}
        onExit={(route) => navigate(route)}
      />
    </QxPageFrame>
  )
}
