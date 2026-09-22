import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  CheckIcon,
  SparklesIcon,
  XCircleIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
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
import './resume-triage-qx.css'

/** 稿 21 小青任务头的四步轨；本页是第 2 步。 */
const RESUME_FLOW_STEPS = ['上传与方向', 'AI 解析', '诊断报告', '优化打印']

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

  // 顶栏返回回到上传页时带上真实 intent，优化链路不会被悄悄改成诊断。
  const sourceRoute = state?.intent === 'optimize' ? '/resume/source?intent=optimize' : '/resume/source'

  /* ── 稿 21 同一工作台的 /resume/parse 段：小青任务头 + 四步轨（当前第 2 步） ── */
  const frameStatus = consent.checking || consent.needsPrompt
    ? { tone: 'unknown' as const, label: '确认授权中' }
    : !fileId
      ? { tone: 'unknown' as const, label: '未找到文件' }
      : failed
        ? { tone: 'bad' as const, label: '解析失败' }
        : { tone: 'warn' as const, label: '等待解析结果' }

  const renderFrame = (body: ReactNode, ctabar?: ReactNode) => (
    <QxPageFrame
      title="AI 解析"
      subtitle="等待服务端返回真实解析结果"
      status={frameStatus}
      terminalLabel="AI 简历服务"
      back={{ label: '返回简历来源', onBack: () => { cancelRef.current = true; navigate(sourceRoute) } }}
      ctabar={ctabar}
    >
      <section data-kiosk-domain="resume" data-kiosk-screen="resume-parse" className="qx-resume-triage">
        <header className="qx-rt-xq">
          <div className="qx-rt-xq-row">
            <span className="qx-rt-face" aria-hidden="true">青</span>
            <div className="qx-rt-xq-main">
              <p className="qx-rt-eyebrow">AI RESUME PARSE</p>
              <p className="qx-rt-title">文件收到了，<em>等真实解析结果</em>。</p>
              <p className="qx-rt-doing">结果以服务端真实返回为准，不拿计时动画冒充进度。</p>
            </div>
          </div>
          <ol className="qx-rt-rail" aria-label="简历服务流程：上传与方向、AI 解析、诊断报告、优化打印">
            {RESUME_FLOW_STEPS.map((step, i) => (
              <li key={step} aria-current={i === 1 ? 'step' : undefined} data-done={i < 1 ? '1' : undefined}><i>{i + 1}</i>{step}</li>
            ))}
          </ol>
        </header>
        {body}
      </section>
    </QxPageFrame>
  )

  if (consent.checking || consent.needsPrompt) {
    return (
      <>
        {renderFrame(
          <p className="qx-rt-note" role="status">
            {consent.checking ? '正在确认授权状态…' : '使用简历 AI 前需要先确认授权'}
          </p>,
        )}
        {consent.needsPrompt && (
          <ResumeAiConsentDialog
            busy={consent.busy}
            error={consent.error}
            guest={!getToken()}
            onCancel={() => navigate('/resume/source')}
            onConfirm={() => { void consent.confirm() }}
          />
        )}
      </>
    )
  }

  if (!fileId) {
    return renderFrame(
      <div className="qx-rt-wait">
        <section className="qx-card qx-rt-wait-card">
          <span className="qx-rt-ring" data-tone="bad" aria-hidden="true"><XCircleIcon size={44} /></span>
          <h2 className="qx-rt-wait-t">未找到简历文件</h2>
          <p className="qx-rt-wait-d">请从上传简历页面选择文件后，再开始 AI 诊断。</p>
        </section>
      </div>,
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/resume/source')}>
        返回上传简历
      </button>,
    )
  }

  return renderFrame(
    <>
      <div className="qx-rt-wait">
        <section className="qx-card qx-rt-wait-card" data-live={failed ? undefined : 'true'}>
          {/* 装饰性处理标识：不表达百分比或服务端阶段 */}
          <span className="qx-rt-ring" data-tone={failed ? 'bad' : undefined} aria-hidden="true">
            {failed ? <XCircleIcon size={44} /> : <SparklesIcon size={44} />}
          </span>
          <h2 className="qx-rt-wait-t" role="status" aria-live="polite">
            {failed ? '解析出错' : '正在等待真实解析结果…'}
          </h2>
          {/* 文件信息 chips */}
          {!failed && (
            <div className="qx-rt-chips">
              <span>{fileName}</span>
              {fileSize && <span>{fileSize} · {sourceLabel}</span>}
              <span>处理内容说明 · 非实时阶段</span>
            </div>
          )}
        </section>

        <p className="qx-rt-note" role="note">
          <b>说明</b>当前服务仅返回最终解析结果。以下为本次处理内容说明，不代表服务端实时阶段。
        </p>
        {consent.guestNotice && (
          <p className="qx-rt-note" role="note" data-testid="resume-ai-guest-notice">
            未登录使用简历 AI：本次结果只在本机会话内可见，离场即清，不进入任何账号；AI 建议仅供参考，不替你投递。
          </p>
        )}

        {/* 处理内容说明：API 不提供分阶段状态，不渲染完成/进行中 */}
        <ol className="qx-rt-steps" aria-label="本次处理内容说明">
          {STEPS.map((step, idx) => (
            <li key={step.key}>
              <i aria-hidden="true">{idx + 1}</i>
              <strong>{step.label}</strong>
              <em>{step.hint}</em>
              <span>处理内容</span>
            </li>
          ))}
        </ol>

        {/* 结果维度说明：不冒充实时准备进度 */}
        {!failed && (
          <section className="qx-card">
            <p className="qx-rt-wait-d"><b>报告将评估的维度</b></p>
            <div className="qx-rt-dim-grid">
              {DIMENSIONS.map((item) => <span key={item} className="qx-rt-dim">{item}</span>)}
            </div>
          </section>
        )}

        <p className="qx-rt-note" data-tone="warn">
          解析通常在 90 秒内完成；若格式不支持、识别失败或服务不可用，将如实提示失败原因，可重试或重新上传。诊断结果由 AI 生成，仅供参考。
        </p>
      </div>

      {/* DEV 专用 */}
      {import.meta.env.DEV && Boolean(fileId) && !failed && (
        <button type="button" onClick={handleDevFail} className="qx-rt-dev resume-parse-dev">
          [DEV] 模拟失败
        </button>
      )}
    </>,
    <>
      <p className="why">
        <CheckIcon size={18} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
        返回仅停止本机等待，不会撤回已提交的服务请求；简历原文不会发送给企业，也不进入平台候选人简历库。
      </p>
      <button
        type="button"
        className="qx-btn"
        data-variant="ghost"
        onClick={() => { cancelRef.current = true; navigate(-1) }}
      >
        <XCircleIcon size={20} aria-hidden="true" />
        返回上一步
      </button>
    </>,
  )
}
