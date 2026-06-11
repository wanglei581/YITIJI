import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { tc3Sign } from '../../common/tencent/tc3'

// ============================================================
// 2C+ 面试官语音播报（腾讯云 TTS TextToVoice，官方语音包）。
//
// 与数字人「小青」同音色：VoiceType 默认取 TRTC_TTS_VOICE（现网 1008），
// 可用 TENCENT_TTS_VOICE_TYPE 单独覆盖；密钥复用 TENCENT_SECRET_ID/KEY
// （TRTC 对话式 AI 密钥，已实测含 TTS 权限），TC3 签名全在服务端。
//
// 设计：
// - 仅为"本会话面试官已落库的问题文本"合成（controller 层校验），不开放任意文本
//   合成，防滥用；问题文本生成时已过禁词扫描。
// - TextToVoice 单次长度有限：按句切分（≤90 字/段）逐段合成后拼接 mp3
//   （MPEG 帧流可直接拼接播放）。
// - 失败诚实返回（前端降级浏览器本地 TTS，绝不阻塞面试主流程）。
// - 不缓存、不落盘；音频 base64 直接回传；文本/音频不写日志（仅元数据）。
// ============================================================

const SEG_MAX_CHARS = 90
const TTS_VERSION = '2019-08-23'

export interface TtsResult {
  ok: boolean
  /** base64 mp3 */
  audio?: string
  errorMessage?: string
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** 按句切分（保留标点），超长句硬切；过滤空段。 */
export function splitForTts(text: string): string[] {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[。！？!?；;])/)
  const segments: string[] = []
  let current = ''
  for (const s of sentences) {
    const piece = s.trim()
    if (!piece) continue
    if ((current + piece).length <= SEG_MAX_CHARS) {
      current += piece
      continue
    }
    if (current) segments.push(current)
    if (piece.length <= SEG_MAX_CHARS) {
      current = piece
    } else {
      for (let i = 0; i < piece.length; i += SEG_MAX_CHARS) segments.push(piece.slice(i, i + SEG_MAX_CHARS))
      current = ''
    }
  }
  if (current) segments.push(current)
  return segments
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name)

  private get secretId(): string | undefined {
    return process.env['TENCENT_TTS_SECRET_ID'] || process.env['TENCENT_SECRET_ID']
  }

  private get secretKey(): string | undefined {
    return process.env['TENCENT_TTS_SECRET_KEY'] || process.env['TENCENT_SECRET_KEY']
  }

  private get voiceType(): number {
    return intEnv('TENCENT_TTS_VOICE_TYPE', intEnv('TRTC_TTS_VOICE', 1008))
  }

  private get host(): string {
    return process.env['TENCENT_TTS_HOST'] ?? 'tts.tencentcloudapi.com'
  }

  get enabled(): boolean {
    const provider = (process.env['TTS_PROVIDER'] ?? 'tencent').trim().toLowerCase()
    return provider === 'tencent' && !!this.secretId && !!this.secretKey
  }

  /** 合成一段播报音频（mp3 base64）。失败诚实返回，前端降级本地 TTS。 */
  async synthesize(text: string): Promise<TtsResult> {
    if (!this.enabled) {
      return { ok: false, errorMessage: '语音播报未启用' }
    }
    const clean = text.trim().slice(0, 600)
    if (!clean) return { ok: false, errorMessage: '播报内容为空' }
    const t0 = Date.now()
    const segments = splitForTts(clean)
    const parts: Buffer[] = []
    for (const seg of segments) {
      const part = await this.synthesizeSegment(seg)
      if (!part) {
        this.logMeta('tts.fail', { ms: Date.now() - t0, segs: segments.length })
        return { ok: false, errorMessage: '语音合成失败' }
      }
      parts.push(part)
    }
    const audio = Buffer.concat(parts)
    this.logMeta('tts.ok', { ms: Date.now() - t0, segs: segments.length, bytes: audio.length })
    return { ok: true, audio: audio.toString('base64') }
  }

  private async synthesizeSegment(text: string): Promise<Buffer | null> {
    const insecure = this.host.startsWith('127.0.0.1') || this.host.startsWith('localhost') // verify stub 用
    const payload = JSON.stringify({
      Text: text,
      SessionId: randomUUID(),
      VoiceType: this.voiceType,
      Codec: 'mp3',
      ModelType: 1,
    })
    const ts = Math.floor(Date.now() / 1000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), intEnv('TENCENT_TTS_TIMEOUT_MS', 15_000))
    try {
      const res = await fetch(`${insecure ? 'http' : 'https'}://${this.host}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: tc3Sign({
            host: this.host.split(':')[0],
            service: 'tts',
            payload,
            ts,
            secretId: this.secretId!,
            secretKey: this.secretKey!,
          }),
          'X-TC-Action': 'TextToVoice',
          'X-TC-Version': TTS_VERSION,
          'X-TC-Timestamp': String(ts),
          'X-TC-Region': process.env['TENCENT_TTS_REGION'] ?? 'ap-guangzhou',
        },
        body: payload,
        signal: controller.signal,
      })
      const body = (await res.json()) as { Response?: { Audio?: string; Error?: { Code?: string } } }
      if (body.Response?.Error || !body.Response?.Audio) {
        this.logMeta('tts.segment_fail', { code: body.Response?.Error?.Code ?? 'empty' })
        return null
      }
      return Buffer.from(body.Response.Audio, 'base64')
    } catch (e) {
      this.logMeta('tts.segment_fail', { code: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network' })
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  /** 只记元数据，绝不记文本 / 音频 / 密钥。 */
  private logMeta(event: string, meta: Record<string, unknown>): void {
    this.logger.log(`${event} ${JSON.stringify(meta)}`)
  }
}
