/**
 * 上传内容魔数(file signature)一致性校验 —— FileObject 管线共享工具。
 *
 * 背景:FileObject.mimeType 此前完全来自客户端声明,validateUpload() 只做
 * "声明 MIME ∈ purpose 白名单 + 扩展名一致",从不看真实字节。下游(pdfjs 渲染、
 * unpdf、mammoth、OCR、打印链路)都按这个不可信声明分流 —— 这是一个系统性
 * 信任边界缺口。本工具在服务端持有字节的位置(upload / writeRawUpload /
 * completeUpload)对"声明 MIME vs 文件头签名"做一致性校验。
 *
 * 能力边界(诚实声明):这是"签名/容器级一致性 + 廉价判别启发式",不是完整
 * 结构解析 —— 不解压 ZIP、不遍历 OLE 目录、不解析 ISO-BMFF box 树(完整解析
 * 属 ZIP 炸弹/复杂度面,明确不做)。因此判别并不完美:精心构造的文件仍可能
 * 混过(例如往 ZIP 里塞一个 word/ 条目名)。判别器的取舍原则是"对合法文件
 * 零误拒",宁可放过也不误杀。
 *
 * 策略:
 *   1. 可嗅探二进制类型(下表):声明 MIME 必须命中对应签名 + 廉价判别器,
 *      否则拒绝。
 *   2. 文本类(text/plain、text/markdown、application/json):没有正向签名,
 *      改做"反走私"校验 —— 文件头命中任何已知二进制容器签名、或前 512 字节
 *      含 NUL 字节的,一律拒绝(防止把二进制伪装成文本混过下游解析器)。
 *      注意反走私用的是"裸容器签名"(不带判别器),保证不因判别器收紧而放宽。
 *   3. 其他未知 MIME:放行(purpose 白名单仍是"允许哪些 MIME"的主闸门,
 *      这里不重复该职责)。
 *
 * 注意:本仓库另有两处历史手写嗅探(content/media-validation.ts 的
 * validateMedia、jobs/admin-fairs.service.ts 的 sniffMaterialMime),本轮刻意
 * 不改它们的行为;未来收敛以本文件为共享目标。
 *
 * 说明:file-type npm 包 ≥17 为 ESM-only,services/api 是 CommonJS,故手写签名。
 */

export type SniffResult = { ok: true } | { ok: false; reason: string }

/** 单个二进制签名校验器:buffer 足够长且命中签名(+ 判别器)。 */
type SignatureMatcher = (b: Buffer) => boolean

/** 前缀字节匹配(从 offset 起逐字节比较)。 */
function startsWithBytes(b: Buffer, bytes: number[], offset = 0): boolean {
  if (b.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) {
    if (b[offset + i] !== bytes[i]) return false
  }
  return true
}

// ── 裸容器签名(不含类型判别,供反走私检测复用)────────────────────────────

const isPdf: SignatureMatcher = (b) => startsWithBytes(b, [0x25, 0x50, 0x44, 0x46]) // %PDF
const isPng: SignatureMatcher = (b) =>
  startsWithBytes(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const isJpeg: SignatureMatcher = (b) => startsWithBytes(b, [0xff, 0xd8, 0xff]) // SOI + marker
// RIFF 容器('RIFF' at 0)+ 'WEBP' at 8
const isRiffWebp: SignatureMatcher = (b) =>
  startsWithBytes(b, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(b, [0x57, 0x45, 0x42, 0x50], 8)
// ISO-BMFF 容器:第 4..8 字节为 'ftyp' box 标识(MP4/MOV/HEIC/AVIF 共用)
const isIsoBmff: SignatureMatcher = (b) => startsWithBytes(b, [0x66, 0x74, 0x79, 0x70], 4)
// EBML 头 1A 45 DF A3(WebM/Matroska 共用)
const isEbml: SignatureMatcher = (b) => startsWithBytes(b, [0x1a, 0x45, 0xdf, 0xa3])
// ZIP 容器:PK\x03\x04;兼容空档案 PK\x05\x06 / 分卷 PK\x07\x08 变体
const isZip: SignatureMatcher = (b) =>
  startsWithBytes(b, [0x50, 0x4b, 0x03, 0x04]) ||
  startsWithBytes(b, [0x50, 0x4b, 0x05, 0x06]) ||
  startsWithBytes(b, [0x50, 0x4b, 0x07, 0x08])
// OLE 复合文档头 D0 CF 11 E0 A1 B1 1A E1(.doc/.xls/.ppt 共用)
const isOle: SignatureMatcher = (b) =>
  startsWithBytes(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/** 反走私用:文件头是否命中任何已知二进制"裸容器"签名(不带类型判别)。 */
const RAW_CONTAINER_SIGNATURES: SignatureMatcher[] = [
  isPdf,
  isPng,
  isJpeg,
  isRiffWebp,
  isIsoBmff,
  isEbml,
  isZip,
  isOle,
]

// ── 廉价判别器(容器 → 具体声明类型)────────────────────────────────────────

// 真实 DOCX 的 ZIP 条目名(word/document.xml 等)以未压缩 ASCII 出现在
// local-file header 与 central directory 中;XLSX 是 xl/、PPTX 是 ppt/。
// 全 buffer 扫一遍即可:实际被嗅探的 buffer 受 proxy 15MB / 直传回读 32MB
// (DIRECT_UPLOAD_SNIFF_MAX_BYTES)门限约束,单次 includes 可接受。
const DOCX_ENTRY_MARK = Buffer.from('word/', 'latin1')
// 旧版 Word 二进制强制存在的 OLE 流名(UTF-16LE);XLS 是 Workbook、PPT 是
// PowerPoint Document。只查流名存在性,不遍历 OLE 目录结构。
const OLE_WORD_STREAM = Buffer.from('WordDocument', 'utf16le')
// ISO-BMFF major brand 黑名单:已知"确定不是 MP4 视频"的 brand(HEIC/AVIF
// 图片、Apple QuickTime)。刻意用黑名单而非白名单 —— 白名单会误拒合法编码器
// 变体 brand,违反"零误拒"原则;黑名单之外一律放行(判别不完美,可接受)。
const MP4_BRAND_BLACKLIST = new Set([
  'heic',
  'heix',
  'hevc',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
  'avif',
  'avis',
  'qt  ',
])
// EBML DocType 是 ASCII,紧跟头部:WebM 写 'webm',Matroska 写 'matroska'。
const WEBM_DOCTYPE_MARK = Buffer.from('webm', 'latin1')
const WEBM_DOCTYPE_SCAN_BYTES = 4096

/**
 * 可嗅探二进制类型 → 签名 + 廉价判别器。
 * 声明为这些 MIME 的上传,真实字节必须命中对应校验器。
 * 判别器只能降低"容器对但类型不符"的混淆空间,不提供结构级保证。
 */
const BINARY_SIGNATURES: Record<string, SignatureMatcher> = {
  // PDF 规范允许头前有垃圾字节,但本仓库自产 PDF(pdfkit)与既有
  // sniffMaterialMime 都按"必须以 %PDF 开头"处理,保持一致的严格口径。
  'application/pdf': isPdf,
  'image/png': isPng,
  'image/jpeg': isJpeg,
  'image/webp': isRiffWebp,
  // MP4:ISO-BMFF 容器 + major brand(offset 8..12)不在已知非 MP4 黑名单。
  'video/mp4': (b) => {
    if (!isIsoBmff(b)) return false
    if (b.length < 12) return false // 容不下 major brand 的不可能是合法 MP4
    const brand = b.toString('latin1', 8, 12)
    return !MP4_BRAND_BLACKLIST.has(brand)
  },
  // WebM:EBML 头 + 前 4KB 内出现 ASCII 'webm'(Matroska 写的是 'matroska')。
  'video/webm': (b) =>
    isEbml(b) && b.subarray(0, WEBM_DOCTYPE_SCAN_BYTES).includes(WEBM_DOCTYPE_MARK),
  // DOCX:ZIP 容器 + 存在 'word/' 条目名(XLSX/PPTX 分别是 xl/、ppt/)。
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
    isZip(b) && b.includes(DOCX_ENTRY_MARK),
  // 旧版 .doc:OLE 容器 + 存在 UTF-16LE 'WordDocument' 流名。
  'application/msword': (b) => isOle(b) && b.includes(OLE_WORD_STREAM),
}

/** 文本类声明:无正向签名,只做"反二进制走私"校验。 */
const TEXTUAL_MIMES = new Set(['text/plain', 'text/markdown', 'application/json'])

/** 文件头是否命中任何已知二进制裸容器签名(文本走私检测用)。 */
function matchesAnyBinarySignature(b: Buffer): boolean {
  return RAW_CONTAINER_SIGNATURES.some((matcher) => matcher(b))
}

/**
 * 校验真实字节与声明 MIME 是否签名级一致(非结构级证明,见文件头注释)。
 *
 * @returns ok=false 时 reason 仅用于服务端日志/内部诊断,不直接透出给用户。
 */
export function sniffDeclaredMimeMismatch(buffer: Buffer, declaredMime: string): SniffResult {
  const matcher = BINARY_SIGNATURES[declaredMime]
  if (matcher) {
    // 可嗅探二进制类型:过短(容不下签名)、签名不符或判别器不符 → 拒绝
    if (!matcher(buffer)) {
      return { ok: false, reason: `content signature does not match declared ${declaredMime}` }
    }
    return { ok: true }
  }

  if (TEXTUAL_MIMES.has(declaredMime)) {
    if (matchesAnyBinarySignature(buffer)) {
      return { ok: false, reason: `binary signature found in content declared as ${declaredMime}` }
    }
    // 前 512 字节含 NUL → 基本可断定是二进制,拒绝(仅对文本类声明生效)
    if (buffer.subarray(0, 512).includes(0)) {
      return { ok: false, reason: `NUL byte in content declared as ${declaredMime}` }
    }
    return { ok: true }
  }

  // 未知 MIME:放行。允许哪些 MIME 由 validateUpload 的 purpose 白名单把关。
  return { ok: true }
}
