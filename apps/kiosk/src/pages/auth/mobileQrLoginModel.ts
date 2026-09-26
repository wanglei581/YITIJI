/* 手机确认登录（/member/qr-login）的纯逻辑：状态注册表、服务端错误归类、按钮判据与文案。
 * 视觉与口径真值：docs/design/kiosk-redesign-2026-08/51-phone-relay.html（screen=qr-login）。
 *
 * 这里只放「由服务端回执与本页操作推出来的事实」，不发请求、不碰 DOM。
 * 两条最容易被合并的事实必须分开：
 *   locked        这一页确实成功发出过一次验证码 → 锁号、脱敏回显、按钮写「重新获取」；
 *   hasUsableCode 服务端此刻「还可能」留着一条码 → 验证码输入与确认按钮才允许启用。
 * 合成一个布尔量会漏掉「过期后重新获取又被频控挡下」那一屏：发过码，但一条可填的都没有。 */
import { MemberApiError, resolveMemberApiErrorMessage } from '../../services/auth/memberAuthApi'

/** services/api/src/member-auth/member-qr-login.service.ts QR_TICKET_TTL：票据「总」寿命。 */
export const QR_TICKET_TTL_SECONDS = 180
/** services/api/src/member-auth/member-auth.service.ts COOLDOWN：成功回执 cooldownSeconds 缺省时的兜底。 */
export const SMS_RESEND_SECONDS = 60
/** 被频控挡下后本页自己留的最短等待。它不是系统的剩余时间，文案必须照实这么说。 */
export const RETRY_GATE_SECONDS = SMS_RESEND_SECONDS
export const PHONE_LENGTH = 11
export const CODE_LENGTH = 6

export type MobileQrState =
  | 'missing-ticket'
  | 'checking'
  | 'status-error'
  | 'ticket-expired'
  | 'ready'
  | 'device-missing'
  | 'send-loading'
  | 'send-error'
  | 'send-limited'
  | 'code-sent'
  | 'confirming'
  | 'confirm-code-invalid'
  | 'confirm-code-expired'
  | 'confirm-code-locked'
  | 'confirm-rejected'
  | 'confirm-unknown'
  | 'confirmed'

/** 整屏接管的状态；其余状态共用同一张表单。 */
const TAKEOVER_STATES: ReadonlySet<MobileQrState> = new Set([
  'missing-ticket', 'checking', 'status-error', 'ticket-expired', 'confirmed',
])

export function isFormState(state: MobileQrState): boolean {
  return !TAKEOVER_STATES.has(state)
}

/** send-error 的三种成因，下一步不同，所以文案分开写。 */
export type SendErrorKind = 'channel' | 'unknown' | 'rejected'
export type SendLimitKind = 'later' | 'tomorrow'

export interface MobileQrFacts {
  state: MobileQrState
  phone: string
  code: string
  locked: boolean
  hasUsableCode: boolean
  /** 上一次发码成功回执给的重发冷却，秒数有出处。 */
  cooldown: number
  /** 被「稍后」频控挡下后本页自己留的最短等待。 */
  retryGate: number
  /** 今天已经不能再发的那个号码。绑号码不绑时间，只能靠换号解除。 */
  dailyLimitedPhone: string | null
}

export function normalizeDigits(raw: string, maxLength: number): string {
  return raw.replace(/\D/g, '').slice(0, maxLength)
}

function isFrozen(state: MobileQrState): boolean {
  return state === 'confirming' || state === 'send-loading' || state === 'confirm-unknown'
}

export type SendBlock = 'busy' | 'cooldown' | 'retry-gate' | 'daily-limit' | 'phone'

/** 发码按钮为什么点不动：按钮、按钮上的字、旁边的说明、确认按钮的理由全部只读这一个判据。 */
export function sendBlockedBy(f: MobileQrFacts): SendBlock | null {
  if (isFrozen(f.state)) return 'busy'
  if (f.cooldown > 0) return 'cooldown'
  if (f.retryGate > 0) return 'retry-gate'
  if (f.dailyLimitedPhone && f.phone === f.dailyLimitedPhone) return 'daily-limit'
  if (!f.locked && f.phone.length !== PHONE_LENGTH) return 'phone'
  return null
}

export function codeInputEnabled(f: MobileQrFacts): boolean {
  return f.hasUsableCode && !isFrozen(f.state)
}

export function canConfirm(f: MobileQrFacts): boolean {
  if (!f.locked || !f.hasUsableCode || isFrozen(f.state)) return false
  return f.phone.length === PHONE_LENGTH && f.code.length === CODE_LENGTH
}

export function sendVerb(f: MobileQrFacts): string {
  return f.locked ? '重新获取' : '获取验证码'
}

export function sendLabel(f: MobileQrFacts): string {
  if (f.state === 'send-loading') return '发送中…'
  const blocked = sendBlockedBy(f)
  if (blocked === 'cooldown') return `${f.cooldown} 秒`
  if (blocked === 'retry-gate') return `${f.retryGate} 秒`
  if (blocked === 'daily-limit') return '今天不能发'
  return sendVerb(f)
}

export function sendLabelAria(f: MobileQrFacts): string {
  if (f.state === 'send-loading') return '正在发送验证码'
  const blocked = sendBlockedBy(f)
  if (blocked === 'cooldown') return `重新获取验证码，还需等待 ${f.cooldown} 秒`
  if (blocked === 'retry-gate') return `暂时不能${sendVerb(f)}，本页留的最短等待还剩 ${f.retryGate} 秒`
  if (blocked === 'daily-limit') return '这个手机号今天不能再获取验证码，换一个本人手机号才能继续'
  return f.locked ? '重新获取验证码' : '获取短信验证码'
}

export function confirmReason(f: MobileQrFacts): string {
  if (f.state === 'confirming') return '请等待系统返回结果，本页不会提前显示成功。'
  if (f.state === 'send-loading') return '正在发送验证码，请稍候。'
  if (f.phone.length !== PHONE_LENGTH) return '请先填写 11 位手机号。'
  const blocked = sendBlockedBy(f)
  const waiting = blocked === 'cooldown' || blocked === 'retry-gate'
  if (!f.locked) {
    if (waiting) return `还没有获取过验证码；「${sendVerb(f)}」现在也点不动，等按钮上的倒计时走完再点。`
    if (blocked === 'daily-limit') return '还没有获取过验证码；这个号码今天已经不能再获取，换一个本人手机号才拿得到。'
    return '请先点「获取验证码」，收到短信后再填。'
  }
  if (!f.hasUsableCode) {
    const tail = waiting
      ? '按钮还在倒计时，等它走完再点。'
      : blocked === 'daily-limit' ? '这个号码今天已经不能再获取，换一个本人手机号才拿得到新的一条。' : ''
    if (f.state === 'send-limited') {
      return tail
        ? `现在没有可以填的验证码，${tail}`
        : `现在没有可以填的验证码，刚才这次${sendVerb(f)}被系统挡下了，可以再点一次「${sendVerb(f)}」试试。`
    }
    if (f.state === 'confirm-code-locked') return `这条验证码已被作废，请点上面的「重新获取」拿一条新的。${tail}`
    if (f.state === 'confirm-code-expired') return `这条验证码已经过期或不存在，请点上面的「重新获取」拿一条新的。${tail}`
    return `现在没有可以填的验证码，请先点上面的「重新获取」。${tail}`
  }
  if (f.state === 'confirm-code-invalid' && f.code.length !== CODE_LENGTH) {
    return '请核对短信里最新的一条验证码后重新填写；它仍有有效期和尝试次数限制。'
  }
  if (f.code.length !== CODE_LENGTH) return '请填写收到的 6 位验证码。'
  return '确认后手机端就结束了，登录要回一体机上完成。'
}

// ── 服务端回执归类：只认服务端源码里真实存在的错误码，读不懂的一律走保守分支 ──

/** 这四种在服务端都已不可能再 confirm 成功（member-qr-login.service.ts readTicket / confirm / assertTicketId）。 */
const TICKET_DEAD_CODES = new Set([
  'QR_LOGIN_NOT_FOUND',
  'QR_LOGIN_ALREADY_CLAIMED',
  'QR_LOGIN_ALREADY_CONFIRMED',
  'QR_LOGIN_TICKET_INVALID',
])
const SMS_LATER_CODES = new Set([
  'SMS_TOO_FREQUENT',
  'SMS_IP_LIMIT',
  'SMS_DEVICE_LIMIT',
  'SMS_PROVIDER_RATE_LIMIT',
  'RATE_LIMITED',
])
const SMS_TOMORROW_CODES = new Set(['SMS_DAILY_LIMIT', 'SMS_PROVIDER_PHONE_DAILY_LIMIT'])

function errorCode(error: unknown): string {
  return error instanceof MemberApiError ? error.code : 'NETWORK_ERROR'
}

function errorStatus(error: unknown): number {
  return error instanceof MemberApiError ? error.status : 0
}

/** 服务端明确给出的中文说明；网络错误与「请求失败（500）」这类占位句一律返回空串。 */
export function explicitServerMessage(error: unknown): string {
  return resolveMemberApiErrorMessage(error, '')
}

export type StatusFailure = { kind: 'ticket-dead' } | { kind: 'unreadable'; message: string }

export function classifyStatusError(error: unknown): StatusFailure {
  if (TICKET_DEAD_CODES.has(errorCode(error))) return { kind: 'ticket-dead' }
  return { kind: 'unreadable', message: explicitServerMessage(error) }
}

export type SendFailure =
  | { kind: 'limited'; limit: SendLimitKind }
  | { kind: 'error'; error: SendErrorKind; message: string }

export function classifySendError(error: unknown): SendFailure {
  const code = errorCode(error)
  const status = errorStatus(error)
  if (SMS_TOMORROW_CODES.has(code)) return { kind: 'limited', limit: 'tomorrow' }
  if (SMS_LATER_CODES.has(code) || status === 429) return { kind: 'limited', limit: 'later' }
  // SMS_SEND_FAILED：服务端把刚写入的验证码和冷却一起删了（member-auth.service.ts sendSmsCode catch 分支）。
  if (code === 'SMS_SEND_FAILED') return { kind: 'error', error: 'channel', message: '' }
  // 没有回执或服务端 5xx：那次请求可能已经生成并发出了新码，也可能没有，本页不下结论。
  if (status === 0 || status >= 500) return { kind: 'error', error: 'unknown', message: '' }
  return { kind: 'error', error: 'rejected', message: explicitServerMessage(error) }
}

export type ConfirmFailure =
  | { kind: 'confirm-code-invalid' | 'confirm-code-expired' | 'confirm-code-locked' | 'ticket-expired' | 'confirm-unknown' }
  | { kind: 'confirm-rejected'; message: string }

export function classifyConfirmError(error: unknown): ConfirmFailure {
  const code = errorCode(error)
  const status = errorStatus(error)
  if (code === 'SMS_CODE_INVALID') return { kind: 'confirm-code-invalid' }
  if (code === 'SMS_CODE_EXPIRED') return { kind: 'confirm-code-expired' }
  if (code === 'SMS_CODE_LOCKED') return { kind: 'confirm-code-locked' }
  if (TICKET_DEAD_CODES.has(code)) return { kind: 'ticket-expired' }
  // 请求发出去了但没拿到明确结论：那次确认可能已经生效，不能当失败，也不能当成功。
  if (status === 0 || status >= 500) return { kind: 'confirm-unknown' }
  return { kind: 'confirm-rejected', message: explicitServerMessage(error) }
}
