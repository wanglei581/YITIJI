import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AlertCircleIcon, XCircleIcon } from 'lucide-react'
import type { ScanSessionFileView } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { cancelScanSession, getScanSessionStatus } from '../../services/api/scanTasks'
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

export function ScanProgressPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as LocationState
  const scanTaskId = state.scanTaskId
  const scanType = state.scanType ?? 'document'
  // controlToken 只经由 router state 在内存中传递（不落 localStorage/sessionStorage），
  // 刷新本页会丢失、必须回 /scan/start 重新发起——这是刻意的，见 B1-8 任务说明。
  const controlToken = state.controlToken

  const hasTaskIdentity = Boolean(scanTaskId && controlToken)
  const pollFailsRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState('00:00')
  const [busyPhase, setBusyPhase] = useState<ScanBusyPhase>('active')
  const [pollInFlight, setPollInFlight] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [polls, setPolls] = useState(0)
  const startedAtRef = useRef(Date.now())
  const cancellingRef = useRef(false)
  const pollNowRef = useRef<() => void>(() => undefined)

  useBusyLock(hasTaskIdentity && busyPhase === 'active')

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(formatElapsed(startedAtRef.current)), 1000)
    setElapsed(formatElapsed(startedAtRef.current))
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!scanTaskId || !controlToken) {
      navigate('/scan/start', { replace: true })
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
          navigate('/scan/result', {
            replace: true,
            state: { scanType, success: true, outcome: 'completed', file: buildResultFileState(status.file) },
          })
          return
        }
        if (status.status === 'completed' && !status.file) {
          setBusyPhase('terminal')
          navigate('/scan/result', {
            replace: true,
            state: { scanType, success: false, outcome: 'completed-no-file', reason: '扫描已完成但未拿到文件，请重新扫描' },
          })
          return
        }
        if (Date.now() - startedAtRef.current > MAX_SCAN_POLL_MS) {
          setBusyPhase('terminal')
          navigate('/scan/result', { replace: true, state: { scanType, success: false, outcome: 'expired', reason: '扫描超时，请返回重新开始' } })
          return
        }
        if (status.status === 'expired') {
          setBusyPhase('terminal')
          navigate('/scan/result', { replace: true, state: { scanType, success: false, outcome: 'expired', reason: '扫描超时，请返回重新开始' } })
          return
        }
        if (status.status === 'failed') {
          setBusyPhase('terminal')
          navigate('/scan/result', { replace: true, state: { scanType, success: false, outcome: 'failed', reason: status.errorMessage ?? '扫描处理失败，请重试' } })
          return
        }
        if (status.status === 'cancelled') {
          setBusyPhase('terminal')
          navigate('/scan/start', { replace: true })
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
            navigate('/scan/result', { replace: true, state: { scanType, success: false, outcome: 'failed', reason: '长时间无法查询扫描状态，请联系工作人员或重新开始' } })
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
      navigate('/scan/start', { replace: true })
    } catch (err) {
      const code = err instanceof ApiHttpError ? err.code : undefined
      if (code === 'SCAN_TASK_ALREADY_COMPLETED') {
        try {
          const latest = await getScanSessionStatus(scanTaskId, controlToken, getToken())
          if (latest.status === 'completed' && latest.file) {
            setBusyPhase('terminal')
            navigate('/scan/result', {
              replace: true,
              state: { scanType, success: true, outcome: 'completed', file: buildResultFileState(latest.file) },
            })
            return
          }
        } catch {
          // 补查状态也失败了,落到下面的默认 fallback
        }
      }
      setBusyPhase('terminal')
      navigate('/scan/start', { replace: true })
    }
  }

  const workbenchState = cancelling
    ? 'cancelling'
    : pollInFlight
      ? 'polling'
      : error
        ? 'poll-failed'
        : 'waiting-delivery'
  const status = cancelling
    ? { tone: 'unknown' as const, label: '正在发送取消请求' }
    : pollInFlight
      ? { tone: 'unknown' as const, label: '正在查询服务端' }
      : error
        ? { tone: 'warn' as const, label: '查状态失败 · 不改判' }
        : { tone: 'unknown' as const, label: '等待文件回传' }

  return (
    <ScanWorkbenchShell
      page="scan-progress"
      state={workbenchState}
      title="等待扫描完成"
      subtitle="请在打印机面板完成扫描到本机接收目录；本页每 3 秒自动检测结果"
      status={status}
      facts={['面板扫完就回到这台屏幕：本机每隔几秒自动查一次，有结果会自动切过去。']}
      ctabar={
        <ScanCta
          reason={
            cancelling
              ? '正在等取消回执 —— 这一刻既不说已取消，也不说已完成'
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
          <button
            type="button"
            className="qx-btn"
            data-variant="primary"
            disabled={cancelling || pollInFlight}
            onClick={() => pollNowRef.current()}
          >
            立即检查
          </button>
        </ScanCta>
      }
    >
      <ScanStatusPanel
        tone={error ? 'warn' : 'info'}
        icon={error ? AlertCircleIcon : undefined}
        title={
          cancelling
            ? '正在发送取消请求'
            : pollInFlight
              ? '正在查询服务端'
              : error
                ? '查状态失败，任务仍按进行中处理'
                : '正在等文件回传'
        }
        breathe={!error}
        chips={[
          { label: error ? '正在自动重试' : '正在自动检查', tone: error ? 'warn' : 'ok' },
          { label: `已查询 ${polls} 次` },
          { label: '没有页级进度' },
        ]}
      >
        {cancelling ? (
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
