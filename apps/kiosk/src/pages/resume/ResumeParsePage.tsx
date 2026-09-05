import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  CheckIcon,
  SparklesIcon,
  XCircleIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskPageFrame, Stepper } from '@ai-job-print/ui'
import type { StepperStep } from '@ai-job-print/ui'
import { submitResumeParse } from '../../services/api'
import { aiErrorMessageOf } from '../../ai'
import { saveAiResumeSession } from './aiResumeSession'
import { useResumeAiConsent } from './resumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import {
  RESUME_SCORING_DIMENSIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import './resume-diagnosis-lightflow.css'
import './resume-diagnosis-ext.css'
import './resume-fusion-youth.css'

const RESUME_FLOW_STEPS: StepperStep[] = [
  { title: '上传与方向' },
  { title: 'AI 解析' },
  { title: '诊断报告' },
  { title: '优化打印' },
]

const STEPS = [
  { key: 'reading',    label: '读取上传文件',    hint: '校验格式与页数' },
  { key: 'ocr',        label: '识别可解析文字',  hint: '图片 / 扫描件经 OCR 识别' },
  { key: 'extracting', label: '提取简历结构',    hint: '识别教育、经历、技能等分区' },
  { key: 'diagnosing', label: '生成诊断报告',    hint: '6 个评分维度 + 风险表述 + 优先级建议' },
]

const DIMENSIONS = RESUME_SCORING_DIMENSIONS.map((item) => item.label)

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
  const consent = useResumeAiConsent()
  const state = location.state as Record<string, unknown> | null

  const file = state?.file as { name?: string; format?: string; size?: number | string } | undefined
  const fileId = typeof state?.fileId === 'string' ? state.fileId : ''

  const [failed, setFailed] = useState(false)
  const cancelRef = useRef(false)
  const startedRef = useRef(false)
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useBusyLock(Boolean(fileId) && !failed)

  const navigateFail = useCallback(
    (reason: string) => {
      setFailed(true)
      failTimerRef.current = setTimeout(() => {
        navigate('/resume/report', { state: { ...state, success: false, reason } })
      }, 700)
    },
    [navigate, state],
  )

  const submitAndWait = useCallback(async () => {
    if (!fileId) {
      return
    }
    const selectedDimensions = Array.isArray(state?.selectedDimensions)
      ? (state.selectedDimensions as ResumeScoringDimensionKey[])
      : undefined
    const targetContext = state?.targetContext as ResumeTargetContext | undefined
    try {
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
      if (result.status !== 'completed') {
        navigateFail(result.failReason ?? 'AI 服务尚未返回最终解析结果，请稍后重试')
        return
      }
      // Phase C-2A：匿名 parse 会返回一次性 accessToken；连同 taskId 写入最小会话，
      // 供刷新 / 返回后读回本人结果（绝不持久化 report / 原文）。会员结果无 accessToken。
      saveAiResumeSession({ taskId: result.taskId, accessToken: result.accessToken })
      navigate('/resume/report', {
        state: { ...state, success: true, taskId: result.taskId, accessToken: result.accessToken, providerName: result.providerName, report: result.report, extractionNotice: result.extractionNotice },
      })
    } catch (err) {
      if (cancelRef.current) return
      // 把真实原因带进失败态：演示模式要说「演示模式不提供简历解析与诊断」，
      // 一律改写成「服务暂时不可用」会让用户以为是网络问题、反复重试同一份文件。
      navigateFail(aiErrorMessageOf(err, 'AI 服务暂时不可用，请稍后重试'))
    }
  }, [file, fileId, getToken, navigate, navigateFail, state])

  const handleDevFail = useCallback(() => {
    cancelRef.current = true
    navigateFail(FAIL_REASONS[1])
  }, [navigateFail])

  useEffect(() => {
    cancelRef.current = false
    const cleanup = () => {
      cancelRef.current = true
      if (failTimerRef.current) clearTimeout(failTimerRef.current)
    }
    if (!fileId || startedRef.current) return cleanup
    if (consent.checking || consent.needsPrompt || !consent.ready) return cleanup
    startedRef.current = true
    void submitAndWait()
    return cleanup
  }, [fileId, submitAndWait, consent.checking, consent.needsPrompt, consent.ready])

  // File meta from navigation state
  const fileName = file?.name ?? '简历文件'
  const fileSize = typeof file?.size === 'number'
    ? file.size < 1024 * 1024 ? `${Math.round(file.size / 1024)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`
    : typeof file?.size === 'string' ? file.size : null
  const source = typeof state?.source === 'string' ? state.source : 'upload'
  const sourceLabel = source === 'scan' ? '扫描件' : source === 'manual' ? '手动填写' : '云端上传'

  /* ── 顶部流程步骤条：与上传/报告/优化页共用 Stepper ── */

  if (consent.checking || consent.needsPrompt) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume">
        <section data-kiosk-domain="resume" data-kiosk-screen="resume-parse" className="resume-lightflow resume-parse-lightflow flex h-full flex-col p-6">
          <div className="resume-lightflow__stepper">
            <Stepper steps={RESUME_FLOW_STEPS} currentIndex={1} />
          </div>
          <div className="rp-center">
            <p className="text-base text-neutral-500">
              {consent.checking ? '正在确认授权状态…' : '使用简历 AI 前需要先确认授权'}
            </p>
          </div>
        </section>
        {consent.needsPrompt && (
          <ResumeAiConsentDialog
            busy={consent.busy}
            error={consent.error}
            guest={!getToken()}
            onCancel={() => navigate('/resume/source')}
            onConfirm={() => { void consent.confirm() }}
          />
        )}
      </KioskPageFrame>
    )
  }

  if (!fileId) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume">
        <section data-kiosk-domain="resume" data-kiosk-screen="resume-parse" className="resume-lightflow resume-parse-lightflow flex h-full flex-col p-6">
          <div className="resume-lightflow__stepper">
            <Stepper steps={RESUME_FLOW_STEPS} currentIndex={1} />
          </div>
          <div className="rp-center">
            <section className="rp-card text-center">
              <div className="rp-ring-box" aria-hidden="true">
                <span className="rp-ring-num">
                  <XCircleIcon style={{ width: 44, height: 44 }} />
                </span>
              </div>
              <h1 className="rp-title">未找到简历文件</h1>
              <p className="mt-3 text-base text-neutral-600">请从上传简历页面选择文件后，再开始 AI 诊断。</p>
              <button
                type="button"
                className="rp-cancel mt-6 min-h-[56px] px-8"
                onClick={() => navigate('/resume/source')}
              >
                返回上传简历
              </button>
            </section>
          </div>
        </section>
      </KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-parse" className="resume-lightflow resume-parse-lightflow flex h-full flex-col p-6">
      <div className="resume-lightflow__stepper">
        <Stepper steps={RESUME_FLOW_STEPS} currentIndex={1} />
      </div>

      {/* 中心卡片 */}
      <div className="rp-center">
        <section className="rp-card">

          {/* 装饰性处理标识：不表达百分比或服务端阶段 */}
          <div className="rp-ring-box" aria-hidden="true">
            <svg viewBox="0 0 200 200" width="200" height="200">
              <circle cx="100" cy="100" r="88" fill="none" stroke="var(--fy-line)" strokeWidth="13" />
              <circle
                cx="100" cy="100" r="88" fill="none"
                stroke={failed ? 'var(--fy-error)' : 'var(--fy-teal)'}
                strokeWidth="13" strokeLinecap="round"
              />
            </svg>
            <span className="rp-ring-num">
              {failed
                ? <XCircleIcon style={{ width: 44, height: 44 }} />
                : <SparklesIcon style={{ width: 44, height: 44 }} />}
            </span>
          </div>

          <div className="rp-title" role="status" aria-live="polite">
            {failed ? '解析出错' : '正在等待真实解析结果…'}
          </div>

          {/* 文件信息 chips */}
          {!failed && (
            <div className="rp-chips">
              <span className="rp-chip">{fileName}</span>
              {fileSize && <span className="rp-chip">{fileSize} · {sourceLabel}</span>}
              <span className="rp-chip">处理内容说明 · 非实时阶段</span>
            </div>
          )}

          <div className="rp-notice" role="note">
            <SparklesIcon style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" />
            当前服务仅返回最终解析结果。以下为本次处理内容说明，不代表服务端实时阶段。
          </div>

          {/* 处理内容说明：API 不提供分阶段状态，不渲染完成/进行中 */}
          <div className="rp-steps">
            {STEPS.map((step, idx) => {
              return (
                <div key={step.key} className="rp-step rp-step--todo">
                  <span className="rp-step__dot" aria-hidden="true">{idx + 1}</span>
                  <strong className="rp-step__label">{step.label}</strong>
                  <em className="rp-step__hint">{step.hint}</em>
                  <span className="rp-step__state">处理内容</span>
                </div>
              )
            })}
          </div>

          {/* 结果维度说明：不冒充实时准备进度 */}
          {!failed && (
            <div className="rp-dims">
              <p className="rp-dims__title">报告将评估的维度</p>
              <div className="rp-dims__grid">
                {DIMENSIONS.map((item) => (
                  <span key={item} className="rp-dim">{item}</span>
                ))}
              </div>
            </div>
          )}

          <div className="rp-notice">
            <SparklesIcon style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" />
            解析通常在 90 秒内完成；若格式不支持、识别失败或服务不可用，将如实提示失败原因，可重试或重新上传。诊断结果由 AI 生成，仅供参考。
          </div>
        </section>
      </div>

      {/* 底部行动条 */}
      <div className="rp-actionbar">
        <div className="rp-actionbar__notice">
          <CheckIcon style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" />
          返回仅停止本机等待，不会撤回已提交的服务请求；简历原文不会发送给企业，也不进入平台候选人简历库。
        </div>
        <button
          type="button"
          className="rp-cancel"
          onClick={() => { cancelRef.current = true; navigate(-1) }}
        >
          <XCircleIcon style={{ width: 20, height: 20 }} aria-hidden="true" />
          返回上一步
        </button>
      </div>

      {/* DEV 专用 */}
      {import.meta.env.DEV && Boolean(fileId) && !failed && (
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
