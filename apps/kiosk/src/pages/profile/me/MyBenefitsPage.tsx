// ============================================================
// 我的权益 — /me/benefits（本人，只读）。
// 只展示 BenefitGrant 元数据；不接支付、不核销、不承诺补贴办理结果。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@ai-job-print/ui'
import type { BenefitStatus, BenefitType, MemberBenefitItem } from '@ai-job-print/shared'
import { GiftIcon, LandmarkIcon, PackageIcon, TicketIcon, type LucideIcon } from 'lucide-react'
import { getMyBenefits } from '../../../services/api/memberFavorites'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

const TYPE_META: Record<BenefitType, { label: string; icon: LucideIcon; bg: string; color: string }> = {
  coupon: { label: '优惠券', icon: TicketIcon, bg: 'bg-error-bg', color: 'text-error-fg' },
  free_quota: { label: '免费次数', icon: GiftIcon, bg: 'bg-success-bg', color: 'text-success-fg' },
  package_entitlement: { label: '服务额度', icon: PackageIcon, bg: 'bg-warning-bg', color: 'text-warning-fg' },
  subsidy_eligibility_hint: { label: '政策资格提示', icon: LandmarkIcon, bg: 'bg-primary-50', color: 'text-primary-600' },
}

const STATUS_META: Record<BenefitStatus, { label: string; cls: string }> = {
  active: { label: '可用', cls: 'bg-success-bg text-success-fg' },
  used_up: { label: '已用完', cls: 'bg-neutral-100 text-neutral-500' },
  expired: { label: '已过期', cls: 'bg-warning-bg text-warning-fg' },
  revoked: { label: '已撤销', cls: 'bg-error-bg text-error-fg' },
}

function quantityLine(item: MemberBenefitItem): string {
  if (item.benefitType === 'subsidy_eligibility_hint') return '仅作政策资格与官方入口指引'
  if (item.quantityTotal === null || item.quantityRemaining === null) return '一次性权益'
  return `剩余 ${item.quantityRemaining} / ${item.quantityTotal}`
}

function validityLine(item: MemberBenefitItem): string {
  if (!item.validFrom && !item.validUntil) return '有效期以现场公示或活动规则为准'
  if (item.validFrom && item.validUntil) return `${formatTime(item.validFrom)} 至 ${formatTime(item.validUntil)}`
  if (item.validUntil) return `有效期至 ${formatTime(item.validUntil)}`
  return `自 ${formatTime(item.validFrom!)} 起有效`
}

export function MyBenefitsPage() {
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberBenefitItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    getMyBenefits(getToken(), { pageSize: 50 })
      .then((r) => {
        setItems(r.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  return (
    <MeListShell
      title="我的权益"
      subtitle="本人优惠券、免费次数、服务额度与政策资格提示"
      loginFrom="/me/benefits"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={() => setReloadKey((k) => k + 1)}
      isEmpty={items.length === 0}
      emptyIcon={GiftIcon}
      emptyTitle="还没有权益"
      emptyDescription="管理员发放优惠券、免费次数或政策资格提示后，这里会显示本人权益"
    >
      {items.map((item) => {
        const type = TYPE_META[item.benefitType]
        const status = STATUS_META[item.status]
        const Icon = type.icon
        return (
          <Card key={item.id} className="p-4">
            <div className="flex items-start gap-4">
              <div className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', type.bg].join(' ')}>
                <Icon className={['h-6 w-6', type.color].join(' ')} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500">{type.label}</span>
                  <span className={['rounded-full px-2.5 py-1 text-xs font-medium', status.cls].join(' ')}>{status.label}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-neutral-900">{item.title}</p>
                {item.description && <p className="mt-1 text-xs leading-relaxed text-neutral-500">{item.description}</p>}
                <p className="mt-2 text-xs text-neutral-400">
                  {quantityLine(item)} · {validityLine(item)}
                </p>
              </div>
            </div>
          </Card>
        )
      })}
      <p className="mt-1 text-center text-xs leading-relaxed text-neutral-400">
        权益仅用于本终端服务与打印辅助；政策资格提示只提供信息指引，具体办理与结果以官方平台为准。
      </p>
    </MeListShell>
  )
}
