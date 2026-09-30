import { formatDateTime, RECRUITMENT_EMERGENCY_REASON_LABELS, type RecruitmentEmergencyReasonCode } from '@ai-job-print/shared'
import { LockIcon } from 'lucide-react'
import type { PartnerPolicyRecord } from '../../services/api/policies'

function reasonLabel(code: string | null | undefined): string {
  if (!code) return '未注明'
  return RECRUITMENT_EMERGENCY_REASON_LABELS[code as RecruitmentEmergencyReasonCode] ?? code
}

function fmtTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const formatted = formatDateTime(iso, { fallback: '' })
  return formatted || null
}

/**
 * 被平台紧急下架的政策：写清事由、说明与时间，并说明这一条已冻结。
 * 与官方渠道面板的下架提示同一口径（OfficialChannelRow）。服务端对这一条的发布一律拒绝
 * （EMERGENCY_TAKEDOWN_IRREVERSIBLE），所以列表上不再给编辑、审核通过与发布。
 */
export function PolicyEmergencyNote({ row }: { row: PartnerPolicyRecord }) {
  const at = fmtTime(row.emergencyTakedownAt)
  return (
    <div className="rounded-lg border border-error/25 bg-error-bg/60 px-3 py-2 text-xs leading-relaxed text-error-fg">
      <p>
        <span className="font-semibold">事由：</span>{reasonLabel(row.emergencyReasonCode)}
        {at && <span className="ml-2 text-neutral-500">下架时间 {at}</span>}
      </p>
      {row.emergencyReasonText && (
        <p className="mt-0.5 text-neutral-700">
          <span className="font-semibold text-error-fg">说明：</span>{row.emergencyReasonText}
        </p>
      )}
      <p className="mt-1 flex items-start gap-1 text-neutral-500">
        <LockIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        已冻结：这一条不能再编辑、审核或发布，只能删除。平台的紧急下架不能恢复；更正后的内容请新建一条，由本机构审核发布。
      </p>
    </div>
  )
}
