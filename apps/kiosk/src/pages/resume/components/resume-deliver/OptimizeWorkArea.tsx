import type { CSSProperties } from 'react'
import type {
  GeneratedResume,
  ResumeExportFormat,
  ResumeGenerateExportResponse,
  ResumeLayoutSettings,
  ResumeOptimizeModule,
  ResumeTemplate,
  ResumeExportPricing,
} from '@ai-job-print/shared'
import type { ResumeLayoutAdjustAction } from '../../../../services/api/ai'
import { OptimizeReadyBody } from './OptimizeReadyBody'
import { ResumeDeliverPanel } from './ResumeDeliverPanel'
import { ResumeVersionsPanel } from './ResumeVersionsPanel'
import type { ResumeDecisionMap, ResumeModuleDecision } from './resumeDecisions'

export function OptimizeWorkArea(props: {
  resume: GeneratedResume
  modules: ResumeOptimizeModule[]
  decisions: ResumeDecisionMap
  unconfirmed: string[]
  layout: Required<ResumeLayoutSettings>
  previewClassName: string
  previewStyle: CSSProperties
  loading: boolean
  exporting: boolean
  adjusting: ResumeLayoutAdjustAction | null
  lastResumeBeforeAiAdjust: GeneratedResume | null
  adjustWarnings: string[]
  adjustError: string | null
  templates: ResumeTemplate[]
  templatesError: boolean
  selectedTemplateId: string
  exportFormat: ResumeExportFormat
  printNavigating: boolean
  exported: ResumeGenerateExportResponse | null
  exportKind: 'resume' | 'change_list'
  exportError: string | null
  exportVersion: number
  pricing: ResumeExportPricing | null
  pricingLoading: boolean
  blockedReason: string | null
  exportBlocked: boolean
  changeListBusy: boolean
  showChangeList: boolean
  guest: boolean
  savedToDocuments?: boolean
  estimatedPagesLabel: string
  taskId?: string
  token: string | null
  onDecisionChange: (key: string, next: ResumeModuleDecision) => void
  onResumeChange: (next: GeneratedResume) => void
  onCompare: () => void
  onAiAdjust: (action: ResumeLayoutAdjustAction) => void
  onUndoAi: () => void
  onLayoutChange: (next: Required<ResumeLayoutSettings>) => void
  onTemplateChange: (id: string) => void
  onExportFormatChange: (format: ResumeExportFormat) => void
  onRequestExport: () => void
  onChangeList: () => void
  onPrint: () => void
  onOpenPreview: () => void
}) {
  const { resume, modules, decisions, unconfirmed, layout, previewClassName, previewStyle } = props
  return (
    <div className="qx-rd-work">
      <OptimizeReadyBody
        resume={resume}
        modules={modules}
        decisions={decisions}
        onDecisionChange={props.onDecisionChange}
        unconfirmed={unconfirmed}
        layout={layout}
        previewClassName={previewClassName}
        previewStyle={previewStyle}
        loading={props.loading}
        exporting={props.exporting}
        adjusting={props.adjusting}
        lastResumeBeforeAiAdjust={props.lastResumeBeforeAiAdjust}
        adjustWarnings={props.adjustWarnings}
        adjustError={props.adjustError}
        onResumeChange={props.onResumeChange}
        onCompare={props.onCompare}
        onAiAdjust={props.onAiAdjust}
        onUndoAi={props.onUndoAi}
      />
      <div className="qx-rd-side-stack">
        <ResumeDeliverPanel
          layout={layout}
          onLayoutChange={props.onLayoutChange}
          templates={props.templates}
          templatesError={props.templatesError}
          selectedTemplateId={props.selectedTemplateId}
          onTemplateChange={props.onTemplateChange}
          exportFormat={props.exportFormat}
          onExportFormatChange={props.onExportFormatChange}
          exporting={props.exporting}
          printNavigating={props.printNavigating}
          exported={props.exported}
          exportKind={props.exportKind}
          exportError={props.exportError}
          exportVersion={props.exportVersion}
          pricing={props.pricing}
          pricingLoading={props.pricingLoading}
          blockedReason={props.blockedReason}
          exportBlocked={props.exportBlocked}
          onRequestExport={props.onRequestExport}
          onChangeList={props.onChangeList}
          changeListBusy={props.changeListBusy}
          showChangeList={props.showChangeList}
          onPrint={props.onPrint}
          onOpenPreview={props.onOpenPreview}
          guest={props.guest}
          savedToDocuments={props.savedToDocuments}
          estimatedPagesLabel={props.estimatedPagesLabel}
        />
        {props.token && props.taskId ? (
          <ResumeVersionsPanel taskId={props.taskId} token={props.token} refreshKey={props.exportVersion} />
        ) : null}
      </div>
    </div>
  )
}
