// 优化页主体三屏与非就绪状态渲染：从 ResumeOptimizePage 拆出，保持既有行为与标记不变。
import type { CSSProperties, ReactNode } from 'react'
import type {
  GeneratedResume,
  ResumeExportFormat,
  ResumeExportPricing,
  ResumeGenerateExportResponse,
  ResumeLayoutSettings,
  ResumeOptimizeModule,
  ResumeTemplate,
} from '@ai-job-print/shared'
import type { ResumeLayoutAdjustAction } from '../../../../services/api'
import { OptimizeEditView } from '../../touch/OptimizeEditView'
import { OptimizeExportView } from '../../touch/OptimizeExportView'
import { OptimizeStateCard } from '../../touch/OptimizeStateCard'
import type { OptimizePane } from '../../touch/optimizeFrame'
import { OptimizeEmptyState } from './OptimizeEmptyState'
import { OptimizeOverview } from './OptimizeOverview'
import { ResumeDraftBanner } from './ResumeDraftBanner'
import type { OptimizeViewState } from './constants'
import {
  defaultModuleDecision,
  isModuleSwitchable,
  isNoActionModule,
  moduleKeyOf,
  moduleSwitchBlock,
  type ResumeModuleDecision,
} from './resumeDecisions'

export interface OptimizeBodyPanesProps {
  view: OptimizeViewState
  pane: OptimizePane
  editorOpen: boolean
  synthetic: boolean
  viewOnly: boolean
  loading: boolean
  exporting: boolean
  adjusting: ResumeLayoutAdjustAction | null
  aiDown: boolean
  token: string | null
  taskId: string | undefined
  modules: ResumeOptimizeModule[]
  decisions: Record<string, ResumeModuleDecision>
  baseResume: GeneratedResume | null
  resume: GeneratedResume | null
  assembled: GeneratedResume | null
  unconfirmed: string[]
  clearedChoices: ReadonlySet<string>
  decisionIssues: Record<string, string>
  lockedNote: string | null
  layout: Required<ResumeLayoutSettings>
  previewClassName: string
  previewStyle: CSSProperties
  resumeTemplates: ResumeTemplate[]
  templatesError: boolean
  selectedTemplateId: string
  lastResumeBeforeAiAdjust: GeneratedResume | null
  adjustWarnings: string[]
  adjustError: string | null
  estimatedPagesLabel: string
  saveText: string
  saveTone: 'bad' | 'plain'
  exportFormat: ResumeExportFormat
  exported: ResumeGenerateExportResponse | null
  exportKind: 'resume' | 'change_list'
  exportVersion: number
  exportError: string | null
  pricing: ResumeExportPricing | null
  pricingLoading: boolean
  blockedReason: string | null
  machineCharged?: boolean
  savedToDocuments: boolean | undefined
  printNavigating: boolean
  titleBlocked: boolean
  exportBlocked: boolean
  changeListBusy: boolean
  stateTitle: string
  stateDescription: string
  stateActions?: ReactNode
  showDraftBanner: boolean
  draftLoading: boolean
  choicePending: boolean
  draftUpdatedAt?: string
  onContinueDraft: () => void
  onRestartDraft: () => void
  onClearChoices: (keys: ReadonlySet<string>) => void
  onDecisionChange: (key: string, next: ResumeModuleDecision) => void
  onBatch: (next: ResumeModuleDecision) => void
  onCompare: (focusIndex?: number) => void
  onGoEdit: (index: number) => void
  onOpenEditor: () => void
  onManual: () => void
  onReportFromEmpty: () => void
  onReportFromOverview: () => void
  onMyResumes: () => void
  onManualEditFromEmpty: () => void
  onResumeChange: (next: GeneratedResume) => void
  onLayoutChange: (next: Required<ResumeLayoutSettings>) => void
  onTemplateChange: (id: string) => void
  onAiAdjust: (action: ResumeLayoutAdjustAction) => void
  onUndoAi: () => void
  onBackToOverview: () => void
  onExportFormatChange: (format: ResumeExportFormat) => void
  onPrint: () => void
  onOpenPreview: () => void
  onChangeList: () => void
}

export function OptimizeBodyPanes(props: OptimizeBodyPanesProps) {
  const {
    view, pane, editorOpen, synthetic, viewOnly, loading, exporting, adjusting, aiDown,
    token, taskId, modules, decisions, baseResume, resume, assembled, unconfirmed,
    clearedChoices, decisionIssues, lockedNote, layout, previewClassName, previewStyle,
    resumeTemplates, templatesError, selectedTemplateId, lastResumeBeforeAiAdjust,
    adjustWarnings, adjustError, estimatedPagesLabel, saveText, saveTone,
    exportFormat, exported, exportKind, exportVersion, exportError,
    pricing, pricingLoading, blockedReason, savedToDocuments, printNavigating,
    titleBlocked, exportBlocked, changeListBusy,
  } = props

  return (
    <>
      {view !== 'ready' && (
        <OptimizeStateCard
          tone={view === 'loading' ? 'info' : view === 'empty' || view === 'no-context' ? 'empty' : 'error'}
          title={props.stateTitle}
          description={props.stateDescription}
          synthetic={synthetic}
          actions={props.stateActions}
        />
      )}
      {view !== 'ready' && (
        <OptimizeEmptyState
          onReport={props.onReportFromEmpty}
          onManualEdit={props.onManualEditFromEmpty}
          onMyResumes={props.onMyResumes}
          manualLocked={viewOnly}
        />
      )}
      {props.showDraftBanner && (
        <ResumeDraftBanner
          loading={props.draftLoading}
          choicePending={props.choicePending}
          draftUpdatedAt={props.draftUpdatedAt}
          onContinue={props.onContinueDraft}
          onRestart={props.onRestartDraft}
        />
      )}
      {editorOpen && pane === 'overview' && (
        <OptimizeOverview
          modules={modules}
          decisions={decisions}
          defaultDecisions={Object.fromEntries(modules.map((module, index) => [moduleKeyOf(module, index), defaultModuleDecision(baseResume, module)]))}
          switchBlocks={Object.fromEntries(modules.map((module, index) => [moduleKeyOf(module, index), moduleSwitchBlock(baseResume, module, decisions[moduleKeyOf(module, index)])]))}
          synthetic={synthetic}
          disabled={viewOnly || loading || exporting || Boolean(adjusting)}
          clearedChoices={clearedChoices}
          onClear={() => props.onClearChoices(new Set(modules.flatMap((module, index) => {
            if (isNoActionModule(module)) return []
            const key = moduleKeyOf(module, index)
            if (!isModuleSwitchable(baseResume, module, decisions[key])) return []
            return [key]
          })))}
          decisionIssues={decisionIssues}
          onDecisionChange={props.onDecisionChange}
          onBatch={props.onBatch}
          onCompare={props.onCompare}
          onGoEdit={props.onGoEdit}
          onEditor={props.onOpenEditor}
          onManual={props.onManual}
          newTaskLocked={viewOnly}
          onReport={props.onReportFromOverview}
        />
      )}
      {editorOpen && resume && assembled && pane === 'editor' && (
        <OptimizeEditView
          resume={resume}
          lockedNote={lockedNote}
          onResumeChange={props.onResumeChange}
          unconfirmed={unconfirmed}
          layout={layout}
          onLayoutChange={props.onLayoutChange}
          previewClassName={previewClassName}
          previewStyle={previewStyle}
          templates={resumeTemplates}
          templatesError={templatesError}
          selectedTemplateId={selectedTemplateId}
          onTemplateChange={props.onTemplateChange}
          loading={loading}
          exporting={viewOnly || exporting}
          adjusting={adjusting}
          aiUnavailable={aiDown}
          lastResumeBeforeAiAdjust={lastResumeBeforeAiAdjust}
          adjustWarnings={adjustWarnings}
          adjustError={adjustError}
          onAiAdjust={props.onAiAdjust}
          onUndoAi={props.onUndoAi}
          estimatedPagesLabel={estimatedPagesLabel}
          saveText={saveText}
          saveTone={saveTone}
          hasModules={modules.length > 0}
          onBackToOverview={props.onBackToOverview}
          token={token}
          taskId={taskId}
          exportVersion={exportVersion}
        />
      )}
      {editorOpen && assembled && pane === 'export' && (
        <OptimizeExportView
          format={exportFormat}
          onFormat={props.onExportFormatChange}
          busy={viewOnly || exporting}
          exported={exported}
          exportKind={exportKind}
          exportVersion={exportVersion}
          exportError={exportError}
          pricing={pricing}
          pricingLoading={pricingLoading}
          blockedReason={blockedReason}
          machineCharged={props.machineCharged}
          guest={!token}
          savedToDocuments={savedToDocuments}
          printNavigating={printNavigating}
          contentBlocked={viewOnly || titleBlocked}
          onContentBlocked={props.onOpenEditor}
          onPrint={props.onPrint}
          onOpenPreview={props.onOpenPreview}
          showChangeList={Boolean(taskId)}
          changeListBusy={changeListBusy}
          changeListBlocked={viewOnly || exportBlocked}
          onChangeList={props.onChangeList}
        />
      )}
    </>
  )
}
