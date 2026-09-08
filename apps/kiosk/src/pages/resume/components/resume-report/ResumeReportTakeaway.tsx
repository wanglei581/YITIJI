import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { makePrintParams } from '@ai-job-print/shared'
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
  onJobFit: () => void
}) {
  const navigate = useNavigate()
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

  const [exported, setExported] = useState<ResumeReportExportResponse | null>(
    capture === 'export-ready' ? FIXTURE_EXPORT : null,
  )
  const [exportKind, setExportKind] = useState<ResumeReportExportKind>('diagnosis_report')
  const [exporting, setExporting] = useState(false)
  const [printNavigating, setPrintNavigating] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportError, setExportError] = useState<string | null>(
    capture === 'export-failed' ? FIXTURE_EXPORT_ERROR : null,
  )

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
    } catch (err) {
      setExported(null)
      setExportError(exportErrorMessage(err))
    } finally {
      setExporting(false)
    }
  }

  const handlePrint = () => {
    if (printNavigating || !exported?.printFileUrl) return
    setPrintNavigating(true)
    navigate('/print/confirm', {
      state: {
        file: {
          name: exported.filename,
          size: formatFileSize(exported.sizeBytes),
          pages: exported.pageCount,
          fileId: exported.fileId,
          fileUrl: exported.printFileUrl,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  return (
    <>
      <div className="rrp-export-panel" data-testid="resume-report-export-actions" data-exported={exported ? '1' : '0'}>
        <ResumePricingBar pricing={pricing} loading={pricingLoading} blockedReason={blockedReason} />
        <div className="rrp-export">
          <TakeawayButton
            label={exportKind === 'change_list' ? '打印修改清单' : '打印这份报告'}
            hint={printNavigating ? '正在进入打印确认…' : !exported ? '请先导出' : printReady ? null : '链接未就绪'}
            blocked={printBlocked}
            describedBy={reasonId}
            testId="resume-report-print"
            onClick={handlePrint}
          />
          <TakeawayButton
            label="导出 PDF"
            hint={exporting && exportKind === 'diagnosis_report' ? '正在生成…' : pricingBlocks ? '暂不可用' : null}
            blocked={exportBlocked}
            describedBy={reasonId}
            testId="resume-report-export-pdf"
            onClick={() => { void runExport('diagnosis_report') }}
          />
          <TakeawayButton
            label="生成二维码带走"
            hint={!exported ? '请先导出' : qrReady ? null : '链接未就绪'}
            blocked={qrBlocked}
            describedBy={reasonId}
            testId="resume-report-qr"
            onClick={() => { if (qrReady) setPreviewOpen(true) }}
          />
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
      <button type="button" className="rrp-jobfit" onClick={props.onJobFit} data-route="/resume/job-fit">
        目标岗位匹配参考（仅供参考）
      </button>
      <p className="rrp-self">
        想了解自己的倾向？
        <button type="button" className="rrp-self" onClick={() => navigate('/resume/self-assessment/intro')}>
          做一次自我探索
        </button>
      </p>
      {previewOpen && exported?.signedUrl ? (
        <FilePreviewDialog
          fileUrl={exported.signedUrl}
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
