import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { PairCard, Hit, K, Card, Note } from '../public-touch/PublicBlocks'
import { IllusPhone, IllusStack } from '../public-touch/PublicIllus'
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

/**
 * 继续打印任务（/session-resume）。触屏稿 session-resume：
 * 未登录 → 停在本页写清「先登录再看」，登录成功回到本页；已登录 → 读取中 / 列表 / 空 / 读不到。
 * 继续只回到这一单原来那一步：待付款去收银台，其余去打印进度；不重新建单。
 */
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
  const reading = !ready || (loading && !guest)
  const status = reading
    ? { tone: 'unknown' as const, label: '正在读取' }
    : guest
      ? { tone: 'unknown' as const, label: '先登录再读列表' }
      : screen === 'unavailable'
        ? { tone: 'warn' as const, label: '没读到未完成任务' }
        : screen === 'empty'
          ? { tone: 'ok' as const, label: '名下没有未完成任务' }
          : { tone: 'warn' as const, label: `共 ${tasks.length} 条` }
  const title = reading
    ? '正在读取你的任务'
    : guest
      ? '未登录会先去登录'
      : screen === 'unavailable'
        ? '没读到未完成任务'
        : screen === 'empty'
          ? '名下没有未完成任务'
          : `共 ${tasks.length} 条`
  const sub = guest
    ? '这一页只列你名下没办完的打印任务。'
    : screen === 'list'
      ? '只列你名下没办完的打印任务。继续回到这一单原来那一步，不重新建单。'
      : '只列你名下没办完的打印任务。'

  const home = () => navigate('/')
  const dock = guest ? (
    <QxTouchDock onBack={home} backLabel="返回" primary={{ label: '去登录', kind: 'pri', noArrow: true, onClick: goLogin, testId: 'session-resume-primary' }} />
  ) : reading ? (
    <QxTouchDock onBack={home} backLabel="返回首页" primary={{ label: '正在读取', kind: 'pri', noArrow: true, disabled: true, onClick: () => undefined, testId: 'session-resume-primary' }} />
  ) : screen === 'empty' ? (
    <QxTouchDock onBack={home} backLabel="返回首页" primary={{ label: '去打印扫描', kind: 'pri', noArrow: true, onClick: () => navigate('/print-scan'), testId: 'session-resume-primary' }} />
  ) : (
    <QxTouchDock
      onBack={home}
      backLabel="返回首页"
      mid={<button type="button" className="qxt-btn qxt-btn-sec qxt-fill" onClick={() => navigate('/print-scan')}>去打印扫描</button>}
      primary={{ label: '重新读取', kind: 'pri', noArrow: true, onClick: reload, testId: 'session-resume-primary' }}
    />
  )

  return (
    <PublicTouchFrame
      title={title}
      sub={sub}
      eyebrow="继续打印任务"
      status={status}
      back={{ label: '返回首页', onBack: home }}
      navCurrent="profile"
      screen="session-resume"
      dock={dock}
    >
      {guest ? (
        <div className="qxp-grow" data-screen="session-resume" data-state="guest" data-testid="session-resume-state-guest">
          <Card>
            <K>先登录，再看你的任务</K>
            <Note>还没登录。登录之后才能看到你名下没办完的打印。登录成功会回到这一页，不重新建单。</Note>
          </Card>
          <K>登录后在这一页能</K>
          <div className="qxp-col">
            <Hit title="看没办完的打印" sub="只列还没办完的，已经完成的不在这里" />
            <Hit title="接着付款或取件" sub="回到这一单原来那一步。这一页不判定付成没有" />
            <Hit title="不能继续的会写原因" sub="按钮会停住，并写明原因，不写价钱" />
          </div>
          <K>不登录也能办</K>
          <div className="qxp-pair qxp-pair-grow">
            <PairCard title="打印与扫描" desc="上传文件或扫描原件，不用登录也能开始" art={<IllusStack w={200} n={3} />} onClick={() => navigate('/print-scan')} />
            <PairCard title="到机码" desc="手机上已经下过的单，凭码继续" art={<IllusPhone w={150} />} onClick={() => navigate('/print/pickup-claim')} />
          </div>
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
