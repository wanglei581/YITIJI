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
  const [statusLabel, setStatusLabel] = useState('等待扫描回传')
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
        setStatusLabel(
          status.status === 'completed'
            ? '扫描已完成'
            : status.status === 'failed'
              ? '扫描失败'
              : status.status === 'expired'
                ? '任务已超时'
                : '等待扫描回传',
        )
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
    <div className="flex h-full flex-col bg-canvas px-6 py-5 text-neutral-900">
      <header className="flex h-[72px] shrink-0 items-center justify-between rounded-lg bg-dark px-6 text-surface shadow-sm">
        <div>
          <b className="block text-[21px] font-bold">就业服务大厅 · 01号机</b>
          <span className="mt-1 block text-sm text-neutral-100">AI求职打印服务终端</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base text-neutral-100">2026年7月17日 10:28</span>
          <span className="inline-flex h-10 items-center gap-2 rounded-full bg-warning-bg px-4 text-base font-semibold text-warning-fg">
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            扫描仪工作中
          </span>
        </div>
      </header>

      <div className="mt-5 flex shrink-0 items-center justify-between gap-5">
        <div>
          <h1 className="font-serif text-[42px] font-black leading-tight tracking-normal">等待扫描完成</h1>
          <p className="mt-1 text-xl text-neutral-500">请在打印机上完成操作，本页每 3 秒自动检测结果</p>
        </div>
        <span className="inline-flex h-11 items-center gap-2 rounded-full bg-primary-50 px-4 text-lg font-semibold text-primary-700">
          <ClockIcon className="h-5 w-5" />
          任务进行中
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-3 rounded-lg border border-neutral-200 bg-surface px-5 py-4">
        {['选择类型', '扫描指引', '扫描中', '完成'].map((label, index) => (
          <div key={label} className="contents">
            <div className={['flex items-center gap-2 text-lg font-semibold', index < 3 ? 'text-primary-700' : 'text-neutral-400'].join(' ')}>
              <span className={['grid h-9 w-9 place-items-center rounded-full text-base font-bold', index < 2 ? 'bg-primary-600 text-surface' : index === 2 ? 'bg-primary-50 text-primary-700 ring-2 ring-primary-600' : 'bg-neutral-100 text-neutral-400'].join(' ')}>
                {index < 2 ? <CheckIcon className="h-5 w-5" /> : index + 1}
              </span>
              <span>{label}</span>
            </div>
            {index < 3 && <div className={['h-px', index < 2 ? 'bg-primary-600' : 'bg-neutral-200'].join(' ')} />}
          </div>
        ))}
      </div>

      <main className="mt-4 flex min-h-0 flex-1 gap-5">
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-5 rounded-lg border border-primary-200 bg-surface p-8 shadow-sm">
          <span className="grid h-[150px] w-[150px] place-items-center rounded-full bg-primary-50 text-primary-700 shadow-[0_0_0_14px_rgba(31,158,134,0.08)]">
            <ScanIcon className="h-[74px] w-[74px] animate-pulse" />
          </span>
          <div className="font-serif text-[42px] font-black tracking-normal">等待打印机端扫描完成</div>
          <p className="text-center text-[21px] leading-relaxed text-neutral-500">
            扫描完成后会自动进入结果页，请勿离开；<br />
            如打印机仍在进纸，请等待整叠原件全部扫完
          </p>
          <div className="flex gap-3" aria-hidden="true">
            <i className="h-3.5 w-3.5 rounded-full bg-primary-600 opacity-30" />
            <i className="h-3.5 w-3.5 rounded-full bg-primary-600 opacity-60" />
            <i className="h-3.5 w-3.5 rounded-full bg-primary-600" />
          </div>
          {error && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-base text-error-fg">
              <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
              {error}
            </div>
          )}
        </section>

        <aside className="flex w-[420px] shrink-0 flex-col gap-4">
          <section className="rounded-lg border border-primary-200 bg-surface p-5 shadow-sm">
            <b className="mb-2 block text-xl font-bold">任务信息</b>
            {[
              ['扫描类型', SCAN_TYPE_LABELS[scanType]],
              ['任务编号', scanTaskId ?? '未创建'],
              ['开始等待', `已等待 ${elapsed}`],
              ['当前状态', statusLabel],
              ['输出格式', 'PDF（自动生成）'],
            ].map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-3 border-b border-dashed border-neutral-200 py-2.5 last:border-b-0">
                <span className="text-[17.5px] text-neutral-500">{key}</span>
                <span className="text-right text-[18.5px] font-semibold text-neutral-900">{value}</span>
              </div>
            ))}
          </section>

          <section className="flex flex-1 flex-col rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
            <b className="mb-2 block text-xl font-bold">
              流程说明 <span className="text-[15px] font-normal text-neutral-500">实际进度以打印机端为准</span>
            </b>
            {[
              ['任务已创建', '本机已就绪，等待打印机端发起', 'done'],
              ['等待扫描回传', '打印机扫描并回传文件中', 'active'],
              ['生成扫描文件', '回传完成后自动生成 PDF', 'pending'],
              ['进入结果页', '选择打印、保存或 AI 识别', 'pending'],
            ].map(([title, copy, state]) => (
              <div key={title} className="flex flex-1 items-center gap-3 border-b border-dashed border-neutral-200 py-3 last:border-b-0">
                <span className={['grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full border-2', state === 'done' ? 'border-primary-600 bg-primary-600 text-surface' : state === 'active' ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-surface text-neutral-400'].join(' ')}>
                  {state === 'done' ? <CheckIcon className="h-5 w-5" /> : state === 'active' ? <CircleIcon className="h-5 w-5 fill-current" /> : <FileTextIcon className="h-5 w-5" />}
                </span>
                <div>
                  <b className={['block text-[19px] font-bold', state === 'active' ? 'text-primary-700' : 'text-neutral-900'].join(' ')}>{title}</b>
                  <span className="mt-0.5 block text-[15.5px] text-neutral-500">{copy}</span>
                </div>
              </div>
            ))}
          </section>

          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-bg px-5 py-4 text-base leading-relaxed text-warning-fg">
            <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
            扫描中请勿翻动或抽拉原件；任务超时未收到结果会提示重新开始。
          </div>
        </aside>
      </main>

      <div className="mt-5 flex h-[76px] shrink-0 items-center gap-4 border-t border-neutral-200 bg-canvas pt-4">
        <Button variant="secondary" size="lg" className="h-14 border-error/40 px-7 text-lg text-error-fg" onClick={handleCancel}>
          <XCircleIcon className="mr-2 h-5 w-5" />
          取消扫描
        </Button>
        <span className="flex-1" />
        <span className="text-lg text-neutral-500">取消后本次任务作废；若打印机恰好已完成，系统会自动带你进入结果页</span>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
