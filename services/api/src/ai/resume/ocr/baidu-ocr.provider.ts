import { Injectable, Logger } from '@nestjs/common'
import type { OcrInput, OcrProvider, OcrProviderName, OcrResult } from './ocr-provider.interface'

// ============================================================
// 百度智能云 OCR provider（Stage 3 真实 OCR）。
//
// 鉴权：API Key + Secret Key 换 access_token（约 30 天），内存缓存 + 提前刷新 +
// 单飞（并发只发一次换取请求）；token 失效错误码（100/110/111）自动作废缓存重试一次。
//
// 合规与安全（CLAUDE.md §11/§12 + Stage 3 约束）：
// - 密钥只读 env，绝不进前端 / 日志 / 仓库；access_token 同样不写日志。
// - 图片 buffer 只在内存中转发给百度接口，不落盘、不写日志、不进审计。
// - 识别文本绝不写日志，只记元数据（行数 / 耗时 / 错误码）。
// - 失败诚实返回 OCR_FAILED / OCR_NOT_CONFIGURED，绝不返回假文本。
//
// 限制（防滥用 / 控费）：
// - 图片大小上限 BAIDU_OCR_MAX_IMAGE_BYTES（默认 6MB，base64 后约 8MB，
//   低于百度 10MB 接口上限留余量）。
// - 单请求超时 BAIDU_OCR_TIMEOUT_MS（默认 15s，AbortController 真实中断）。
// - 并发上限 BAIDU_OCR_MAX_CONCURRENCY（默认 2，对齐免费档 QPS≈2）+
//   等待队列上限（默认并发×10），超出直接诚实失败「系统繁忙」。
// ============================================================

/** 百度 OCR REST 响应（只取用到的字段；其余字段一律忽略，不透传）。 */
interface BaiduOcrResponse {
  error_code?: number
  error_msg?: string
  words_result_num?: number
  words_result?: Array<{
    words?: string
    probability?: { average?: number; min?: number; variance?: number }
  }>
}

interface BaiduTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

/** token 失效类错误码（作废缓存重试一次）。 */
const TOKEN_ERROR_CODES = new Set([100, 110, 111])
/** 额度 / 限流类错误码（诚实失败，提示稍后再试）。 */
const QUOTA_ERROR_CODES = new Set([4, 17, 18, 19])
/** 图片本身问题（格式/大小/空图），提示换文件。 */
const IMAGE_ERROR_CODES = new Set([216200, 216201, 216202, 216203])

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? n : fallback
}

@Injectable()
export class BaiduOcrProvider implements OcrProvider {
  readonly name: OcrProviderName = 'baidu'
  private readonly logger = new Logger(BaiduOcrProvider.name)

  // token 缓存（含单飞 promise，防并发重复换取）
  private token: { value: string; expiresAtMs: number } | null = null
  private tokenInflight: Promise<string> | null = null

  // 简易并发闸：active 计数 + FIFO 等待队列（上限内排队，超出诚实拒绝）
  private active = 0
  private readonly waitQueue: Array<() => void> = []

  private get baseUrl(): string {
    // 可覆写指向本地 stub（verify 离线测试用）；生产默认官方端点。
    return (process.env['BAIDU_OCR_BASE_URL'] ?? 'https://aip.baidubce.com').replace(/\/$/, '')
  }

  private get maxImageBytes(): number {
    return intEnv('BAIDU_OCR_MAX_IMAGE_BYTES', 6 * 1024 * 1024)
  }

  private get timeoutMs(): number {
    return intEnv('BAIDU_OCR_TIMEOUT_MS', 15_000)
  }

  private get maxConcurrency(): number {
    return intEnv('BAIDU_OCR_MAX_CONCURRENCY', 2)
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    const apiKey = process.env['BAIDU_OCR_API_KEY']
    const secretKey = process.env['BAIDU_OCR_SECRET_KEY']
    if (!apiKey || !secretKey) {
      return {
        ok: false,
        errorCode: 'OCR_NOT_CONFIGURED',
        errorMessage: '文字识别服务未配置，请上传带文字层的 PDF 或 DOCX',
      }
    }
    if (!input.buffer || input.buffer.length === 0) {
      return { ok: false, errorCode: 'OCR_FAILED', errorMessage: '图片内容为空，无法识别' }
    }
    if (input.buffer.length > this.maxImageBytes) {
      const mb = Math.floor(this.maxImageBytes / 1024 / 1024)
      return {
        ok: false,
        errorCode: 'OCR_FAILED',
        errorMessage: `图片超过 ${mb}MB 识别上限，请压缩后重试`,
      }
    }

    // 并发闸（含排队上限）
    const slot = await this.acquireSlot()
    if (!slot) {
      return { ok: false, errorCode: 'OCR_FAILED', errorMessage: '识别服务繁忙，请稍后重试' }
    }
    const t0 = Date.now()
    try {
      let result = await this.callOcr(input.buffer, apiKey, secretKey)
      // token 失效：作废缓存，整体重试一次
      if (!result.ok && result.tokenError) {
        this.token = null
        result = await this.callOcr(input.buffer, apiKey, secretKey)
      }
      if (!result.ok) {
        this.logMeta('ocr.fail', { ms: Date.now() - t0, errorCode: result.baiduCode ?? 'network' })
        return { ok: false, errorCode: 'OCR_FAILED', errorMessage: result.message }
      }
      this.logMeta('ocr.ok', {
        ms: Date.now() - t0,
        lines: result.lines,
        confidence: result.confidence,
      })
      return { ok: true, text: result.text, confidence: result.confidence }
    } finally {
      this.releaseSlot()
    }
  }

  // ── 百度接口调用 ──────────────────────────────────────────────────────────

  private async callOcr(
    buffer: Buffer,
    apiKey: string,
    secretKey: string,
  ): Promise<
    | { ok: true; text: string; confidence: 'high' | 'medium' | 'low'; lines: number }
    | { ok: false; message: string; tokenError?: boolean; baiduCode?: number }
  > {
    let token: string
    try {
      token = await this.getToken(apiKey, secretKey)
    } catch (err) {
      return {
        ok: false,
        message: '文字识别服务鉴权失败，请稍后重试',
        baiduCode: -1,
        // 换 token 本身失败不算 token 缓存失效（缓存为空才会走到这）
        ...(this.isAbort(err) ? { message: '文字识别服务超时，请稍后重试' } : {}),
      }
    }

    let res: Response
    let body: BaiduOcrResponse
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      res = await fetch(
        `${this.baseUrl}/rest/2.0/ocr/v1/accurate_basic?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ image: buffer.toString('base64'), probability: 'true' }),
          signal: controller.signal,
        },
      )
      body = (await res.json()) as BaiduOcrResponse
    } catch (err) {
      return {
        ok: false,
        message: this.isAbort(err)
          ? '文字识别超时，请稍后重试或上传更清晰的文件'
          : '文字识别服务暂不可用，请稍后重试',
      }
    } finally {
      clearTimeout(timer)
    }

    if (body.error_code !== undefined) {
      if (TOKEN_ERROR_CODES.has(body.error_code)) {
        return { ok: false, message: '识别凭证已过期', tokenError: true, baiduCode: body.error_code }
      }
      if (QUOTA_ERROR_CODES.has(body.error_code)) {
        return { ok: false, message: '识别服务繁忙或额度已用尽，请稍后重试', baiduCode: body.error_code }
      }
      if (IMAGE_ERROR_CODES.has(body.error_code)) {
        return { ok: false, message: '图片无法识别（格式或大小不符合要求），请更换文件', baiduCode: body.error_code }
      }
      return { ok: false, message: '文字识别失败，请稍后重试', baiduCode: body.error_code }
    }

    const lines = (body.words_result ?? [])
      .map((w) => (typeof w.words === 'string' ? w.words : ''))
      .filter((w) => w.length > 0)
    const text = lines.join('\n')

    // 置信度：按行 probability.average 求平均（accurate_basic + probability=true）。
    // 无 probability 数据时保守记 low（宁可提示复核，不假装可信）。
    const probs = (body.words_result ?? [])
      .map((w) => w.probability?.average)
      .filter((p): p is number => typeof p === 'number')
    const avg = probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : 0
    const confidence: 'high' | 'medium' | 'low' = avg >= 0.92 ? 'high' : avg >= 0.8 ? 'medium' : 'low'

    return { ok: true, text, confidence, lines: lines.length }
  }

  /** 换取 / 复用 access_token（提前 1 天过期，单飞防并发重复换取）。 */
  private async getToken(apiKey: string, secretKey: string): Promise<string> {
    const now = Date.now()
    if (this.token && this.token.expiresAtMs > now) return this.token.value
    if (this.tokenInflight) return this.tokenInflight

    this.tokenInflight = (async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const url =
          `${this.baseUrl}/oauth/2.0/token?grant_type=client_credentials` +
          `&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`
        const res = await fetch(url, { method: 'POST', signal: controller.signal })
        const body = (await res.json()) as BaiduTokenResponse
        if (!body.access_token) {
          // 不把 error_description 透传给用户（可能含账号信息）；日志只记错误类别。
          this.logMeta('ocr.token_fail', { error: body.error ?? 'unknown' })
          throw new Error('BAIDU_OCR_TOKEN_FAILED')
        }
        const ttlMs = (body.expires_in ?? 30 * 86_400) * 1000
        this.token = { value: body.access_token, expiresAtMs: now + ttlMs - 86_400_000 }
        return body.access_token
      } finally {
        clearTimeout(timer)
        this.tokenInflight = null
      }
    })()
    return this.tokenInflight
  }

  // ── 并发闸 ────────────────────────────────────────────────────────────────

  private acquireSlot(): Promise<boolean> {
    if (this.active < this.maxConcurrency) {
      this.active += 1
      return Promise.resolve(true)
    }
    if (this.waitQueue.length >= this.maxConcurrency * 10) {
      return Promise.resolve(false) // 队列已满：诚实拒绝，不无限堆积
    }
    return new Promise<boolean>((resolve) => {
      this.waitQueue.push(() => {
        this.active += 1
        resolve(true)
      })
    })
  }

  private releaseSlot(): void {
    this.active -= 1
    const next = this.waitQueue.shift()
    if (next) next()
  }

  // ── 工具 ──────────────────────────────────────────────────────────────────

  private isAbort(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError'
  }

  /** 只记元数据：耗时 / 行数 / 错误码。绝不记图片、token、识别文本。 */
  private logMeta(event: string, meta: Record<string, unknown>): void {
    this.logger.log(`${event} ${JSON.stringify(meta)}`)
  }
}
