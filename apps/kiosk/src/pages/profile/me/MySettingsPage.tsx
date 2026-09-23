// ============================================================
// 账号设置（Wave 2）— /me/settings。
//
// 范围（Wave 2）：只读账号状态 + 手机号换绑 + 会话说明 + 协议/隐私入口 + 退出/切换账号。
// 明确不做：昵称修改、账号注销、账号合并、多角色切换。
//
// 视觉（2026-09-23）：从墨青纸感 V6 页框迁入青序流光，复用「我的」共享壳 QxMePage 的
// settings 视图（稿 30-my-profile ?screen=settings）。样式只在 qx-me-shared.css 的 .qx-me-settings
// 作用域，令牌一律 var(--qx-*)；不新增路由、后端或第二套壳。
//
// 诚实化与合规：
// - 登录态只展示后端已脱敏手机号（phoneMasked），绝不展示原始号码。
// - 岗位 AI 授权读不到时显示「本次未取到」，不猜成「未授权」；撤回失败不改变授权状态。
// - 公共终端：登录态仅存内存，刷新/超时/退出即清除，不写任何浏览器存储。
// - 换绑成功后旧会话全部失效，前端主动清除内存 token，用新号重新登录。
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BadgeCheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  LogOutIcon,
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
import { QxMeBanner, QxMeCta, QxMePage, QxMeSummary } from './qx/QxMeChrome'

// 岗位 AI 授权只认服务端返回：读不到就是「本次未取到」，绝不退回成「未授权」。
type JobAiConsent = 'idle' | 'loading' | 'granted' | 'not-granted' | 'error'

const CONSENT_BADGE: Record<JobAiConsent, { text: string; tone?: 'run' | 'bad' | 'off' }> = {
  idle: { text: '—', tone: 'off' },
  loading: { text: '查询中', tone: 'run' },
  granted: { text: '已授权' },
  'not-granted': { text: '未授权', tone: 'off' },
  error: { text: '本次未取到', tone: 'bad' },
}

// 退出 / 切换账号 / 撤回授权确认弹层：公共终端二次确认，避免误触清空会话。
function ConfirmOverlay({
  title,
  description,
  confirmLabel,
  danger,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="qx-me-settings-overlay" onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-action-title"
        aria-describedby="account-action-desc"
        className="qx-me-settings-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="account-action-title">{title}</h2>
        <p id="account-action-desc">{description}</p>
        {error && <p role="alert" className="qx-me-settings-err">{error}</p>}
        <div className="qx-me-settings-dialog-acts">
          <button type="button" className="qx-btn" data-variant="ghost" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="qx-btn" data-variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 手机号换绑四步弹层 ─────────────────────────────────────────
type RebindStep = 'send_old' | 'verify_old' | 'send_new' | 'verify_new' | 'done'

const REBIND_STEP_LABEL: Record<RebindStep, string> = {
  send_old: '第 1 步 / 共 4 步 · 发送旧号验证码',
  verify_old: '第 2 步 / 共 4 步 · 验证旧手机号',
  send_new: '第 3 步 / 共 4 步 · 填写新手机号',
  verify_new: '第 4 步 / 共 4 步 · 验证并换绑',
  done: '四步已全部通过',
}

function DialogActs({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="qx-me-settings-dialog-acts">
      <button type="button" className="qx-btn" data-variant="ghost" onClick={onCancel}>取消</button>
      {children}
    </div>
  )
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

  return (
    <div className="qx-me-settings-overlay" onClick={step === 'done' ? onDone : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-rebind-title"
        className="qx-me-settings-dialog"
        data-step={step}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qx-me-settings-step">{REBIND_STEP_LABEL[step]}</div>
        <h2 id="phone-rebind-title">换绑手机号</h2>

        {step === 'send_old' && (
          <>
            <p>将向当前手机号 <b>{phoneMasked}</b> 发送验证码，确认是本人操作后才能换绑。</p>
            <DialogActs onCancel={onCancel}>
              <button type="button" className="qx-btn" data-variant="primary" disabled={busy} onClick={step1}>{busy ? '发送中…' : '发送验证码'}</button>
            </DialogActs>
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
              className="qx-me-settings-input me-otp-mask"
              autoFocus
            />
            <DialogActs onCancel={onCancel}>
              <button type="button" className="qx-btn" data-variant="primary" disabled={busy || oldOtp.length !== 6} onClick={step2}>{busy ? '验证中…' : '下一步'}</button>
            </DialogActs>
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
              className="qx-me-settings-input"
            />
            <DialogActs onCancel={onCancel}>
              <button type="button" className="qx-btn" data-variant="primary" disabled={busy || newPhone.length !== 11} onClick={step3}>{busy ? '发送中…' : '发送验证码'}</button>
            </DialogActs>
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
              className="qx-me-settings-input me-otp-mask"
              autoFocus
            />
            <DialogActs onCancel={onCancel}>
              <button type="button" className="qx-btn" data-variant="primary" disabled={busy || newOtp.length !== 6} onClick={step4}>{busy ? '换绑中…' : '确认换绑'}</button>
            </DialogActs>
          </>
        )}

        {step === 'done' && (
          <>
            <p>换绑成功！当前会话已退出，请用新手机号重新登录。</p>
            <div className="qx-me-settings-dialog-acts">
              <button type="button" className="qx-btn" data-variant="primary" onClick={onDone}>去登录</button>
            </div>
          </>
        )}

        {err && <p role="alert" className="qx-me-settings-err">{err}</p>}
      </div>
    </div>
  )
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
  const { clearSessionTo } = useKioskSessionControl()
  const [confirm, setConfirm] = useState<'logout' | 'switch' | 'revokeJobAi' | null>(null)
  const [showRebind, setShowRebind] = useState(false)
  const [jobAi, setJobAi] = useState<JobAiConsent>('idle')
  const [consentReload, setConsentReload] = useState(0)
  const [jobAiBusy, setJobAiBusy] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [hint, setHint] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const phoneMasked = user?.phoneMasked ?? ''

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
  }

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
      setJobAi('not-granted')
      setConfirm(null)
      setHint({ tone: 'ok', text: '已撤回岗位 AI 授权，再次使用时需要重新确认' })
    } catch {
      // 撤回失败：授权状态保持服务端上一次返回的值，弹层留着给用户重试或取消。
      setRevokeError('撤回失败，请稍后重试；授权状态没有改变。')
    } finally {
      setJobAiBusy(false)
    }
  }

  const badge = CONSENT_BADGE[jobAi]
  const screenState = !isLoggedIn
    ? 'guest'
    : jobAi === 'loading'
      ? 'consent-loading'
      : jobAi === 'error'
        ? 'consent-error'
        : 'member'

  const ctabar = (
    <QxMeCta
      secondaryLabel="返回我的"
      secondaryRoute="/profile"
      onSecondary={() => navigate('/profile')}
      primary={isLoggedIn ? (
        <button type="button" className="qx-btn" data-variant="danger" data-testid="member-settings-primary" onClick={() => setConfirm('logout')}>
          <LogOutIcon size={24} aria-hidden="true" />
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
    />
  )

  return (
    <QxMePage
      title="账号设置"
      view="settings"
      screen="member-settings"
      screenState={screenState}
      eyebrow="ACCOUNT SETTINGS"
      ask={isLoggedIn ? <>账号设置，<em>换号或结束使用</em>都在这里。</> : <>还没登录，<em>协议与隐私</em>不用账号也能看。</>}
      doing={isLoggedIn
        ? <>手机号只显示脱敏号码；<b>登录态只在本次会话内存中</b>，退出或超时即清除。</>
        : <>登录后才会出现换绑、切换账号与授权管理；<b>未登录不读取任何账号数据</b>。</>}
      truth="手机号只显示服务端脱敏后的号码；岗位 AI 授权状态以服务端返回为准。"
      toast={hint}
      ctabar={ctabar}
    >
      <div className="qx-me-settings-body qx-me-grow">
        {/* 账号状态 */}
        {isLoggedIn ? (
          <QxMeSummary
            icon={<BadgeCheckIcon size={32} />}
            label="会员账号"
            big={phoneMasked || '已登录用户'}
            desc="手机号已脱敏展示，仅本人可见"
            minis={['已登录', '仅本次会话有效']}
          />
        ) : (
          <QxMeBanner
            tone="lock"
            title="当前是游客"
            desc={<>登录后用于绑定本人服务记录，仅本次会话有效。<b>换绑手机号、切换账号与岗位 AI 授权管理需要先登录。</b></>}
            minis={['未登录', '不读取账号数据']}
          />
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
                  ? '岗位 AI 授权状态这次没有取到。本页不会猜你是否授权，撤回按钮暂不可用；可以重新读取，或到「隐私与数据请求」处理。'
                  : '岗位 AI 辅助只用于本人求职准备参考。撤回授权后，再次使用岗位推荐、解读或匹配时需要重新确认；已生成记录可在 AI服务记录中自行删除。'}
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

        {/* 账号操作（仅登录态）；游客只看到登录后会出现哪几项（稿 30 settings:anonymous），不可点、不读数据 */}
        {!isLoggedIn && (
          <section className="qx-me-list" aria-label="登录后才出现的账号操作">
            <div className="qx-me-legal">登录后才会出现 · 需要先确认是你本人</div>
            <SettingsRow icon={PhoneIcon} title="换绑手机号" desc="旧号验证 + 新号验证，双重确认" testid="member-settings-locked-rebind" />
            <SettingsRow icon={RepeatIcon} title="切换账号" desc="当前没有登录态，直接登录即可" testid="member-settings-locked-switch" />
            <SettingsRow icon={ShieldQuestionIcon} title="隐私与 AI 授权管理" desc="查看与撤回岗位 AI 授权；匿名会话不能提交" testid="member-settings-locked-consent" />
          </section>
        )}
        {isLoggedIn && (
          <section className="qx-me-list" aria-label="账号操作">
            <SettingsRow icon={PhoneIcon} tone="wheat" title="换绑手机号" desc="旧号验证 + 新号验证，双重确认" testid="member-settings-rebind" onClick={() => setShowRebind(true)} />
            <SettingsRow icon={RepeatIcon} tone="plum" title="切换账号" desc="退出当前账号后用另一手机号登录" testid="member-settings-switch" onClick={() => setConfirm('switch')} />
            <SettingsRow
              icon={ShieldQuestionIcon}
              tone="plum"
              title="隐私与数据请求"
              desc="撤回岗位 AI 授权；导出与注销暂未开放"
              route="/me/privacy-requests"
              testid="member-settings-privacy"
              onClick={() => navigate('/me/privacy-requests')}
            />
          </section>
        )}

        {/* 协议 / 隐私入口：不登录也能读 */}
        <section className="qx-me-list" aria-label="协议与隐私">
          <SettingsRow icon={FileTextIcon} title="用户服务协议" desc="服务范围、账号、收费与打印说明" route="/legal/terms" testid="member-settings-terms" onClick={() => navigate('/legal/terms')} />
          <SettingsRow icon={ShieldCheckIcon} tone="slate" title="隐私政策" desc="信息收集、使用与文件留存说明" route="/legal/privacy" testid="member-settings-privacy-doc" onClick={() => navigate('/legal/privacy')} />
        </section>

        {/* 会话说明 */}
        <section className="qx-me-settings-note" aria-label="公共终端会话说明">
          <ShieldCheckIcon size={26} aria-hidden="true" />
          <span>
            <b>公共终端会话说明</b>
            本终端为公共设备，登录状态只保存在当前会话内存中，不写入本机存储。页面刷新、离开或闲置超时会自动退出登录并清除会话信息。请勿在终端上留存个人物品与文件。
          </span>
        </section>

        {/* 暂不开放说明（诚实化：避免被误以为可改资料 / 注销） */}
        <p className="qx-me-settings-note" data-tone="muted">
          <ShieldQuestionIcon size={26} aria-hidden="true" />
          <span>
            账号注销和数据导出尚未开放。可在「隐私与数据请求」中撤回岗位 AI 授权；撤回不会删除简历、文档、打印订单或收藏。后台导出包若执行，包含业务元数据清单（含文件与订单等摘要），不是「仅岗位 AI」。如需其他协助，请联系现场工作人员。
          </span>
        </p>
      </div>

      {confirm === 'logout' && (
        <ConfirmOverlay
          title="退出登录"
          description="退出后将清除本次会话的登录状态，返回游客模式。本人记录已保存在账号下，下次登录仍可查看。"
          confirmLabel="退出登录"
          danger
          onConfirm={handleLogout}
          onCancel={closeConfirm}
        />
      )}
      {confirm === 'switch' && (
        <ConfirmOverlay
          title="切换账号"
          description="将退出当前账号并前往登录页，使用另一手机号登录。当前会话信息会被清除，不会带入下一个账号。"
          confirmLabel="退出并切换"
          onConfirm={handleSwitch}
          onCancel={closeConfirm}
        />
      )}
      {confirm === 'revokeJobAi' && (
        <ConfirmOverlay
          title="撤回岗位 AI 授权"
          description="撤回后，本终端不会继续基于该授权处理您的简历用于岗位 AI 辅助。再次使用岗位 AI 推荐、解读或匹配时，需要重新确认授权。"
          confirmLabel="确认撤回"
          danger
          busy={jobAiBusy}
          error={revokeError}
          onConfirm={() => void handleRevokeJobAiConsent()}
          onCancel={closeConfirm}
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
    </QxMePage>
  )
}
