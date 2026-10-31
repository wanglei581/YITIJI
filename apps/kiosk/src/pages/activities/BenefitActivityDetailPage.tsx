// 权益活动详情页 — 原型 72（72-activity-detail.html）视觉对齐。
// 布局：Hero 大卡 + 权益格 + 活动规则 + 使用步骤 + 合规提示 + 双 CTA。

import { useCallback, useEffect, useState } from 'react'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useNavigate, useParams } from 'react-router-dom'
import { QxTouchChip } from '../../components/qingxu/touch/QxTouchChip'
import { MeTouchShell } from '../profile/touch/MeTouchShell'
import { MeBtn, MeHero, MeP, MeRules } from '../profile/touch/MeKit'
import { MeErrorPack, MeLoadingPack } from '../profile/touch/MeStatePacks'
import type { BenefitActivityListItem, BenefitActivitySourceType, BenefitActivityType } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { BenefitActivitiesApiError, claimBenefitActivity, getBenefitActivity } from '../../services/api/benefitActivities'
import { formatTime } from '../profile/assets/format'
import './activities-detail-inkpaper.css'

type PageState = 'loading' | 'ready' | 'error'

const TYPE_LABEL: Record<BenefitActivityType, string> = {
  coupon: '优惠券',
  free_quota: '免费次数',
  package_entitlement: '服务额度',
  ai_quota: 'AI 次数',
  subsidy_eligibility_hint: '政策资格提示',
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
        setMessage({ text: userMessageOf(error, '领取失败，请稍后重试'), kind: 'error' })
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
    <div className="fusion-w5 fusion-w5--profile k8-act-detail h-full">
    <MeTouchShell
      nav={false}
      eyebrow={item ? `权益活动 · ${SOURCE_LABEL[item.sourceType]} · ${TYPE_LABEL[item.benefitType]}` : '权益活动'}
      title={state === 'loading' ? '正在读取' : state === 'error' || !item ? '这次没读到' : item.title}
      sub={state === 'loading' ? '请稍等' : state === 'error' || !item ? '可以再试一次' : `${stockText(item)} · 领取后仍留在这一页`}
      backLabel="返回活动"
      onBack={() => navigate('/activities')}
      status={{ tone: state === 'error' ? 'warn' : item && (item.ended || item.soldOut) ? 'warn' : 'ok', label: state === 'loading' ? '正在读取' : item ? stockText(item) : '这次没读到' }}
      ask={{ label: '问小青：领了之后在哪里看？', draft: '领了之后在哪里看？' }}
      primaryNode={state === 'ready' && item ? (
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/benefits')}>
          我的权益
        </button>
      ) : undefined}
    >

      <section data-kiosk-domain="profile" data-kiosk-screen="activity-detail" className="k8-act-scroll">
        <div className="me-page">
        {state === 'loading' ? (
          <MeLoadingPack rows={6} />
        ) : state === 'error' || !item ? (
          <MeErrorPack onRetry={load} />
        ) : (
          <>
            <div className="me-split">
              <MeHero art="checklist" artWidth={150} title={<span className="k8-act-title">{item.title}</span>}>
                <div className="me-chips" aria-label="活动信息">
                  <QxTouchChip>{SOURCE_LABEL[item.sourceType]}</QxTouchChip>
                  <QxTouchChip tone="slate">{TYPE_LABEL[item.benefitType]}</QxTouchChip>
                  <QxTouchChip tone={item.ended || item.soldOut ? 'clay' : 'teal'}>{stockText(item)}</QxTouchChip>
                </div>
                {item.description ? <MeP>{item.description}</MeP> : null}
                <MeP>有效期：{validity(item)} · 额度：{quantityText(item)}</MeP>
              </MeHero>

              {item.rulesText ? <MeRules title="活动规则" rules={parseRules(item.rulesText)} /> : null}

              <MeHero art="stack" artWidth={130} title="领了之后">
                <MeP>余量在我的权益里看。</MeP>
                <MeP>领取不代表报名或投递，只在这台机器使用。</MeP>
                {/* 抵扣功能尚未接通（2026-08-11 修正，CLAUDE.md §9 不伪造能力）：Kiosk 全端没有引用 benefitGrantId，打印报价不查权益。 */}
                <MeP>抵扣功能尚未开放。</MeP>
              </MeHero>
            </div>

            <p className="me-fine" role="note">
              {item.benefitType === 'subsidy_eligibility_hint'
                ? '本活动仅提供政策资格提示、材料说明和官方入口指引，具体申请、审核和结果以官方渠道为准。'
                : '权益仅用于本终端服务与打印辅助，不代表招聘会报名、签到、投递结果、面试或录用承诺。'}
            </p>

            {message && (
              <p className={`me-p${message.kind === 'error' ? ' me-reason' : ''}`} role="status">{message.text}</p>
            )}

            <MeBtn
              v="pri"
              className="me-wide me-big"
              disabled={primaryDisabled}
              onClick={handlePrimary}
              aria-label={item.claimed ? '查看我的权益' : primaryLabel()}
            >
              {item.claimed ? (!claiming && '查看我的权益') : primaryLabel()}
            </MeBtn>
          </>
        )}
        </div>
      </section>
    </MeTouchShell>
    </div>
  )
}
