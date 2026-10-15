// ============================================================
// 账号设置 — /me/settings。青序流光会员壳（QxMePage），视觉真值
// docs/design/kiosk-redesign-2026-08/30-my-profile.html?screen=settings。
//
// 范围（Wave 2）：只读账号状态 + 手机号换绑 + 岗位 AI 授权 + 会话说明 + 协议/隐私入口 + 退出/切换账号。
// 明确不做：昵称修改、账号注销、账号合并、多角色切换。
//
// 诚实化与合规：
// - 登录态只展示后端已脱敏手机号（phoneMasked），绝不展示原始号码。
// - 公共终端：登录态仅存内存，刷新/超时/退出即清除，不写任何浏览器存储。
// - 换绑成功后旧会话全部失效，前端主动清除内存 token，用新号重新登录。
// - 授权状态查询失败显示「本次未取到」并给重新查询，不把失败猜成「未授权」。
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRightIcon,
  FileTextIcon,
  PhoneIcon,
  RepeatIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  type LucideIcon,
} from 'lucide-react'
import { useIdleTimer } from '../../../hooks/useIdleTimer'
import { useAuth } from '../../../auth/useAuth'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { useKioskSessionControl } from '../../../auth/KioskSessionControlContext'
import { getJobAiConsentStatus, revokeJobAiConsent } from '../../../services/api/jobAi'
import {
  sendSmsCode,
  sendPhoneRebindStepUpCode,
  verifyPhoneRebindStepUp,
  submitPhoneRebind,
  type StepUpChallengeResult,
} from '../../../services/auth/memberAuthApi'
import { QxMePage } from './qx/QxMeChrome'

// 退出 / 切换账号 / 撤回授权确认弹层：公共终端二次确认，避免误触清空会话。
// 提交中锁住两个按钮与背板，失败原因写在弹层内（背板会盖住页面提示）。
function ConfirmOverlay({
  title,
  description,
  confirmLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="qx-me-overlay" data-testid="member-settings-dialog" onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-action-title"
        aria-describedby="account-action-desc"
        className="qx-me-dlg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="account-action-title">{title}</h2>
        <p id="account-action-desc">{description}</p>
        {error && <p role="alert" className="qx-me-dlg-err">{error}</p>}
        <div className="qx-me-dlg-acts">
          <button type="button" className="qx-btn" data-variant="ghost" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="qx-btn" data-variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? '提交中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 手机号换绑四步弹层 ─────────────────────────────────────────
type RebindStep = 'send_old' | 'verify_old' | 'send_new' | 'verify_new' | 'done'

const REBIND_STEP_LABEL: Record<Exclude<RebindStep, 'done'>, string> = {
  send_old: '第 1 / 4 步 · 发送旧号验证码',
  verify_old: '第 2 / 4 步 · 验证旧手机号',
  send_new: '第 3 / 4 步 · 填写新手机号',
  verify_new: '第 4 / 4 步 · 验证并换绑',
}

function PhoneRebindOverlay({
  phoneMasked,
  token,
  onDone,
  onCancel,
}: {
  phoneMasked: string
  token: string
  onDone: () => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<RebindStep>('send_old')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<StepUpChallengeResult | null>(null)
  const [oldOtp, setOldOtp] = useState('')
  const [stepUpToken, setStepUpToken] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newOtp, setNewOtp] = useState('')
  const newPhoneRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    setOldOtp('')
    setNewOtp('')
    setNewPhone('')
    setStepUpToken('')
  }, [])

  // 换绑不是完成本单所需的最小切片：大厅屏上的 6 位码只给 45 秒，超时关层并清内存。
  useIdleTimer({
    timeoutMs: 45_000,
    enabled: step !== 'done',
    onIdle: onCancel,
  })

  const handle = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true)
    try { await fn() } catch (e: unknown) {
      setErr(userMessageOf(e, '操作失败，请重试'))
    } finally { setBusy(false) }
  }

  const step1 = () => handle(async () => {
    const c = await sendPhoneRebindStepUpCode(token)
    setChallenge(c); setStep('verify_old')
  })

  const step2 = () => handle(async () => {
    if (!challenge || oldOtp.length !== 6) { setErr('请输入6位验证码'); return }
    const g = await verifyPhoneRebindStepUp(token, challenge.challengeId, oldOtp)
    setStepUpToken(g.stepUpToken); setOldOtp(''); setStep('send_new')
    setTimeout(() => newPhoneRef.current?.focus(), 50)
  })

  const step3 = () => handle(async () => {
    if (!/^1[3-9]\d{9}$/.test(newPhone)) { setErr('请输入有效的大陆手机号'); return }
    await sendSmsCode(newPhone)
    setStep('verify_new')
  })

  const step4 = () => handle(async () => {
    if (newOtp.length !== 6) { setErr('请输入6位验证码'); return }
    await submitPhoneRebind(token, stepUpToken, newPhone, newOtp)
    setNewOtp(''); setStep('done')
  })

  const actions = (primary: ReactNode) => (
    <div className="qx-me-dlg-acts">
      <button type="button" className="qx-btn" data-variant="ghost" onClick={onCancel}>取消</button>
      {primary}
    </div>
  )

  return (
    <div className="qx-me-overlay" data-testid="member-settings-rebind" onClick={step === 'done' ? onDone : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-rebind-title"
        className="qx-me-dlg"
        data-step={step}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="phone-rebind-title">换绑手机号</h2>
        {step !== 'done' && <p className="qx-me-dlg-step">{REBIND_STEP_LABEL[step]}</p>}

        {step === 'send_old' && (
          <>
            <p>将向当前手机号 <b>{phoneMasked}</b> 发送验证码，确认是本人操作后才能换绑。</p>
            {actions(
              <button type="button" className="qx-btn" data-variant="primary" disabled={busy} onClick={step1}>
                {busy ? '发送中…' : '发送验证码'}
              </button>,
            )}
          </>
        )}

        {step === 'verify_old' && (
          <>
            <p>已发送至 {phoneMasked}，输入6位验证码继续。验证码在本屏隐藏显示。</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="6位验证码"
              value={oldOtp}
              onChange={(e) => setOldOtp(e.target.value.replace(/\D/g, ''))}
              autoComplete="one-time-code"
              aria-label="当前手机号验证码，已隐藏显示"
              className="qx-me-input qx-me-otp"
              autoFocus
            />
            {actions(
              <button type="button" className="qx-btn" data-variant="primary" disabled={busy || oldOtp.length !== 6} onClick={step2}>
                {busy ? '验证中…' : '下一步'}
              </button>,
            )}
          </>
        )}

        {step === 'send_new' && (
          <>
            <p>请输入新手机号，我们将发送验证码</p>
            <input
              ref={newPhoneRef}
              type="tel"
              inputMode="numeric"
              maxLength={11}
              placeholder="新手机号"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))}
              aria-label="新手机号"
              className="qx-me-input"
            />
            {actions(
              <button type="button" className="qx-btn" data-variant="primary" disabled={busy || newPhone.length !== 11} onClick={step3}>
                {busy ? '发送中…' : '发送验证码'}
              </button>,
            )}
          </>
        )}

        {step === 'verify_new' && (
          <>
            <p>已发送至 {newPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}，输入6位验证码确认换绑。验证码在本屏隐藏显示。</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="6位验证码"
              value={newOtp}
              onChange={(e) => setNewOtp(e.target.value.replace(/\D/g, ''))}
              autoComplete="one-time-code"
              aria-label="新手机号验证码，已隐藏显示"
              className="qx-me-input qx-me-otp"
              autoFocus
            />
            {actions(
              <button type="button" className="qx-btn" data-variant="primary" disabled={busy || newOtp.length !== 6} onClick={step4}>
                {busy ? '换绑中…' : '确认换绑'}
              </button>,
            )}
          </>
        )}

        {step === 'done' && (
          <>
            <p>换绑成功！当前会话已退出，请用新手机号重新登录。</p>
            <div className="qx-me-dlg-acts">
              <button type="button" className="qx-btn" data-variant="primary" onClick={onDone}>去登录</button>
            </div>
          </>
        )}

        {err && <p role="alert" className="qx-me-dlg-err">{err}</p>}
      </div>
    </div>
  )
}

function LinkRow({
  icon: Icon,
  label,
  desc,
  route,
  testid,
  onClick,
}: {
  icon: LucideIcon
  label: string
  desc: string
  route?: string
  testid: string
  onClick: () => void
}) {
  return (
    <button type="button" className="qx-row" data-route={route} data-testid={testid} onClick={onClick}>
      <span className="qx-row-ic" aria-hidden="true"><Icon size={26} /></span>
      <span className="qx-row-tx">
        <span className="qx-row-t">{label}</span>
        <span className="qx-row-d">{desc}</span>
      </span>
      <span className="qx-row-go" aria-hidden="true"><ChevronRightIcon size={26} /></span>
    </button>
  )
}

function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="qx-me-sec" aria-label={title}>
      <div className="qx-sec-h">
        <span className="t">{title}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="qx-rows">{children}</div>
    </section>
  )
}

type JobAiConsent = 'loading' | 'granted' | 'not-granted' | 'error'

const JOB_AI_CHIP: Record<JobAiConsent, ReactNode> = {
  loading: <span className="qx-me-st" data-tone="run">查询中</span>,
  granted: <span className="qx-me-st">已授权</span>,
  'not-granted': <span className="qx-me-chip">未授权</span>,
  error: <span className="qx-me-st" data-tone="bad">本次未取到</span>,
}

function JobAiConsentRow({
  consent,
  busy,
  onRevoke,
  onRetry,
}: {
  consent: JobAiConsent
  busy: boolean
  onRevoke: () => void
  onRetry: () => void
}) {
  return (
    <section
      aria-label="隐私与 AI 授权管理"
      className="qx-me-row"
      data-testid="member-settings-job-ai"
      data-consent={consent}
    >
      <span className="qx-me-row-ico" data-tone="plum" aria-hidden="true"><ShieldCheckIcon size={28} /></span>
      <span className="qx-me-row-main">
        <span className="qx-me-row-head">
          <span className="qx-me-row-title">隐私与 AI 授权管理</span>
          {JOB_AI_CHIP[consent]}
        </span>
        <span className="qx-me-row-sub">
          {consent === 'error'
            ? '授权状态这次没有取到。本页不猜你是否授权过，所以先不提供撤回；可以重新查询。'
            : '岗位 AI 辅助只用于本人求职准备参考。撤回授权后，再次使用岗位推荐、解读或匹配时需要重新确认；已生成记录可在 AI服务记录中自行删除。'}
        </span>
      </span>
      <span className="qx-me-acts">
        {consent === 'error' ? (
          <button type="button" className="qx-me-small" data-variant="primary" onClick={onRetry}>
            重新查询
          </button>
        ) : (
          <button type="button" className="qx-me-small" disabled={consent !== 'granted' || busy} onClick={onRevoke}>
            撤回授权
          </button>
        )}
      </span>
    </section>
  )
}

export function MySettingsPage() {
  const navigate = useNavigate()
  const { user, isLoggedIn, getToken } = useAuth()
  const { clearSessionTo } = useKioskSessionControl()
  const [confirm, setConfirm] = useState<'logout' | 'switch' | 'revokeJobAi' | null>(null)
  const [showRebind, setShowRebind] = useState(false)
  const [jobAiConsent, setJobAiConsent] = useState<JobAiConsent>('loading')
  const [consentReload, setConsentReload] = useState(0)
  const [jobAiBusy, setJobAiBusy] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const phoneMasked = user?.phoneMasked ?? ''

  useEffect(() => {
    const token = isLoggedIn ? getToken() : null
    if (!token) return
    let cancelled = false
    setJobAiConsent('loading')
    getJobAiConsentStatus(token)
      .then((rows) => {
        if (cancelled) return
        setJobAiConsent(rows.some((row) => row.scope === 'job_ai' && row.granted) ? 'granted' : 'not-granted')
      })
      .catch(() => {
        if (!cancelled) setJobAiConsent('error')
      })
    return () => {
      cancelled = true
    }
  }, [getToken, isLoggedIn, consentReload])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // 退出登录：清空内存会话后回到「我的」（游客态）。
  const handleLogout = () => {
    setConfirm(null)
    clearSessionTo({ path: '/profile' })
  }

  // 切换账号：退出当前账号 → 直达登录页用另一手机号登录。先 logout 清空内存会话，避免数据串号。
  const handleSwitch = () => {
    setConfirm(null)
    clearSessionTo({ path: '/login', state: { from: '/profile' } })
  }

  // 换绑成功：旧会话已由后端踢出，前端清除内存会话并跳转登录页。
  const handleRebindDone = () => {
    setShowRebind(false)
    clearSessionTo({
      path: '/login',
      state: { from: '/profile', hint: '换绑成功，请用新手机号登录' },
    })
  }

  const handleRevokeJobAiConsent = async () => {
    const token = getToken()
    if (!token) return
    setJobAiBusy(true)
    setRevokeError(null)
    try {
      await revokeJobAiConsent(token)
      setJobAiConsent('not-granted')
      setConfirm(null)
      setToast({ tone: 'ok', text: '已撤回岗位 AI 授权，再次使用时需要重新确认' })
    } catch {
      setRevokeError('撤回失败，请稍后重试')
    } finally {
      setJobAiBusy(false)
    }
  }

  const openConfirm = (next: 'logout' | 'switch' | 'revokeJobAi') => {
    setRevokeError(null)
    setConfirm(next)
  }

  const screenState = !isLoggedIn
    ? 'login'
    : jobAiConsent === 'loading'
      ? 'loading'
      : jobAiConsent === 'error'
        ? 'error'
        : 'ready'

  const ctabar = (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" data-route="/profile" onClick={() => navigate('/profile')}>
        返回我的
      </button>
      {isLoggedIn ? (
        <button type="button" className="qx-btn" data-variant="danger" data-testid="member-settings-primary" onClick={() => openConfirm('logout')}>
          退出登录
        </button>
      ) : (
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          data-route="/login"
          data-testid="member-settings-primary"
          onClick={() => navigate('/login', { state: { from: '/me/settings' } })}
        >
          手机号登录
        </button>
      )}
    </>
  )

  return (
    <>
      <QxMePage
        title="账号设置"
        view="settings"
        screen="member-settings"
        screenState={screenState}
        eyebrow={isLoggedIn ? '账号设置 · 已登录' : '账号设置 · 游客'}
        ask={isLoggedIn
          ? <>当前账号 <em>{phoneMasked || '已登录用户'}</em></>
          : <>还没有登录，<em>协议与隐私</em>照常可读</>}
        doing={isLoggedIn
          ? '会员账号 · 手机号已脱敏展示，仅本人可见'
          : '登录后用于绑定本人服务记录，仅本次会话有效。换绑手机号、切换账号与岗位 AI 授权需要先确认是你本人。'}
        truth="手机号只显示服务端脱敏后的号码，本机不保存登录态"
        toast={toast}
        ctabar={ctabar}
      >
        <div className="qx-scroll qx-grow">
          {isLoggedIn && (
            <JobAiConsentRow
              consent={jobAiConsent}
              busy={jobAiBusy}
              onRevoke={() => openConfirm('revokeJobAi')}
              onRetry={() => setConsentReload((n) => n + 1)}
            />
          )}

          {isLoggedIn && (
            <SettingsSection title="账号" hint="公共终端默认遮挡个人信息">
              <LinkRow
                icon={PhoneIcon}
                label="换绑手机号"
                desc="旧号验证 + 新号验证，双重确认"
                testid="member-settings-rebind-entry"
                onClick={() => setShowRebind(true)}
              />
              <LinkRow
                icon={RepeatIcon}
                label="切换账号"
                desc="退出当前账号后用另一手机号登录"
                testid="member-settings-switch-entry"
                onClick={() => openConfirm('switch')}
              />
              <LinkRow
                icon={ShieldQuestionIcon}
                label="隐私与数据请求"
                desc="撤回岗位 AI 授权；导出与注销暂未开放"
                route="/me/privacy-requests"
                testid="member-settings-privacy-requests"
                onClick={() => navigate('/me/privacy-requests')}
              />
            </SettingsSection>
          )}

          <SettingsSection title="协议与隐私" hint={isLoggedIn ? undefined : '不登录也可以完整阅读'}>
            <LinkRow
              icon={FileTextIcon}
              label="用户服务协议"
              desc="服务范围、账号、收费与打印说明"
              route="/legal/terms"
              testid="member-settings-terms"
              onClick={() => navigate('/legal/terms')}
            />
            <LinkRow
              icon={ShieldCheckIcon}
              label="隐私政策"
              desc="信息收集、使用与文件留存说明"
              route="/legal/privacy"
              testid="member-settings-privacy"
              onClick={() => navigate('/legal/privacy')}
            />
          </SettingsSection>

          {/* 会话说明 */}
          <section className="qx-state" data-tone="info" aria-label="公共终端会话说明">
            <span className="qx-state-ic" aria-hidden="true"><ShieldCheckIcon size={28} /></span>
            <div>
              <div className="qx-state-t">公共终端会话说明</div>
              <p className="qx-state-d">
                本终端为公共设备，登录状态只保存在当前会话内存中，不写入本机存储。页面刷新、离开或闲置超时会自动退出登录并清除会话信息。请勿在终端上留存个人物品与文件。
              </p>
            </div>
          </section>

          {/* 暂不开放说明（诚实化：避免被误以为可改资料 / 注销） */}
          <p className="qx-me-legal">
            账号注销和数据导出尚未开放。可在「隐私与数据请求」中撤回岗位 AI 授权；撤回不会删除简历、文档、打印订单或收藏。后台导出包若执行，包含业务元数据清单（含文件与订单等摘要），不是「仅岗位 AI」。如需其他协助，请联系现场工作人员。
          </p>
        </div>
      </QxMePage>

      {confirm === 'logout' && (
        <ConfirmOverlay
          title="退出登录"
          description="退出后将清除本次会话的登录状态，返回游客模式。本人记录已保存在账号下，下次登录仍可查看。"
          confirmLabel="退出登录"
          onConfirm={handleLogout}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'switch' && (
        <ConfirmOverlay
          title="切换账号"
          description="将退出当前账号并前往登录页，使用另一手机号登录。当前会话信息会被清除，不会带入下一个账号。"
          confirmLabel="退出并切换"
          onConfirm={handleSwitch}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'revokeJobAi' && (
        <ConfirmOverlay
          title="撤回岗位 AI 授权"
          description="撤回后，本终端不会继续基于该授权处理您的简历用于岗位 AI 辅助。再次使用岗位 AI 推荐、解读或匹配时，需要重新确认授权。"
          confirmLabel="确认撤回"
          busy={jobAiBusy}
          error={revokeError}
          onConfirm={() => void handleRevokeJobAiConsent()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {showRebind && isLoggedIn && getToken() && (
        <PhoneRebindOverlay
          phoneMasked={phoneMasked}
          token={getToken()!}
          onDone={handleRebindDone}
          onCancel={() => setShowRebind(false)}
        />
      )}
    </>
  )
}
