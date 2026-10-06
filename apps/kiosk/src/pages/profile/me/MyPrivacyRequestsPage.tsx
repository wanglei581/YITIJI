// 隐私与数据请求 — /me/privacy-requests
// 一体机只提交「撤回 AI 使用授权」。导出和注销是说明，不能在这台机器上提交。
// 资料清单只用共享的导出清单常量。范围横幅原文不上屏：里面有代办和注销未开放，和这台机器的口径冲突。

import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MEMBER_DATA_EXPORT_INVENTORY,
  MEMBER_DATA_REQUEST_STATUS_LABEL,
  MEMBER_DATA_REQUEST_TYPE_HINT,
  MEMBER_DATA_REQUEST_TYPE_LABEL,
  formatDateTime,
  type MemberDataRequestItem,
  type MemberDataRequestStatus,
} from '@ai-job-print/shared'
import {
  CheckIcon,
  ClockIcon,
  FileDownIcon,
  LockIcon,
  ShieldOffIcon,
  Trash2Icon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  containsStaffHandoff,
  helpNeededLine,
  servicePhoneLine,
  whenMiniapp,
  type PublicSupportContact,
} from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { QxAiHelp } from '../../../components/qingxu/QxAiHelp'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { useAuth } from '../../../auth/useAuth'
import { createMyDataRequest, listMyDataRequests } from '../../../services/api/memberPrivacy'
import { getTerminalCode } from '../../../services/api/screensaver'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { QxMemberNavbar } from '../components/QxMemberNavbar'
import './styles/privacy-qx.css'

const REVOKE_ASK_LABEL = '✧ 问小青：撤回会怎样'
const REVOKE_ASK_DRAFT = '撤回 AI 使用授权以后，我的简历和记录会怎样？'
const SUCCESS_TEXT = '已撤回 AI 使用授权，请求已记录'
const FAILURE_FALLBACK = '提交失败，请稍后重试'
const KEPT_ASSETS = '撤回不会删除简历、文档、打印订单或收藏；也不等于账号注销。'
const BOUNDARY_NOTE = '结束这次办理，只清除本机登录和这一次的临时信息；已经提交的订单、文件和记录按各自保存期限管理。导出和注销这台机器都不办理，撤回授权也不会删除简历、文档、打印订单或收藏。'
const EXPORT_INVENTORY_NOTE = `导出的是本人资料清单（${MEMBER_DATA_EXPORT_INVENTORY}），不含文件原文与简历正文全文。`

type PrivacyUiState =
  | 'login'
  | 'loading'
  | 'error'
  | 'empty'
  | 'history-ready'
  | 'revoke-confirm'
  | 'submitting'
  | 'success'
  | 'failure'

type CapMode = 'open' | 'locked' | 'dialog' | 'revoked' | 'failed' | 'loading' | 'error'

const TAKE = [
  ['带走', '撤回后，下次使用会再问你'],
  ['不删除', '简历、文档和订单都还在'],
  ['只给你', '请求记录只有本人能看'],
  ['导出', '这台机器不提供下载'],
  ['注销', '这台机器上不办理'],
  ['问小青', '撤回会怎样，可以问清楚'],
] as const

function exportLine(contact: PublicSupportContact): string {
  const phone = servicePhoneLine(contact)
  const lead = whenMiniapp(contact, '可以在手机上的职易达小程序里申请导出，也可以') || '可以'
  return `公共屏上不导出个人资料。需要复制个人信息的，${lead}${phone}申请，我们核实是你本人后处理。${EXPORT_INVENTORY_NOTE}`
}

function closureLine(contact: PublicSupportContact): string {
  const phone = servicePhoneLine(contact)
  const lead = whenMiniapp(contact, '可以在手机上的职易达小程序「我的 → 账号设置」里，短信验证本人后提交申请；也可以') || '可以'
  return `这台机器上不办理注销。${lead}${phone}申请。我们核实是你本人后，15 个工作日内处理。`
}

function safeMessage(error: unknown, fallback: string): string {
  const detail = userMessageOf(error, fallback)
  if (containsStaffHandoff(detail)) return fallback
  return detail
}

function statusTone(status: MemberDataRequestStatus): 'ok' | 'wait' | 'run' | 'bad' {
  if (status === 'completed') return 'ok'
  if (status === 'failed' || status === 'rejected') return 'bad'
  if (status === 'handling' || status === 'ready') return 'run'
  return 'wait'
}

function capModeOf(uiState: PrivacyUiState): CapMode {
  if (uiState === 'login') return 'locked'
  if (uiState === 'loading') return 'loading'
  if (uiState === 'error') return 'error'
  if (uiState === 'success') return 'revoked'
  if (uiState === 'failure') return 'failed'
  if (uiState === 'revoke-confirm' || uiState === 'submitting') return 'dialog'
  return 'open'
}

export function MyPrivacyRequestsPage() {
  const navigate = useNavigate()
  const contact = useSupportContact()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberDataRequestItem[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadMessage, setLoadMessage] = useState<string | null>(null)
  const [failMessage, setFailMessage] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'success' | 'failure' | null>(null)

  const load = async () => {
    const token = getToken()
    if (!token) {
      setLoadState('ready')
      setItems([])
      return
    }
    setLoadState('loading')
    setLoadMessage(null)
    try {
      setItems(await listMyDataRequests(token))
      setLoadState('ready')
    } catch (error) {
      setLoadState('error')
      setLoadMessage(safeMessage(error, '加载失败，请稍后重试'))
    }
  }

  useEffect(() => {
    if (!isLoggedIn) {
      setLoadState('ready')
      setItems([])
      setOutcome(null)
      setConfirmRevoke(false)
      return
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 登录态变化时拉列表
  }, [isLoggedIn, getToken])

  const submitRevoke = async () => {
    const token = getToken()
    if (!token || busy) return
    setBusy(true)
    try {
      const created = await createMyDataRequest(token, 'revoke_consent')
      setItems((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
      setConfirmRevoke(false)
      setFailMessage(null)
      setOutcome('success')
    } catch (error) {
      setConfirmRevoke(false)
      setFailMessage(safeMessage(error, FAILURE_FALLBACK))
      setOutcome('failure')
    } finally {
      setBusy(false)
    }
  }

  const uiState: PrivacyUiState = !isLoggedIn
    ? 'login'
    : loadState === 'loading'
      ? 'loading'
      : loadState === 'error'
        ? 'error'
        : busy
          ? 'submitting'
          : confirmRevoke
            ? 'revoke-confirm'
            : outcome === 'success'
              ? 'success'
              : outcome === 'failure'
                ? 'failure'
                : items.length === 0
                  ? 'empty'
                  : 'history-ready'

  const layout = uiState === 'success' || uiState === 'failure'
    ? 'result'
    : uiState === 'history-ready' || uiState === 'revoke-confirm' || uiState === 'submitting'
      ? 'list'
      : 'state'
  const locked = uiState === 'submitting' || uiState === 'revoke-confirm'

  return (
    <div
      className="fusion-w5 fusion-w5--profile pr-root h-full"
      data-kiosk-screen="member-privacy-requests"
      data-state={uiState}
      data-testid={`member-privacy-state-${uiState}`}
    >
      <QxPageFrame
        title="隐私与数据请求"
        back={{ label: '返回账号设置', onBack: () => navigate('/me/settings') }}
        status={{ tone: uiState === 'error' || uiState === 'failure' ? 'bad' : 'unknown', label: '隐私与数据请求' }}
        terminalLabel={getTerminalCode() || '就业服务大厅'}
        ctabar={(
          <PrivacyCta
            uiState={uiState}
            locked={locked}
            onSettings={() => navigate('/me/settings')}
            onLogin={() => navigate('/login', { state: { from: '/me/privacy-requests' } })}
            onRetryLoad={() => void load()}
            onRevoke={() => setConfirmRevoke(true)}
            onRetrySubmit={() => void submitRevoke()}
            onShowList={() => setOutcome(null)}
          />
        )}
        navbar={<QxMemberNavbar current="profile" />}
      >
        <div className="qx-me-page pr-page" data-layout={layout}>
          <section className="qx-me-xq" aria-label="隐私与数据">
            <div className="qx-me-xq-row">
              <div className="qx-me-xq-face" aria-hidden="true">青</div>
              <div>
                <div className="qx-me-xq-eyebrow">隐私与数据</div>
                <p className="qx-me-xq-ask">授权由你决定，<em>随时可以撤回</em>。</p>
                <p className="qx-me-xq-doing">一体机本页只开放<b>撤回 AI 使用授权</b>；撤回不会删除简历、文档、打印订单或收藏。</p>
              </div>
            </div>
            <ol className="pr-take">
              {TAKE.map(([label, text]) => (
                <li key={label}><b>{label}</b>{text}</li>
              ))}
            </ol>
          </section>

          <div className="pr-stack">
            {uiState === 'login' ? (
              <StateBanner
                tone="lock"
                icon={LockIcon}
                title="登录后查看与提交隐私请求"
                desc={<>公共一体机不会在未登录时展示任何授权状态或请求记录。<b>下面是这一页的真实能力范围。</b></>}
                minis={['记录 —', '登录后回填']}
              />
            ) : null}
            {uiState === 'loading' ? (
              <StateBanner
                tone="calm"
                icon={ClockIcon}
                title="正在加载请求记录"
                desc={<>正在读取当前账号的隐私请求记录。<b>读取完成前不显示内容</b>，不会闪回上一位用户的记录。</>}
                minis={['记录 —', '正在读取']}
              />
            ) : null}
            {uiState === 'error' ? (
              <StateBanner
                tone="warn"
                icon={TriangleAlertIcon}
                title="请求记录这次没有加载出来"
                desc={<>当前记录没有更新。<b>本次加载失败不会撤回或恢复任何授权</b>。{loadMessage ? `${loadMessage}。` : null}{helpNeededLine(contact)}</>}
                minis={['记录 —', '这次没取到']}
              />
            ) : null}
            {uiState === 'empty' ? (
              <StateBanner
                tone="calm"
                icon={ShieldOffIcon}
                title="还没有请求记录"
                desc={<>提交撤回授权后，记录会出现在这里。<b>空就是空</b>，本页不会造记录让页面好看。</>}
                minis={['记录 0', '本人可见']}
              />
            ) : null}
            {uiState === 'success' ? (
              <section className="pr-result" data-tone="ok" data-testid="member-privacy-result">
                <span className="pr-result-ico" data-tone="calm" aria-hidden="true"><CheckIcon size={34} /></span>
                <span>
                  <b>{SUCCESS_TEXT}</b>
                  <span>撤回不会删除简历、文档、打印订单或收藏。再次使用时需要重新确认授权。</span>
                </span>
              </section>
            ) : null}
            {uiState === 'failure' ? (
              <section className="pr-result" data-tone="bad" data-testid="member-privacy-result">
                <span className="pr-result-ico" data-tone="warn" aria-hidden="true"><TriangleAlertIcon size={34} /></span>
                <span>
                  <b>这次没有撤回</b>
                  <span>授权没有变化。{failMessage ?? FAILURE_FALLBACK}。可以点「重试」再提交一次。</span>
                </span>
              </section>
            ) : null}

            <CapabilityRows contact={contact} mode={capModeOf(uiState)} onRevoke={() => setConfirmRevoke(true)} />

            {uiState === 'login' || uiState === 'loading' || uiState === 'error' ? <p className="pr-note">{stateNote(uiState, contact)}</p> : null}
            {layout !== 'state' ? <RequestList items={items} /> : null}
            {layout !== 'list' ? <Guide state={uiState} contact={contact} /> : null}
          </div>
        </div>
      </QxPageFrame>

      {confirmRevoke ? (
        <div className="pr-overlay" data-testid="member-privacy-dialog" onClick={() => !busy && setConfirmRevoke(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-revoke-title"
            className="pr-dlg"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="privacy-revoke-title">{busy ? '提交中…' : '确认撤回 AI 使用授权'}</h2>
            <p>{MEMBER_DATA_REQUEST_TYPE_HINT.revoke_consent}</p>
            <p>{KEPT_ASSETS}</p>
            <p>点「确认撤回」后会提交一次请求并等待返回：<b>成功即完成撤回</b>，失败会提示稍后重试；本页不会提前显示成功。</p>
            <div className="pr-dlg-acts">
              <button type="button" className="qx-btn" data-variant="ghost" disabled={busy} onClick={() => setConfirmRevoke(false)}>取消</button>
              <button type="button" className="qx-btn" data-variant="danger" disabled={busy} onClick={() => void submitRevoke()}>
                {busy ? '提交中…' : '确认撤回'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function stateNote(uiState: 'login' | 'loading' | 'error', contact: PublicSupportContact): string {
  if (uiState === 'login') {
    return '登录只用来确认「是你本人」。结束这次办理只清除本机登录状态和这一次的临时信息；订单、文件与记录按各自留存期限管理，不会因此删除。'
  }
  if (uiState === 'loading') return '返回前不展示上一位用户的记录。这次读取不会撤回或恢复任何授权。'
  return `重试不会重复提交请求。${helpNeededLine(contact)}`
}

function StateBanner({
  tone,
  icon: Icon,
  title,
  desc,
  minis,
}: {
  tone: 'lock' | 'warn' | 'calm'
  icon: LucideIcon
  title: string
  desc: ReactNode
  minis: string[]
}) {
  return (
    <section className="pr-banner" data-testid="member-privacy-fallback" data-kind={tone}>
      <span className="pr-banner-ico" data-tone={tone} aria-hidden="true"><Icon size={34} /></span>
      <span className="pr-banner-main">
        <b className="pr-banner-t">{title}</b>
        <span className="pr-banner-p">{desc}</span>
      </span>
      <span className="pr-banner-mini">{minis.map((item) => <i key={item}>{item}</i>)}</span>
    </section>
  )
}

function CapabilityRows({
  contact,
  mode,
  onRevoke,
}: {
  contact: PublicSupportContact
  mode: CapMode
  onRevoke: () => void
}) {
  const revokeTail = mode === 'dialog'
    ? <span className="pr-flag" data-testid="member-privacy-revoke-entry">等你确认</span>
    : mode === 'revoked'
      ? <span className="pr-flag" data-testid="member-privacy-revoke-entry">已撤回 · 下次使用时重新确认</span>
      : mode === 'failed'
        ? <span className="pr-flag" data-testid="member-privacy-revoke-entry">授权没有变化</span>
        : mode === 'open'
          ? (
            <button type="button" className="qx-btn" data-variant="primary" data-testid="member-privacy-revoke-entry" onClick={onRevoke}>
              撤回授权
            </button>
          )
          : <span className="pr-flag">{mode === 'locked' ? '登录后可用' : mode === 'loading' ? '正在读取' : '这次没取到'}</span>
  const live = mode === 'open' || mode === 'dialog' || mode === 'failed'

  return (
    <section className="pr-caps" data-testid="member-privacy-capabilities" aria-label="本页可以提交的请求和一体机上不办理的说明">
      <div className="pr-cap" data-off={live ? undefined : 'true'} data-capability="revoke_consent">
        <span className="pr-ico" data-tone={live ? 'plum' : 'off'} aria-hidden="true"><ShieldOffIcon size={28} /></span>
        <span className="pr-cap-main">
          <span className="pr-cap-t">{MEMBER_DATA_REQUEST_TYPE_LABEL.revoke_consent}</span>
          <span className="pr-cap-p">{MEMBER_DATA_REQUEST_TYPE_HINT.revoke_consent}</span>
        </span>
        {revokeTail}
      </div>
      <div className="pr-cap" data-off="true" data-capability="export">
        <span className="pr-ico" data-tone="off" aria-hidden="true"><FileDownIcon size={28} /></span>
        <span className="pr-cap-main">
          <span className="pr-cap-t">{MEMBER_DATA_REQUEST_TYPE_LABEL.export}</span>
          <span className="pr-cap-p" data-testid="member-privacy-export-line">{exportLine(contact)}</span>
        </span>
        <span className="pr-flag">一体机不提供</span>
      </div>
      <div className="pr-cap" data-off="true" data-capability="delete">
        <span className="pr-ico" data-tone="off" aria-hidden="true"><Trash2Icon size={28} /></span>
        <span className="pr-cap-main">
          <span className="pr-cap-t">账号注销</span>
          <span className="pr-cap-p" data-testid="member-privacy-closure-line">{closureLine(contact)}</span>
        </span>
        <span className="pr-flag">一体机不办理</span>
      </div>
    </section>
  )
}

function requestMark(type: MemberDataRequestItem['requestType']): LucideIcon {
  if (type === 'export') return FileDownIcon
  if (type === 'delete') return Trash2Icon
  return ShieldOffIcon
}

function RequestList({ items }: { items: MemberDataRequestItem[] }) {
  return (
    <section className="pr-list" aria-label="我的请求记录" data-testid="member-privacy-list">
      {items.length === 0 ? (
        <p className="pr-note">还没有提交过隐私数据请求。提交撤回授权后，记录会出现在这里。空就是空，本页不会造记录让页面好看。</p>
      ) : (
        <>
          <p className="pr-note">每条记录的提交时间与处理状态都以实际记录为准。</p>
          {items.map((item) => {
            const Icon = requestMark(item.requestType)
            return (
              <div key={item.id} className="pr-row" data-request-type={item.requestType} data-request-status={item.status}>
                <span className="pr-ico" data-tone="plum" aria-hidden="true"><Icon size={28} /></span>
                <span className="pr-cap-main">
                  <span className="pr-cap-t">{MEMBER_DATA_REQUEST_TYPE_LABEL[item.requestType]}</span>
                  <span className="pr-cap-p">{formatDateTime(item.requestedAt)}</span>
                </span>
                <span className="pr-st" data-tone={statusTone(item.status)}>{MEMBER_DATA_REQUEST_STATUS_LABEL[item.status]}</span>
              </div>
            )
          })}
          <p className="pr-foot">请求记录只显示本人提交的隐私数据请求；撤回授权不会删除简历、文档、打印订单或收藏。</p>
        </>
      )}
    </section>
  )
}

function guideRows(state: PrivacyUiState, contact: PublicSupportContact): Array<[string, string, string]> {
  if (state === 'loading') {
    return [
      ['读取范围', '只读当前账号', '不会展示其他账号的请求记录'],
      ['显示规则', '不闪回旧记录', '上一位用户的内容不会残留在屏幕上'],
      ['失败怎么办', '可以重试', '读取失败不会改动授权状态'],
    ]
  }
  if (state === 'error') {
    return [
      ['授权状态', '未被改动', '这次加载失败不会撤回或恢复任何授权'],
      ['先试这个', '重新加载', '重试不会重复提交请求'],
      ['仍不行', '按本页的联系方式', helpNeededLine(contact)],
    ]
  }
  if (state === 'login') {
    return [
      ['隐私', '只对本人可见', '请求记录与账号绑定，退出后本机不留明细'],
      ['可做什么', '撤回 AI 使用授权', '撤回后再次使用时需重新确认'],
      ['不会发生', '不删除已有资产', '简历、文档、打印订单与收藏都不受影响'],
    ]
  }
  return [
    ['撤回范围', '只影响 AI 使用授权', '不影响简历诊断、打印、收藏或已保存文件'],
    ['再次使用', '需要重新确认', '下次使用时会再次请求授权'],
    ['记录', '只留处理记录', '不会因此删除任何已有资产'],
  ]
}

function Guide({ state, contact }: { state: PrivacyUiState; contact: PublicSupportContact }) {
  return (
    <section className="pr-guide" aria-label="说明">
      {guideRows(state, contact).map(([k, title, text]) => (
        <div key={k} className="pr-guide-item">
          <div className="pr-guide-k">{k}</div>
          <div className="pr-guide-t">{title}</div>
          <p className="pr-guide-p">{text}</p>
        </div>
      ))}
    </section>
  )
}

function PrivacyCta({
  uiState,
  locked,
  onSettings,
  onLogin,
  onRetryLoad,
  onRevoke,
  onRetrySubmit,
  onShowList,
}: {
  uiState: PrivacyUiState
  locked: boolean
  onSettings: () => void
  onLogin: () => void
  onRetryLoad: () => void
  onRevoke: () => void
  onRetrySubmit: () => void
  onShowList: () => void
}) {
  const primary = uiState === 'login'
    ? { label: '手机号登录', disabled: false, onClick: onLogin }
    : uiState === 'loading'
      ? { label: '记录还未加载完成', disabled: true, onClick: onRevoke }
      : uiState === 'error'
        ? { label: '重新加载', disabled: false, onClick: onRetryLoad }
        : uiState === 'failure'
          ? { label: '重试', disabled: false, onClick: onRetrySubmit }
          : uiState === 'success'
            ? { label: '查看请求记录', disabled: false, onClick: onShowList }
            : { label: '撤回 AI 使用授权', disabled: locked, onClick: onRevoke }

  return (
    <div className="pr-cta">
      <div className="pr-cta-row">
        <button type="button" className="qx-btn" data-variant="ghost" disabled={locked} onClick={onSettings}>‹ 返回账号设置</button>
        {locked ? (
          <button type="button" className="qx-ai-help" disabled>{REVOKE_ASK_LABEL}</button>
        ) : (
          <QxAiHelp label={REVOKE_ASK_LABEL} draft={REVOKE_ASK_DRAFT} testId="member-privacy-ask" />
        )}
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          data-testid="member-privacy-primary"
          disabled={primary.disabled}
          onClick={primary.onClick}
        >
          {primary.label}
        </button>
      </div>
      <p className="pr-truth"><b>诚实说明</b><span>{BOUNDARY_NOTE}</span></p>
    </div>
  )
}
