/**
 * 小程序「发给微信好友」：本人文件先下到手机，再走 wx.shareFileMessage。
 *
 * 平台不生成链接、不托管、不转交。下载只用现有的本人预览签名链接。
 * 由 verify:page-lifecycle 拉起，并因此进入 verify:static。不发网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PREVIEW_PATH = '/api/v1/files/file-1/content?sig=preview'
const PRINT_PATH = '/api/v1/files/file-1/content?sig=print'
const ABSOLUTE_PREVIEW = `https://zyidai.cn${PREVIEW_PATH}`
const DOWNLOAD_FAIL = '文件没有下载到手机，请再点一次重试'
const NO_LINK = '服务端没有返回下载链接，请再点一次重试'
const UNSUPPORTED = '当前微信版本不支持发送文件，请升级微信后再试'
const FORBIDDEN = ['投递', '分享简历链接', '发给企业', 'HR']

function readPage(rel) {
  return fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
}

function makeWx() {
  const downloads = []
  const shares = []
  const modals = []
  const toasts = []
  const api = {
    redirectTo() {},
    switchTab() {},
    navigateTo() {},
    showModal(opt) { modals.push(opt) },
    showToast(opt) { toasts.push(opt) },
    showLoading() {},
    hideLoading() {},
    downloadFile(opt) { downloads.push(opt) },
    shareFileMessage(opt) { shares.push(opt) },
  }
  return { api, downloads, shares, modals, toasts }
}

function tap(id) {
  return { currentTarget: { dataset: { id } } }
}

function doc(id, filename) {
  return { id, filename, mimeType: 'application/pdf', sizeBytes: 1200, createdAt: '2026-10-20T00:00:00.000Z' }
}

function openDocuments(items, previewOf) {
  const wx = makeWx()
  const previewCalls = []
  let pending = null
  const api = {
    getMyDocuments() {
      const list = items.map((item) => Object.assign({}, item))
      list.nextCursor = null
      return Promise.resolve(list)
    },
    getDocumentConversionCapabilities() {
      return Promise.resolve({ wordToPdf: false })
    },
    getFilePreviewUrl(fileId) {
      previewCalls.push(fileId)
      pending = deferred()
      if (previewOf) return previewOf(fileId, pending)
      return pending.promise
    },
  }
  const def = loadPageDefinition('pages/documents/documents.js', {
    wx: wx.api,
    modules: { auth: { isLoggedIn: () => true }, api },
  })
  const page = instantiate(def)
  page.onLoad()
  return {
    page,
    wx,
    previewCalls,
    pending: () => pending,
  }
}

function openExport(rel) {
  const wx = makeWx()
  const previewCalls = []
  let pending = null
  const api = {
    getFilePreviewUrl(fileId) {
      previewCalls.push(fileId)
      pending = deferred()
      return pending.promise
    },
  }
  const def = loadPageDefinition(rel, {
    wx: wx.api,
    modules: { auth: { isLoggedIn: () => true }, api },
  })
  return {
    page: instantiate(def),
    wx,
    previewCalls,
    pending: () => pending,
  }
}

function row(page, id) {
  return page.data.filtered.find((item) => item.id === id)
}

function noFakeSuccess(page, wx) {
  const dumped = JSON.stringify(page.data)
  assert.equal(dumped.includes('已发送'), false)
  assert.equal(dumped.includes('已完成'), false)
  assert.equal(wx.modals.length, 0)
  assert.equal(wx.toasts.length, 0)
}

async function readyFile(filename = '王晓雯-简历.pdf') {
  const env = openDocuments([doc('file-1', filename), doc('file-2', '学位证书.pdf')])
  await flush()
  env.page.shareToFriend(tap('file-1'))
  await flush()
  env.pending().resolve({ url: PREVIEW_PATH, printFileUrl: PRINT_PATH })
  await flush()
  env.wx.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://tmp/resume.pdf' })
  return env
}

test('下载成功后按页面显示的文件名发送，不显示已发送', async () => {
  const env = await readyFile()
  const first = row(env.page, 'file-1')
  const second = row(env.page, 'file-2')
  assert.equal(first.name, '王晓雯-简历.pdf')
  assert.equal(first.friendPhase, 'ready')
  assert.equal(first.friendBusy, false)
  assert.equal(first.friendMessage, '')
  assert.equal(second.friendPhase, 'idle', '另一份文件不被带着变成可发送')
  assert.equal(env.wx.downloads.length, 1)
  assert.equal(env.wx.downloads[0].url, ABSOLUTE_PREVIEW)
  assert.equal(env.wx.downloads[0].url.includes('sig=print'), false)

  env.page.shareToFriend(tap('file-1'))
  assert.equal(env.wx.shares.length, 1)
  assert.equal(env.wx.shares[0].fileName, '王晓雯-简历.pdf')
  assert.equal(env.wx.shares[0].filePath, 'wxfile://tmp/resume.pdf')
  assert.notEqual(env.wx.shares[0].fileName, 'file-1')
  env.wx.shares[0].success()
  assert.equal(row(env.page, 'file-1').friendPhase, 'ready')
  assert.equal(row(env.page, 'file-1').friendMessage, '')
  noFakeSuccess(env.page, env.wx)

  const sameName = await readyFile('file-1')
  sameName.page.shareToFriend(tap('file-1'))
  assert.equal(sameName.wx.shares.length, 1, '显示名碰巧等于编号时仍然发送')
  assert.equal(sameName.wx.shares[0].fileName, 'file-1')
})

test('下载中不能重复取链接', async () => {
  const env = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  env.page.shareToFriend(tap('file-1'))
  env.page.shareToFriend(tap('file-1'))
  await flush()
  assert.equal(env.previewCalls.length, 1)
  assert.equal(env.previewCalls[0], 'file-1')
  assert.equal(row(env.page, 'file-1').friendPhase, 'downloading')
  assert.equal(row(env.page, 'file-1').friendBusy, true)
  assert.equal(row(env.page, 'file-1').friendPhase === 'ready' ? '发送给微信好友' : '发给微信好友', '发给微信好友')
  env.pending().resolve({ url: PREVIEW_PATH, previewUrl: PRINT_PATH, printFileUrl: PRINT_PATH })
  await flush()
  assert.equal(env.wx.downloads.length, 1)
  assert.equal(env.wx.downloads[0].url, ABSOLUTE_PREVIEW)
})

test('下载失败照实说明并且可以重试', async () => {
  const network = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  network.page.shareToFriend(tap('file-1'))
  await flush()
  network.pending().resolve({ url: ABSOLUTE_PREVIEW, printFileUrl: PRINT_PATH })
  await flush()
  network.wx.downloads[0].fail({ errMsg: 'downloadFile:fail timeout' })
  assert.equal(row(network.page, 'file-1').friendMessage, DOWNLOAD_FAIL)
  assert.equal(row(network.page, 'file-1').friendMessage.includes('downloadFile:fail'), false)
  assert.equal(row(network.page, 'file-1').friendPhase, 'idle')
  assert.equal(row(network.page, 'file-1').friendBusy, false)
  noFakeSuccess(network.page, network.wx)
  network.page.shareToFriend(tap('file-1'))
  await flush()
  assert.equal(network.previewCalls.length, 2, '失败后可以再点一次')

  const status = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  status.page.shareToFriend(tap('file-1'))
  await flush()
  status.pending().resolve({ url: ABSOLUTE_PREVIEW })
  await flush()
  status.wx.downloads[0].success({ statusCode: 404, tempFilePath: 'wxfile://tmp/missing.pdf' })
  assert.equal(row(status.page, 'file-1').friendMessage, '文件没有下载到手机（404），请再点一次重试')
  assert.equal(row(status.page, 'file-1').friendPhase, 'idle')

  const domain = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  domain.page.shareToFriend(tap('file-1'))
  await flush()
  domain.pending().resolve({ url: ABSOLUTE_PREVIEW })
  await flush()
  domain.wx.downloads[0].fail({ errMsg: 'downloadFile:fail url not in domain list' })
  assert.equal(row(domain.page, 'file-1').friendMessage, '文件没有下载到手机：当前微信还不允许从这个地址下载，请稍后再试')
  assert.equal(row(domain.page, 'file-1').friendMessage.includes('not in domain list'), false)

  const empty = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  empty.page.shareToFriend(tap('file-1'))
  await flush()
  empty.pending().resolve({ url: '  ', printFileUrl: `https://zyidai.cn${PRINT_PATH}` })
  await flush()
  assert.equal(empty.wx.downloads.length, 0)
  assert.equal(row(empty.page, 'file-1').friendMessage, NO_LINK)
  assert.equal(row(empty.page, 'file-1').friendPhase, 'idle')

  const owned = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  owned.page.shareToFriend(tap('file-1'))
  await flush()
  owned.pending().reject(Object.assign(new Error('这份文件不属于当前账号'), { code: 'FORBIDDEN' }))
  await flush()
  assert.equal(row(owned.page, 'file-1').friendMessage, '这份文件不属于当前账号')
  assert.equal(row(owned.page, 'file-1').friendPhase, 'idle')

  const machine = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  machine.page.shareToFriend(tap('file-1'))
  await flush()
  machine.pending().reject(new Error('FILE_NOT_FOUND'))
  await flush()
  assert.equal(row(machine.page, 'file-1').friendMessage, DOWNLOAD_FAIL)
  assert.equal(row(machine.page, 'file-1').friendMessage.includes('FILE_NOT_FOUND'), false)
})

test('基础库不支持发送文件时提示升级微信', async () => {
  const env = await readyFile()
  delete env.wx.api.shareFileMessage
  let thrown = null
  try {
    env.page.shareToFriend(tap('file-1'))
  } catch (err) {
    thrown = err
  }
  assert.equal(thrown, null)
  assert.equal(row(env.page, 'file-1').friendMessage, UNSUPPORTED)
  assert.equal(row(env.page, 'file-1').friendPhase, 'ready')
  assert.equal(row(env.page, 'file-1').friendBusy, false)
  assert.equal(env.wx.shares.length, 0)
  noFakeSuccess(env.page, env.wx)
})

test('用户取消发送不算失败', async () => {
  const env = await readyFile()
  env.page.shareToFriend(tap('file-1'))
  env.wx.shares[0].fail({ errMsg: 'shareFileMessage:fail cancel' })
  assert.equal(row(env.page, 'file-1').friendMessage, '')
  assert.equal(row(env.page, 'file-1').friendPhase, 'ready')
  noFakeSuccess(env.page, env.wx)

  const other = await readyFile()
  other.page.shareToFriend(tap('file-1'))
  other.wx.shares[0].fail({ errMsg: 'shareFileMessage:fail' })
  assert.equal(row(other.page, 'file-1').friendPhase, 'ready')
  assert.equal(row(other.page, 'file-1').friendMessage.includes('已发送'), false)
  assert.equal(row(other.page, 'file-1').friendMessage.includes('shareFileMessage'), false)
  assert.match(row(other.page, 'file-1').friendMessage, /[\u4e00-\u9fa5]/)
  other.page.shareToFriend(tap('file-1'))
  assert.equal(other.wx.shares.length, 2, '没发出去之后还能再点发送')
})

test('离开页面后迟到的下载回调不改页面', async () => {
  const lateFile = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  lateFile.page.shareToFriend(tap('file-1'))
  await flush()
  lateFile.pending().resolve({ url: PREVIEW_PATH, printFileUrl: PRINT_PATH })
  await flush()
  assert.equal(lateFile.wx.downloads.length, 1)
  lateFile.page.onUnload()
  const writes = []
  const orig = lateFile.page.setData
  lateFile.page.setData = function setData(patch, callback) {
    writes.push(patch)
    return orig.call(this, patch, callback)
  }
  lateFile.wx.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://tmp/late.pdf' })
  assert.equal(writes.length, 0)
  assert.equal(row(lateFile.page, 'file-1').friendPhase, 'downloading')

  const lateLink = openDocuments([doc('file-1', '王晓雯-简历.pdf')])
  await flush()
  lateLink.page.shareToFriend(tap('file-1'))
  await flush()
  lateLink.page.onUnload()
  const linkWrites = []
  const origLink = lateLink.page.setData
  lateLink.page.setData = function setData(patch, callback) {
    linkWrites.push(patch)
    return origLink.call(this, patch, callback)
  }
  lateLink.pending().resolve({ url: PREVIEW_PATH })
  await flush()
  assert.equal(lateLink.wx.downloads.length, 0)
  assert.equal(linkWrites.length, 0)
  assert.equal(row(lateLink.page, 'file-1').friendPhase, 'downloading')

  const diagnose = openExport('pages/resume-diagnose/resume-diagnose.js')
  diagnose.page.setData({
    exportResult: { fileId: 'diag-1', filename: '诊断报告.pdf', savedToDocuments: true },
  })
  diagnose.page.shareToFriend({})
  await flush()
  diagnose.pending().resolve({ url: PREVIEW_PATH })
  await flush()
  assert.equal(diagnose.wx.downloads.length, 1)
  diagnose.page.onUnload()
  const diagnoseWrites = []
  const origDiagnose = diagnose.page.setData
  diagnose.page.setData = function setData(patch, callback) {
    diagnoseWrites.push(patch)
    return origDiagnose.call(this, patch, callback)
  }
  diagnose.wx.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://tmp/diag.pdf' })
  assert.equal(diagnoseWrites.length, 0)
  assert.equal(diagnose.page.data.exportShare.phase, 'downloading')
})

test('诊断和优化的导出文件走同一套发送', async () => {
  const anon = openExport('pages/resume-diagnose/resume-diagnose.js')
  anon.page.setData({
    exportResult: { fileId: 'diag-anon', filename: '诊断报告.pdf', savedToDocuments: false },
  })
  anon.page.shareToFriend({})
  await flush()
  assert.equal(anon.previewCalls.length, 0)
  assert.equal(anon.wx.downloads.length, 0)
  assert.equal(anon.wx.shares.length, 0)

  const diagnose = openExport('pages/resume-diagnose/resume-diagnose.js')
  diagnose.page.setData({
    exportResult: { fileId: 'diag-1', filename: '诊断报告.pdf', savedToDocuments: true },
  })
  diagnose.page.shareToFriend({})
  await flush()
  assert.deepEqual(diagnose.previewCalls, ['diag-1'])
  diagnose.pending().resolve({ url: '/api/v1/files/diag-1/content?sig=preview', printFileUrl: '/api/v1/files/diag-1/content?sig=print' })
  await flush()
  assert.equal(diagnose.wx.downloads[0].url, 'https://zyidai.cn/api/v1/files/diag-1/content?sig=preview')
  diagnose.wx.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://tmp/diag.pdf' })
  assert.equal(diagnose.page.data.exportShare.phase, 'ready')
  diagnose.page.shareToFriend({})
  assert.equal(diagnose.wx.shares[0].fileName, '诊断报告.pdf')
  assert.notEqual(diagnose.wx.shares[0].fileName, 'diag-1')

  const optimize = openExport('pages/resume-optimize/resume-optimize.js')
  optimize.page.setData({
    exportResult: { fileId: 'opt-1', filename: '优化稿.docx', savedToDocuments: true },
  })
  optimize.page.shareToFriend({})
  await flush()
  assert.deepEqual(optimize.previewCalls, ['opt-1'])
  optimize.pending().resolve({ previewUrl: 'https://zyidai.cn/api/v1/files/opt-1/content?sig=preview', printFileUrl: 'https://zyidai.cn/api/v1/files/opt-1/content?sig=print' })
  await flush()
  assert.equal(optimize.wx.downloads[0].url, 'https://zyidai.cn/api/v1/files/opt-1/content?sig=preview')
  optimize.wx.downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://tmp/opt.docx' })
  optimize.page.shareToFriend({})
  assert.equal(optimize.wx.shares[0].fileName, '优化稿.docx')
  assert.notEqual(optimize.wx.shares[0].fileName, 'opt-1')
  optimize.wx.shares[0].fail({ errMsg: 'shareFileMessage:fail cancel' })
  assert.equal(optimize.page.data.exportShare.message, '')
  assert.equal(optimize.page.data.exportShare.phase, 'ready')
})

test('按钮文案只有发给微信好友和发送给微信好友', () => {
  const files = [
    'pages/documents/documents.wxml',
    'pages/documents/documents.js',
    'pages/resume-diagnose/resume-diagnose.wxml',
    'pages/resume-diagnose/resume-diagnose.js',
    'pages/resume-optimize/resume-optimize.wxml',
    'pages/resume-optimize/resume-optimize.js',
    'utils/share-friend.js',
  ].map((rel) => readPage(rel))
  const documentsWxml = files[0]
  const diagnoseWxml = files[2]
  const optimizeWxml = files[4]
  assert.match(documentsWxml, /catchtap="shareToFriend"/)
  assert.match(documentsWxml, /class="doc-action \{\{item\.friendBusy \? 'is-disabled' : ''\}\}"/)
  assert.match(documentsWxml, /item\.friendPhase === 'ready' \? '发送给微信好友' : '发给微信好友'/)
  assert.match(diagnoseWxml, /wx:if="\{\{exportResult\.savedToDocuments\}\}"/)
  assert.match(diagnoseWxml, /class="btn ghost"/)
  assert.match(diagnoseWxml, /exportShare\.phase === 'ready' \? '发送给微信好友' : '发给微信好友'/)
  assert.match(optimizeWxml, /class="btn ghost tap \{\{exportShare\.busy \? 'disabled' : ''\}\}"/)
  assert.match(optimizeWxml, /exportShare\.phase === 'ready' \? '发送给微信好友' : '发给微信好友'/)
  for (const src of files) {
    for (const word of FORBIDDEN) assert.equal(src.includes(word), false, word)
    assert.equal(src.includes('分享简历'), false)
    assert.equal(src.includes('已发送'), false)
  }
})
