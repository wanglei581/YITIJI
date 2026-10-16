/**
 * 「打开原文」回归：utils/file-url.js 的 openSignedDocument，以及用它的两个页面
 * （print-preview、documents）。全部真跑源码，wx 用可控替身。
 *
 * 守的是 10/16 打印验收时「小程序打不开原文」暴露出来的几件事：
 *   - 预览链接是短期签名链接，每次打开都要现取，过期（401 / 403）只重取一次；
 *   - 下载域名没配（downloadFile 报 url not in domain list）时不重试，并说清原因；
 *   - 交给 wx.openDocument 的 fileType 由服务端 mime / 文件名推出来；
 *   - 失败文字里不出现链接本身；任何失败都要收起「正在打开」。
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const fileUrls = requireMiniapp('./file-url.js')
const config = requireMiniapp('./config.js')
const TEXT = fileUrls.PREVIEW_FAILURE_TEXT

const COS_URL = 'https://bucket-example-1250000000.cos.ap-guangzhou.myqcloud.com/print/f1?q-sign-algorithm=sha1&q-signature=abc'
const DOMAIN_ERR = 'downloadFile:fail url not in domain list'

/**
 * wx 替身。downloads 是每次 downloadFile 的结局，按调用顺序取：
 *   { status, tempFilePath } → success；{ errMsg } → fail。
 */
function fakeWx({ downloads = [], openFails = false } = {}) {
  const calls = { download: [], open: [], loading: 0, hide: 0, modal: [], toast: [], previewImage: [] }
  const wx = {
    downloadFile(opts) {
      calls.download.push(opts.url)
      const next = downloads[calls.download.length - 1] || { errMsg: 'downloadFile:fail no scripted result' }
      if (next.errMsg) opts.fail({ errMsg: next.errMsg })
      else opts.success({ statusCode: next.status, tempFilePath: next.tempFilePath || 'wxfile://tmp_original.pdf' })
    },
    openDocument(params) {
      calls.open.push(params)
      if (openFails) params.fail({ errMsg: 'openDocument:fail filetype not supported' })
      else params.success()
    },
    showLoading() { calls.loading += 1 },
    hideLoading() { calls.hide += 1 },
    showModal(opts) { calls.modal.push(opts) },
    showToast(opts) { calls.toast.push(opts) },
    previewImage(opts) { calls.previewImage.push(opts) },
  }
  return { wx, calls }
}

/** 每调一次 fetchUrl 就记一笔，并按顺序给出预先排好的回包。 */
function scriptedFetch(responses) {
  const fetches = []
  const fetchUrl = () => {
    const next = responses[fetches.length]
    fetches.push(next)
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }
  return { fetchUrl, fetches }
}

function assertNoLinkInText(text) {
  assert.ok(typeof text === 'string' && text.length > 0, '失败时必须有一句可读原因')
  assert.ok(!/https?:|sig=|q-signature|myqcloud/i.test(text), `失败文字里不能带链接：${text}`)
}

test('过期（403）时现取一条新链接再下载一次，成功后按 mime 交给阅读器', async () => {
  const { wx, calls } = fakeWx({ downloads: [{ status: 403 }, { status: 200, tempFilePath: 'wxfile://tmp_abc' }] })
  const { fetchUrl, fetches } = scriptedFetch([{ url: COS_URL }, { url: `${COS_URL}&fresh=1` }])
  const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: '简历', mimeType: 'application/pdf' })
  assert.equal(result.ok, true)
  assert.equal(fetches.length, 2, '第二次下载必须用现取的新链接')
  assert.equal(calls.download.length, 2)
  assert.equal(calls.download[1], `${COS_URL}&fresh=1`)
  assert.equal(calls.open.length, 1)
  assert.equal(calls.open[0].filePath, 'wxfile://tmp_abc')
  assert.equal(calls.open[0].fileType, 'pdf')
  assert.equal(calls.open[0].showMenu, true)
})

test('相对路径的签名链接补成小程序配置的服务端地址', async () => {
  const { wx, calls } = fakeWx({ downloads: [{ status: 200 }] })
  const { fetchUrl } = scriptedFetch([{ url: '/api/v1/files/f1/content?expires=1&sig=x' }])
  const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: 'a.pdf' })
  assert.equal(result.ok, true)
  assert.equal(calls.download[0], `${config.baseUrl}/api/v1/files/f1/content?expires=1&sig=x`)
})

test('下载域名没配：不重取、不重试，说明是后台配置问题', async () => {
  const { wx, calls } = fakeWx({ downloads: [{ errMsg: DOMAIN_ERR }] })
  const { fetchUrl, fetches } = scriptedFetch([{ url: COS_URL }])
  const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: 'a.pdf' })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'domain')
  assert.equal(result.text, TEXT.domain)
  assert.equal(fetches.length, 1)
  assert.equal(calls.download.length, 1)
  assert.equal(calls.open.length, 0)
  assertNoLinkInText(result.text)
})

test('连续两次过期只重取一次，然后停下并说明', async () => {
  const { wx, calls } = fakeWx({ downloads: [{ status: 401 }, { status: 401 }, { status: 200 }] })
  const { fetchUrl, fetches } = scriptedFetch([{ url: COS_URL }, { url: COS_URL }, { url: COS_URL }])
  const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: 'a.pdf' })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'expired')
  assert.equal(fetches.length, 2)
  assert.equal(calls.download.length, 2, '不能无限重试')
  assertNoLinkInText(result.text)
})

test('其余失败各自归类，都不重取', async () => {
  const cases = [
    { download: { status: 404 }, kind: 'denied' },
    { download: { status: 410 }, kind: 'denied' },
    { download: { errMsg: 'downloadFile:fail timeout' }, kind: 'timeout' },
    { download: { errMsg: 'downloadFile:fail ssl hand shake error' }, kind: 'network' },
    { download: { status: 500 }, kind: 'network' },
  ]
  for (const c of cases) {
    const { wx, calls } = fakeWx({ downloads: [c.download] })
    const { fetchUrl, fetches } = scriptedFetch([{ url: COS_URL }])
    const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: 'a.pdf' })
    assert.equal(result.kind, c.kind, JSON.stringify(c.download))
    assert.equal(result.text, TEXT[c.kind])
    assert.equal(fetches.length, 1)
    assert.equal(calls.download.length, 1)
    assertNoLinkInText(result.text)
  }
})

test('阅读器打不开时说清是格式问题', async () => {
  const { wx } = fakeWx({ downloads: [{ status: 200 }], openFails: true })
  const { fetchUrl } = scriptedFetch([{ url: COS_URL }])
  const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: 'a.pdf' })
  assert.equal(result.kind, 'unsupported')
  assertNoLinkInText(result.text)
})

test('取链接失败：中文原因照用，英文原话不给用户看；没给链接也要说清', async () => {
  for (const [err, expected] of [
    [new Error('文件不存在或已被删除'), '文件不存在或已被删除'],
    [new Error('Request failed with status code 502'), TEXT.fetch],
  ]) {
    const { wx, calls } = fakeWx()
    const { fetchUrl } = scriptedFetch([err])
    const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: 'a.pdf' })
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'fetch')
    assert.equal(result.text, expected)
    assert.equal(calls.download.length, 0)
  }
  const { wx } = fakeWx()
  const { fetchUrl } = scriptedFetch([{ fileId: 'f1' }])
  const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: 'a.pdf' })
  assert.equal(result.kind, 'noUrl')
  assertNoLinkInText(result.text)
})

test('wx 接口同步抛错时也给结果，不让调用方卡在加载态', async () => {
  const wx = { downloadFile() { throw new Error('boom') } }
  const { fetchUrl } = scriptedFetch([{ url: COS_URL }])
  const result = await fileUrls.openSignedDocument({ wx, fetchUrl, name: 'a.pdf' })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'network')
})

test('fileType：先看 mime，再看文件名，最后看临时文件；都认不出就不传', async () => {
  assert.equal(fileUrls.openableTypeOf({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name: '无后缀' }), 'docx')
  assert.equal(fileUrls.openableTypeOf({ mimeType: 'application/pdf; charset=binary' }), 'pdf')
  assert.equal(fileUrls.openableTypeOf({ name: '报告.XLSX' }), 'xlsx')
  assert.equal(fileUrls.openableTypeOf({ name: '无后缀', tempFilePath: 'wxfile://tmp_1.pptx' }), 'pptx')
  assert.equal(fileUrls.openableTypeOf({ name: '照片.jpg', tempFilePath: 'wxfile://tmp_1' }), '')

  const { wx, calls } = fakeWx({ downloads: [{ status: 200, tempFilePath: 'wxfile://tmp_noext' }] })
  const { fetchUrl } = scriptedFetch([{ url: COS_URL }])
  await fileUrls.openSignedDocument({ wx, fetchUrl, name: '无后缀' })
  assert.equal(Object.prototype.hasOwnProperty.call(calls.open[0], 'fileType'), false, '认不出类型时不能乱传 fileType')
})

test('所有失败文案都不含链接', () => {
  for (const text of Object.values(TEXT)) assertNoLinkInText(text)
})

// ── print-preview 页 ─────────────────────────────────────────────────────────

function loadPreviewPage({ downloads, fileName = 'ZYD-BIZ-COLOR.pdf' } = {}) {
  const { wx, calls } = fakeWx({ downloads })
  const fetches = []
  const api = {
    getFilePreviewUrl(id) {
      const d = deferred(); fetches.push({ id, d }); return d.promise
    },
  }
  const page = instantiate(loadPageDefinition('pages/print-preview/print-preview.js', { wx, modules: { api } }))
  page.onLoad({ fileId: 'file-1', name: encodeURIComponent(fileName) })
  return { page, calls, fetches }
}

test('预览页「打开原文」现取链接；域名没配时弹窗说明原因，页面留在原处', async () => {
  const { page, calls, fetches } = loadPreviewPage({ downloads: [{ errMsg: DOMAIN_ERR }] })
  fetches[0].d.resolve({ url: COS_URL }); await flush()
  assert.equal(page.data.state, 'doc')

  page.openDoc()
  page.openDoc()
  await flush()
  assert.equal(fetches.length, 2, '连点只发一次；而且不复用进页时取的那条')
  assert.equal(page.data.opening, true)
  fetches[1].d.resolve({ url: COS_URL }); await flush()
  assert.equal(page.data.opening, false)
  assert.equal(page.data.state, 'doc', '文件信息还在，可以再点一次')
  assert.equal(calls.modal.length, 1)
  assert.equal(calls.modal[0].content, TEXT.domain)
  assert.equal(calls.loading, 1)
  assert.equal(calls.hide, 1, '加载提示必须收起')
  assert.equal(calls.open.length, 0)
})

test('预览页「打开原文」成功：交给阅读器，页面不进错误态', async () => {
  const { page, calls, fetches } = loadPreviewPage({ downloads: [{ status: 200 }] })
  fetches[0].d.resolve({ url: COS_URL }); await flush()
  page.openDoc(); await flush()
  fetches[1].d.resolve({ url: COS_URL }); await flush()
  assert.equal(page.data.state, 'doc')
  assert.equal(page.data.opening, false)
  assert.equal(calls.open.length, 1)
  assert.equal(calls.open[0].fileType, 'pdf')
  assert.equal(calls.modal.length, 0)
})

test('预览页图片渲染失败先自动重取一次，再失败才报错；用户点重新加载会重置', async () => {
  const { page, fetches } = loadPreviewPage({ fileName: 'photo.jpg' })
  fetches[0].d.resolve({ url: COS_URL }); await flush()
  assert.equal(page.data.state, 'image')

  page.imageError()
  assert.equal(fetches.length, 2)
  fetches[1].d.resolve({ url: `${COS_URL}&fresh=1` }); await flush()
  assert.equal(page.data.state, 'image')
  assert.equal(page.data.fileUrl, `${COS_URL}&fresh=1`)

  page.imageError()
  assert.equal(fetches.length, 2, '第二次失败不再自动重取')
  assert.equal(page.data.state, 'error')
  assertNoLinkInText(page.data.errorText)

  page.retryPreview()
  assert.equal(fetches.length, 3)
  fetches[2].d.resolve({ url: COS_URL }); await flush()
  page.imageError()
  assert.equal(fetches.length, 4, '重新加载之后又有一次自动重取')
})

test('预览页放大图片用现取的链接', async () => {
  const { page, calls, fetches } = loadPreviewPage({ fileName: 'photo.png' })
  fetches[0].d.resolve({ url: COS_URL }); await flush()
  page.zoomImage()
  fetches[1].d.resolve({ url: `${COS_URL}&zoom=1` }); await flush()
  assert.equal(calls.previewImage.length, 1)
  assert.equal(calls.previewImage[0].current, `${COS_URL}&zoom=1`)
  assert.equal(page.data.opening, false)
})

// ── 我的文档页 ───────────────────────────────────────────────────────────────

function loadDocumentsPage({ downloads }) {
  const { wx, calls } = fakeWx({ downloads })
  const fetches = []
  const api = {
    getFilePreviewUrl(id) {
      const d = deferred(); fetches.push({ id, d }); return d.promise
    },
  }
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'member-1' }) }
  const page = instantiate(loadPageDefinition('pages/documents/documents.js', { wx, modules: { api, auth } }))
  page.data.all = [{ id: 'doc-1', name: '求职简历', mimeType: 'application/pdf', isImage: false }]
  return { page, calls, fetches }
}

test('我的文档预览 PDF：走同一套打开流程，失败用弹窗说清原因并收起加载', async () => {
  const { page, calls, fetches } = loadDocumentsPage({ downloads: [{ errMsg: DOMAIN_ERR }] })
  page.previewDoc('doc-1')
  page.previewDoc('doc-1')
  await flush()
  assert.equal(fetches.length, 1, '预览中再点不重复发起')
  assert.equal(fetches[0].id, 'doc-1')
  fetches[0].d.resolve({ url: COS_URL }); await flush()
  assert.equal(page.data.previewing, false)
  assert.equal(calls.hide, 1)
  assert.equal(calls.modal.length, 1)
  assert.equal(calls.modal[0].content, TEXT.domain)
  assert.equal(calls.toast.length, 0, '不再用一句笼统的「下载失败」')
})

test('我的文档预览 PDF 成功：按服务端 mime 传 fileType', async () => {
  const { page, calls, fetches } = loadDocumentsPage({ downloads: [{ status: 403 }, { status: 200 }] })
  page.previewDoc('doc-1'); await flush()
  fetches[0].d.resolve({ url: COS_URL }); await flush()
  assert.equal(fetches.length, 2, '过期时现取一条新的')
  fetches[1].d.resolve({ url: COS_URL }); await flush()
  assert.equal(calls.open.length, 1)
  assert.equal(calls.open[0].fileType, 'pdf')
  assert.equal(calls.modal.length, 0)
  assert.equal(page.data.previewing, false)
})
