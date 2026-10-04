/**
 * 宣传屏上传与时长的前端预检、页面说明。
 * 这里的数字是服务端源码里的默认上限（环境变量可在运行时覆盖，页面不另编一套）。
 * 门禁从服务端源码解析后与这些常量比对，改数字前先改服务端。
 */

export const SCREENSAVER_IMAGE_MAX_MB = 10
export const SCREENSAVER_VIDEO_MAX_MB = 100
export const SCREENSAVER_VIDEO_MAX_SEC = 120

export const SCREENSAVER_DURATION_MIN_SEC = 3
export const SCREENSAVER_DURATION_MAX_SEC = 1800
export const SCREENSAVER_IMAGE_DEFAULT_SEC = 8
export const SCREENSAVER_VIDEO_DEFAULT_SEC = 15
export const SCREENSAVER_EXTERNAL_DEFAULT_SEC = 15

export const SCREENSAVER_IDLE_MIN_SEC = 30
export const SCREENSAVER_IDLE_MAX_SEC = 1800
export const SCREENSAVER_IDLE_DEFAULT_SEC = 180

const MB = 1024 * 1024

export const externalVideoHelp =
  '只能填视频文件本身的网址（以 https:// 开头、以 .mp4 或 .webm 结尾）。网页链接（如 B 站、抖音、优酷的播放页）不能用。链接失效后需要管理员重新填写；本系统不保存第三方账号或密码。'

export const externalVideoTechNote =
  '只接受 HTTPS 视频直链，不支持 iframe 或网页播放页（包括 YouTube）。链接不能带账号密码，也不能指向内网。'

export function screensaverUploadLimitText(): string {
  return `JPG、PNG、WebP 图片，不超过 ${SCREENSAVER_IMAGE_MAX_MB} MB；MP4、WebM 视频，不超过 ${SCREENSAVER_VIDEO_MAX_MB} MB、不超过 ${SCREENSAVER_VIDEO_MAX_SEC} 秒。`
}

function maxSentence(sec: number): string {
  const minutes = sec / 60
  const minuteText = Number.isInteger(minutes) ? String(minutes) : String(minutes)
  return `最长 ${sec} 秒（${minuteText} 分钟），不填用默认值`
}

export function dwellLimitHint(kind: 'upload' | 'external' | 'idle'): string {
  if (kind === 'upload') {
    return `${maxSentence(SCREENSAVER_DURATION_MAX_SEC)}（图片 ${SCREENSAVER_IMAGE_DEFAULT_SEC} 秒，视频 ${SCREENSAVER_VIDEO_DEFAULT_SEC} 秒）。视频不能超过 ${SCREENSAVER_VIDEO_MAX_SEC} 秒。`
  }
  if (kind === 'external') {
    return `${maxSentence(SCREENSAVER_DURATION_MAX_SEC)}（${SCREENSAVER_EXTERNAL_DEFAULT_SEC} 秒）。`
  }
  return `${maxSentence(SCREENSAVER_IDLE_MAX_SEC)}（${SCREENSAVER_IDLE_DEFAULT_SEC} 秒）。`
}

function extOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot < 0 || dot >= base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

function isAllowedImage(mime: string, ext: string): boolean {
  if (mime === 'image/jpeg') return ext === 'jpg' || ext === 'jpeg'
  if (mime === 'image/png') return ext === 'png'
  if (mime === 'image/webp') return ext === 'webp'
  return false
}

function isAllowedVideo(mime: string, ext: string): boolean {
  if (mime === 'video/mp4') return ext === 'mp4'
  if (mime === 'video/webm') return ext === 'webm'
  return false
}

export function validateScreensaverUploadFile(file: { name: string; type: string; size: number }): string | null {
  const mime = file.type.toLowerCase().split(';')[0]?.trim() ?? ''
  const ext = extOf(file.name)
  const image = isAllowedImage(mime, ext)
  const video = isAllowedVideo(mime, ext)
  if (!image && !video) {
    return '这个文件不能上传。只能选择 JPG、PNG、WebP 图片，或 MP4、WebM 视频。'
  }
  const maxMb = image ? SCREENSAVER_IMAGE_MAX_MB : SCREENSAVER_VIDEO_MAX_MB
  if (file.size > maxMb * MB) {
    return `${image ? '图片' : '视频'}超过 ${maxMb} MB 上限。`
  }
  return null
}

export function dwellDurationError(raw: string, kind: 'image' | 'video' | 'external'): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return '停留时长须为整数秒，或留空使用默认值。'
  const n = Number(trimmed)
  const max = kind === 'video'
    ? Math.min(SCREENSAVER_VIDEO_MAX_SEC, SCREENSAVER_DURATION_MAX_SEC)
    : SCREENSAVER_DURATION_MAX_SEC
  if (n < SCREENSAVER_DURATION_MIN_SEC || n > max) {
    return `停留时长须在 ${SCREENSAVER_DURATION_MIN_SEC} 到 ${max} 秒之间。`
  }
  return null
}

export function uploadFormError(
  file: { name: string; type: string; size: number } | null,
  durationRaw: string,
): string | null {
  if (file) {
    const fileError = validateScreensaverUploadFile(file)
    if (fileError) return fileError
  }
  const kind = file && file.type.toLowerCase().startsWith('video/') ? 'video' : 'image'
  return dwellDurationError(durationRaw, kind)
}

export function idleTimeoutError(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return '无操作时长须为整数秒，或留空使用默认值。'
  const n = Number(trimmed)
  if (n < SCREENSAVER_IDLE_MIN_SEC || n > SCREENSAVER_IDLE_MAX_SEC) {
    return `无操作时长须在 ${SCREENSAVER_IDLE_MIN_SEC} 到 ${SCREENSAVER_IDLE_MAX_SEC} 秒之间。`
  }
  return null
}

export function resolveIdleTimeoutSec(raw: string): number {
  const problem = idleTimeoutError(raw)
  if (problem) throw new Error(problem)
  return raw.trim() ? Number(raw.trim()) : SCREENSAVER_IDLE_DEFAULT_SEC
}
