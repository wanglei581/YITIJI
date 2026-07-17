import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { BenefitActivityListItem, BenefitActivitySourceType, BenefitActivityType } from '@ai-job-print/shared'
import { CheckCircleIcon, ChevronLeftIcon, GiftIcon, LandmarkIcon, PackageIcon, TicketIcon, type LucideIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { BenefitActivitiesApiError, claimBenefitActivity, getBenefitActivity } from '../../services/api/benefitActivities'
import { formatTime } from '../profile/assets/format'
import '../profile/me/me-detail-inkpaper.css'

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

function stockText(item: BenefitActivityListItem): string {
  if (item.claimed) return '已领取'
  if (item.ended) return '活动已结束'
  if (item.soldOut) return '已领完'
  if (item.stockRemaining !== null) return `可领取 · 剩余 ${item.stockRemaining} 份`
  return '可领取'
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
    <div className="me-inkdetail benefit-activity-detail h-full">
      <header className="me-pagehead">
        <button type="button" className="me-pagehead-back" onClick={() => navigate('/activities')}>
          <ChevronLeftIcon aria-hidden="true" />
          返回活动
        </button>
        <div className="me-pagehead-titles">
          <h1>权益活动详情</h1>
          <p>领取后会进入本人「我的权益」</p>
        </div>
      </header>

      <main className="benefit-activity-content">
        {state === 'loading' ? (
          <LoadingState className="benefit-activity-state" />
        ) : state === 'error' || !item ? (
          <ErrorState className="benefit-activity-state" onRetry={load} />
        ) : (
          <>
            <Card className="benefit-activity-hero">
              <span className={['benefit-activity-icon', `is-${item.benefitType}`].join(' ')} aria-hidden="true">
                {(() => {
                  const Icon = TYPE_META[item.benefitType].icon
                  return <Icon />
                })()}
              </span>
              <div className="benefit-activity-hero-main">
                <div className="benefit-activity-chips">
                  <span className="me-chip">{SOURCE_LABEL[item.sourceType]}</span>
                  <span className="me-chip">{TYPE_META[item.benefitType].label}</span>
                  <span className={['benefit-activity-stock', item.claimed ? 'is-claimed' : item.soldOut || item.ended ? 'is-ended' : ''].join(' ')}>
                    {stockText(item)}
                  </span>
                </div>
                <h2>{item.title}</h2>
                {item.description && <p>{item.description}</p>}
              </div>
            </Card>

            <section className="benefit-activity-info" aria-label="权益内容">
              <div>
                <span>权益额度</span>
                <strong>{quantityText(item)}</strong>
              </div>
              <div>
                <span>活动有效期</span>
                <strong>{validity(item)}</strong>
              </div>
            </section>

            {item.rulesText && (
              <Card className="benefit-activity-rules">
                <h3>活动规则</h3>
                <p>{item.rulesText}</p>
              </Card>
            )}

            <Card className="benefit-activity-steps">
              <div>
                <span>1</span>
                <p><strong>领取权益</strong><small>登录后点「立即领取」，计入本人权益</small></p>
              </div>
              <div>
                <span>2</span>
                <p><strong>使用服务</strong><small>进入对应服务，按活动规则使用权益</small></p>
              </div>
              <div>
                <span>3</span>
                <p><strong>查看余量</strong><small>在「我的 - 我的权益」查看余量与有效期</small></p>
              </div>
            </Card>

            <div className="benefit-activity-compliance">
              {item.benefitType === 'subsidy_eligibility_hint'
                ? '本活动仅提供政策资格提示、材料说明和官方入口指引，具体申请、审核和结果以官方渠道为准。'
                : '权益仅用于本终端服务与打印辅助，不代表招聘会报名、签到、投递结果、面试或录用承诺。'}
            </div>

            {message && (
              <div className="benefit-activity-message" role="status">
                {message}
              </div>
            )}

            <div className="benefit-activity-cta">
              <Button
                size="lg"
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
              <Button size="lg" variant="secondary" onClick={() => navigate('/me/benefits')}>
                我的权益
              </Button>
            </div>

            <p className="me-legal-note benefit-activity-note">
              登录后即可领取；已领取的权益可在「我的权益」查看；活动已领完或已结束时不可领取。
            </p>
          </>
        )}
      </main>
    </div>
  )
}
