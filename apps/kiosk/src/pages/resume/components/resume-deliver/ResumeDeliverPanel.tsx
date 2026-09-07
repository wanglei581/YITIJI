import type { ResumeExportFormat, ResumeGenerateExportResponse, ResumeLayoutSettings, ResumeTemplate } from '@ai-job-print/shared'
import { ResumeLayoutControls } from '../ResumeLayoutControls'
import { COMPRESS_ONE_PAGE, EXPORT_FORMAT_OPTIONS } from './constants'
import { ResumeExportResult } from './ResumeExportResult'
import { ResumePricingBar } from './ResumePricingBar'
import type { ResumeExportPricing } from '@ai-job-print/shared'

export function ResumeDeliverPanel(props: {
  layout: Required<ResumeLayoutSettings>
  onLayoutChange: (next: Required<ResumeLayoutSettings>) => void
  templates: ResumeTemplate[]
  templatesError: boolean
  selectedTemplateId: string
  onTemplateChange: (id: string) => void
  exportFormat: ResumeExportFormat
  onExportFormatChange: (format: ResumeExportFormat) => void
  exporting: boolean
  printNavigating: boolean
  exported: ResumeGenerateExportResponse | null
  exportKind: 'resume' | 'change_list'
  exportError: string | null
  exportVersion: number
  pricing: ResumeExportPricing | null
  pricingLoading: boolean
  blockedReason: string | null
  exportBlocked: boolean
  onRequestExport: () => void
  onChangeList?: () => void
  changeListBusy?: boolean
  showChangeList: boolean
  onPrint: () => void
  onOpenPreview: () => void
  guest: boolean
  savedToDocuments?: boolean
  estimatedPagesLabel: string
  printLabel?: string
}) {
  const formatLabel = EXPORT_FORMAT_OPTIONS.find((item) => item.value === props.exportFormat)?.label ?? 'PDF'
  const printReady = Boolean(props.exported?.printFileUrl)
  const previewReady = Boolean(props.exported?.signedUrl)

  return (
    <aside className="qx-rd-side" aria-label="排版与导出">
      <div className="qx-card">
        <h3>排版调整</h3>
        <p>调整后左侧示意预览会变；导出 PDF 按此排版。{COMPRESS_ONE_PAGE}会把字号和行距各收一档。</p>
        <ResumeLayoutControls layout={props.layout} onChange={props.onLayoutChange} disabled={props.exporting} />
        <button
          type="button"
          className="qx-btn qx-rd-compress"
          data-variant="teal"
          disabled={props.exporting}
          onClick={() => props.onLayoutChange({ ...props.layout, fontScale: 'compact', lineSpacing: 'compact' })}
        >
          {COMPRESS_ONE_PAGE}
        </button>
        <p className="qx-rd-pages">{props.estimatedPagesLabel}</p>
      </div>

      {props.templatesError && (
        <div className="qx-card" role="status">
          <h3>简历模板</h3>
          <p>模板列表这次没读取到，不是没有模板。导出仍可进行，会使用默认版式；排版调整照常可用。</p>
        </div>
      )}

      {props.templates.length > 0 && (
        <div className="qx-card">
          <h3>简历模板</h3>
          <p>PDF 导出按所选模板自动填充版式；Word/TXT/Markdown 保持内容格式导出</p>
          <div className="qx-rd-tpl">
            {props.templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="qx-rd-tpl-btn"
                aria-pressed={props.selectedTemplateId === template.id}
                disabled={props.exporting}
                onClick={() => props.onTemplateChange(template.id)}
              >
                <b>{template.title}</b>
                <span>{template.resumeLayoutPreset.style} · {template.recommendedFor}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="qx-card">
        <h3>导出格式</h3>
        <div className="qx-rd-fmt">
          {EXPORT_FORMAT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={props.exportFormat === option.value}
              disabled={props.exporting}
              onClick={() => props.onExportFormatChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p>PDF 直接打印；Word/TXT/Markdown 供到手机保存。导出成功后才会出现预览与打印入口。</p>
        <ResumePricingBar pricing={props.pricing} loading={props.pricingLoading} blockedReason={props.blockedReason} />
      </div>

      {props.exportError && <p className="qx-rd-error" role="alert">{props.exportError}</p>}

      {props.exported && (
        <ResumeExportResult
          exported={props.exported}
          formatLabel={props.exportKind === 'change_list' ? '修改清单 PDF' : formatLabel}
          version={props.exportVersion}
          kind={props.exportKind}
          savedToDocuments={props.savedToDocuments}
          guest={props.guest}
        />
      )}

      <div className="qx-rd-export-actions">
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          aria-disabled={props.exportBlocked || undefined}
          aria-describedby={props.blockedReason ? 'resume-export-blocked-reason' : undefined}
          onClick={() => { if (!props.exportBlocked) props.onRequestExport() }}
        >
          {props.exporting ? '正在生成文件…' : `导出 ${formatLabel}`}
        </button>
        {props.showChangeList && props.onChangeList && (
          <button
            type="button"
            className="qx-btn"
            data-variant="ghost"
            aria-disabled={props.exportBlocked || undefined}
            onClick={() => { if (!props.exportBlocked) props.onChangeList?.() }}
          >
            {props.changeListBusy ? '正在生成修改清单…' : '导出修改清单'}
          </button>
        )}
        {previewReady && (
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onOpenPreview}>
            查看或手机保存{formatLabel}
          </button>
        )}
        {props.exported && (
          <button
            type="button"
            className="qx-btn"
            data-variant="teal"
            aria-disabled={!printReady || props.printNavigating || undefined}
            onClick={() => { if (printReady && !props.printNavigating) props.onPrint() }}
          >
            {props.printNavigating ? '正在进入打印确认…' : printReady ? (props.printLabel ?? '去打印优化版') : '打印链接未就绪'}
          </button>
        )}
      </div>
    </aside>
  )
}
