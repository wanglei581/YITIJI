import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { makePrintParams } from '@ai-job-print/shared'
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
import { ResumeAigcBadge, ResumeHtmlPreviewNote } from './components/resume-deliver/ResumeAigcBadge'
import { ResumeDeliverPanel } from './components/resume-deliver/ResumeDeliverPanel'
import { ResumeFactConfirmDialog } from './components/resume-deliver/ResumeFactConfirmDialog'
import { ResumeStatePanel } from './components/resume-deliver/ResumeStatePanel'
import { GenerateResumeEditor } from './components/resume-deliver/GenerateResumeEditor'
import { useResumeExportPricing } from './components/resume-deliver/useResumeExportPricing'
import { detectUnconfirmedAdditions, extractConfirmableFacts } from './components/resume-deliver/facts'
import { SYNTHETIC_GENERATE } from './components/resume-deliver/fixtures'
import { parseGeneratePreviewQuery, resolveGeneratePreviewView } from './components/resume-deliver/generatePreviewQuery'
import { GeneratePreviewCta, GeneratePreviewEmptyExits, GeneratePreviewNavbar } from './GeneratePreviewChrome'
import './resume-generate-qx.css'

interface LocationState {
  result?: ResumeGenerateResponse
  input?: ResumeGenerateInput
  taskId?: string
}

export function ResumeGeneratePreviewPage() {
  const navigate = useNavigate()
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
    if (synthetic && query.requested && query.requested !== 'session-lost' && query.requested !== 'preview-no-result' && query.requested !== 'illegal') {
      setResult(SYNTHETIC_GENERATE)
      setResume(SYNTHETIC_GENERATE.resume ?? null)
      setRestoring(false)
      setRestoreFailed(query.requested === 'preview-failed')
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
  const unconfirmed = resume ? detectUnconfirmedAdditions(resume, undefined, input) : []
  const facts = resume ? extractConfirmableFacts(resume) : []
  const exportBlocked = pricing.unavailable || pricing.chargedBlocked || !resume || exporting
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
    setPrintNavigating(true)
    navigate('/print/confirm', {
      state: {
        file: {
          name: exported.filename,
          size: exported.sizeBytes >= 1024 * 1024 ? `${(exported.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB`,
          pages: exported.pageCount,
          fileId: exported.fileId,
          fileUrl: exported.printFileUrl,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const emptyCopy = view === 'preview-failed'
    ? { title: '这条记录没读回来', description: '可能已过留存期、不是本人，或者网络不通。不拿别的结果凑数。' }
    : view === 'preview-no-result'
      ? { title: '没有可看的结果', description: '预览要有一次已经完成的生成。这次进来没带结果，不会拿示例冒充你的简历。' }
      : view === 'illegal'
        ? { title: '地址无效', description: '查询参数无法识别，已按失败关闭处理，不回显原始地址。' }
        : view === 'preview-loading'
          ? { title: '正在读取生成结果…', description: '读回来之前，这一页不显示任何简历内容。' }
          : { title: '生成结果已清除', description: '公共设备不保留个人信息。请重新填写后生成简历预览。' }

  const showWorkspace = Boolean(resume && result) && !['session-lost', 'preview-no-result', 'preview-loading', 'preview-failed', 'illegal'].includes(view)
  const canRetry = Boolean(restoreTaskId) && !synthetic
  const go = (to: string) => navigate(to)
  const ctabar = GeneratePreviewCta({
    view,
    showWorkspace,
    exportBlocked,
    exporting,
    canRetry,
    onHome: () => go('/'),
    onSource: () => go('/resume/source'),
    onRefill: () => go('/resume/generate'),
    onRetry: () => { setRestoreFailed(false); setRestoring(true); setRetryNonce((n) => n + 1) },
    onExport: () => setFactOpen(true),
  })

  return (
    <QxPageFrame title="简历预览" subtitle="核对内容后带走 · 语音生成的结果同样走这一套导出" navbar={<GeneratePreviewNavbar onNavigate={go} />} ctabar={ctabar ?? undefined}>
      <section
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-generate-preview"
        className="qx-resume-generate"
        data-generate-state={view}
        data-fallback={resolved.fallback ? '1' : undefined}
        data-synthetic={resolved.synthetic ? '1' : undefined}
      >
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
              <p id="resume-generate-preview-retry-why" className="qx-rd-why">没有记录标识，读不回来。请重新填一份，或从「我的简历」打开还在留存期内的版本。</p>
            )}
            <GeneratePreviewEmptyExits view={view} onNavigate={go} />
          </>
        )}
        {showWorkspace && resume && result && (
          <div className="qx-rd-work">
            <div className="qx-rd-main">
              <ResumeHtmlPreviewNote />
              {unconfirmed.length > 0 && <p className="qx-rd-unconfirmed">待本人确认：{unconfirmed.join('、')}</p>}
              {(result.missingHints ?? []).length > 0 && (
                <div className="qx-card qx-rd-hints">
                  <h3>建议补充</h3>
                  <p>AI 不会替你编造这些内容</p>
                  {(result.missingHints ?? []).map((hint) => <p key={hint} className="qx-rd-hint">{hint}</p>)}
                </div>
              )}
              <GenerateResumeEditor resume={resume} onChange={(next) => { setResume(next); setExported(null) }} previewClassName={previewClassName} previewStyle={previewStyle} onEditingChange={setEditing} />
              <p>所有描述均可直接点击修改；事实信息(学校/公司/证书)以你填写的为准。</p>
            </div>
            <ResumeDeliverPanel
              layout={layout}
              onLayoutChange={(next) => { setLayout(next); setExported(null) }}
              templates={resumeTemplates}
              templatesError={templatesError}
              selectedTemplateId={selectedTemplateId}
              onTemplateChange={(id) => { setSelectedTemplateId(id); setExported(null) }}
              exportFormat={exportFormat}
              onExportFormatChange={(format) => { setExportFormat(format); setExported(null) }}
              exporting={exporting}
              printNavigating={printNavigating}
              exported={exported}
              exportKind="resume"
              exportError={exportError}
              exportVersion={exportVersion}
              pricing={pricing.pricing}
              pricingLoading={pricing.loading}
              blockedReason={pricing.blockedReason}
              exportBlocked={exportBlocked}
              onRequestExport={() => setFactOpen(true)}
              showChangeList={false}
              onPrint={handlePrint}
              onOpenPreview={() => setPreviewOpen(true)}
              guest={!token}
              estimatedPagesLabel={estimatedPagesLabel}
              printLabel="去打印这份简历"
            />
          </div>
        )}
        {factOpen && resume && (
          <ResumeFactConfirmDialog facts={facts} unconfirmed={unconfirmed} busy={exporting} onCancel={() => setFactOpen(false)} onConfirm={(at) => { void handleExport(at) }} />
        )}
        {previewOpen && exported?.signedUrl && (
          <FilePreviewDialog fileUrl={exported.signedUrl} fileName={exported.filename} format={exportFormat} phoneDownloadUrl={exported.signedUrl} expiresAt={exported.expiresAt} onClose={() => setPreviewOpen(false)} />
        )}
      </section>
    </QxPageFrame>
  )
}
