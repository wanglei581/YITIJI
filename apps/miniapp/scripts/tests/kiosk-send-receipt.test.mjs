/**
 * 小程序「传文件到一体机」上传回执的真执行测试。
 *
 * 页面拿到的是 utils/request.js 解包后的值：2xx 的 `{}` 和 `{ data: null }`
 * 都会变成兑现，而不是拒绝。只有 status=uploaded、file.fileId、真实会话用途，
 * 且 sessionId 就是这一次，才能说已收到。空的、缺字段的、别的会话的，都是结果未知。
 * 网络和 5xx 同样未知，不能再传一次；服务端明确拒收才允许重选。
 *
 * 由 verify:page-lifecycle 拉起，并因此进入 verify:static。不发网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PAGE = 'pages/kiosk-send/kiosk-send.js'
const SESSION = 'sess-1'
const TOKEN = 'upload-token-memory-only-not-in-data'
const FILE = { path: 'wxfile://tmp/a.pdf', name: '简历.pdf', size: 1200 }

const UNKNOWN_COPY = '这次上传的结果还不确定。请回到一体机屏幕核对，不要在这里重复发送。'
const BUSY_COPY = '这个二维码正在处理一次上传。请回到一体机屏幕查看，不要重复发送。'
const DEAD_COPY = '这个二维码已经不能再传。请回到一体机屏幕确认；如果上面没有这份文件，请重新生成二维码。'
const REJECT_FALLBACK = '系统没有收下这份文件，可以重新选择后再试'

function receipt(overrides = {}) {
  return {
    sessionId: SESSION,
    status: 'uploaded',
    purpose: 'print_doc',
    mode: 'temporary',
    file: { fileId: 'file-1', filename: 'a.pdf', sizeBytes: 12, mimeType: 'application/pdf', sha256: 'abc', fileExpiresAt: null },
    requiresKioskConfirmation: false,
    expiresAt: '2026-09-25T00:10:00.000Z',
    ...overrides,
  }
}

function httpError(statusCode, code, message) {
  const err = new Error(message == null ? '' : message)
  err.statusCode = statusCode
  if (code) err.code = code
  if (message) err.serverMessage = message
  return err
}

function makeWx() {
  const calls = { choose: 0, back: 0, tab: 0, loading: 0, hide: 0 }
  let chosen = null
  return {
    calls,
    setChosen(file) { chosen = file },
    showLoading() { calls.loading += 1 },
    hideLoading() { calls.hide += 1 },
    chooseMessageFile(opts) {
      calls.choose += 1
      if (!chosen) {
        opts.fail({ errMsg: 'chooseMessageFile:fail cancel' })
        return
      }
      opts.success({ tempFiles: [chosen] })
    },
    navigateBack(opts) {
      calls.back += 1
      if (opts && opts.fail) opts.fail({ errMsg: 'navigateBack:fail' })
    },
    switchTab(opts) { calls.tab += 1; if (opts) calls.tabUrl = opts.url },
  }
}

function harness(upload) {
  const wx = makeWx()
  const uploads = []
  const sceneCalls = []
  let sceneResult = () => Promise.resolve({ sessionId: SESSION, uploadToken: TOKEN, purpose: 'print_doc' })
  const api = {
    uploadToKioskSession(...args) {
      uploads.push(args)
      return upload(...args)
    },
    resolveUploadScene(scene) {
      sceneCalls.push(scene)
      return sceneResult(scene)
    },
  }
  const page = instantiate(loadPageDefinition(PAGE, { wx, modules: { api } }))
  return {
    page,
    wx,
    uploads,
    sceneCalls,
    setScene(fn) { sceneResult = fn },
    openDirect() {
      page.onLoad({ sessionId: encodeURIComponent(SESSION), token: encodeURIComponent(TOKEN) })
    },
  }
}

function assertTokenStaysInMemory(page) {
  assert.equal(page._uploadToken, TOKEN)
  assert.equal(JSON.stringify(page.data).includes(TOKEN), false, '上传令牌不得进入页面 data')
  assert.equal(Object.prototype.hasOwnProperty.call(page.data, 'uploadToken'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(page.data, 'token'), false)
}

function assertUnknown(page, message = UNKNOWN_COPY) {
  assert.equal(page.data.phase, 'unknown')
  assert.equal(page.data.canRetry, false)
  assert.equal(page.data.sent.length, 0)
  assert.equal(page.data.errorMsg, message)
  assert.equal(/已收到|已传给|登录/.test(page.data.errorMsg), false)
}

async function send(page, bodyOrError, uploads) {
  const failing = bodyOrError instanceof Error
  const env = harness(() => (failing ? Promise.reject(bodyOrError) : Promise.resolve(bodyOrError)))
  env.openDirect()
  env.page._send(FILE)
  await flush()
  if (uploads) uploads.push(...env.uploads)
  return env
}

test('完整回执才算已收到，令牌只留在内存', async () => {
  for (const purpose of ['resume_upload', 'print_doc', 'contract_upload']) {
    const env = await send(null, receipt({ purpose }))
    assert.equal(env.page.data.phase, 'done', purpose)
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.sent.length, 1)
    assert.equal(env.page.data.sent[0].name, FILE.name)
    assert.equal(env.page.data.errorMsg, '')
    assertTokenStaysInMemory(env.page)
    assert.deepEqual(env.uploads[0].slice(0, 2), [SESSION, TOKEN])
  }
})

test('空回执、缺字段、非上传成功态都不能说已收到', async () => {
  const cases = [
    null,
    undefined,
    {},
    { success: true },
    { status: 'uploaded' },
    receipt({ file: null }),
    receipt({ file: {} }),
    receipt({ file: { fileId: '' } }),
    receipt({ file: { fileId: '   ' } }),
    receipt({ file: { fileId: 1 } }),
    receipt({ purpose: 'signature_image' }),
    receipt({ purpose: 'not_a_purpose' }),
    receipt({ purpose: '' }),
    receipt({ status: 'pending' }),
    receipt({ status: 'uploading' }),
    receipt({ status: 'confirmed' }),
    receipt({ status: 'expired' }),
    receipt({ sessionId: '' }),
    receipt({ sessionId: 'sess-other' }),
  ]
  for (const body of cases) {
    const env = await send(null, body)
    assertUnknown(env.page)
    assert.equal(env.uploads.length, 1)
    assertTokenStaysInMemory(env.page)
  }
})

test('结果未知后重试和再选文件都不会第二次上传', async () => {
  const env = await send(null, {})
  assertUnknown(env.page)
  env.page.retry()
  env.wx.setChosen(FILE)
  env.page.chooseAndSend()
  env.page._send(FILE)
  await flush()
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase, 'unknown')
  assert.equal(env.wx.calls.choose, 0)
})

test('网络、5xx、408 和意外 401 都是结果未知，不提示登录或重传', async () => {
  const cases = [
    httpError(-1, '', 'uploadFile:fail timeout'),
    httpError(500, 'INTERNAL', '服务器内部错误'),
    httpError(408, '', ''),
    httpError(401, '', '登录已失效,请重新登录'),
    httpError(401, 'AUTH_REQUIRED', '请先登录后再操作'),
    httpError(401, 'MEMBER_SESSION_EXPIRED', '会话已失效,请重新登录'),
    new Error('socket hang up'),
  ]
  for (const err of cases) {
    const env = await send(null, err)
    assertUnknown(env.page)
    assert.equal(/uploadFile|timeout|登录|服务器内部错误|socket/.test(env.page.data.errorMsg), false)
    env.page.retry()
    env.page.chooseAndSend()
    assert.equal(env.uploads.length, 1)
  }
})

test('同一二维码正在上传时不重传', async () => {
  const env = await send(null, httpError(400, 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS', '该二维码正在上传中,请稍候'))
  assertUnknown(env.page, BUSY_COPY)
  env.page.retry()
  env.page.chooseAndSend()
  assert.equal(env.uploads.length, 1)
})

test('会话已失效是可确认的失败，但不能用同一张码再传', async () => {
  for (const code of ['UPLOAD_SESSION_EXPIRED', 'UPLOAD_SESSION_NOT_PENDING', 'UPLOAD_SESSION_NOT_FOUND', 'UPLOAD_TOKEN_INVALID']) {
    const env = await send(null, httpError(400, code, code))
    assert.equal(env.page.data.phase, 'error', code)
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.sceneFailed, false)
    assert.equal(env.page.data.sent.length, 0)
    assert.equal(env.page.data.errorMsg, DEAD_COPY)
    assert.equal(env.page.data.errorMsg.includes(code), false)
    env.page.retry()
    env.page.chooseAndSend()
    env.page._send(FILE)
    assert.equal(env.page.data.phase, 'error')
    assert.equal(env.uploads.length, 1)
  }
})

test('服务端明确拒收才允许重选，且不展示机器码或运维原文', async () => {
  const tooBig = await send(null, httpError(400, 'FILE_TOO_LARGE', 'FILE_TOO_LARGE'))
  assert.equal(tooBig.page.data.phase, 'error')
  assert.equal(tooBig.page.data.canRetry, true)
  assert.equal(tooBig.page.data.errorMsg, '文件过大，请压缩后重试')
  assert.equal(tooBig.page.data.errorMsg.includes('FILE_TOO_LARGE'), false)

  const mime = await send(null, httpError(400, 'FILE_MIME_NOT_ALLOWED', 'FILE_MIME_NOT_ALLOWED'))
  assert.equal(mime.page.data.phase, 'error')
  assert.equal(mime.page.data.canRetry, true)
  assert.equal(mime.page.data.errorMsg, REJECT_FALLBACK)
  assert.equal(/FILE_|OSS_|存储桶/.test(mime.page.data.errorMsg), false)

  const ops = await send(null, httpError(400, 'FILE_REJECTED_INTERNAL', '存储桶配置错误，请检查 OSS_BUCKET'))
  assert.equal(ops.page.data.errorMsg, REJECT_FALLBACK)
  assert.equal(ops.page.data.errorMsg.includes('存储桶'), false)
  assert.equal(ops.page.data.errorMsg.includes('OSS_BUCKET'), false)
})

test('明确拒收后可以重选，下一次仍只用内存里的令牌', async () => {
  let next = Promise.reject(httpError(400, 'VALIDATION_FAILED', 'VALIDATION_FAILED'))
  const env = harness(() => next)
  env.openDirect()
  env.page._send(FILE)
  await flush()
  assert.equal(env.page.data.phase, 'error')
  assert.equal(env.page.data.canRetry, true)
  assert.equal(env.page.data.errorMsg, '提交内容有误，请检查后重试')
  assert.equal(env.page.data.errorMsg.includes('VALIDATION_FAILED'), false)
  env.page.retry()
  assert.equal(env.page.data.phase, 'idle')
  const second = deferred()
  next = second.promise
  env.wx.setChosen({ path: 'wxfile://tmp/b.pdf', name: 'b.pdf', size: 10 })
  env.page.chooseAndSend()
  assert.equal(env.uploads.length, 2)
  assert.deepEqual(env.uploads[1].slice(0, 2), [SESSION, TOKEN])
  assertTokenStaysInMemory(env.page)
  second.resolve(receipt({ purpose: 'contract_upload' }))
  await flush()
  assert.equal(env.page.data.phase, 'done')
  assert.equal(env.page.data.sent.length, 1)
  assert.equal(env.page.data.sent[0].name, 'b.pdf')
})

test('成功之后再选文件不会覆盖已收到，也不会再上传', async () => {
  const env = await send(null, receipt())
  assert.equal(env.page.data.phase, 'done')
  env.wx.setChosen({ path: 'wxfile://tmp/b.pdf', name: '另一份.pdf', size: 20 })
  env.page.chooseAndSend()
  env.page._send(FILE)
  env.page.retry()
  await flush()
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase, 'done')
  assert.equal(env.page.data.sent.length, 1)
  assert.equal(env.page.data.sent[0].name, FILE.name)
})

test('上传进行中不会叠第二次，迟到的失败也不会改写', async () => {
  const pending = deferred()
  const env = harness(() => pending.promise)
  env.openDirect()
  env.page._send(FILE)
  env.page._send({ path: 'wxfile://tmp/b.pdf', name: 'b.pdf', size: 20 })
  env.page.chooseAndSend()
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase, 'uploading')
  pending.reject(httpError(503, '', ''))
  await flush()
  assertUnknown(env.page)
  assert.equal(env.wx.calls.hide, 1)
})

test('本地就拦住的大文件没有发出去，仍可以重选', async () => {
  const env = harness(() => Promise.reject(new Error('should not upload')))
  env.openDirect()
  env.wx.setChosen({ path: 'wxfile://tmp/big.pdf', name: 'big.pdf', size: 10 * 1024 * 1024 + 1 })
  env.page.chooseAndSend()
  await flush()
  assert.equal(env.uploads.length, 0)
  assert.equal(env.page.data.phase, 'error')
  assert.equal(env.page.data.canRetry, true)
  assert.equal(/10MB/.test(env.page.data.errorMsg), true)
  env.page.retry()
  assert.equal(env.page.data.phase, 'idle')
})

test('scene 兑换失败或回执不完整都不重试兑换，令牌不进 data', async () => {
  const failed = harness(() => Promise.resolve(receipt()))
  failed.setScene(() => Promise.reject(httpError(400, 'UPLOAD_SCENE_UNUSABLE', '二维码已失效，请回到一体机重新生成')))
  failed.page.onLoad({ scene: encodeURIComponent('scene-once') })
  await flush()
  assert.equal(failed.sceneCalls.length, 1)
  assert.equal(failed.page.data.phase, 'error')
  assert.equal(failed.page.data.sceneFailed, true)
  assert.equal(failed.page.data.canRetry, false)
  assert.equal(failed.page._uploadToken || '', '')
  failed.page.retry()
  failed.page.chooseAndSend()
  await flush()
  assert.equal(failed.sceneCalls.length, 1)
  assert.equal(failed.uploads.length, 0)

  for (const body of [null, {}, { sessionId: SESSION }, { uploadToken: TOKEN }]) {
    const env = harness(() => Promise.resolve(receipt()))
    env.setScene(() => Promise.resolve(body))
    env.page.onLoad({ scene: 'scene-empty' })
    await flush()
    assert.equal(env.page.data.sceneFailed, true, JSON.stringify(body))
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.phase, 'error')
    assert.equal(JSON.stringify(env.page.data).includes(TOKEN), false)
    env.page.retry()
    assert.equal(env.sceneCalls.length, 1)
  }
})

test('scene 带回的用途提示不能当成上传成功', async () => {
  const env = harness(() => Promise.resolve(receipt({ purpose: 'signature_image' })))
  env.setScene(() => Promise.resolve({
    sessionId: SESSION,
    uploadToken: TOKEN,
    purpose: 'print_doc',
    mode: 'member',
  }))
  env.page.onLoad({ scene: 'scene-ok' })
  await flush()
  assert.equal(env.page.data.phase, 'idle')
  assertTokenStaysInMemory(env.page)
  env.page._send(FILE)
  await flush()
  assertUnknown(env.page)
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase !== 'done', true)
})

test('入口缺凭据时不上传，也不给出会再发一次的重试', () => {
  const env = harness(() => Promise.reject(new Error('should not upload')))
  env.page.onLoad({ sessionId: SESSION })
  assert.equal(env.page.data.phase, 'error')
  assert.equal(env.page.data.canRetry, false)
  env.page.retry()
  env.page.chooseAndSend()
  env.page._send(FILE)
  assert.equal(env.uploads.length, 0)
  assert.equal(env.page.data.phase, 'error')
})

test('成功按钮是回一体机继续，页面不再提供再传一份', () => {
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/kiosk-send/kiosk-send.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(MINIAPP, PAGE), 'utf8')
  assert.equal(wxml.includes('再传一份'), false)
  assert.equal(js.includes('再传一份'), false)
  assert.match(wxml, /phase === 'done'[\s\S]*回一体机继续/)
  assert.equal(/phase === 'done'[\s\S]*bindtap="chooseAndSend"/.test(wxml), false)
  assert.match(wxml, /phase === 'unknown'[\s\S]*回一体机核对/)
  assert.match(wxml, /canRetry/)
  assert.equal(/require\([^)]*auth/.test(js), false)
})
