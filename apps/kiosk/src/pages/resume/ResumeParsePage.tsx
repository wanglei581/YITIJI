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
import { aiErrorCodeOf, aiErrorMessageOf } from '../../ai'
import { saveAiResumeSession } from './aiResumeSession'
import { useResumeAiConsent } from './resumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { ResumeTriageHero, type RailMark } from './components/ResumeTriageHero'
import { buildScanHandoff } from './resumeScanHandoff'
import {
  RESUME_SCORING_DIMENSIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import './resume-triage-qx.css'

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

/**
 * 这两个码只说明「本机没等到服务端的答复」（断网 / 超时，见 throwHttpError.networkError），
 * 服务端可能处理了也可能没处理——所以是「结果未知」，不能说成「解析失败」。
 */
const NO_REPLY_CODES = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT'])

/**
 * 本页真实所处的状态。标题、四步轨、顶栏胶囊都只从这里取，不各自猜。
 * 稿 21 的 parse-rechecking（按同一请求标识再查）没有对应的后端合同 —— 解析是一次请求、
 * 成功才回 taskId，失败或没答复时手里没有可查的标识 —— 所以本页不做「再查」，只如实说未知。
 */
type ParseView = 'missing-file' | 'consent-checking' | 'consent-needed' | 'waiting' | 'failed' | 'unknown'

const VIEW: Record<ParseView, {
  ask: ReactNode
  doing: string
  flag: string
  warn: boolean
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  rail: RailMark[]
}> = {
  'missing-file': {
    ask: <>没找到<em>要用的简历文件</em>。</>,
    doing: '这一步需要一份已经拿到的简历，现在没有，所以不往下走。',
    flag: '已阻断', warn: true,
    status: { tone: 'warn', label: '这一步没有文件' },
    rail: ['current', 'todo', 'todo', 'todo'],
  },
  'consent-checking': {
    ask: <>先确认<em>授权状态</em>。</>,
    doing: '确认完成之前，文件不会交给 AI 服务。',
    flag: '确认中', warn: false,
    status: { tone: 'unknown', label: '确认授权中' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
  'consent-needed': {
    ask: <>用简历 AI 前，<em>需要你先授权</em>。</>,
    doing: '不授权就不解析；取消会回到来源选择，文件不会交给 AI。',
    flag: '待授权', warn: true,
    status: { tone: 'warn', label: '等待授权' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
  waiting: {
    ask: <>文件收到了，正在等<em>最终解析结果</em>。</>,
    doing: '解析是一次出结果的处理，中间没有阶段可以播报。',
    flag: '解析中', warn: false,
    status: { tone: 'unknown', label: '正在解析 · 一次性出结果' },
    rail: ['done', 'current', 'todo', 'todo'],
  },
  failed: {
    ask: <>这次<em>没能读出内容</em>。</>,
    doing: '文件已经传到服务端了，正在转到失败说明页，可以直接重新解析，不用再传一遍。',
    flag: '解析失败', warn: true,
    status: { tone: 'bad', label: '解析失败 · 可重试' },
    rail: ['done', 'bad', 'todo', 'todo'],
  },
  unknown: {
    ask: <>这一次解析<em>有没有出结果，本机没拿到答复</em>。</>,
    doing: '可能是网络断了或等太久；不确定服务端处理没有，本页不会自动再提交一次。',
    flag: '结果未知', warn: true,
    status: { tone: 'warn', label: '解析结果未知' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
}

export function ResumeParsePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const consent = useResumeAiConsent()
  const state = location.state as Record<string, unknown> | null

  const file = state?.file as { name?: string; format?: string; size?: number | string } | undefined
  const fileId = typeof state?.fileId === 'string' ? state.fileId : ''

  const [outcome, setOutcome] = useState<'failed' | 'unknown' | null>(null)
  const failed = outcome !== null
  const cancelRef = useRef(false)
  const startedRef = useRef(false)
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useBusyLock(Boolean(fileId) && !failed)

  const navigateFail = useCallback(
    (reason: string, kind: 'failed' | 'unknown' = 'failed') => {
      setOutcome(kind)
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
      navigateFail(
        aiErrorMessageOf(err, 'AI 服务暂时不可用，请稍后重试'),
        NO_REPLY_CODES.has(aiErrorCodeOf(err)) ? 'unknown' : 'failed',
      )
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
  const sourceLabel = source === 'scan' ? '扫描件' : source === 'manual' ? '手动填写' : '已上传'

  /*
   * 离开本页回到来源选择。
   * 扫描件是扫描工作台用 replace 交接过来的：扫描登记已清、/scan/result 那条历史也被换掉了，
   * 这份文件此刻只活在本页的路由 state 里。所以扫描来的必须把同一份文件身份原样带回来源页
   * （稿 21 scan-ready），否则一按返回文件就丢了；history back 也回不到扫描结果。
   * 上传来的照旧：顶栏回来源页、底栏「返回上一步」走浏览器历史。
   * 带上真实 intent，优化链路不会被悄悄改成诊断。
   *
   * 必须用 replace 把解析页这条历史换掉（顶栏返回、授权取消、扫描件的「返回上一步」都走这里）：
   * push 会把解析页留在来源页底下，浏览器 / 系统后退一按，解析页带着原来的路由 state 重新挂载，
   * 用同一个 fileId 和签名链接再提交一次解析，还把这份文件重新摆到屏幕上。
   */
  const scanHandoff = source === 'scan' ? buildScanHandoff(state) : null
  const sourceRoute = state?.intent === 'optimize' ? '/resume/source?intent=optimize' : '/resume/source'
  const leaveToSource = () => {
    cancelRef.current = true
    navigate(sourceRoute, scanHandoff ? { replace: true, state: { scanHandoff } } : { replace: true })
  }

  const view: ParseView = !fileId
    ? 'missing-file'
    : consent.checking
      ? 'consent-checking'
      : consent.needsPrompt
        ? 'consent-needed'
        : outcome ?? 'waiting'
  const copy = VIEW[view]

  const renderFrame = (body: ReactNode, ctabar?: ReactNode) => (
    <QxPageFrame
      title="AI 解析"
      subtitle="等待服务端返回真实解析结果"
      status={copy.status}
      terminalLabel="AI 简历服务"
      back={{ label: '返回简历来源', onBack: leaveToSource }}
      ctabar={ctabar}
    >
      <section data-kiosk-domain="resume" data-kiosk-screen="resume-parse" data-state={view} className="qx-resume-triage">
        <ResumeTriageHero
          eyebrow={state?.intent === 'optimize' ? 'AI RESUME OPTIMIZE' : 'AI RESUME DIAGNOSE'}
          ask={copy.ask}
          doing={copy.doing}
          flag={copy.flag}
          warn={copy.warn}
          rail={copy.rail}
        />
        {body}
      </section>
    </QxPageFrame>
  )

  // 没有文件就不问授权：授权是为了把文件交给 AI，手里没文件时弹授权只会把人绕进去。
  if (!fileId) {
    return renderFrame(
      <div className="qx-rt-wait">
        <section className="qx-rt-fail" data-tone="warn">
          <h2 className="qx-rt-fail-t"><XCircleIcon size={24} aria-hidden="true" />未找到简历文件</h2>
          <p>请回到来源选择，把简历交进来后，再开始 AI 诊断。本页不会凭空开始解析。</p>
        </section>
      </div>,
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/resume/source')}>
        回到来源选择
      </button>,
    )
  }

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
            onCancel={leaveToSource}
            onConfirm={() => { void consent.confirm() }}
          />
        )}
      </>
    )
  }

  return renderFrame(
    <>
      <div className="qx-rt-wait">
        <section className="qx-card qx-rt-wait-card" data-live={failed ? undefined : 'true'}>
          {/* 装饰性处理标识：不表达百分比或服务端阶段 */}
          <span className="qx-rt-ring" data-tone={outcome === 'failed' ? 'bad' : outcome === 'unknown' ? 'warn' : undefined} aria-hidden="true">
            {failed ? <XCircleIcon size={44} /> : <SparklesIcon size={44} />}
          </span>
          <h2 className="qx-rt-wait-t" role="status" aria-live="polite">
            {outcome === 'failed' ? '解析出错' : outcome === 'unknown' ? '没等到解析结果' : '正在等待真实解析结果…'}
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
        onClick={() => {
          if (scanHandoff) { leaveToSource(); return }
          cancelRef.current = true
          navigate(-1)
        }}
      >
        <XCircleIcon size={20} aria-hidden="true" />
        返回上一步
      </button>
    </>,
  )
}
