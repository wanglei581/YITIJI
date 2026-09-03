import type { ReviewStatus } from '../services/api'

/**
 * 审核状态下方的驳回原因行（岗位 / 招聘会共用，与政策页、企业页同口径）。
 *
 * 三态必须分清，不能合并：
 *   - 非 rejected            → 不渲染任何东西。`rejectReason` 此时恒为 null
 *     （审核通过、机构编辑重新提审都会把它清成 null），null **表示「没有被驳回」**。
 *   - rejected + 有原因      → 展示原因，并说明改完会重新提审。
 *   - rejected + 原因为 null → 只可能是存量数据（现在 Admin 驳回必填 reason，
 *     jobs-admin.service.ts 的 REJECT_REASON_REQUIRED）。这时**不能显示空串或
 *     「无原因」**——那会被读成「平台没给理由地拒了你」；如实说明未记录，并给出下一步。
 */
export function RejectReason({
  reviewStatus,
  reason,
}: {
  reviewStatus: ReviewStatus
  reason: string | null
}) {
  if (reviewStatus !== 'rejected') return null
  return reason ? (
    <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-error-fg" title={reason}>
      驳回原因：{reason}
      <span className="text-neutral-400">（修改后将重新提审）</span>
    </p>
  ) : (
    <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-neutral-500">
      本条未记录驳回原因，请联系平台管理员确认。
    </p>
  )
}
