import { RECRUITMENT_EMERGENCY_REASON_LABELS, type RecruitmentEmergencyReasonCode } from '@ai-job-print/shared'
import { Button, StatusBadge } from '@ai-job-print/ui'
import { AlertTriangleIcon, ExternalLinkIcon, LockIcon } from 'lucide-react'
import type { OfficialChannelPartnerItem } from '../../services/api/officialChannels'
import { checkChannelUrl } from './officialChannelRules'

function reasonLabel(code: string | null): string {
  if (!code) return '未注明'
  return RECRUITMENT_EMERGENCY_REASON_LABELS[code as RecruitmentEmergencyReasonCode] ?? code
}

/** 启用开关。role=switch，读屏读得出是哪一条、现在开还是关。 */
function EnabledSwitch({
  channel,
  busy,
  onToggle,
}: {
  channel: OfficialChannelPartnerItem
  busy: boolean
  onToggle: () => void
}) {
  const on = channel.enabled
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`启用「${channel.name}」`}
      disabled={busy}
      onClick={onToggle}
      className="group inline-flex min-h-[40px] items-center gap-2 rounded-md px-1 text-sm text-neutral-700 disabled:cursor-wait disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-primary-600' : 'bg-neutral-300'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      <span className={on ? 'font-medium text-primary-700' : 'text-neutral-500'}>
        {busy ? '保存中…' : on ? '已启用' : '已停用'}
      </span>
    </button>
  )
}

/**
 * 官方渠道列表的一行。
 *
 * 平台紧急下架的渠道冻结：不给开关、不给编辑，只剩归档，并写清事由与说明。
 * 链接不在当前登记的官方域名内时照实提示（服务端公开读取会把它滤掉、重新启用会被拒绝），
 * 不让「已启用」四个字暗示终端上一定看得到。
 */
export function OfficialChannelRow({
  channel,
  domains,
  busy,
  onToggle,
  onEdit,
  onArchive,
}: {
  channel: OfficialChannelPartnerItem
  domains: readonly string[] | null
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onArchive: () => void
}) {
  const held = channel.emergencyTakedown
  const outOfRange = !held && domains !== null && domains.length > 0 && checkChannelUrl(channel.url, domains).kind !== 'ok'

  return (
    <tr className="align-top" data-channel-id={channel.id}>
      <td className="whitespace-nowrap px-4 py-3 text-center tabular-nums text-neutral-500">{channel.displayOrder}</td>
      <td className="px-4 py-3">
        <p className="font-medium text-neutral-800">{channel.name}</p>
        <a
          href={channel.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-flex max-w-full items-start gap-1 break-all font-mono text-xs text-neutral-500 hover:text-primary-700 hover:underline"
        >
          {channel.url}
          <ExternalLinkIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        </a>
        {outOfRange && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning-fg">
            <AlertTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {channel.enabled
              ? '链接不在已登记的官方域名内，本机构终端不会显示这个渠道；请改链接或联系平台登记域名。'
              : '链接不在已登记的官方域名内，重新启用会被拒绝；请先改链接。'}
          </p>
        )}
        {held && (
          <div className="mt-2 rounded-lg border border-error/25 bg-error-bg/60 px-3 py-2 text-xs leading-relaxed text-error-fg">
            <p>
              <span className="font-semibold">事由：</span>{reasonLabel(channel.emergencyReasonCode)}
            </p>
            {channel.emergencyReasonText && (
              <p className="mt-0.5 text-neutral-700">
                <span className="font-semibold text-error-fg">说明：</span>{channel.emergencyReasonText}
              </p>
            )}
            <p className="mt-1 flex items-center gap-1 text-neutral-500">
              <LockIcon className="h-3 w-3" aria-hidden="true" />
              已冻结：不能再启用或修改，只能归档。平台的紧急下架不能恢复。
            </p>
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        {held ? (
          <StatusBadge dot status="error" label="平台已紧急下架" />
        ) : (
          <EnabledSwitch channel={channel} busy={busy} onToggle={onToggle} />
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          {!held && (
            <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
              编辑
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-error-fg hover:bg-error-bg" onClick={onArchive} disabled={busy}>
            归档
          </Button>
        </div>
      </td>
    </tr>
  )
}
