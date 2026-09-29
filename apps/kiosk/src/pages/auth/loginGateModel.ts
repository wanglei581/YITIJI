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
