import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { HomeIcon, SparklesIcon, UserIcon } from 'lucide-react'
import type { ResumeParseResponse, ResumeReport, ResumeTargetContext } from '@ai-job-print/shared'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { getResumeRecord } from '../../services/api'
import { isAiOutage } from '../../ai'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { ResumeDiagnosisFailExits } from './components/ResumeDiagnosisFailExits'
import { readAiResumeSession } from './aiResumeSession'
import {
  deriveViewState,
  isExportCaptureState,
  parseReportSearch,
  REPORT_HEAD,
  REPORT_STATUS,
  shouldSkipReportFetch,
  showsReportBody,
  targetSummary,
  type ReportSeg,
} from './resume-report-model'
import { fixtureReport } from './resume-report-fixture'
import { ResumeReportHead } from './components/resume-report/ResumeReportChrome'
import { ResumeReportStates } from './components/resume-report/ResumeReportStates'
import { EmptyReportBody, ResumeReportBody } from './components/resume-report/ResumeReportBody'
import { ResumeReportCta } from './components/resume-report/ResumeReportActions'
import { ResumeReportTakeaway } from './components/resume-report/ResumeReportTakeaway'
import './resume-report-qx.css'

interface ReportState {
  intent?: string
  source?: string
  file?: { name: string; size: string; format: string; fileUrl?: string; mimeType?: string }
  taskId?: string
  accessToken?: string
  providerName?: string
  success?: boolean
  reason?: string
  report?: ResumeReport
  extractionNotice?: { textSource: string; confidence: 'high' | 'medium' | 'low'; warnings: string[] }
  targetContext?: ResumeTargetContext
}

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'report', 'taskId', 'accessToken', 'providerName'])
const CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', string> = { high: '较高', medium: '中等', low: '较低' }

function buildExtractionNotice(notice?: ReportState['extractionNotice']): string | null {
  if (!notice) return null
  const isOcr = notice.textSource === 'image_ocr' || notice.textSource === 'pdf_ocr'
  const warningText = notice.warnings.length > 0 ? notice.warnings.join('；') : ''
  if (isOcr) {
    const head = `本简历经文字识别（OCR）提取，识别置信度${CONFIDENCE_LABEL[notice.confidence]}。`
    return warningText ? `${head} ${warningText}。` : head
  }
  return warningText ? `${warningText}。` : null
}

function ReportNoticePanel({
  isDemoReport,
  extractionNotice,
  truncated,
}: {
  isDemoReport: boolean
  extractionNotice?: ReportState['extractionNotice']
  truncated?: boolean
}) {
  const notices = [
    isDemoReport ? COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE : null,
    isDemoReport
      ? '演示报告不基于你上传的文件内容生成，仅用于展示报告结构；它不会发送给企业，也不代表录用、面试或投递结果。'
      : '本报告仅基于上传文件中可解析出的内容生成，供本人修改简历时参考；不会发送给企业，也不代表录用、面试或投递结果。',
    buildExtractionNotice(extractionNotice),
    truncated ? '本次诊断只看了简历前若干字符，后面的内容块可能整块缺失，不是简历里没有那些部分。' : null,
    COMPLIANCE_COPY.KIOSK_RESUME_REPORT_DISCLAIMER,
    COMPLIANCE_COPY.KIOSK_RESUME_NO_SEND_ENTERPRISE,
  ].filter((item): item is string => Boolean(item))
  const ocr = extractionNotice && (extractionNotice.textSource === 'image_ocr' || extractionNotice.textSource === 'pdf_ocr')
  return (
    <>
      {truncated ? <p className="rrp-banner" data-kind="trunc" data-testid="resume-report-trunc">本次诊断没有看完整份简历（输入被截断）。</p> : null}
      {ocr ? <p className="rrp-banner" data-kind="ocr" data-testid="resume-report-ocr">{buildExtractionNotice(extractionNotice)}</p> : null}
      <section className="rrp-notice">
        <p className="text-sm font-semibold">报告说明</p>
        <ul>
          {notices.map((notice) => <li key={notice}>{notice}</li>)}
        </ul>
      </section>
    </>
  )
}

export function ResumeReportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as ReportState
  const intent = state.intent === 'optimize' ? 'optimize' : 'diagnose'
  const { success = true, reason } = state
  const parsed = useMemo(() => parseReportSearch(location.search), [location.search])
  const session = useMemo(() => readAiResumeSession(), [])
  const stateTaskId = typeof state.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? parsed.queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !parsed.queryTaskId && Boolean(session?.taskId)
  const accessToken = state.accessToken ?? (usingSessionTask ? session?.accessToken : undefined)

  const skipFetch = shouldSkipReportFetch(parsed.tech, parsed.urlState)
  const [report, setReport] = useState<ResumeReport | undefined>(state.report)
  const [providerName, setProviderName] = useState<string | undefined>(state.providerName)
  const [extractionNotice, setExtractionNotice] = useState(state.extractionNotice)
  const [targetContext, setTargetContext] = useState<ResumeTargetContext | undefined>(state.targetContext)
  const [loading, setLoading] = useState(!state.report && !!taskId && success && !skipFetch)
  const [loadError, setLoadError] = useState(false)
  const [outage, setOutage] = useState(false)
  const [recoveredFail, setRecoveredFail] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (skipFetch || (state.report && state.targetContext) || !taskId || !success) return
    let cancelled = false
    getResumeRecord(taskId, { token: getToken(), accessToken })
      .then((res: ResumeParseResponse & { targetContext?: ResumeTargetContext }) => {
        if (cancelled) return
        if (res.providerName) setProviderName(res.providerName)
        if (res.extractionNotice) setExtractionNotice(res.extractionNotice)
        if (res.targetContext) setTargetContext(res.targetContext)
        if (res.status === 'failed' || (!res.report && res.failReason)) {
          setRecoveredFail(res.failReason ?? '简历解析未能完成，请重试')
          return
        }
        if (res.report) setReport(res.report)
        else setLoadError(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isAiOutage(err)) setOutage(true)
        else setLoadError(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, success, state.report, state.targetContext, accessToken, getToken, skipFetch, reloadKey])

  const handleRetry = () => {
    const retryState = Object.fromEntries(Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)))
    navigate('/resume/parse', { state: retryState })
  }

  const viewState = deriveViewState({
    urlState: parsed.urlState,
    tech: parsed.tech,
    taskId,
    success,
    recoveredFail,
    loading,
    loadError,
    outage,
    report,
  })

  const fixtureKind = parsed.tech && (viewState === 'report' || isExportCaptureState(viewState))
    ? 'full'
    : parsed.tech && viewState === 'report-minimal'
      ? 'minimal'
      : parsed.tech && viewState === 'report-empty'
        ? 'empty'
        : null
  const displayReport = fixtureKind ? fixtureReport(fixtureKind) : report
  const displayIssues = displayReport?.issues ?? []
  const isFixture = Boolean(fixtureKind)
  const direction = targetContext ?? state.targetContext
  const summary = targetSummary(direction)

  const setSearch = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search)
    for (const [key, value] of Object.entries(over)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    navigate({ pathname: '/resume/report', search: next.toString() }, { replace: true, state })
  }

  const nav = (
    <>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/')} data-route="/" data-testid="resume-report-nav-home"><HomeIcon size={32} aria-hidden />首页</button>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/assistant')} data-route="/assistant" data-testid="resume-report-nav-advisor"><SparklesIcon size={32} aria-hidden />AI 顾问</button>
      <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')} data-route="/profile" data-testid="resume-report-nav-profile"><UserIcon size={32} aria-hidden />我的</button>
    </>
  )

  const failView = (failReason: string) => (
    <QxPageFrame title="简历诊断报告" subtitle="解析中断，你上传的文件没有丢。" status={REPORT_STATUS['diagnose-failed']} terminalLabel="就业服务大厅" navbar={nav} ctabar={<p className="why">这一屏一条 AI 结论都不给。</p>}>
      <section data-kiosk-domain="resume" data-kiosk-screen="resume-report" data-ai-down-exits="resume-diagnosis" data-state="diagnose-failed" data-testid="resume-report-state-diagnose-failed" className="qx-scroll rrp-page">
        <ResumeReportHead viewState="diagnose-failed" />
        <section className="rrp-state">
          <h2>解析中断，中断的只是「读懂它」这一步</h2>
          <p>失败原因：{failReason}。这一屏一条 AI 结论都不给 —— 没跑出来就是没有，不拿通用建议顶替。</p>
        </section>
        <ResumeDiagnosisFailExits file={state.file} onRetry={handleRetry} onHome={() => navigate('/')} />
      </section>
    </QxPageFrame>
  )

  if (!success) return failView(reason ?? '简历解析未能完成，请重试')
  if (recoveredFail && viewState === 'diagnose-failed' && !parsed.tech) return failView(recoveredFail)
  if (viewState === 'diagnose-failed') return failView(reason ?? recoveredFail ?? '简历解析未能完成，请重试')

  const isDemoReport = isFixture || providerName === 'mock'
  const canOptimize = Boolean(taskId) && (viewState === 'report' || viewState === 'report-minimal' || isExportCaptureState(viewState))
  const why =
    viewState === 'loading' ? '读取还没有结束，现在还不知道有没有报告，所以下一步先不给出口。'
    : viewState === 'unavailable' ? '能力没接通时不提供优化入口：优化和诊断走同一条 AI 链路，这时候点进去只会再失败一次。'
    : viewState === 'read-error' ? '优化那一步要用同一份报告作输入，报告没取到就先不给入口。'
    : viewState === 'report-empty' ? '报告里没有内容，优化那一步就没有可对照的原文片段，所以下一步先不给入口。'
    : viewState === 'no-context' || viewState === 'illegal' ? '没有可展示的报告时，从上传入口重新开始。'
    : !taskId && (viewState === 'report' || viewState === 'report-minimal') ? '这份报告没有对应的简历编号：优化那一步取不到原文，所以入口先关着。'
    : '本页只给这一次的诊断；想看改完之后的版本对照，去下一步的简历优化。'

  return (
    <QxPageFrame
      title="简历诊断报告"
      subtitle={REPORT_HEAD[viewState].sub}
      status={REPORT_STATUS[viewState]}
      terminalLabel="就业服务大厅"
      navbar={nav}
      ctabar={
        <ResumeReportCta
          viewState={viewState}
          canOptimize={canOptimize}
          intent={intent}
          why={why}
          onRetry={() => {
            setLoadError(false)
            setOutage(false)
            setLoading(true)
            setReloadKey((n) => n + 1)
            if (parsed.tech) setSearch({ state: 'loading' })
          }}
          onOptimize={() => navigate('/resume/optimize', { state: { ...state, taskId, accessToken, targetContext: state.targetContext ?? targetContext } })}
        />
      }
    >
      <section
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-report"
        data-route="/resume/report"
        data-state={viewState}
        data-testid={`resume-report-state-${viewState}`}
        data-fallback={parsed.fallback ? '1' : undefined}
        data-seg={displayReport ? (parsed.seg ?? 'structure') : 'none'}
        className="qx-scroll rrp-page"
        data-flat={parsed.flat ? '1' : undefined}
      >
        <ResumeReportHead viewState={viewState} />
        {isFixture ? (
          <div className="rrp-idbar" data-testid="resume-report-fixture">
            <span className="rrp-fx">合成演示</span>
            <span className="rrp-fxtx">合成数据，不是任何人的真实简历，也不是真实 AI 结果。</span>
          </div>
        ) : null}
        {showsReportBody(viewState) ? (
          <>
            <ReportNoticePanel isDemoReport={isDemoReport} extractionNotice={extractionNotice} truncated={displayReport?.truncatedInput} />
            {summary ? <p className="rrp-dir" data-testid="resume-report-target">目标方向 {summary}</p> : null}
            {displayReport ? (
              <ResumeReportBody
                report={displayReport}
                issues={displayIssues}
                fixture={isFixture}
                seg={parsed.seg}
                dim={parsed.dim}
                blk={parsed.blk}
                onSeg={(seg: ReportSeg) => setSearch({ seg, dim: null, blk: null })}
                onDim={(dim) => setSearch({ seg: 'scores', dim, blk: null })}
              />
            ) : null}
            <ResumeReportTakeaway
              key={viewState}
              show
              taskId={taskId}
              accessToken={accessToken}
              capture={isExportCaptureState(viewState) ? viewState : null}
              onJobFit={() => navigate('/resume/job-fit', { state: { taskId, accessToken } })}
            />
          </>
        ) : viewState === 'report-empty' ? (
          <EmptyReportBody />
        ) : (
          <ResumeReportStates viewState={viewState === 'loading' || viewState === 'no-context' || viewState === 'read-error' || viewState === 'unavailable' || viewState === 'illegal' ? viewState : 'no-context'} />
        )}
      </section>
    </QxPageFrame>
  )
}
