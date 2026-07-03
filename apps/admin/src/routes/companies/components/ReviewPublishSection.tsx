import { useState } from 'react'
import { Card, StatusBadge } from '@ai-job-print/ui'
import { Field, GhostButton, InlineError, InlineSuccess, PrimaryButton } from '../../../components/form'
import { PUBLISH_BADGE, REVIEW_BADGE, errMsg, inputCls } from './shared'
import { companiesAdminService, type AdminCompanyDetail } from '../../../services/api/companiesAdmin'

export function ReviewPublishSection({ detail, onMutated }: { detail: AdminCompanyDetail; onMutated: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const run = async (op: () => Promise<void>, okText: string) => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await op()
      setSuccess(okText)
      setRejecting(false)
      setRejectReason('')
      onMutated()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const canPublish = detail.reviewStatus === 'approved' && detail.publishStatus !== 'published'
  const canUnpublish = detail.publishStatus === 'published'

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-gray-700">审核与发布</p>
        <StatusBadge status={REVIEW_BADGE[detail.reviewStatus]?.status ?? 'default'} label={REVIEW_BADGE[detail.reviewStatus]?.label ?? detail.reviewStatus} />
        <StatusBadge status={PUBLISH_BADGE[detail.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[detail.publishStatus]?.label ?? detail.publishStatus} />
      </div>
      {detail.reviewStatus === 'rejected' && detail.rejectReason && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">拒绝原因：{detail.rejectReason}</p>
      )}
      <InlineError message={error} />
      <InlineSuccess message={success} />
      <div className="flex flex-wrap items-center gap-2">
        {detail.reviewStatus !== 'approved' && (
          <PrimaryButton
            disabled={busy}
            onClick={() => void run(() => companiesAdminService.reviewCompany(detail.id, 'approve'), '已通过审核')}
          >
            通过审核
          </PrimaryButton>
        )}
        {detail.reviewStatus !== 'rejected' && (
          <GhostButton disabled={busy} onClick={() => setRejecting((v) => !v)}>拒绝…</GhostButton>
        )}
        {canPublish && (
          <PrimaryButton
            disabled={busy}
            onClick={() => void run(() => companiesAdminService.publishCompany(detail.id, true), '已发布，一体机「找企业」可见')}
          >
            发布
          </PrimaryButton>
        )}
        {canUnpublish && (
          <GhostButton
            disabled={busy}
            onClick={() => void run(() => companiesAdminService.publishCompany(detail.id, false), '已下架，一体机不再展示')}
          >
            下架
          </GhostButton>
        )}
        {detail.reviewStatus !== 'approved' && detail.publishStatus !== 'published' && (
          <span className="text-xs text-gray-400">审核通过后才能发布</span>
        )}
      </div>
      {rejecting && (
        <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/50 p-3">
          <Field label="拒绝原因" required>
            <textarea
              className={`${inputCls} h-16 resize-none`}
              placeholder="必填，将记录在审核日志中"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <GhostButton disabled={busy} onClick={() => setRejecting(false)}>取消</GhostButton>
            <button
              disabled={busy || !rejectReason.trim()}
              onClick={() => void run(() => companiesAdminService.reviewCompany(detail.id, 'reject', rejectReason.trim()), '已拒绝，企业回到草稿状态')}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              确认拒绝
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
