import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  PrinterIcon,
  XCircleIcon,
} from 'lucide-react'

type Step = 'submitting' | 'queuing' | 'printing'

const STEPS: { key: Step; label: string; duration: number }[] = [
  { key: 'submitting', label: '提交任务', duration: 1200 },
  { key: 'queuing',    label: '排队等待', duration: 1000 },
  { key: 'printing',   label: '打印中',   duration: 2500 },
]

const FAIL_REASONS = [
  '打印机离线，请联系工作人员或稍后重试',
  '打印机缺纸，请联系工作人员补纸',
  '任务处理超时，请稍后重试',
  '文件解析失败，请重新上传文件',
]

const stepIndex = (key: Step) => STEPS.findIndex((s) => s.key === key)

export function PrintProgressPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null

  // simulateFailure=true → 在打印中步骤触发失败，失败原因取 failReason（默认第一条）
  const shouldFail = state?.simulateFailure === true
  const failReason = typeof state?.failReason === 'string' ? state.failReason : FAIL_REASONS[0]

  const [current, setCurrent] = useState<Step>('submitting')
  const [failed, setFailed] = useState(false)
  const cancelRef = useRef(false)

  const navigateFail = useCallback(
    (reason: string) => {
      setFailed(true)
      setTimeout(() => {
        navigate('/print/done', { state: { ...state, success: false, reason } })
      }, 700)
    },
    [navigate, state],
  )

  const navigateSuccess = useCallback(() => {
    navigate('/print/done', { state: { ...state, success: true } })
  }, [navigate, state])

  // dev-only: 立即触发失败，取消当前进度
  const handleDevFail = useCallback(() => {
    cancelRef.current = true
    navigateFail(FAIL_REASONS[0])
  }, [navigateFail])

  useEffect(() => {
    cancelRef.current = false

    const advance = (idx: number) => {
      if (idx >= STEPS.length) {
        if (!cancelRef.current) navigateSuccess()
        return
      }
      const step = STEPS[idx]
      // 如果 simulateFailure，在打印中步骤中途触发失败（1200ms 后，不等满 2500ms）
      const duration = shouldFail && step.key === 'printing' ? 1200 : step.duration

      setTimeout(() => {
        if (cancelRef.current) return
        if (shouldFail && step.key === 'printing') {
          navigateFail(failReason)
          return
        }
        const next = STEPS[idx + 1]
        if (next) setCurrent(next.key)
        advance(idx + 1)
      }, duration)
    }

    advance(0)
    return () => { cancelRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentIdx = stepIndex(current)

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
          <PrinterIcon className="h-12 w-12 text-primary-600" />
        )}
      </div>

      <h1 className="text-2xl font-bold text-gray-900">
        {failed ? '处理出错' : '正在处理'}
      </h1>
      <p className="mt-2 text-base text-gray-500">
        {failed ? '任务遇到问题，即将跳转…' : '请勿离开，任务处理中…'}
      </p>

      {/* 步骤列表 */}
      <div className="mt-12 w-full max-w-sm space-y-4">
        {STEPS.map((step, idx) => {
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
