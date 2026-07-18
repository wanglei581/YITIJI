// ============================================================
// 我的权益 — /me/benefits（本人，只读）。
// 只展示 BenefitGrant 元数据；不接支付、不核销、不承诺补贴办理结果。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState } from '@ai-job-print/ui'
import type { BenefitStatus, BenefitType, MemberBenefitItem } from '@ai-job-print/shared'
import { GiftIcon } from 'lucide-react'
import { getMyBenefits } from '../../../services/api/memberFavorites'
import { useAuth } from '../../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import './me-detail-inkpaper.css'

const TYPE_META: Record<BenefitType, { label: string; icon: KioskIconName; tone: string }> = {
  coupon: { label: '优惠券', icon: 'ticket', tone: 'rose' },
  free_quota: { label: '免费次数', icon: 'sparkle', tone: 'teal' },
  package_entitlement: { label: '服务额度', icon: 'toolbox', tone: 'wheat' },
  subsidy_eligibility_hint: { label: '政策资格提示', icon: 'policy', tone: 'slate' },
}

const STATUS_META: Record<BenefitStatus, { label: string; cls: string }> = {
  active: { label: '可用', cls: 'is-active' },
  used_up: { label: '已用完', cls: 'is-muted' },
  expired: { label: '已过期', cls: 'is-warning' },
  revoked: { label: '已撤销', cls: 'is-danger' },
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
  useInkRipple('.me-inkdetail .me-ripple')

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
    <div className="me-inkdetail me-inkdetail-benefits h-full">
      <MeListShell
        title="我的权益"
        subtitle="本人优惠券、免费次数、服务额度与政策资格提示"
        loginFrom="/me/benefits"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={() => setReloadKey((k) => k + 1)}
      >
        <section className="me-detail-summary" aria-label="权益概览">
          <span className="me-summary-icon me-tone-plum" aria-hidden="true">
            <KIcon name="ticket" />
          </span>
          <div className="min-w-0 flex-1">
            <p>权益口袋</p>
            <strong>{items.length}</strong>
            <span>仅展示本人已领取或已发放权益，不接支付、不做核销</span>
          </div>
          <div className="me-summary-mini" aria-label="权益状态数量">
            <span>可用 {items.filter((item) => item.status === 'active').length}</span>
            <span>已结束 {items.filter((item) => item.status !== 'active').length}</span>
          </div>
        </section>

        {items.length === 0 ? (
          <Card className="me-empty-card">
            <EmptyState
              icon={GiftIcon}
              title="还没有权益"
              description="管理员发放优惠券、免费次数或政策资格提示后，这里会显示本人权益"
              className="py-12"
            />
          </Card>
        ) : (
          items.map((item) => {
            const type = TYPE_META[item.benefitType]
            const status = STATUS_META[item.status]
            return (
              <Card key={item.id} className="me-benefit-card me-ripple">
                <div className="flex items-start gap-4">
                  <span className={['me-row-icon', `me-tone-${type.tone}`].join(' ')}>
                    <KIcon name={type.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="me-chip">{type.label}</span>
                      <span className={['me-status', status.cls].join(' ')}>{status.label}</span>
                    </div>
                    <p className="me-row-title mt-2">{item.title}</p>
                    {item.description && <p className="mt-1 text-xs leading-relaxed text-[color:var(--ink-2)]">{item.description}</p>}
                    <p className="mt-2 text-xs text-[color:var(--muted)]">
                      {quantityLine(item)} · {validityLine(item)}
                    </p>
                  </div>
                </div>
              </Card>
            )
          })
        )}
        <p className="me-legal-note">
          权益仅用于本终端服务与打印辅助；政策资格提示只提供信息指引，具体办理与结果以官方平台为准。
        </p>
      </MeListShell>
    </div>
  )
}
