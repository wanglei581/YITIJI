export type LoginGateMode = 'phone' | 'qr'

export type LoginPhoneState =
  | 'phone-idle'
  | 'phone-sending'
  | 'phone-code-sent'
  | 'phone-send-limited'
  | 'phone-send-failed'
  | 'phone-verifying'
  | 'phone-code-invalid'
  | 'phone-code-expired'
  | 'phone-code-locked'
  | 'phone-legal-unpublished'
  | 'phone-sms-unavailable'

export type LoginQrState =
  | 'qr-loading'
  | 'qr-ready'
  | 'qr-expired'
  | 'qr-confirmed'
  | 'qr-error'

export type LoginGateState = LoginPhoneState | LoginQrState

export const LOGIN_PHONE_STATES: readonly LoginPhoneState[] = [
  'phone-idle',
  'phone-sending',
  'phone-code-sent',
  'phone-send-limited',
  'phone-send-failed',
  'phone-verifying',
  'phone-code-invalid',
  'phone-code-expired',
  'phone-code-locked',
  'phone-legal-unpublished',
  'phone-sms-unavailable',
]

export const LOGIN_QR_STATES: readonly LoginQrState[] = [
  'qr-loading',
  'qr-ready',
  'qr-expired',
  'qr-confirmed',
  'qr-error',
]

const SEND_LIMITED_CODES = new Set([
  'SMS_TOO_FREQUENT',
  'SMS_DAILY_LIMIT',
  'SMS_IP_LIMIT',
  'SMS_DEVICE_LIMIT',
  'SMS_PROVIDER_RATE_LIMIT',
  'SMS_PROVIDER_PHONE_DAILY_LIMIT',
  'SMS_RATE_LIMITED',
  'PROVIDER_RATE_LIMIT',
  'PROVIDER_PHONE_DAILY_LIMIT',
])

export function isSendLimitedCode(code: string | null): boolean {
  return code !== null && SEND_LIMITED_CODES.has(code)
}

/**
 * 发码失败里「换号、再等一会儿都没用，只能换登录方式」的几种。与 phone-send-limited 分开的理由：
 * 那一态的主按钮是「再试一次发码」，限的是这个号码 / 这个网络，换号或等冷却确实能过；
 * 这几种限的是这台机器或全站当天的发送量（或发送量核对不了），这台机器上怎么重试都发不出。
 * 此时唯一走得通的是扫码登录 —— 二维码由本机取、在手机上确认，不经这台机器发短信。
 *
 *   SMS_TERMINAL_DAILY_LIMIT  这台机器今天发码到上限
 *   SMS_DAILY_TOTAL_LIMIT     全站今天发码到上限（手机上用登录过的小程序确认，不用短信）
 *   SMS_BUDGET_UNAVAILABLE    发送量核对不了，服务端先停发
 *   TERMINAL_SESSION_INVALID  发码带了终端编号但这台机器的安全校验没过、换票也没换回来
 */
const SMS_UNAVAILABLE_CODES = new Set([
  'SMS_TERMINAL_DAILY_LIMIT',
  'SMS_DAILY_TOTAL_LIMIT',
  'SMS_BUDGET_UNAVAILABLE',
  'TERMINAL_SESSION_INVALID',
])

export function isSmsUnavailableCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && SMS_UNAVAILABLE_CODES.has(code)
}

/** 限的是这个号码今天还能不能收码。换一个号码可以再获取；同一号码再点没有用。 */
const PHONE_DAILY_SMS_CODES = new Set([
  'SMS_DAILY_LIMIT',
  'SMS_PROVIDER_PHONE_DAILY_LIMIT',
  'PROVIDER_PHONE_DAILY_LIMIT',
])

export function isPhoneDailySmsCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && PHONE_DAILY_SMS_CODES.has(code)
}

export function phoneSendHeld(state: LoginPhoneState, errorCode: string | null | undefined): boolean {
  return state === 'phone-sms-unavailable' || isSmsUnavailableCode(errorCode) || isPhoneDailySmsCode(errorCode)
}

export function classifyPhoneError(message: string | null): LoginPhoneState | null {
  if (!message) return null
  if (/不正确/.test(message)) return 'phone-code-invalid'
  if (/尝试次数过多|已锁定/.test(message)) return 'phone-code-locked'
  if (/过期|不存在/.test(message)) return 'phone-code-expired'
  if (/频繁|次数过多|上限|稍后再试|明天再试/.test(message) && !/发送失败/.test(message)) {
    return 'phone-send-limited'
  }
  if (/发送失败/.test(message)) return 'phone-send-failed'
  return null
}

export function derivePhoneGateState(input: {
  sendingCode: boolean
  submitting: boolean
  countdown: number
  notice: string | null
  error: string | null
  errorCode?: string | null
}): LoginPhoneState {
  if (input.sendingCode) return 'phone-sending'
  if (input.submitting) return 'phone-verifying'
  if (input.errorCode === 'LEGAL_DOCS_NOT_PUBLISHED') return 'phone-legal-unpublished'
  if (input.errorCode === 'SMS_CODE_LOCKED') return 'phone-code-locked'
  if (input.errorCode === 'SMS_CODE_EXPIRED') return 'phone-code-expired'
  if (input.errorCode === 'SMS_CODE_INVALID') return 'phone-code-invalid'
  if (input.errorCode === 'SMS_SEND_FAILED') return 'phone-send-failed'
  if (isSmsUnavailableCode(input.errorCode)) return 'phone-sms-unavailable'
  if (isSendLimitedCode(input.errorCode ?? null)) return 'phone-send-limited'
  const classified = classifyPhoneError(input.error)
  if (classified) return classified
  if (input.error) return input.countdown > 0 ? 'phone-code-invalid' : 'phone-send-failed'
  if (input.countdown > 0 || input.notice) return 'phone-code-sent'
  return 'phone-idle'
}

export function deriveQrGateState(input: {
  agreed: boolean
  loading: boolean
  claiming: boolean
  hasTicket: boolean
  displaySeconds: number | null
  errorStatus: number | null
  hasError: boolean
}): LoginQrState {
  if (input.claiming) return 'qr-confirmed'
  if (input.loading && !input.hasTicket) return 'qr-loading'
  if (!input.agreed && !input.hasTicket) return 'qr-loading'
  if (input.hasTicket && input.displaySeconds === 0) return 'qr-expired'
  if (input.hasError && !input.hasTicket) {
    if (input.errorStatus === 404 || input.errorStatus === 410) return 'qr-expired'
    return 'qr-error'
  }
  if (input.hasTicket) return 'qr-ready'
  return 'qr-loading'
}

export function loginGateModeOf(state: LoginGateState): LoginGateMode {
  return state.startsWith('qr-') ? 'qr' : 'phone'
}

export function resolveLoginReturnTo(
  fromState: unknown,
  queryFrom: string | null,
  isSafe: (path: string) => boolean,
): { returnTo: string; fromRejected: boolean } {
  if (fromState !== undefined) {
    return typeof fromState === 'string' && isSafe(fromState)
      ? { returnTo: fromState, fromRejected: false }
      : { returnTo: '/', fromRejected: true }
  }
  if (typeof queryFrom === 'string' && queryFrom !== '') {
    if (isSafe(queryFrom)) return { returnTo: queryFrom, fromRejected: false }
    return { returnTo: '/', fromRejected: true }
  }
  return { returnTo: '/', fromRejected: false }
}

export function loginReturnLabel(path: string): string {
  return path === '/' ? '首页' : '刚才的页面'
}

export const LOGIN_GATE_PILL: Record<LoginGateState, { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }> = {
  'phone-idle': { tone: 'unknown', label: '请选择登录方式' },
  'phone-sending': { tone: 'unknown', label: '正在发送' },
  'phone-code-sent': { tone: 'ok', label: '短信已发出' },
  'phone-send-limited': { tone: 'warn', label: '暂时无法发码' },
  'phone-send-failed': { tone: 'bad', label: '发送未完成' },
  'phone-verifying': { tone: 'unknown', label: '正在核对' },
  'phone-code-invalid': { tone: 'warn', label: '请核对短信' },
  'phone-code-expired': { tone: 'warn', label: '请获取新验证码' },
  'phone-code-locked': { tone: 'warn', label: '请重新验证' },
  'phone-legal-unpublished': { tone: 'warn', label: '暂时无法登录' },
  'phone-sms-unavailable': { tone: 'warn', label: '请改用扫码登录' },
  'qr-loading': { tone: 'unknown', label: '等待二维码' },
  'qr-ready': { tone: 'ok', label: '请在手机上确认' },
  'qr-expired': { tone: 'warn', label: '请重新扫码' },
  'qr-confirmed': { tone: 'unknown', label: '正在完成登录' },
  'qr-error': { tone: 'bad', label: '请尝试其他方式' },
}

export const LOGIN_GATE_COPY: Record<LoginGateState, { title: string; sub: string }> = {
  'phone-idle': { title: '登录后继续办理', sub: '登录成功后回到刚才那一页。不登录也能使用公开服务。' },
  'phone-sending': { title: '正在发送验证码', sub: '请稍候，收到发送结果后就可以继续。' },
  'phone-code-sent': { title: '填写短信验证码', sub: '请填写最新一条短信里的 6 位验证码。' },
  'phone-send-limited': { title: '暂时无法获取验证码', sub: '可以改用扫码登录，或按下方提示再试。' },
  'phone-send-failed': { title: '短信没发出去', sub: '旧码已作废，可以立刻重新获取。' },
  'phone-verifying': { title: '正在核验验证码', sub: '通过后会直接回到刚才的页面，请不要重复提交。' },
  'phone-code-invalid': { title: '请再核对一次验证码', sub: '已清空刚才填写的内容，手机号不用重填。' },
  'phone-code-expired': { title: '需要重新获取验证码', sub: '旧码已经不能使用，请重新获取一条。' },
  'phone-code-locked': { title: '验证码尝试次数过多', sub: '这条验证码已作废，请获取新码后再验证。' },
  'phone-legal-unpublished': { title: '暂时无法登录', sub: '用户协议和隐私政策还没有正式发布。不登录也能打印和扫描。' },
  'phone-sms-unavailable': { title: '短信验证码暂时发不出来', sub: '改用扫码登录。也可以不登录，继续使用公开服务。' },
  'qr-loading': { title: '扫码登录', sub: '勾选协议后即可获取二维码。' },
  'qr-ready': { title: '扫码登录', sub: '用手机扫码并确认，再回到这台机器继续办理。' },
  'qr-expired': { title: '二维码已过期', sub: '请在这台机器上重新生成，再用手机扫码。' },
  'qr-confirmed': { title: '手机已确认', sub: '正在完成登录，请等待页面跳转。' },
  'qr-error': { title: '扫码登录暂不可用', sub: '可以重新获取二维码，或改用手机号登录。' },
}

export const LOGIN_ANON_ENTRIES = [
  { id: 'print', title: '打印与扫描', desc: '文档、照片、扫描与格式转换。', route: '/print-scan' },
  { id: 'code', title: '到机码核销', desc: '手机上下过单，拿到机码来这台机器取。', route: '/print/pickup-claim' },
  { id: 'policy', title: '政策服务', desc: '就业、社保与登记指引，以官方核验为准。', route: '/policy-service' },
] as const

export function loginAnonEntries(): ReadonlyArray<{ id: string; title: string; desc: string; route: string }> {
  return LOGIN_ANON_ENTRIES
}

export const PHONE_DAILY_GATE_COPY = {
  title: '这个号码今天不能再收验证码',
  sub: '可以换一个手机号，或改用扫码登录。也可以不登录，继续使用公开服务。',
} as const

/** 四种发不出码的原因对用户不是同一句话。全站发完时不要说成「只是这台机器」。 */
export function smsUnavailableCopy(code: string | null | undefined): { title: string; sub: string } {
  if (code === 'SMS_TERMINAL_DAILY_LIMIT') {
    return {
      title: '这台机器今天的短信已经发完',
      sub: '改用扫码登录，不用再在这台机器上发短信。也可以不登录，继续使用公开服务。',
    }
  }
  if (code === 'SMS_DAILY_TOTAL_LIMIT') {
    return {
      title: '今天的短信验证码已经发完',
      sub: '今天再获取也不会发出。改用扫码登录，或先不登录，继续使用公开服务。',
    }
  }
  if (code === 'TERMINAL_SESSION_INVALID') {
    return {
      title: '这台机器现在发不了验证码',
      sub: '改用扫码登录。也可以不登录，继续使用公开服务。',
    }
  }
  return LOGIN_GATE_COPY['phone-sms-unavailable']
}

export function phoneSendSideLabel(input: {
  state: LoginPhoneState
  errorCode?: string | null
  countdown: number
  loading: boolean
}): string {
  if (input.state === 'phone-sms-unavailable' || isSmsUnavailableCode(input.errorCode)) return '暂时不能发'
  if (isPhoneDailySmsCode(input.errorCode)) return '今天不能再发'
  if (input.loading && input.countdown === 0) return '发送中'
  if (input.countdown > 0) return `${input.countdown} 秒后重发`
  if (input.state === 'phone-idle') return '获取验证码'
  return '重新获取'
}

export function sendLimitedPrimaryLabel(countdown: number): string {
  return countdown > 0 ? `${countdown} 秒后再获取` : '重新获取验证码'
}

/**
 * 号码刚输满时，发码钩子会把焦点拨到验证码。验证码还没发出，这一下要拨回来，
 * 否则键盘改口「短信验证码」，发码按钮被整页遮罩挡住。
 */
export function shouldKeepPhoneKeypadOnNumber(input: {
  codeOpen: boolean
  phoneComplete: boolean
  activeInput: 'phone' | 'code'
}): boolean {
  return !input.codeOpen && input.phoneComplete && input.activeInput === 'code'
}

export interface QrFetchGuard {
  refreshing: boolean
  generation: number
}

/** 已有一次取码在途，或还没勾选协议，就不再开下一次。 */
export function beginQrFetch(guard: QrFetchGuard, agreed: boolean): { guard: QrFetchGuard; generation: number } | null {
  if (guard.refreshing || !agreed) return null
  const generation = guard.generation + 1
  return { guard: { refreshing: true, generation }, generation }
}

/** 只有仍是这一次取码时才放开锁。被取消的那次不能把后一次的锁清掉。 */
export function finishQrFetch(guard: QrFetchGuard, generation: number): QrFetchGuard {
  if (guard.generation !== generation) return guard
  return { refreshing: false, generation: guard.generation }
}

/**
 * 面板卸下时调用。只把代数加一、不放开锁的话，下一次挂载会看见锁还在，
 * 停在「正在获取二维码」（开发构建里严格模式会把面板卸下再挂上）。
 */
export function cancelQrFetch(guard: QrFetchGuard): QrFetchGuard {
  return { refreshing: false, generation: guard.generation + 1 }
}
