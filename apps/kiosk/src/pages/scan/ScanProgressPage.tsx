import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  ScanIcon,
  XCircleIcon,
} from 'lucide-react'
import { useBusyLock } from '../../contexts/KioskBusyContext'

type Step = 'init' | 'scanning' | 'generating'
type ScanType = 'resume' | 'id' | 'document'
type Source = 'flatbed' | 'adf'

const FAIL_REASONS = [
  '扫描仪未就绪，请检查连接或联系工作人员',
  '扫描仪进纸失败，请重新放置文件',
  '扫描超时，请稍后重试',
  'PDF 生成失败，请重试',
]

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  resume: '简历',
  id: '证件',
  document: '文档',
}

function buildSteps(source: Source): { key: Step; label: string; duration: number }[] {
  return [
    { key: 'init',       label: '初始化扫描仪', duration: 700 },
    { key: 'scanning',   label: '扫描原件',     duration: source === 'adf' ? 2000 : 3000 },
    { key: 'generating', label: '生成 PDF',     duration: 1500 },
  ]
}

function mockFile(scanType: ScanType) {
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  const pages = Math.floor(Math.random() * 5) + 1
  const sizeKb = pages * 120 + Math.floor(Math.random() * 80)
  return {
    name: `${SCAN_TYPE_LABELS[scanType]}_${ts}.pdf`,
    size: sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`,
    pages,
    format: 'PDF' as const,
  }
}

export function ScanProgressPage() {
  // 扫描进行中:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(true)

  const navigate = useNavigate()
  const location = useLocation()
  // Keep state as-is (possibly null) so useCallback deps stay stable
  const state = location.state as Record<string, unknown> | null

  const scanType = (state?.scanType as ScanType) ?? 'document'
  const source = (state?.source as Source) ?? 'flatbed'
  const shouldFail = state?.simulateFailure === true
  const failReason = typeof state?.failReason === 'string' ? (state.failReason as string) : FAIL_REASONS[0]

  const steps = buildSteps(source)

  const [current, setCurrent] = useState<Step>('init')
  const [failed, setFailed] = useState(false)
  const cancelRef = useRef(false)

  const navigateFail = useCallback(
    (reason: string) => {
      setFailed(true)
      setTimeout(() => {
        navigate('/scan/result', { state: { ...state, success: false, reason } })
      }, 700)
    },
    [navigate, state],
  )

  const navigateSuccess = useCallback(() => {
    const file = mockFile(scanType)
    navigate('/scan/result', { state: { ...state, success: true, file } })
  }, [navigate, state, scanType])

  const handleDevFail = useCallback(() => {
    cancelRef.current = true
    navigateFail(FAIL_REASONS[0])
  }, [navigateFail])

  useEffect(() => {
    cancelRef.current = false

    const advance = (idx: number) => {
      if (idx >= steps.length) {
        if (!cancelRef.current) navigateSuccess()
        return
      }
      const step = steps[idx]
      const duration =
        shouldFail && step.key === 'scanning' ? Math.floor(step.duration / 2) : step.duration

      setTimeout(() => {
        if (cancelRef.current) return
        if (shouldFail && step.key === 'scanning') {
          navigateFail(failReason)
          return
        }
        const next = steps[idx + 1]
        if (next) setCurrent(next.key)
        advance(idx + 1)
      }, duration)
    }

    advance(0)
    return () => { cancelRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentIdx = steps.findIndex((s) => s.key === current)

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* 状态图标 */}
      <div
        className={[
          'mb-10 flex h-24 w-24 items-center justify-center rounded-full',
          failed ? 'bg-red-50' : 'bg-primary-50',
        ].join(' ')}
      >
        {failed ? (
          <XCircleIcon className="h-12 w-12 text-red-500" />
        ) : (
          <ScanIcon className="h-12 w-12 text-primary-600" />
        )}
      </div>

      <h1 className="text-2xl font-bold text-gray-900">
        {failed ? '处理出错' : '正在扫描'}
      </h1>
      <p className="mt-2 text-base text-gray-500">
        {failed ? '任务遇到问题，即将跳转…' : '请勿移动文件，扫描中…'}
      </p>

      {/* 步骤列表 */}
      <div className="mt-12 w-full max-w-sm space-y-4">
        {steps.map((step, idx) => {
          const done = idx < currentIdx
          const active = idx === currentIdx
          const isFailed = failed && active

          return (
            <div key={step.key} className="flex items-center gap-4">
              <div
                className={[
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  isFailed
                    ? 'border-red-500 bg-red-500 text-white'
                    : done
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : active
                    ? 'border-primary-600 bg-white text-primary-600'
                    : 'border-gray-200 bg-white text-gray-300',
                ].join(' ')}
              >
                {isFailed ? (
                  <AlertCircleIcon className="h-5 w-5" />
                ) : done ? (
                  <CheckIcon className="h-5 w-5" />
                ) : active ? (
                  <CircleDotIcon className="h-5 w-5" />
                ) : (
                  <ClockIcon className="h-5 w-5" />
                )}
              </div>

              <div className="flex-1">
                <p
                  className={[
                    'text-base font-medium',
                    isFailed
                      ? 'text-red-600'
                      : done || active
                      ? 'text-gray-900'
                      : 'text-gray-400',
                  ].join(' ')}
                >
                  {step.label}
                </p>
                {active && !failed && (
                  <p className="mt-0.5 animate-pulse text-sm text-primary-600">处理中…</p>
                )}
                {isFailed && (
                  <p className="mt-0.5 text-sm text-red-500">任务中断</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* DEV 专用：模拟失败按钮，生产构建自动移除 */}
      {import.meta.env.DEV && !failed && (
        <div className="absolute bottom-24 right-6">
          <button
            onClick={handleDevFail}
            className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100"
          >
            [DEV] 模拟失败
          </button>
        </div>
      )}
    </div>
  )
}
