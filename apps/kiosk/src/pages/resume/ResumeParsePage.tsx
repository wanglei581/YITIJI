import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  CheckIcon,
  SparklesIcon,
  XCircleIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { KioskPageFrame } from '@ai-job-print/ui'
import { submitResumeParse } from '../../services/api'
import { saveAiResumeSession } from './aiResumeSession'
import {
  RESUME_SCORING_DIMENSIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import './resume-diagnosis-lightflow.css'
import './resume-diagnosis-ext.css'
import './resume-fusion-youth.css'

type Step = 'reading' | 'ocr' | 'extracting' | 'diagnosing'

const STEPS: { key: Step; label: string; hint: string }[] = [
  { key: 'reading',    label: '读取上传文件',    hint: '校验格式与页数' },
  { key: 'ocr',        label: '识别可解析文字',  hint: '图片 / 扫描件经 OCR 识别' },
  { key: 'extracting', label: '提取简历结构',    hint: '识别教育、经历、技能等分区' },
  { key: 'diagnosing', label: '生成诊断报告',    hint: '6 个评分维度 + 风险表述 + 优先级建议' },
]

const RING_CIRCUMFERENCE = 2 * Math.PI * 88  // ≈ 552.9

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
  const stepNum = currentIdx + 1

  // Ring SVG: r=88, circumference≈552.9
  const ringFill = failed ? 0 : Math.round((stepNum / STEPS.length) * RING_CIRCUMFERENCE)
  const ringDash = `${ringFill} ${RING_CIRCUMFERENCE}`

  // File meta from navigation state
  const file = state?.file as { name?: string; size?: number | string } | undefined
  const fileName = file?.name ?? '简历文件'
  const fileSize = typeof file?.size === 'number'
    ? file.size < 1024 * 1024 ? `${Math.round(file.size / 1024)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`
    : typeof file?.size === 'string' ? file.size : null
  const source = typeof state?.source === 'string' ? state.source : 'upload'
  const sourceLabel = source === 'scan' ? '扫描件' : source === 'manual' ? '手动填写' : '云端上传'

  const parseTitle = failed
    ? '解析出错'
    : current === 'reading'    ? '正在读取上传文件…'
    : current === 'ocr'        ? '正在识别文字内容…'
    : current === 'extracting' ? '正在提取简历结构…'
    :                            '正在生成诊断报告…'

  /* ── 顶部流程步骤条：整个 AI 简历服务 4 步 ──────────────── */
  const FLOW_STEPS = [
    { label: '上传与方向' },
    { label: 'AI解析' },
    { label: '诊断报告' },
    { label: '优化打印' },
  ] as const
  const FLOW_ACTIVE = 1 // 第 2 步，0-indexed

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-parse" className="resume-lightflow resume-parse-lightflow" role="status" aria-live="polite">
      {/* 顶部流程步骤条 */}
      <nav className="rp-flow-steps" aria-label="AI简历服务进度">
        {FLOW_STEPS.map((step, i) => {
          const done = i < FLOW_ACTIVE
          const active = i === FLOW_ACTIVE
          return (
            <span key={step.label} className="rp-flow-steps__item">
              <span
                className={[
                  'rp-flow-steps__dot',
                  done ? 'rp-flow-steps__dot--done' : active ? 'rp-flow-steps__dot--active' : '',
                ].filter(Boolean).join(' ')}
                aria-hidden="true"
              >
                {done
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12l5 5 9-10"/></svg>
                  : i + 1}
              </span>
              <span className={['rp-flow-steps__label', active ? 'rp-flow-steps__label--active' : ''].filter(Boolean).join(' ')}>
                {step.label}
              </span>
              {i < FLOW_STEPS.length - 1 && (
                <span className={['rp-flow-steps__line', done ? 'rp-flow-steps__line--done' : ''].filter(Boolean).join(' ')} aria-hidden="true" />
              )}
            </span>
          )
        })}
      </nav>

      {/* 中心卡片 */}
      <div className="rp-center">
        <section className="rp-card">

          {/* 环形进度 */}
          <div className="rp-ring-box" aria-hidden="true">
            <svg viewBox="0 0 200 200" width="200" height="200">
              <circle cx="100" cy="100" r="88" fill="none" stroke="var(--fy-line)" strokeWidth="13" />
              <circle
                cx="100" cy="100" r="88" fill="none"
                stroke={failed ? 'var(--fy-error)' : 'var(--fy-teal)'}
                strokeWidth="13" strokeLinecap="round"
                strokeDasharray={ringDash}
                transform="rotate(-90 100 100)"
                style={{ transition: 'stroke-dasharray .4s ease' }}
              />
            </svg>
            <span className="rp-ring-num">
              {failed ? <XCircleIcon style={{ width: 44, height: 44 }} /> : <>{stepNum}<small>/{STEPS.length} 步</small></>}
            </span>
          </div>

          <div className="rp-title">{parseTitle}</div>

          {/* 文件信息 chips */}
          {!failed && (
            <div className="rp-chips">
              <span className="rp-chip">{fileName}</span>
              {fileSize && <span className="rp-chip">{fileSize} · {sourceLabel}</span>}
            </div>
          )}

          {/* 步骤列表 */}
          <div className="rp-steps">
            {STEPS.map((step, idx) => {
              const done = idx < currentIdx
              const active = idx === currentIdx
              const isFailed = failed && active

              const stateLabel = isFailed ? '任务中断' : done ? '已完成' : active ? '进行中…' : '待处理'
              const dotClass = ['rp-step__dot',
                isFailed ? 'rp-step__dot--error' : done ? 'rp-step__dot--done' : active ? 'rp-step__dot--active' : '',
              ].filter(Boolean).join(' ')
              const rowClass = ['rp-step', done ? 'rp-step--done' : active ? 'rp-step--active' : 'rp-step--todo'].join(' ')

              return (
                <div key={step.key} className={rowClass}>
                  <span className={dotClass} aria-hidden="true">
                    {isFailed
                      ? <AlertCircleIcon style={{ width: 20, height: 20 }} />
                      : done
                      ? <CheckIcon style={{ width: 20, height: 20 }} />
                      : idx + 1}
                  </span>
                  <strong className="rp-step__label">{step.label}</strong>
                  <em className="rp-step__hint">{step.hint}</em>
                  <span className="rp-step__state">{stateLabel}</span>
                </div>
              )
            })}
          </div>

          {/* 维度点亮 */}
          {!failed && (
            <div className="rp-dims">
              <p className="rp-dims__title">评分维度准备进度（逐项点亮）</p>
              <div className="rp-dims__grid">
                {DIMENSIONS.map((item, idx) => (
                  <span key={item} className={['rp-dim', idx < completedDimensionCount ? 'rp-dim--lit' : ''].join(' ')}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rp-notice">
            <SparklesIcon style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" />
            解析通常在 1 分钟内完成；若格式不支持、识别失败或服务不可用，将如实提示失败原因，可重试或重新上传。诊断结果由 AI 生成，仅供参考。
          </div>
        </section>
      </div>

      {/* 底部行动条 */}
      <div className="rp-actionbar">
        <div className="rp-actionbar__notice">
          <CheckIcon style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" />
          简历原文仅用于本次解析和诊断，不会发送给任何企业，也不作为平台简历库沉淀。
        </div>
        <button
          type="button"
          className="rp-cancel"
          onClick={() => { cancelRef.current = true; navigate(-1) }}
        >
          <XCircleIcon style={{ width: 20, height: 20 }} aria-hidden="true" />
          取消解析
        </button>
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
    </section>
    </KioskPageFrame>
  )
}
