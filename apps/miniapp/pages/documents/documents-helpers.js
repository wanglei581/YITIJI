const WORD_CONVERSION_UNAVAILABLE_COPY = 'Word 转换暂未开放，请另存为 PDF 上传'
const WORD_CONVERSION_DISCLOSURE = '由转换引擎生成，复杂版式可能有偏差，请预览核对'
const DOCUMENT_NOT_REPRINTABLE_COPY = '该报告仅可查看，不可打印'
const WORD_EXTENSIONS = ['doc', 'docx']
const WORD_MIME_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const CONVERSION_MESSAGE_CODES = {
  AUTH_REQUIRED: '请先登录',
  CONVERSION_UNAVAILABLE: true,
  CONVERSION_ENGINE_UNAVAILABLE: true,
  CONVERSION_TIMEOUT: true,
  CONVERSION_FAILED: true,
  UNSUPPORTED_FILE_TYPE: true,
}

function isWordDocument(item) {
  const mimeType = String((item && item.mimeType) || '').split(';')[0].trim().toLowerCase()
  const format = String((item && item.format) || '').trim().replace(/^\./, '').toLowerCase()
  const name = String((item && (item.filename || item.fileName || item.name)) || '')
  const extension = (name.toLowerCase().match(/\.([^.]+)$/) || [])[1] || ''
  return WORD_MIME_TYPES.indexOf(mimeType) !== -1
    || WORD_EXTENSIONS.indexOf(format) !== -1
    || WORD_EXTENSIONS.indexOf(extension) !== -1
}

function isDocumentReprintable(item) {
  if (!item) return true
  if (item.purpose === 'contract_review_report') return false
  return item.reprintable !== false
}

function displayableServerMessage(message) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text || text.length > 60) return ''
  if (!/[\u4e00-\u9fa5]/.test(text)) return ''
  if (/^(HTTP\s|请求失败)/.test(text)) return ''
  return text
}

function conversionUserMessage(err) {
  const code = err && err.code
  if (code === 'AUTH_REQUIRED' || (err && err.statusCode === 401)) return CONVERSION_MESSAGE_CODES.AUTH_REQUIRED
  if (CONVERSION_MESSAGE_CODES[code] === true) {
    return displayableServerMessage(err && err.message) || 'Word 转 PDF 失败，请稍后重试'
  }
  return 'Word 转 PDF 失败，请稍后重试'
}

function formatConvertResult(raw, sourceFile) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const expiresAt = typeof source.expiresAt === 'string' ? source.expiresAt : ''
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : NaN
  const pageCount = Number(source.pageCount)
  const sizeBytes = Number(source.sizeBytes)
  const warnings = Array.isArray(source.warnings)
    ? source.warnings.filter((item) => typeof item === 'string' && item.trim())
    : []
  return {
    fileId: String(source.fileId || ''),
    filename: String(source.filename || ''),
    pageCount: pageCount > 0 ? pageCount : 0,
    pageLabel: pageCount > 0 ? `${pageCount} 页` : '页数未知',
    sizeLabel: Number.isFinite(sizeBytes) && sizeBytes > 0
      ? (sizeBytes < 1024 ? `${sizeBytes} B` : sizeBytes < 1024 * 1024 ? `${Math.round(sizeBytes / 1024)} KB` : `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`)
      : '大小未知',
    expiresAt,
    expiresMs: Number.isFinite(expiresMs) ? expiresMs : 0,
    warnings,
    disclosure: WORD_CONVERSION_DISCLOSURE,
    reprintable: isDocumentReprintable(sourceFile),
  }
}

function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(value) {
  if (value === null || value === undefined || value === '') return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatExpiry(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `有效至 ${formatTime(value)}`
}

const RETENTION_LABEL = {
  months_3: '保存 3 个月',
  months_6: '保存 6 个月',
  long_term: '长期保存',
  system_short: '按系统短期策略',
}
const RETENTION_CONSENT_VERSION = 'file-retention-v1'
const RETENTION_NEEDS_CONSENT = ['months_6', 'long_term']

function toView(item) {
  const filename = item.filename || item.originalFilename || '未命名文件'
  const ext = filename.includes('.') ? filename.split('.').pop().slice(0, 5).toUpperCase() : 'FILE'
  const mime = String(item.mimeType || '')
  const kind = mime.startsWith('image/') ? 'img' : (mime === 'application/pdf' ? 'pdf' : 'doc')
  const allowed = Array.isArray(item.allowedRetentionPolicies) ? item.allowedRetentionPolicies : []
  return {
    id: String(item.id || ''),
    name: filename,
    kind,
    ext,
    size: formatSize(item.sizeBytes),
    time: formatTime(item.createdAt),
    type: item.assetCategory || 'original',
    expire: formatExpiry(item.expiresAt),
    pages: Number(item.pageCount) > 0 ? Number(item.pageCount) : 0,
    isImage: kind === 'img',
    retentionPolicy: item.retentionPolicy || null,
    retentionLabel: RETENTION_LABEL[item.retentionPolicy] || '按系统策略',
    allowedRetentionPolicies: allowed,
    retentionLocked: allowed.length <= 1,
    purpose: item.purpose || '',
    mimeType: mime,
    reprintable: isDocumentReprintable(item),
    isWord: isWordDocument({ filename, mimeType: mime }),
  }
}

function remainingLabel(expiresMs, nowMs) {
  if (!Number.isFinite(expiresMs) || expiresMs <= 0) return { expired: false, text: '有效期未返回' }
  if (expiresMs <= nowMs) return { expired: true, text: '预览链接已过期' }
  const totalSeconds = Math.max(0, Math.ceil((expiresMs - nowMs) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const text = minutes <= 0
    ? `预览剩余 ${seconds} 秒`
    : `预览剩余 ${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`
  return { expired: false, text }
}

module.exports = {
  WORD_CONVERSION_UNAVAILABLE_COPY,
  WORD_CONVERSION_DISCLOSURE,
  DOCUMENT_NOT_REPRINTABLE_COPY,
  RETENTION_LABEL,
  RETENTION_CONSENT_VERSION,
  RETENTION_NEEDS_CONSENT,
  isWordDocument,
  isDocumentReprintable,
  conversionUserMessage,
  formatConvertResult,
  remainingLabel,
  toView,
}
