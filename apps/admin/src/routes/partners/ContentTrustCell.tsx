import { StatusBadge } from '@ai-job-print/ui'
import { ORG_CONTENT_TRUST_STATUSES, ORG_CONTENT_TRUST_STATUS_LABELS, ORG_CONTENT_TRUST_UNSET_LABEL, contentTrustPublishable, type OrgContentTrustStatus } from './contentTrustRules'

/**
 * 列表里的「内容可信」单元格。
 *
 * 为什么列表也要显示：录种子数据时运营要一眼看出**哪几家还没盖章**，
 * 否则只能逐个打开抽屉。判据是 active + 未归档两条，所以已归档必须单独标出来 ——
 * 只显示 active 会让人以为已经能发了。
 */
export function ContentTrustCell({ status, archived }: { status: string | null; archived: boolean }) {
  const label =
    status === null
      ? ORG_CONTENT_TRUST_UNSET_LABEL
      : (ORG_CONTENT_TRUST_STATUSES as readonly string[]).includes(status)
        ? ORG_CONTENT_TRUST_STATUS_LABELS[status as OrgContentTrustStatus]
        : status
  const tone = status === 'active' ? 'success' : status === 'pending' ? 'warning' : status === null ? 'default' : 'error'
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge dot status={tone} label={label} />
      {archived && <StatusBadge status="error" label="已归档" />}
      {!contentTrustPublishable(status, archived) && (
        <span className="whitespace-nowrap text-[11px] text-neutral-400">内容发不出去</span>
      )}
    </div>
  )
}

