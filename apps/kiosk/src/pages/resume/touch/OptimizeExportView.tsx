import { QRCodeSVG } from 'qrcode.react'
import type { ResumeExportFormat, ResumeExportPricing, ResumeGenerateExportResponse } from '@ai-job-print/shared'
import { useCountdown } from '../../../hooks/useCountdown'
import { ResumePricingBar } from '../components/resume-deliver/ResumePricingBar'
import { AIGC_SCREEN_MARK, formatFileSize, PRINT_THIS_COPY } from '../components/resume-deliver/constants'
import './edit.css'

const FORMATS: Array<{ value: ResumeExportFormat; name: string; sub: string }> = [
  { value: 'pdf', name: 'PDF', sub: '排版固定，打印出来就是屏幕上这样' },
  { value: 'docx', name: 'DOCX', sub: 'Word 文档，回去还能自己接着改' },
  { value: 'txt', name: 'TXT', sub: '纯文字，粘进在线表单最省事' },
  { value: 'md', name: 'MD', sub: 'Markdown，会用的人拿去二次排版' },
]

const FACTS = [
  ['简历内容', '导出只做排版与文件保存，不再润色。导出不改内容，也不会再过一遍模型。'],
  ['文件与页数', '以这次导出结果为准；未收到结果时不估算。PDF 有页数；DOCX、TXT、MD 页数 0。'],
  ['手机取件', '真实下载链接在有效期内才显示二维码。下载链接与打印链接用途不同。'],
  ['打印确认', 'PDF 和打印链接都就绪才可进入，不会自动打印。不是 PDF 时这一格式暂不开放打印。'],
] as const

function ExportedCard(props: {
  exported: ResumeGenerateExportResponse
  formatLabel: string
  kind: 'resume' | 'change_list'
  version: number
  printReady: boolean
  printNavigating: boolean
  contentBlocked: boolean
  isPdf: boolean
  onPrint: () => void
  onOpenPreview: () => void
  priceCopy: string | null
}) {
  const countdown = useCountdown(props.exported.expiresAt)
  const hasFile = Boolean(props.exported.signedUrl)
  const expired = countdown.expired
  return (
    <section className="qxt-out" aria-label="导出结果" data-has-file={hasFile ? '1' : '0'}>
      <div className="qxt-outfile">
        <b>{props.exported.filename}</b>
        <small>
          {props.exported.pageCount > 0 ? `${props.exported.pageCount} 页` : '页数 0'}
          {props.exported.sizeBytes > 0 ? ` · ${formatFileSize(props.exported.sizeBytes)}` : ''}
          {` · ${props.formatLabel} · 版本 ${props.version}`}
        </small>
        {props.priceCopy ? <span className="qxt-price">{props.priceCopy}</span> : null}
        {hasFile && props.isPdf ? <small>{PRINT_THIS_COPY}</small> : null}
        {hasFile ? <small>有效期剩余 {countdown.label}{expired ? ' · 请重新导出' : ''}</small> : <small>这次没有生成可预览或打印的文件，请重新导出。</small>}
      </div>
      {props.isPdf ? (
        <button
          type="button"
          id="d4Print"
          aria-disabled={!props.printReady || props.printNavigating || props.contentBlocked || undefined}
          onClick={() => { if (props.printReady && !props.printNavigating) props.onPrint() }}
        >
          {props.printNavigating ? '正在进入打印确认…' : props.printReady ? '打印这一份' : '打印链接未就绪'}
        </button>
      ) : null}
      {hasFile && !expired ? (
        <div className="qxt-qrcell">
          <QRCodeSVG value={props.exported.signedUrl} size={148} level="M" marginSize={0} />
          <button type="button" onClick={props.onOpenPreview}>扫码带走</button>
        </div>
      ) : hasFile ? (
        <p className="qxt-expired">二维码已隐藏。链接过期，请重新导出。</p>
      ) : null}
    </section>
  )
}

/**
 * 导出与打印（稿 resume-export）：先选格式（PDF 默认），价目一句，点「导出」后才出回执与带走。
 * 只有 PDF 出现「打印这一份」；不是 PDF 时没有打印，只能扫码带走。
 */
export function OptimizeExportView(props: {
  format: ResumeExportFormat
  onFormat: (format: ResumeExportFormat) => void
  busy: boolean
  exported: ResumeGenerateExportResponse | null
  exportKind: 'resume' | 'change_list'
  exportVersion: number
  exportError: string | null
  pricing: ResumeExportPricing | null
  pricingLoading: boolean
  blockedReason: string | null
  guest: boolean
  savedToDocuments?: boolean
  printNavigating: boolean
  contentBlocked: boolean
  onPrint: () => void
  onOpenPreview: () => void
  showChangeList: boolean
  changeListBusy: boolean
  changeListBlocked: boolean
  onChangeList: () => void
  onContentBlocked?: () => void
}) {
  const formatName = FORMATS.find((item) => item.value === props.format)?.name ?? 'PDF'
  const isPdf = props.exportKind === 'change_list' || props.format === 'pdf'
  const exportedFormatLabel = props.exportKind === 'change_list' ? '修改清单 PDF' : formatName === 'DOCX' ? 'Word' : formatName === 'MD' ? 'Markdown' : formatName
  const printReady = Boolean(props.exported?.printFileUrl)
  const free = props.pricing?.mode === 'free'
  return (
    <div className="qxt-export">
      <div className="qxt-fmts" role="group" aria-label="导出格式">
        {FORMATS.map((item) => (
          <button key={item.value} type="button" className="qxt-fmt" disabled={props.busy} aria-pressed={props.format === item.value} onClick={() => props.onFormat(item.value)}>
            <b>{item.name}</b>
            <small>{item.sub}</small>
          </button>
        ))}
      </div>
      {props.exported ? (
        <ExportedCard
          exported={props.exported}
          formatLabel={exportedFormatLabel}
          kind={props.exportKind}
          version={props.exportVersion}
          printReady={printReady}
          printNavigating={props.printNavigating}
          contentBlocked={props.contentBlocked}
          isPdf={isPdf}
          onPrint={() => { if (props.contentBlocked) props.onContentBlocked?.(); else props.onPrint() }}
          onOpenPreview={props.onOpenPreview}
          priceCopy={free ? '免费试运营，本单 0 元' : null}
        />
      ) : (
        <div className="qxt-pricebar"><ResumePricingBar pricing={props.pricing} loading={props.pricingLoading} blockedReason={props.blockedReason} /></div>
      )}
      {props.exportError ? <p className="qxt-note" data-tone="bad" role="alert">{props.exportError}</p> : null}
      {props.showChangeList ? (
        <button type="button" className="qxt-outlink" aria-disabled={props.changeListBlocked || undefined} onClick={() => { if (!props.changeListBlocked) props.onChangeList() }}>
          {props.changeListBusy ? '正在生成修改清单…' : '导出修改清单'}
        </button>
      ) : null}
      <div className="qxt-facts">
        {FACTS.map(([title, text]) => <div key={title}><b>{title}</b><span>{text}</span></div>)}
      </div>
      {props.guest ? <p className="qxt-guest">登录后可存我的文档，本次可扫码带走</p> : null}
      {!props.guest && props.exported && props.savedToDocuments === true ? <p className="qxt-guest">已存入「我的文档」，可回账号查看。</p> : null}
      {!props.guest && props.exported && props.savedToDocuments === false ? <p className="qxt-guest">这次未存入「我的文档」，请在有效期内扫码带走。</p> : null}
      <p className="qxt-fine">{AIGC_SCREEN_MARK}。这是阅读草稿，不是简历最终稿；用不用由你决定</p>
    </div>
  )
}
