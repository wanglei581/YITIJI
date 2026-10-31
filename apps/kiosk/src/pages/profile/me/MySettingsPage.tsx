import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../auth/useAuth'
import { accountErrorMessage, accountPhoneDisplay } from '../../auth/accountUserMessage'
import { useKioskSessionControl } from '../../../auth/KioskSessionControlContext'
import { getJobAiConsentStatus, revokeJobAiConsent } from '../../../services/api/jobAi'
import { helpNeededLine } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { MeActs, MeBtn, MeHero, MeP } from '../touch/MeKit'
import { MeTouchShell } from '../touch/MeTouchShell'
import { SettingsConfirm } from './components/SettingsConfirm'
import { PhoneRebindPanel } from './components/PhoneRebindPanel'
import './styles/settings-qx2.css'

// AI 使用授权只认服务端返回：读不到就是「本次未取到」，绝不退回成「未授权」。
type JobAiConsent = 'idle' | 'loading' | 'granted' | 'not-granted' | 'error'

// 10/3 口径，与《隐私政策》（2026-10-pilot-1 第五节）一字对齐，用原词「核实是你本人」；
// 10/4 产品负责人：设备现场无人值守、全自助，一体机不再把用户引向线下人工，只指向政策里的电话、邮箱。
// 电话、邮箱不写死，引用隐私政策。一体机上不直接提交注销，也没有自助导出。
const ACCOUNT_CLOSURE_NOTE = '注销账号、复制个人信息，请按《隐私政策》里的电话、邮箱联系我们申请。我们核实是你本人后，15 个工作日内处理。'

const CONSENT_BADGE: Record<JobAiConsent, { text: string }> = {
  idle: { text: '—' },
  loading: { text: '查询中' },
  granted: { text: '已授权' },
  'not-granted': { text: '未授权' },
  error: { text: '本次未取到' },
}

/** 账号操作行：登录后是整行可点；游客只说明登录后会出现什么，不可点、不发任何请求。 */
function SettingsRow({
  title,
  desc,
  route,
  testid,
  onClick,
}: {
  title: string
  desc: string
  route?: string
  testid: string
  onClick?: () => void
}) {
  if (!onClick) {
    return (
      <div className="me-line" data-dead="true" aria-disabled="true" data-testid={testid}>
        <b>{title}</b>
        <small>{desc} · 登录后可用</small>
      </div>
    )
  }
  return (
    <button type="button" className="me-line" data-route={route} data-testid={testid} onClick={onClick}>
      <b>{title}</b>
      <small>{desc}</small>
    </button>
  )
}

export function MySettingsPage() {
  const navigate = useNavigate()
  const { user, isLoggedIn, getToken } = useAuth()
  const help = helpNeededLine(useSupportContact())
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
      setClearing(false); setClearError(`本机登录尚未清除，请重试。${help}`)
    }
  }

  // 切换账号（W-64）：先把上一位完整清掉（人次、本机数据、登录），再进登录页用另一手机号登录。
  const handleSwitch = () => {
    setClearing(true); setClearError(null)
    try { endKioskUse('switch_account') } catch {
      setClearing(false); setClearError(`还不能切换账号，请重试。${help}`)
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
  const ctabar = isLoggedIn
    ? <button type="button" className="qx-btn" data-variant="danger" data-testid="member-settings-primary" onClick={() => setConfirm('logout')}>结束使用</button>
    : <button type="button" className="qx-btn" data-variant="primary" data-testid="member-settings-primary" onClick={() => navigate('/login', { state: { from: '/me/settings' } })}>去登录</button>

  const bandStatus = !isLoggedIn
    ? { tone: 'unknown' as const, label: '当前是游客' }
    : jobAi === 'error'
      ? { tone: 'warn' as const, label: '这次没读到' }
      : jobAi === 'loading'
        ? { tone: 'reading' as const, label: '正在读取' }
        : { tone: 'ok' as const, label: badge.text }

  return (
    <div className="settings-page fusion-w5" data-kiosk-screen="member-settings" data-qx-view="settings" data-state={screenState} data-testid={`member-settings-state-${screenState}`} data-takeaway="本人账号设置与授权状态">
    <MeTouchShell eyebrow="我的 · 账号设置" title="账号设置" sub={isLoggedIn ? `${phoneMasked || '手机号只显示前三后四'} · 只在这台机器上有效` : '当前是游客'}
      status={bandStatus}
      backLabel="返回我的"
      onBack={() => navigate('/profile')}
      ask={{ label: '问小青：怎么注销账号？', draft: '怎么注销账号？' }}
      primaryNode={ctabar}>
      <div className="qx-scroll qx-grow settings-body me-page">
        <section className="me-id" aria-label={isLoggedIn ? '会员账号概览' : '登录引导'}>
          <b>{isLoggedIn ? '本人账号' : '还没有登录'}</b>
          <span>
            {isLoggedIn
              ? `手机号 ${phoneMasked || '只显示前三后四'} · 公共终端不显示完整个人信息`
              : '这台机器是公共终端，不登录就不会显示任何人的简历、订单和文件。'}
          </span>
        </section>
        {hint ? <p data-testid="member-settings-toast" role="status" className="me-toast" data-tone={hint.tone === 'bad' ? 'bad' : undefined}>{hint.text}</p> : null}
        {/* 账号操作（仅登录态）；游客只看到登录后会出现哪几项（稿 30 settings:anonymous），不可点、不读数据 */}
        {!isLoggedIn && (
          <section className="me-block" aria-label="登录后才出现的账号操作">
            <SettingsRow title="换绑手机号" desc="旧号验证 + 新号验证，双重确认" testid="member-settings-locked-rebind" />
            <SettingsRow title="切换账号" desc="当前未登录，可以直接去登录" testid="member-settings-locked-switch" />
            <SettingsRow title="隐私与 AI 授权管理" desc="可以查看与撤回 AI 使用授权" testid="member-settings-locked-consent" />
          </section>
        )}
        {isLoggedIn && (
          <section className="me-block" aria-label="账号操作">
            <SettingsRow title="换绑手机号" desc="先验证现在的号码，再验证新号码" testid="member-settings-rebind" onClick={() => setShowRebind(true)} />
            <SettingsRow title="换一个账号登录" desc="会先结束当前这一位的使用" testid="member-settings-switch" onClick={() => setConfirm('switch')} />
            <SettingsRow
              title="隐私与数据请求"
              desc="可以撤回 AI 使用授权"
              route="/me/privacy-requests"
              testid="member-settings-privacy"
              onClick={() => navigate('/me/privacy-requests')}
            />
          </section>
        )}

        <div className="me-split">
          {!isLoggedIn && (
            <MeHero art="checklist" artWidth={150} title="登录后查看" testId="member-settings-consent-locked" className="me-consent">
              <MeP>登录后可以查看 AI 使用授权。</MeP>
            </MeHero>
          )}
          {isLoggedIn && (
            <MeHero
              art="checklist"
              artWidth={150}
              title={<span data-testid="member-settings-consent-status">{badge.text}</span>}
              testId="member-settings-consent"
              className="me-consent"
            >
              <MeP>
                {jobAi === 'error'
                  ? '授权状态这次没有取到，请重新读取，或到「隐私与数据请求」处理。'
                  : jobAi === 'granted'
                    ? '你已经同意用 AI 辅助处理简历。AI 辅助只用于本人求职准备参考；撤回后，再次使用相关服务需要重新确认，已有记录可在 AI 服务记录中删除。'
                    : jobAi === 'not-granted'
                      ? '你还没有同意用 AI 辅助处理简历。'
                      : '正在读取你的 AI 使用授权。'}
              </MeP>
              <MeActs>
                <MeBtn v="sec" disabled={jobAi !== 'error'} onClick={() => setConsentReload((n) => n + 1)}>重新读取</MeBtn>
                <MeBtn v="sec" aria-label="撤回授权" disabled={jobAi !== 'granted' || jobAiBusy} onClick={() => setConfirm('revokeJobAi')}>撤回</MeBtn>
              </MeActs>
            </MeHero>
          )}
          {/* 协议 / 隐私入口：不登录也能读 */}
          <MeHero art="resume" artWidth={140} title="协议与注销" className="me-legal-card">
            <MeP>用户服务协议和隐私政策不登录也能看。{ACCOUNT_CLOSURE_NOTE}一体机上不能直接注销。</MeP>
            <section aria-label="协议与帮助">
              <MeActs>
                <MeBtn v="sec" data-testid="member-settings-terms" onClick={() => navigate('/legal/terms')}>用户服务协议</MeBtn>
                <MeBtn v="sec" data-testid="member-settings-privacy-doc" onClick={() => navigate('/legal/privacy')}>隐私政策</MeBtn>
              </MeActs>
            </section>
          </MeHero>
        </div>

        <section className="me-fine" aria-label="公共终端使用说明">
          结束使用或闲置超时，会退出本机登录并清除这一次的临时信息。已经提交的订单、文件和记录按各自的保存期限管理。
        </section>
      </div>

      {confirm === 'logout' && (
        <SettingsConfirm
          title="结束使用"
          description="这会退出登录，并清掉这台机器上这一次的临时信息。已保存的简历和文档按保存期限保留。"
          confirmLabel="确认结束使用"
          danger
          busy={clearing}
          error={clearError}
          onConfirm={handleLogout}
          onCancel={closeConfirm}
        />
      )}
      {confirm === 'switch' && (
        <SettingsConfirm
          title="换一个账号登录"
          description="会先结束这一位的使用，再去登录。本次临时信息会被清除，不会带入下一个账号。"
          confirmLabel="结束并去登录"
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
    </MeTouchShell>
    </div>
  )
}
