import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { BenefitActivityListItem, BenefitActivitySourceType, BenefitActivityType } from '@ai-job-print/shared'
import {
  ChevronRightIcon,
  GiftIcon,
  InfoIcon,
  LandmarkIcon,
  PackageIcon,
  TicketIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { listBenefitActivities } from '../../services/api/benefitActivities'
import { formatTime } from '../profile/assets/format'
import './activities-batch8.css'

type PageState = 'loading' | 'ready' | 'error'

const TYPE_META: Record<BenefitActivityType, { label: string; icon: LucideIcon; bg: string; color: string }> = {
  coupon: { label: '优惠券', icon: TicketIcon, bg: 'bg-error-bg', color: 'text-error-fg' },
  free_quota: { label: '免费次数', icon: GiftIcon, bg: 'bg-success-bg', color: 'text-success-fg' },
  package_entitlement: { label: '服务额度', icon: PackageIcon, bg: 'bg-warning-bg', color: 'text-warning-fg' },
  subsidy_eligibility_hint: { label: '政策资格提示', icon: LandmarkIcon, bg: 'bg-primary-50', color: 'text-primary-600' },
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
  if (item.ended) return '已结束'
  if (item.soldOut) return '已领完'
  if (item.claimed) return '已领取'
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
    <div className="k8-activities flex h-full min-h-0 flex-col px-12 py-5">
      <PageHeader
        className="k8-activities-header"
        title={title}
        subtitle={`${subtitle}${state === 'ready' ? ` · 共 ${items.length} 个活动` : ''}`}
        actions={
          <div className="flex gap-3">
            <Button size="sm" variant="secondary" onClick={() => navigate('/profile')}>
              返回我的
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/me/benefits')}>
              <TicketIcon className="mr-1 h-5 w-5" aria-hidden="true" />
              我的权益
            </Button>
          </div>
        }
      />

      <div className="k8-activities-compliance mt-4 rounded-xl border border-warning/30 bg-warning-bg px-[22px] py-3.5 text-[18px] leading-relaxed text-warning-fg">
        权益活动只用于本终端服务与打印辅助。政策资格提示只提供官方入口和材料指引；招聘会相关活动不生成报名、签到或投递凭证。
      </div>

      <div className="k8-activities-scroll mt-4 min-h-0 flex-1 overflow-y-auto pb-5">
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
          <div className="k8-activities-grid grid grid-cols-2 gap-4">
            {items.map((item) => {
              const meta = TYPE_META[item.benefitType]
              const Icon = meta.icon
              return (
                <Card key={item.id} className="k8-activity-card p-0" data-benefit-type={item.benefitType} data-ended={item.ended || undefined}>
                  <div className="flex h-full flex-col gap-3 p-[22px_24px]">
                    <div className="flex items-start gap-3.5">
                      <div className="k8-activity-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px]">
                        <Icon className="h-[30px] w-[30px]" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="k8-activity-src-chip">{SOURCE_LABEL[item.sourceType]}</span>
                          <span className="k8-activity-type-chip">{meta.label}</span>
                          <span className={`k8-activity-stock ml-auto ${item.ended || item.soldOut ? 'is-off' : item.stockRemaining !== null && item.stockRemaining <= 5 ? 'is-low' : 'is-ok'}`}>
                            {stockLabel(item)}
                          </span>
                        </div>
                        <h2 className="mt-2 font-serif text-[25px] font-bold leading-snug text-neutral-900">{item.title}</h2>
                      </div>
                    </div>

                    {item.description && <p className="line-clamp-2 text-[17px] leading-relaxed text-neutral-500">{item.description}</p>}

                    <div className="mt-auto space-y-1 text-[16px] text-neutral-500">
                      <p>{validity(item)}</p>
                      <p>
                        {item.claimed ? '已领取 · 可在我的权益查看' : stockLabel(item)}
                      </p>
                    </div>

                    <Button
                      className="k8-activity-action min-h-[60px] w-full text-[20px]"
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

      <p className="k8-activities-notice shrink-0 flex items-center gap-3 rounded-[14px] border border-dashed border-neutral-200 bg-neutral-50 px-5 py-3 text-[15px] leading-relaxed text-neutral-500">
        <InfoIcon className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        活动发布后才会在这里展示；未发布、已结束或已下架活动不再可领。领取后进入本人「我的权益」。
      </p>
    </div>
  )
}
