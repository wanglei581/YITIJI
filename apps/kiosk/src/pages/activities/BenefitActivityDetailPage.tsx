import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { BenefitActivityListItem, BenefitActivitySourceType, BenefitActivityType } from '@ai-job-print/shared'
import { CheckCircleIcon, GiftIcon, LandmarkIcon, PackageIcon, TicketIcon, type LucideIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { BenefitActivitiesApiError, claimBenefitActivity, getBenefitActivity } from '../../services/api/benefitActivities'
import { formatTime } from '../profile/assets/format'

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

function quantityText(item: BenefitActivityListItem): string {
  if (item.benefitType === 'subsidy_eligibility_hint') return '仅提供政策资格和官方入口指引'
  if (item.quantityTotal === null) return '一次性权益'
  return `${item.quantityTotal} 次 / 份服务额度`
}

export function BenefitActivityDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [item, setItem] = useState<BenefitActivityListItem | null>(null)
  const [state, setState] = useState<PageState>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)

  const load = useCallback(() => {
    if (!id) {
      setState('error')
      return
    }
    setState('loading')
    getBenefitActivity(id, getToken())
      .then((res) => {
        setItem(res)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [getToken, id])

  useEffect(() => {
    load()
  }, [load])

  const claim = async () => {
    if (!id) return
    if (!isLoggedIn) {
      navigate('/login', { state: { from: `/activities/${id}` } })
      return
    }
    setClaiming(true)
    setMessage(null)
    try {
      await claimBenefitActivity(id, getToken())
      setMessage('领取成功，已加入我的权益')
      await getBenefitActivity(id, getToken()).then(setItem)
    } catch (error) {
      if (error instanceof BenefitActivitiesApiError && error.code === 'LOGIN_REQUIRED') {
        navigate('/login', { state: { from: `/activities/${id}` } })
      } else if (error instanceof BenefitActivitiesApiError && error.code === 'BENEFIT_ACTIVITY_ALREADY_CLAIMED') {
        setMessage('已领取，可在我的权益查看')
        await getBenefitActivity(id, getToken()).then(setItem).catch(() => undefined)
      } else {
        setMessage(error instanceof Error ? error.message : '领取失败，请稍后重试')
      }
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="权益活动详情"
        subtitle="领取后会进入本人「我的权益」"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/activities')}>
            返回活动
          </Button>
        }
      />

      <div className="mt-4 flex-1 overflow-y-auto pb-8">
        {state === 'loading' ? (
          <LoadingState className="py-20" />
        ) : state === 'error' || !item ? (
          <ErrorState className="py-20" onRetry={load} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <Card className="p-5">
              <div className="flex items-start gap-4">
                <div className={['flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl', TYPE_META[item.benefitType].bg].join(' ')}>
                  {(() => {
                    const Icon = TYPE_META[item.benefitType].icon
                    return <Icon className={['h-7 w-7', TYPE_META[item.benefitType].color].join(' ')} aria-hidden="true" />
                  })()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500">{SOURCE_LABEL[item.sourceType]}</span>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500">{TYPE_META[item.benefitType].label}</span>
                    {item.claimed && <span className="rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success-fg">已领取</span>}
                  </div>
                  <h1 className="mt-3 text-xl font-bold leading-snug text-neutral-900">{item.title}</h1>
                  {item.description && <p className="mt-2 text-sm leading-relaxed text-neutral-600">{item.description}</p>}
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-neutral-900">权益内容</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-neutral-50 p-3">
                  <p className="text-xs text-neutral-400">权益额度</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-900">{quantityText(item)}</p>
                </div>
                <div className="rounded-xl bg-neutral-50 p-3">
                  <p className="text-xs text-neutral-400">活动有效期</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-900">{validity(item)}</p>
                </div>
              </div>
              {item.rulesText && (
                <div className="mt-4 rounded-xl border border-neutral-100 p-3">
                  <p className="text-xs font-medium text-neutral-500">活动规则</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-600">{item.rulesText}</p>
                </div>
              )}
            </Card>

            <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm leading-relaxed text-primary-700">
              {item.benefitType === 'subsidy_eligibility_hint'
                ? '本活动仅提供政策资格提示、材料说明和官方入口指引，具体申请、审核和结果以官方渠道为准。'
                : '权益仅用于本终端服务与打印辅助，不代表招聘会报名、签到、投递结果、面试或录用承诺。'}
            </div>

            {message && (
              <div className="rounded-xl border border-success-bg bg-success-bg px-4 py-3 text-sm font-medium text-success-fg">
                {message}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                size="lg"
                className="h-14"
                disabled={claiming || (isLoggedIn && !item.claimed && (item.soldOut || item.ended))}
                onClick={() => {
                  if (item.claimed) navigate('/me/benefits')
                  else void claim()
                }}
              >
                {item.claimed ? (
                  <>
                    <CheckCircleIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
                    查看我的权益
                  </>
                ) : claiming ? '领取中...' : isLoggedIn ? '立即领取' : '登录后领取'}
              </Button>
              <Button size="lg" variant="secondary" className="h-14" onClick={() => navigate('/me/benefits')}>
                我的权益
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
