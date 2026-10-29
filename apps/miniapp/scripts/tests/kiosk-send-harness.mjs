// kiosk-send 两份测试（kiosk-send-receipt.test.mjs / kiosk-send-docs.test.mjs）共用的页面沙箱与替身：常量、夹具、wx 与 api/auth 替身、断言助手。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

// 两份测试的时序工具也从这里一并取用
export { deferred, flush }

export const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PAGE = 'pages/kiosk-send/kiosk-send.js'
export const SESSION = 'sess-1'
export const TOKEN = 'upload-token-memory-only-not-in-data'
export const FILE = { path: 'wxfile://tmp/a.pdf', name: '简历.pdf', size: 1200 }

export const UNKNOWN_COPY = '这次上传的结果还不确定。请回到一体机屏幕核对，不要在这里重复发送。'
export const BUSY_COPY = '这个二维码正在处理一次上传。请回到一体机屏幕查看，不要重复发送。'
// 2026-10-29：码失效 / 已用 / 过期改用一体机那一句（apps/kiosk uploadSessionUserMessage，一体机句子为准）
export const DEAD_COPY = '二维码已失效或已使用，请回到一体机刷新二维码。'
export const OCCUPIED_COPY = '这一单已经不能再收文件了。如果一体机屏上有不是你传的文件，请在一体机上点「取消」，再重新扫码。'
export const REJECT_FALLBACK = '系统没有收下这份文件，可以重新选择后再试'
export const OFFLINE_COPY = '没连上终端，可以重试。'
export const NOT_KIOSK_COPY = '这不是一体机上的二维码，请扫一体机屏幕上显示的二维码。'
export const DOC_NOT_FOUND_COPY = '这份文件现在用不了，可能已删除或已过期，请换一份。'
export const DOC_TOO_LARGE_COPY = '这份文件超过 10MB，这台一体机这一单收不了，请换一份。'
export const MEMBER_MISMATCH_COPY = '这台一体机现在登录的是另一个账号。请先在一体机上退出登录，再重新扫码。'
export const LOGIN_EXPIRED_COPY = '登录已失效，请重新登录后再选。'

// 一体机新出的普通链接码（scene 18 字节 base64url = 24 位；票据 24 字节 = 32 位）
export const SCENE = 'q7Lw2mXa9_KdVb3T-pRz8nYc'
export const UPLOAD_LINK = `https://zlixc.com/k/u/${SCENE}`
export const LOGIN_LINK = 'https://zlixc.com/k/l/Zx9vQ2Lm7KpA4wRt_Bn8YcHe-5DsUo1J'

// 「我的文档」：过期一份、超 10MB 一份、正好 10MB 一份（能选）。日期取当天正午前后，本机时区与 UTC 都落在同一天。
export const DAY = 24 * 60 * 60 * 1000
export function myDoc(id, filename, sizeBytes, extra = {}) {
  return {
    id,
    filename,
    sizeBytes,
    mimeType: filename.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf',
    createdAt: '2026-10-20T04:30:00.000Z',
    expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
    assetCategory: 'original',
    purpose: 'print_doc',
    ...extra,
  }
}
export const DOCS = [
  myDoc('file-resume-v3', '王晓雯-2026届-简历.pdf', 268412),
  myDoc('file-degree', '学位证书扫描件.pdf', 1830221, { createdAt: '2026-10-18T03:10:00.000Z' }),
  myDoc('file-old-id', '身份证复印件.pdf', 412008, { expiresAt: new Date(Date.now() - DAY).toISOString() }),
  myDoc('file-portfolio', '作品集-完整版.pdf', 15728640),
  myDoc('file-exact-10mb', '实习证明-盖章版.pdf', 10 * 1024 * 1024, { expiresAt: null }),
  myDoc('file-photo', '证件照-蓝底.jpg', 96512, { createdAt: 'not-a-date' }),
]
export function listOf(items, nextCursor) {
  const out = items.slice()
  if (nextCursor !== undefined) out.nextCursor = nextCursor
  return out
}
export const tap = (id) => ({ currentTarget: { dataset: { id } } })

export function receipt(overrides = {}) {
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

export function httpError(statusCode, code, message) {
  const err = new Error(message == null ? '' : message)
  err.statusCode = statusCode
  if (code) err.code = code
  if (message) err.serverMessage = message
  return err
}

export function makeWx() {
  const calls = { choose: 0, back: 0, tab: 0, loading: 0, hide: 0, modal: [], navigate: [], redirect: [] }
  let chosen = null
  let modalConfirm = true
  let redirectFails = false
  return {
    calls,
    setChosen(file) { chosen = file },
    setModalConfirm(value) { modalConfirm = value },
    setRedirectFails(value) { redirectFails = value },
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
    showModal(opts) {
      calls.modal.push(opts.content)
      if (opts.success) opts.success({ confirm: modalConfirm, cancel: !modalConfirm })
    },
    navigateTo(opts) { calls.navigate.push(opts.url) },
    redirectTo(opts) {
      calls.redirect.push(opts.url)
      if (redirectFails && opts.fail) opts.fail({ errMsg: 'redirectTo:fail' })
    },
  }
}

/**
 * @param upload 聊天文件那条路（uploadToKioskSession）的替身
 * @param opts.loggedIn 小程序会员是否已登录（默认没登录：聊天文件那条路不要求登录）
 * @param opts.docs getMyDocuments 的替身
 * @param opts.member sendMemberFileToKioskSession 的替身
 */
export function harness(upload, opts = {}) {
  const wx = makeWx()
  const uploads = []
  const sceneCalls = []
  const docCalls = []
  const memberCalls = []
  const session = { loggedIn: !!opts.loggedIn, gen: 1 }
  let sceneResult = () => Promise.resolve({ sessionId: SESSION, uploadToken: TOKEN, purpose: 'print_doc' })
  let docsResult = opts.docs || (() => Promise.resolve([]))
  let memberResult = opts.member || (() => Promise.resolve(receipt()))
  const auth = {
    isLoggedIn: () => session.loggedIn,
    sessionGeneration: () => session.gen,
    isSameSession: (g) => g === session.gen,
  }
  const api = {
    uploadToKioskSession(...args) {
      uploads.push(args)
      return upload(...args)
    },
    resolveUploadScene(scene) {
      sceneCalls.push(scene)
      return sceneResult(scene, sceneCalls.length)
    },
    getMyDocuments(params) {
      docCalls.push(params)
      return docsResult(params, docCalls.length)
    },
    sendMemberFileToKioskSession(...args) {
      memberCalls.push(args)
      return memberResult(...args)
    },
  }
  const page = instantiate(loadPageDefinition(PAGE, { wx, modules: { api, auth } }))
  return {
    page,
    wx,
    uploads,
    sceneCalls,
    docCalls,
    memberCalls,
    session,
    setScene(fn) { sceneResult = fn },
    setDocs(fn) { docsResult = fn },
    setMember(fn) { memberResult = fn },
    openDirect() {
      page.onLoad({ sessionId: encodeURIComponent(SESSION), token: encodeURIComponent(TOKEN) })
      page.onShow()
    },
    /** 微信扫一扫扫一体机的普通链接码：整条码编码一次放在 q 里。 */
    openLink(raw) {
      page.onLoad({ q: encodeURIComponent(raw), scancode_time: '1761700000' })
      page.onShow()
    },
    /** 登录页登完 navigateBack 回到本页：代号推进、onShow。 */
    loginAs(nextLoggedIn = true) {
      session.loggedIn = nextLoggedIn
      session.gen += 1
      page.onShow()
    },
  }
}

export function assertTokenStaysInMemory(page) {
  assert.equal(page._uploadToken, TOKEN)
  assert.equal(JSON.stringify(page.data).includes(TOKEN), false, '上传令牌不得进入页面 data')
  assert.equal(Object.prototype.hasOwnProperty.call(page.data, 'uploadToken'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(page.data, 'token'), false)
}

export function assertUnknown(page, message = UNKNOWN_COPY) {
  assert.equal(page.data.phase, 'unknown')
  assert.equal(page.data.canRetry, false)
  assert.equal(page.data.sent.length, 0)
  assert.equal(page.data.errorMsg, message)
  assert.equal(/已收到|已传给|登录/.test(page.data.errorMsg), false)
}

export async function send(page, bodyOrError, uploads) {
  const failing = bodyOrError instanceof Error
  const env = harness(() => (failing ? Promise.reject(bodyOrError) : Promise.resolve(bodyOrError)))
  env.openDirect()
  env.page._send(FILE)
  await flush()
  if (uploads) uploads.push(...env.uploads)
  return env
}
