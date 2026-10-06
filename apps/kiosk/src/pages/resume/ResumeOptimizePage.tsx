import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { type GeneratedResume, type ResumeExportFormat } from '@ai-job-print/shared'
import { QxAiHelp } from '../../components/qingxu/QxAiHelp'
import { rememberAssistantDraft } from '../../services/assistantDraft'
import { OptimizeOverview } from './components/resume-deliver/OptimizeOverview'
import { OptimizePageCta } from './components/resume-deliver/OptimizePageCta'
import { OptimizeDraftPreview } from './components/resume-deliver/OptimizeDraftPreview'
import { OptimizeSaveExtras } from './components/resume-deliver/OptimizeSaveExtras'
import { OptimizeSourcePreview } from './components/resume-deliver/OptimizeSourcePreview'
import { applyOverviewBatch, buildOverviewRows, draftPreviewItems, type OverviewBatchAction } from './components/resume-deliver/optimizeOverviewModel'
import { readOptimizeSourceFile } from './components/resume-deliver/optimizeSourceFile'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
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
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { DEFAULT_RESUME_LAYOUT, useResumeLayout } from './hooks/useResumeLayout'
import { readAiResumeSession } from './aiResumeSession'
import { useResumeAiConsent } from './resumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { ResumeAigcBadge } from './components/resume-deliver/ResumeAigcBadge'
import { OptimizeWorkArea } from './components/resume-deliver/OptimizeWorkArea'
import { OptimizeEmptyState } from './components/resume-deliver/OptimizeEmptyState'
import { optimizeExportErrorMessage, optimizeStateDescription, optimizeStateTitle, optimizeStatusCapsule } from './components/resume-deliver/optimizeStateCopy'
import { ResumeDraftBanner } from './components/resume-deliver/ResumeDraftBanner'
import { ResumeFactConfirmDialog } from './components/resume-deliver/ResumeFactConfirmDialog'
import { ResumeOptimizeLeaveDialog } from './components/resume-deliver/ResumeOptimizeLeaveDialog'
import { ResumeOptimizeNavbar } from './components/resume-deliver/ResumeOptimizeNavbar'
import { ResumeStatePanel } from './components/resume-deliver/ResumeStatePanel'
import { useResumeExportPricing } from './components/resume-deliver/useResumeExportPricing'
import { useResumeDraftAutosave } from './components/resume-deliver/useResumeDraftAutosave'
import { detectUnconfirmedAdditions, extractConfirmableFacts } from './components/resume-deliver/facts'
import { parseOptimizeQuery, resolveOptimizeView } from './components/resume-deliver/optimizeQuery'
import { useOptimizeLoad } from './components/resume-deliver/useOptimizeLoad'
import { printFileSizeLabel, useOptimizeSession } from './components/resume-deliver/useOptimizeSession'
import {
  applyDecisionChanges,
  applyResumeDecisions,
  applyResumeDecisionsWithStatus,
  moduleKeyOf,
  parseDecisionMap,
  toggleModuleDecision,
  type ResumeDecisionFailure,
  type ResumeModuleDecision,
} from './components/resume-deliver/resumeDecisions'
import { CompareDecisionsApplyDialog } from './components/resume-deliver/CompareDecisionsApplyDialog'
import { useCompareDecisionsReturn } from './components/resume-deliver/useCompareDecisionsReturn'
import { focusResumeTitleIssue, resumeTitleIssues } from './components/resume-deliver/resumeEntryTitles'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './resume-optimize-qx.css'
import './optimize-empty-state-qx.css'
import './resume-r1-qx2.css'
import './resume-optimize-overview-qx.css'

type LeaveAction = () => void
const OPTIMIZE_AI_DRAFT = '我想把简历中的一句经历换个改法。请先让我提供原句，只整理真实内容，不添加数字或成果。'

export function ResumeOptimizePage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const { getToken } = useAuth()
  const consent = useResumeAiConsent()
  const state = location.state as Record<string, unknown> | null
  const query = useMemo(() => parseOptimizeQuery(location.search), [location.search])
  const [workView, setWorkView] = useState<'overview' | 'editor'>(() => new URLSearchParams(location.search).get('screen') === 'editor' || state?.decisions ? 'editor' : 'overview')
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
  const [decisionIssues, setDecisionIssues] = useState<Record<string, string>>({})
  const [baseResume, setBaseResume] = useState<GeneratedResume | null>(null)
  const [batchNote, setBatchNote] = useState<string | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [finalOpen, setFinalOpen] = useState(() => new URLSearchParams(location.search).get('screen') === 'final')
  const sourceFile = useMemo(() => readOptimizeSourceFile(state), [state])

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
  const assembledResult = resume ? applyResumeDecisionsWithStatus(resume, modules, decisions) : null
  const assembled = assembledResult?.resume ?? null
  const unconfirmed = assembled ? detectUnconfirmedAdditions(assembled, modules) : []
  const facts = assembled ? extractConfirmableFacts(assembled) : []
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
  const overviewRows = useMemo(() => buildOverviewRows(modules, decisions, baseResume), [modules, decisions, baseResume])

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
  const setDecisionFailures = (failures: ResumeDecisionFailure[], attempted?: ResumeModuleDecision | Record<string, ResumeModuleDecision>) => {
    setDecisionIssues(Object.fromEntries(failures.map((failure) => {
      const choice = typeof attempted === 'string' ? attempted : attempted?.[failure.key]
      return [failure.key, issueMessage(failure, choice)]
    })))
  }
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
    const result = toggleModuleDecision(optimizedResume, modules[index], decisions[key] ?? 'optimized', next, baseResume)
    if (!result.applied) {
      setDecisionFailures(result.reason ? [{ key, reason: result.reason }] : [], next)
      return
    }
    setOptimizedResume(result.resume)
    setDecisions((prev) => ({ ...prev, [key]: next }))
    setDecisionIssues((prev) => { const nextIssues = { ...prev }; delete nextIssues[key]; return nextIssues })
    setBatchNote(null)
    markEdited()
  }
  const handleBatch = (action: OverviewBatchAction) => {
    if (!optimizedResume) return
    const rows = buildOverviewRows(modules, decisions, baseResume)
    const result = applyOverviewBatch(optimizedResume, modules, decisions, rows, action, baseResume)
    setOptimizedResume(result.resume)
    setDecisions(result.decisions)
    setDecisionFailures(result.failures, action === 'keep-undecided' ? 'original' : 'optimized')
    setBatchNote(result.note)
    if (result.changed) markEdited()
  }
  const openCompare = (focusIndex?: number) => requestLeave(() => navigate('/resume/optimize/compare', {
    state: { taskId, accessToken, decisions, existingOnly, ...(typeof focusIndex === 'number' ? { focusIndex } : {}) },
  }))
  const compareReturn = useCompareDecisionsReturn({
    state, modules, optimizedResume, decisions, ready: editorOpen,
    apply: (changes) => {
      if (!optimizedResume) return
      const next = applyDecisionChanges(optimizedResume, modules, decisions, changes, baseResume)
      setOptimizedResume(next.resume); setDecisions(next.decisions); setDecisionFailures(next.failures, Object.fromEntries(changes))
      if (next.failures.length < changes.length) markEdited()
    },
  })
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
    setWorkView('editor')
  }

  const requestResumeExport = () => {
    if (titleBlocked) { focusTitleIssue(); return }
    if (!exportBlocked) setFactOpen('resume')
  }

  const runResumeExport = async (factsConfirmedAt: string) => {
    if (!assembled || titleBlocked) return
    const optimizedResume = assembled
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
    startPrint({
      origin: 'resume_optimize',
      returnPath: window.location.pathname,
      file: { name: exported.filename, size: printFileSizeLabel(exported.sizeBytes), pages: exported.pageCount, fileId: exported.fileId, fileUrl: exported.printFileUrl, mimeType: 'application/pdf' },
    })
  }

  const handleAiAdjust = async (action: ResumeLayoutAdjustAction) => {
    if (!taskId || !resume) return
    const before = resume; setAdjusting(action); setAdjustError(null)
    try {
      const result = await adjustResumeLayoutDraft(taskId, resume, action, layout, access)
      setLastResumeBeforeAiAdjust(before); setOptimizedResume(result.resume); setAdjustWarnings(result.warnings?.length ? ['调整后的内容仍需你逐项核对，确认事实无误。'] : []); setExported(null); setIsDirty(true)
    } catch (err) {
      setAdjustError(aiDeclarationDeclineMessage(err) ?? userMessageOf(err, 'AI 调整失败，请稍后重试或继续手动编辑'))
    } finally { setAdjusting(null) }
  }

  const goToReport = () => {
    const search = taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''
    navigate(`/resume/report${search}`, { state: { ...state, taskId, accessToken } })
  }

  const navbar = <ResumeOptimizeNavbar />
  // 稿 23：总览与编辑区是同一页的两屏，用按钮切换（稿里没有页签）。没有可对照的条目时直接进编辑区。
  const showOverview = workView === 'overview' && modules.length > 0

  const ctabar = (
    <OptimizePageCta
      assistant={<span className="qx-r1-ai-exit" onClickCapture={(event) => {
        if (!isDirty) return
        event.stopPropagation()
        requestLeave(() => { rememberAssistantDraft(OPTIMIZE_AI_DRAFT); navigate('/assistant') })
      }}><QxAiHelp label="问小青：这句还能怎么改 →" draft={OPTIMIZE_AI_DRAFT} /></span>}
      showOverview={showOverview}
      editorOpen={editorOpen}
      moduleCount={modules.length}
      sourceReady={Boolean(sourceFile)}
      exporting={exporting}
      exportFormat={exportFormat}
      exportBlocked={exportBlocked || !assembled}
      titleBlocked={titleBlocked}
      onReport={() => requestLeave(goToReport)}
      onSource={() => setSourceOpen(true)}
      onFinal={() => setFinalOpen(true)}
      onCompare={() => openCompare()}
      onOverview={() => setWorkView('overview')}
      onExport={requestResumeExport}
    />
  )

  if (consent.needsPrompt && !syntheticReady) {
    return (
      <QxPageFrame title="优化建议" subtitle="基于已有内容优化表达" ctabar={ctabar} navbar={navbar}>
        <section data-kiosk-domain="resume" data-kiosk-screen="resume-optimize" className="qx-resume-optimize" data-optimize-state="loading" />
        <ResumeAiConsentDialog busy={consent.busy} error={consent.error} guest={!token} onCancel={() => navigate(-1)} onConfirm={() => { void consent.confirm() }} />
      </QxPageFrame>
    )
  }

  const statusCapsule = optimizeStatusCapsule(view)
  const retryable = failKind !== 'outage' && (view === 'optimize-failed' || view === 'unavailable' || failKind === 'retry' || failKind === 'consent')
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
    <QxPageFrame title="简历优化建议" subtitle="建议只改表达，事实由你确认，随时可以保留原文。" back={{ label: '返回诊断报告', onBack: () => requestLeave(goToReport) }} status={statusCapsule} ctabar={ctabar} navbar={navbar}>
      <section
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-optimize"
        className={`qx-resume-optimize ${confirmLeave ? 'overflow-hidden' : ''}`}
        data-optimize-state={view}
        data-work-view={workView}
        data-takeaway="新简历与修改清单"
        data-fallback={resolved.fallback ? '1' : undefined}
        data-synthetic={resolved.synthetic ? '1' : undefined}
      >
        <ResumeAigcBadge synthetic={resolved.synthetic} />
        {/* 总览里原因写在对应那一条下面；编辑区（从对照页带回、或没有总览时）在这里集中说一次。 */}
        {!showOverview && Object.values(decisionIssues).length > 0 && (
          <div className="qx-opt-decision-status" role="status">{Object.values(decisionIssues).map((message) => <p key={message}>{message}</p>)}</div>
        )}
        {stateBody}
        {view !== 'ready' && (
          <OptimizeEmptyState
            onReport={goToReport}
            onManualEdit={() => navigate('/resume/generate')}
            onMyResumes={() => navigate('/me/resumes')}
          />
        )}
        {view === 'ready' && (!showOverview || choicePending || (Boolean(token) && draft.loading)) && (
          <ResumeDraftBanner
            guest={!token}
            loading={Boolean(token && draft.loading)}
            choicePending={choicePending}
            draftUpdatedAt={draft.remoteDraft?.updatedAt}
            onContinue={handleContinueDraft}
            onRestart={() => { setDecisions({}); draft.requestOverwrite(); setDraftAccepted(true); setWorkView('overview') }}
            saveStatus={draft.status}
            savedAt={draft.savedAt}
          />
        )}
        {editorOpen && showOverview && (
          <OptimizeOverview
            modules={modules}
            decisions={decisions}
            baseResume={baseResume}
            synthetic={resolved.synthetic}
            disabled={loading || exporting || Boolean(adjusting)}
            batchNote={batchNote}
            decisionIssues={decisionIssues}
            saveExtra={<OptimizeSaveExtras guest={!token} draft={draft} pricing={pricing} taskId={taskId} token={token} exportVersion={exportVersion} />}
            onDecisionChange={handleDecisionChange}
            onBatch={handleBatch}
            onCompare={openCompare}
            onEditor={() => setWorkView('editor')}
            onManual={() => requestLeave(() => navigate('/resume/generate'))}
            onReport={() => requestLeave(goToReport)}
          />
        )}
        {editorOpen && resume && assembled && !showOverview && modules.length === 0 && (
          <p className="qx-opt-nomods" role="note">这份结果没有需要逐条对照的建议，下面直接是优化版全文，核对后导出。</p>
        )}
        {editorOpen && resume && assembled && !showOverview && (
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
            contentBlocked={titleBlocked}
            onContentBlocked={focusTitleIssue}
            changeListBusy={exporting && factOpen === 'change_list'}
            showChangeList={Boolean(taskId)}
            guest={!token}
            savedToDocuments={savedToDocuments}
            estimatedPagesLabel={estimatedPagesLabel}
            taskId={taskId}
            token={token}
            onDecisionChange={handleDecisionChange}
            onResumeChange={(next) => { markEdited(); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setOptimizedResume(next) }}
            onCompare={() => openCompare()}
            onAiAdjust={(action) => { void handleAiAdjust(action) }}
            onUndoAi={() => { setOptimizedResume(lastResumeBeforeAiAdjust!); setLastResumeBeforeAiAdjust(null); setAdjustWarnings([]); setAdjustError(null); setExported(null); setIsDirty(true) }}
            onLayoutChange={handleLayoutChange}
            onTemplateChange={handleTemplateChange}
            onExportFormatChange={handleExportFormatChange}
            onRequestExport={requestResumeExport}
            onChangeList={() => setFactOpen('change_list')}
            onPrint={handlePrint}
            onOpenPreview={() => setPreviewOpen(true)}
          />
        )}
        {finalOpen && editorOpen && showOverview && (
          <OptimizeDraftPreview
            items={draftPreviewItems(overviewRows)}
            onClose={() => setFinalOpen(false)}
            onEdit={() => { setFinalOpen(false); setWorkView('editor') }}
          />
        )}
        {sourceOpen && sourceFile && (
          <OptimizeSourcePreview file={sourceFile} token={token} onClose={() => setSourceOpen(false)} />
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
          <FilePreviewDialog fileUrl={exported.signedUrl} fileName={exported.filename} format={exportKind === 'change_list' ? 'pdf' : exportFormat} mimeType={exportKind === 'change_list' ? 'application/pdf' : undefined} phoneDownloadUrl={exported.signedUrl} expiresAt={exported.expiresAt} primaryAction={exported.printFileUrl && (exportKind === 'change_list' || exportFormat === 'pdf') ? { label: '去打印这一份', onClick: handlePrint, disabled: printNavigating || titleBlocked } : undefined} onClose={() => setPreviewOpen(false)} />
        )}
        {confirmLeave && (
          <ResumeOptimizeLeaveDialog
            guest={!token}
            onStay={() => setConfirmLeave(null)}
            onLeave={() => { const action = confirmLeave; setConfirmLeave(null); action() }}
          />
        )}
        {compareReturn.pending && (
          <CompareDecisionsApplyDialog
            count={compareReturn.pending.count}
            customCount={compareReturn.pending.customCount}
            onApply={compareReturn.confirm}
            onSkip={compareReturn.dismiss}
          />
        )}
      </section>
    </QxPageFrame>
  )
}
