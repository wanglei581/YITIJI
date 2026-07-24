// 权益活动详情页 — 原型 72（72-activity-detail.html）视觉对齐。
// 布局：Hero 大卡 + 权益格 + 活动规则 + 使用步骤 + 合规提示 + 双 CTA。

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { BenefitActivityListItem, BenefitActivitySourceType, BenefitActivityType } from '@ai-job-print/shared'
import {
  CheckCircleIcon,
  GiftIcon,
  InfoIcon,
  LandmarkIcon,
  PackageIcon,
  SunIcon,
  TicketIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { BenefitActivitiesApiError, claimBenefitActivity, getBenefitActivity } from '../../services/api/benefitActivities'
import { formatTime } from '../profile/assets/format'
import './activities-detail-inkpaper.css'

type PageState = 'loading' | 'ready' | 'error'

const TYPE_META: Record<BenefitActivityType, { label: string; icon: LucideIcon }> = {
  coupon: { label: '优惠券', icon: TicketIcon },
  free_quota: { label: '免费次数', icon: GiftIcon },
  package_entitlement: { label: '服务额度', icon: PackageIcon },
  subsidy_eligibility_hint: { label: '政策资格提示', icon: LandmarkIcon },
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

function stockClass(item: BenefitActivityListItem): string {
  if (item.ended || item.soldOut) return 'is-off'
  if (item.stockRemaining !== null && item.stockRemaining <= 5) return 'is-low'
  return ''
}

function stockText(item: BenefitActivityListItem): string {
  if (item.claimed) return '已领取'
  if (item.ended) return '已结束'
  if (item.soldOut) return '已领完'
  if (item.stockRemaining !== null)
    return item.stockRemaining <= 5 ? `即将领完 · 剩余 ${item.stockRemaining} 份` : `可领取 · 剩余 ${item.stockRemaining} 份`
  return '可领取'
}

function parseRules(rulesText: string | null): string[] {
  if (!rulesText) return []
  return rulesText
    .split(/[；;。\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function BenefitActivityDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [item, setItem] = useState<BenefitActivityListItem | null>(null)
  const [state, setState] = useState<PageState>('loading')
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const [claiming, setClaiming] = useState(false)

  const load = useCallback(() => {
    if (!id) { setState('error'); return }
    setState('loading')
    getBenefitActivity(id, getToken())
      .then((res) => { setItem(res); setState('ready') })
      .catch(() => setState('error'))
  }, [getToken, id])

  useEffect(() => { load() }, [load])

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
      setMessage({ text: '领取成功，已加入我的权益', kind: 'success' })
      await getBenefitActivity(id, getToken()).then(setItem)
    } catch (error) {
      if (error instanceof BenefitActivitiesApiError && error.code === 'LOGIN_REQUIRED') {
        navigate('/login', { state: { from: `/activities/${id}` } })
      } else if (error instanceof BenefitActivitiesApiError && error.code === 'BENEFIT_ACTIVITY_ALREADY_CLAIMED') {
        setMessage({ text: '已领取，可在我的权益查看', kind: 'success' })
        await getBenefitActivity(id, getToken()).then(setItem).catch(() => undefined)
      } else {
        setMessage({ text: error instanceof Error ? error.message : '领取失败，请稍后重试', kind: 'error' })
      }
    } finally {
      setClaiming(false)
    }
  }

  const handlePrimary = () => {
    if (item?.claimed) navigate('/me/benefits')
    else void claim()
  }

  const primaryLabel = () => {
    if (item?.claimed) return '查看我的权益'
    if (claiming) return '领取中…'
    if (!isLoggedIn) return '登录后领取'
    return '立即领取'
  }

  const primaryDisabled = claiming || Boolean(isLoggedIn && item && !item.claimed && (item.soldOut || item.ended))

  return (
    <div className="fusion-w5 fusion-w5--profile k8-act-detail" data-kiosk-screen="activity-detail">
      <div className="k8-act-header">
        <PageHeader
          title="权益活动详情"
          subtitle="领取后会进入本人「我的权益」"
          actions={
            <button
              type="button"
              className="k8-act-back-btn"
              onClick={() => navigate('/activities')}
              aria-label="返回活动列表"
            >
              返回活动
            </button>
          }
        />
      </div>

      <div className="k8-act-scroll">
        {state === 'loading' ? (
          <LoadingState className="py-20" />
        ) : state === 'error' || !item ? (
          <ErrorState className="py-20" onRetry={load} />
        ) : (
          <>
            {/* Hero card */}
            <section className="k8-act-hero" aria-label="活动信息">
              <span className="k8-act-hero-ico" aria-hidden="true">
                {(() => { const Icon = TYPE_META[item.benefitType].icon; return <Icon /> })()}
              </span>
              <div className="k8-act-hero-main">
                <div className="k8-act-chips">
                  <span className="k8-act-chip">{SOURCE_LABEL[item.sourceType]}</span>
                  <span className="k8-act-chip">{TYPE_META[item.benefitType].label}</span>
                  <span className={['k8-act-stock', stockClass(item)].filter(Boolean).join(' ')}>
                    {stockText(item)}
                  </span>
                </div>
                <h2 className="k8-act-title">{item.title}</h2>
                {item.description && <p className="k8-act-desc">{item.description}</p>}
              </div>
            </section>

            {/* 权益内容格 */}
            <div className="k8-act-info-grid" aria-label="权益内容">
              <div className="k8-act-info-cell">
                <span>权益额度</span>
                <b>{quantityText(item)}</b>
              </div>
              <div className="k8-act-info-cell">
                <span>活动有效期</span>
                <b>{validity(item)}</b>
              </div>
            </div>

            {/* 活动规则 */}
            {item.rulesText && (
              <section className="k8-act-rules" aria-label="活动规则">
                <h3>活动规则</h3>
                {parseRules(item.rulesText).map((rule, i) => (
                  <p key={i} className="k8-act-rules-item">{rule}</p>
                ))}
              </section>
            )}

            {/* 使用步骤 */}
            <section className="k8-act-steps" aria-label="使用步骤">
              <div className="k8-act-step">
                <span className="k8-act-step-num" aria-hidden="true">1</span>
                <div className="k8-act-step-body">
                  <b>领取权益</b>
                  <span>登录后点「立即领取」，计入本人权益</span>
                </div>
              </div>
              <div className="k8-act-step">
                <span className="k8-act-step-num" aria-hidden="true">2</span>
                <div className="k8-act-step-body">
                  <b>使用服务</b>
                  <span>进入对应服务，优先抵扣免费额度</span>
                </div>
              </div>
              <div className="k8-act-step">
                <span className="k8-act-step-num" aria-hidden="true">3</span>
                <div className="k8-act-step-body">
                  <b>查看余量</b>
                  <span>在「我的 — 我的权益」查看剩余次数与有效期</span>
                </div>
              </div>
            </section>

            {/* 合规提示带 */}
            <div className="k8-act-compliance" role="note">
              {item.benefitType === 'subsidy_eligibility_hint'
                ? '本活动仅提供政策资格提示、材料说明和官方入口指引，具体申请、审核和结果以官方渠道为准。'
                : '权益仅用于本终端服务与打印辅助，不代表招聘会报名、签到、投递结果、面试或录用承诺。'}
            </div>

            {/* 反馈信息 */}
            {message && (
              <div className={['k8-act-message', message.kind === 'success' ? 'is-success' : 'is-error'].join(' ')} role="status">
                {message.text}
              </div>
            )}

            {/* CTA */}
            <div className="k8-act-cta">
              <button
                type="button"
                className="k8-act-btn primary"
                disabled={primaryDisabled}
                onClick={handlePrimary}
                aria-label={primaryLabel()}
              >
                {item.claimed
                  ? <><CheckCircleIcon />{!claiming && '查看我的权益'}</>
                  : <><SunIcon />{primaryLabel()}</>}
              </button>
              <button
                type="button"
                className="k8-act-btn ghost"
                onClick={() => navigate('/me/benefits')}
                aria-label="我的权益"
              >
                我的权益
              </button>
            </div>

            {/* 底部说明 */}
            <p className="k8-act-notice" role="note">
              <InfoIcon aria-hidden="true" />
              未登录时显示「登录后领取」；已领取后显示「查看我的权益」；已领完或已结束时不可领取。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
