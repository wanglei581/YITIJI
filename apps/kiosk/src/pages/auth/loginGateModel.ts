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
])

export function isSendLimitedCode(code: string | null): boolean {
  return code !== null && SEND_LIMITED_CODES.has(code)
}

export function classifyPhoneError(message: string | null): LoginPhoneState | null {
  if (!message) return null
  if (/不正确/.test(message)) return 'phone-code-invalid'
  if (/过期|不存在|尝试次数过多/.test(message)) return 'phone-code-expired'
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
}): LoginPhoneState {
  if (input.sendingCode) return 'phone-sending'
  if (input.submitting) return 'phone-verifying'
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
  if (typeof fromState === 'string' && isSafe(fromState)) {
    return { returnTo: fromState, fromRejected: false }
  }
  if (typeof queryFrom === 'string' && queryFrom !== '') {
    if (isSafe(queryFrom)) return { returnTo: queryFrom, fromRejected: false }
    return { returnTo: '/', fromRejected: true }
  }
  return { returnTo: '/', fromRejected: false }
}

export function loginReturnLabel(path: string): string {
  return path === '/' ? '首页' : path
}

export const LOGIN_GATE_PILL: Record<LoginGateState, { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }> = {
  'phone-idle': { tone: 'unknown', label: '登录结果以服务端返回为准' },
  'phone-sending': { tone: 'unknown', label: '正在请求发送验证码' },
  'phone-code-sent': { tone: 'ok', label: '服务端回执：验证码已发出' },
  'phone-send-limited': { tone: 'warn', label: '发码被频率限制挡下' },
  'phone-send-failed': { tone: 'bad', label: '短信通道发送失败' },
  'phone-verifying': { tone: 'unknown', label: '验证码已提交，等待核验' },
  'phone-code-invalid': { tone: 'warn', label: '验证码不正确' },
  'phone-code-expired': { tone: 'warn', label: '验证码已失效' },
  'qr-loading': { tone: 'warn', label: '未勾协议 · 尚未申请票据' },
  'qr-ready': { tone: 'ok', label: '二维码有效期 180 秒' },
  'qr-expired': { tone: 'warn', label: '二维码已过期' },
  'qr-confirmed': { tone: 'ok', label: '手机已确认 · 尚未登录' },
  'qr-error': { tone: 'bad', label: '扫码登录暂不可用' },
}

export const LOGIN_GATE_COPY: Record<LoginGateState, { title: string; sub: string }> = {
  'phone-idle': { title: '登录后继续办理', sub: '登录成功后回到刚才那一页。不登录也能用公开与无需账户的服务。' },
  'phone-sending': { title: '正在发送验证码', sub: '结果由服务端返回。成功、频控、通道失败三种下一步不一样。' },
  'phone-code-sent': { title: '填写短信验证码', sub: '验证码有效期以服务端回执为准；重新获取要等冷却结束。' },
  'phone-send-limited': { title: '稍后再获取验证码', sub: '这一次请求什么都没有改变，本页读不到还要等多久。' },
  'phone-send-failed': { title: '短信没发出去', sub: '旧码已被一起作废，可以立刻重新获取。' },
  'phone-verifying': { title: '正在核验验证码', sub: '结果只由服务端决定；登录成功会直接回到你进来之前那一页。' },
  'phone-code-invalid': { title: '验证码不正确', sub: '可以核对最新一条再试；它仍受有效期和尝试次数限制。' },
  'phone-code-expired': { title: '需要重新获取验证码', sub: '服务端那边已经没有这条码，重填同一条只会再失败。' },
  'qr-loading': { title: '扫码登录', sub: '先勾协议，这台机器才会去要票据；拿到之前不显示任何可扫图形。' },
  'qr-ready': { title: '扫码登录', sub: '用手机扫码并在手机上确认；确认之后要回到这台机器。' },
  'qr-expired': { title: '二维码已过期', sub: '票据从生成起只活 180 秒，刷新动作在这台机器上。' },
  'qr-confirmed': { title: '手机已确认', sub: '这台机器正在换取登录态，换成功才算登录。' },
  'qr-error': { title: '扫码登录暂不可用', sub: '请求没有成功；手机号登录不经过这条链路。' },
}

export const LOGIN_ANON_ENTRIES = [
  { id: 'print', title: '打印与扫描', desc: '文档、照片、扫描与格式转换，进入后按真实能力状态继续。', route: '/print-scan' },
  { id: 'code', title: '到机码核销', desc: '手机上下过单，拿到机码直接来这台机器取。', route: '/print/pickup-claim' },
  { id: 'jobs', title: '岗位与招聘会', desc: '来源机构发布的信息，投递与预约都在来源平台自行完成。', route: '/jobs-service' },
] as const
