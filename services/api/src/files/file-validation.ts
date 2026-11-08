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
import { isWordToPdfUploadAvailable } from '../document-conversion/document-conversion-capability-state'

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
export type UploadValidationMode = 'proxy' | 'intent'

const MB = 1024 * 1024

/**
 * 会员数据导出的完整文件策略。该 purpose 不接受外部上传，
 * MemberDataExportFileService 在存储前校验 JSON 内容与明确到期时间。
 */
export const MEMBER_DATA_EXPORT_FILE_POLICY = {
  mimes: ['application/json'],
  maxBytes: 15 * MB,
  sensitiveLevel: 'highly_sensitive',
  retentionPolicy: 'system_short',
  retentionSetBy: 'system',
  visibility: 'private',
  maxTtlHours: 24,
  serverGeneratedOnly: true,
} as const

/** 合同风险提示报告只允许合同领域服务生成，不接受任何外部上传。 */
export const CONTRACT_REVIEW_REPORT_FILE_POLICY = {
  mimes: ['application/pdf'],
  maxBytes: 5 * MB,
  sensitiveLevel: 'highly_sensitive',
  retentionPolicy: 'system_short',
  retentionSetBy: 'system',
  visibility: 'private',
  serverGeneratedOnly: true,
} as const

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

const PDF_DOC_IMG = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]
const IMG = ['image/jpeg', 'image/png', 'image/webp']
const VIDEO = ['video/mp4', 'video/webm']
const PRINTABLE = ['application/pdf', 'image/jpeg', 'image/png']
const WORD = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

/** 各 purpose 的 MIME 白名单 + 大小上限(字节)。 */
export const PURPOSE_POLICY: Record<FilePurpose, { mimes: string[]; maxBytes: number }> = {
  // 直接进打印流程 → 仅 Agent 能真正出纸的格式
  print_doc: { mimes: [...PRINTABLE, ...WORD], maxBytes: 20 * MB },
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
  // 合同审查原件:仅用于会话级提取/分析，留存由 retention-policy.ts 锁定为两小时。
  contract_upload: { mimes: PDF_DOC_IMG, maxBytes: 20 * MB },
  contract_review_report: {
    mimes: [...CONTRACT_REVIEW_REPORT_FILE_POLICY.mimes],
    maxBytes: CONTRACT_REVIEW_REPORT_FILE_POLICY.maxBytes,
  },
  // 签名/印章图片:仅供签章合成读取,高敏、系统短期、锁定不可延期(见 retention-policy.ts)
  signature_image: { mimes: ['image/jpeg', 'image/png'], maxBytes: 10 * MB },
  member_data_export: {
    mimes: [...MEMBER_DATA_EXPORT_FILE_POLICY.mimes],
    maxBytes: MEMBER_DATA_EXPORT_FILE_POLICY.maxBytes,
  },
  // 自我探索报告 PDF：服务端生成(PDFKit / pdf-lib)的本人自助倾向摘要,默认 5MB 上限。
  // 上游 self-assessment.service.printReport 与 appended-self-assessment.service.appendToResume
  // 固定生成 application/pdf 此处的 mimes 必含 PDF;留 PDF_DOC_IMG 是给未来导出其他格式兜底。
  // §1.2 配套修复: 之前 { mimes: [], maxBytes: 0 } 会让两路 services.upload 在 validateUpload 阶段拒上传。
  self_assessment_report: { mimes: [...PDF_DOC_IMG], maxBytes: 5 * MB },
}

/** 服务端代理上传(multipart,整 buffer 进内存)的硬上限。超此须走 upload-intent 直传。 */
export const PROXY_MAX_BYTES = 15 * MB

/**
 * 本地代理直传（PUT /files/:id/raw）的进程内存天花板。
 * COS 直传不经此路径。purpose 上限更严时取更严者（见 rawUploadByteLimitForPurpose）。
 */
export const RAW_UPLOAD_PROXY_MAX_BYTES = 200 * MB

/**
 * 仅管理员可声明的上传用途。kiosk / partner / 会员 token 不得占用 admin_upload 命名空间。
 */
export const ADMIN_ONLY_UPLOAD_PURPOSES: ReadonlySet<FilePurpose> = new Set(['admin_upload'])

/** 本地代理直传按 purpose 的流式上限：purpose 政策与 200MB 内存天花板取更严。 */
export function rawUploadByteLimitForPurpose(purpose: string): number {
  if (!isPurpose(purpose)) return 0
  return Math.min(PURPOSE_POLICY[purpose].maxBytes, RAW_UPLOAD_PROXY_MAX_BYTES)
}

/** 上传用途是否允许当前内部角色（会员 / 匿名 actorRole=null）。 */
export function canActorUseUploadPurpose(
  purpose: string,
  actorRole: string | null | undefined,
): boolean {
  if (!isPurpose(purpose)) return false
  if (ADMIN_ONLY_UPLOAD_PURPOSES.has(purpose)) return actorRole === 'admin'
  return true
}

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
  contract_upload: 'highly_sensitive',
  contract_review_report: CONTRACT_REVIEW_REPORT_FILE_POLICY.sensitiveLevel,
  signature_image: 'highly_sensitive',
  member_data_export: MEMBER_DATA_EXPORT_FILE_POLICY.sensitiveLevel,
  self_assessment_report: 'sensitive',
}

/** 从文件名提取扩展名(小写,不带点);无则空串。 */
export function extFromFilename(filename: string): string {
  const dot = (filename ?? '').lastIndexOf('.')
  if (dot < 0 || dot >= filename.length - 1) return ''
  return filename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** 由 MIME 反推默认扩展名(文件名无扩展名时用)。 */
export function extFromMime(mime: string): string {
  return MIME_EXTS[mime]?.[0] ?? 'bin'
}

export function isPurpose(value: string): value is FilePurpose {
  return value in PURPOSE_POLICY
}

/**
 * 屏上扫描（device 投递）的页数与字节上限。租约下发和投递时再拦，用的是同一组数。
 *
 * 证件：4 页 / 10 MiB。10 MiB 就是 PURPOSE_POLICY.id_scan.maxBytes，不另写一个数。
 * 4 页必须 ≤ 个人信息检查的默认识别页数（pii-scan.util 的 PII_SCAN_OCR_PAGE_LIMIT_DEFAULT，默认 5）。
 * 证件 PDF 的实际 OCR 上限是 max(PII_SCAN_MAX_OCR_PAGES, 本常量 4)：配置被调到 1 时，
 * 4 页仍然每一页都识别。
 *
 * 其余：20 页 / 18 MiB。20 页来自任务包 ③ §2.4 和补稿 cs-scan-more。
 * 18 MiB 与终端程序 `SCAN_PDF_MAX_BYTES` 相同：
 * `apps/terminal-agent/src/agent/scan-device/scan-pdf-compose.ts`
 * （合成 PDF 超过 18 MiB 报 too_large；注释写明是给后端 deliver 的 20 MiB 留出 multipart 开销）。
 * 该文件在终端程序批次，本服务不 import 它，数值在这里写死。
 */
export const SCAN_DEVICE_ID_MAX_PAGES = 4
export const SCAN_DEVICE_OTHER_MAX_PAGES = 20
export const SCAN_DEVICE_OTHER_MAX_BYTES = 18 * MB

export function scanDeviceDeliveryLimits(purpose: string): { maxPages: number; maxBytes: number } {
  if (purpose === 'id_scan') {
    return { maxPages: SCAN_DEVICE_ID_MAX_PAGES, maxBytes: PURPOSE_POLICY.id_scan.maxBytes }
  }
  if (!isPurpose(purpose)) {
    return { maxPages: SCAN_DEVICE_OTHER_MAX_PAGES, maxBytes: SCAN_DEVICE_OTHER_MAX_BYTES }
  }
  return {
    maxPages: SCAN_DEVICE_OTHER_MAX_PAGES,
    maxBytes: Math.min(PURPOSE_POLICY[purpose].maxBytes, SCAN_DEVICE_OTHER_MAX_BYTES),
  }
}

/** 租约按扫描类型取上限。证件 4 页 / 10 MiB；其余一律 20 页 / 18 MiB。 */
export function scanDeviceLeaseLimits(scanType: string | null | undefined): { maxPages: number; maxBytes: number } {
  if (scanType === 'id') {
    return { maxPages: SCAN_DEVICE_ID_MAX_PAGES, maxBytes: PURPOSE_POLICY.id_scan.maxBytes }
  }
  return { maxPages: SCAN_DEVICE_OTHER_MAX_PAGES, maxBytes: SCAN_DEVICE_OTHER_MAX_BYTES }
}

/** 屏上扫描投递的 PDF 页数不是可靠解析结果。无人值守口径，不出现「找工作人员」。 */
export const SCAN_DEVICE_PAGE_COUNT_UNREADABLE_MESSAGE = '这份扫描件的页数没能读出来，请重新扫描。'

/** 页数超过该类型上限。读不出页数用 {@link SCAN_DEVICE_PAGE_COUNT_UNREADABLE_MESSAGE}，不要说成超限。 */
export function scanDeviceTooManyPagesMessage(maxPages: number, recognized: number | null): string {
  if (recognized === null) return SCAN_DEVICE_PAGE_COUNT_UNREADABLE_MESSAGE
  return `这次最多扫 ${maxPages} 页。请少扫几页，分成几次办理。`
}

function concludeUploadValidation(args: {
  mimeType: string
  filename: string
  sizeBytes: number
  maxBytes: number
}): ValidationResult {
  // 扩展名必须与 MIME 一致(防伪装)
  const allowedExts = MIME_EXTS[args.mimeType] ?? []
  const nameExt = extFromFilename(args.filename)
  if (nameExt && allowedExts.length > 0 && !allowedExts.includes(nameExt)) {
    return {
      ok: false,
      code: 'FILE_EXT_MISMATCH',
      message: '文件扩展名与声明类型不一致',
    }
  }
  const ext = nameExt && allowedExts.includes(nameExt) ? nameExt : extFromMime(args.mimeType)

  if (!Number.isFinite(args.sizeBytes) || args.sizeBytes <= 0) {
    return { ok: false, code: 'FILE_EMPTY', message: '文件为空或大小未知' }
  }
  if (args.sizeBytes > args.maxBytes) {
    // 文案面向一体机终端用户:说清「多大」「超了多少」「怎么办」。
    // 原文案「大文件请用直传」是内部实现词——kiosk 前台没有任何叫「直传」的入口,
    // 用户看到只会卡住(2026-08-17 真实文件走查:16.9MB 图片被拒后无可执行下一步)。
    const limitMb = Math.round(args.maxBytes / MB)
    const actualMb = (args.sizeBytes / MB).toFixed(1)
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `文件 ${actualMb}MB，超过单份上限 ${limitMb}MB。请压缩后重试，或分成多份分别上传。`,
    }
  }

  return { ok: true, ext }
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
  mode: UploadValidationMode
}): ValidationResult {
  if (!isPurpose(args.purpose)) {
    return { ok: false, code: 'FILE_PURPOSE_INVALID', message: '不支持的文件用途' }
  }
  const policy = PURPOSE_POLICY[args.purpose]

  if (
    !policy.mimes.includes(args.mimeType) ||
    (args.purpose === 'print_doc' && WORD.includes(args.mimeType) && !isWordToPdfUploadAvailable())
  ) {
    return { ok: false, code: 'FILE_MIME_NOT_ALLOWED', message: '该文件用途不支持此文件类型' }
  }

  const maxBytes =
    args.mode === 'proxy' ? Math.min(policy.maxBytes, PROXY_MAX_BYTES) : policy.maxBytes
  return concludeUploadValidation({
    mimeType: args.mimeType,
    filename: args.filename,
    sizeBytes: args.sizeBytes,
    maxBytes,
  })
}

/**
 * 只给「服务端已经核实过的屏上扫描投递」用。
 *
 * 证件（id_scan）在这条路径上额外收 application/pdf，大小仍是证件用途自己的 10 MiB。
 * 其余用途的 MIME 白名单不变，字节上限取「用途上限」和「屏上扫描 18 MiB」里更严的那个，
 * 并且不受代理上传 15 MiB 天花板约束（屏上扫描的合成 PDF 按 18 MiB 收）。
 *
 * 没有布尔开关。调用方不能传「允许 PDF」；证件 PDF 只在 purpose 已经是 id_scan、
 * 且声明类型就是 PDF 时走进这个分支。公共 validateUpload 不调用本函数。
 */
export function validateVerifiedDeviceScanUpload(args: {
  purpose: string
  mimeType: string
  filename: string
  sizeBytes: number
}): ValidationResult {
  if (!isPurpose(args.purpose)) {
    return { ok: false, code: 'FILE_PURPOSE_INVALID', message: '不支持的文件用途' }
  }
  const mime = (args.mimeType ?? '').split(';')[0]!.trim().toLowerCase()
  if (args.purpose === 'id_scan' && mime === 'application/pdf') {
    return concludeUploadValidation({
      mimeType: 'application/pdf',
      filename: args.filename,
      sizeBytes: args.sizeBytes,
      maxBytes: PURPOSE_POLICY.id_scan.maxBytes,
    })
  }
  const base = validateUpload({
    purpose: args.purpose,
    mimeType: args.mimeType,
    filename: args.filename,
    sizeBytes: args.sizeBytes,
    mode: 'intent',
  })
  if (!base.ok) return base
  const maxBytes = scanDeviceDeliveryLimits(args.purpose).maxBytes
  if (args.sizeBytes > maxBytes) {
    return concludeUploadValidation({
      mimeType: mime || args.mimeType,
      filename: args.filename,
      sizeBytes: args.sizeBytes,
      maxBytes,
    })
  }
  return base
}

/**
 * Multer/Busboy 可能把浏览器 multipart 里的 UTF-8 文件名按 Latin-1 解码。
 * 只还原能严格往返、且恢复结果含至少一个大于 U+00FF 的码点的名称，避免改写合法的 Latin-1 文件名。
 * 一体机本机上传和手机扫码上传共用这一条，收据上的文件名才是用户选的那一份。
 */
export function restoreMultipartUtf8Filename(filename: string): string {
  if (!filename || !/[\u0080-\u00ff]/.test(filename) || [...filename].some((character) => character.codePointAt(0)! > 0xff)) {
    return filename
  }
  const bytes = Buffer.from(filename, 'latin1')
  const restored = bytes.toString('utf8')
  if (restored.includes('\uFFFD') || !Buffer.from(restored, 'utf8').equals(bytes)) return filename
  return Array.from(restored).some((character) => character.codePointAt(0)! > 0xff) ? restored : filename
}
