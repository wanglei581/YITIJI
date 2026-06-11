import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { createHash, createHmac } from 'crypto'

// ============================================================
// 2C+ 语音转写（ASR）服务：provider 架构（对齐 OCR 范式）。
//
//   ASR_PROVIDER=disabled（默认）：诚实返回 ASR_NOT_CONFIGURED，前端自动回退文字输入。
//   ASR_PROVIDER=tencent（推荐，与数字人/TRTC 同生态）：腾讯云「一句话识别」
//     SentenceRecognition（≤60s，16k_zh），TC3-HMAC-SHA256 签名全部在服务端；
//     复用 TRTC 对话式 AI 的云 API 密钥 TENCENT_SECRET_ID / TENCENT_SECRET_KEY
//     （可用 TENCENT_ASR_SECRET_ID / TENCENT_ASR_SECRET_KEY 单独覆盖）。
//   ASR_PROVIDER=baidu：百度智能云短语音识别（标准版 vop.baidu.com，dev_pid=1537）。
//     ★ 需在百度控制台开通「语音技术-短语音识别」；密钥独立于 OCR：
//       BAIDU_ASR_API_KEY / BAIDU_ASR_SECRET_KEY（仅服务端）。
//
// 隐私（2C+ 硬约束）：
// - 音频 buffer 只在内存中转发给识别接口，不落盘、不入 FileObject、不写日志。
// - 转写文本不写日志（只记元数据：耗时/时长/字符数）。
// - 本服务无任何持久化；转写文本由调用方（用户确认后）落 Turn。
// ============================================================

export interface AsrResult {
  ok: boolean
  text?: string
  errorCode?: 'ASR_NOT_CONFIGURED' | 'ASR_FAILED'
  errorMessage?: string
}

/** 单段回答音频上限：60s 16k16bit 单声道 WAV ≈ 1.9MB，留余量取 4MB（百度限 60s）。 */
export const ASR_MAX_AUDIO_BYTES = 4 * 1024 * 1024

const TOKEN_ERROR_CODES = new Set([3302]) // 鉴权失败（含 scope 无语音权限）

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? n : fallback
}

@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name)
  private token: { value: string; expiresAtMs: number } | null = null
  private tokenInflight: Promise<string> | null = null

  private get providerName(): string {
    return (process.env['ASR_PROVIDER'] ?? 'disabled').trim().toLowerCase()
  }

  private get baseUrl(): string {
    return (process.env['BAIDU_ASR_BASE_URL'] ?? 'https://aip.baidubce.com').replace(/\/$/, '')
  }

  private get vopUrl(): string {
    return (process.env['BAIDU_ASR_VOP_URL'] ?? 'https://vop.baidu.com/server_api').replace(/\/$/, '')
  }

  private get timeoutMs(): number {
    return intEnv('BAIDU_ASR_TIMEOUT_MS', 20_000)
  }

  private get tencentSecretId(): string | undefined {
    return process.env['TENCENT_ASR_SECRET_ID'] || process.env['TENCENT_SECRET_ID']
  }

  private get tencentSecretKey(): string | undefined {
    return process.env['TENCENT_ASR_SECRET_KEY'] || process.env['TENCENT_SECRET_KEY']
  }

  get enabled(): boolean {
    if (this.providerName === 'tencent') return !!this.tencentSecretId && !!this.tencentSecretKey
    return this.providerName === 'baidu' && !!process.env['BAIDU_ASR_API_KEY'] && !!process.env['BAIDU_ASR_SECRET_KEY']
  }

  /** 识别一段 16k 单声道 WAV。失败诚实返回，绝不编造文本。 */
  async recognizeWav(buffer: Buffer): Promise<AsrResult> {
    if (this.providerName === 'tencent') return this.recognizeTencent(buffer)
    if (this.providerName !== 'baidu') {
      return { ok: false, errorCode: 'ASR_NOT_CONFIGURED', errorMessage: '语音转写未启用，请使用文字输入' }
    }
    const apiKey = process.env['BAIDU_ASR_API_KEY']
    const secretKey = process.env['BAIDU_ASR_SECRET_KEY']
    if (!apiKey || !secretKey) {
      return { ok: false, errorCode: 'ASR_NOT_CONFIGURED', errorMessage: '语音转写凭证未配置，请使用文字输入' }
    }
    if (!buffer || buffer.length === 0) {
      return { ok: false, errorCode: 'ASR_FAILED', errorMessage: '没有录到声音，请重试或改用文字输入' }
    }
    if (buffer.length > ASR_MAX_AUDIO_BYTES) {
      return { ok: false, errorCode: 'ASR_FAILED', errorMessage: '单段回答音频过长，请分段回答或改用文字输入' }
    }

    const t0 = Date.now()
    let result = await this.callVop(buffer, apiKey, secretKey)
    if (!result.ok && result.tokenError) {
      this.token = null
      result = await this.callVop(buffer, apiKey, secretKey)
    }
    if (!result.ok) {
      this.logMeta('asr.fail', { ms: Date.now() - t0, errNo: result.errNo ?? 'network' })
      return { ok: false, errorCode: 'ASR_FAILED', errorMessage: result.message }
    }
    this.logMeta('asr.ok', { ms: Date.now() - t0, chars: result.text.length, bytes: buffer.length })
    return { ok: true, text: result.text }
  }

  // ── 腾讯云一句话识别（SentenceRecognition，TC3 签名服务端实现）──────────────

  private async recognizeTencent(buffer: Buffer): Promise<AsrResult> {
    const secretId = this.tencentSecretId
    const secretKey = this.tencentSecretKey
    if (!secretId || !secretKey) {
      return { ok: false, errorCode: 'ASR_NOT_CONFIGURED', errorMessage: '语音转写凭证未配置，请使用文字输入' }
    }
    if (!buffer || buffer.length === 0) {
      return { ok: false, errorCode: 'ASR_FAILED', errorMessage: '没有录到声音，请重试或改用文字输入' }
    }
    if (buffer.length > ASR_MAX_AUDIO_BYTES) {
      return { ok: false, errorCode: 'ASR_FAILED', errorMessage: '单段回答音频过长，请分段回答或改用文字输入' }
    }
    const t0 = Date.now()
    const host = process.env['TENCENT_ASR_HOST'] ?? 'asr.tencentcloudapi.com'
    const insecure = host.startsWith('127.0.0.1') || host.startsWith('localhost') // verify stub 用
    const payload = JSON.stringify({
      EngSerViceType: '16k_zh',
      SourceType: 1,
      VoiceFormat: 'wav',
      Data: buffer.toString('base64'),
      DataLen: buffer.length,
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const ts = Math.floor(Date.now() / 1000)
      const res = await fetch(`${insecure ? 'http' : 'https'}://${host}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.tc3Sign({ host: host.split(':')[0], service: 'asr', payload, ts, secretId, secretKey }),
          'X-TC-Action': 'SentenceRecognition',
          'X-TC-Version': '2019-06-14',
          'X-TC-Timestamp': String(ts),
        },
        body: payload,
        signal: controller.signal,
      })
      const body = (await res.json()) as { Response?: { Result?: string; Error?: { Code?: string; Message?: string } } }
      const err = body.Response?.Error
      if (err) {
        this.logMeta('asr.fail', { ms: Date.now() - t0, code: err.Code ?? 'unknown' })
        const msg = err.Code?.startsWith('AuthFailure')
          ? '语音转写服务鉴权失败，请改用文字输入'
          : '语音转写失败，请重试或改用文字输入'
        return { ok: false, errorCode: 'ASR_FAILED', errorMessage: msg }
      }
      const text = (body.Response?.Result ?? '').trim()
      if (!text) {
        return { ok: false, errorCode: 'ASR_FAILED', errorMessage: '没有识别到有效内容，请重试或改用文字输入' }
      }
      this.logMeta('asr.ok', { ms: Date.now() - t0, chars: text.length, bytes: buffer.length })
      return { ok: true, text }
    } catch (e) {
      this.logMeta('asr.fail', { ms: Date.now() - t0, code: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network' })
      return {
        ok: false,
        errorCode: 'ASR_FAILED',
        errorMessage: e instanceof Error && e.name === 'AbortError'
          ? '语音转写超时，请重试或改用文字输入'
          : '语音转写服务暂不可用，请改用文字输入',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** TC3-HMAC-SHA256 签名（仅服务端；密钥绝不进前端/日志）。 */
  private tc3Sign(args: { host: string; service: string; payload: string; ts: number; secretId: string; secretKey: string }): string {
    const hashHex = (d: string) => createHash('sha256').update(d).digest('hex')
    const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest()
    const date = new Date(args.ts * 1000).toISOString().slice(0, 10)
    const canonical = ['POST', '/', '', `content-type:application/json\nhost:${args.host}\n`, 'content-type;host', hashHex(args.payload)].join('\n')
    const scope = `${date}/${args.service}/tc3_request`
    const toSign = ['TC3-HMAC-SHA256', args.ts, scope, hashHex(canonical)].join('\n')
    const signature = createHmac('sha256', hmac(hmac(hmac(`TC3${args.secretKey}`, date), args.service), 'tc3_request')).update(toSign).digest('hex')
    return `TC3-HMAC-SHA256 Credential=${args.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`
  }

  // ── 百度短语音识别 ────────────────────────────────────────────────────────

  private async callVop(
    buffer: Buffer,
    apiKey: string,
    secretKey: string,
  ): Promise<{ ok: true; text: string } | { ok: false; message: string; tokenError?: boolean; errNo?: number }> {
    let token: string
    try {
      token = await this.getToken(apiKey, secretKey)
    } catch {
      return { ok: false, message: '语音转写服务鉴权失败，请改用文字输入' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(this.vopUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'wav',
          rate: 16000,
          channel: 1,
          cuid: 'ai-job-print-kiosk',
          token,
          dev_pid: 1537, // 普通话(纯中文识别)
          speech: buffer.toString('base64'),
          len: buffer.length,
        }),
        signal: controller.signal,
      })
      const body = (await res.json()) as { err_no?: number; err_msg?: string; result?: string[] }
      if (body.err_no !== undefined && body.err_no !== 0) {
        if (TOKEN_ERROR_CODES.has(body.err_no)) {
          return { ok: false, message: '语音转写凭证无效', tokenError: true, errNo: body.err_no }
        }
        // 3301=音质差 3303=服务端忙 3304/3305=限流
        const msg = body.err_no === 3301
          ? '没有听清，请靠近麦克风重试，或改用文字输入'
          : '语音转写失败，请重试或改用文字输入'
        return { ok: false, message: msg, errNo: body.err_no }
      }
      const text = (body.result ?? []).join('').trim()
      if (!text) {
        return { ok: false, message: '没有识别到有效内容，请重试或改用文字输入', errNo: 0 }
      }
      return { ok: true, text }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error && err.name === 'AbortError'
          ? '语音转写超时，请重试或改用文字输入'
          : '语音转写服务暂不可用，请改用文字输入',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 换取 access_token（30 天，提前 1 天刷新，单飞）。 */
  private async getToken(apiKey: string, secretKey: string): Promise<string> {
    const now = Date.now()
    if (this.token && this.token.expiresAtMs > now) return this.token.value
    if (this.tokenInflight) return this.tokenInflight
    this.tokenInflight = (async () => {
      try {
        const url =
          `${this.baseUrl}/oauth/2.0/token?grant_type=client_credentials` +
          `&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`
        const res = await fetch(url, { method: 'POST' })
        const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
        if (!body.access_token) {
          this.logMeta('asr.token_fail', { error: body.error ?? 'unknown' })
          throw new InternalServerErrorException('ASR token failed')
        }
        this.token = { value: body.access_token, expiresAtMs: now + ((body.expires_in ?? 2_592_000) * 1000) - 86_400_000 }
        return body.access_token
      } finally {
        this.tokenInflight = null
      }
    })()
    return this.tokenInflight
  }

  /** 只记元数据：耗时/字节/字符数/错误码。绝不记音频、token、转写文本。 */
  private logMeta(event: string, meta: Record<string, unknown>): void {
    this.logger.log(`${event} ${JSON.stringify(meta)}`)
  }
}
