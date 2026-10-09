import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { XCircleIcon } from 'lucide-react'
import type { ScanSessionFileView } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { cancelScanSession, getScanSessionStatus } from '../../services/api/scanTasks'
import {
  noteScanTaskStatusFromServer,
  revokeCreatedScanSession,
  revokeLiveScanSession,
} from './scanSessionRevoke'
import {
  acknowledgeScanDelivery,
  SCAN_ACK_PENDING_NOTICE,
  SCAN_ACK_REFUSED_PROGRESS_REASON,
  type ScanAckState,
} from './scanDeliveryAck'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { helpNeededLine } from '../../copy/unattendedCopy'
import { formatLabelFromMime } from './scanOutputFormat'
import { ScanCta, ScanWorkbenchShell } from './ScanWorkbenchChrome'
import { ScanProgressSections } from './ScanProgressSections'
import { type ScanType } from './scanWorkbench'
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
   * 服务端最近一次说的「仍在进行」是哪一种。只用来**转达**：matched 说明文件已经回到服务端、
   * 还在处理，链路最后一段点亮；它不参与任何判定，也不会让这一屏提前出结果。
   */
  const [lastLiveStatus, setLastLiveStatus] = useState<'waiting' | 'matched' | null>(null)
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
        /* 先记服务端这句话，再看本页还在不在、再据此改屏。终态是这条任务自己的事实，
         * 与本页卸没卸载无关；而下面 cancelled 那一支会推进扫描代次，挂载时一起发出、
         * 还没回话的那次确认随后落地时，靠这一笔认出「服务端已经结束了它」，
         * 不再补发 DELETE（见 scanSessionRevoke 的 endedByServer）。 */
        noteScanTaskStatusFromServer(scanTaskId, status.status)
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
        setLastLiveStatus(status.status === 'matched' ? 'matched' : 'waiting')
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
              reason: `长时间无法查询扫描状态，请重新开始。${helpNeededLine()}。`,
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
      const cancelled = await cancelScanSession(scanTaskId, controlToken, getToken())
      // 取消回执也是服务端说的终态：确认若还在路上，它回来时不许再补一次 DELETE。
      noteScanTaskStatusFromServer(scanTaskId, cancelled.status)
      setBusyPhase('terminal')
      returnToStart()
    } catch (err) {
      const code = err instanceof ApiHttpError ? err.code : undefined
      if (code === 'SCAN_TASK_ALREADY_COMPLETED') {
        /* 这个码本身就是服务端报的终态：cancel() 两处都只在 status === 'completed' 时抛，
         * 而 completed 是吸收态。所以在补查**之前**就记下 —— 补查拿不到回话时下面会
         * 回到 start、推进代次，那次还在路上的确认落地时不许再为它补一发 DELETE。
         * （SCAN_TASK_CANCEL_CONFLICT 不在此列：它可能来自 CAS 撞车，那时任务正是 matched，
         * 还撤得掉，见 scanSessionRevoke 的 ScanRevokeVerdict 注释。） */
        noteScanTaskStatusFromServer(scanTaskId, 'completed')
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
  const matched = deliveryAcked && !error && lastLiveStatus === 'matched'
  /* 稿 18：只有系统确认收到文件时才显示完成，不替用户猜中间状态。 */
  const chainHint = cancelling
    ? '取消也可能来不及，以系统为准'
    : !deliveryAcked
      ? '授权确认前，请先不要按开始'
      : pollInFlight
        ? '查询回来之前，这一屏不改判'
        : error
          ? '这次没问到，继续等待下一次查询'
          : matched
            ? '系统已收到文件，可以回来确认'
            : '系统还没收到文件，继续等待'
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
        ? { tone: 'unknown' as const, label: '正在查询系统' }
        : error
          ? { tone: 'warn' as const, label: '查状态失败 · 不改判' }
          : { tone: 'unknown' as const, label: '等待文件回传' }

  return (
    <ScanWorkbenchShell
      page="scan-progress"
      state={workbenchState}
      layout="spread"
      title={deliveryAcked ? '等待打印机端扫描完成' : '正在确认投递授权'}
      subtitle={deliveryAcked
        ? '请在打印机面板完成扫描；本页每 3 秒自动检测结果'
        : '还没确认这台机器可以收这一场的文件；确认之前请先别在面板上按开始'}
      status={status}
      facts={deliveryAcked
        ? ['面板扫完就回到这台屏幕：本机每隔几秒自动查一次，有结果会自动切过去。']
        : [SCAN_ACK_PENDING_NOTICE]}
      ctabar={
        <ScanCta
          reserveReason
          reason={
            cancelling
              ? '正在等取消结果 —— 这一刻既不说已取消，也不说已完成'
              : !deliveryAcked
                ? '没拿到投递授权前别在面板上按开始 —— 这一刻扫出来的文件不会交到这一场'
                : pollInFlight
                  ? '正在等这次查询的结果 —— 这一刻不改判任务状态'
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
      <ScanProgressSections
        scanType={scanType}
        elapsed={elapsed}
        error={error}
        polls={polls}
        matched={matched}
        cancelling={cancelling}
        deliveryAcked={deliveryAcked}
        ackRetryable={ackRetryable}
        pollInFlight={pollInFlight}
        chainHint={chainHint}
      />
    </ScanWorkbenchShell>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
