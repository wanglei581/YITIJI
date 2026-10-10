import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const require = createRequire(import.meta.url)
const { parseRelayText, parseMiniappCodePath } = require('../../utils/kiosk-relay-link.js')
const SESSION = 'sess-12345678'
const TOKEN = 'upload-token-abcdefgh'
const SCENE = 'Abcdefghijklmnop012345_-'
const LINK = `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}&token=${TOKEN}`
const CODE_PATH = `pages/kiosk-send/kiosk-send?scene=${SCENE}`
const FILE = { path: 'wxfile://tmp/a.pdf', name: '材料.pdf', size: 1234 }
const IMAGE = { tempFilePath: 'wxfile://tmp/image.PNG', size: 1234 }
const MAX_BYTES = 10 * 1024 * 1024

for (const prefix of ['#', '?', '&']) {
  test(`文字凭据支持前导 ${prefix}`, () => {
    const r = parseRelayText(`https://kiosk.example.cn/upload/phone${prefix}sessionId=${SESSION}&token=${TOKEN}`)
    assert.equal(r.kind, 'credentials')
    assert.equal(r.sessionId, SESSION)
    assert.equal(r.token, TOKEN)
  })
}

for (const [label, input] of [
  ['缺令牌', `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}`],
  ['缺会话', `https://kiosk.example.cn/upload/phone?token=${TOKEN}`],
  ['路径太短', 'https://kiosk.example.cn/upload/phone'],
  ['裸文字长得像短码', SCENE],
  ['只有主机名且长得像短码', 'https://abcdefghijklmnopqrst'],
  ['不是网址的路径', `upload/${SCENE}`],
  ['空串', ''], ['空值', null], ['未定义', undefined], ['数字', 123],
  ['凭据坏编码', `https://kiosk.example.cn/#sessionId=${SESSION}&token=abcdefgh%ZZ`],
  ['短码坏编码', 'https://kiosk.example.cn/?scene=abcdefghijklmnop%ZZ'],
  ['路径坏编码', 'https://kiosk.example.cn/upload/abcdefghijklmnop%ZZ'],
]) {
  test(`文字解析无效：${label}，且不抛错`, () => {
    assert.equal(parseRelayText(input).kind, 'invalid')
  })
}

test('文字凭据各解码一次，沿用原有字符集', () => {
  const r = parseRelayText('https://kiosk.example.cn/#sessionId=sess%2D12345678&token=upload%2Dtoken_abc.def%252D')
  assert.equal(r.kind, 'credentials')
  assert.equal(r.sessionId, SESSION)
  assert.equal(r.token, 'upload-token_abc.def%2D')
})

for (const prefix of ['#', '?', '&']) {
  test(`文字短码参数支持前导 ${prefix}`, () => {
    const r = parseRelayText(`https://kiosk.example.cn/upload/phone${prefix}scene=${SCENE}`)
    assert.equal(r.kind, 'scene')
    assert.equal(r.scene, SCENE)
  })
}

test('文字路径最后一段支持二十四字符短码，忽略查询与片段', () => {
  assert.equal(SCENE.length, 24)
  const r = parseRelayText(`https://kiosk.example.cn/upload/${SCENE}?foo=bar#hint=ok`)
  assert.equal(r.kind, 'scene')
  assert.equal(r.scene, SCENE)
})

test('短码参数优先于路径，凭据优先于短码', () => {
  const scene = parseRelayText(`https://kiosk.example.cn/${SCENE}?scene=0123456789abcdef`)
  assert.equal(scene.scene, '0123456789abcdef')
  const pair = parseRelayText(`${LINK}&scene=${SCENE}`)
  assert.equal(pair.kind, 'credentials')
  assert.equal(pair.token, TOKEN)
  assert.equal(parseRelayText(`https://kiosk.example.cn/${SCENE}?scene=bad`).kind, 'invalid')
})

test('短码整段校验十六至三十二字符，编码只解一次', () => {
  for (const length of [16, 32]) assert.equal(parseRelayText(`https://kiosk.example.cn/?scene=${'a'.repeat(length)}`).kind, 'scene')
  for (const value of ['a'.repeat(15), 'a'.repeat(33), SCENE + '.', SCENE + '%252D']) {
    assert.equal(parseRelayText(`https://kiosk.example.cn/?scene=${value}`).kind, 'invalid')
  }
  const r = parseRelayText(`https://kiosk.example.cn/?scene=${SCENE.replace('-', '%2D')}`)
  assert.equal(r.kind, 'scene')
  assert.equal(r.scene, SCENE)
})

for (const prefix of ['', '/']) {
  test(`小程序码路径${prefix ? '带' : '不带'}前导斜杠`, () => {
    const r = parseMiniappCodePath(prefix + CODE_PATH.replace(SCENE, SCENE.replace('-', '%2D')))
    assert.equal(r.kind, 'scene')
    assert.equal(r.scene, SCENE)
  })
}

for (const [label, input] of [
  ['别的页面', `pages/home/home?scene=${SCENE}`],
  ['路径前缀不符', `other/pages/kiosk-send/kiosk-send?scene=${SCENE}`],
  ['没有短码', 'pages/kiosk-send/kiosk-send'],
  ['非法短码', 'pages/kiosk-send/kiosk-send?scene=phone'],
  ['过长短码', `pages/kiosk-send/kiosk-send?scene=${'a'.repeat(33)}`],
  ['坏编码', `pages/kiosk-send/kiosk-send?scene=${SCENE}%ZZ`],
  ['空值', null], ['数字', 123],
]) {
  test(`小程序码路径无效：${label}`, () => assert.equal(parseMiniappCodePath(input).kind, 'invalid'))
}

function receipt() {
  return { sessionId: SESSION, status: 'uploaded', purpose: 'print_doc', file: { fileId: 'file-1' } }
}

function sendHarness({ upload = () => Promise.resolve(receipt()), resolve = () => Promise.resolve({ sessionId: SESSION, uploadToken: TOKEN }) } = {}) {
  const calls = { menus: [], media: [], chat: [], uploads: [], scenes: [] }
  const wx = {
    showActionSheet(opts) { calls.menus.push(opts) },
    chooseMedia(opts) { calls.media.push(opts) },
    chooseMessageFile(opts) { calls.chat.push(opts) },
    showLoading() {}, hideLoading() {},
  }
  const api = {
    uploadToKioskSession(...args) { calls.uploads.push(args); return upload(...args) },
    resolveUploadScene(scene) { calls.scenes.push(scene); return resolve(scene) },
  }
  const modules = { api }
  Object.defineProperty(modules, 'auth', { get() { assert.fail('接力页不得读取登录态') } })
  const page = instantiate(loadPageDefinition('pages/kiosk-send/kiosk-send.js', { wx, modules }))
  return {
    page, calls,
    open(options = { sessionId: SESSION, token: TOKEN }) { page.onLoad(options) },
    pick(index) {
      page.chooseAndSend()
      calls.menus[calls.menus.length - 1].success({ tapIndex: index })
    },
  }
}

function noTokenInData(page) {
  assert.equal(JSON.stringify(page.data).includes(TOKEN), false)
  assert.equal(Object.keys(page.data).some((key) => /token/i.test(key)), false)
}

test('接力页 q 带凭据进入空闲态，令牌只留实例', () => {
  const e = sendHarness()
  e.open({ q: encodeURIComponent(LINK), scancode_time: '1791580000' })
  assert.equal(e.page.data.phase, 'idle')
  assert.equal(e.page.data.sessionId, SESSION)
  assert.equal(e.page._uploadToken, TOKEN)
  assert.equal(e.calls.scenes.length, 0)
  noTokenInData(e.page)
})

test('接力页 q 整体及凭据分别解码一次', () => {
  const e = sendHarness()
  e.open({ q: encodeURIComponent(LINK.replace('sess-', 'sess%2D').replace('upload-', 'upload%2D')) })
  assert.equal(e.page.data.sessionId, SESSION)
  assert.equal(e.page._uploadToken, TOKEN)
  noTokenInData(e.page)
})

test('接力页 q 短码只兑换一次，重试与选文件不再次兑换', async () => {
  for (const url of [`https://kiosk.example.cn/upload/${SCENE}`, `https://kiosk.example.cn/upload/phone?scene=${SCENE}`]) {
    const d = deferred()
    const e = sendHarness({ resolve: () => d.promise })
    e.open({ q: encodeURIComponent(url) })
    assert.equal(e.page.data.phase, 'resolving')
    e.page.chooseAndSend()
    e.page.retry()
    assert.equal(e.calls.menus.length, 0)
    assert.equal(e.calls.scenes.length, 1)
    assert.equal(e.calls.scenes[0], SCENE)
    d.resolve({ sessionId: SESSION, uploadToken: TOKEN })
    await flush()
    assert.equal(e.page.data.phase, 'idle')
    e.page.retry()
    assert.equal(e.calls.scenes.length, 1)
    noTokenInData(e.page)
  }
})

test('接力页 q 无效或解码失败时不回落凭据入口，不给重试', () => {
  for (const q of ['', 'https%ZZ', encodeURIComponent('https://kiosk.example.cn/upload/phone'), 123]) {
    const e = sendHarness()
    e.open({ q, sessionId: SESSION, token: TOKEN })
    assert.equal(e.page.data.phase, 'error')
    assert.equal(e.page.data.canRetry, false)
    assert.equal(e.page.data.errorMsg, '扫码信息不完整，请回到一体机重新扫码')
    e.page.retry()
    e.page.chooseAndSend()
    assert.equal(e.calls.scenes.length, 0)
    assert.equal(e.calls.menus.length, 0)
    assert.equal(e.calls.uploads.length, 0)
  }
})

test('接力页同时带 scene 和 q 只认 scene', async () => {
  for (const q of [encodeURIComponent(LINK), encodeURIComponent(`https://kiosk.example.cn/0123456789abcdef`), '%ZZ']) {
    const e = sendHarness()
    e.open({ scene: SCENE.replace('-', '%2D'), q })
    await flush()
    assert.equal(e.calls.scenes.length, 1)
    assert.equal(e.calls.scenes[0], SCENE)
    assert.equal(e.page.data.phase, 'idle')
    noTokenInData(e.page)
  }
})

test('菜单第一项选原图并沿用真实扩展名生成相机文件名上传', async () => {
  const e = sendHarness()
  e.open()
  e.pick(0)
  const menu = e.calls.menus[0]
  assert.equal(menu.itemList.length, 2)
  assert.equal(menu.itemList[0], '拍照或从相册选择')
  assert.equal(menu.itemList[1], '从微信聊天中选择文件')
  assert.equal(e.calls.chat.length, 0)
  assert.equal(e.calls.media.length, 1)
  const media = e.calls.media[0]
  assert.equal(media.count, 1)
  assert.equal(media.mediaType.length, 1)
  assert.equal(media.mediaType[0], 'image')
  assert.equal(media.sourceType.length, 2)
  assert.equal(media.sourceType[0], 'camera')
  assert.equal(media.sourceType[1], 'album')
  assert.equal(media.sizeType.length, 1)
  assert.equal(media.sizeType[0], 'original')
  media.success({ tempFiles: [IMAGE] })
  await flush()
  assert.equal(e.calls.uploads.length, 1)
  assert.equal(e.calls.uploads[0][0], SESSION)
  assert.equal(e.calls.uploads[0][1], TOKEN)
  assert.equal(e.calls.uploads[0][2], IMAGE.tempFilePath)
  assert.match(e.calls.uploads[0][3], /^拍照文档 \d{1,2}月\d{1,2}日 \d{2}时\d{2}分\.png$/)
  assert.equal(e.page.data.phase, 'done')
  noTokenInData(e.page)
})

test('菜单第二项保留聊天选文件参数与文件名', async () => {
  const e = sendHarness()
  e.open()
  e.pick(1)
  assert.equal(e.calls.media.length, 0)
  const chat = e.calls.chat[0]
  assert.equal(chat.count, 1)
  assert.equal(chat.type, 'file')
  chat.success({ tempFiles: [FILE] })
  await flush()
  assert.equal(e.calls.uploads.length, 1)
  assert.equal(e.calls.uploads[0][2], FILE.path)
  assert.equal(e.calls.uploads[0][3], FILE.name)
})

test('两类文件超过十兆字节都不上传，恰好十兆字节可以上传', async () => {
  for (const index of [0, 1]) {
    for (const size of [MAX_BYTES + 1, MAX_BYTES]) {
      const e = sendHarness()
      e.open()
      e.pick(index)
      const picker = index === 0 ? e.calls.media[0] : e.calls.chat[0]
      picker.success({ tempFiles: [{ ...(index === 0 ? IMAGE : FILE), size }] })
      await flush()
      assert.equal(e.calls.uploads.length, size > MAX_BYTES ? 0 : 1)
      assert.equal(e.page.data.phase, size > MAX_BYTES ? 'error' : 'done')
      assert.equal(e.page.data.canRetry, size > MAX_BYTES)
    }
  }
})

test('菜单、选图及聊天取消都不改页面状态', () => {
  const menu = sendHarness()
  menu.open()
  const beforeMenu = JSON.stringify(menu.page.data)
  menu.page.chooseAndSend()
  menu.calls.menus[0].fail?.({ errMsg: 'showActionSheet:fail cancel' })
  assert.equal(JSON.stringify(menu.page.data), beforeMenu)
  for (const index of [0, 1]) {
    const e = sendHarness()
    e.open()
    e.page.setData({ phase: 'error', canRetry: true, errorMsg: '请重选' })
    const before = JSON.stringify(e.page.data)
    e.pick(index)
    const picker = index === 0 ? e.calls.media[0] : e.calls.chat[0]
    picker.fail({ errMsg: 'choose:fail cancel' })
    assert.equal(JSON.stringify(e.page.data), before)
    assert.equal(e.calls.uploads.length, 0)
  }
})

test('上传中、完成、结果未知、死码及兑换失败都不再弹菜单', () => {
  for (const phase of ['uploading', 'done', 'unknown', 'resolving', 'error']) {
    const e = sendHarness()
    e.open()
    e.page.setData({ phase, canRetry: false })
    e.page.chooseAndSend()
    assert.equal(e.calls.menus.length, 0)
  }
  const e = sendHarness()
  e.open()
  e.page.setData({ sceneFailed: true })
  e.page.chooseAndSend()
  assert.equal(e.calls.menus.length, 0)
})

test('迟到的选图与聊天回调在上传中、完成及未知后不发第二次上传', async () => {
  for (const index of [0, 1]) {
    for (const outcome of ['done', 'unknown']) {
      const d = deferred()
      const e = sendHarness({ upload: () => d.promise })
      e.open()
      e.pick(index)
      const late = index === 0 ? e.calls.media[0] : e.calls.chat[0]
      e.page._send(FILE)
      late.success({ tempFiles: [index === 0 ? IMAGE : FILE] })
      assert.equal(e.calls.uploads.length, 1)
      d.resolve(outcome === 'done' ? receipt() : {})
      await flush()
      late.success({ tempFiles: [{ ...(index === 0 ? IMAGE : FILE), size: MAX_BYTES + 1 }] })
      late.fail({ errMsg: 'choose:fail' })
      assert.equal(e.calls.uploads.length, 1)
      assert.equal(e.page.data.phase, outcome)
    }
  }
})

test('迟到的菜单回调不打开选图或聊天', () => {
  for (const index of [0, 1]) {
    const e = sendHarness()
    e.open()
    e.page.chooseAndSend()
    e.page.setData({ phase: 'uploading' })
    e.calls.menus[0].success({ tapIndex: index })
    assert.equal(e.calls.media.length, 0)
    assert.equal(e.calls.chat.length, 0)
  }
})

test('照片选取失败可重选，缺真实扩展名时不猜格式', () => {
  for (const mode of ['fail', 'no-extension']) {
    const e = sendHarness()
    e.open()
    e.pick(0)
    const picker = e.calls.media[0]
    if (mode === 'fail') picker.fail({ errMsg: 'chooseMedia:fail' })
    else picker.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/image', size: 123 }] })
    assert.equal(e.calls.uploads.length, 0)
    assert.equal(e.page.data.phase, 'error')
    assert.equal(e.page.data.canRetry, true)
  }
})

function loginHarness(result) {
  const calls = { scans: [], navigate: [], tickets: [] }
  const wx = {
    scanCode(opts) { calls.scans.push(opts); opts.success(result) },
    navigateTo(opts) { calls.navigate.push(opts.url) },
  }
  const auth = { isLoggedIn: () => false, sessionGeneration: () => 1, isSameSession: () => true }
  const api = {
    getQrLoginStatus(ticket) {
      calls.tickets.push(ticket)
      return Promise.resolve({ status: 'pending', deviceLabel: '一号机', expiresInSeconds: 60 })
    },
  }
  const page = instantiate(loadPageDefinition('pages/kiosk-login/kiosk-login.js', { wx, modules: { api, auth } }))
  page.onLoad({})
  page.scanCode()
  return { page, calls }
}

test('扫码结果优先认接力页小程序码路径，兼容没有文字结果', () => {
  for (const result of [{ path: CODE_PATH }, { path: '/' + CODE_PATH, result: LINK }]) {
    const e = loginHarness(result)
    assert.equal(e.calls.scans[0].scanType.length, 2)
    assert.equal(e.calls.scans[0].scanType[0], 'qrCode')
    assert.equal(e.calls.scans[0].scanType[1], 'wxCode')
    assert.equal(e.calls.navigate.length, 1)
    assert.equal(e.calls.navigate[0], `/pages/kiosk-send/kiosk-send?scene=${SCENE}`)
    assert.equal(e.calls.tickets.length, 0)
  }
})

test('扫码网页上传码照旧跳凭据地址', () => {
  const e = loginHarness({ result: LINK })
  assert.equal(e.calls.navigate.length, 1)
  assert.equal(e.calls.navigate[0], `/pages/kiosk-send/kiosk-send?sessionId=${SESSION}&token=${TOKEN}`)
  assert.equal(e.calls.tickets.length, 0)
  noTokenInData(e.page)
})

test('扫码网页短码跳场景地址', () => {
  const e = loginHarness({ result: `https://kiosk.example.cn/upload/${SCENE}` })
  assert.equal(e.calls.navigate[0], `/pages/kiosk-send/kiosk-send?scene=${SCENE}`)
  assert.equal(e.calls.tickets.length, 0)
})

test('扫码登录码照旧读票据，不跳接力页', async () => {
  const ticket = 'tkt_Abcdefghijklmnopqrstuvwxyz0123456789'
  const e = loginHarness({ result: `https://kiosk.example.cn/member/qr-login?ticketId=${ticket}` })
  await flush()
  assert.equal(e.calls.navigate.length, 0)
  assert.equal(e.calls.tickets.length, 1)
  assert.equal(e.calls.tickets[0], ticket)
  assert.equal(e.page.data.phase, 'ready')
})

test('别的页面小程序码走最后报错，文字上传码仍可回落识别', () => {
  const path = `pages/home/home?scene=${SCENE}`
  const e = loginHarness({ path, result: '' })
  assert.equal(e.calls.navigate.length, 0)
  assert.equal(e.calls.tickets.length, 0)
  assert.equal(e.page.data.phase, 'scan-error')
  assert.equal(e.page.data.errorMsg, '这不是一体机上的二维码，请确认扫的是终端屏幕上的登录码或上传码')
  const fallback = loginHarness({ path, result: LINK })
  assert.equal(fallback.calls.navigate.length, 1)
})

test('上传凭据坏编码仍显示原有读不出来提示', () => {
  const e = loginHarness({ result: LINK.replace(TOKEN, 'abcdefgh%ZZ') })
  assert.equal(e.calls.navigate.length, 0)
  assert.equal(e.calls.tickets.length, 0)
  assert.equal(e.page.data.phase, 'scan-error')
  assert.equal(e.page.data.errorMsg, '这张上传码读不出来，请回一体机重新生成后再扫')
})
