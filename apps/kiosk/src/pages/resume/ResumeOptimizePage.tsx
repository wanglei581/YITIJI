import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { makePrintParams } from '@ai-job-print/shared'
import type { GeneratedResume, ResumeExportFormat, ResumeGenerateExportResponse, ResumeOptimizeModule, ResumeTemplate } from '@ai-job-print/shared'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import {
  adjustResumeLayoutDraft,
  exportGeneratedResume,
  exportResumeRecord,
  type ResumeLayoutAdjustAction,
} from '../../services/api'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useResumeLayout } from './hooks/useResumeLayout'
import { readAiResumeSession } from './aiResumeSession'
import { useResumeAiConsent } from './resumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { ResumeAigcBadge } from './components/resume-deliver/ResumeAigcBadge'
import { OptimizeReadyBody } from './components/resume-deliver/OptimizeReadyBody'
import { optimizeStateDescription, optimizeStateTitle } from './components/resume-deliver/optimizeStateCopy'
import { ResumeDeliverPanel } from './components/resume-deliver/ResumeDeliverPanel'
import { ResumeFactConfirmDialog } from './components/resume-deliver/ResumeFactConfirmDialog'
import { ResumeStatePanel } from './components/resume-deliver/ResumeStatePanel'
import { useResumeExportPricing } from './components/resume-deliver/useResumeExportPricing'
import { detectUnconfirmedAdditions, extractConfirmableFacts } from './components/resume-deliver/facts'
import { parseOptimizeQuery, resolveOptimizeView } from './components/resume-deliver/optimizeQuery'
import { useOptimizeLoad } from './components/resume-deliver/useOptimizeLoad'
import './resume-optimize-qx.css'

type LeaveAction = () => void

export function ResumeOptimizePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const consent = useResumeAiConsent()
  const state = location.state as Record<string, unknown> | null
  const query = useMemo(() => parseOptimizeQuery(location.search), [location.search])
  const session = useMemo(() => readAiResumeSession(), [])
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? query.taskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !query.taskId && Boolean(session?.taskId)
  const accessToken = (typeof state?.accessToken === 'string' ? state.accessToken : undefined)
    ?? (usingSessionTask ? session?.accessToken : undefined)
  const token = getToken()
  const access = { token, accessToken }
  const pricing = useResumeExportPricing(access, token)
  const { layout, setLayout, previewClassName, previewStyle } = useResumeLayout()

  const [modules, setModules] = useState<ResumeOptimizeModule[]>([])
  const [optimizedResume, setOptimizedResume] = useState<GeneratedResume | null>(null)
  const [loading, setLoading] = useState(true)
  const [failKind, setFailKind] = useState<'retry' | 'reparse' | 'expired' | 'consent' | 'outage'>('reparse')
  const [failMsg, setFailMsg] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [printNavigating, setPrintNavigating] = useState(false)
  const [exportFormat, setExportFormat] = useState<ResumeExportFormat>(query.format)
  const [exported, setExported] = useState<ResumeGenerateExportResponse | null>(null)
  const [exportKind, setExportKind] = useState<'resume' | 'change_list'>('resume')
  const [exportVersion, setExportVersion] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [resumeTemplates, setResumeTemplates] = useState<ResumeTemplate[]>([])
  const [templatesError, setTemplatesError] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState<LeaveAction | null>(null)
  const [adjusting, setAdjusting] = useState<ResumeLayoutAdjustAction | null>(null)
  const [lastResumeBeforeAiAdjust, setLastResumeBeforeAiAdjust] = useState<GeneratedResume | null>(null)
  const [adjustWarnings, setAdjustWarnings] = useState<string[]>([])
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [factOpen, setFactOpen] = useState<'resume' | 'change_list' | null>(null)
  const [savedToDocuments, setSavedToDocuments] = useState<boolean | undefined>(undefined)

  useBusyLock(exporting || printNavigating || Boolean(adjusting))
  const syntheticReady = query.capture || query.debug
  useOptimizeLoad({
    taskId, access, syntheticReady, requested: query.requested,
    consentChecking: consent.checking, consentNeedsPrompt: consent.needsPrompt, consentReady: consent.ready, retryNonce,
    setLoading, setFailKind, setFailMsg, setModules, setOptimizedResume,
    setTemplatesError, setResumeTemplates, setSelectedTemplateId,
  })

  const live = {
    hasTask: Boolean(taskId) || (syntheticReady && (query.requested === 'ready' || query.requested === 'empty')),
    loading,
    outage: failKind === 'outage',
    readError: Boolean(failMsg) && failKind === 'reparse',
    failed: Boolean(failMsg) && (failKind === 'retry' || failKind === 'expired'),
    empty: !loading && !failMsg && Boolean(taskId) && !optimizedResume && modules.length === 0,
    ready: Boolean(optimizedResume),
  }
  const resolved = resolveOptimizeView(query, live)
  const view = resolved.view
  const resume = optimizedResume
  const unconfirmed = resume ? detectUnconfirmedAdditions(resume, modules) : []
  const facts = resume ? extractConfirmableFacts(resume) : []
  const exportBlocked = pricing.unavailable || pricing.chargedBlocked || !resume || exporting
  const estimatedPagesLabel = exported?.pageCount
    ? `共 ${exported.pageCount} 页（上次导出）`
    : '导出后显示真实页数。若担心第二页只剩两三行，可先点「压到一页」。'

  const markEdited = () => { setIsDirty(true); setPreviewOpen(false); if (exported) setExported(null) }
  const requestLeave = (action: LeaveAction) => { if (isDirty && !exported) { setConfirmLeave(() => action); return } action() }
  const handleLayoutChange = (next: typeof layout) => { setLayout(next); markEdited() }
  const handleTemplateChange = (id: string) => { setSelectedTemplateId(id); setExportError(null); if (exported) setExported(null) }
  const handleExportFormatChange = (format: ResumeExportFormat) => { setExportFormat(format); setPreviewOpen(false); if (exported) setExported(null) }

  const runResumeExport = async (factsConfirmedAt: string) => {
    if (!optimizedResume) return
    setExporting(true); setExportError(null); setPreviewOpen(false)
    try {
      const result = await exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined, undefined, { benefitGrantId: pricing.benefitGrantId, factsConfirmedAt })
      setExported(result); setExportKind('resume'); setExportVersion((n) => n + 1); setIsDirty(false); setSavedToDocuments(undefined)
      if (result.signedUrl && exportFormat === 'pdf') setPreviewOpen(true)
    } catch (err) {
      setExportError(userMessageOf(err, '导出失败，请稍后重试'))
    } finally { setExporting(false); setFactOpen(null) }
  }

  const runChangeList = async (factsConfirmedAt: string) => {
    if (!taskId) return
    setExporting(true); setExportError(null)
    try {
      const result = await exportResumeRecord(taskId, { kind: 'change_list', benefitGrantId: pricing.benefitGrantId, factsConfirmedAt }, access)
      setExported(result); setExportKind('change_list'); setExportVersion((n) => n + 1); setSavedToDocuments(result.savedToDocuments)
      if (result.signedUrl) setPreviewOpen(true)
    } catch (err) {
      setExportError(userMessageOf(err, '修改清单导出失败，请稍后重试'))
    } finally { setExporting(false); setFactOpen(null) }
  }

  const handlePrint = () => {
    if (printNavigating || !exported?.printFileUrl) return
    setPrintNavigating(true)
    navigate('/print/confirm', {
      state: {
        file: {
          name: exported.filename,
          size: exported.sizeBytes >= 1024 * 1024 ? `${(exported.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(exported.sizeBytes / 1024))} KB`,
          pages: exported.pageCount, fileId: exported.fileId, fileUrl: exported.printFileUrl, mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const handleAiAdjust = async (action: ResumeLayoutAdjustAction) => {
    if (!taskId || !resume) return
    const before = resume; setAdjusting(action); setAdjustError(null)
    try {
      const result = await adjustResumeLayoutDraft(taskId, resume, action, layout, access)
      setLastResumeBeforeAiAdjust(before); setOptimizedResume(result.resume); setAdjustWarnings(result.warnings ?? []); setExported(null); setIsDirty(true)
    } catch (err) {
      setAdjustError(userMessageOf(err, 'AI 调整失败，请稍后重试或继续手动编辑'))
    } finally { setAdjusting(null) }
  }

  const ctabar = (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => requestLeave(() => navigate(-1))}>返回报告</button>
      {resume && (
        <button type="button" className="qx-btn" data-variant="primary" aria-disabled={exportBlocked || undefined} onClick={() => { if (!exportBlocked) setFactOpen('resume') }}>
          {exporting ? '正在生成文件…' : `确认优化版，导出 ${exportFormat === 'pdf' ? 'PDF' : exportFormat === 'docx' ? 'Word' : exportFormat === 'md' ? 'Markdown' : 'TXT'}`}
        </button>
      )}
    </>
  )

  if (consent.needsPrompt && !syntheticReady) {
    return (
      <QxPageFrame title="优化建议" subtitle="基于已有内容优化表达" ctabar={ctabar}>
        <section data-kiosk-domain="resume" data-kiosk-screen="resume-optimize" className="qx-resume-optimize" data-optimize-state="loading" />
        <ResumeAiConsentDialog busy={consent.busy} error={consent.error} guest={!token} onCancel={() => navigate(-1)} onConfirm={() => { void consent.confirm() }} />
      </QxPageFrame>
    )
  }

  const stateBody = view !== 'ready' ? (
    <ResumeStatePanel
      tone={view === 'unavailable' || view === 'read-error' || view === 'optimize-failed' || view === 'illegal' ? 'error' : view === 'loading' ? 'info' : 'empty'}
      title={optimizeStateTitle(view)}
      description={optimizeStateDescription(view, failMsg)}
      synthetic={resolved.synthetic}
      actions={
        <>
          {(view === 'optimize-failed' || view === 'unavailable' || failKind === 'retry' || failKind === 'consent') && (
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => { setFailMsg(null); setRetryNonce((n) => n + 1) }}>重试</button>
          )}
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source?intent=optimize')}>重新上传简历</button>
        </>
      }
    />
  ) : null

  return (
    <QxPageFrame title="优化建议" subtitle="换模板出新稿 · 表达调整参考，只重组原文事实" ctabar={ctabar}>
      <section
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-optimize"
        className={`qx-resume-optimize ${confirmLeave ? 'overflow-hidden' : ''}`}
        data-optimize-state={view}
        data-fallback={resolved.fallback ? '1' : undefined}
        data-synthetic={resolved.synthetic ? '1' : undefined}
      >
        <ResumeAigcBadge synthetic={resolved.synthetic} />
        {stateBody}
        {view === 'ready' && resume && (
          <div className="qx-rd-work">
            <OptimizeReadyBody
              resume={resume}
              modules={modules}
              unconfirmed={unconfirmed}
              layout={layout}
              previewClassName={previewClassName}
              previewStyle={previewStyle}
              loading={loading}
              exporting={exporting}
              adjusting={adjusting}
              lastResumeBeforeAiAdjust={lastResumeBeforeAiAdjust}
              adjustWarnings={adjustWarnings}
              adjustError={adjustError}
              onResumeChange={(next) => { markEdited(); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setOptimizedResume(next) }}
              onCompare={() => requestLeave(() => navigate('/resume/optimize/compare', { state: { taskId, accessToken } }))}
              onAiAdjust={(action) => { void handleAiAdjust(action) }}
              onUndoAi={() => { setOptimizedResume(lastResumeBeforeAiAdjust!); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setExported(null); setIsDirty(true) }}
            />
            <ResumeDeliverPanel
              layout={layout}
              onLayoutChange={handleLayoutChange}
              templates={resumeTemplates}
              templatesError={templatesError}
              selectedTemplateId={selectedTemplateId}
              onTemplateChange={handleTemplateChange}
              exportFormat={exportFormat}
              onExportFormatChange={handleExportFormatChange}
              exporting={exporting}
              printNavigating={printNavigating}
              exported={exported}
              exportKind={exportKind}
              exportError={exportError}
              exportVersion={exportVersion}
              pricing={pricing.pricing}
              pricingLoading={pricing.loading}
              blockedReason={pricing.blockedReason}
              exportBlocked={exportBlocked}
              onRequestExport={() => setFactOpen('resume')}
              onChangeList={() => setFactOpen('change_list')}
              changeListBusy={exporting && factOpen === 'change_list'}
              showChangeList={Boolean(taskId)}
              onPrint={handlePrint}
              onOpenPreview={() => setPreviewOpen(true)}
              guest={!token}
              savedToDocuments={savedToDocuments}
              estimatedPagesLabel={estimatedPagesLabel}
            />
          </div>
        )}
        {factOpen && resume && (
          <ResumeFactConfirmDialog
            facts={facts}
            unconfirmed={unconfirmed}
            busy={exporting}
            onCancel={() => setFactOpen(null)}
            onConfirm={(at) => { void (factOpen === 'change_list' ? runChangeList(at) : runResumeExport(at)) }}
          />
        )}
        {previewOpen && exported?.signedUrl && (
          <FilePreviewDialog fileUrl={exported.signedUrl} fileName={exported.filename} format={exportKind === 'change_list' ? 'pdf' : exportFormat} mimeType={exportKind === 'change_list' ? 'application/pdf' : undefined} phoneDownloadUrl={exported.signedUrl} expiresAt={exported.expiresAt} onClose={() => setPreviewOpen(false)} />
        )}
        {confirmLeave && (
          <div className="qx-rd-overlay">
            <div className="qx-rd-leave">
              <p>离开前确认</p>
              <p>你已经修改了优化版简历。未导出 PDF 前离开，本次编辑内容不会保存。</p>
              <div className="qx-rd-leave-actions">
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setConfirmLeave(null)}>继续编辑</button>
                <button type="button" className="qx-btn" data-variant="primary" onClick={() => { const action = confirmLeave; setConfirmLeave(null); action() }}>确认离开</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </QxPageFrame>
  )
}
