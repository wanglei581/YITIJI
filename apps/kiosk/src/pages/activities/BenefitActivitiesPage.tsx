import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card } from '@ai-job-print/ui'
import { MeTouchShell } from '../profile/touch/MeTouchShell'
import { MeEmptyPack, MeErrorPack, MeExitCard, MeLoadingPack } from '../profile/touch/MeStatePacks'
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
  ai_quota: { label: 'AI 次数', icon: GiftIcon, bg: 'bg-success-bg', color: 'text-success-fg' },
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
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<PageState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const source = searchParams.get('source') === 'fair' ? 'fair' : undefined

  const load = useCallback(() => {
    setState('loading')
    listBenefitActivities(getToken(), source)
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [getToken, source])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const title = state === 'error'
    ? '这次没读到'
    : state === 'loading'
      ? '正在读取'
      : items.length === 0
        ? '现在没有活动'
        : (source === 'fair' ? '招聘会权益活动' : '现在可以看的活动')
  const subtitle = state === 'error'
    ? '可以再试一次'
    : state === 'loading'
      ? '请稍等'
      : source === 'fair'
        ? '仅展示招聘会相关服务权益，不代表报名、签到或投递结果'
        : '只用于这台机器的服务和打印'
  const countSuffix = state === 'ready' && items.length > 0
    ? ` · 共 ${total} 个活动${total > items.length ? ` · 仅显示最近 ${items.length} 个` : ''}`
    : ''

  return (
    <div className="fusion-w5 fusion-w5--profile k8-activities h-full">
    <MeTouchShell
      nav={false}
      eyebrow="权益活动"
      title={title}
      sub={`${subtitle}${countSuffix}`}
      backLabel="返回我的"
      onBack={() => navigate('/profile')}
      status={{ tone: state === 'error' ? 'warn' : 'unknown', label: state === 'error' ? '这次没读到' : (items.length === 0 && state === 'ready' ? '现在没有活动' : '可以先看再领') }}
      ask={{ label: '问小青：领取代表报名了吗？', draft: '领取代表报名了吗？' }}
    >
      <section data-kiosk-domain="profile" data-kiosk-screen="activities" className="flex min-h-0 flex-1 flex-col gap-4">

      <button type="button" className="qx-btn" data-variant="secondary" onClick={() => navigate('/me/benefits')}>
        我的权益
      </button>

      <div className="k8-activities-compliance rounded-xl border border-warning/30 bg-warning-bg px-[22px] py-3.5 leading-relaxed">
        领取不代表报名、签到或投递。权益活动只用于本终端服务与打印辅助。政策资格提示只提供官方入口和材料指引；招聘会相关活动不生成报名、签到或投递凭证。
      </div>

      <div className="k8-activities-scroll min-h-0 pb-5">
        {state === 'loading' ? (
          <MeLoadingPack rows={6} />
        ) : state === 'error' ? (
          <MeErrorPack onRetry={() => setReloadKey((k) => k + 1)} />
        ) : items.length === 0 ? (
          <MeEmptyPack sentence="现在没有可参加的活动。">
            <MeExitCard art="print" title="去打印" desc="没有活动也能打印、扫描" onClick={() => navigate('/print-scan')} />
            <MeExitCard title="查政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
          </MeEmptyPack>
        ) : (
          <div className="k8-activities-grid grid grid-cols-2 gap-4">
            {items.map((item) => {
              const meta = TYPE_META[item.benefitType]
              const Icon = meta.icon
              return (
                <Card key={item.id} className="k8-activity-card p-0" data-benefit-type={item.benefitType} data-ended={item.ended || undefined}>
                  <div className="flex flex-col gap-3 p-[22px_24px]">
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

      <p className="k8-activities-notice">
        <InfoIcon aria-hidden="true" />
        <span>领取不代表报名。活动发布后才会在这里展示；未发布、已结束或已下架活动不再可领。领取后进入本人「我的权益」。</span>
      </p>
      </section>
    </MeTouchShell>
    </div>
  )
}
