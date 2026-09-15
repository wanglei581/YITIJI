import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AlertCircleIcon, XCircleIcon } from 'lucide-react'
import type { ScanSessionFileView } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { cancelScanSession, getScanSessionStatus } from '../../services/api/scanTasks'
import { revokeCreatedScanSession, revokeLiveScanSession } from './scanSessionRevoke'
import {
  acknowledgeScanDelivery,
  SCAN_ACK_PENDING_NOTICE,
  SCAN_ACK_REFUSED_PROGRESS_REASON,
  type ScanAckState,
} from './scanDeliveryAck'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { SCAN_OUTPUT_FORMAT_PENDING, formatLabelFromMime } from './scanOutputFormat'
import {
  ScanChain,
  ScanCta,
  ScanKvCard,
  ScanNoteCard,
  ScanPlan,
  ScanSec,
  ScanStatusPanel,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import {
  patchScanWorkbenchSession,
  readScanWorkbenchSession,
  scanLifecycleGeneration,
  type ScanResultSnapshot,
} from './scanWorkbenchSession'

type ScanBusyPhase = 'active' | 'terminal'

interface LocationState {
  scanTaskId?: string
  scanType?: ScanType
  controlToken?: string
}

const POLL_INTERVAL_MS = 3000
// 扫描轮询兜底：总时长 10 分钟、连续失败 20 次即判失败，不再无限轮询（MSC-08）
const MAX_SCAN_POLL_MS = 10 * 60 * 1000
const MAX_SCAN_POLL_FAILS = 20

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`
}

/** 组装扫描结果页需要的 file 展示对象，poll 成功路径与取消时的补查路径共用，避免字段映射写两遍。 */
function buildResultFileState(file: ScanSessionFileView) {
  return {
    fileId: file.fileId,
    fileUrl: file.fileUrl,
    name: file.filename,
    size: formatSize(file.sizeBytes),
    mimeType: file.mimeType,
    pages: null,
    format: formatLabelFromMime(file.mimeType),
  }
}

export function ScanProgressPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as LocationState
  const stored = readScanWorkbenchSession()
  const scanTaskId = stored?.live?.scanTaskId ?? state.scanTaskId
  const scanType = stored?.scanType ?? state.scanType ?? 'document'
  // controlToken 优先读本次一体机会话（kioskSensitiveSession 清场会清掉），
  // 其次才是 router state。不上屏、不进链接、不进 localStorage。
  const controlToken = stored?.live?.controlToken ?? state.controlToken

  const hasTaskIdentity = Boolean(scanTaskId && controlToken)
  const pollFailsRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState('00:00')
  const [busyPhase, setBusyPhase] = useState<ScanBusyPhase>('active')
  const [pollInFlight, setPollInFlight] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [polls, setPolls] = useState(0)
  /**
   * 这一场在服务端拿到投递授权了没有（见 scanDeliveryAck）。
   *
   * 本页几乎总是从设置页确认成功之后走过来的，但**不能据此假设**：看门狗整页重载、
   * 从别处回到本阶段都会让本页凭 sessionStorage 里那份 live 直接挂起来，
   * 而本机并不知道当初确认过没有。ACK 是幂等的，所以挂载时再确认一次永远是对的。
   *
   * 没确认之前这一屏绝不能说「请在打印机面板完成扫描」：那一刻服务端不肯把文件投给
   * 这一场，扫出来的纸不会进用户的记录，人会在机器前白等到轮询上限。
   */
  const [ackState, setAckState] = useState<ScanAckState>('pending')
  const startedAtRef = useRef(Date.now())
  const cancellingRef = useRef(false)
  const pollNowRef = useRef<() => void>(() => undefined)

  const returnToStart = () => {
    patchScanWorkbenchSession({ stage: 'start', live: undefined, result: undefined })
    if (onGoStage) onGoStage('start')
    else navigate('/scan?stage=start', { replace: true })
  }

  /**
   * @param localGiveUp 本机放弃（轮询到点 / 连续查不动），**不是**服务端给的终态。
   *   服务端那个任务这时多半还停在 waiting：不撤掉就会留下一个孤儿任务，把这台机器
   *   下一次面板扫描出来的文件投给已经走掉的这一位。
   *   服务端自己报的 completed / failed / expired / cancelled 不走这条 —— 那些任务
   *   已经结束，再 DELETE 只会换回 400 / 404。
   */
  const finishWithResult = (result: ScanResultSnapshot, localGiveUp = false) => {
    if (localGiveUp) revokeLiveScanSession(getToken())
    // live 保持原样（和服务端终态路径一致）：这一帧本页还挂着，把 live 抹掉会让下面那个
    // 依赖 scanTaskId 的 effect 立刻判「没有任务身份」并跳回 start，顺手把刚写的 result
    // 也擦掉 —— 用户就看不到「为什么不等了」。撤销之后 result 快照本身就是「别再 DELETE」
    // 的判据（见 scanSessionRevoke 的 hasResult 分支）。
    patchScanWorkbenchSession({
      stage: 'result',
      scanType,
      result,
    })
    if (onGoStage) {
      onGoStage('result')
      return
    }
    navigate('/scan?stage=result', { replace: true, state: { scanType, ...result } })
  }

  useBusyLock(hasTaskIdentity && busyPhase === 'active')

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(formatElapsed(startedAtRef.current)), 1000)
    setElapsed(formatElapsed(startedAtRef.current))
    return () => window.clearInterval(timer)
  }, [])

  /* 挂载即（重新）确认投递授权。幂等：已经确认过的会话，服务端原样回那一刻的时间戳。 */
  useEffect(() => {
    if (ackState !== 'pending' || !scanTaskId || !controlToken) return undefined
    const credentials = { scanTaskId, controlToken }
    const ackGeneration = scanLifecycleGeneration()
    const memberToken = getToken()
    let stale = false
    void acknowledgeScanDelivery(credentials, memberToken).then((outcome) => {
      /* 代次变了 = 清场 / 退出 / 离开整条扫描流程。那几条路自己会撤这一场，但它们撤的
       * 那一刻本机登记可能已经清空；而这一次确认**可能刚刚把任务变成可投递的**，
       * 所以这里再撤一次兜底。
       *
       * 意图必须是 'ack-compensation'：离开那条路径多半已经按本机登记发过一次
       * DELETE，按普通去重这一次会被直接挡掉。而「ACK 成功」正是那一次没生效的证据
       * （生效了服务端只会回 409 SCAN_TASK_ACK_NOT_ALLOWED），同时 deliveryAckedAt
       * 已经非空 —— 60 秒未确认回收器收不到它，它会一直可投递到自然过期，
       * 接走下一位用户在面板上扫出来的文件。上限见 scanSessionRevoke 的
       * REVOKE_ATTEMPT_CAP：补偿只许一次，仍然不重试、不阻塞。 */
      if (scanLifecycleGeneration() !== ackGeneration) {
        revokeCreatedScanSession(credentials, memberToken, 'ack-compensation')
        return
      }
      if (stale) return
      if (outcome.ok) {
        setAckState('acked')
        return
      }
      if (outcome.definitive) {
        // 服务端明确不认这一场：撤掉它（localGiveUp）并如实落一个失败结果，
        // 不在这一屏继续假装还在等文件。
        setBusyPhase('terminal')
        finishWithResult({ outcome: 'failed', success: false, reason: SCAN_ACK_REFUSED_PROGRESS_REASON }, true)
        return
      }
      setAckState('retryable')
    })
    return () => { stale = true }
    // finishWithResult 每帧重建，进依赖会让这段反复重跑；确认只由 ackState 与任务身份驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ackState, scanTaskId, controlToken])

  useEffect(() => {
    if (!scanTaskId || !controlToken) {
      patchScanWorkbenchSession({ stage: 'start', live: undefined, result: undefined })
      if (onGoStage) onGoStage('start')
      else navigate('/scan?stage=start', { replace: true })
      return undefined
    }

    let stopped = false
    let timer: number | undefined
    let inFlight = false

    const scheduleNext = () => {
      if (stopped) return
      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }

    const poll = async () => {
      if (stopped || inFlight || cancellingRef.current) return
      inFlight = true
      setPollInFlight(true)
      try {
        const status = await getScanSessionStatus(scanTaskId, controlToken, getToken())
        if (stopped) return
        setPolls((count) => count + 1)
        setError(null)
        if (status.status === 'completed' && status.file) {
          setBusyPhase('terminal')
          finishWithResult({
            outcome: 'completed',
            success: true,
            file: buildResultFileState(status.file),
          })
          return
        }
        if (status.status === 'completed' && !status.file) {
          setBusyPhase('terminal')
          finishWithResult({
            outcome: 'completed-no-file',
            success: false,
            reason: '扫描已完成但未拿到文件，请重新扫描',
          })
          return
        }
        if (Date.now() - startedAtRef.current > MAX_SCAN_POLL_MS) {
          // 本机计时到点，服务端刚刚还说它是进行中：这是本机放弃，不是服务端结束。
          setBusyPhase('terminal')
          finishWithResult({ outcome: 'expired', success: false, reason: '扫描超时，请返回重新开始' }, true)
          return
        }
        if (status.status === 'expired') {
          setBusyPhase('terminal')
          finishWithResult({ outcome: 'expired', success: false, reason: '扫描超时，请返回重新开始' })
          return
        }
        if (status.status === 'failed') {
          setBusyPhase('terminal')
          finishWithResult({
            outcome: 'failed',
            success: false,
            reason: status.errorMessage ?? '扫描处理失败，请重试',
          })
          return
        }
        if (status.status === 'cancelled') {
          setBusyPhase('terminal')
          returnToStart()
          return
        }
        scheduleNext()
      } catch (err) {
        if (!stopped) {
          setError(userMessageOf(err, '查询扫描状态失败，请稍后重试'))
          setPolls((count) => count + 1)
          pollFailsRef.current += 1
          if (pollFailsRef.current >= MAX_SCAN_POLL_FAILS || Date.now() - startedAtRef.current > MAX_SCAN_POLL_MS) {
            setBusyPhase('terminal')
            finishWithResult({
              outcome: 'failed',
              success: false,
              reason: '长时间无法查询扫描状态，请联系工作人员或重新开始',
            }, true)
            return
          }
          scheduleNext()
        }
      } finally {
        inFlight = false
        if (!stopped) setPollInFlight(false)
      }
    }

    pollNowRef.current = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      void poll()
    }

    void poll()
    return () => {
      stopped = true
      pollNowRef.current = () => undefined
      if (timer !== undefined) window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTaskId, controlToken])

  const handleCancel = async () => {
    if (!scanTaskId || !controlToken || cancellingRef.current) return
    cancellingRef.current = true
    setCancelling(true)
    try {
      await cancelScanSession(scanTaskId, controlToken, getToken())
      setBusyPhase('terminal')
      returnToStart()
    } catch (err) {
      const code = err instanceof ApiHttpError ? err.code : undefined
      if (code === 'SCAN_TASK_ALREADY_COMPLETED') {
        try {
          const latest = await getScanSessionStatus(scanTaskId, controlToken, getToken())
          if (latest.status === 'completed' && latest.file) {
            setBusyPhase('terminal')
            finishWithResult({
              outcome: 'completed',
              success: true,
              file: buildResultFileState(latest.file),
            })
            return
          }
        } catch {
          // 补查状态也失败了,落到下面的默认 fallback
        }
      }
      setBusyPhase('terminal')
      returnToStart()
    }
  }

  /* 「可以去面板扫了」的判据只有一个：服务端确认过这一场的投递授权。
   * 没确认之前这一屏不许出现「请在打印机面板完成扫描」那句话 —— 它是假的。 */
  const deliveryAcked = ackState === 'acked'
  const ackRetryable = ackState === 'retryable'
  const workbenchState = cancelling
    ? 'cancelling'
    : !deliveryAcked
      ? 'awaiting-ack'
      : pollInFlight
        ? 'polling'
        : error
          ? 'poll-failed'
          : 'waiting-delivery'
  const status = cancelling
    ? { tone: 'unknown' as const, label: '正在发送取消请求' }
    : !deliveryAcked
      ? ackRetryable
        ? { tone: 'warn' as const, label: '投递授权未确认' }
        : { tone: 'unknown' as const, label: '正在确认投递授权' }
      : pollInFlight
        ? { tone: 'unknown' as const, label: '正在查询服务端' }
        : error
          ? { tone: 'warn' as const, label: '查状态失败 · 不改判' }
          : { tone: 'unknown' as const, label: '等待文件回传' }

  return (
    <ScanWorkbenchShell
      page="scan-progress"
      state={workbenchState}
      title={deliveryAcked ? '等待打印机端扫描完成' : '正在确认投递授权'}
      subtitle={deliveryAcked
        ? '请在打印机面板完成扫描到本机接收目录；本页每 3 秒自动检测结果'
        : '还没确认这台机器可以收这一场的文件；确认之前请先别在面板上按开始'}
      status={status}
      facts={deliveryAcked
        ? ['面板扫完就回到这台屏幕：本机每隔几秒自动查一次，有结果会自动切过去。']
        : [SCAN_ACK_PENDING_NOTICE]}
      ctabar={
        <ScanCta
          reason={
            cancelling
              ? '正在等取消回执 —— 这一刻既不说已取消，也不说已完成'
              : !deliveryAcked
                ? '没拿到投递授权前别在面板上按开始 —— 这一刻扫出来的文件不会投到这一场'
                : pollInFlight
                  ? '正在等这次查询的回执 —— 这一刻不改判任务状态'
                  : undefined
          }
        >
          <button
            type="button"
            className="qx-btn"
            data-variant="ghost"
            disabled={cancelling || pollInFlight}
            onClick={() => void handleCancel()}
          >
            <XCircleIcon aria-hidden />
            取消扫描
          </button>
          {/* 没拿到投递授权时主行动不是「立即检查」——查多少次都不会让它变得可投递。
              这一屏能做的只有再确认一次，所以主行动换成它。 */}
          {deliveryAcked ? (
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              disabled={cancelling || pollInFlight}
              onClick={() => pollNowRef.current()}
            >
              立即检查
            </button>
          ) : (
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              disabled={cancelling || !ackRetryable}
              aria-disabled={cancelling || !ackRetryable}
              onClick={() => setAckState('pending')}
            >
              {ackRetryable ? '再确认一次' : '正在确认投递授权'}
            </button>
          )}
        </ScanCta>
      }
    >
      <ScanStatusPanel
        tone={error || ackRetryable ? 'warn' : 'info'}
        icon={error || ackRetryable ? AlertCircleIcon : undefined}
        title={
          cancelling
            ? '正在发送取消请求'
            : !deliveryAcked
              ? ackRetryable ? '还没确认这台机器能收这份文件' : '正在确认投递授权'
              : pollInFlight
                ? '正在查询服务端'
                : error
                  ? '查状态失败，任务仍按进行中处理'
                  : '正在等文件回传'
        }
        breathe={!error && !ackRetryable}
        chips={deliveryAcked
          ? [
              { label: error ? '正在自动重试' : '正在自动检查', tone: error ? 'warn' : 'ok' },
              { label: `已查询 ${polls} 次` },
              { label: '没有页级进度' },
            ]
          : [
              { label: '会话已建成', tone: 'ok' as const },
              { label: '投递授权未确认', tone: 'warn' as const },
            ]}
      >
        {!deliveryAcked && !cancelling ? (
          <p data-testid="scan-ack-pending-notice">
            这一场<b>已经建成</b>，但服务端还没确认这台机器可以收它的文件。
            没确认之前，面板上扫出来的东西<b>不会</b>投到这一场，所以<b>先别在面板上按开始</b>。
            它也<b>不会</b>被别人收走：没确认的任务对谁都不可投递。
            {ackRetryable ? '上一次确认没成，点右下角「再确认一次」重来。' : '确认通常就是一两秒。'}
          </p>
        ) : cancelling ? (
          <>
            <p>本机正在请求服务端取消这次会话。<b>服务端没回之前，页面不说已取消</b> —— 取消成不成功由服务端定。</p>
            <p>如果这一刻文件刚好投递完成，取消就会来不及，那时以服务端结果为准。</p>
          </>
        ) : pollInFlight ? (
          <>
            <p>本机正在问服务端：这次扫描现在是什么状态。<b>回执没回来之前，这一页不改任何判断</b>。</p>
            <p>查询是一次纯读取：查多少次都不会重扫，服务端不做转换。</p>
          </>
        ) : error ? (
          <>
            <p>这一次查询没拿到服务端回执：<b>{error}</b>。</p>
            <p><b>查不到不等于扫描失败</b> —— 这一页不改判任务状态，还当它在进行中，下次继续查。</p>
          </>
        ) : (
          <>
            <p>面板扫完之后，文件还要经过本机接收和投递才到服务端。<b>这中间没有可显示的张数</b>，所以这里只告诉你服务端最近一次说了什么、已经查过几次。</p>
            <p><b>本机正在自动检查</b>：每隔几秒替你问一次服务端。想马上知道，点右下角「立即检查」就行。</p>
          </>
        )}
      </ScanStatusPanel>
      <ScanSec no="01" title="链路走到哪一段" hint="不是百分比">
        <ScanChain active={-1} />
      </ScanSec>
      <div className="sw-grid2">
        <ScanKvCard
          title="任务信息"
          rows={[
            ['扫描类型', SCAN_TYPE_LABELS[scanType]],
            ['任务编号', scanTaskId ?? '未创建'],
            ['开始等待', `已等待 ${elapsed}`],
            ['输出格式', SCAN_OUTPUT_FORMAT_PENDING],
            ['保存策略', '按设备回传的原格式保存，服务端不做转换'],
          ]}
        />
        <ScanNoteCard title="这一屏现在会做什么" foot="自动检查是一次纯读取：不会重扫，也不会改变服务端那边的任何东西。">
          <ScanPlan items={[
            '本机每隔几秒自动查一次，你什么都不用做。',
            '想马上知道就点「立即检查」，它只是插一次队，不改变结果。',
            '不想扫了就点「取消扫描」，取消成不成由服务端定。',
          ]} />
        </ScanNoteCard>
      </div>
    </ScanWorkbenchShell>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
