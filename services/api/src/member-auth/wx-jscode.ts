import { HttpException, HttpStatus } from '@nestjs/common'

export interface MiniappJsCodeSession {
  openid: string
  /** 只在调用方这次请求的内存里使用。不要落库、写日志或写审计。 */
  sessionKey: string | null
}

/**
 * 用 wx.login 的 code 换 openid 和 session_key。
 * 登录只取 openid；虚拟支付要在同一次请求里用 session_key 签名。
 */
export async function exchangeMiniappJsCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MiniappJsCodeSession> {
  const appid = process.env['WECHAT_MINIAPP_APPID']
  const secret = process.env['WECHAT_MINIAPP_APPSECRET']
  if (!appid || !secret) {
    throw new HttpException(
      { error: { code: 'WX_CONFIG_MISSING', message: '微信小程序登录暂不可用，请使用短信验证码登录' } },
      HttpStatus.SERVICE_UNAVAILABLE,
    )
  }
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${encodeURIComponent(appid)}` +
    `&secret=${encodeURIComponent(secret)}` +
    `&js_code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code`
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new HttpException(
      { error: { code: 'WX_CODE2SESSION_FAILED', message: '微信登录服务异常，请稍后再试' } },
      HttpStatus.BAD_GATEWAY,
    )
  }
  const data = (await res.json()) as { openid?: string; session_key?: string }
  if (!data.openid) {
    throw new HttpException(
      { error: { code: 'WX_CODE_INVALID', message: '微信登录凭证无效或已过期，请重试' } },
      HttpStatus.UNAUTHORIZED,
    )
  }
  return { openid: data.openid, sessionKey: data.session_key ?? null }
}
