// 权益活动详情 — 青序流光 2.0（稿 31 screen=activity）。
// 领取仍走 POST /activities/:id/claim：未登录进登录门，已领过按成功处理，其余错误走 userMessageOf。

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { BenefitActivityListItem } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { BenefitActivitiesApiError, claimBenefitActivity, getBenefitActivity } from '../../services/api/benefitActivities'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { QxMemberNavbar } from '../profile/components/QxMemberNavbar'
import { ActivityCtaStack, AskQing, HelpLine, ServiceAlts, StateBlock } from './ActivityChrome'
import {
  DETAIL_COMPLIANCE,
  FEE_LINE,
  PILL_DEFAULT,
  SOURCE_LABEL,
  SUBSIDY_COMPLIANCE,
  TYPE_LABEL,
  USE_LINE,
  activityPhase,
  parseRules,
  participation,
  quantityText,
  quotaTag,
  validity,
} from './activityModel'
import './activities-qx.css'

type PageState = 'loading' | 'ready' | 'error'
type DetailUi = 'loading' | 'error' | 'claim-pending' | 'claim-error' | 'claim-success' | 'ended' | 'sold-out' | 'signed-out' | 'detail'

function claimErrorText(error: unknown): string {
  const status = error instanceof BenefitActivitiesApiError ? error.status : undefined
  if (status === 0) {
    const mapped = userMessageOf(error, '网络连接失败，请检查网络后重试')
    return `${mapped} 这一页没有收到成功结果。没有在这里显示已领取。如果网络中断，请稍后打开「我的权益」核对。`
  }
  return userMessageOf(error, '这次没有领取成功。没有记入你的权益，也没有扣减名额。')
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
    if (!id || claiming) return
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
        setMessage({ text: claimErrorText(error), kind: 'error' })
      }
    } finally {
      setClaiming(false)
    }
  }

  const uiState: DetailUi = state === 'loading'
    ? 'loading'
    : state === 'error' || !item
      ? 'error'
      : claiming
        ? 'claim-pending'
        : message?.kind === 'success'
          ? 'claim-success'
          : item.ended
            ? 'ended'
            : item.soldOut
              ? 'sold-out'
              : message?.kind === 'error'
                ? 'claim-error'
                : !isLoggedIn
                  ? 'signed-out'
                  : 'detail'

  const primaryLabel = claiming
    ? '正在领取…'
    : message?.kind === 'success' || item?.claimed
      ? '查看我的权益'
      : item?.ended
        ? '已结束'
        : item?.soldOut
          ? '已领完'
          : message?.kind === 'error'
            ? '重试'
            : !isLoggedIn
              ? '登录后领取'
              : '领取这项权益'
  const primaryDisabled = claiming || Boolean(item && !item.claimed && (item.soldOut || item.ended))

  const handlePrimary = () => {
    if (primaryLabel === '查看我的权益') navigate('/me/benefits')
    else void claim()
  }

  const status = uiState === 'claim-success'
    ? { tone: 'ok' as const, label: '系统已确认本次领取' }
    : uiState === 'claim-error' || uiState === 'error'
      ? { tone: 'bad' as const, label: uiState === 'error' ? '活动详情这次没取到' : '本次领取未成功' }
      : uiState === 'ended'
        ? { tone: 'warn' as const, label: '活动已结束' }
        : uiState === 'sold-out'
          ? { tone: 'warn' as const, label: '名额已领完' }
          : uiState === 'signed-out'
            ? { tone: 'warn' as const, label: '领取需要先登录' }
            : uiState === 'claim-pending'
              ? { tone: 'unknown' as const, label: '已提交，等实际结果' }
              : uiState === 'loading'
                ? { tone: 'unknown' as const, label: '正在取活动详情' }
                : { tone: 'unknown' as const, label: PILL_DEFAULT }

  const subtitle = uiState === 'signed-out'
    ? '规则可以先看；领取要确认是你本人。'
    : uiState === 'claim-pending'
      ? '结果以实际记录为准，不先显示成功。'
      : uiState === 'claim-success'
        ? '以台账里的内容为准；抵扣功能尚未开放。'
        : uiState === 'claim-error'
          ? '失败原因以实际记录为准，不掩盖。'
          : uiState === 'ended'
            ? '不再提供领取入口。'
            : uiState === 'sold-out'
              ? '不排队、不预约、不承诺补发。'
              : uiState === 'loading'
                ? '未返回前不显示活动内容。'
                : uiState === 'error'
                  ? '取不到就不显示，不拿旧活动顶替。'
                  : '条件由系统和官方规则判定，小青只解释规则。'

  return (
    <div className="fusion-w5 h-full act-root" data-state={uiState} data-testid={`activity-state-${uiState}`}>
      <QxPageFrame
        title="活动详情"
        subtitle={subtitle}
        back={{ label: '返回活动列表', onBack: () => navigate('/activities') }}
        status={status}
        ctabar={(
          <ActivityCtaStack
            note={uiState === 'signed-out' ? '领取要确认是你本人，没登录没法验证身份；规则和条件不登录也能完整看。' : null}
          >
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/activities')}>返回活动列表</button>
            {uiState !== 'loading' && uiState !== 'error' ? (
              <button
                type="button"
                className="qx-btn"
                data-variant="primary"
                data-testid="activity-primary"
                disabled={primaryDisabled}
                onClick={handlePrimary}
                aria-label={primaryLabel}
              >
                {primaryLabel}
              </button>
            ) : null}
            {uiState === 'error' ? (
              <button type="button" className="qx-btn" data-variant="primary" data-testid="activity-primary" onClick={load}>重新加载</button>
            ) : null}
          </ActivityCtaStack>
        )}
        navbar={<QxMemberNavbar current="profile" />}
      >
        <section data-kiosk-domain="profile" data-kiosk-screen="activity-detail" className="k8-act-scroll">
          {state === 'loading' ? <DetailLoading /> : null}
          {state === 'error' || !item ? (
            state === 'loading' ? null : (
              <StateBlock tone="error" title="活动详情这次没取到" testId="activity-fallback">
                请求失败。本机<b>不拿旧的活动顶替</b>。<HelpLine />
              </StateBlock>
            )
          ) : (
            <>
              {uiState === 'claim-pending' ? (
                <StateBlock tone="info" title="正在提交领取请求" testId="activity-fallback">
                  请求已经发出，<b>结果以实际记录为准</b>。这中间不显示进度百分比，也不会先给你一张券再回头撤销。如果长时间没有结果，可以返回台账查看，重复提交不会重复发放。
                </StateBlock>
              ) : null}
              {uiState === 'claim-success' ? (
                <StateBlock tone="info" title="系统确认领取成功" testId="activity-fallback">
                  这条权益已经写进你的台账，具体名称和有效期以台账里的内容为准。<b>抵扣功能尚未开放</b>，开放后可在下单时选择使用。
                </StateBlock>
              ) : null}
              {uiState === 'claim-error' ? (
                <StateBlock tone="error" title="这次没有领取成功" testId="activity-fallback">
                  {message?.text} <HelpLine />
                </StateBlock>
              ) : null}
              {uiState === 'ended' ? (
                <StateBlock tone="warn" title="这个活动已经结束" testId="activity-fallback">
                  活动方标注的活动时间已经过去，所以<b>不再提供领取入口</b>。已经领到的权益不受影响，仍按它自己的有效期留在台账里。
                </StateBlock>
              ) : null}
              {uiState === 'sold-out' ? (
                <StateBlock tone="warn" title="这个活动的名额已经领完" testId="activity-fallback">
                  名额由活动方设定，现在<b>已无可领名额</b>。本机不排队、不预约、不承诺补发；如果活动方后续追加，活动会重新开放。
                </StateBlock>
              ) : null}
              <DetailCards item={item} />
              {message && (
                <p className={message.kind === 'success' ? 'act-message k8-act-message is-success' : 'act-message k8-act-message is-error'} role="status">
                  {message.text}
                </p>
              )}
              <ServiceAlts screen="activity" />
            </>
          )}
        </section>
      </QxPageFrame>
    </div>
  )
}

function DetailLoading() {
  return (
    <StateBlock tone="info" title="正在取活动详情" testId="activity-fallback">
      未返回前不显示活动名称、规则和名额。
    </StateBlock>
  )
}

function DetailCards({ item }: { item: BenefitActivityListItem }) {
  const phase = activityPhase(item)
  const tag = quotaTag(phase)
  const rules = parseRules(item.rulesText)
  const compliance = item.benefitType === 'subsidy_eligibility_hint' ? SUBSIDY_COMPLIANCE : DETAIL_COMPLIANCE
  return (
    <>
      <section className="act-card" aria-label="活动信息">
        <div className="act-title-row" data-stock-label={phase}>
          <h2>{item.title}</h2>
          {tag ? <span className="act-tag k8-act-stock" data-tone={phase === '已领取' ? 'teal' : 'wheat'} data-stock-label={phase}>{tag}</span> : null}
        </div>
        <div className="act-kv" style={{ marginTop: 16 }}>
          <div className="act-kv-row"><span className="act-kv-k">来源</span><span className="act-kv-v">{SOURCE_LABEL[item.sourceType]}</span></div>
          <div className="act-kv-row"><span className="act-kv-k">活动时间</span><span className="act-kv-v">{validity(item)}</span></div>
          <div className="act-kv-row"><span className="act-kv-k">参与方式</span><span className="act-kv-v">{participation(item)}</span></div>
          <div className="act-kv-row"><span className="act-kv-k">费用说明</span><span className="act-kv-v">{FEE_LINE}</span></div>
        </div>
      </section>

      <section className="act-card" aria-label="活动说明">
        <div className="act-blk-h">活动说明<span className="hint">说明由运营方发布</span></div>
        <div className="act-kv">
          <div className="act-kv-row"><span className="act-kv-k">活动内容</span><span className="act-kv-v">{item.description || '以活动说明为准'}</span></div>
          <div className="act-kv-row"><span className="act-kv-k">权益内容</span><span className="act-kv-v">{TYPE_LABEL[item.benefitType]} · {quantityText(item)}</span></div>
          <div className="act-kv-row"><span className="act-kv-k">权益额度</span><span className="act-kv-v">{quantityText(item)}</span></div>
          <div className="act-kv-row"><span className="act-kv-k">活动有效期</span><span className="act-kv-v">{validity(item)}</span></div>
          <div className="act-kv-row"><span className="act-kv-k">领取与使用</span><span className="act-kv-v">{USE_LINE}</span></div>
        </div>
        {/*
          抵扣功能尚未接通：Kiosk 打印报价不查权益、确认页不能选券。
          领到的只记入账户。闭环接通后再改第 2 步。
        */}
        <div className="act-steps" aria-label="使用步骤" style={{ marginTop: 16 }}>
          <div className="act-step"><span className="act-step-num">1</span><div><b>领取权益</b><span>登录后点「领取这项权益」，计入本人权益</span></div></div>
          <div className="act-step"><span className="act-step-num">2</span><div><b>等待抵扣开放</b><span>权益已记入账户；<b>抵扣功能尚未开放</b>，开放后可在下单时选择使用</span></div></div>
          <div className="act-step"><span className="act-step-num">3</span><div><b>查看余量</b><span>在「我的 — 我的权益」查看剩余次数与有效期</span></div></div>
        </div>
      </section>

      <section className="act-card" aria-label="活动规则">
        <div className="act-blk-h">参与条件<span className="hint">由系统和官方规则判定</span></div>
        <div className="act-rules">
          {rules.length > 0 ? rules.map((rule) => <span key={rule} className="act-rule"><i />{rule}</span>) : (
            <span className="act-rule"><i />以活动规则为准</span>
          )}
          <span className="act-rule" data-no="true"><i />是否符合，由系统逐条比对后返回；本机与小青都<b>不替你判定资格</b>。</span>
        </div>
      </section>

      <section className="act-card act-explain">
        <div className="act-blk-h">看不懂规则可以问 AI 顾问</div>
        <p className="act-state-p">小青只把<b>上面这些已经返回的规则</b>讲成人话，并告诉你该找谁处理。它不会改变你的资格、不会替你领取，也不会承诺任何补贴到账。这些规则不经过 AI，小青不在时也可以自己看。</p>
        <AskQing testId="activity-ask" />
      </section>

      <p className="act-note" role="note">{compliance}</p>
    </>
  )
}
