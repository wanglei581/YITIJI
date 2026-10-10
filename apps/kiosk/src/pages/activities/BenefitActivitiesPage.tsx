import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { BenefitActivityListItem } from '@ai-job-print/shared'
import { ChevronRightIcon, FlagIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { listBenefitActivities } from '../../services/api/benefitActivities'
import { QxMemberNavbar } from '../profile/components/QxMemberNavbar'
import { ActivityCtaStack, ActivityLead, ActivityTabs, AskQing, HelpLine, LedgerRules, ServiceAlts, StateBlock } from './ActivityChrome'
import {
  FAIR_NOTE,
  LIST_COMPLIANCE,
  PILL_DEFAULT,
  SOURCE_LABEL,
  activityPhase,
  countLine,
  quotaTag,
  rowMuted,
  validity,
} from './activityModel'
import './activities-qx.css'

type PageState = 'loading' | 'ready' | 'error'
type ListUi = 'loading' | 'error' | 'empty' | 'list'

function rowAction(item: BenefitActivityListItem, isLoggedIn: boolean): { label: string; disabled: boolean; to: string | null } {
  if (item.claimed) return { label: '查看我的权益', disabled: false, to: '/me/benefits' }
  if (isLoggedIn && item.soldOut) return { label: '已领完', disabled: true, to: null }
  if (isLoggedIn && item.ended) return { label: '已结束', disabled: true, to: null }
  return { label: '查看活动', disabled: false, to: `/activities/${item.id}` }
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

  const uiState: ListUi = state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 ? 'empty' : 'list'
  const status = uiState === 'error'
    ? { tone: 'bad' as const, label: '活动列表这次没取到' }
    : uiState === 'loading'
      ? { tone: 'unknown' as const, label: '正在取活动列表' }
      : uiState === 'empty'
        ? { tone: 'unknown' as const, label: '当前没有正在进行的活动' }
        : { tone: 'unknown' as const, label: PILL_DEFAULT }
  const subtitle = uiState === 'loading'
    ? '未返回前不显示条数。'
    : uiState === 'empty'
      ? '没有正在进行的活动时保持空态。'
      : uiState === 'error'
        ? '取不到就不显示，不拿旧活动顶替。'
        : '活动由活动方发布；参与条件与费用以活动说明为准。'

  return (
    <div
      className="fusion-w5 h-full act-root"
      data-kiosk-domain="profile"
      data-kiosk-screen="activities"
      data-state={uiState}
      data-testid={`activities-state-${uiState}`}
    >
      <QxPageFrame
        title="可参加的活动"
        subtitle={subtitle}
        back={{ label: '返回我的权益', onBack: () => navigate('/me/benefits') }}
        status={status}
        ctabar={<ListCta uiState={uiState} onRetry={() => setReloadKey((key) => key + 1)} />}
        navbar={<QxMemberNavbar current="profile" />}
      >
        <div className="act-scroll">
          <ActivityLead />
          <ActivityTabs />
          {source === 'fair' ? <p className="act-note">{FAIR_NOTE}</p> : null}
          {uiState === 'loading' ? <LoadingRows /> : null}
          {uiState === 'error' ? (
            <StateBlock tone="error" title="活动列表这次没取到" testId="activities-fallback">
              请求失败。本机<b>不拿旧的活动顶替</b>，避免你按已经结束的规则白跑一趟。<HelpLine />
            </StateBlock>
          ) : null}
          {uiState === 'empty' ? (
            <StateBlock
              tone="info"
              title="现在没有正在进行的活动"
              testId="activities-fallback"
              actions={(
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/official-channels')}>
                  看机构官方渠道
                </button>
              )}
            >
              活动由活动方发布，<b>没有就是没有</b>。有新的活动时，这一页会直接出现，不需要你反复刷新。
            </StateBlock>
          ) : null}
          {uiState === 'list' ? (
            <>
              <div className="act-sec-h">
                <span className="t">正在进行与即将开始</span>
                <span className="hint">{countLine(total, items.length)}</span>
              </div>
              <ul className="act-list" data-testid="activities-list">
                {items.map((item, index) => {
                  const phase = activityPhase(item)
                  const tag = quotaTag(phase)
                  const action = rowAction(item, isLoggedIn)
                  const tone = phase === '即将领完' || phase === '已领完' || phase === '已结束' ? 'wheat' : 'teal'
                  return (
                    <li
                      key={item.id}
                      className={rowMuted(item) ? 'act-item off' : 'act-item'}
                      data-tone={tone}
                      data-benefit-type={item.benefitType}
                      data-ended={item.ended || undefined}
                      data-stock-label={phase}
                    >
                      <button
                        type="button"
                        className="act-row"
                        data-testid={`activities-row-${index + 1}`}
                        disabled={action.disabled}
                        onClick={() => { if (action.to) navigate(action.to) }}
                      >
                        <span className="act-ic"><FlagIcon size={28} aria-hidden /></span>
                        <span className="act-tx">
                          <span className="act-t">
                            {item.title}
                            {tag ? <span className="act-tag" data-tone={tone}>{tag}</span> : null}
                          </span>
                          <span className="act-sub">
                            <span>来源 {SOURCE_LABEL[item.sourceType]}</span>
                            <span>活动时间 {validity(item)}</span>
                          </span>
                          <span className="act-item-note">参与条件与是否收费，以活动说明与现场核价为准</span>
                        </span>
                        <span className="act-go">{action.label}<ChevronRightIcon size={20} aria-hidden /></span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
          {uiState !== 'list' ? <LedgerRules /> : null}
          <p className="act-note">{LIST_COMPLIANCE}</p>
          <p className="act-note">活动发布后才会在这里展示；未发布、已结束或已下架活动不再可领。领取后进入本人「我的权益」。</p>
          {uiState === 'empty' || uiState === 'error' ? <ServiceAlts screen="activities" /> : null}
        </div>
      </QxPageFrame>
    </div>
  )
}

function LoadingRows() {
  return (
    <>
      <div className="act-sec-h">
        <span className="t">正在取活动列表</span>
        <span className="hint">未返回前不显示条数</span>
      </div>
      <ul className="act-list" aria-busy="true">
        {[1, 2, 3, 4, 5].map((index) => (
          <li key={index} className="act-item off" data-testid={`activities-loading-${index}`}>
            <div className="act-row">
              <span className="act-ic"><FlagIcon size={28} aria-hidden /></span>
              <span className="act-tx">
                <span className="act-t">活动名称<span className="act-tag">读取中</span></span>
                <span className="act-sub"><span>来源 读取中</span><span>活动时间 读取中</span></span>
                <span className="act-item-note">参与条件与是否收费，以活动说明与现场核价为准</span>
              </span>
              <span className="act-go" aria-disabled="true">读取中</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function ListCta({ uiState, onRetry }: { uiState: ListUi; onRetry: () => void }) {
  const navigate = useNavigate()
  const primary = uiState === 'error'
    ? <button type="button" className="qx-btn" data-variant="primary" data-testid="activities-primary" onClick={onRetry}>重新加载</button>
    : <button type="button" className="qx-btn" data-variant="primary" data-testid="activities-primary" onClick={() => navigate('/me/benefits')}>回我的权益</button>
  return (
    <ActivityCtaStack note={uiState === 'list' ? '活动是否收费、名额是否还有，以活动方说明和实际结果为准。' : null}>
      <AskQing testId="activities-ask" />
      {primary}
    </ActivityCtaStack>
  )
}
