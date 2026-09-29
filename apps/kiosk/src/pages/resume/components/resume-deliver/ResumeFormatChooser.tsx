import { useState } from 'react'
import type { ResumeExportFormat, ResumeExportPricing, ResumeGenerateExportResponse, ResumeLayoutSettings, ResumeTemplate } from '@ai-job-print/shared'
import { ResumeLayoutControls } from '../ResumeLayoutControls'
import { COMPRESS_ONE_PAGE, type GeneratePreviewViewState } from './constants'
import { ResumeExportResult } from './ResumeExportResult'
import { ResumePricingBar } from './ResumePricingBar'

const FORMATS: Array<{
  value: ResumeExportFormat
  name: string
  page: string
  print: string
  fit: string
  desc: string
}> = [
  { value: 'pdf', name: 'PDF', page: '有页数', print: '能进打印确认', fit: '投简历、现场打印', desc: '排版固定，打印出来就是屏幕上这样' },
  { value: 'docx', name: 'DOCX', page: '页数 0', print: '暂不开放打印', fit: '回家再改', desc: 'Word 文档，回去还能自己接着改' },
  { value: 'txt', name: 'TXT', page: '页数 0', print: '暂不开放打印', fit: '网申填表', desc: '纯文字，粘进在线表单最省事' },
  { value: 'md', name: 'MD', page: '页数 0', print: '暂不开放打印', fit: '自己再排版', desc: 'Markdown，会用的人拿去二次排版' },
]

const FONT_CHOICES: Array<{ value: Required<ResumeLayoutSettings>['fontScale']; label: string }> = [
  { value: 'compact', label: '紧凑字号' },
  { value: 'standard', label: '标准字号' },
  { value: 'large', label: '大字号' },
]

function formatName(format: ResumeExportFormat): string {
  return FORMATS.find((item) => item.value === format)?.name ?? 'PDF'
}

export function ResumeFormatChooser(props: {
  screen: GeneratePreviewViewState
  format: ResumeExportFormat
  onFormatChange: (format: ResumeExportFormat) => void
  layout: Required<ResumeLayoutSettings>
  onLayoutChange: (next: Required<ResumeLayoutSettings>) => void
  templates: ResumeTemplate[]
  templatesError: boolean
  selectedTemplateId: string
  onTemplateChange: (id: string) => void
  exporting: boolean
  exported: ResumeGenerateExportResponse | null
  exportError: string | null
  exportVersion: number
  pricing: ResumeExportPricing | null
  pricingLoading: boolean
  blockedReason: string | null
  guest: boolean
  synthetic: boolean
  printNavigating: boolean
  onPrint: () => void
  onOpenPreview: () => void
  onClearExport: () => void
  onHelp: () => void
  estimatedPagesLabel: string
}) {
  const [layoutOpen, setLayoutOpen] = useState(false)
  const isPdf = props.format === 'pdf'
  const showChooser = props.screen === 'export-chooser' || props.screen === 'export-failed'
  const showResult = props.screen === 'export-ready' || props.screen === 'export-url-expired' || props.screen === 'export-print-unavailable'
  const printReady = isPdf && Boolean(props.exported?.printFileUrl)
  const previewReady = Boolean(props.exported?.signedUrl)

  return (
    <div className="qx-rg-export">
      {props.screen === 'export-exporting' && (
        <div className="qx-card">
          <div className="qx-sec-h"><span className="qx-rg-no">01</span><span className="t">正在生成文件</span><span className="hint">完成前没有文件</span></div>
          <p className="qx-rg-lead">正在整理 {formatName(props.format)}。文件出来之前，不能下载，也不能打印。</p>
          <p className="qx-rg-note">页数和大小要等这一次的结果，这里不事先估。这一步不改你已经核对过的内容。</p>
        </div>
      )}

      {props.screen === 'export-failed' && (
        <div className="qx-card" role="alert">
          <div className="qx-sec-h"><span className="qx-rg-no">01</span><span className="t">文件没生成出来</span><span className="hint">简历内容还在</span></div>
          <p className="qx-rg-lead">{props.exportError || '这次没有生成文件。核对过的内容还在，可以直接再导一次。'}</p>
        </div>
      )}

      {showResult && props.exported && (
        <div className="qx-card">
          <div className="qx-sec-h">
            <span className="qx-rg-no">01</span>
            <span className="t">{props.screen === 'export-url-expired' ? '扫码取件的链接过期了' : props.screen === 'export-print-unavailable' ? '这一份暂时进不了打印' : '文件已经好了'}</span>
            <span className="hint">{printReady ? '可以去打印' : '打印另说'}</span>
          </div>
          {props.synthetic ? (
            <SyntheticFileCard exported={props.exported} screen={props.screen} printReady={printReady} />
          ) : (
            <ResumeExportResult
              exported={props.exported}
              formatLabel={formatName(props.format)}
              version={props.exportVersion}
              kind="resume"
              guest={props.guest}
              downloadOnly={!isPdf}
            />
          )}
          <p className="qx-rg-note">
            {props.screen === 'export-url-expired'
              ? '过期的是手机取件那一条。文件还在，打印那条还在的话仍然可以去打印。'
              : props.screen === 'export-print-unavailable'
                ? '这次没有打印链接，所以不放行。手机取件还能用。想现在打印，换成 PDF 再导一次。'
                : isPdf
                  ? (printReady ? '下载和打印是两条链接，下载过期了也不挡住打印。' : 'PDF 通常能打印。这一次没有打印链接，可以再导一次。')
                  : '要现在打印，改选 PDF 再导一次。'}
          </p>
          <div className="qx-rg-result-actions">
            {!props.synthetic && previewReady && (
              <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onOpenPreview}>
                查看或手机保存{formatName(props.format)}
              </button>
            )}
            {printReady && (
              <button type="button" className="qx-btn" data-variant="teal" aria-disabled={props.printNavigating || undefined} onClick={() => { if (!props.printNavigating) props.onPrint() }}>
                {props.printNavigating ? '正在进入打印确认…' : '去打印确认'}
              </button>
            )}
            <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onClearExport}>换成别的格式</button>
          </div>
        </div>
      )}

      {showChooser && (
        <div className="qx-card">
          <div className="qx-sec-h"><span className="qx-rg-no">01</span><h2 className="t">选导出格式</h2><span className="hint">四种都能导出</span></div>
          <div className="qx-rg-fmts" role="radiogroup" aria-label="导出格式">
            {FORMATS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                className="qx-rg-fmt"
                aria-checked={props.format === item.value}
                data-testid={`resume-generate-preview-fmt-${item.value}`}
                disabled={props.exporting}
                onClick={() => props.onFormatChange(item.value)}
              >
                <b><span>{item.name}</span><em>{item.page}</em></b>
                <small>{item.desc}</small>
                <span className="qx-rg-fmeta"><span>适合</span><span>{item.fit}</span></span>
                <span className="qx-rg-fmeta"><span>打印</span><span>{item.print}</span></span>
              </button>
            ))}
          </div>
          <div className="qx-rg-layhead">
            <b>{isPdf ? '版式 · 只对 PDF 生效' : '版式 · 当前格式不套版式'}</b>
            <span>{isPdf ? '影响导出和打印的排版' : 'DOCX、TXT、MD 按各自的文件交出'}</span>
          </div>
          <div className="qx-rg-chips">
            <button type="button" className="qx-rg-chip" aria-pressed={props.layout.columns === 1} aria-disabled={!isPdf || props.exporting || undefined} onClick={() => { if (isPdf && !props.exporting) props.onLayoutChange({ ...props.layout, columns: 1 }) }}>单栏</button>
            <button type="button" className="qx-rg-chip" aria-pressed={props.layout.columns === 2} aria-disabled={!isPdf || props.exporting || undefined} onClick={() => { if (isPdf && !props.exporting) props.onLayoutChange({ ...props.layout, columns: 2 }) }}>双栏</button>
            {FONT_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className="qx-rg-chip"
                aria-pressed={props.layout.fontScale === choice.value}
                aria-disabled={!isPdf || props.exporting || undefined}
                onClick={() => { if (isPdf && !props.exporting) props.onLayoutChange({ ...props.layout, fontScale: choice.value }) }}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="qx-btn qx-rg-more"
            data-variant="ghost"
            aria-expanded={layoutOpen}
            aria-disabled={!isPdf || undefined}
            onClick={() => { if (isPdf) setLayoutOpen((open) => !open) }}
          >
            {layoutOpen ? '收起行距、页边距、主色和模板' : '行距、页边距、主色、压到一页、模板'}
          </button>
          {isPdf && layoutOpen && (
            <div className="qx-rg-more-body">
              <ResumeLayoutControls
                layout={props.layout}
                onChange={props.onLayoutChange}
                disabled={props.exporting}
                only={['lineSpacing', 'margin', 'accent']}
                className="qx-rg-layout"
              />
              <button
                type="button"
                className="qx-btn"
                data-variant="teal"
                disabled={props.exporting}
                onClick={() => props.onLayoutChange({ ...props.layout, fontScale: 'compact', lineSpacing: 'compact' })}
              >
                {COMPRESS_ONE_PAGE}
              </button>
              <p className="qx-rg-note">{props.estimatedPagesLabel}</p>
              {props.templatesError && (
                <p className="qx-rg-note" role="status">模板列表这次没读取到。导出仍可进行，会用默认版式；上面的排版调整照常可用。</p>
              )}
              {props.templates.length > 0 && (
                <div className="qx-rg-tpl">
                  <p>PDF 按所选模板排版。DOCX、TXT、MD 不套模板。</p>
                  {props.templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="qx-rg-chip"
                      aria-pressed={props.selectedTemplateId === template.id}
                      disabled={props.exporting}
                      onClick={() => props.onTemplateChange(template.id)}
                    >
                      {template.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="qx-rg-note">
            {isPdf
              ? 'PDF 会给出真实页数，版式也只对它生效。'
              : `${formatName(props.format)} 的页数固定是 0，也不套版式。这一份暂不开放打印。`}
          </p>
          <p className="qx-rg-note">导出后给你的是一条有时效的下载链接，过期后重导一次就有新链接。打印走另一条链接，下载链接进不了打印。</p>
          <ResumePricingBar pricing={props.pricing} loading={props.pricingLoading} blockedReason={props.blockedReason} />
        </div>
      )}

      <div className="qx-rg-help">
        <p>不确定要哪种？要打印或投简历就选 PDF；要回去自己改就选 DOCX。</p>
        <button type="button" className="qx-rg-hbtn" data-route="/help" onClick={props.onHelp}>找工作人员</button>
      </div>
    </div>
  )
}

function SyntheticFileCard(props: {
  exported: ResumeGenerateExportResponse
  screen: GeneratePreviewViewState
  printReady: boolean
}) {
  const pages = props.exported.pageCount > 0 ? `${props.exported.pageCount} 页` : '没有页数'
  return (
    <div className="qx-rg-file" data-testid="resume-generate-preview-synthetic-file">
      <b>{props.exported.filename}</b>
      <p>{pages}{props.exported.sizeBytes > 0 ? ` · ${Math.max(1, Math.round(props.exported.sizeBytes / 1024))} KB` : ''}</p>
      <p>
        {props.screen === 'export-url-expired'
          ? '手机取件这条已过期。'
          : '合成演示不生成可扫描的码，也不冒充文件已经进了账号。'}
      </p>
      <p>{props.printReady ? '打印链接在这一次的演示里标成可用。' : '这一次没有可交接的打印链接。'}</p>
    </div>
  )
}
