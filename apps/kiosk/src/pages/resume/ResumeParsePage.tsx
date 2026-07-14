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
import { saveAiResumeSession } from './aiResumeSession'
import {
  RESUME_SCORING_DIMENSIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import './resume-diagnosis-lightflow.css'

type Step = 'reading' | 'ocr' | 'extracting' | 'diagnosing'

const STEPS: { key: Step; label: string }[] = [
  { key: 'reading',    label: '读取上传文件' },
  { key: 'ocr',        label: '识别可解析文字' },
  { key: 'extracting', label: '提取简历结构' },
  { key: 'diagnosing', label: '生成诊断报告' },
]

const DIMENSIONS = RESUME_SCORING_DIMENSIONS.map((item) => item.label)
const MIN_STEP_MS = 420
const DIMENSION_PROGRESS_BY_STEP: Record<Step, number> = {
  reading: 1,
  ocr: 2,
  extracting: 4,
  diagnosing: DIMENSIONS.length,
}

const FAIL_REASONS = [
  '文件格式不支持，请重新上传',
  '文字识别失败，请确保文件清晰',
  '结构提取超时，请稍后重试',
  'AI 诊断服务暂时不可用，请稍后重试',
]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
    const fileId = typeof state?.fileId === 'string' ? state.fileId : ''
    if (!fileId) {
      navigateFail('请先上传简历文件，再开始 AI 诊断')
      return
    }
    const selectedDimensions = Array.isArray(state?.selectedDimensions)
      ? (state.selectedDimensions as ResumeScoringDimensionKey[])
      : undefined
    const targetContext = state?.targetContext as ResumeTargetContext | undefined
    try {
      setCurrent('diagnosing')
      const result = await submitResumeParse(
        {
          fileId,
          fileName:   file?.name   ?? 'resume.pdf',
          fileFormat: file?.format ?? 'pdf',
          source:     (typeof state?.source === 'string' ? state.source : 'upload') as 'upload' | 'scan' | 'manual',
          selectedDimensions,
          targetContext,
        },
        getToken(),
      )
      if (cancelRef.current) return
      if (result.status === 'failed') {
        navigateFail(result.failReason ?? 'AI 服务解析失败，请重试')
        return
      }
      // Phase C-2A：匿名 parse 会返回一次性 accessToken；连同 taskId 写入最小会话，
      // 供刷新 / 返回后读回本人结果（绝不持久化 report / 原文）。会员结果无 accessToken。
      saveAiResumeSession({ taskId: result.taskId, accessToken: result.accessToken })
      navigate('/resume/report', {
        state: { ...state, success: true, taskId: result.taskId, accessToken: result.accessToken, providerName: result.providerName, report: result.report, extractionNotice: result.extractionNotice },
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
    const run = async () => {
      setCurrent('reading')
      await delay(MIN_STEP_MS)
      if (cancelRef.current) return
      setCurrent('ocr')
      if (shouldFail) {
        navigateFail(failReason)
        return
      }
      await delay(MIN_STEP_MS)
      if (cancelRef.current) return
      setCurrent('extracting')
      await delay(MIN_STEP_MS)
      if (!cancelRef.current) await navigateSuccess()
    }
    void run()
    return () => { cancelRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentIdx = STEPS.findIndex((s) => s.key === current)
  const completedDimensionCount = DIMENSION_PROGRESS_BY_STEP[current]

  return (
    <div className="resume-lightflow resume-parse-lightflow flex h-full flex-col items-center justify-center p-8" role="status" aria-live="polite">
      {/* 状态图标 */}
      <div
        className={[
          'resume-parse-status-mark mb-10 flex h-24 w-24 items-center justify-center rounded-full',
          failed ? 'bg-error-bg' : 'bg-primary-50',
        ].join(' ')}
      >
        {failed ? (
          <XCircleIcon className="h-12 w-12 text-error-fg" />
        ) : (
          <SparklesIcon className="h-12 w-12 text-primary-600" />
        )}
      </div>

      <h1 className="text-2xl font-bold text-neutral-900">
        {failed ? '解析出错' : 'AI 正在分析'}
      </h1>
      <p className="mt-2 text-base text-neutral-500">
        {failed ? '任务遇到问题，即将跳转…' : '正在读取你上传的简历文件，请稍候…'}
      </p>

      {!failed && (
        <div className="resume-parse-dimensions mt-8 grid w-full max-w-3xl grid-cols-2 gap-3 md:grid-cols-6">
          {DIMENSIONS.map((item, idx) => (
            <div
              key={item}
              className={[
                'rounded-2xl border px-3 py-3 text-center text-xs font-semibold transition-colors',
                idx < completedDimensionCount ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-white text-neutral-400',
              ].join(' ')}
            >
              {item}
            </div>
          ))}
        </div>
      )}

      {/* 步骤列表 */}
      <div className="resume-parse-steps mt-10 w-full max-w-sm space-y-4">
        {STEPS.map((step, idx) => {
          const done = idx < currentIdx
          const active = idx === currentIdx
          const isFailed = failed && active

          return (
            <div key={step.key} className="resume-parse-step flex items-center gap-4">
              <div
                className={[
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  isFailed
                    ? 'border-error-fg bg-error text-white'
                    : done
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : active
                    ? 'border-primary-600 bg-white text-primary-600'
                    : 'border-neutral-200 bg-white text-neutral-300',
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
                      ? 'text-error-fg'
                      : done || active
                      ? 'text-neutral-900'
                      : 'text-neutral-400',
                  ].join(' ')}
                >
                  {step.label}
                </p>
                {active && !failed && (
                  <p className="mt-0.5 animate-pulse text-sm text-primary-600">处理中…</p>
                )}
                {isFailed && (
                  <p className="mt-0.5 text-sm text-error-fg">任务中断</p>
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
            className="resume-parse-dev rounded-md border border-error/30 bg-error-bg px-3 py-1.5 text-xs text-error-fg hover:bg-error/20"
          >
            [DEV] 模拟失败
          </button>
        </div>
      )}
    </div>
  )
}
