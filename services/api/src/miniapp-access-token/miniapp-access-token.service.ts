import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { RedisService } from '../common/redis/redis.service'

/** 比微信 7200 秒提前 100 秒过期，避免边界上用到刚失效的凭证。 */
export const MINIAPP_ACCESS_TOKEN_TTL_SECONDS = 7100

/**
 * 全进程只有这一处换小程序 access_token。
 * 稳定版凭证接口，Redis 缓存，并发换取共享同一次请求。核对表 3.21、补充规则 19。
 */
@Injectable()
export class MiniappAccessTokenService {
  private inflight: Promise<string> | null = null

  constructor(private readonly redis: RedisService) {}

  async getAccessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
    const appid = process.env['WECHAT_MINIAPP_APPID']?.trim() ?? ''
    const secret = process.env['WECHAT_MINIAPP_APPSECRET']?.trim() ?? ''
    if (!appid || !secret) {
      throw new HttpException(
        { error: { code: 'WX_CONFIG_MISSING', message: '微信小程序登录暂不可用，请使用短信验证码登录' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      )
    }
    const cacheKey = `wx:miniapp:access_token:${appid}`
    const cached = await this.redis.get(cacheKey)
    if (cached) return cached
    if (this.inflight) return this.inflight
    this.inflight = this.fetchToken(appid, secret, cacheKey, fetchImpl).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async fetchToken(appid: string, secret: string, cacheKey: string, fetchImpl: typeof fetch): Promise<string> {
    const response = await fetchImpl('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid, secret }),
    })
    if (!response.ok) {
      throw new HttpException(
        { error: { code: 'WX_TOKEN_FAILED', message: '微信服务暂不可用，请稍后再试' } },
        HttpStatus.BAD_GATEWAY,
      )
    }
    const data = (await response.json()) as { access_token?: string }
    if (!data.access_token) {
      throw new HttpException(
        { error: { code: 'WX_TOKEN_FAILED', message: '微信服务暂不可用，请稍后再试' } },
        HttpStatus.BAD_GATEWAY,
      )
    }
    await this.redis.setEx(cacheKey, MINIAPP_ACCESS_TOKEN_TTL_SECONDS, data.access_token)
    return data.access_token
  }
}
