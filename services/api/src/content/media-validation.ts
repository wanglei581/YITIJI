/**
 * 宣传屏素材上传校验:MIME 白名单 + 魔数(magic number)校验 + 大小/时长上限。
 *
 * 评审 bug 防护(用户锁定范围:MIME 校验 + 文件签名/魔数校验 + 类型白名单 + 大小限制):
 *   仅凭 Content-Type 头不可信(可伪造),必须用文件头字节再确认真实类型,
 *   防止可执行文件改名后上传。
 */

export type AdMediaKind = 'image' | 'video'

export interface MediaLimits {
  maxImageBytes: number
  maxVideoBytes: number
  /** 视频时长上限(秒)。由管理员申报的 durationSec 校验,一期不做服务端转码探测。 */
  maxVideoDurationSec: number
}

export function getMediaLimits(): MediaLimits {
  const mb = (v: string | undefined, def: number): number => {
    const n = Number(v)
    return (Number.isFinite(n) && n > 0 ? n : def) * 1024 * 1024
  }
  const sec = (v: string | undefined, def: number): number => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : def
  }
  return {
    maxImageBytes: mb(process.env['AD_ASSET_MAX_IMAGE_MB'], 10),
    maxVideoBytes: mb(process.env['AD_ASSET_MAX_VIDEO_MB'], 100),
    maxVideoDurationSec: sec(process.env['AD_ASSET_MAX_VIDEO_SEC'], 120),
  }
}

interface MimeSpec {
  kind: AdMediaKind
  ext: string
  /** 文件头魔数校验 */
  sniff: (b: Buffer) => boolean
}

const ALLOWED: Record<string, MimeSpec> = {
  'image/jpeg': {
    kind: 'image',
    ext: 'jpg',
    sniff: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/png': {
    kind: 'image',
    ext: 'png',
    sniff: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  'image/webp': {
    kind: 'image',
    ext: 'webp',
    sniff: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  'video/mp4': {
    kind: 'video',
    ext: 'mp4',
    // ISO BMFF:第 4..8 字节为 'ftyp' box 标识
    sniff: (b) => b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  'video/webm': {
    kind: 'video',
    ext: 'webm',
    // EBML 头
    sniff: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
}

export type ValidateResult =
  | { ok: true; kind: AdMediaKind; ext: string }
  | { ok: false; code: string; message: string }

/**
 * 校验上传素材:
 *   1. MIME 在白名单内
 *   2. 文件头魔数与 MIME 声明一致
 *   3. 大小不超过对应类型上限
 */
export function validateMedia(mimeType: string, buffer: Buffer): ValidateResult {
  if (buffer.length === 0) {
    return { ok: false, code: 'AD_ASSET_EMPTY', message: '上传文件为空' }
  }
  const spec = ALLOWED[mimeType]
  if (!spec) {
    return {
      ok: false,
      code: 'AD_ASSET_MIME_NOT_ALLOWED',
      message: `不支持的素材类型: ${mimeType}(仅支持 JPG/PNG/WebP 图片与 MP4/WebM 视频)`,
    }
  }
  if (!spec.sniff(buffer)) {
    return {
      ok: false,
      code: 'AD_ASSET_CONTENT_MISMATCH',
      message: '文件内容与声明类型不符(魔数校验失败)',
    }
  }
  const limits = getMediaLimits()
  const maxBytes = spec.kind === 'video' ? limits.maxVideoBytes : limits.maxImageBytes
  if (buffer.length > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024)
    return {
      ok: false,
      code: 'AD_ASSET_TOO_LARGE',
      message: `${spec.kind === 'video' ? '视频' : '图片'}超出 ${maxMb}MB 上限`,
    }
  }
  return { ok: true, kind: spec.kind, ext: spec.ext }
}
