import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  SparklesIcon,
  XCircleIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { submitResumeParse } from '../../services/api'

type Step = 'reading' | 'ocr' | 'extracting' | 'diagnosing'

const STEPS: { key: Step; label: string; duration: number }[] = [
  { key: 'reading',    label: '读取文件', duration: 800 },
  { key: 'ocr',       label: '识别文字', duration: 1500 },
  { key: 'extracting',label: '提取结构', duration: 1200 },
  { key: 'diagnosing',label: '生成诊断', duration: 1800 },
]

const FAIL_REASONS = [
  '文件格式不支持，请重新上传',
  '文字识别失败，请确保文件清晰',
  '结构提取超时，请稍后重试',
  'AI 诊断服务暂时不可用，请稍后重试',
]

export function ResumeParsePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null

  const shouldFail = state?.simulateFailure === true
  const failReason = typeof state?.failReason === 'string' ? (state.failReason as string) : FAIL_REASONS[1]

  const [current, setCurrent] = useState<Step>('reading')
  const [failed, setFailed] = useState(false)
  const cancelRef = useRef(false)

  const navigateFail = useCallback(
    (reason: string) => {
      setFailed(true)
      setTimeout(() => {
        navigate('/resume/report', { state: { ...state, success: false, reason } })
      }, 700)
    },
    [navigate, state],
  )

  const navigateSuccess = useCallback(async () => {
    const file = state?.file as { name?: string; format?: string } | undefined
    try {
      const result = await submitResumeParse(
        {
          fileId:     typeof state?.fileId === 'string' ? state.fileId : `local-${Date.now()}`,
          fileName:   file?.name   ?? 'resume.pdf',
          fileFormat: file?.format ?? 'pdf',
          source:     (typeof state?.source === 'string' ? state.source : 'upload') as 'upload' | 'scan' | 'manual',
        },
        getToken(),
      )
      if (cancelRef.current) return
      if (result.status === 'failed') {
        navigateFail(result.failReason ?? 'AI 服务解析失败，请重试')
        return
      }
      navigate('/resume/report', {
        state: { ...state, success: true, taskId: result.taskId, report: result.report },
      })
    } catch {
      if (cancelRef.current) return
      navigateFail('AI 服务暂时不可用，请稍后重试')
    }
  }, [getToken, navigate, navigateFail, state])

  const handleDevFail = useCallback(() => {
    cancelRef.current = true
    navigateFail(FAIL_REASONS[1])
  }, [navigateFail])

  useEffect(() => {
    cancelRef.current = false

    const advance = (idx: number) => {
      if (idx >= STEPS.length) {
        if (!cancelRef.current) { navigateSuccess() }
        return
      }
      const step = STEPS[idx]
      const duration =
        shouldFail && step.key === 'ocr' ? Math.floor(step.duration / 2) : step.duration

      setTimeout(() => {
        if (cancelRef.current) return
        if (shouldFail && step.key === 'ocr') {
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

  const currentIdx = STEPS.findIndex((s) => s.key === current)

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
          <SparklesIcon className="h-12 w-12 text-primary-600" />
        )}
      </div>

      <h1 className="text-2xl font-bold text-gray-900">
        {failed ? '解析出错' : 'AI 正在分析'}
      </h1>
      <p className="mt-2 text-base text-gray-500">
        {failed ? '任务遇到问题，即将跳转…' : '请稍候，简历解析中…'}
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

      {/* DEV 专用 */}
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
