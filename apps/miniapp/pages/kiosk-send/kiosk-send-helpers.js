// pages/kiosk-send/kiosk-send-helpers.js
// 传文件到一体机：回执判定、错误归类、「我的文档」行。纯函数，顶层不碰 wx。
// （kiosk-send.js 加了「从我的文档选」后超过 500 行，按 CLAUDE.md §8 把纯函数拆到这里。）

const uploadName = require('../../utils/upload-name')

const MAX_BYTES = 10 * 1024 * 1024
// 与后端上传会话支持的用途一致（upload-sessions.service.ts SUPPORTED_UPLOAD_SESSION_PURPOSES）。
// 签名图那一单只收这次新传的 JPG / PNG，由后端验字节、短期留存，不进「我的文档」。
const SESSION_PURPOSES = ['resume_upload', 'print_doc', 'contract_upload', 'signature_image']
const DEAD_CODES = {
  UPLOAD_SESSION_EXPIRED: true,
  UPLOAD_SESSION_NOT_PENDING: true,
  UPLOAD_SESSION_NOT_FOUND: true,
  UPLOAD_TOKEN_INVALID: true,
}
const AUTH_CODES = {
  AUTH_REQUIRED: true,
  MEMBER_AUTH_REQUIRED: true,
  MEMBER_MISSING_TOKEN: true,
  MEMBER_SESSION_EXPIRED: true,
  MEMBER_TOKEN_INVALID: true,
}

function isSessionPurpose(value) {
  return typeof value === 'string' && SESSION_PURPOSES.indexOf(value) !== -1
}

/**
 * 请求兑现不等于已收到：utils/request.js 会把 2xx 的 {} 和 data:null 解包后兑现。
 * 只有 status=uploaded、file.fileId，且 purpose 是会话真实支持的用途（知道这一单用途时还得对得上），
 * 并且 sessionId 就是这一次，才算收到。两条路（聊天文件、我的文档）回执同形。
 */
function receiptAccepted(body, sessionId, expectedPurpose) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  if (!sessionId || body.sessionId !== sessionId) return false
  if (body.status !== 'uploaded') return false
  const file = body.file
  if (!file || typeof file !== 'object' || Array.isArray(file)) return false
  if (typeof file.fileId !== 'string' || file.fileId.trim() === '') return false
  if (!isSessionPurpose(body.purpose)) return false
  if (isSessionPurpose(expectedPurpose) && body.purpose !== expectedPurpose) return false
  return true
}

/** 签名图本机先挡：只认 JPG / PNG、单张不超过 10MB；挡不住的伪装由后端验字节拒收。返回要显示的一句，没问题回空串。 */
function signatureFileIssue(file) {
  if (!file || !/\.(?:jpe?g|png)$/i.test(String(file.name || file.path || ''))) {
    return '本人签名图片只支持 JPG / PNG，请重新选择'
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_BYTES) {
    return '请选择有效的签名图片，单个文件不能超过 10MB'
  }
  return ''
}

function statusOf(err) {
  return err && typeof err.statusCode === 'number' ? err.statusCode : -1
}

function isAuthError(err) {
  return statusOf(err) === 401 || !!(err && AUTH_CODES[err.code])
}

/** dead 码已不能再传 · busy 这张码正在收一份 · rejected 服务端明确拒收（这一单还能再收）· unknown 说不清 */
function classifySendError(err) {
  const status = statusOf(err)
  const code = err && typeof err.code === 'string' ? err.code : ''
  if (DEAD_CODES[code]) return 'dead'
  if (code === 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS' || code === 'UPLOAD_SESSION_ACTION_IN_PROGRESS') return 'busy'
  if (status === 401 || AUTH_CODES[code]) return 'unknown'
  if (status >= 400 && status < 500 && status !== 408) return 'rejected'
  return 'unknown'
}

/** 兑换失败能不能再兑换一次：请求没到服务端、超时、限流、5xx 都可以；码本身不对的不行。 */
function resolveRetryable(err) {
  if (err && err.code === 'UPLOAD_SCENE_UNUSABLE') return false
  const status = statusOf(err)
  return status === -1 || status === 408 || status === 429 || status >= 500
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value))
  } catch (_) {
    return ''
  }
}

function sizeLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function dateLabel(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 「我的文档」列得出、但服务端不许递进一体机的用途：本人数据导出包、合同审查报告
// （files.service 的本人读取对这两种一律 404）。列出来只会让人点了才知道传不过去，不列。
const NOT_SENDABLE_PURPOSES = ['member_data_export', 'contract_review_report']

/** 「我的文档」→ 可选的行。已过期的、递不进一体机的不列；超过 10MB 的列出来但不能选。 */
function docRowsOf(items, nowMs) {
  const rows = []
  ;(Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || typeof item !== 'object') return
    if (NOT_SENDABLE_PURPOSES.indexOf(item.purpose) !== -1) return
    const id = item.id == null ? '' : String(item.id).trim()
    if (!id) return
    const expiresMs = item.expiresAt ? new Date(item.expiresAt).getTime() : NaN
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) return
    const name = String(item.filename || item.originalFilename || '').trim() || '未命名文件'
    const bytes = item.sizeBytes == null ? NaN : Number(item.sizeBytes)
    const meta = [sizeLabel(bytes), dateLabel(item.createdAt)].filter(Boolean).join(' · ')
    rows.push({ id, name, meta, tooLarge: Number.isFinite(bytes) && bytes > MAX_BYTES })
  })
  return rows
}

/**
 * 拍照或从相册选回来的那张照片（#1363）→ 要传的 { file } 或一句 { error }；什么都没选回来时为 null。
 * 照片临时名没意义，按「我的文档」同一套办法起可读名；扩展名沿用临时文件的真实扩展名
 * （改了会被后端魔数校验打回），认不出扩展名就不传。
 */
function albumFileOf(res) {
  const file = ((res && res.tempFiles) || [])[0]
  if (!file || !file.tempFilePath) return null
  if (file.size > MAX_BYTES) return { error: '单个文件不能超过 10MB，请压缩后重试' }
  const ext = uploadName.extOf(file.tempFilePath)
  if (!ext) return { error: '无法识别照片格式，请重新选择' }
  return { file: { path: file.tempFilePath, name: uploadName.cameraFileName(ext), size: file.size } }
}

module.exports = {
  isSessionPurpose,
  signatureFileIssue,
  albumFileOf,
  MAX_BYTES,
  receiptAccepted,
  statusOf,
  isAuthError,
  classifySendError,
  resolveRetryable,
  safeDecode,
  docRowsOf,
}
