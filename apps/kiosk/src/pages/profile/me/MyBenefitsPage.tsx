// 我的权益 — /me/benefits（本人，只读）。
// 只展示 BenefitGrant 元数据；不接支付、不核销、不承诺补贴办理结果。

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BenefitStatus, BenefitType, MemberBenefitItem } from '@ai-job-print/shared'
import { FlagIcon, GiftIcon, PrinterIcon, SparklesIcon, BookOpenIcon } from 'lucide-react'
import { getMyBenefits } from '../../../services/api/memberFavorites'
import { useAuth } from '../../../auth/useAuth'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { getTerminalCode } from '../../../services/api/screensaver'
import { formatTime } from '../assets/format'
import { QxMemberNavbar } from '../components/QxMemberNavbar'
import './styles/benefits-qx.css'

const TYPE_META: Record<BenefitType, { label: string; tone: 'teal' | 'wheat' | 'plum' | 'slate' }> = {
  coupon: { label: '优惠券', tone: 'teal' },
  free_quota: { label: '免费次数', tone: 'wheat' },
  package_entitlement: { label: '套餐额度', tone: 'plum' },
  subsidy_eligibility_hint: { label: '政策资格提示', tone: 'slate' },
}

const STATUS_META: Record<BenefitStatus, { label: string; tone: 'teal' | 'warn' | 'bad' }> = {
  active: { label: '可用', tone: 'teal' },
  used_up: { label: '已用完', tone: 'warn' },
  expired: { label: '已过期', tone: 'warn' },
  revoked: { label: '已撤销', tone: 'bad' },
}

const SOURCE_LABEL: Record<MemberBenefitItem['sourceType'], string> = {
  platform: '平台',
  campus: '校园',
  gov: '政府',
  fair: '招聘会',
  partner: '合作机构',
}

function quantityLine(item: MemberBenefitItem): string {
  if (item.benefitType === 'subsidy_eligibility_hint') return '不适用 · 仅提供政策说明、材料清单与官方入口'
  if (item.quantityTotal === null || item.quantityRemaining === null) return '一次性权益；说明与状态都以服务端返回为准'
  return `总量 ${item.quantityTotal} · 剩余 ${item.quantityRemaining}；说明与状态都以服务端返回为准`
}

function validityLine(item: MemberBenefitItem): string {
  if (!item.validFrom && !item.validUntil) return '有效期以现场公示或活动规则为准'
  if (item.validFrom && item.validUntil) return `${formatTime(item.validFrom)} 至 ${formatTime(item.validUntil)}`
  if (item.validUntil) return `有效期至 ${formatTime(item.validUntil)}`
  return `自 ${formatTime(item.validFrom!)} 起有效`
}

type BenefitsUiState = 'signed-out' | 'loading' | 'error' | 'empty' | 'list'

export function MyBenefitsPage() {
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberBenefitItem[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setItems([])
      setLoadState('ready')
      return
    }
    setLoadState('loading')
    getMyBenefits(getToken(), { pageSize: 50 })
      .then((result) => {
        setItems(result.items)
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const uiState: BenefitsUiState = !isLoggedIn
    ? 'signed-out'
    : loadState === 'loading'
      ? 'loading'
      : loadState === 'error'
        ? 'error'
        : items.length === 0
          ? 'empty'
          : 'list'

  const status = uiState === 'error'
    ? { tone: 'bad' as const, label: '权益台账这次没取到' }
    : uiState === 'loading'
      ? { tone: 'unknown' as const, label: '正在取你的权益台账' }
      : { tone: 'unknown' as const, label: '权益与资格均由服务端判定' }

  return (
    <div
      className="fusion-w5 h-full"
      data-kiosk-screen="member-list"
      data-state={uiState}
      data-testid={`benefits-state-${uiState}`}
    >
      <QxPageFrame
        title="我的权益"
        subtitle="名称、有效期与可用状态都由服务端返回；是否收费以活动说明与现场核价为准。"
        status={status}
        terminalLabel={getTerminalCode() || '就业服务大厅'}
        ctabar={<BenefitsCta uiState={uiState} onRetry={() => setReloadKey((key) => key + 1)} />}
        navbar={<QxMemberNavbar current="profile" />}
      >
        <div className="qx-scroll qx-grow bf-page">
          <BenefitsTabs current="benefits" />
          {uiState === 'signed-out' ? (
            <div className="qx-state" data-tone="info" data-testid="benefits-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">权益台账需要先登录</div>
                <p className="qx-state-d">
                  权益绑定在<b>你本人的账号</b>上。公共终端不会凭匿名会话显示任何人的权益，也不会替你领取。
                </p>
              </span>
            </div>
          ) : null}
          {uiState === 'loading' ? (
            <>
              <div className="qx-sec-h"><span className="t">正在取你的权益台账</span><span className="hint">未返回前不显示条数</span></div>
              <div className="bf-skel-row"><div className="bf-skel-line" style={{ width: '44%' }} /></div>
              <div className="bf-skel-row"><div className="bf-skel-line" style={{ width: '50%' }} /></div>
              <p className="bf-legal">只显示整体等待，不画百分比，也不显示上一次的权益。</p>
            </>
          ) : null}
          {uiState === 'error' ? (
            <div className="qx-state" data-tone="error" data-testid="benefits-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">权益台账这次没取到</div>
                <p className="qx-state-d">
                  请求失败了。本机<b>不显示上一次缓存的权益</b>——万一它已经过期或被核销，你会白跑一趟。
                </p>
              </span>
            </div>
          ) : null}
          {uiState === 'empty' ? (
            <div className="qx-state" data-tone="info" data-testid="benefits-fallback">
              <span className="qx-state-ic" />
              <span>
                <div className="qx-state-t">还没有权益</div>
                <p className="qx-state-d">
                  没有就是没有。本机<b>不会造几张券让这一页看起来热闹</b>。可以去看看正在进行的活动，符合条件的可以领取。
                </p>
              </span>
            </div>
          ) : null}
          {uiState === 'list' ? (
            <>
              <div className="qx-sec-h">
                <span className="t">权益台账</span>
                <span className="hint">名称、额度与有效期都以服务端返回为准</span>
              </div>
              <ul className="bf-list" data-testid="benefits-list">
                {items.map((item) => {
                  const type = TYPE_META[item.benefitType]
                  const statusMeta = STATUS_META[item.status]
                  return (
                    <li key={item.id} className="bf-item" data-benefit-type={item.benefitType} data-benefit-status={item.status}>
                      <div className="bf-item-link">
                        <span className="bf-item-ic" data-tone={type.tone}><GiftIcon size={28} aria-hidden /></span>
                        <span className="bf-item-tx">
                          <span className="bf-item-t">
                            {type.label} · {item.title}
                            <span className="bf-tag" data-tone={statusMeta.tone}>{statusMeta.label}</span>
                          </span>
                          {item.description ? <span className="bf-item-sub">{item.description}</span> : null}
                          <span className="bf-item-sub">
                            <span>来源 {SOURCE_LABEL[item.sourceType]}</span>
                            <span>有效期 {validityLine(item)}</span>
                          </span>
                          <span className="bf-item-note">{quantityLine(item)}</span>
                        </span>
                        <span className="bf-item-go">只读</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <LedgerRules />
            </>
          ) : null}
          {uiState !== 'list' && uiState !== 'loading' ? <ServiceAlts /> : null}
          <p className="bf-legal">
            <b>权益只对应本机服务与打印，不等于政府补贴已经发放。</b>
            政策资格提示只提供信息指引，具体办理与结果以官方平台为准。本机不代办、不收取额外费用。
          </p>
        </div>
      </QxPageFrame>
    </div>
  )
}

function BenefitsTabs({ current }: { current: 'benefits' | 'activities' }) {
  const navigate = useNavigate()
  return (
    <div className="bf-tabs">
      <button
        type="button"
        className="bf-tab"
        data-testid="tab-benefits"
        aria-current={current === 'benefits' ? 'page' : undefined}
        onClick={() => navigate('/me/benefits')}
      >
        <GiftIcon size={24} aria-hidden />我的权益
      </button>
      <button
        type="button"
        className="bf-tab"
        data-testid="tab-activities"
        aria-current={current === 'activities' ? 'page' : undefined}
        onClick={() => navigate('/activities')}
      >
        <FlagIcon size={24} aria-hidden />可参加的活动
      </button>
    </div>
  )
}

function LedgerRules() {
  return (
    <section className="qx-card">
      <div className="qx-sec-h">
        <span className="t">资格、核销与收费由谁说了算</span>
        <span className="hint">与本机是否有权益无关</span>
      </div>
      <div className="bf-rules">
        <span className="bf-rule"><i /><span>是否符合条件：由服务端按主办方的官方规则逐条比对后返回，本机与小青都<b>不替你判定资格</b>。</span></span>
        <span className="bf-rule"><i /><span>能不能用、还能不能再用：以<b>核销时服务端返回的结果</b>为准，本页不预判。</span></span>
        <span className="bf-rule" data-no="true"><i /><span>是否收费、收多少：以活动说明与现场公示价为准；补贴类只给说明与官方入口，<b>本机不代办</b>。</span></span>
      </div>
    </section>
  )
}

function ServiceAlts() {
  const navigate = useNavigate()
  const rows = [
    { icon: PrinterIcon, title: '打印与扫描', desc: 'A4 黑白或彩色，价格以现场公示与服务端报价为准。', to: '/print-scan' },
    { icon: SparklesIcon, title: 'AI 简历服务', desc: '诊断、优化、生成与材料工坊，都不需要权益。', to: '/resume-service' },
    { icon: BookOpenIcon, title: '就业政策与补贴指引', desc: '政策原文与官方申请入口，本机不代办、不收代办费。', to: '/renshi' },
  ]
  return (
    <div className="bf-alt">
      <div className="bf-alt-h">没有权益也照常可用的服务</div>
      {rows.map((row) => (
        <button type="button" key={row.to} className="bf-alt-row" onClick={() => navigate(row.to)}>
          <span className="bf-alt-ic"><row.icon size={26} aria-hidden /></span>
          <span className="bf-alt-tx">
            <span className="bf-alt-t">{row.title}</span>
            <span className="bf-alt-d">{row.desc}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function BenefitsCta({ uiState, onRetry }: { uiState: BenefitsUiState; onRetry: () => void }) {
  const navigate = useNavigate()
  if (uiState === 'signed-out') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/activities')}>先看看有哪些活动</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="benefits-primary" onClick={() => navigate('/login', { state: { from: '/me/benefits' } })}>
          去登录
        </button>
      </>
    )
  }
  if (uiState === 'loading') {
    return (
      <button type="button" className="qx-btn" data-variant="ghost" data-testid="benefits-primary" onClick={() => navigate('/profile')}>
        返回我的
      </button>
    )
  }
  if (uiState === 'error') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>找工作人员</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="benefits-primary" onClick={onRetry}>
          重新加载
        </button>
      </>
    )
  }
  if (uiState === 'empty') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print-scan')}>直接去打印</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="benefits-primary" onClick={() => navigate('/activities')}>
          看可参加的活动
        </button>
      </>
    )
  }
  return (
    <>
      <p className="why">列表只读；能否使用以核销时服务端的最新状态为准。</p>
      <button type="button" className="qx-btn" data-variant="primary" data-testid="benefits-primary" onClick={() => navigate('/activities')}>
        看可参加的活动
      </button>
    </>
  )
}
