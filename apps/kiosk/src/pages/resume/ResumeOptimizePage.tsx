import { useKioskLicense, useWindDownViewOnly } from '../../layouts/KioskLicenseContext'
import { LICENSE_NO_NEW_TASK_REASON } from '../../copy/unattendedCopy'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { type GeneratedResume, type ResumeExportFormat } from '@ai-job-print/shared'
import { rememberAssistantDraft } from '../../services/assistantDraft'
import { useSupportContact } from '../../hooks/useSupportContact'
import { unattendedResumeCopy } from './touch/unattendedResumeCopy'
import { ResumeTouchPage } from './touch/ResumeTouchPage'
import { frameTextOf, saveInfoOf, type OptimizePane } from './touch/optimizeFrame'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import { getMyDocuments } from '../../services/api/memberAssets'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import {
  adjustResumeLayoutDraft,
  exportGeneratedResume,
  exportResumeRecord,
  type ResumeLayoutAdjustAction,
} from '../../services/api'
import { isAiOutage, useAiTask } from '../../ai'
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useResumeLayout } from './hooks/useResumeLayout'
import { readAiResumeSession } from './aiResumeSession'
import { useResumeAiConsent } from './resumeAiConsent'
import { RESUME_AI_CONSENT_NEEDED_COPY } from './resumeAiConsentPrompt'
import { useInlineResumeAiConsent } from './useInlineResumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { optimizeExportErrorMessage, optimizeStateDescription, optimizeStateTitle } from './components/resume-deliver/optimizeStateCopy'
import { OptimizeBodyPanes } from './components/resume-deliver/OptimizeBodyPanes'
import { buildOptimizeDockControls } from './components/resume-deliver/optimizeDockModel'
import { ResumeFactConfirmDialog } from './components/resume-deliver/ResumeFactConfirmDialog'
import { ResumeOptimizeLeaveDialog } from './components/resume-deliver/ResumeOptimizeLeaveDialog'
import { useResumeExportPricing } from './components/resume-deliver/useResumeExportPricing'
import { useResumeDraftAutosave } from './components/resume-deliver/useResumeDraftAutosave'
import { detectUnconfirmedAdditions, extractConfirmableFacts } from './components/resume-deliver/facts'
import { parseOptimizeQuery, resolveOptimizeView } from './components/resume-deliver/optimizeQuery'
import { useOptimizeDecisions } from './components/resume-deliver/useOptimizeDecisions'
import { useOptimizeEditFocus } from './components/resume-deliver/useOptimizeEditFocus'
import { useOptimizeLoad } from './components/resume-deliver/useOptimizeLoad'
import { printFileSizeLabel, useOptimizeSession } from './components/resume-deliver/useOptimizeSession'
import { moduleKeyOf, type ResumeDecisionFailure, type ResumeModuleDecision } from './components/resume-deliver/resumeDecisions'
import { CompareDecisionsApplyDialog } from './components/resume-deliver/CompareDecisionsApplyDialog'
import { focusResumeTitleIssue, resumeTitleIssues } from './components/resume-deliver/resumeEntryTitles'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './resume-optimize-qx.css'
import './touch/optimize.css'

type LeaveAction = () => void

export function ResumeOptimizePage() {
  const navigate = useNavigate()
  const contact = useSupportContact()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null
  const windDownViewOnly = useWindDownViewOnly('resume')
  const licenseFlagViewOnly = useKioskLicense().mode === 'winding-down' && state?.licenseViewOnly === true
  const viewOnly = windDownViewOnly || licenseFlagViewOnly
  const query = useMemo(() => parseOptimizeQuery(location.search), [location.search])
  const [workView, setWorkView] = useState<OptimizePane>(() => new URLSearchParams(location.search).get('screen') === 'editor' || state?.decisions ? 'editor' : 'overview')
  const existingOnly = new URLSearchParams(location.search).get('saved') === '1' || new URLSearchParams(location.search).get('existingOnly') === '1' || state?.existingOnly === true
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
  const consent = useResumeAiConsent()
  const resumeAiConsent = useInlineResumeAiConsent(() => {
    setAdjustError(RESUME_AI_CONSENT_NEEDED_COPY)
  })
  const [adjustOutage, setAdjustOutage] = useState(false)
  const [baseResume, setBaseResume] = useState<GeneratedResume | null>(null)
  /** 核对事实的时刻与当时那份稿的指纹；稿一改指纹对不上，就得重新核对。 */
  const [factsConfirmed, setFactsConfirmed] = useState<{ at: string; sig: string } | null>(null)

  useBusyLock(exporting || printNavigating || Boolean(adjusting))
  const syntheticReady = query.capture || query.debug
  useOptimizeLoad({
    taskId, access, syntheticReady, requested: query.requested,
    existingOnly,
    consentChecking: consent.checking, consentNeedsPrompt: consent.needsPrompt, consentReady: consent.ready, retryNonce,
    setLoading, setFailKind, setFailMsg, setModules, setOptimizedResume, setBaseResume,
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
  // 编辑区里的稿已经是裁决之后的样子。导出用这一份，不再对全文做第二次替换。
  const assembled = resume
  const unconfirmed = assembled ? detectUnconfirmedAdditions(assembled, modules) : []
  const facts = assembled ? extractConfirmableFacts(assembled) : []
  const factsValid = Boolean(factsConfirmed && assembled && factsConfirmed.sig === JSON.stringify(assembled))
  const exportBlocked = pricing.unavailable || pricing.chargedBlocked || !assembled || exporting
  // 标题问题只拦简历导出和打印。导出修改清单不带这些标题，仍只看 exportBlocked。
  const shownTitleIssues = resume ? resumeTitleIssues(resume) : []
  const exportTitleIssues = assembled && assembled !== resume ? resumeTitleIssues(assembled) : []
  const titleBlocked = shownTitleIssues.length > 0 || exportTitleIssues.length > 0
  const focusTitleIssue = () => {
    const id = (shownTitleIssues[0] ?? exportTitleIssues[0])?.id
    if (id) focusResumeTitleIssue(id)
  }
  const estimatedPagesLabel = exported?.pageCount ? `共 ${exported.pageCount} 页（上次导出）` : '导出后显示真实页数。若担心第二页只剩两三行，可先点「压到一页」。'
  const editorOpen = view === 'ready' && Boolean(resume) && draftAccepted && !draft.loading
  const choicePending = Boolean(token && draft.hasDraft && !draftAccepted && view === 'ready')

  // 优化稿导出合同没有 savedToDocuments；只凭本人文档列表中的同一文件确认保存。
  // 读取失败或未找到时保持未知，不能根据登录状态推断已保存。
  useEffect(() => {
    if (exportKind !== 'resume' || !exported || !token) return
    let active = true
    void getMyDocuments(token, { pageSize: 50 }).then((page) => {
      if (active && page.items.some((item) => item.id === exported.fileId)) setSavedToDocuments(true)
    }).catch(() => { /* 导出已成功；文档归属未确认时不宣称已保存。 */ })
    return () => { active = false }
  }, [exported, exportKind, token, setSavedToDocuments])

  // 稿：总览、编辑、导出是同一页的三屏，用按钮切换。没有可对照的条目时直接进编辑区。
  const showOverview = workView === 'overview' && modules.length > 0
  const pane: OptimizePane = view !== 'ready' ? 'overview' : workView === 'export' ? 'export' : showOverview ? 'overview' : 'editor'
  const { lockedNote, openEditorAtOriginal, hasPendingEditOriginal } = useOptimizeEditFocus({
    initialEditOriginal: typeof state?.editOriginal === 'string' ? state.editOriginal : null,
    viewOnly,
    draftAccepted,
    editorOpen,
    pane,
    resume,
    onOpenEditor: () => setWorkView('editor'),
  })

  const markEdited = () => { setIsDirty(true); setPreviewOpen(false); if (exported) setExported(null) }
  const issueMessage = (failure: ResumeDecisionFailure, attempted?: ResumeModuleDecision) => {
    const index = modules.findIndex((module, i) => moduleKeyOf(module, i) === failure.key)
    const number = index + 1
    if (failure.reason === 'not-found' && attempted !== 'original') {
      return `第 ${number} 条改写没能自动放进稿里，请在编辑区手动改。`
    }
    return failure.reason === 'not-found'
      ? `第 ${number} 条的改写在优化稿里找不到原句，这里没法替你换，请在编辑区里对照着改。`
      : failure.reason === 'original-empty'
      ? `第 ${number} 条是新加的一句，原文里没有对应的句子，这里没法替你换，请在编辑区里对照着改。`
      : `第 ${number} 条那段文字在编辑区里已经变了，没法自动换，请在编辑区里对照着改。`
  }
  const requestLeave = (action: LeaveAction) => {
    if (draft.unsaved || (isDirty && !exported && !token)) { setConfirmLeave(() => action); return }
    action()
  }
  const handleLayoutChange = (next: typeof layout) => { setLayout(next); markEdited() }
  const handleTemplateChange = (id: string) => { setSelectedTemplateId(id); setExportError(null); if (exported) setExported(null) }
  const handleExportFormatChange = (format: ResumeExportFormat) => { setExportFormat(format); setPreviewOpen(false); if (exported) setExported(null) }
  const {
    clearedChoices, setClearedChoices, decisionIssues, handleDecisionChange,
    handleBatch, compareReturn, handleContinueDraft, handleRestartDraft,
  } = useOptimizeDecisions({
    state, viewOnly, editorOpen, modules, optimizedResume, baseResume, decisions,
    remoteDraft: draft.remoteDraft, hasPendingEditOriginal, formatIssue: issueMessage,
    setOptimizedResume, setDecisions, setLayout, setIsDirty, setDraftAccepted,
    setWorkView, requestOverwriteDraft: draft.requestOverwrite, markEdited,
  })
  const openCompare = (focusIndex?: number) => {
    if (viewOnly) return
    requestLeave(() => navigate('/resume/optimize/compare', {
      state: { taskId, accessToken, decisions, existingOnly, ...(typeof focusIndex === 'number' ? { focusIndex } : {}) },
    }))
  }

  /** 编辑页「去导出」：标题有问题先带到那一栏；核对过事实且稿没变就直接去，否则先核对。 */
  const requestResumeExport = () => {
    if (viewOnly) return
    if (titleBlocked) { focusTitleIssue(); return }
    if (!assembled) return
    if (factsValid) { setWorkView('export'); return }
    setFactOpen('resume')
  }
  const confirmFacts = (factsConfirmedAt: string) => {
    if (viewOnly) return
    if (factOpen === 'change_list') { void runChangeList(factsConfirmedAt); return }
    if (!assembled) return
    setFactsConfirmed({ at: factsConfirmedAt, sig: JSON.stringify(assembled) })
    setFactOpen(null)
    setWorkView('export')
  }

  const runResumeExport = async () => {
    if (viewOnly || !assembled || titleBlocked || !factsConfirmed || !factsValid || exportBlocked) return
    const optimizedResume = assembled
    const factsConfirmedAt = factsConfirmed.at
    setExporting(true); setExportError(null); setPreviewOpen(false)
    try {
      const result = await exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined, undefined, { benefitGrantId: pricing.benefitGrantId, factsConfirmedAt })
      setExported(result); setExportKind('resume'); setExportVersion((n) => n + 1); setIsDirty(false); setSavedToDocuments(undefined)
      if (result.signedUrl && exportFormat === 'pdf') setPreviewOpen(true)
    } catch (err) {
      setExportError(optimizeExportErrorMessage(err))
    } finally { setExporting(false); setFactOpen(null) }
  }

  const runChangeList = async (factsConfirmedAt: string) => {
    if (viewOnly || !taskId) return
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
    if (viewOnly || printNavigating || !exported?.printFileUrl) return
    setPrintNavigating(true)
    startPrint({
      origin: 'resume_optimize',
      returnPath: window.location.pathname,
      file: { name: exported.filename, size: printFileSizeLabel(exported.sizeBytes), pages: exported.pageCount, fileId: exported.fileId, fileUrl: exported.printFileUrl, mimeType: 'application/pdf' },
    })
  }

  const handleAiAdjust = async (action: ResumeLayoutAdjustAction) => {
    if (viewOnly || !taskId || !resume || adjustOutage || (failKind === 'outage' && failMsg)) return
    const before = resume; setAdjusting(action); setAdjustError(null)
    try {
      const result = await adjustResumeLayoutDraft(taskId, resume, action, layout, access)
      setLastResumeBeforeAiAdjust(before); setOptimizedResume(result.resume); setAdjustWarnings(result.warnings?.length ? ['调整后的内容仍需你逐项核对，确认事实无误。'] : []); setExported(null); setIsDirty(true)
    } catch (err) {
      if (resumeAiConsent.promptIfNeeded(err, Boolean(token), () => { void handleAiAdjust(action) })) return
      if (isAiOutage(err)) setAdjustOutage(true)
      setAdjustError(aiDeclarationDeclineMessage(err) ?? userMessageOf(err, 'AI 调整失败，请稍后重试或继续手动编辑'))
    } finally { setAdjusting(null) }
  }

  const goToReport = () => {
    const search = taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''
    const licenseViewOnly = state?.licenseViewOnly === true
    navigate(`/resume/report${search}`, { state: { ...state, taskId, accessToken, ...(aiDown ? { aiDown: true } : {}), ...(licenseViewOnly ? { licenseViewOnly: true } : {}) } })
  }

  const qxPage = pane === 'export' ? 'resume-export' : pane === 'editor' ? 'resume-edit' : 'optimize'
  const leaveDirty = draft.unsaved || (isDirty && !exported && !token)
  const aiDown = adjustOutage || (failKind === 'outage' && Boolean(failMsg))
  const aiTask = useAiTask({ availability: aiDown ? 'unavailable' : optimizedResume && !syntheticReady ? 'available' : 'unknown', pending: false, failed: Boolean(failMsg || adjustError), hasResult: Boolean(optimizedResume) })
  const navTestIds = { home: 'resume-optimize-nav-home', advisor: 'resume-optimize-nav-advisor', profile: 'resume-optimize-nav-profile' }
  const saveInfo = saveInfoOf(Boolean(token), draft.status, draft.savedAt)
  const exportIsPdf = exportKind === 'change_list' || exportFormat === 'pdf'
  const canPrint = Boolean(exported?.printFileUrl) && exportIsPdf
  const retryable = failKind !== 'outage' && (view === 'optimize-failed' || view === 'unavailable' || failKind === 'retry' || failKind === 'consent')
  const reupload = () => navigate('/resume/source?intent=optimize')
  const retry = () => { setFailMsg(null); setRetryNonce((n) => n + 1) }
  const { ask, back, statePrimary, primary } = buildOptimizeDockControls({
    view, pane, editorOpen, showOverview, hasAssembled: Boolean(assembled), hasModules: modules.length > 0,
    aiDown, viewOnly, leaveDirty, exporting, exported, canPrint, exportBlocked, titleBlocked, factsValid,
    printNavigating, retryable,
    onRequestLeaveToAssistant: (text) => requestLeave(() => { rememberAssistantDraft(text); navigate('/assistant') }),
    onOpenCompare: () => openCompare(),
    onRequestResumeExport: requestResumeExport,
    onRunResumeExport: () => { void runResumeExport() },
    onPrint: handlePrint,
    onOpenPreview: () => setPreviewOpen(true),
    onBackToEditor: () => setWorkView('editor'),
    onBackToOverview: () => setWorkView('overview'),
    onBackToReport: () => requestLeave(goToReport),
    onRetry: retry,
    onManualGenerate: () => navigate('/resume/generate'),
    onReupload: reupload,
  })

  if (consent.needsPrompt && !syntheticReady) {
    return (
      <ResumeTouchPage
        title="优化建议"
        subtitle="基于已有内容优化表达"
        railNow={3}
        ask={viewOnly ? { label: ask.label, disabled: true } : ask}
        navTestIds={navTestIds}
        bodyClassName="qxt-body-scroll"
        overlay={<ResumeAiConsentDialog variant="touch" busy={consent.busy} error={consent.error} guest={!token} onCancel={() => navigate(-1)} onConfirm={() => { void consent.confirm() }} />}
      >
        <section data-qx-page="optimize" data-kiosk-domain="resume" data-kiosk-screen="resume-optimize" className="qxt-optimize" data-optimize-state="loading" />
      </ResumeTouchPage>
    )
  }

  const frame = frameTextOf({ view, pane, moduleCount: showOverview ? modules.length : 0, exported: Boolean(exported), save: saveInfo })
  const dialogs = resumeAiConsent.dialog ?? (confirmLeave ? (
    <ResumeOptimizeLeaveDialog guest={!token} onStay={() => setConfirmLeave(null)} onLeave={() => { const action = confirmLeave; setConfirmLeave(null); action() }} />
  ) : factOpen && assembled ? (
    <ResumeFactConfirmDialog variant="touch" facts={facts} unconfirmed={unconfirmed} busy={exporting} onCancel={() => setFactOpen(null)} onConfirm={confirmFacts} />
  ) : compareReturn.pending ? (
    <CompareDecisionsApplyDialog count={compareReturn.pending.count} customCount={compareReturn.pending.customCount} onApply={compareReturn.confirm} onSkip={compareReturn.dismiss} />
  ) : undefined)

  return (
    <ResumeTouchPage
      eyebrow={frame.eyebrow}
      title={frame.title}
      subtitle={pane === 'overview' ? '建议只改表达，事实由你确认，随时可以保留原文。不新增学校、公司、证书、时间、薪资、获奖。' : undefined}
      back={back}
      status={frame.status}
      railNow={3}
      ask={viewOnly ? { label: ask.label, disabled: true } : ask}
      primary={primary}
      navTestIds={navTestIds}
      bodyClassName={pane === 'editor' ? 'qxt-body-tight' : 'qxt-body-scroll'}
      overlay={dialogs}
    >
      <section
        data-qx-page={qxPage}
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-optimize"
        className={`qxt-optimize ${confirmLeave ? 'overflow-hidden' : ''}`}
        {...aiTask.containerProps}
        data-optimize-state={view}
        data-work-view={pane}
        data-takeaway="新简历与修改清单"
        data-fallback={resolved.fallback ? '1' : undefined}
        data-synthetic={resolved.synthetic ? '1' : undefined}
      >
        {viewOnly ? <p role="status">{LICENSE_NO_NEW_TASK_REASON}</p> : null}
        {/* 总览里原因写在对应那一条下面；编辑区（从对照页带回、或没有总览时）在这里集中说一次。 */}
        {pane === 'editor' && Object.values(decisionIssues).length > 0 && (
          <div className="qxt-note" role="status">{Object.values(decisionIssues).map((message) => <p key={message}>{message}</p>)}</div>
        )}
        <OptimizeBodyPanes
          view={view}
          pane={pane}
          editorOpen={editorOpen}
          synthetic={resolved.synthetic}
          viewOnly={viewOnly}
          loading={loading}
          exporting={exporting}
          adjusting={adjusting}
          aiDown={aiDown}
          token={token}
          taskId={taskId}
          modules={modules}
          decisions={decisions}
          baseResume={baseResume}
          resume={resume}
          assembled={assembled}
          unconfirmed={unconfirmed}
          clearedChoices={clearedChoices}
          decisionIssues={decisionIssues}
          lockedNote={lockedNote}
          layout={layout}
          previewClassName={previewClassName}
          previewStyle={previewStyle}
          resumeTemplates={resumeTemplates}
          templatesError={templatesError}
          selectedTemplateId={selectedTemplateId}
          lastResumeBeforeAiAdjust={lastResumeBeforeAiAdjust}
          adjustWarnings={adjustWarnings}
          adjustError={adjustError ? unattendedResumeCopy(adjustError, contact) : adjustError}
          estimatedPagesLabel={estimatedPagesLabel}
          saveText={saveInfo.text}
          saveTone={saveInfo.bad ? 'bad' : 'plain'}
          exportFormat={exportFormat}
          exported={exported}
          exportKind={exportKind}
          exportVersion={exportVersion}
          exportError={exportError ? unattendedResumeCopy(exportError, contact) : exportError}
          pricing={pricing.pricing}
          pricingLoading={pricing.loading}
          blockedReason={pricing.blockedReason}
          savedToDocuments={savedToDocuments}
          printNavigating={printNavigating}
          titleBlocked={titleBlocked}
          exportBlocked={exportBlocked}
          changeListBusy={exporting && factOpen === 'change_list'}
          stateTitle={optimizeStateTitle(view)}
          stateDescription={unattendedResumeCopy(optimizeStateDescription(view, failMsg), contact)}
          stateActions={statePrimary && retryable ? <button type="button" className="qxt-btn-line" disabled={viewOnly} title={viewOnly ? LICENSE_NO_NEW_TASK_REASON : undefined} onClick={reupload}>重新上传简历</button> : undefined}
          showDraftBanner={view === 'ready' && (choicePending || Boolean(token && draft.loading))}
          draftLoading={Boolean(token && draft.loading)}
          choicePending={choicePending}
          draftUpdatedAt={draft.remoteDraft?.updatedAt}
          onContinueDraft={handleContinueDraft}
          onRestartDraft={handleRestartDraft}
          onClearChoices={setClearedChoices}
          onDecisionChange={handleDecisionChange}
          onBatch={handleBatch}
          onCompare={openCompare}
          onGoEdit={(index) => openEditorAtOriginal(modules[index]?.before ?? '')}
          onOpenEditor={() => { if (!viewOnly) setWorkView('editor') }}
          onManual={() => { if (!viewOnly) requestLeave(() => navigate('/resume/generate')) }}
          onReportFromEmpty={goToReport}
          onReportFromOverview={() => requestLeave(goToReport)}
          onMyResumes={() => navigate('/me/resumes')}
          onManualEditFromEmpty={() => { if (!viewOnly) navigate('/resume/generate') }}
          onResumeChange={(next) => { if (viewOnly) return; markEdited(); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setOptimizedResume(next) }}
          onLayoutChange={(next) => { if (!viewOnly) handleLayoutChange(next) }}
          onTemplateChange={(id) => { if (!viewOnly) handleTemplateChange(id) }}
          onAiAdjust={(action) => { void handleAiAdjust(action) }}
          onUndoAi={() => { if (viewOnly) return; setOptimizedResume(lastResumeBeforeAiAdjust!); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setExported(null); setIsDirty(true) }}
          onBackToOverview={() => setWorkView('overview')}
          onExportFormatChange={(format) => { if (!viewOnly) handleExportFormatChange(format) }}
          onPrint={handlePrint}
          onOpenPreview={() => setPreviewOpen(true)}
          onChangeList={() => { if (!viewOnly) setFactOpen('change_list') }}
        />
        {previewOpen && exported?.signedUrl && (
          <FilePreviewDialog fileUrl={(exportKind === 'change_list' || exportFormat === 'pdf') && exported.printFileUrl ? exported.printFileUrl : exported.signedUrl} fileName={exported.filename} format={exportKind === 'change_list' ? 'pdf' : exportFormat} mimeType={exportKind === 'change_list' ? 'application/pdf' : undefined} phoneDownloadUrl={exported.signedUrl} expiresAt={exported.expiresAt} primaryAction={exported.printFileUrl && (exportKind === 'change_list' || exportFormat === 'pdf') ? { label: '去打印这一份', onClick: handlePrint, disabled: viewOnly || printNavigating || titleBlocked } : undefined} onClose={() => setPreviewOpen(false)} />
        )}
      </section>
    </ResumeTouchPage>
  )
}
