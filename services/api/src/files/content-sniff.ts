/**
 * 上传内容魔数(file signature)校验 —— FileObject 管线共享工具。
 *
 * 背景:FileObject.mimeType 此前完全来自客户端声明,validateUpload() 只做
 * "声明 MIME ∈ purpose 白名单 + 扩展名一致",从不看真实字节。下游(pdfjs 渲染、
 * unpdf、mammoth、OCR、打印链路)都按这个不可信声明分流 —— 这是一个系统性
 * 信任边界缺口。本工具在服务端持有字节的位置(upload / writeRawUpload /
 * completeUpload)对"声明 MIME vs 真实文件头"做一致性校验。
 *
 * 策略:
 *   1. 可嗅探二进制类型(下表):声明 MIME 必须与文件头魔数一致,否则拒绝。
 *   2. 文本类(text/plain、text/markdown、application/json):没有正向签名,
 *      改做"反走私"校验 —— 文件头命中任何已知二进制魔数、或前 512 字节含
 *      NUL 字节的,一律拒绝(防止把二进制伪装成文本混过下游解析器)。
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

/** 单个二进制魔数校验器:buffer 足够长且文件头匹配。 */
type SignatureMatcher = (b: Buffer) => boolean

/** 前缀字节匹配(从 offset 起逐字节比较)。 */
function startsWithBytes(b: Buffer, bytes: number[], offset = 0): boolean {
  if (b.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) {
    if (b[offset + i] !== bytes[i]) return false
  }
  return true
}

/**
 * 可嗅探二进制类型 → 魔数校验器。
 * 声明为这些 MIME 的上传,真实字节必须命中对应签名。
 */
const BINARY_SIGNATURES: Record<string, SignatureMatcher> = {
  // %PDF(25 50 44 46)。PDF 规范允许头前有垃圾字节,但本仓库自产 PDF(pdfkit)
  // 与既有 sniffMaterialMime 都按"必须以 %PDF 开头"处理,保持一致的严格口径。
  'application/pdf': (b) => startsWithBytes(b, [0x25, 0x50, 0x44, 0x46]),
  // PNG 固定 8 字节签名 89 50 4E 47 0D 0A 1A 0A
  'image/png': (b) => startsWithBytes(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  // JPEG SOI + 首个 marker:FF D8 FF
  'image/jpeg': (b) => startsWithBytes(b, [0xff, 0xd8, 0xff]),
  // WebP:RIFF 容器('RIFF' at 0)+ 'WEBP' at 8
  'image/webp': (b) =>
    startsWithBytes(b, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(b, [0x57, 0x45, 0x42, 0x50], 8),
  // MP4(ISO BMFF):第 4..8 字节为 'ftyp' box 标识
  'video/mp4': (b) => startsWithBytes(b, [0x66, 0x74, 0x79, 0x70], 4),
  // WebM(Matroska/EBML)头:1A 45 DF A3
  'video/webm': (b) => startsWithBytes(b, [0x1a, 0x45, 0xdf, 0xa3]),
  // DOCX = ZIP 容器:PK\x03\x04;兼容空档案 PK\x05\x06 / 分卷 PK\x07\x08 变体
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
    startsWithBytes(b, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(b, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(b, [0x50, 0x4b, 0x07, 0x08]),
  // 旧版 .doc:OLE 复合文档头 D0 CF 11 E0 A1 B1 1A E1
  'application/msword': (b) =>
    startsWithBytes(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
}

/** 文本类声明:无正向签名,只做"反二进制走私"校验。 */
const TEXTUAL_MIMES = new Set(['text/plain', 'text/markdown', 'application/json'])

/** 文件头是否命中任何已知二进制魔数(文本走私检测用)。 */
function matchesAnyBinarySignature(b: Buffer): boolean {
  for (const matcher of Object.values(BINARY_SIGNATURES)) {
    if (matcher(b)) return true
  }
  return false
}

/**
 * 校验真实字节与声明 MIME 是否一致。
 *
 * @returns ok=false 时 reason 仅用于服务端日志/内部诊断,不直接透出给用户。
 */
export function sniffDeclaredMimeMismatch(buffer: Buffer, declaredMime: string): SniffResult {
  const matcher = BINARY_SIGNATURES[declaredMime]
  if (matcher) {
    // 可嗅探二进制类型:过短(容不下签名)或魔数不符 → 拒绝
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
