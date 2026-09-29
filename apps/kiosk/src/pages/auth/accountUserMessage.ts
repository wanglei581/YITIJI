import { LEGAL_DOCS_NOT_PUBLISHED_COPY, MemberApiError, resolveMemberApiErrorMessage } from '../../services/auth/memberAuthApi'
import { maskEmail, maskPhone } from '../../utils/maskPii'

const CODE_COPY: Readonly<Record<string, string>> = {
  STEP_UP_SEND_TOO_FREQUENT: '获取验证码太频繁，请稍后再试。',
  STEP_UP_RATE_LIMITED: '验证请求较多，请稍后再试。',
  STEP_UP_CHALLENGE_INVALID: '旧号验证码已失效，请重新获取。',
  STEP_UP_TOKEN_INVALID: '旧手机号验证已过期，请重新验证旧手机号。',
  STEP_UP_CODE_INVALID: '验证码不正确，请核对短信后再试。',
  SMS_SEND_FAILED: '短信发送失败，可以立刻重新获取验证码。',
  SMS_TOO_FREQUENT: '获取验证码太频繁，请稍后再试。',
  SMS_RATE_LIMITED: '短信发送较频繁，请稍后再试。',
  SMS_IP_LIMIT: '当前网络获取验证码较多，请稍后再试。',
  SMS_DEVICE_LIMIT: '这台机器获取验证码较多，请稍后再试。',
  SMS_PROVIDER_RATE_LIMIT: '短信发送较频繁，请稍后再试。',
  PROVIDER_RATE_LIMIT: '短信发送较频繁，请稍后再试。',
  SMS_DAILY_LIMIT: '这个号码今天的验证码次数已用完，请明天再试。',
  SMS_PROVIDER_PHONE_DAILY_LIMIT: '这个号码今天的验证码次数已用完，请明天再试。',
  PROVIDER_PHONE_DAILY_LIMIT: '这个号码今天的验证码次数已用完，请明天再试。',
  SMS_CODE_INVALID: '验证码不正确，请核对最新一条短信后再试。',
  SMS_CODE_EXPIRED: '验证码已过期，请重新获取。',
  SMS_CODE_LOCKED: '验证码尝试次数过多，已作废，请重新获取。',
  REBIND_CODE_INVALID: '新手机验证码不正确，请核对短信。',
  REBIND_CODE_EXPIRED: '新手机验证码已过期，请重新获取。',
  REBIND_CODE_LOCKED: '新手机验证码尝试次数过多，请重新获取。',
  PHONE_CONFLICT: '该手机号已绑定其他账号，无法换绑。',
  // 2026-09-29 后端排雷新增（谁新增的码谁补文案；覆盖门禁 verify:backend-error-copy-coverage）
  REBIND_UNAVAILABLE: '暂时无法换绑，手机号没有改动。请稍后从验证旧手机号重新开始。',
  ACCOUNT_UNAVAILABLE: '账号当前不可用，请联系现场工作人员。',
  SMS_DAILY_TOTAL_LIMIT: '今天的短信验证码已发满，请明天再试，或用手机扫码登录。',
  SMS_TERMINAL_DAILY_LIMIT: '这台机器今天的短信验证码已发满，请用手机扫码登录，或明天再试。',
  SMS_BUDGET_UNAVAILABLE: '验证码服务暂时不可用，请稍后再试，或用手机扫码登录。',
}

/** 保留业务提示原意；仅空值、工程词和原始错误串退回本步文案。 */
export function accountDisplayMessage(message: string | null | undefined, fallback: string): string {
  const value = message?.trim()
  if (!value || /服务端|服务器|后端|前台|后台|字段|引擎|能力探测|会话|回执|真机|未验收|pending|uploaded|终端编号|内部文件号|票据|登录态|挑战|凭证|网桥|堆栈|SQL|HTTP|[A-Z][A-Z0-9]*_[A-Z_]+|\/api\/|Error:|请求失败（\d+）/i.test(value)) return fallback
  if (!/[\u4e00-\u9fff]/.test(value)) return fallback
  return value.replace(/1\d{10}/g, maskPhone).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, maskEmail)
}

export function accountErrorMessage(error: unknown, fallback: string): string {
  // 协议未发布：一体机自己查出来的与服务端拒绝的，统一说同一句话，并告诉用户不登录能做什么。
  if (error instanceof MemberApiError && error.code === 'LEGAL_DOCS_NOT_PUBLISHED') return LEGAL_DOCS_NOT_PUBLISHED_COPY
  const recovery = error instanceof MemberApiError ? CODE_COPY[error.code] ?? fallback : fallback
  return accountDisplayMessage(error instanceof Error ? error.message : resolveMemberApiErrorMessage(error, recovery), recovery)
}

/** 接口已经给出掩码号码（前三后四）就原样用；异常返回的完整号码在这里掩码。 */
export function accountPhoneDisplay(raw: string): string {
  return /^\d{3}\*{4}\d{4}$/.test(raw.trim()) ? raw.trim() : maskPhone(raw)
}

/** 换绑先消费一次性旧号验证；已知拒绝从旧号重来，丢失结果则先重新登录核对。 */
export function phoneRebindRecovery(error: unknown): 'restart' | 'relogin' {
  if (!(error instanceof MemberApiError)) return 'relogin'
  // REBIND_UNAVAILABLE（503）：没能先清掉旧登录，整单没改手机号；旧号验证与新号验证码都已用掉，
  // 登录本身仍有效——从旧号重来，而不是让人重新登录。
  if (error.code === 'REBIND_UNAVAILABLE') return 'restart'
  return error.status >= 400 && error.status < 500
    && ['STEP_UP_TOKEN_INVALID', 'REBIND_CODE_INVALID', 'REBIND_CODE_EXPIRED', 'REBIND_CODE_LOCKED', 'PHONE_CONFLICT'].includes(error.code)
    ? 'restart' : 'relogin'
}
