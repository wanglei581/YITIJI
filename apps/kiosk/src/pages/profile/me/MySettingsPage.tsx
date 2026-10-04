import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRightIcon,
  FileTextIcon,
  LogOutIcon,
  PhoneIcon,
  RepeatIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  UserIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { accountErrorMessage, accountPhoneDisplay } from '../../auth/accountUserMessage'
import { useKioskSessionControl } from '../../../auth/KioskSessionControlContext'
import { getJobAiConsentStatus, revokeJobAiConsent } from '../../../services/api/jobAi'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { QxAiHelp, QxStepActions } from '../../../components/qingxu/QxAiHelp'
import { QxMemberNavbar } from '../components/QxMemberNavbar'
import { SettingsConfirm } from './components/SettingsConfirm'
import { PhoneRebindPanel } from './components/PhoneRebindPanel'
import './styles/settings-qx2.css'

// AI 使用授权只认服务端返回：读不到就是「本次未取到」，绝不退回成「未授权」。
type JobAiConsent = 'idle' | 'loading' | 'granted' | 'not-granted' | 'error'

// 10/3 口径，与《隐私政策》（2026-10-pilot-1 第五节）一字对齐，用原词「核实是你本人」；
// 10/4 产品负责人：设备现场无人值守、全自助，一体机不再把用户引向线下人工，只指向政策里的电话、邮箱。
// 电话、邮箱不写死，引用隐私政策。一体机上不直接提交注销，也没有自助导出。
const ACCOUNT_CLOSURE_NOTE = '注销账号、复制个人信息，请按《隐私政策》里的电话、邮箱联系我们申请。我们核实是你本人后，15 个工作日内处理。'

const CONSENT_BADGE: Record<JobAiConsent, { text: string; tone?: 'run' | 'bad' | 'off' }> = {
  idle: { text: '—', tone: 'off' },
  loading: { text: '查询中', tone: 'run' },
  granted: { text: '已授权' },
  'not-granted': { text: '未授权', tone: 'off' },
  error: { text: '本次未取到', tone: 'bad' },
}

function SettingsRow({
  icon: Icon,
  tone,
  title,
  desc,
  route,
  testid,
  onClick,
}: {
  icon: LucideIcon
  tone?: 'slate' | 'plum' | 'wheat'
  title: string
  desc: string
  route?: string
  testid: string
  /** 不传即游客态的锁定行：只说明登录后会出现什么，不可点、不发任何请求。 */
  onClick?: () => void
}) {
  if (!onClick) {
    return (
      <div className="qx-me-row" data-dead="true" aria-disabled="true" data-testid={testid}>
        <span className="qx-me-row-ico" data-tone="off" aria-hidden="true"><Icon size={28} /></span>
        <span className="qx-me-row-main">
          <span className="qx-me-row-title">{title}</span>
          <span className="qx-me-row-sub">{desc}</span>
        </span>
        <span className="qx-me-pending">登录后可用</span>
      </div>
    )
  }
  return (
    <button type="button" className="qx-me-row" data-route={route} data-testid={testid} onClick={onClick}>
      <span className="qx-me-row-ico" data-tone={tone} aria-hidden="true"><Icon size={28} /></span>
      <span className="qx-me-row-main">
        <span className="qx-me-row-title">{title}</span>
        <span className="qx-me-row-sub">{desc}</span>
      </span>
      <span className="qx-me-row-go" aria-hidden="true"><ChevronRightIcon size={26} /></span>
    </button>
  )
}

export function MySettingsPage() {
  const navigate = useNavigate()
  const { user, isLoggedIn, getToken } = useAuth()
  const { endKioskUse } = useKioskSessionControl()
  const [confirm, setConfirm] = useState<'logout' | 'switch' | 'revokeJobAi' | null>(null)
  const [showRebind, setShowRebind] = useState(false)
  const [jobAi, setJobAi] = useState<JobAiConsent>('idle')
  const [consentReload, setConsentReload] = useState(0)
  const [jobAiBusy, setJobAiBusy] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [hint, setHint] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const phoneMasked = accountPhoneDisplay(user?.phoneMasked ?? '')
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!isLoggedIn) {
      setJobAi('idle')
      return
    }
    const token = getToken()
    if (!token) {
      setJobAi('error')
      return
    }
    setJobAi('loading')
    getJobAiConsentStatus(token)
      .then((rows) => {
        if (cancelled) return
        setJobAi(rows.some((row) => row.scope === 'job_ai' && row.granted) ? 'granted' : 'not-granted')
      })
      .catch(() => {
        if (cancelled) return
        setJobAi('error')
      })
    return () => {
      cancelled = true
    }
  }, [getToken, isLoggedIn, consentReload])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  const closeConfirm = () => {
    setConfirm(null)
    setRevokeError(null)
    setClearError(null)
  }

  // 退出登录：走统一的结束使用，回到首页，与闲置清场同一目的地。
  const handleLogout = () => {
    setClearing(true); setClearError(null)
    try { endKioskUse('end_use') } catch {
      setClearing(false); setClearError('本机登录尚未清除，请重试或联系工作人员。')
    }
  }

  // 切换账号（W-64）：先把上一位完整清掉（人次、本机数据、登录），再进登录页用另一手机号登录。
  const handleSwitch = () => {
    setClearing(true); setClearError(null)
    try { endKioskUse('switch_account') } catch {
      setClearing(false); setClearError('还不能切换账号，请重试或联系工作人员。')
    }
  }

  // 换绑成功：旧会话已由后端踢出，前端清除内存会话并跳转登录页。
  const handleRebindDone = () => {
    endKioskUse('switch_account', { loginHint: '换绑成功，请用新手机号登录' })
  }

  const handleRevokeJobAiConsent = async () => {
    const token = getToken()
    if (!token) return
    setJobAiBusy(true)
    setRevokeError(null)
    try {
      await revokeJobAiConsent(token)
      setJobAi('not-granted')
      setConfirm(null)
      setHint({ tone: 'ok', text: '已撤回 AI 授权，再次使用时需要重新确认' })
    } catch (error) {
      // 撤回失败：授权状态保持服务端上一次返回的值，弹层留着给用户重试或取消。
      setRevokeError(accountErrorMessage(error, '撤回失败，请稍后重试；授权状态没有改变。'))
    } finally {
      setJobAiBusy(false)
    }
  }

  const badge = CONSENT_BADGE[jobAi]
  const screenState = confirm === 'switch' ? (clearError ? 'switch-failed' : clearing ? 'switching' : 'switch-confirm')
    : !isLoggedIn ? 'anonymous' : jobAi === 'loading' ? 'loading' : jobAi === 'error' ? 'error' : 'member'

  if (showRebind && isLoggedIn && getToken()) return (
    <PhoneRebindPanel phoneMasked={phoneMasked} token={getToken()!} onDone={handleRebindDone}
      onRecheck={() => endKioskUse('switch_account', { loginHint: '请用新手机号登录核对换绑结果；如有困难，请按《隐私政策》里的电话、邮箱联系我们。' })}
      onCancel={() => setShowRebind(false)} />
  )
  const ctabar = <>
    <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/profile')}>返回我的</button>
    {isLoggedIn ? <button type="button" className="qx-btn" data-variant="danger" data-testid="member-settings-primary" onClick={() => setConfirm('logout')}><LogOutIcon size={24} aria-hidden="true" />结束使用并退出登录</button>
      : <button type="button" className="qx-btn" data-variant="primary" data-testid="member-settings-primary" onClick={() => navigate('/login', { state: { from: '/me/settings' } })}>手机号登录</button>}
  </>

  return (
    <div className="settings-page fusion-w5" data-kiosk-screen="member-settings" data-qx-view="settings" data-state={screenState} data-testid={`member-settings-state-${screenState}`} data-takeaway="本人账号设置与授权状态">
    <QxPageFrame title="账号设置" subtitle="换号、管理授权或结束使用，都在这里。"
      status={{ tone: jobAi === 'error' ? 'warn' : 'unknown', label: isLoggedIn ? '公共设备，请保护个人信息' : '当前是游客' }}
      back={{ label: '返回我的', onBack: () => navigate('/profile') }}
      ctabar={ctabar} navbar={<QxMemberNavbar current="profile" />}>
      <div className="qx-scroll qx-grow settings-body">
        <section className="settings-identity" aria-label={isLoggedIn ? '会员账号概览' : '登录引导'}>
          <span className="settings-avatar" aria-hidden="true"><UserIcon size={36} /></span>
          <span className="settings-idtx">
            <b>{isLoggedIn ? '本人账号' : '还没有登录'}</b>
            <span className="settings-idsub">
              {isLoggedIn
                ? `手机号 ${phoneMasked || '只显示前三后四'} · 公共终端默认不显示完整个人信息`
                : '这台机器是公共终端，不登录就不会显示任何人的简历、订单和文件。'}
            </span>
          </span>
          <span className="settings-idstat">{isLoggedIn ? '账号设置在页面下方' : '登录后管理本人账号'}</span>
        </section>
        {hint ? <p data-testid="member-settings-toast" role="status" className="settings-note">{hint.text}</p> : null}
        {/* 账号操作（仅登录态）；游客只看到登录后会出现哪几项（稿 30 settings:anonymous），不可点、不读数据 */}
        {!isLoggedIn && (
          <>
            <h2 className="settings-section-title">账号</h2>
            <section className="qx-me-list" aria-label="登录后才出现的账号操作">
              <SettingsRow icon={PhoneIcon} title="换绑手机号" desc="旧号验证 + 新号验证，双重确认" testid="member-settings-locked-rebind" />
              <SettingsRow icon={RepeatIcon} title="切换账号" desc="当前未登录，可以直接去登录" testid="member-settings-locked-switch" />
              <SettingsRow icon={ShieldQuestionIcon} title="隐私与 AI 授权管理" desc={`登录后可以查看与撤回 AI 使用授权。${ACCOUNT_CLOSURE_NOTE}`} testid="member-settings-locked-consent" />
            </section>
          </>
        )}
        {isLoggedIn && (
          <>
            <h2 className="settings-section-title">账号</h2>
            <section className="qx-me-list" aria-label="账号操作">
              <SettingsRow icon={PhoneIcon} tone="wheat" title="换绑手机号" desc="验证旧手机号后，再验证新手机号；成功后退出并重新登录。" testid="member-settings-rebind" onClick={() => setShowRebind(true)} />
              <SettingsRow icon={RepeatIcon} tone="plum" title="换一个账号登录" desc="先二次确认，再退出并清除本机这一次的登录，然后才去登录页。" testid="member-settings-switch" onClick={() => setConfirm('switch')} />
              <SettingsRow
                icon={ShieldQuestionIcon}
                tone="plum"
                title="隐私与数据请求"
                desc={`当前可提交 AI 使用授权的撤回。${ACCOUNT_CLOSURE_NOTE}`}
                route="/me/privacy-requests"
                testid="member-settings-privacy"
                onClick={() => navigate('/me/privacy-requests')}
              />
            </section>
          </>
        )}

        {isLoggedIn && (
          <section className="qx-me-settings-consent" aria-label="隐私与 AI 授权管理" data-consent={jobAi} data-testid="member-settings-consent">
            <span className="qx-me-row-ico" data-tone="plum" aria-hidden="true"><ShieldCheckIcon size={28} /></span>
            <span className="qx-me-row-main">
              <span className="qx-me-row-head">
                <span className="qx-me-row-title">隐私与 AI 授权管理</span>
                <span className="qx-me-st" data-tone={badge.tone} data-testid="member-settings-consent-status">{badge.text}</span>
              </span>
              <span className="qx-me-row-sub">
                {jobAi === 'error'
                  ? '授权状态这次没有取到，请重新读取，或到「隐私与数据请求」处理。'
                  : 'AI 辅助只用于本人求职准备参考。撤回后，再次使用相关服务需要重新确认；已有记录可在 AI 服务记录中删除。'}
              </span>
            </span>
            <span className="qx-me-acts">
              {jobAi === 'error' && (
                <button type="button" className="qx-me-small" onClick={() => setConsentReload((n) => n + 1)}>重新读取</button>
              )}
              <button type="button" className="qx-me-small" disabled={jobAi !== 'granted' || jobAiBusy} onClick={() => setConfirm('revokeJobAi')}>
                撤回授权
              </button>
            </span>
          </section>
        )}

        {/* 协议 / 隐私入口：不登录也能读 */}
        <h2 className="settings-section-title">协议与帮助</h2>
        <section className="qx-me-list" aria-label="协议与帮助">
          <SettingsRow icon={FileTextIcon} title="用户服务协议" desc="服务范围、账号、收费与打印说明" route="/legal/terms" testid="member-settings-terms" onClick={() => navigate('/legal/terms')} />
          <SettingsRow icon={ShieldCheckIcon} tone="slate" title="隐私政策" desc="信息收集、使用与文件留存说明" route="/legal/privacy" testid="member-settings-privacy-doc" onClick={() => navigate('/legal/privacy')} />
        </section>

        <section className="settings-note" aria-label="公共终端使用说明">
          <h2>结束使用之后会发生什么</h2>
          <p>结束使用或闲置超时，会退出本机登录并清除这一次的临时信息。已经提交的订单、文件和记录按各自的保存期限管理。</p>
        </section>
      </div>

      {confirm === 'logout' && (
        <SettingsConfirm
          title="退出登录"
          description="退出后将清除本次登录状态，返回游客模式。本人记录已保存在账号下，下次登录仍可查看。"
          confirmLabel="退出登录"
          danger
          busy={clearing}
          error={clearError}
          onConfirm={handleLogout}
          onCancel={closeConfirm}
        />
      )}
      {confirm === 'switch' && (
        <SettingsConfirm
          title="切换账号"
          description="将退出当前账号并前往登录页，使用另一手机号登录。本次临时信息会被清除，不会带入下一个账号。"
          confirmLabel="退出并切换"
          busy={clearing}
          error={clearError}
          onConfirm={handleSwitch}
          onCancel={closeConfirm}
        />
      )}
      {confirm === 'revokeJobAi' && (
        <SettingsConfirm
          title="撤回 AI 使用授权"
          description="撤回后，不会继续基于该授权处理您的简历。再次使用相关 AI 辅助时，需要重新确认授权。"
          confirmLabel="确认撤回"
          danger
          busy={jobAiBusy}
          error={revokeError}
          onConfirm={() => void handleRevokeJobAiConsent()}
          onCancel={closeConfirm}
        />
      )}
      <QxStepActions onPrev={() => navigate('/profile')} prevLabel="上一步">
        <QxAiHelp label="问小青：换号和退出有什么区别？" draft="换绑手机号、换账号和结束使用有什么区别？怎样保护我的个人信息？" />
      </QxStepActions>
    </QxPageFrame>
    </div>
  )
}
