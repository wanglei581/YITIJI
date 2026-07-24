import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  CheckIcon,
  CircleIcon,
  ClockIcon,
  FileTextIcon,
  ScanIcon,
  XCircleIcon,
} from 'lucide-react'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import type { ScanSessionFileView } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { cancelScanSession, getScanSessionStatus } from '../../services/api/scanTasks'
import { ApiHttpError } from '../../services/api/httpAdapter'
import './styles/scan-fusion.css'

type ScanType = 'resume' | 'id' | 'document'

interface LocationState {
  scanTaskId?: string
  scanType?: ScanType
  controlToken?: string
}

const POLL_INTERVAL_MS = 3000

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  resume: '简历扫描',
  id: '证件扫描',
  document: '普通文档',
}

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
  const [elapsed, setElapsed] = useState('00:00')
  const startedAtRef = useRef(Date.now())
  const cancellingRef = useRef(false)

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
    <KioskPageFrame className="w2-scan-page">
      <div data-w2-page="scan-progress" className="w2-scan-shell">
        <KioskPageHeader title="等待扫描完成" description="请在打印机上完成操作，本页每 3 秒自动检测结果" aside={<span className="w2-scan-status-chip is-busy"><span />任务进行中</span>} />

      <div className="w2-scan-steps" aria-label="扫描流程">
        {['选择类型', '扫描指引', '扫描中', '完成'].map((label, index) => (
          <div key={label} className={index < 2 ? 'is-done' : index === 2 ? 'is-active' : ''}><span>{index < 2 ? <CheckIcon /> : index + 1}</span>{label}</div>
        ))}
      </div>

      <main className="w2-scan-content w2-scan-two-column">
        <section className="w2-scan-waiting-card">
          <span className="w2-scan-pulse"><ScanIcon /></span>
          <h2>等待打印机端扫描完成</h2>
          <p>
            扫描完成后会自动进入结果页，请勿离开；<br />
            如打印机仍在进纸，请等待整叠原件全部扫完
          </p>
          {error && <KioskStatePanel compact tone="error" title="暂时无法更新扫描状态" description={`${error}；系统会继续自动重试。`} icon={<AlertCircleIcon />} />}
        </section>

        <aside className="w2-scan-sidebar">
          <section className="w2-scan-info-card">
            <h2>任务信息</h2>
            {[
              ['扫描类型', SCAN_TYPE_LABELS[scanType]],
              ['任务编号', scanTaskId ?? '未创建'],
              ['开始等待', `已等待 ${elapsed}`],
              ['输出格式', 'PDF（自动生成）'],
            ].map(([key, value]) => (
              <div key={key}><span>{key}</span><b>{value}</b></div>
            ))}
          </section>

          <section className="w2-scan-progress-list">
            <h2>流程说明 <small>实际进度以打印机端为准</small></h2>
            {[
              ['任务已创建', '本机已就绪，等待打印机端发起', 'done'],
              ['等待扫描回传', '打印机扫描并回传文件中', 'active'],
              ['生成扫描文件', '回传完成后自动生成 PDF', 'pending'],
              ['进入结果页', '选择打印、保存或 AI 识别', 'pending'],
            ].map(([title, copy, state]) => (
              <div key={title} data-state={state}>
                <span>
                  {state === 'done' ? <CheckIcon className="h-5 w-5" /> : state === 'active' ? <CircleIcon className="h-5 w-5 fill-current" /> : <FileTextIcon className="h-5 w-5" />}
                </span>
                <div><b>{title}</b><small>{copy}</small></div>
              </div>
            ))}
          </section>

          <p className="w2-scan-warning"><AlertCircleIcon />扫描中请勿翻动或抽拉原件；任务超时未收到结果会提示重新开始。</p>
        </aside>
      </main>

      <KioskActionBar leading={<span className="w2-scan-action-note"><ClockIcon />已等待 {elapsed} · 系统会持续自动检查</span>}>
        <Button variant="secondary" size="lg" className="w2-scan-cancel" onClick={handleCancel}>
          <XCircleIcon />取消扫描
        </Button>
      </KioskActionBar>
      </div>
    </KioskPageFrame>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
