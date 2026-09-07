import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { makePrintParams, type ResumeExportFormat } from '@ai-job-print/shared'
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
import { DEFAULT_RESUME_LAYOUT, useResumeLayout } from './hooks/useResumeLayout'
import { readAiResumeSession } from './aiResumeSession'
import { useResumeAiConsent } from './resumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { ResumeAigcBadge } from './components/resume-deliver/ResumeAigcBadge'
import { OptimizeWorkArea } from './components/resume-deliver/OptimizeWorkArea'
import { optimizeStateDescription, optimizeStateTitle } from './components/resume-deliver/optimizeStateCopy'
import { ResumeDraftBanner } from './components/resume-deliver/ResumeDraftBanner'
import { ResumeFactConfirmDialog } from './components/resume-deliver/ResumeFactConfirmDialog'
import { ResumeOptimizeLeaveDialog } from './components/resume-deliver/ResumeOptimizeLeaveDialog'
import { ResumeStatePanel } from './components/resume-deliver/ResumeStatePanel'
import { useResumeExportPricing } from './components/resume-deliver/useResumeExportPricing'
import { useResumeDraftAutosave } from './components/resume-deliver/useResumeDraftAutosave'
import { detectUnconfirmedAdditions, extractConfirmableFacts } from './components/resume-deliver/facts'
import { parseOptimizeQuery, resolveOptimizeView } from './components/resume-deliver/optimizeQuery'
import { useOptimizeLoad } from './components/resume-deliver/useOptimizeLoad'
import { printFileSizeLabel, useOptimizeSession } from './components/resume-deliver/useOptimizeSession'
import {
  applyResumeDecisions,
  moduleKeyOf,
  parseDecisionMap,
  toggleModuleDecision,
  type ResumeModuleDecision,
} from './components/resume-deliver/resumeDecisions'
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
  const {
    modules, setModules, optimizedResume, setOptimizedResume, loading, setLoading,
    failKind, setFailKind, failMsg, setFailMsg, retryNonce, setRetryNonce,
    exporting, setExporting, printNavigating, setPrintNavigating, exportFormat, setExportFormat,
    exported, setExported, exportKind, setExportKind, exportVersion, setExportVersion,
    previewOpen, setPreviewOpen, exportError, setExportError, resumeTemplates, setResumeTemplates,
    templatesError, setTemplatesError, selectedTemplateId, setSelectedTemplateId,
    isDirty, setIsDirty, confirmLeave, setConfirmLeave, adjusting, setAdjusting,
    lastResumeBeforeAiAdjust, setLastResumeBeforeAiAdjust, adjustWarnings, setAdjustWarnings,
    adjustError, setAdjustError, factOpen, setFactOpen, savedToDocuments, setSavedToDocuments,
    decisions, setDecisions, draftAccepted, setDraftAccepted,
  } = useOptimizeSession(query.format, Boolean(token))

  useBusyLock(exporting || printNavigating || Boolean(adjusting))
  const syntheticReady = query.capture || query.debug
  useOptimizeLoad({
    taskId, access, syntheticReady, requested: query.requested,
    consentChecking: consent.checking, consentNeedsPrompt: consent.needsPrompt, consentReady: consent.ready, retryNonce,
    setLoading, setFailKind, setFailMsg, setModules, setOptimizedResume,
    setTemplatesError, setResumeTemplates, setSelectedTemplateId,
  })

  const draft = useResumeDraftAutosave({
    taskId, token: token ?? null, resume: optimizedResume, layout, decisions, skipFetch: syntheticReady,
    enabled: Boolean(token && taskId && draftAccepted && optimizedResume && !syntheticReady),
  })

  useEffect(() => {
    if (!token || syntheticReady) { setDraftAccepted(true); return }
    if (!consent.ready || draft.loading) return
    if (!draft.hasDraft) setDraftAccepted(true)
  }, [token, syntheticReady, consent.ready, draft.loading, draft.hasDraft, setDraftAccepted])

  const live = {
    hasTask: Boolean(taskId) || (syntheticReady && (query.requested === 'ready' || query.requested === 'empty')),
    loading, outage: failKind === 'outage', readError: Boolean(failMsg) && failKind === 'reparse',
    failed: Boolean(failMsg) && (failKind === 'retry' || failKind === 'expired'),
    empty: !loading && !failMsg && Boolean(taskId) && !optimizedResume && modules.length === 0,
    ready: Boolean(optimizedResume),
  }
  const resolved = resolveOptimizeView(query, live)
  const view = resolved.view
  const resume = optimizedResume
  const assembled = resume ? applyResumeDecisions(resume, modules, decisions) : null
  const unconfirmed = assembled ? detectUnconfirmedAdditions(assembled, modules) : []
  const facts = assembled ? extractConfirmableFacts(assembled) : []
  const exportBlocked = pricing.unavailable || pricing.chargedBlocked || !assembled || exporting
  const estimatedPagesLabel = exported?.pageCount ? `共 ${exported.pageCount} 页（上次导出）` : '导出后显示真实页数。若担心第二页只剩两三行，可先点「压到一页」。'
  const editorOpen = view === 'ready' && Boolean(resume) && draftAccepted && !draft.loading
  const choicePending = Boolean(token && draft.hasDraft && !draftAccepted && view === 'ready')

  const markEdited = () => { setIsDirty(true); setPreviewOpen(false); if (exported) setExported(null) }
  const requestLeave = (action: LeaveAction) => {
    if (draft.unsaved || (isDirty && !exported && !token)) { setConfirmLeave(() => action); return }
    action()
  }
  const handleLayoutChange = (next: typeof layout) => { setLayout(next); markEdited() }
  const handleTemplateChange = (id: string) => { setSelectedTemplateId(id); setExportError(null); if (exported) setExported(null) }
  const handleExportFormatChange = (format: ResumeExportFormat) => { setExportFormat(format); setPreviewOpen(false); if (exported) setExported(null) }
  const handleDecisionChange = (key: string, next: ResumeModuleDecision) => {
    const index = modules.findIndex((item, i) => moduleKeyOf(item, i) === key)
    if (index < 0 || !optimizedResume) return
    setOptimizedResume(toggleModuleDecision(optimizedResume, modules[index], decisions[key] ?? 'optimized', next))
    setDecisions((prev) => ({ ...prev, [key]: next }))
    markEdited()
  }
  const handleContinueDraft = () => {
    const payload = draft.remoteDraft
    if (payload?.resume) {
      const nextDecisions = parseDecisionMap(payload.decisions)
      setDecisions(nextDecisions)
      setOptimizedResume(applyResumeDecisions(payload.resume, modules, nextDecisions))
      if (payload.layout) setLayout({ ...DEFAULT_RESUME_LAYOUT, ...payload.layout })
    }
    setIsDirty(false)
    setDraftAccepted(true)
  }

  const runResumeExport = async (factsConfirmedAt: string) => {
    if (!assembled) return
    const optimizedResume = assembled
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
        file: { name: exported.filename, size: printFileSizeLabel(exported.sizeBytes), pages: exported.pageCount, fileId: exported.fileId, fileUrl: exported.printFileUrl, mimeType: 'application/pdf' },
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
      {assembled && editorOpen && (
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

  const retryable = view === 'optimize-failed' || view === 'unavailable' || failKind === 'retry' || failKind === 'consent'
  const stateBody = view === 'ready' ? null : (
    <ResumeStatePanel
      tone={view === 'loading' ? 'info' : view === 'empty' || view === 'no-context' ? 'empty' : 'error'}
      title={optimizeStateTitle(view)}
      description={optimizeStateDescription(view, failMsg)}
      synthetic={resolved.synthetic}
      actions={
        <>
          {retryable && <button type="button" className="qx-btn" data-variant="primary" onClick={() => { setFailMsg(null); setRetryNonce((n) => n + 1) }}>重试</button>}
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source?intent=optimize')}>重新上传简历</button>
        </>
      }
    />
  )

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
        {view === 'ready' && (
          <ResumeDraftBanner
            guest={!token}
            loading={Boolean(token && draft.loading)}
            choicePending={choicePending}
            draftUpdatedAt={draft.remoteDraft?.updatedAt}
            onContinue={handleContinueDraft}
            onRestart={() => { setDecisions({}); draft.requestOverwrite(); setDraftAccepted(true) }}
            saveStatus={draft.status}
            savedAt={draft.savedAt}
          />
        )}
        {editorOpen && resume && assembled && (
          <OptimizeWorkArea
            resume={resume}
            modules={modules}
            decisions={decisions}
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
            templates={resumeTemplates}
            templatesError={templatesError}
            selectedTemplateId={selectedTemplateId}
            exportFormat={exportFormat}
            printNavigating={printNavigating}
            exported={exported}
            exportKind={exportKind}
            exportError={exportError}
            exportVersion={exportVersion}
            pricing={pricing.pricing}
            pricingLoading={pricing.loading}
            blockedReason={pricing.blockedReason}
            exportBlocked={exportBlocked}
            changeListBusy={exporting && factOpen === 'change_list'}
            showChangeList={Boolean(taskId)}
            guest={!token}
            savedToDocuments={savedToDocuments}
            estimatedPagesLabel={estimatedPagesLabel}
            taskId={taskId}
            token={token}
            onDecisionChange={handleDecisionChange}
            onResumeChange={(next) => { markEdited(); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setOptimizedResume(next) }}
            onCompare={() => requestLeave(() => navigate('/resume/optimize/compare', { state: { taskId, accessToken } }))}
            onAiAdjust={(action) => { void handleAiAdjust(action) }}
            onUndoAi={() => { setOptimizedResume(lastResumeBeforeAiAdjust!); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setExported(null); setIsDirty(true) }}
            onLayoutChange={handleLayoutChange}
            onTemplateChange={handleTemplateChange}
            onExportFormatChange={handleExportFormatChange}
            onRequestExport={() => setFactOpen('resume')}
            onChangeList={() => setFactOpen('change_list')}
            onPrint={handlePrint}
            onOpenPreview={() => setPreviewOpen(true)}
          />
        )}
        {factOpen && assembled && (
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
          <ResumeOptimizeLeaveDialog
            guest={!token}
            onStay={() => setConfirmLeave(null)}
            onLeave={() => { const action = confirmLeave; setConfirmLeave(null); action() }}
          />
        )}
      </section>
    </QxPageFrame>
  )
}
