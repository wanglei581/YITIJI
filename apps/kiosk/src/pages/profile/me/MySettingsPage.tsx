// ============================================================
// 账号设置（Wave 2）— /me/settings。
//
// 范围（Wave 2）：只读账号状态 + 手机号换绑 + 会话说明 + 协议/隐私入口 + 退出/切换账号。
// 明确不做：昵称修改、账号注销、账号合并、多角色切换。
//
// 诚实化与合规：
// - 登录态只展示后端已脱敏手机号（phoneMasked），绝不展示原始号码。
// - 公共终端：登录态仅存内存，刷新/超时/退出即清除，不写任何浏览器存储。
// - 换绑成功后旧会话全部失效，前端主动清除内存 token，用新号重新登录。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  BadgeCheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  LogInIcon,
  LogOutIcon,
  PhoneIcon,
  RepeatIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { KIcon } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { getJobAiConsentStatus, revokeJobAiConsent } from '../../../services/api/jobAi'
import {
  sendSmsCode,
  sendPhoneRebindStepUpCode,
  verifyPhoneRebindStepUp,
  submitPhoneRebind,
  type StepUpChallengeResult,
} from '../../../services/auth/memberAuthApi'
import './me-detail-inkpaper.css'

// 退出 / 切换账号确认弹层：公共终端二次确认，避免误触清空会话。
function ConfirmOverlay({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-action-title"
        aria-describedby="account-action-desc"
        className="me-dialog w-[22rem] max-w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="account-action-title" className="text-base font-semibold text-neutral-900">{title}</p>
        <p id="account-action-desc" className="mt-2 text-sm leading-relaxed text-neutral-500">{description}</p>
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            取消
          </Button>
          <Button className="flex-1" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── 手机号换绑四步弹层 ─────────────────────────────────────────
type RebindStep = 'send_old' | 'verify_old' | 'send_new' | 'verify_new' | 'done'

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

  const handle = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true)
    try { await fn() } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '操作失败，请重试')
    } finally { setBusy(false) }
  }

  const step1 = () => handle(async () => {
    const c = await sendPhoneRebindStepUpCode(token)
    setChallenge(c); setStep('verify_old')
  })

  const step2 = () => handle(async () => {
    if (!challenge || oldOtp.length !== 6) { setErr('请输入6位验证码'); return }
    const g = await verifyPhoneRebindStepUp(token, challenge.challengeId, oldOtp)
    setStepUpToken(g.stepUpToken); setStep('send_new')
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
    setStep('done')
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={step === 'done' ? onDone : onCancel}>
      <div role="dialog" aria-modal="true" className="me-dialog w-[22rem] max-w-full p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-semibold text-neutral-900">换绑手机号</p>

        {step === 'send_old' && (
          <>
            <p className="mt-2 text-sm text-neutral-500">将向当前手机号 <b>{phoneMasked}</b> 发送验证码，确认是本人操作后才能换绑。</p>
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onCancel}>取消</Button>
              <Button className="flex-1" disabled={busy} onClick={step1}>{busy ? '发送中…' : '发送验证码'}</Button>
            </div>
          </>
        )}

        {step === 'verify_old' && (
          <>
            <p className="mt-2 text-sm text-neutral-500">已发送至 {phoneMasked}，输入6位验证码继续</p>
            <input type="tel" inputMode="numeric" maxLength={6} placeholder="6位验证码" value={oldOtp} onChange={(e) => setOldOtp(e.target.value.replace(/\D/g, ''))}
              className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-center text-2xl tracking-widest outline-none focus:border-primary-400" autoFocus />
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onCancel}>取消</Button>
              <Button className="flex-1" disabled={busy || oldOtp.length !== 6} onClick={step2}>{busy ? '验证中…' : '下一步'}</Button>
            </div>
          </>
        )}

        {step === 'send_new' && (
          <>
            <p className="mt-2 text-sm text-neutral-500">请输入新手机号，我们将发送验证码</p>
            <input ref={newPhoneRef} type="tel" inputMode="numeric" maxLength={11} placeholder="新手机号" value={newPhone} onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))}
              className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-lg outline-none focus:border-primary-400" />
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onCancel}>取消</Button>
              <Button className="flex-1" disabled={busy || newPhone.length !== 11} onClick={step3}>{busy ? '发送中…' : '发送验证码'}</Button>
            </div>
          </>
        )}

        {step === 'verify_new' && (
          <>
            <p className="mt-2 text-sm text-neutral-500">已发送至 {newPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}，输入6位验证码确认换绑</p>
            <input type="tel" inputMode="numeric" maxLength={6} placeholder="6位验证码" value={newOtp} onChange={(e) => setNewOtp(e.target.value.replace(/\D/g, ''))}
              className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-center text-2xl tracking-widest outline-none focus:border-primary-400" autoFocus />
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onCancel}>取消</Button>
              <Button className="flex-1" disabled={busy || newOtp.length !== 6} onClick={step4}>{busy ? '换绑中…' : '确认换绑'}</Button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="mt-2 text-sm text-neutral-500">换绑成功！当前会话已退出，请用新手机号重新登录。</p>
            <Button className="mt-5 w-full" onClick={onDone}>去登录</Button>
          </>
        )}

        {err && <p role="alert" className="mt-3 text-sm text-error-fg">{err}</p>}
      </div>
    </div>
  )
}

function LinkRow({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  desc,
  onClick,
}: {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  label: string
  desc?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="me-link-row me-ripple"
    >
      <span className={['flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', iconBg].join(' ')}>
        <Icon className={['h-5 w-5', iconColor].join(' ')} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-neutral-800">{label}</span>
        {desc && <span className="mt-0.5 block text-xs text-neutral-400">{desc}</span>}
      </span>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-neutral-300" aria-hidden="true" />
    </button>
  )
}

const cardSurface = 'me-card px-5'

export function MySettingsPage() {
  const navigate = useNavigate()
  const { user, isLoggedIn, getToken, logout } = useAuth()
  const [confirm, setConfirm] = useState<'logout' | 'switch' | 'revokeJobAi' | null>(null)
  const [showRebind, setShowRebind] = useState(false)
  const [jobAiGranted, setJobAiGranted] = useState<boolean | null>(null)
  const [jobAiLoading, setJobAiLoading] = useState(false)
  const [jobAiBusy, setJobAiBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  useInkRipple('.me-inkdetail .me-ripple')

  const phoneMasked = user?.phoneMasked ?? ''

  useEffect(() => {
    let cancelled = false
    if (!isLoggedIn) {
      setJobAiGranted(null)
      setJobAiLoading(false)
      return
    }
    const token = getToken()
    if (!token) {
      setJobAiGranted(null)
      setJobAiLoading(false)
      return
    }
    setJobAiLoading(true)
    getJobAiConsentStatus(token)
      .then((rows) => {
        if (cancelled) return
        setJobAiGranted(rows.some((row) => row.scope === 'job_ai' && row.granted))
      })
      .catch(() => {
        if (cancelled) return
        setJobAiGranted(null)
      })
      .finally(() => {
        if (!cancelled) setJobAiLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [getToken, isLoggedIn])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  // 退出登录：清空内存会话后回到「我的」（游客态）。
  const handleLogout = () => {
    setConfirm(null)
    logout()
    navigate('/profile')
  }

  // 切换账号：退出当前账号 → 直达登录页用另一手机号登录。先 logout 清空内存会话，避免数据串号。
  const handleSwitch = () => {
    setConfirm(null)
    logout()
    navigate('/login', { state: { from: '/profile' } })
  }

  // 换绑成功：旧会话已由后端踢出，前端清除内存会话并跳转登录页。
  const handleRebindDone = () => {
    setShowRebind(false)
    logout()
    navigate('/login', { state: { from: '/profile', hint: '换绑成功，请用新手机号登录' } })
  }

  const handleRevokeJobAiConsent = async () => {
    const token = getToken()
    if (!token) return
    setJobAiBusy(true)
    try {
      await revokeJobAiConsent(token)
      setJobAiGranted(false)
      setConfirm(null)
      setHint('已撤回岗位 AI 授权，再次使用时需要重新确认')
    } catch {
      setHint('撤回失败，请稍后重试')
    } finally {
      setJobAiBusy(false)
    }
  }

  return (
    <div className="me-inkdetail me-inkdetail-settings flex h-full flex-col">
      {hint && (
        <div role="status" className="me-toast fixed left-1/2 top-4 z-50 -translate-x-1/2 px-5 py-2.5">
          {hint}
        </div>
      )}

      <PageHeader
        className="me-page-header"
        title="账号设置"
        subtitle="账号状态 · 会话说明 · 协议与隐私"
        actions={
          <Button size="sm" variant="secondary" className="me-ripple me-back-button" onClick={() => navigate('/profile')}>
            返回我的
          </Button>
        }
      />

      <div className="me-detail-scroll mt-4 flex-1 overflow-y-auto pb-8">
        <div className="flex flex-col gap-4">
          {/* 账号状态 */}
          {isLoggedIn ? (
            <div className={`${cardSurface} py-5`}>
              <div className="flex items-center gap-4">
                <span className="me-account-avatar me-tone-teal">
                  <KIcon name="phone" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-neutral-900">{phoneMasked || '已登录用户'}</p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-semibold text-success-fg">
                      <BadgeCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      已登录
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-500">会员账号 · 手机号已脱敏展示，仅本人可见</p>
                </div>
              </div>
            </div>
          ) : (
            <div className={`${cardSurface} py-5`}>
              <div className="flex items-center gap-4">
                <span className="me-account-avatar me-tone-slate">
                  <KIcon name="user" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-neutral-900">游客</p>
                  <p className="mt-1 text-sm text-neutral-500">登录后用于绑定本人服务记录，仅本次会话有效</p>
                </div>
                <Button
                  size="lg"
                  className="me-ripple flex h-12 shrink-0 items-center gap-1 px-4"
                  onClick={() => navigate('/login', { state: { from: '/me/settings' } })}
                >
                  <LogInIcon className="h-5 w-5" aria-hidden="true" />
                  手机号登录
                </Button>
              </div>
            </div>
          )}

          {isLoggedIn && (
            <section aria-label="隐私与 AI 授权管理" className={`${cardSurface} py-5`}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-plum-soft">
                  <KIcon name="shield" className="h-5 w-5 text-plum" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-neutral-900">隐私与 AI 授权管理</p>
                    <span className={[
                      'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      jobAiGranted ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-500',
                    ].join(' ')}>
                      {jobAiLoading ? '查询中' : jobAiGranted ? '已授权' : '未授权'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                    岗位 AI 辅助只用于本人求职准备参考。撤回授权后，再次使用岗位推荐、解读或匹配时需要重新确认；已生成记录可在 AI服务记录中自行删除。
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="me-ripple"
                  disabled={!jobAiGranted || jobAiLoading || jobAiBusy}
                  onClick={() => setConfirm('revokeJobAi')}
                >
                  撤回授权
                </Button>
              </div>
            </section>
          )}

          {/* 会话说明 */}
          <Card className="me-card flex items-start gap-3 p-5">
            <ShieldCheckIcon className="h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900">公共终端会话说明</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                本终端为公共设备，登录状态只保存在当前会话内存中，不写入本机存储。页面刷新、离开或闲置超时会自动退出登录并清除会话信息。请勿在终端上留存个人物品与文件。
              </p>
            </div>
          </Card>

          {/* 协议 / 隐私入口 */}
          <section aria-label="协议与隐私" className={`${cardSurface} py-1`}>
            <LinkRow
              icon={FileTextIcon}
              iconBg="bg-primary-50"
              iconColor="text-primary-600"
              label="用户服务协议"
              desc="服务范围、账号、收费与打印说明"
              onClick={() => navigate('/legal/terms')}
            />
            <LinkRow
              icon={ShieldCheckIcon}
              iconBg="bg-info-bg"
              iconColor="text-info"
              label="隐私政策"
              desc="信息收集、使用与文件留存说明"
              onClick={() => navigate('/legal/privacy')}
            />
          </section>

          {/* 账号操作（仅登录态） */}
          {isLoggedIn && (
            <section aria-label="账号操作" className={`${cardSurface} py-1`}>
              <LinkRow
                icon={PhoneIcon}
                iconBg="bg-amber-50"
                iconColor="text-amber-600"
                label="换绑手机号"
                desc="旧号验证 + 新号验证，双重确认"
                onClick={() => setShowRebind(true)}
              />
              <LinkRow
                icon={RepeatIcon}
                iconBg="bg-plum-soft"
                iconColor="text-plum"
                label="切换账号"
                desc="退出当前账号后用另一手机号登录"
                onClick={() => setConfirm('switch')}
              />
              <button
                type="button"
                onClick={() => setConfirm('logout')}
                className="me-link-row me-ripple"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-error-bg">
                  <LogOutIcon className="h-5 w-5 text-error-fg" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold text-error-fg">退出登录</span>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-neutral-300" aria-hidden="true" />
              </button>
            </section>
          )}

          {/* 暂不开放说明（诚实化：避免被误以为可改资料 / 注销） */}
          <div className="me-note flex items-start gap-3 px-5 py-4">
            <ShieldQuestionIcon className="h-5 w-5 shrink-0 text-neutral-400" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-neutral-500">
              账号注销和数据导出尚未开放；相关能力完成安全验证与运营闭环后将在本页提供。如需协助，请联系现场工作人员。
            </p>
          </div>
        </div>
      </div>

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
    </div>
  )
}
