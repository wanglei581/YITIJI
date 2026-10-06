import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type {
  GeneratedResume,
  ResumeExportFormat,
  ResumeGenerateExportResponse,
  ResumeGenerateInput,
  ResumeGenerateResponse,
  ResumeTemplate,
} from '@ai-job-print/shared'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { exportGeneratedResume, getResumeGenerate } from '../../services/api'
import { getResumeTemplates } from '../../services/api/jobMaterials'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useResumeLayout } from './hooks/useResumeLayout'
import { ResumeAigcBadge } from './components/resume-deliver/ResumeAigcBadge'
import { ResumeFactConfirmDialog } from './components/resume-deliver/ResumeFactConfirmDialog'
import { ResumeStatePanel } from './components/resume-deliver/ResumeStatePanel'
import { GenerateResumeEditor } from './components/resume-deliver/GenerateResumeEditor'
import { ResumeFormatChooser } from './components/resume-deliver/ResumeFormatChooser'
import { useResumeExportPricing } from './components/resume-deliver/useResumeExportPricing'
import { detectUnconfirmedAdditions, extractConfirmableFacts } from './components/resume-deliver/facts'
import { SYNTHETIC_GENERATE } from './components/resume-deliver/fixtures'
import { parseGeneratePreviewQuery, resolveGeneratePreviewView } from './components/resume-deliver/generatePreviewQuery'
import type { GeneratePreviewViewState } from './components/resume-deliver/constants'
import { GeneratePreviewCta, GeneratePreviewEmptyExits, GeneratePreviewNavbar } from './GeneratePreviewChrome'
import { ResumeGenerateAdvisor, ResumeGenerateAiRow } from './components/ResumeGenerateQxChrome'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './resume-generate-qx.css'
import './resume-generate-preview-qx.css'

interface LocationState {
  result?: ResumeGenerateResponse
  input?: ResumeGenerateInput
  taskId?: string
  deliverPhase?: 'preview' | 'export'
}

const EXPORT_VIEWS = new Set<GeneratePreviewViewState>([
  'export-chooser',
  'export-exporting',
  'export-failed',
  'export-ready',
  'export-url-expired',
  'export-print-unavailable',
])

const FORMAT_NAME: Record<ResumeExportFormat, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  md: 'MD',
}

function readPhase(state: unknown): 'preview' | 'export' | null {
  if (!state || typeof state !== 'object') return null
  const value = (state as LocationState).deliverPhase
  return value === 'export' || value === 'preview' ? value : null
}

export function ResumeGeneratePreviewPage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const { getToken } = useAuth()
  const query = useMemo(() => parseGeneratePreviewQuery(location.search), [location.search])
  const state = location.state as LocationState | null
  const token = getToken()
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const restoreTaskId = !state?.result ? (stateTaskId ?? query.taskId ?? null) : null
  const access = { token, accessToken: undefined as string | undefined }
  const pricing = useResumeExportPricing(access, token)
  const { layout, setLayout, previewClassName, previewStyle } = useResumeLayout()
  const summaryRef = useRef<HTMLTextAreaElement>(null)

  const [resume, setResume] = useState<GeneratedResume | null>(state?.result?.resume ?? null)
  const [result, setResult] = useState<ResumeGenerateResponse | null>(state?.result ?? null)
  const [input] = useState<ResumeGenerateInput | undefined>(state?.input)
  const [restoring, setRestoring] = useState(Boolean(restoreTaskId) && !query.capture)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<ResumeGenerateExportResponse | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<ResumeExportFormat>(query.format)
  const [exportVersion, setExportVersion] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [printNavigating, setPrintNavigating] = useState(false)
  const [resumeTemplates, setResumeTemplates] = useState<ResumeTemplate[]>([])
  const [templatesError, setTemplatesError] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [editing, setEditing] = useState(false)
  const [factOpen, setFactOpen] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  useBusyLock(exporting || printNavigating)
  const synthetic = query.capture || query.debug

  useEffect(() => {
    const requested = query.requested
    const fixture = synthetic && requested && requested !== 'session-lost' && requested !== 'preview-no-result' && requested !== 'illegal'
    if (fixture && requested) {
      setResult(SYNTHETIC_GENERATE)
      setResume(SYNTHETIC_GENERATE.resume ?? null)
      setRestoring(false)
      setRestoreFailed(requested === 'preview-failed')
      setExporting(requested === 'export-exporting')
      setExportError(requested === 'export-failed' ? '这次没有生成文件，内容还在。' : null)
      if (requested === 'export-print-unavailable') setExportFormat('txt')
      const withFile = requested === 'export-ready' || requested === 'export-url-expired' || requested === 'export-print-unavailable'
      if (withFile) {
        const expired = requested === 'export-url-expired'
        const noPrint = requested === 'export-print-unavailable'
        setExported({
          fileId: 'capture-export',
          filename: noPrint ? 'AI简历_合成样本.txt' : 'AI简历_合成样本.pdf',
          sizeBytes: noPrint ? 4096 : 98304,
          pageCount: noPrint ? 0 : 1,
          signedUrl: '',
          expiresAt: new Date(Date.now() + (expired ? -60_000 : 30 * 60 * 1000)).toISOString(),
          printFileUrl: noPrint ? undefined : '/api/v1/files/capture-export/content?expires=1&sig=capture',
        })
      } else {
        setExported(null)
      }
      return
    }
    if (!restoreTaskId) { setRestoring(false); return }
    let cancelled = false
    getResumeGenerate(restoreTaskId, { token })
      .then((res) => {
        if (cancelled) return
        setResult(res)
        setResume(res.resume ?? null)
        setRestoreFailed(res.status === 'failed' || !res.resume)
      })
      .catch(() => { if (!cancelled) setRestoreFailed(true) })
      .finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [restoreTaskId, token, synthetic, query.requested, retryNonce])

  useEffect(() => {
    let cancelled = false
    getResumeTemplates()
      .then((templates) => {
        if (cancelled) return
        setTemplatesError(false)
        setResumeTemplates(templates)
        setSelectedTemplateId((current) => current && templates.some((item) => item.id === current) ? current : templates[0]?.id ?? '')
      })
      .catch(() => { if (!cancelled) { setTemplatesError(true); setResumeTemplates([]) } })
    return () => { cancelled = true }
  }, [])

  const expired = Boolean(exported?.expiresAt && Date.parse(exported.expiresAt) <= Date.now())
  const resolved = resolveGeneratePreviewView(query, {
    restoring,
    hasResult: Boolean(result && resume),
    restoreFailed,
    exporting,
    exportError: Boolean(exportError),
    exportedReady: Boolean(exported?.signedUrl) && !expired,
    exportedExpired: Boolean(exported) && expired,
    printUnavailable: Boolean(exported) && !exported?.printFileUrl && Boolean(exported?.signedUrl),
    hasHints: Boolean((result?.missingHints ?? []).length),
    editing,
  })
  const view = resolved.view
  const fixtureLock = Boolean(query.requested && (query.capture || query.debug))
  const phase: 'preview' | 'export' = fixtureLock
    ? (query.requested && EXPORT_VIEWS.has(query.requested) ? 'export' : 'preview')
    : (readPhase(location.state) === 'export' ? 'export' : 'preview')
  const exportScreen: GeneratePreviewViewState = view.startsWith('export-') ? view : 'export-chooser'
  const unconfirmed = resume ? detectUnconfirmedAdditions(resume, undefined, input) : []
  const facts = resume ? extractConfirmableFacts(resume) : []
  const hints = result?.missingHints ?? []
  const exportBlocked = pricing.unavailable || pricing.chargedBlocked || !resume || exporting
  const canPrint = exportFormat === 'pdf' && Boolean(exported?.printFileUrl)
  const estimatedPagesLabel = exported?.pageCount
    ? `共 ${exported.pageCount} 页（上次导出）`
    : '导出后显示真实页数。若担心第二页只剩两三行，可先点「压到一页」。'

  const handleExport = async (factsConfirmedAt: string) => {
    if (!resume || !result) return
    setExporting(true)
    setExportError(null)
    try {
      const file = await exportGeneratedResume(resume, result.taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined, undefined, { benefitGrantId: pricing.benefitGrantId, factsConfirmedAt })
      setExported(file)
      setExportVersion((n) => n + 1)
      if (file.signedUrl && exportFormat === 'pdf') setPreviewOpen(true)
    } catch (err) {
      setExportError(userMessageOf(err, '导出失败，请稍后重试'))
    } finally { setExporting(false); setFactOpen(false) }
  }

  const handlePrint = () => {
    if (!exported?.printFileUrl) return
    if (exportFormat !== 'pdf') return
    setPrintNavigating(true)
    startPrint({
      origin: 'resume_generate',
      returnPath: window.location.pathname,
      file: {
        name: exported.filename,
        size: exported.sizeBytes >= 1024 * 1024 ? `${(exported.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB`,
        pages: exported.pageCount,
        fileId: exported.fileId,
        fileUrl: exported.printFileUrl,
        mimeType: 'application/pdf',
      },
    })
  }

  const openExport = () => {
    const base = state && typeof state === 'object' ? state : {}
    navigate(
      { pathname: location.pathname, search: location.search },
      { state: { ...base, deliverPhase: 'export' } },
    )
  }

  const backToPreview = () => {
    if (readPhase(location.state) === 'export') {
      navigate(-1)
      return
    }
    const base = state && typeof state === 'object' ? state : {}
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: { ...base, deliverPhase: 'preview' } },
    )
  }

  const focusSummary = () => {
    summaryRef.current?.focus()
    summaryRef.current?.scrollIntoView({ block: 'center' })
  }

  const emptyCopy = view === 'preview-failed'
    ? { title: '这条记录没读回来', description: '可能已过留存期、不是本人，或者网络不通。不拿别的结果凑数。' }
    : view === 'preview-no-result'
      ? { title: '没有可看的结果', description: '预览要有一次已经完成的生成。这次进来没带结果，不会拿示例冒充你的简历。' }
      : view === 'illegal'
        ? { title: '认不出这个页面状态', description: '地址里的状态没有登记。这一页不猜你想去哪一步，也不把原始参数显示出来。' }
        : view === 'preview-loading'
          ? { title: '正在读取生成结果…', description: '读回来之前，这一页不显示任何简历内容。' }
          : { title: '生成结果已清除', description: '公共设备不保留个人信息。刷新、返回或待机之后，这一份要重新填写。' }

  const emptyNext = view === 'preview-failed'
    ? { ask: '换条路继续', doing: '可以再读一次，或者回去重填一遍。' }
    : view === 'preview-no-result'
      ? { ask: '先完成一次生成', doing: '回去填写，生成之后再到这里逐段核对。' }
      : view === 'illegal'
        ? { ask: '从简历服务重新进来', doing: '回到简历服务，再点一次「从零生成简历」。' }
        : view === 'preview-loading'
          ? { ask: '稍等一下', doing: '结果读回来后，就能逐段核对。' }
          : { ask: '需要重新生成', doing: '回去重新填写，就能再生成一份预览。' }

  const showWorkspace = Boolean(resume && result) && !['session-lost', 'preview-no-result', 'preview-loading', 'preview-failed', 'illegal'].includes(view)
  const canRetry = Boolean(restoreTaskId) && !synthetic
  const go = (to: string) => navigate(to)
  const onExportScreen = showWorkspace && phase === 'export'
  const ctabar = GeneratePreviewCta({
    view: onExportScreen ? exportScreen : view,
    phase,
    showWorkspace,
    exportBlocked,
    exporting,
    canPrint,
    printNavigating,
    formatName: FORMAT_NAME[exportFormat],
    canRetry,
    onHome: () => go('/'),
    onSource: () => go('/resume/source'),
    onRefill: () => go('/resume/generate'),
    onRetry: () => { setRestoreFailed(false); setRestoring(true); setRetryNonce((n) => n + 1) },
    onOpenExport: openExport,
    onBackToPreview: backToPreview,
    onConfirmExport: () => setFactOpen(true),
    onPrint: handlePrint,
  })

  const statusLabel = onExportScreen
    ? (exportScreen === 'export-exporting' ? '正在生成文件' : exportScreen === 'export-failed' ? '这次没导出' : exportScreen === 'export-ready' ? '文件已好' : exportScreen === 'export-url-expired' ? '下载链接过期' : exportScreen === 'export-print-unavailable' ? '暂时不能打印' : '选格式')
    : (view === 'preview-loading' ? '正在读回这次结果' : view === 'preview-failed' ? '这次没读回来' : view === 'illegal' ? '认不出这一页' : showWorkspace ? '核对这一次的结果' : '预览')

  const advisor = onExportScreen
    ? { eyebrow: '导出', ask: exportScreen === 'export-chooser' ? '要哪种格式？' : exportScreen === 'export-exporting' ? '正在生成文件' : exportScreen === 'export-failed' ? '文件没生成出来' : exportScreen === 'export-ready' ? '文件好了' : exportScreen === 'export-url-expired' ? '扫码取件这条过期了' : '这一份暂时进不了打印', doing: exportScreen === 'export-chooser' ? '四种都能导出。页数、版式和打印目前只有 PDF 有。' : '核对过的内容还在。这一步只出文件，不改描述。' }
    : showWorkspace
      ? { eyebrow: '预览', ask: '生成好了，你核一遍', doing: '事实和你填的逐字一致。被润色过的段落会标明供参考。' }
      : { eyebrow: '预览', ask: emptyNext.ask, doing: emptyNext.doing }

  return (
    <QxPageFrame
      title="简历预览"
      subtitle="核对内容后带走"
      status={{
        tone: view === 'preview-failed' || view === 'illegal' || view === 'export-failed' ? 'bad' : view === 'preview-loading' || view === 'export-exporting' ? 'warn' : view === 'preview-ready' || view === 'export-ready' ? 'ok' : 'unknown',
        label: statusLabel,
      }}
      back={{
        label: onExportScreen ? '返回预览' : '返回填写',
        onBack: () => { if (onExportScreen) backToPreview(); else go('/resume/generate') },
      }}
      navbar={<GeneratePreviewNavbar onNavigate={go} />}
      ctabar={<>{ctabar}<ResumeGenerateAiRow /></>}
    >
      <section
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-generate-preview"
        className="qx-resume-generate qx-scroll"
        data-generate-state={view}
        data-deliver-phase={phase}
        data-fallback={resolved.fallback ? '1' : undefined}
        data-synthetic={resolved.synthetic ? '1' : undefined}
      >
        <ResumeGenerateAdvisor eyebrow={advisor.eyebrow} ask={advisor.ask} doing={advisor.doing} />
        <ResumeAigcBadge synthetic={resolved.synthetic} />
        {!showWorkspace && (
          <>
            <ResumeStatePanel
              tone={view === 'preview-failed' || view === 'illegal' ? 'error' : view === 'preview-loading' ? 'info' : 'empty'}
              title={emptyCopy.title}
              description={emptyCopy.description}
              synthetic={resolved.synthetic}
            />
            {view === 'preview-failed' && !canRetry && (
              <p id="resume-generate-preview-retry-why" className="qx-rd-why">没有可回读的记录。请重新填一份，或从「我的简历」打开还在保存期限内的版本。</p>
            )}
            <GeneratePreviewEmptyExits view={view} onNavigate={go} />
          </>
        )}
        {showWorkspace && resume && result && !onExportScreen && (
          <div className="qx-rg-review">
            <div className="qx-card">
              <div className="qx-sec-h">
                <span className="qx-rg-no">01</span>
                <h2 className="t">生成结果</h2>
                <span className="hint">AI 生成，供参考</span>
              </div>
              <GenerateResumeEditor
                resume={resume}
                summaryRef={summaryRef}
                onChange={(next) => { setResume(next); setExported(null); setExportError(null) }}
                previewClassName={previewClassName}
                previewStyle={previewStyle}
                onEditingChange={setEditing}
              />
            </div>
            {unconfirmed.length > 0 && <p className="qx-rd-pending">待本人确认：{unconfirmed.join('、')}</p>}
            <div className="qx-rg-help">
              <p>
                润色只动个人简介和各段描述。学校、专业、学历、公司、职务、项目名、证书和时间段按你填的保留。
                {hints.length > 0 ? `另外还有 ${hints.length} 处建议补充。` : ''}
              </p>
              <button type="button" className="qx-rg-hbtn" onClick={focusSummary}>改一段描述</button>
              <button type="button" className="qx-rg-hbtn" onClick={() => document.getElementById('resume-generate-preview-hints')?.scrollIntoView({ block: 'center' })}>
                {hints.length > 0 ? `看这 ${hints.length} 处` : '看缺失提示'}
              </button>
            </div>
            <div id="resume-generate-preview-hints" className="qx-rg-hints">
              {hints.length > 0 ? hints.map((hint) => <p key={hint}>{hint}</p>) : <p>按当前内容，没有要补充的项。不补也能导出。</p>}
            </div>
            <div className="qx-rg-help">
              <p>{token ? '这一页先在屏幕上核对。导出之后可以扫码带走，登录状态下按保存期限留在账号里。' : '这一页只在屏幕上。没登录时导出的文件不会进账号，事后登录也不补绑。要留底就先登录，再生成、再导出。'}</p>
              <button type="button" className="qx-rg-hbtn" data-route="/help" onClick={() => go('/help')}>问小青</button>
            </div>
            <p className="qx-rg-reason">事实内容要改，得回填写页改。这一页改的是描述，改完就留在这一份上。</p>
          </div>
        )}
        {showWorkspace && onExportScreen && (
          <ResumeFormatChooser
            screen={exportScreen}
            format={exportFormat}
            onFormatChange={(format) => { setExportFormat(format); setExported(null); setExportError(null) }}
            layout={layout}
            onLayoutChange={(next) => { setLayout(next); setExported(null); setExportError(null) }}
            templates={resumeTemplates}
            templatesError={templatesError}
            selectedTemplateId={selectedTemplateId}
            onTemplateChange={(id) => { setSelectedTemplateId(id); setExported(null); setExportError(null) }}
            exporting={exporting}
            exported={exported}
            exportError={exportError}
            exportVersion={exportVersion}
            pricing={pricing.pricing}
            pricingLoading={pricing.loading}
            blockedReason={pricing.blockedReason}
            guest={!token}
            synthetic={resolved.synthetic}
            printNavigating={printNavigating}
            onPrint={handlePrint}
            onOpenPreview={() => setPreviewOpen(true)}
            onClearExport={() => { setExported(null); setExportError(null) }}
            onHelp={() => go('/help')}
            estimatedPagesLabel={estimatedPagesLabel}
          />
        )}
        {factOpen && resume && (
          <ResumeFactConfirmDialog facts={facts} unconfirmed={unconfirmed} busy={exporting} onCancel={() => setFactOpen(false)} onConfirm={(at) => { void handleExport(at) }} />
        )}
        {previewOpen && exported?.signedUrl && (
          <FilePreviewDialog fileUrl={exported.signedUrl} fileName={exported.filename} format={exportFormat} phoneDownloadUrl={exported.signedUrl} expiresAt={exported.expiresAt} primaryAction={exported.printFileUrl && exportFormat === 'pdf' ? { label: '去打印这一份', onClick: handlePrint, disabled: printNavigating } : undefined} onClose={() => setPreviewOpen(false)} />
        )}
      </section>
    </QxPageFrame>
  )
}
