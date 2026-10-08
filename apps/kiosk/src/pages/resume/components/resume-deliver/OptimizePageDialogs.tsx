import type { ComponentType } from 'react'
import type { GeneratedResume, ResumeExportFormat, ResumeGenerateExportResponse } from '@ai-job-print/shared'
import { CompareDecisionsApplyDialog } from './CompareDecisionsApplyDialog'
import { OptimizeDraftPreview } from './OptimizeDraftPreview'
import { OptimizeSourcePreview } from './OptimizeSourcePreview'
import { ResumeFactConfirmDialog } from './ResumeFactConfirmDialog'
import { ResumeOptimizeLeaveDialog } from './ResumeOptimizeLeaveDialog'
import type { ConfirmableFact } from './facts'
import { exportResumeDocument, overviewPreviewItems, type OverviewRow } from './optimizeOverviewModel'
import type { OptimizeSourceFile } from './optimizeSourceFile'

const EXPORT_PREVIEW_NOTICE = '下面这一份就是确认导出时会送出的优化稿。每条标的是稿里实际用的：原文、改写，或你在编辑区自己写的。还没点选的，导出仍用稿里的改写。'

/** 优化页上的浮层：草稿预览、原件、事实核对、导出预览、离开确认、对照页选择。 */
type ExportFilePreview = ComponentType<{
  fileUrl: string
  fileName: string
  mimeType?: string
  format?: string
  phoneDownloadUrl?: string
  expiresAt?: string
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean }
  onClose: () => void
}>

export function OptimizePageDialogs(props: {
  filePreview: ExportFilePreview
  finalOpen: boolean
  editorOpen: boolean
  showOverview: boolean
  assembled: GeneratedResume | null
  overviewRows: OverviewRow[]
  onCloseFinal: () => void
  onEditFinal: () => void
  sourceOpen: boolean
  sourceFile: OptimizeSourceFile | null
  token: string | null
  onCloseSource: () => void
  factOpen: 'resume' | 'change_list' | null
  facts: ConfirmableFact[]
  unconfirmed: string[]
  exporting: boolean
  onCancelFact: () => void
  onConfirmFact: (at: string) => void
  previewOpen: boolean
  exported: ResumeGenerateExportResponse | null
  exportKind: 'resume' | 'change_list'
  exportFormat: ResumeExportFormat
  printNavigating: boolean
  titleBlocked: boolean
  onPrint: () => void
  onClosePreview: () => void
  confirmLeave: boolean
  guest: boolean
  onStay: () => void
  onLeave: () => void
  comparePending: { count: number; customCount: number } | null
  onApplyCompare: () => void
  onSkipCompare: () => void
}) {
  return (
    <>
      {props.finalOpen && props.editorOpen && props.showOverview && props.assembled && (
        <OptimizeDraftPreview
          documentText={exportResumeDocument(props.assembled)}
          items={overviewPreviewItems(props.overviewRows, props.assembled)}
          notice={EXPORT_PREVIEW_NOTICE}
          onClose={props.onCloseFinal}
          onEdit={props.onEditFinal}
        />
      )}
      {props.sourceOpen && props.sourceFile && (
        <OptimizeSourcePreview file={props.sourceFile} token={props.token} onClose={props.onCloseSource} />
      )}
      {props.factOpen && props.assembled && (
        <ResumeFactConfirmDialog
          facts={props.facts}
          unconfirmed={props.unconfirmed}
          busy={props.exporting}
          onCancel={props.onCancelFact}
          onConfirm={props.onConfirmFact}
        />
      )}
      {props.previewOpen && props.exported?.signedUrl && (
        <props.filePreview
          fileUrl={props.exported.signedUrl}
          fileName={props.exported.filename}
          format={props.exportKind === 'change_list' ? 'pdf' : props.exportFormat}
          mimeType={props.exportKind === 'change_list' ? 'application/pdf' : undefined}
          phoneDownloadUrl={props.exported.signedUrl}
          expiresAt={props.exported.expiresAt}
          primaryAction={props.exported.printFileUrl && (props.exportKind === 'change_list' || props.exportFormat === 'pdf')
            ? { label: '去打印这一份', onClick: props.onPrint, disabled: props.printNavigating || props.titleBlocked }
            : undefined}
          onClose={props.onClosePreview}
        />
      )}
      {props.confirmLeave && (
        <ResumeOptimizeLeaveDialog guest={props.guest} onStay={props.onStay} onLeave={props.onLeave} />
      )}
      {props.comparePending && (
        <CompareDecisionsApplyDialog
          count={props.comparePending.count}
          customCount={props.comparePending.customCount}
          onApply={props.onApplyCompare}
          onSkip={props.onSkipCompare}
        />
      )}
    </>
  )
}
