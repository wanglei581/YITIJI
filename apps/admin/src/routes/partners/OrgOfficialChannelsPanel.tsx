// ============================================================
// 机构详情抽屉里的「官方渠道」（3.14）：只读 + 单条紧急下架。
//
// 渠道由机构在机构后台「机构资料 → 本机构官方渠道」里自行维护，二维码只出现在该机构自己的一体机上。
// 管理员这里不新增、不编辑、不恢复，只能紧急下架（复用 3.13 的 EmergencyTakedownDialog：
// 必选事由并填写说明、单向不可恢复、写审计、通知机构）。已下架的行写清事由与说明，不再给按钮。
// 官方渠道不属于招聘内容托管：托管开关开或关，本节行为一样，所以这里不读托管开关。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { RECRUITMENT_EMERGENCY_REASON_LABELS, type RecruitmentEmergencyReasonCode } from '@ai-job-print/shared'
import { StatusBadge } from '@ai-job-print/ui'
import { AlertTriangleIcon, ExternalLinkIcon, QrCodeIcon } from 'lucide-react'
import { getUser } from '../../services/auth'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { orgOfficialChannelsService, type OfficialChannelAdminItem } from '../../services/api/orgOfficialChannels'
import { EmergencyTakedownDialog } from '../components/recruitment/EmergencyTakedownDialog'
import type { EmergencyTakedownTarget } from '../components/recruitment/emergencyReason'
import { hostWithinDomain } from './officialDomainRules'

function reasonLabel(code: string | null): string {
  if (!code) return '未注明'
  return RECRUITMENT_EMERGENCY_REASON_LABELS[code as RecruitmentEmergencyReasonCode] ?? code
}

/** 链接主机名是否落在当前登记的域名（含子域名）内；解析不了按不在范围内算。 */
function withinDomains(url: string, domains: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname
    return domains.some((domain) => hostWithinDomain(host, domain))
  } catch {
    return false
  }
}

function ChannelItem({
  channel,
  domains,
  canTakedown,
  onTakedown,
}: {
  channel: OfficialChannelAdminItem
  domains: readonly string[] | null
  canTakedown: boolean
  onTakedown: () => void
}) {
  const held = channel.emergencyTakedown
  const outOfRange = !held && channel.enabled && domains !== null && !withinDomains(channel.url, domains)
  return (
    <li className="flex items-start gap-3 px-3 py-2.5" data-channel-id={channel.id}>
      <span className="mt-0.5 w-7 shrink-0 text-center text-xs tabular-nums text-neutral-400" title="排序">#{channel.displayOrder}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-neutral-800">{channel.name}</span>
          {held ? (
            <StatusBadge dot status="error" label="平台已紧急下架" />
          ) : (
            <StatusBadge dot status={channel.enabled ? 'success' : 'default'} label={channel.enabled ? '机构已启用' : '机构已停用'} />
          )}
        </div>
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
          <p className="mt-1 flex items-start gap-1 text-[11px] text-warning-fg">
            <AlertTriangleIcon className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            链接不在当前登记的官方域名内，终端不会显示这一条。
          </p>
        )}
        {held && (
          <p className="mt-1.5 rounded bg-error-bg/70 px-2.5 py-1.5 text-xs leading-relaxed text-error-fg">
            <span className="font-semibold">事由：</span>{reasonLabel(channel.emergencyReasonCode)}
            {channel.emergencyReasonText && (
              <>
                <span className="mx-1 text-error-fg/50">·</span>
                <span className="font-semibold">说明：</span>
                <span className="text-neutral-700">{channel.emergencyReasonText}</span>
              </>
            )}
            <span className="mt-0.5 block text-[11px] text-neutral-500">单向下架，不能恢复；机构只能归档这一条。</span>
          </p>
        )}
      </div>
      {!held && canTakedown && (
        <button
          type="button"
          onClick={onTakedown}
          className="shrink-0 rounded-lg border border-error/40 bg-surface px-2.5 py-1 text-xs font-semibold text-error-fg hover:bg-error-bg"
        >
          紧急下架
        </button>
      )}
    </li>
  )
}

export function OrgOfficialChannelsPanel({
  orgId,
  orgName,
  domains,
}: {
  orgId: string
  orgName: string
  /** 同一抽屉里「官方域名」小节读到的当前登记；null = 还没读到，不做范围提示。 */
  domains: readonly string[] | null
}) {
  const [items, setItems] = useState<OfficialChannelAdminItem[]>([])
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')
  const [takedown, setTakedown] = useState<EmergencyTakedownTarget | null>(null)
  const canTakedown = getUser()?.role === 'admin'

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setState('loading')
    try {
      const list = await orgOfficialChannelsService.listOfficialChannels(orgId)
      setItems([...list].sort((a, b) => a.displayOrder - b.displayOrder))
      setState('ready')
    } catch (e) {
      setLoadError(userMessageOf(e, '请稍后重试'))
      setState('error')
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const heldCount = items.filter((item) => item.emergencyTakedown).length

  return (
    <section aria-label="官方渠道" className="space-y-3 rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center gap-2">
        <QrCodeIcon className="h-4 w-4 text-neutral-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-neutral-800">官方渠道</p>
        {state === 'ready' && (
          <span className="text-xs text-neutral-500">
            共 {items.length} 条{heldCount > 0 ? `，其中 ${heldCount} 条已紧急下架` : ''}
          </span>
        )}
        <span className="ml-auto text-[11px] text-neutral-400">对应一体机「本机构官方渠道」页</span>
      </div>

      <p className="rounded bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-600">
        {'机构在机构后台「机构资料 → 本机构官方渠道」里自行维护，二维码只出现在该机构自己的一体机上。'}
        {'管理员这里只能查看与紧急下架，不能新增、编辑或恢复。官方渠道不属于招聘内容托管，托管开关开或关，这里都一样。'}
      </p>

      {state === 'loading' && <p className="text-xs text-neutral-400">读取中…</p>}
      {state === 'error' && (
        <p className="text-xs text-error-fg" role="alert">
          官方渠道没有读到：{loadError}
          <button type="button" onClick={() => void load()} className="ml-1 underline">重试</button>
        </p>
      )}
      {state === 'ready' && items.length === 0 && (
        <p className="text-xs text-neutral-500">这家机构还没有添加官方渠道。</p>
      )}
      {state === 'ready' && items.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded border border-neutral-100" aria-label="机构官方渠道列表">
          {items.map((channel) => (
            <ChannelItem
              key={channel.id}
              channel={channel}
              domains={domains}
              canTakedown={canTakedown}
              onTakedown={() => setTakedown({ targetType: 'official_channel', targetId: channel.id, title: channel.name, orgName })}
            />
          ))}
        </ul>
      )}
      {state === 'ready' && !canTakedown && (
        <p className="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          当前账号不是管理员，只能查看。紧急下架是管理员职责，服务端对该端点限定 admin 角色。
        </p>
      )}

      <EmergencyTakedownDialog target={takedown} onClose={() => setTakedown(null)} onDone={() => void load(false)} />
    </section>
  )
}
