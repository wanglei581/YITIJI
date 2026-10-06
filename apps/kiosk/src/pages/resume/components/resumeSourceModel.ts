import type { ScanHandoff } from '../resumeScanHandoff'
import { ApiHttpError } from '../../../services/api/httpAdapter'
import { userMessageOf } from '../../../services/api/userErrorMessage'

export type ResumeScreen = 'source' | 'target' | 'target-context' | 'target-profile' | 'target-industry' | 'summary'
export type UploadChannel = 'usb' | 'cloud' | 'phone'
export type FileChannel = UploadChannel | 'scan'

export interface UploadedResumeFile {
  name: string
  size: string
  format: string
  fileId: string
  fileUrl?: string
  mimeType?: string
  channel: FileChannel
}

/** 一体机不弹电脑文件框。口径在等产品负责人确认，改这句话只改这一处。 */
export const KIOSK_LOCAL_FILE_UNAVAILABLE_REASON = '这台机器不打开电脑里的文件，请用手机扫码或 U 盘'

const SCREENS: readonly ResumeScreen[] = ['source', 'target', 'target-context', 'target-profile', 'target-industry', 'summary']

export function isResumeScreen(value: string | null): value is ResumeScreen {
  return SCREENS.includes(value as ResumeScreen)
}

/**
 * 地址栏只记画面，不记文件。显式 screen 优先；确认屏没有文件时退回来源；
 * 没带参数但已经有文件（扫描交接）时进确认屏。
 * 写出了白名单以外的画面时停在「认不出」，不拿来源页冒充那一屏。
 */
export function resolveResumeScreen(requested: string | null, hasFile: boolean): ResumeScreen | 'unknown' {
  if (requested && !isResumeScreen(requested)) return 'unknown'
  if (isResumeScreen(requested)) {
    if (requested === 'summary' && !hasFile) return 'source'
    return requested
  }
  return hasFile ? 'summary' : 'source'
}

export function sourceFrameStatus(input: {
  screen: ResumeScreen | 'unknown'
  uploading: boolean
  receiving: boolean
  uploadUnknown: boolean
  uploadRecheck: boolean
  error: boolean
}): { tone: 'ok' | 'warn' | 'unknown'; label: string } {
  if (input.screen === 'unknown') return { tone: 'warn', label: '无法识别的状态' }
  if (input.uploading) return { tone: 'warn', label: '上传中' }
  if (input.receiving) return { tone: 'warn', label: '接收中' }
  if (input.uploadRecheck) return { tone: 'warn', label: '上传结果未知 · 无可查记录' }
  if (input.uploadUnknown) return { tone: 'warn', label: '上传结果未知 · 不重发' }
  if (input.error) return { tone: 'warn', label: '上传未完成' }
  if (input.screen === 'summary') return { tone: 'ok', label: '第 2 步 · 确认这次办理' }
  if (input.screen === 'target') return { tone: 'unknown', label: '第 1 步 · 诊断方向' }
  if (input.screen === 'target-context' || input.screen === 'target-profile') return { tone: 'unknown', label: '第 1 步 · 目标设置' }
  if (input.screen === 'target-industry') return { tone: 'unknown', label: '第 1 步 · 选行业门类' }
  return { tone: 'unknown', label: '第 1 步 · 取简历文件' }
}

/**
 * 可接收格式按通道真实能力写，不照抄稿上的「DOCX 与 WEBP 请走本机文件」。
 * U 盘：终端程序 ALLOWED_USB_EXTENSIONS 只有 pdf/jpg/jpeg/png。
 * 手机扫码：PhoneUploadPage 对 resume/print/contract 取交集（W-111）。
 *   未开通 Word 时交集是 PDF/JPG/PNG（WEBP 只在简历和合同，打印用途没有）。
 *   开通 Word 后 DOC/DOCX 才进入三条用途。
 * 本机文件：BASE_ACCEPT 含 WEBP；Word 只在 wordConversionAvailable 时追加。
 * 一体机上本机文件卡置灰，它的 accept 不计入这行。
 */
const FORMAT_LINE = {
  kiosk: '可接收：PDF、JPG、PNG。单份不超过 10MB。U 盘和手机扫码都只收这三种。',
  kioskWord: '可接收：PDF、JPG、PNG、DOC、DOCX。单份不超过 10MB。U 盘只列 PDF / JPG / PNG；DOC 与 DOCX 只在手机扫码、且本机已开通 Word 转换时能收。',
  desktop: '可接收：PDF、JPG、PNG、WEBP。单份不超过 10MB。U 盘和手机扫码只收 PDF / JPG / PNG；WEBP 只在本机文件里选。',
  desktopWord: '可接收：PDF、JPG、PNG、WEBP、DOC、DOCX。单份不超过 10MB。U 盘只列 PDF / JPG / PNG；手机扫码收 PDF / JPG / PNG / DOC / DOCX；WEBP 只在本机文件里选。',
} as const

/** 标签与说明从上面四句拆出来，页面只画这一次，不再另写一行重复的格式说明。 */
function viewFromLine(line: string): { tags: readonly string[]; note: string } {
  const body = line.slice('可接收：'.length)
  const splitAt = body.indexOf('。')
  return { tags: body.slice(0, splitAt).split('、'), note: body.slice(splitAt + 1) }
}

export function receivableFormatLine(kiosk: boolean, word: boolean): string {
  if (kiosk && !word) return FORMAT_LINE.kiosk
  if (kiosk && word) return FORMAT_LINE.kioskWord
  if (!word) return FORMAT_LINE.desktop
  return FORMAT_LINE.desktopWord
}

export function receivableFormatView(kiosk: boolean, word: boolean): { tags: readonly string[]; note: string } {
  return viewFromLine(receivableFormatLine(kiosk, word))
}

export function inferFormat(mimeOrName: string): string {
  const value = mimeOrName.toLowerCase()
  if (value.includes('pdf')) return 'pdf'
  if (value.includes('word') || value.includes('doc')) return 'word'
  if (value.includes('png')) return 'png'
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg'
  if (value.includes('webp')) return 'webp'
  return 'unknown'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function scanFileFrom(handoff: ScanHandoff | null): UploadedResumeFile | null {
  if (!handoff) return null
  const { fileId, file } = handoff
  return {
    name: file.name,
    size: typeof file.size === 'number' ? formatSize(file.size) : file.size ?? '大小未知',
    format: inferFormat(file.format || file.mimeType || file.name),
    fileId,
    fileUrl: file.fileUrl,
    mimeType: file.mimeType,
    channel: 'scan',
  }
}

export function uploadOutcomeOf(err: unknown): 'rejected' | 'unknown' {
  if (!(err instanceof ApiHttpError)) return 'unknown'
  if (err.status < 400 || err.status >= 500) return 'unknown'
  if (err.code === 'UNKNOWN_ERROR' || err.code === 'NETWORK_ERROR' || err.code === 'REQUEST_TIMEOUT') return 'unknown'
  return 'rejected'
}

export function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiHttpError && ['UNSUPPORTED_FILE_TYPE', 'FILE_TYPE_NOT_ALLOWED'].includes(err.code)) {
    return '不支持的文件类型，请改用 PDF 或清晰图片。'
  }
  return userMessageOf(err, '上传失败，请重新选择文件或更换上传方式。')
}

export function channelLabelOf(channel: FileChannel): string {
  if (channel === 'usb') return 'U盘上传'
  if (channel === 'phone') return '手机扫码上传'
  if (channel === 'scan') return '扫描工作台交接'
  return '本机文件'
}
