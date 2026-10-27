import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { QxTouchChip } from '../../components/qingxu/touch/QxTouchChip'
import { MeTouchShell } from '../profile/touch/MeTouchShell'
import { MeBtn, MeRows } from '../profile/touch/MeKit'
import { MeEmptyPack, MeErrorPack, MeExitCard, MeLoadingPack } from '../profile/touch/MeStatePacks'
import type { BenefitActivityListItem, BenefitActivitySourceType, BenefitActivityType } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { listBenefitActivities } from '../../services/api/benefitActivities'
import { formatTime } from '../profile/assets/format'
import './activities-batch8.css'

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

function stockLabel(item: BenefitActivityListItem): string {
  if (item.ended) return '已结束'
  if (item.soldOut) return '已领完'
  if (item.claimed) return '已领取'
  if (item.stockRemaining !== null && item.stockRemaining <= 5) return '即将领完'
  return '可领取'
}

function ctaLabel(item: BenefitActivityListItem, isLoggedIn: boolean): string {
  if (item.ended) return '已结束'
  if (item.soldOut && !item.claimed) return '已领完'
  if (item.claimed) return '查看我的权益'
  if (!isLoggedIn) return '登录后领取'
  return '查看活动'
}

function quantityText(item: BenefitActivityListItem): string {
  if (item.benefitType === 'subsidy_eligibility_hint') return '仅提供政策资格和官方入口指引'
  if (item.quantityTotal === null) return '一次性权益'
  return `${item.quantityTotal} 次 / 份服务额度`
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
      status={{ tone: state === 'error' ? 'warn' : 'ok', label: state === 'error' ? '这次没读到' : (items.length === 0 && state === 'ready' ? '现在没有活动' : '可以先看再领') }}
      ask={{ label: '问小青：领取代表报名了吗？', draft: '领取代表报名了吗？' }}
    >
      <section data-kiosk-domain="profile" data-kiosk-screen="activities" className="me-page">
        <MeBtn v="sec" onClick={() => navigate('/me/benefits')}>我的权益</MeBtn>

        {state === 'loading' ? (
          <MeLoadingPack rows={6} />
        ) : state === 'error' ? (
          <MeErrorPack onRetry={() => setReloadKey((k) => k + 1)} />
        ) : items.length === 0 ? (
          <MeEmptyPack sentence="现在没有可参加的活动。">
            <MeExitCard art="phone" artWidth={150} tall title="去打印" desc="没有活动也能打印、扫描" onClick={() => navigate('/print-scan')} />
            <MeExitCard art="checklist" artWidth={140} tall title="查政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
          </MeEmptyPack>
        ) : (
          <MeRows few={items.length < 5} label="可参加的活动">
            {items.map((item) => {
              const off = item.ended || item.soldOut
              return (
                <div key={item.id} className="me-line me-act" data-benefit-type={item.benefitType} data-ended={item.ended || undefined}>
                  <div className="me-chips">
                    <QxTouchChip>{SOURCE_LABEL[item.sourceType]}</QxTouchChip>
                    <QxTouchChip tone="slate">{TYPE_LABEL[item.benefitType]}</QxTouchChip>
                    <QxTouchChip tone={off ? 'clay' : 'teal'}>{stockLabel(item)}</QxTouchChip>
                  </div>
                  <h2 className="me-act-title">{item.title}</h2>
                  {item.description ? <small>{item.description}</small> : null}
                  <small>{validity(item)} · {quantityText(item)}</small>
                  <MeBtn
                    v={item.claimed ? 'sec' : 'pri'}
                    className="k8-activity-action me-wide"
                    disabled={off && !item.claimed ? true : undefined}
                    onClick={() => {
                      if (item.claimed) navigate('/me/benefits')
                      else if (!isLoggedIn) navigate('/login', { state: { from: `/activities/${item.id}` } })
                      else navigate(`/activities/${item.id}`)
                    }}
                  >
                    {ctaLabel(item, isLoggedIn)}
                  </MeBtn>
                </div>
              )
            })}
          </MeRows>
        )}

        <p className="me-fine k8-activities-notice">
          领取不代表报名、签到或投递。权益活动只用于本终端服务与打印辅助；政策资格提示只给官方入口和材料指引；招聘会相关活动不生成报名、签到或投递凭证。没登录也可以先看。
        </p>
      </section>
    </MeTouchShell>
    </div>
  )
}
