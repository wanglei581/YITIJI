// 本人文件发给微信好友：先下载到手机，再调 wx.shareFileMessage。
// 平台不生成链接、不托管、不转交。下载链接只用现有的本人预览/下载签名接口。
//
// wx 由页面方法传入。本文件会被页面沙箱以真实模块加载，不能自己读沙箱里的 wx。

const fileUrls = require('./file-url')

const DOWNLOAD_LABEL = '发给微信好友'
const SEND_LABEL = '发送给微信好友'
const UNSUPPORTED_COPY = '当前微信版本不支持发送文件，请升级微信后再试'
const DOWNLOAD_FAIL_COPY = '文件没有下载到手机，请再点一次重试'
const NO_LINK_COPY = '服务端没有返回下载链接，请再点一次重试'
const SEND_FAIL_COPY = '没有发送出去，请再点一次'

function viewSlot(slot) {
  const ready = !!(slot && slot.phase === 'ready' && slot.tempFilePath)
  const busy = !!(slot && slot.phase === 'downloading')
  return {
    phase: ready ? 'ready' : (busy ? 'downloading' : 'idle'),
    busy,
    message: (slot && slot.message) || '',
  }
}

// 按这一份文件自己的编号取按钮状态。没有编号、或这份还没开始下载，就是初始态。
function viewForFile(page, fileId) {
  const id = String(fileId || '')
  if (!id) return viewSlot(null)
  return viewSlot(slotOf(page, id))
}

const EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'text/plain': '.txt',
}

const EXT_BY_TOKEN = {
  pdf: '.pdf',
  doc: '.doc',
  docx: '.docx',
  png: '.png',
  jpg: '.jpg',
  jpeg: '.jpg',
  txt: '.txt',
}

function existingExtension(name) {
  const leaf = String(name || '').trim()
  const slash = Math.max(leaf.lastIndexOf('/'), leaf.lastIndexOf('\\'))
  const base = slash >= 0 ? leaf.slice(slash + 1) : leaf
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot >= base.length - 1) return ''
  const suffix = base.slice(dot)
  if (!/^\.[A-Za-z0-9]{1,8}$/.test(suffix)) return ''
  return suffix
}

function tokenExtension(value) {
  const token = String(value || '').trim().toLowerCase().replace(/^\./, '')
  return EXT_BY_TOKEN[token] || ''
}

// 只认列表项 / 导出结果上已经有的类型。对不上就不补，不用 .bin 这类猜出来的后缀。
function trustedExtension(source) {
  if (!source || typeof source !== 'object') return ''
  const mime = String(source.mimeType || source.mime || source.contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime]
  const tokens = [source.format, source.fileFormat, source.formatLabel]
  for (let i = 0; i < tokens.length; i += 1) {
    const ext = tokenExtension(tokens[i])
    if (ext) return ext
  }
  const originals = [source.originalFilename, source.originalName, source.sourceFilename]
  for (let i = 0; i < originals.length; i += 1) {
    const ext = tokenExtension(existingExtension(originals[i]))
    if (ext) return ext
  }
  return ''
}

function shareFileName(displayName, source) {
  const name = String(displayName || '').trim()
  if (!name) return ''
  if (existingExtension(name)) return name
  const ext = trustedExtension(source)
  return ext ? name + ext : name
}

function ensure(page) {
  if (!page._friendShares) page._friendShares = Object.create(null)
  return page._friendShares
}

function slotOf(page, fileId) {
  const shares = page && page._friendShares
  return shares && shares[fileId]
}

function still(page, fileId, token) {
  if (!page || page._shareGone) return false
  const slot = slotOf(page, fileId)
  return !!(slot && slot.token === token && slot.phase === 'downloading')
}

function stamp(list, page) {
  const shares = (page && page._friendShares) || {}
  return (list || []).map((item) => {
    const view = viewSlot(item && shares[item.id])
    return Object.assign({}, item, {
      friendPhase: view.phase,
      friendBusy: view.busy,
      friendMessage: view.message,
    })
  })
}

function targetFrom(page, event) {
  const dataset = event && event.currentTarget && event.currentTarget.dataset
  const id = dataset ? String(dataset.id || '') : ''
  if (id) {
    const pools = [page.data && page.data.all, page.data && page.data.filtered]
    for (let i = 0; i < pools.length; i += 1) {
      const list = pools[i]
      if (!Array.isArray(list)) continue
      const item = list.find((entry) => entry && String(entry.id) === id)
      if (!item) continue
      const fileName = shareFileName(item.name, item)
      if (!fileName) return null
      return { fileId: String(item.id), fileName }
    }
    return null
  }
  const result = page.data && page.data.exportResult
  if (!result || result.savedToDocuments === false) return null
  const fileId = String(result.fileId || '')
  const fileName = shareFileName(result.filename, result)
  if (!fileId || !fileName) return null
  return { fileId, fileName }
}

function userText(err, fallback) {
  const message = err && typeof err.message === 'string' ? err.message.trim() : ''
  if (!message) return fallback
  if (/^[A-Z][A-Z0-9_]+$/.test(message)) return fallback
  if (/^(HTTP\s|request:|downloadFile:)/i.test(message)) return fallback
  return message
}

function downloadFailText(err) {
  const raw = String((err && (err.errMsg || err.message)) || '')
  if (/domain list|合法域名|not in domain/i.test(raw)) {
    return '文件没有下载到手机：当前微信还不允许从这个地址下载，请稍后再试'
  }
  return DOWNLOAD_FAIL_COPY
}

function statusFailText(statusCode) {
  const code = Number(statusCode)
  if (Number.isFinite(code) && code > 0) return `文件没有下载到手机（${code}），请再点一次重试`
  return DOWNLOAD_FAIL_COPY
}

function isShareCancel(err) {
  const raw = String((err && (err.errMsg || err.message)) || '')
  return /cancel/i.test(raw)
}

function shownExportFileId(page) {
  const result = page && page.data && page.data.exportResult
  if (!result || result.savedToDocuments === false) return ''
  return String(result.fileId || '')
}

// 列表按每份文件自己的缓存重画。导出页只有一个按钮：迟到回调不是当前这份文件时，
// 只许改那一份的缓存，不能把当前按钮改成上一份的「下载中」或「发送给微信好友」。
function repaint(page, fileId) {
  if (!page || page._shareGone || typeof page.setData !== 'function') return
  if (typeof page.applyFilter === 'function' && Array.isArray(page.data && page.data.all)) {
    page.applyFilter(page.data.activeFilter || 'all', page.data.all)
  }
  const currentId = shownExportFileId(page)
  if (!currentId || String(fileId || '') !== currentId) return
  page.setData({ exportShare: viewForFile(page, currentId) })
}

function failDownload(page, fileId, token, message) {
  if (!still(page, fileId, token)) return
  page._friendShares[fileId] = {
    phase: 'idle',
    tempFilePath: '',
    message,
    fileName: '',
    token,
  }
  repaint(page, fileId)
}

function rememberReady(page, target, token, tempFilePath) {
  if (!still(page, target.fileId, token)) return
  page._friendShares[target.fileId] = {
    phase: 'ready',
    tempFilePath,
    message: '',
    fileName: target.fileName,
    token,
  }
  repaint(page, target.fileId)
}

function download(page, target, wxApi, getPreviewUrl) {
  const shares = ensure(page)
  const prev = shares[target.fileId]
  const token = (prev && prev.token ? prev.token : 0) + 1
  shares[target.fileId] = {
    phase: 'downloading',
    tempFilePath: '',
    message: '',
    fileName: target.fileName,
    token,
  }
  repaint(page, target.fileId)
  Promise.resolve()
    .then(() => getPreviewUrl(target.fileId))
    .then((res) => {
      if (!still(page, target.fileId, token)) return
      const url = fileUrls.absoluteUrl(res && (res.url || res.previewUrl))
      if (!url) {
        failDownload(page, target.fileId, token, NO_LINK_COPY)
        return
      }
      wxApi.downloadFile({
        url,
        success: (dl) => {
          if (!still(page, target.fileId, token)) return
          if (!dl || dl.statusCode !== 200 || !dl.tempFilePath) {
            failDownload(page, target.fileId, token, statusFailText(dl && dl.statusCode))
            return
          }
          rememberReady(page, target, token, dl.tempFilePath)
        },
        fail: (err) => {
          if (!still(page, target.fileId, token)) return
          failDownload(page, target.fileId, token, downloadFailText(err))
        },
      })
    })
    .catch((err) => {
      failDownload(page, target.fileId, token, userText(err, DOWNLOAD_FAIL_COPY))
    })
}

function markSendMessage(page, fileId, message) {
  if (!page || page._shareGone) return
  const slot = slotOf(page, fileId)
  if (!slot || slot.phase !== 'ready' || !slot.tempFilePath) return
  slot.message = message
  repaint(page, fileId)
}

function send(page, target, slot, wxApi) {
  if (!page || page._shareGone) return
  if (!wxApi || typeof wxApi.shareFileMessage !== 'function') {
    markSendMessage(page, target.fileId, UNSUPPORTED_COPY)
    return
  }
  wxApi.shareFileMessage({
    filePath: slot.tempFilePath,
    fileName: target.fileName,
    success: () => {
      if (!page || page._shareGone) return
      const current = slotOf(page, target.fileId)
      if (!current || current.phase !== 'ready' || !current.message) return
      current.message = ''
      repaint(page, target.fileId)
    },
    fail: (err) => {
      if (!page || page._shareGone) return
      if (isShareCancel(err)) return
      markSendMessage(page, target.fileId, SEND_FAIL_COPY)
    },
  })
}

function onTap(page, event, wxApi, getPreviewUrl) {
  if (!page || page._shareGone) return
  const target = targetFrom(page, event)
  if (!target || typeof getPreviewUrl !== 'function') return
  const slot = slotOf(page, target.fileId)
  if (slot && slot.phase === 'downloading') return
  if (slot && slot.phase === 'ready' && slot.tempFilePath) {
    send(page, target, slot, wxApi)
    return
  }
  download(page, target, wxApi, getPreviewUrl)
}

function abandon(page) {
  if (!page) return
  page._shareGone = true
}

module.exports = {
  DOWNLOAD_LABEL,
  SEND_LABEL,
  UNSUPPORTED_COPY,
  DOWNLOAD_FAIL_COPY,
  stamp,
  viewForFile,
  onTap,
  abandon,
}
