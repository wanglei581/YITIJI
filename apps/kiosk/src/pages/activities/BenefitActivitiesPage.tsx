import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { BenefitActivityListItem, BenefitActivitySourceType, BenefitActivityType } from '@ai-job-print/shared'
import {
  ChevronRightIcon,
  GiftIcon,
  LandmarkIcon,
  PackageIcon,
  TicketIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { listBenefitActivities } from '../../services/api/benefitActivities'
import { formatTime } from '../profile/assets/format'

type PageState = 'loading' | 'ready' | 'error'

const TYPE_META: Record<BenefitActivityType, { label: string; icon: LucideIcon; bg: string; color: string }> = {
  coupon: { label: '优惠券', icon: TicketIcon, bg: 'bg-rose-50', color: 'text-rose-600' },
  free_quota: { label: '免费次数', icon: GiftIcon, bg: 'bg-emerald-50', color: 'text-emerald-600' },
  package_entitlement: { label: '服务额度', icon: PackageIcon, bg: 'bg-amber-50', color: 'text-amber-600' },
  subsidy_eligibility_hint: { label: '政策资格提示', icon: LandmarkIcon, bg: 'bg-blue-50', color: 'text-blue-600' },
}

const SOURCE_LABEL: Record<BenefitActivitySourceType, string> = {
  platform: '平台活动',
  campus: '校园活动',
  gov: '政策提示',
  fair: '招聘会服务活动',
  partner: '合作机构活动',
}

function validity(item: BenefitActivityListItem): string {
  if (item.validFrom && item.validUntil) return `${formatTime(item.validFrom)} 至 ${formatTime(item.validUntil)}`
  if (item.validUntil) return `有效期至 ${formatTime(item.validUntil)}`
  if (item.validFrom) return `自 ${formatTime(item.validFrom)} 起`
  return '以活动规则为准'
}

function stockLabel(item: BenefitActivityListItem): string {
  if (item.soldOut) return '已领完'
  if (item.stockRemaining !== null && item.stockRemaining <= 5) return '即将领完'
  return '可领取'
}

function ctaLabel(item: BenefitActivityListItem, isLoggedIn: boolean): string {
  if (!isLoggedIn) return '登录后领取'
  if (item.claimed) return '查看我的权益'
  if (item.soldOut) return '已领完'
  if (item.ended) return '已结束'
  return '查看详情'
}

export function BenefitActivitiesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<BenefitActivityListItem[]>([])
  const [state, setState] = useState<PageState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const source = searchParams.get('source') === 'fair' ? 'fair' : undefined

  const load = useCallback(() => {
    setState('loading')
    listBenefitActivities(getToken(), source)
      .then((res) => {
        setItems(res.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [getToken, source])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const title = source === 'fair' ? '招聘会权益活动' : '权益活动'
  const subtitle = source === 'fair'
    ? '仅展示招聘会相关服务权益，不代表报名、签到或投递结果'
    : '领取平台服务权益、打印额度和政策信息提示'

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/profile')}>
            返回我的
          </Button>
        }
      />

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-700">
        权益活动只用于本终端服务与打印辅助。政策资格提示只提供官方入口和材料指引；招聘会相关活动不生成报名、签到或投递凭证。
      </div>

      <div className="mt-4 flex-1 overflow-y-auto pb-8">
        {state === 'loading' ? (
          <LoadingState className="py-20" />
        ) : state === 'error' ? (
          <ErrorState className="py-20" onRetry={() => setReloadKey((k) => k + 1)} />
        ) : items.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              icon={GiftIcon}
              title="暂无可领取活动"
              description="活动发布后会在这里展示；未发布、已结束或已下架活动不会显示"
              className="py-12"
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item) => {
              const meta = TYPE_META[item.benefitType]
              const Icon = meta.icon
              return (
                <Card key={item.id} className="p-4">
                  <div className="flex h-full flex-col gap-4">
                    <div className="flex items-start gap-3">
                      <div className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', meta.bg].join(' ')}>
                        <Icon className={['h-6 w-6', meta.color].join(' ')} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">{SOURCE_LABEL[item.sourceType]}</span>
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">{meta.label}</span>
                        </div>
                        <h2 className="mt-2 text-base font-semibold leading-snug text-gray-900">{item.title}</h2>
                        {item.description && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-gray-500">{item.description}</p>}
                      </div>
                    </div>

                    <div className="mt-auto space-y-2 text-xs text-gray-400">
                      <p>{validity(item)}</p>
                      <p>
                        {stockLabel(item)}
                        {item.claimed ? ' · 已领取' : ''}
                      </p>
                    </div>

                    <Button
                      className="h-12 w-full"
                      variant={item.claimed ? 'secondary' : 'primary'}
                      disabled={isLoggedIn && !item.claimed && (item.soldOut || item.ended)}
                      onClick={() => {
                        if (!isLoggedIn) navigate('/login', { state: { from: `/activities/${item.id}` } })
                        else if (item.claimed) navigate('/me/benefits')
                        else navigate(`/activities/${item.id}`)
                      }}
                    >
                      {ctaLabel(item, isLoggedIn)}
                      <ChevronRightIcon className="ml-1 h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
