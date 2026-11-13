import { useEffect, useState } from 'react'
import type { ResumeReportExportKind, ResumeReportExportResponse } from '@ai-job-print/shared'
import { FilePreviewDialog } from '../../../../components/FilePreviewDialog'
import { useCountdown } from '../../../../hooks/useCountdown'
import { useAuth } from '../../../../auth/useAuth'
import { exportResumeRecord } from '../../../../services/api'
import { errorCodeOf, userMessageOf } from '../../../../services/api/userErrorMessage'
import { formatFileSize } from '../resume-deliver/constants'
import { ResumePricingBar } from '../resume-deliver/ResumePricingBar'
import { useResumeExportPricing } from '../resume-deliver/useResumeExportPricing'
import {
  EXPORT_BEFORE_PRINT_COPY,
  EXPORT_ERROR_COPY,
  GUEST_TAKEAWAY_COPY,
  SAVED_TO_DOCUMENTS_COPY,
  type ExportCaptureState,
} from '../../resume-report-model'
import {
  FIXTURE_EXPORT,
  FIXTURE_EXPORT_ERROR,
  FIXTURE_PRICING_CHARGED,
  FIXTURE_PRICING_UNAVAILABLE,
} from '../../resume-report-fixture'
import { subscribeKioskSensitiveSessionClear } from '../../../../auth/kioskSensitiveSession'
import { useStartPrintHandoff } from '../../../print/usePrintHandoff'

/** 与 aiResumeSession 同一把钥匙。只追加本次导出回执，清场删整把钥匙时一起清掉。 */
const AI_RESUME_SESSION_KEY = 'ai-job-print:current-ai-resume'

function readSessionRecord(): Record<string, unknown> | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(AI_RESUME_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function readReportTakeaway(taskId: string | undefined): { kind: ResumeReportExportKind; file: ResumeReportExportResponse } | null {
  if (!taskId) return null
  const parsed = readSessionRecord()
  if (!parsed || parsed.taskId !== taskId) return null
  const takeaway = parsed.reportTakeaway
  if (!takeaway || typeof takeaway !== 'object' || Array.isArray(takeaway)) return null
  const row = takeaway as Record<string, unknown>
  const kind = row.kind === 'change_list' || row.kind === 'diagnosis_report' ? row.kind : null
  const fileId = typeof row.fileId === 'string' ? row.fileId : ''
  const filename = typeof row.filename === 'string' ? row.filename : ''
  const signedUrl = typeof row.signedUrl === 'string' ? row.signedUrl : ''
  const printFileUrl = typeof row.printFileUrl === 'string' ? row.printFileUrl : ''
  const expiresAt = typeof row.expiresAt === 'string' ? row.expiresAt : ''
  if (!kind || !fileId || !filename || !signedUrl || !printFileUrl || !expiresAt) return null
  return {
    kind,
    file: {
      fileId,
      filename,
      mimeType: 'application/pdf',
      sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : 0,
      pageCount: typeof row.pageCount === 'number' ? row.pageCount : 0,
      signedUrl,
      expiresAt,
      printFileUrl,
      savedToDocuments: row.savedToDocuments === true,
      aiGenerated: true,
    },
  }
}

function writeReportTakeaway(
  taskId: string | undefined,
  takeaway: { kind: ResumeReportExportKind; file: ResumeReportExportResponse } | null,
): void {
  if (!taskId || typeof sessionStorage === 'undefined') return
  try {
    const parsed = readSessionRecord()
    if (!parsed || parsed.taskId !== taskId) return
    if (takeaway) {
      parsed.reportTakeaway = {
        kind: takeaway.kind,
        fileId: takeaway.file.fileId,
        filename: takeaway.file.filename,
        signedUrl: takeaway.file.signedUrl,
        printFileUrl: takeaway.file.printFileUrl,
        expiresAt: takeaway.file.expiresAt,
        sizeBytes: takeaway.file.sizeBytes,
        pageCount: takeaway.file.pageCount,
        savedToDocuments: takeaway.file.savedToDocuments,
        mimeType: 'application/pdf',
        aiGenerated: true,
      }
    } else {
      delete parsed.reportTakeaway
    }
    sessionStorage.setItem(AI_RESUME_SESSION_KEY, JSON.stringify(parsed))
  } catch {
    // 写不进去时这一页仍用内存里的结果；不另开一把钥匙。
  }
}

function exportErrorMessage(err: unknown): string {
  const code = errorCodeOf(err)
  if (code && EXPORT_ERROR_COPY[code]) return EXPORT_ERROR_COPY[code]
  return userMessageOf(err, '导出失败，这次没有生成文件。请稍后重试，或先打印原件。')
}

function TakeawayButton(props: {
  label: string
  hint?: string | null
  blocked: boolean
  describedBy?: string
  testId: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={props.blocked ? 'rrp-dead' : 'rrp-act'}
      aria-disabled={props.blocked || undefined}
      aria-describedby={props.blocked ? props.describedBy : undefined}
      data-testid={props.testId}
      onClick={() => { if (!props.blocked) props.onClick() }}
    >
      {props.label}
      {props.hint ? <small>{props.hint}</small> : null}
    </button>
  )
}

function ResultCard(props: {
  exported: ResumeReportExportResponse
  kind: ResumeReportExportKind
  guest: boolean
}) {
  const countdown = useCountdown(props.exported.expiresAt)
  const title = props.kind === 'change_list' ? '修改清单 PDF 已生成' : '诊断报告 PDF 已生成'
  const showSaved = props.exported.savedToDocuments && !props.guest
  return (
    <section
      className="rrp-result"
      data-testid="resume-report-export-result"
      data-saved={showSaved ? '1' : '0'}
      data-kind={props.kind}
    >
      <h3>{title}</h3>
      <p>
        {props.exported.filename}
        {props.exported.pageCount > 0 ? ` · ${props.exported.pageCount} 页` : ''}
        {props.exported.sizeBytes > 0 ? ` · ${formatFileSize(props.exported.sizeBytes)}` : ''}
      </p>
      <p>有效期剩余 {countdown.label}{countdown.expired ? ' · 请重新导出' : ''}</p>
      {showSaved ? (
        <p data-testid="resume-report-saved">{SAVED_TO_DOCUMENTS_COPY}</p>
      ) : (
        <p data-testid="resume-report-guest-takeaway">{GUEST_TAKEAWAY_COPY}</p>
      )}
    </section>
  )
}

export function ResumeReportTakeaway(props: {
  show: boolean
  taskId?: string
  accessToken?: string
  capture?: ExportCaptureState | null
  /** 可选。导出成功 / 清掉时通知页面（页面顶栏胶囊据此写「导出已生成」）。 */
  onExportedChange?: (exported: boolean) => void
}) {
  const startPrint = useStartPrintHandoff()
  const { getToken } = useAuth()
  const token = getToken()
  const guest = !token
  const access = { token, accessToken: props.accessToken }
  const live = useResumeExportPricing(access, token)
  const capture = props.capture ?? null

  const pricing = capture === 'pricing-charged'
    ? FIXTURE_PRICING_CHARGED
    : capture === 'pricing-unavailable'
      ? FIXTURE_PRICING_UNAVAILABLE
      : live.pricing
  const chargedBlocked = capture === 'pricing-charged'
    || (capture !== 'pricing-unavailable' && live.chargedBlocked)
  const unavailable = capture === 'pricing-unavailable' || (capture !== 'pricing-charged' && live.unavailable)
  const blockedReason = capture === 'pricing-charged'
    ? '当前没有可用的导出权益，导出按钮不可用'
    : capture === 'pricing-unavailable'
      ? (FIXTURE_PRICING_UNAVAILABLE.label)
      : live.blockedReason
  const benefitGrantId = capture ? undefined : live.benefitGrantId
  const pricingLoading = capture ? false : live.loading

  const restored = capture ? null : readReportTakeaway(props.taskId)
  const [exported, setExported] = useState<ResumeReportExportResponse | null>(
    capture === 'export-ready' ? FIXTURE_EXPORT : restored?.file ?? null,
  )
  const [exportKind, setExportKind] = useState<ResumeReportExportKind>(restored?.kind ?? 'diagnosis_report')
  const [exporting, setExporting] = useState(false)
  const [printNavigating, setPrintNavigating] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportError, setExportError] = useState<string | null>(
    capture === 'export-failed' ? FIXTURE_EXPORT_ERROR : null,
  )

  const { onExportedChange } = props
  const hasExport = Boolean(exported)
  useEffect(() => { onExportedChange?.(hasExport) }, [onExportedChange, hasExport])
  useEffect(() => subscribeKioskSensitiveSessionClear(() => {
    setExported(null)
    setPreviewOpen(false)
  }), [])

  if (!props.show) return null

  const pricingBlocks = unavailable || chargedBlocked
  const exportBlocked = pricingBlocks || exporting || (!props.taskId && !capture)
  const printReady = Boolean(exported?.printFileUrl)
  const qrReady = Boolean(exported?.signedUrl)
  const printBlocked = !printReady || printNavigating
  const qrBlocked = !qrReady
  const reason = blockedReason
    ?? (!props.taskId && !capture ? '这份报告没有对应的简历编号，无法导出。' : null)
    ?? (exported && !printReady ? '打印链接未就绪，这份文件暂时送不到打印工作台。' : null)
    ?? (!exported ? EXPORT_BEFORE_PRINT_COPY : null)
  const reasonId = reason ? 'resume-report-export-reason' : undefined

  const runExport = async (kind: ResumeReportExportKind) => {
    if (exportBlocked || !props.taskId) return
    setExporting(true)
    setExportError(null)
    try {
      const result = await exportResumeRecord(
        props.taskId,
        { kind: kind === 'change_list' ? 'change_list' : 'diagnosis_report', benefitGrantId },
        access,
      )
      setExported(result)
      setExportKind(kind)
      setPreviewOpen(false)
      if (!capture) writeReportTakeaway(props.taskId, { kind, file: result })
    } catch (err) {
      setExported(null)
      if (!capture) writeReportTakeaway(props.taskId, null)
      setExportError(exportErrorMessage(err))
    } finally {
      setExporting(false)
    }
  }

  const handlePrint = () => {
    if (printNavigating || !exported?.printFileUrl) return
    setPrintNavigating(true)
    startPrint({
      origin: 'resume_report',
      returnPath: window.location.pathname,
      file: {
        name: exported.filename,
        size: formatFileSize(exported.sizeBytes),
        pages: exported.pageCount,
        fileId: exported.fileId,
        fileUrl: exported.printFileUrl,
        mimeType: 'application/pdf',
      },
    })
  }

  return (
    <>
      <div className="rrp-export-panel" data-testid="resume-report-export-actions" data-exported={exported ? '1' : '0'}>
        <div className="rrp-take-h" data-testid="resume-report-takeaway-title">带走这份报告</div>
        <ResumePricingBar pricing={pricing} loading={pricingLoading} blockedReason={blockedReason} />
        <div className="rrp-export">
          {exported ? <TakeawayButton
            label={exportKind === 'change_list' ? '打印修改清单' : '打印这份报告'}
            hint={printNavigating ? '正在进入打印确认…' : printReady ? null : '链接未就绪'}
            blocked={printBlocked}
            describedBy={reasonId}
            testId="resume-report-print"
            onClick={handlePrint}
          /> : null}
          <TakeawayButton
            label="导出 PDF"
            hint={exporting && exportKind === 'diagnosis_report' ? '正在生成…' : pricingBlocks ? '暂不可用' : null}
            blocked={exportBlocked}
            describedBy={reasonId}
            testId="resume-report-export-pdf"
            onClick={() => { void runExport('diagnosis_report') }}
          />
          {exported ? <TakeawayButton
            label="生成二维码带走"
            hint={qrReady ? null : '链接未就绪'}
            blocked={qrBlocked}
            describedBy={reasonId}
            testId="resume-report-qr"
            onClick={() => { if (qrReady) setPreviewOpen(true) }}
          /> : null}
          <TakeawayButton
            label="导出修改清单"
            hint={exporting && exportKind === 'change_list' ? '正在生成…' : pricingBlocks ? '暂不可用' : null}
            blocked={exportBlocked}
            describedBy={reasonId}
            testId="resume-report-change-list"
            onClick={() => { void runExport('change_list') }}
          />
        </div>
        {reason ? <p className="rrp-export-reason" id="resume-report-export-reason">{reason}</p> : null}
        {exportError ? <p className="rrp-export-error" role="alert" data-testid="resume-report-export-error">{exportError}</p> : null}
        {exported ? <ResultCard exported={exported} kind={exportKind} guest={guest} /> : null}
      </div>
      {previewOpen && exported?.signedUrl ? (
        <FilePreviewDialog
          fileUrl={exported.printFileUrl || exported.signedUrl}
          fileName={exported.filename}
          mimeType="application/pdf"
          format="pdf"
          phoneDownloadUrl={exported.signedUrl}
          expiresAt={exported.expiresAt}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  )
}
