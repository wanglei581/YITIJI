import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'

/**
 * 微信小程序码生成。
 *
 * 用途：一体机上的二维码应当**扫码直达小程序**，而不是打开网页 ——
 * 网页是第三个入口，会把用户从主入口踢出去、还丢掉小程序里的登录态
 * （产品负责人 2026-09-08：「整个项目操作和小程序都是相关联的」）。
 *
 * 微信侧约束（2026-09-08 对本项目 AppID 实测）：
 * - `getwxacodeunlimit` 生成的是**永久**小程序码，但**只对已发布版本有效**；
 *   未发布时返回 `errcode 41030 invalid page`（实测值，不是推测）。
 * - 因此 `env_version` 做成配置：`release`（已发布）/ `trial`（体验版，仅体验成员可扫）/
 *   `develop`（开发版）。发布前用 trial 验链路，发布后改环境变量即可对外，代码不动。
 * - access_token 有效期 7200 秒且**有调用频次限制**，必须缓存，不能每次请求都换。
 *
 * fail-closed：未配置、微信报错、或返回的不是图片时，一律抛出可读错误，
 * **绝不回落到网页链接** —— 那会让页面在"扫码进小程序"的承诺下悄悄给出网页，
 * 属于伪造能力（CLAUDE.md §9）。
 */

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token'
const CODE_URL = 'https://api.weixin.qq.com/wxa/getwxacodeunlimit'
const REQUEST_TIMEOUT_MS = 10_000
/** 比微信的 7200 秒提前 5 分钟过期，避免边界上用到刚失效的 token。 */
const TOKEN_SAFETY_MARGIN_MS = 5 * 60_000
/** 微信规定 scene 最长 32 个可见字符。 */
const SCENE_MAX_LENGTH = 32
const SCENE_PATTERN = /^[A-Za-z0-9!#$&'()*+,/:;=?@\-._~%]{1,32}$/

export type MiniappEnvVersion = 'release' | 'trial' | 'develop'

/** JPEG `FF D8 FF` / PNG `89 50 4E 47`。微信当前返回 JPEG，但未在文档里承诺，故两者都认。 */
function imageMime(body: Buffer): 'image/jpeg' | 'image/png' | null {
  if (body.length < 4) return null
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg'
  if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return 'image/png'
  return null
}


export interface MiniappCodeResult {
  /** 图片字节（实测为 JPEG；微信未承诺格式，调用方不应假设）。 */
  image: Buffer
  /** 实际 MIME，供调用方拼 data URI，不要写死。 */
  mimeType: 'image/jpeg' | 'image/png'
  envVersion: MiniappEnvVersion
}

@Injectable()
export class MiniappCodeService {
  private readonly logger = new Logger(MiniappCodeService.name)
  private cachedToken: { value: string; expiresAt: number } | null = null
  /** 并发请求共享同一次换取，避免同时打微信换 token 触发频控。 */
  private tokenInflight: Promise<string> | null = null

  /** 未配置时返回 false，调用方据此给出诚实的「未开放」而不是坏掉的二维码。 */
  isConfigured(): boolean {
    return Boolean(process.env['WECHAT_MINIAPP_APPID'] && process.env['WECHAT_MINIAPP_APPSECRET'])
  }

  envVersion(): MiniappEnvVersion {
    const raw = (process.env['WECHAT_MINIAPP_ENV_VERSION'] ?? 'release').trim()
    return raw === 'trial' || raw === 'develop' ? raw : 'release'
  }

  async generate(page: string, scene: string): Promise<MiniappCodeResult> {
    if (!this.isConfigured()) {
      throw new HttpException(
        { error: { code: 'MINIAPP_NOT_CONFIGURED', message: '小程序码暂未开放' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      )
    }
    if (!SCENE_PATTERN.test(scene) || scene.length > SCENE_MAX_LENGTH) {
      throw new HttpException(
        { error: { code: 'MINIAPP_SCENE_INVALID', message: 'scene 超出微信允许的长度或字符集' } },
        HttpStatus.BAD_REQUEST,
      )
    }

    const token = await this.accessToken()
    const envVersion = this.envVersion()
    const response = await this.postJson(`${CODE_URL}?access_token=${encodeURIComponent(token)}`, {
      scene,
      page,
      check_path: true,
      env_version: envVersion,
    })

    const body = Buffer.from(await response.arrayBuffer())
    // 微信成功时返回**图片字节流**，失败时返回 JSON —— 用魔数区分，不能只看 HTTP 状态码
    // （失败也是 HTTP 200，2026-09-08 实测 errcode 41030 就是 200 + JSON）。
    //
    // ⚠️ 实测该接口返回的是 **JPEG**（魔数 FF D8 FF），不是 PNG。
    // 本文件第一版按 PNG 魔数判定，会把每一次成功都当成失败 —— 那是照着假设写的判据，
    // 不是照着实测写的。微信文档未承诺格式，故两种都接受，并以「不是 JSON」为兜底。
    const mimeType = imageMime(body)
    if (mimeType) return { image: body, mimeType, envVersion }

    const { errcode } = this.parseWxError(body)
    // 只记错误码，不记 errmsg 里可能带的 rid 之外的内容，也不记任何凭据。
    this.logger.warn(`wxacode failed: errcode=${errcode} env=${envVersion}`)
    throw new HttpException(
      { error: { code: 'MINIAPP_CODE_FAILED', message: this.userMessage(errcode), wxErrcode: errcode } },
      HttpStatus.BAD_GATEWAY,
    )
  }

  /** 把微信错误码翻成运维看得懂的原因，而不是甩一个数字给用户。 */
  private userMessage(errcode: number | null): string {
    if (errcode === 41030) return '小程序尚未发布，当前无法生成对外可扫的小程序码'
    if (errcode === 40001 || errcode === 40013) return '小程序凭据无效，请检查 AppID 与密钥'
    if (errcode === 45009) return '小程序码接口调用已达上限，请稍后再试'
    return '小程序码生成失败，请稍后再试'
  }

  /**
   * 只取 errcode。微信的 errmsg 里带 rid（请求追踪号）等上游标识，
   * 对用户没有意义，也不应进日志或响应体 —— 故意不返回它。
   */
  private parseWxError(body: Buffer): { errcode: number | null } {
    try {
      const parsed = JSON.parse(body.toString('utf8')) as { errcode?: number }
      return { errcode: typeof parsed.errcode === 'number' ? parsed.errcode : null }
    } catch {
      return { errcode: null }
    }
  }

  private async accessToken(): Promise<string> {
    const cached = this.cachedToken
    if (cached && cached.expiresAt > Date.now()) return cached.value
    if (this.tokenInflight) return this.tokenInflight
    this.tokenInflight = this.fetchToken().finally(() => { this.tokenInflight = null })
    return this.tokenInflight
  }

  private async fetchToken(): Promise<string> {
    const appid = process.env['WECHAT_MINIAPP_APPID'] ?? ''
    const secret = process.env['WECHAT_MINIAPP_APPSECRET'] ?? ''
    const url =
      `${TOKEN_URL}?grant_type=client_credential` +
      `&appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}`
    const response = await this.fetchWithTimeout(url, { method: 'GET' })
    const data = (await response.json()) as { access_token?: string; expires_in?: number; errcode?: number }
    if (!data.access_token) {
      this.logger.warn(`wx token failed: errcode=${data.errcode ?? 'unknown'}`)
      throw new HttpException(
        { error: { code: 'MINIAPP_TOKEN_FAILED', message: '小程序凭据校验失败' } },
        HttpStatus.BAD_GATEWAY,
      )
    }
    const ttlMs = Math.max(0, (data.expires_in ?? 7200) * 1000 - TOKEN_SAFETY_MARGIN_MS)
    this.cachedToken = { value: data.access_token, expiresAt: Date.now() + ttlMs }
    return data.access_token
  }

  private async postJson(url: string, payload: unknown): Promise<Response> {
    return this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } catch {
      throw new HttpException(
        { error: { code: 'MINIAPP_UPSTREAM_UNREACHABLE', message: '微信接口暂时不可达，请稍后再试' } },
        HttpStatus.BAD_GATEWAY,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
