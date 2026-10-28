// pages/kiosk-send/kiosk-send-helpers.js
// 传文件到一体机：回执判定、错误归类、「我的文档」行。纯函数，顶层不碰 wx。
// （kiosk-send.js 加了「从我的文档选」后超过 500 行，按 CLAUDE.md §8 把纯函数拆到这里。）

const MAX_BYTES = 10 * 1024 * 1024
// 与一体机 phoneUploadModel.receiptOf 的 SESSION_PURPOSES 相同。
// signature_image 能出现在文件用途里，但创建上传会话的 DTO 不接受它。
const SESSION_PURPOSES = ['resume_upload', 'print_doc', 'contract_upload']
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
 * 只有 status=uploaded、file.fileId，且 purpose 是会话真实支持的三种用途，
 * 并且 sessionId 就是这一次，才算收到。两条路（聊天文件、我的文档）回执同形。
 */
function receiptAccepted(body, sessionId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  if (!sessionId || body.sessionId !== sessionId) return false
  if (body.status !== 'uploaded') return false
  const file = body.file
  if (!file || typeof file !== 'object' || Array.isArray(file)) return false
  if (typeof file.fileId !== 'string' || file.fileId.trim() === '') return false
  if (!isSessionPurpose(body.purpose)) return false
  return true
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

/** 「我的文档」→ 可选的行。已过期的不列；超过 10MB 的列出来但不能选。 */
function docRowsOf(items, nowMs) {
  const rows = []
  ;(Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || typeof item !== 'object') return
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

module.exports = {
  MAX_BYTES,
  receiptAccepted,
  statusOf,
  isAuthError,
  classifySendError,
  resolveRetryable,
  safeDecode,
  docRowsOf,
}
