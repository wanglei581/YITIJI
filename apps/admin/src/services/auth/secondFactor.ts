/**
 * 管理员登录第二步（短信验证码）的响应形状与错误归类（P1-4，2026-09-29）。
 *
 * 服务端开关 `ADMIN_LOGIN_SECOND_FACTOR=sms` 打开后，`POST /auth/login`（portal=admin）
 * 密码通过时不再直接给登录凭证，而是返回一张一次性的「第二步凭证」：
 *   { secondFactorRequired: true, challengeTicket, phoneMasked, codeSent, cooldownSeconds, expiresInSeconds }
 * 前端拿验证码与凭证调 `POST /auth/login/second-factor` 换登录凭证，
 * 重发走 `POST /auth/login/second-factor/resend`。开关关着时这里的代码不会被走到。
 *
 * 本文件只放纯函数（不发请求、不读写本地存储），发请求的两个函数在 ./index.ts。
 */

export interface AdminSecondFactorChallenge {
  secondFactorRequired: true
  challengeTicket: string
  phoneMasked: string
  /** false：60 秒内刚给这个号码发过验证码，这次没有新发；倒计时结束后可点「重新发送」。 */
  codeSent: boolean
  cooldownSeconds: number
  expiresInSeconds: number
}

const MASKED_PHONE_PATTERN = /^1[3-9]\d\*{4}\d{4}$/

function isBoundedSeconds(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

export function isAdminSecondFactorChallenge(data: unknown): data is AdminSecondFactorChallenge {
  if (!data || typeof data !== 'object') return false
  const c = data as Record<string, unknown>
  return c.secondFactorRequired === true
    && typeof c.challengeTicket === 'string'
    && c.challengeTicket.length >= 10
    && c.challengeTicket.length <= 160
    && c.challengeTicket.includes('.')
    && typeof c.phoneMasked === 'string'
    && (MASKED_PHONE_PATTERN.test(c.phoneMasked) || c.phoneMasked === '***')
    && typeof c.codeSent === 'boolean'
    && isBoundedSeconds(c.cooldownSeconds, 300)
    && isBoundedSeconds(c.expiresInSeconds, 900)
    && c.expiresInSeconds > 0
}

export function isResendResponse(data: unknown): data is { codeSent: boolean; cooldownSeconds: number } {
  if (!data || typeof data !== 'object') return false
  const c = data as Record<string, unknown>
  return typeof c.codeSent === 'boolean' && isBoundedSeconds(c.cooldownSeconds, 300)
}

/**
 * 第二步失败后页面怎么走：
 * - `retry`：留在第二步，改验证码或重新发送即可（验证码错、过期、错太多次被锁、发送失败）；
 * - `restart`：凭证已作废或开关已关，必须回到账号密码重新来；
 * - `blocked`：账号或网络条件不满足，回到账号密码并如实说明（没绑手机、不在允许的网络）。
 */
export type SecondFactorFailureAction = 'retry' | 'restart' | 'blocked'

const RESTART_CODES = new Set([
  'AUTH_SECOND_FACTOR_CHALLENGE_INVALID',
  'AUTH_SECOND_FACTOR_DISABLED',
])

const BLOCKED_CODES = new Set([
  'AUTH_SECOND_FACTOR_NOT_ENROLLED',
  'AUTH_ADMIN_IP_FORBIDDEN',
  'AUTH_ADMIN_IP_CONFIG_INVALID',
  'AUTH_PORTAL_FORBIDDEN',
  'AUTH_RESPONSE_INVALID',
])

export function secondFactorFailureAction(code: string): SecondFactorFailureAction {
  if (RESTART_CODES.has(code)) return 'restart'
  if (BLOCKED_CODES.has(code)) return 'blocked'
  return 'retry'
}

/** 服务端文案缺失时的兜底；服务端给了中文 message 就用服务端的。 */
export function secondFactorFallbackMessage(code: string): string {
  switch (code) {
    case 'SMS_CODE_INVALID': return '验证码不正确，请核对后重新输入'
    case 'SMS_CODE_EXPIRED': return '验证码已过期，请点「重新发送」获取新的验证码'
    case 'SMS_CODE_LOCKED': return '验证码错误次数过多，请稍后重新发送验证码'
    case 'SMS_TOO_FREQUENT': return '发送太频繁，请稍后再试'
    case 'SMS_SEND_FAILED': return '短信发送失败，请稍后重新发送'
    case 'AUTH_SECOND_FACTOR_CHALLENGE_INVALID': return '第二步验证已过期或无效，请重新输入账号密码'
    case 'AUTH_SECOND_FACTOR_DISABLED': return '当前未开启短信第二步验证，请直接用账号密码登录'
    case 'AUTH_SECOND_FACTOR_NOT_ENROLLED': return '该管理员账号还没有绑定并验证手机号，请联系系统维护人员处理'
    case 'AUTH_ADMIN_IP_FORBIDDEN': return '当前网络不在管理员允许的访问地址范围内，请在指定网络下使用管理后台'
    case 'AUTH_ADMIN_IP_CONFIG_INVALID': return '管理员访问地址名单配置有误，请联系系统维护人员修正'
    case 'NETWORK_ERROR': return '网络连接异常，请检查网络后重试'
    default: return '验证失败，请稍后重试'
  }
}
