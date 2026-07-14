import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AlertCircleIcon, ScanIcon, XCircleIcon } from 'lucide-react'
import { Button } from '@ai-job-print/ui'
import type { ScanSessionFileView } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { cancelScanSession, getScanSessionStatus } from '../../services/api/scanTasks'
import { ApiHttpError } from '../../services/api/httpAdapter'

type ScanType = 'resume' | 'id' | 'document'

interface LocationState {
  scanTaskId?: string
  scanType?: ScanType
  controlToken?: string
}

const POLL_INTERVAL_MS = 2000

/** 组装扫描结果页需要的 file 展示对象，poll 成功路径与取消时的补查路径共用，避免字段映射写两遍。 */
function buildResultFileState(file: ScanSessionFileView) {
  return {
    fileId: file.fileId,
    fileUrl: file.fileUrl,
    name: file.filename,
    size: formatSize(file.sizeBytes),
    mimeType: file.mimeType,
    pages: null,
    format: 'PDF' as const,
  }
}

export function ScanProgressPage() {
  useBusyLock(true)
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as LocationState
  const scanTaskId = state.scanTaskId
  const scanType = state.scanType ?? 'document'
  // controlToken 只经由 router state 在内存中传递（不落 localStorage/sessionStorage），
  // 刷新本页会丢失、必须回 /scan/start 重新发起——这是刻意的，见 B1-8 任务说明。
  const controlToken = state.controlToken

  const [error, setError] = useState<string | null>(null)
  const cancellingRef = useRef(false)

  useEffect(() => {
    if (!scanTaskId || !controlToken) {
      navigate('/scan/start', { replace: true })
      return undefined
    }

    let stopped = false
    let timer: number | undefined

    // 只在上一次 poll 完全落地（成功导航返回，或失败已安排重试）之后才安排下一次，
    // 不用固定 setInterval——网络变慢时固定间隔会让多个请求堆叠并发，而不是退避。
    const scheduleNext = () => {
      if (stopped) return
      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }

    const poll = async () => {
      try {
        const status = await getScanSessionStatus(scanTaskId, controlToken, getToken())
        if (stopped) return
        if (status.status === 'completed' && status.file) {
          navigate('/scan/result', {
            replace: true,
            state: { scanType, success: true, file: buildResultFileState(status.file) },
          })
          return
        }
        if (status.status === 'expired') {
          navigate('/scan/result', { replace: true, state: { scanType, success: false, reason: '扫描超时，请返回重新开始' } })
          return
        }
        if (status.status === 'failed') {
          navigate('/scan/result', { replace: true, state: { scanType, success: false, reason: status.errorMessage ?? '扫描处理失败，请重试' } })
          return
        }
        if (status.status === 'cancelled') {
          navigate('/scan/start', { replace: true })
          return
        }
        scheduleNext()
      } catch (err) {
        if (!stopped) {
          setError(err instanceof Error ? err.message : '查询扫描状态失败')
          scheduleNext()
        }
      }
    }

    void poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTaskId, controlToken])

  const handleCancel = async () => {
    if (!scanTaskId || !controlToken || cancellingRef.current) return
    cancellingRef.current = true
    try {
      await cancelScanSession(scanTaskId, controlToken, getToken())
      navigate('/scan/start', { replace: true })
    } catch (err) {
      // 取消请求送达时任务恰好已经完成(Agent 并发投递刚好抢先完成，后端会返回
      // SCAN_TASK_ALREADY_COMPLETED)：不能静默当作"已取消"丢弃这份真实扫描出的文件——
      // 尤其匿名会话下，这是找回它的唯一机会。补查一次真实状态，能拿到文件就直接进
      // 结果页；查不到、或补查本身失败、或是网络错误等其它取消失败原因，则退回默认
      // 路径，不阻塞用户。
      const code = err instanceof ApiHttpError ? err.code : undefined
      if (code === 'SCAN_TASK_ALREADY_COMPLETED') {
        try {
          const latest = await getScanSessionStatus(scanTaskId, controlToken, getToken())
          if (latest.status === 'completed' && latest.file) {
            navigate('/scan/result', {
              replace: true,
              state: { scanType, success: true, file: buildResultFileState(latest.file) },
            })
            return
          }
        } catch {
          // 补查状态也失败了，退回默认路径，不阻塞用户
        }
      }
      navigate('/scan/start', { replace: true })
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="mb-10 flex h-24 w-24 items-center justify-center rounded-full bg-primary-50">
        <ScanIcon className="h-12 w-12 animate-pulse text-primary-600" />
      </div>

      <h1 className="text-2xl font-bold text-neutral-900">等待打印机端扫描完成</h1>
      <p className="mt-2 text-base text-neutral-500">请在打印机上完成操作，本页会自动检测结果</p>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error-fg">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-10">
        <Button variant="secondary" size="lg" onClick={handleCancel}>
          <XCircleIcon className="mr-2 h-4 w-4" />
          取消扫描
        </Button>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
