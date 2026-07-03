/**
 * 上传校验(纯函数,便于单测)。
 *
 * 校验维度(用户需求一·4):
 *   - 文件用途 purpose(各用途有专属 MIME 白名单 + 大小上限)
 *   - MIME type(必须落在该 purpose 的白名单)
 *   - 文件扩展名(必须与 MIME 一致,杜绝 .exe 伪装成 image/png)
 *   - 文件大小(按 purpose 上限;服务端代理上传额外受内存上限约束)
 *
 * 鉴权(登录用户 / 机构 / 管理员)在 service / controller 层完成,不在此处。
 */
import type { FilePurpose, FileSensitiveLevel } from './file.types'

export interface ValidationOk {
  ok: true
  /** 归一化扩展名(不带点)。 */
  ext: string
}
export interface ValidationErr {
  ok: false
  code: string
  message: string
}
export type ValidationResult = ValidationOk | ValidationErr

const MB = 1024 * 1024

/** MIME → 允许的扩展名集合(扩展名与 MIME 必须一致)。 */
const MIME_EXTS: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'text/plain': ['txt'],
  'text/markdown': ['md'],
  'application/json': ['json'],
}

const PDF_DOC_IMG = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp']
const IMG = ['image/jpeg', 'image/png', 'image/webp']
const VIDEO = ['video/mp4', 'video/webm']
const PRINTABLE = ['application/pdf', 'image/jpeg', 'image/png']

/** 各 purpose 的 MIME 白名单 + 大小上限(字节)。 */
export const PURPOSE_POLICY: Record<FilePurpose, { mimes: string[]; maxBytes: number }> = {
  // 直接进打印流程 → 仅 Agent 能真正出纸的格式
  print_doc: { mimes: PRINTABLE, maxBytes: 20 * MB },
  // 求职者敏感文档(给 AI 解析 / 展示)
  // text/plain 与 text/markdown 为服务端生成的简历导出格式(inert 文本),故仅在 resume_upload 放宽。
  // 安全前提:其 inline 提供不产生 XSS 依赖全局 helmet nosniff(main.ts,X-Content-Type-Options: nosniff)——
  // 勿在 /content 下发路径移除 nosniff;若要更强隔离,对文本类导出改用 Content-Disposition: attachment(见 Wave 6 待办)。
  resume_upload: { mimes: [...PDF_DOC_IMG, 'text/plain', 'text/markdown'], maxBytes: 20 * MB },
  resume_scan: { mimes: PDF_DOC_IMG, maxBytes: 20 * MB },
  id_scan: { mimes: IMG, maxBytes: 10 * MB },
  cover_letter: { mimes: PDF_DOC_IMG, maxBytes: 20 * MB },
  // 招聘会 / 机构资料
  fair_material: { mimes: [...PRINTABLE, 'image/webp'], maxBytes: 30 * MB },
  job_fair_material: { mimes: [...PRINTABLE, 'image/webp'], maxBytes: 30 * MB },
  partner_profile: { mimes: IMG, maxBytes: 15 * MB },
  partner_image: { mimes: IMG, maxBytes: 15 * MB },
  partner_video: { mimes: VIDEO, maxBytes: 500 * MB },
  screensaver_material: { mimes: [...IMG, ...VIDEO], maxBytes: 500 * MB },
  admin_upload: { mimes: [...PDF_DOC_IMG, ...VIDEO], maxBytes: 500 * MB },
  temp: { mimes: [...PRINTABLE, 'image/webp'], maxBytes: 20 * MB },
}

/** 服务端代理上传(multipart,整 buffer 进内存)的硬上限。超此须走 upload-intent 直传。 */
export const PROXY_MAX_BYTES = 15 * MB

/** 默认敏感等级(显式传入可覆盖)。 */
export const DEFAULT_SENSITIVE_BY_PURPOSE: Record<FilePurpose, FileSensitiveLevel> = {
  resume_upload: 'highly_sensitive',
  resume_scan: 'highly_sensitive',
  id_scan: 'highly_sensitive',
  cover_letter: 'sensitive',
  print_doc: 'normal',
  fair_material: 'normal',
  job_fair_material: 'normal',
  partner_profile: 'normal',
  partner_image: 'normal',
  partner_video: 'normal',
  screensaver_material: 'normal',
  admin_upload: 'normal',
  temp: 'sensitive',
}

/** 从文件名提取扩展名(小写,不带点);无则空串。 */
export function extFromFilename(filename: string): string {
  const dot = (filename ?? '').lastIndexOf('.')
  if (dot < 0 || dot >= filename.length - 1) return ''
  return filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 由 MIME 反推默认扩展名(文件名无扩展名时用)。 */
export function extFromMime(mime: string): string {
  return MIME_EXTS[mime]?.[0] ?? 'bin'
}

export function isPurpose(value: string): value is FilePurpose {
  return value in PURPOSE_POLICY
}

/**
 * 综合校验:purpose / MIME / 扩展名 / 大小。
 *
 * @param mode 'proxy'=服务端代理上传(额外受 PROXY_MAX_BYTES 约束);
 *             'intent'=直传意图(按 purpose 上限,实际大小由 complete 复核)。
 */
export function validateUpload(args: {
  purpose: string
  mimeType: string
  filename: string
  sizeBytes: number
  mode: 'proxy' | 'intent'
}): ValidationResult {
  if (!isPurpose(args.purpose)) {
    return { ok: false, code: 'FILE_PURPOSE_INVALID', message: `不支持的文件用途: ${args.purpose}` }
  }
  const policy = PURPOSE_POLICY[args.purpose]

  if (!policy.mimes.includes(args.mimeType)) {
    return { ok: false, code: 'FILE_MIME_NOT_ALLOWED', message: `用途 ${args.purpose} 不支持该类型: ${args.mimeType}` }
  }

  // 扩展名必须与 MIME 一致(防伪装)
  const allowedExts = MIME_EXTS[args.mimeType] ?? []
  const nameExt = extFromFilename(args.filename)
  if (nameExt && allowedExts.length > 0 && !allowedExts.includes(nameExt)) {
    return { ok: false, code: 'FILE_EXT_MISMATCH', message: `扩展名 .${nameExt} 与类型 ${args.mimeType} 不一致` }
  }
  const ext = nameExt && allowedExts.includes(nameExt) ? nameExt : extFromMime(args.mimeType)

  if (!Number.isFinite(args.sizeBytes) || args.sizeBytes <= 0) {
    return { ok: false, code: 'FILE_EMPTY', message: '文件为空或大小未知' }
  }
  const maxBytes = args.mode === 'proxy' ? Math.min(policy.maxBytes, PROXY_MAX_BYTES) : policy.maxBytes
  if (args.sizeBytes > maxBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `文件超出上限(${Math.round(maxBytes / MB)}MB)${args.mode === 'proxy' ? ',大文件请用直传' : ''}`,
    }
  }

  return { ok: true, ext }
}
