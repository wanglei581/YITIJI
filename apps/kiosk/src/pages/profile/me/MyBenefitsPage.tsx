import { useMemberCursorPage } from './useMemberCursorPage'
import { MemberLoadMore } from './MemberLoadMore'
// 我的权益 — /me/benefits（本人，只读）。
// 只展示 BenefitGrant 元数据；不接支付、不核销、不承诺补贴办理结果。

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BenefitStatus, BenefitType, MemberBenefitItem } from '@ai-job-print/shared'
import { getMyBenefits } from '../../../services/api/memberFavorites'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeRows, MeSeg, MeStatic } from '../touch/MeKit'
import { MeEmptyPack, MeErrorPack, MeExitCard, MeLoadingPack, MeLoginGate } from '../touch/MeStatePacks'
import { MeTouchShell, type MeBandStatus } from '../touch/MeTouchShell'
import './styles/benefits-qx.css'

const TYPE_META: Record<BenefitType, { label: string }> = {
  coupon: { label: '优惠券' },
  free_quota: { label: '免费次数' },
  package_entitlement: { label: '套餐额度' },
  ai_quota: { label: 'AI 次数' },
  subsidy_eligibility_hint: { label: '政策资格提示' },
}

const STATUS_META: Record<BenefitStatus, { label: string }> = {
  active: { label: '可用' },
  used_up: { label: '已用完' },
  expired: { label: '已过期' },
  revoked: { label: '已撤销' },
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
  if (item.quantityTotal === null || item.quantityRemaining === null) return '一次性权益；说明与状态都以系统返回为准'
  return `总量 ${item.quantityTotal} · 剩余 ${item.quantityRemaining}；说明与状态都以系统返回为准`
}

function validityLine(item: MemberBenefitItem): string {
  if (!item.validFrom && !item.validUntil) return '有效期以现场公示或活动规则为准'
  if (item.validFrom && item.validUntil) return `${formatTime(item.validFrom)} 至 ${formatTime(item.validUntil)}`
  if (item.validUntil) return `有效期至 ${formatTime(item.validUntil)}`
  return `自 ${formatTime(item.validFrom!)} 起有效`
}

type BenefitsUiState = 'signed-out' | 'loading' | 'error' | 'empty' | 'list'

export function MyBenefitsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [reloadKey, setReloadKey] = useState(0)

  const token = getToken()
  const fetchPage = useCallback((cursor?: string) => getMyBenefits(token, { pageSize: 50, cursor }), [token])
  const pagination = useMemberCursorPage<MemberBenefitItem>({ enabled: isLoggedIn, identityKey: token, reloadKey, fetchPage })
  const { items, state: loadState } = pagination

  const uiState: BenefitsUiState = !isLoggedIn
    ? 'signed-out'
    : loadState === 'loading'
      ? 'loading'
      : loadState === 'error'
        ? 'error'
        : items.length === 0
          ? 'empty'
          : 'list'

  const status: MeBandStatus = uiState === 'error'
    ? { tone: 'warn', label: '这次没读到' }
    : uiState === 'loading'
      ? { tone: 'reading', label: '正在读取' }
      : uiState === 'signed-out'
        ? { tone: 'unknown', label: '未登录' }
        : { tone: uiState === 'empty' ? 'unknown' : 'ok', label: uiState === 'empty' ? '还没有权益' : '已登录' }
  const bandTitle = uiState === 'list' ? `你有 ${items.length} 项权益` : uiState === 'empty' ? '还没有权益' : uiState === 'error' ? '这次没读到' : uiState === 'loading' ? '正在读取' : '登录后看你的权益'
  const bandSub = uiState === 'error' ? '可以再试一次' : uiState === 'loading' ? '请稍等' : uiState === 'signed-out' ? '只有你本人能看到' : '能不能用由系统判定'

  return (
    <div
      className="fusion-w5 h-full"
      data-kiosk-screen="member-list"
      data-state={uiState}
      data-testid={`benefits-state-${uiState}`}
    >
      <MeTouchShell
        eyebrow="我的 · 权益"
        title={bandTitle}
        sub={bandSub}
        backLabel="返回我的"
        onBack={() => navigate('/profile')}
        status={status}
        ask={{ label: '问小青：权益现在能抵扣吗？', draft: '权益现在能抵扣吗？' }}
        primaryNode={<BenefitsCta uiState={uiState} onRetry={() => setReloadKey((key) => key + 1)} />}
      >
        <div className="qx-scroll qx-grow bf-page me-page">
          <BenefitsTabs current="benefits" />
          {uiState === 'signed-out' ? <MeLoginGate page="my-benefits" /> : null}
          {uiState === 'loading' ? <MeLoadingPack rows={6} /> : null}
          {uiState === 'error' ? (
            <div data-testid="benefits-fallback" className="me-state">
              <MeErrorPack sentence="权益台账这次没取到。本机不显示上一次缓存的权益：万一它已经过期或被核销，你会白跑一趟。" onRetry={() => setReloadKey((key) => key + 1)} />
            </div>
          ) : null}
          {uiState === 'empty' ? (
            <div data-testid="benefits-fallback" className="me-state">
              <MeEmptyPack sentence="还没有权益。没有权益也照常能打印、做简历、查政策。">
                <MeExitCard art="usb" artWidth={110} title="打印与扫描" desc="没有权益也能办" onClick={() => navigate('/print-scan')} />
                <MeExitCard art="resume" artWidth={110} title="AI 简历服务" desc="没有权益也能办" onClick={() => navigate('/resume-service')} />
                <MeExitCard art="checklist" artWidth={100} title="就业政策与补贴指引" desc="说明不等于补贴已发放" onClick={() => navigate('/policy-service')} />
              </MeEmptyPack>
            </div>
          ) : null}
          {uiState === 'list' ? (
            <>
              <MeRows few={items.length < 5} testId="benefits-list" label="权益台账">
                {items.map((item) => {
                  const type = TYPE_META[item.benefitType]
                  const statusMeta = STATUS_META[item.status]
                  return (
                    <MeStatic
                      key={item.id}
                      data-benefit-type={item.benefitType}
                      data-benefit-status={item.status}
                      title={item.title}
                      lines={[
                        `${type.label} · 来源 ${SOURCE_LABEL[item.sourceType]} · ${statusMeta.label}`,
                        item.description ?? quantityLine(item),
                        `有效期 ${validityLine(item)}${item.description ? ` · ${quantityLine(item)}` : ''}`,
                      ]}
                    />
                  )
                })}
              </MeRows>
              {items.length < 5 ? (
                <div className="me-stack">
                  <MeExitCard art="usb" artWidth={110} title="打印与扫描" desc="没有权益也能办" onClick={() => navigate('/print-scan')} />
                  <MeExitCard art="resume" artWidth={110} title="AI 简历服务" desc="没有权益也能办" onClick={() => navigate('/resume-service')} />
                  <MeExitCard art="checklist" artWidth={100} title="就业政策与补贴指引" desc="说明不等于补贴已发放" onClick={() => navigate('/renshi')} />
                </div>
              ) : (
                <div className="me-block">
                  <ServiceAlt title="打印与扫描" desc="没有权益也能办" to="/print-scan" />
                  <ServiceAlt title="AI 简历服务" desc="没有权益也能办" to="/resume-service" />
                  <ServiceAlt title="就业政策与补贴指引" desc="说明不等于补贴已发放" to="/renshi" />
                </div>
              )}
            </>
          ) : null}
          {uiState === 'list' || uiState === 'empty' ? (
            <p className="me-fine">
              权益只对应本机服务与打印，不等于政府补贴已经发放。政策资格提示只提供信息指引，具体办理与结果以官方平台为准。能不能用由系统判定，这里不能领取。离开 3 分钟没操作会自动退出。
            </p>
          ) : null}
          {isLoggedIn && loadState === 'ready' ? <MemberLoadMore {...pagination} /> : null}
        </div>
      </MeTouchShell>
    </div>
  )
}

function BenefitsTabs({ current }: { current: 'benefits' | 'activities' }) {
  const navigate = useNavigate()
  return (
    <MeSeg
      label="权益与活动"
      current={current}
      items={[
        { id: 'benefits', label: '我的权益', testId: 'tab-benefits' },
        { id: 'activities', label: '可参加的活动', testId: 'tab-activities' },
      ]}
      onPick={(id) => navigate(id === 'benefits' ? '/me/benefits' : '/activities')}
    />
  )
}

function ServiceAlt({ title, desc, to }: { title: string; desc: string; to: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="me-line" onClick={() => navigate(to)}>
      <b>{title}</b>
      <small>{desc}</small>
    </button>
  )
}

function BenefitsCta({ uiState, onRetry }: { uiState: BenefitsUiState; onRetry: () => void }) {
  const navigate = useNavigate()
  if (uiState === 'signed-out') {
    return (
      <button type="button" className="qx-btn" data-variant="primary" data-testid="benefits-primary" onClick={() => navigate('/login', { state: { from: '/me/benefits' } })}>
        去登录
      </button>
    )
  }
  if (uiState === 'loading') return null
  if (uiState === 'error') {
    return (
      <button type="button" className="qx-btn" data-variant="primary" data-testid="benefits-primary" onClick={onRetry}>
        重新加载
      </button>
    )
  }
  return (
    <button type="button" className="qx-btn" data-variant="primary" data-testid="benefits-primary" onClick={() => navigate('/activities')}>
      看看活动
    </button>
  )
}
