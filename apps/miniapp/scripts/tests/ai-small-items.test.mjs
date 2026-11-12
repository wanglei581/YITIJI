/**
 * 包 3 的页面行为：没登录不选文件、游客文件找不到后改重新选择、
 * 我的简历按 kind 跳转、优化失败只在事实核查码上说真实性校验、
 * AI 结果的保存期限。由 verify:page-lifecycle 拉起。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')

let ACTIVE_WX = null
Object.defineProperty(globalThis, 'wx', { get: () => ACTIVE_WX, configurable: true })

function createWx() {
  const storage = new Map()
  const calls = { chooseMessageFile: 0, chooseMedia: 0, modal: [], nav: [], redirect: [] }
  const randomSeed = { n: 0 }
  const wx = {
    calls,
    storage,
    getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key, value) => { storage.set(key, value) },
    removeStorageSync: (key) => { storage.delete(key) },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal(opts) {
      calls.modal.push(opts)
      if (opts && opts.success) opts.success({ confirm: false })
    },
    navigateTo(opts) { calls.nav.push(opts && opts.url); if (opts && opts.success) opts.success() },
    redirectTo(opts) { calls.redirect.push(opts && opts.url) },
    navigateBack(opts) { if (opts && opts.fail) opts.fail({ errMsg: 'no page' }) },
    switchTab() {},
    chooseMessageFile() { calls.chooseMessageFile += 1 },
    chooseMedia() { calls.chooseMedia += 1 },
    getRandomValues(opts) {
      const length = (opts && opts.length) || 16
      randomSeed.n += 1
      const bytes = new Uint8Array(length)
      for (let i = 0; i < length; i += 1) bytes[i] = (randomSeed.n * 37 + i * 11) & 0xff
      if (opts && opts.success) opts.success({ randomValues: bytes.buffer })
    },
  }
  return wx
}

function createAuth(id) {
  const user = id ? { id } : null
  return {
    isLoggedIn: () => !!user,
    getUser: () => user,
    getToken: () => (user ? 'tok' : ''),
    sessionGeneration: () => 1,
    isSameSession: () => true,
  }
}

function makePage(rel, { wx, auth, api, modules }) {
  ACTIVE_WX = wx
  return instantiate(loadPageDefinition(rel, {
    wx,
    modules: Object.assign({ api: api || {}, auth: auth || createAuth(null) }, modules || {}),
  }))
}

test('没登录点上传或拍照：先出登录提示，不调选文件', async () => {
  const wx = createWx()
  const page = makePage('pages/resume-upload/resume-upload.js', {
    wx,
    auth: createAuth(null),
    api: { getDocumentConversionCapabilities: () => Promise.resolve({ wordToPdf: false }) },
  })
  page.onLoad()
  page.tapUploadFile()
  assert.equal(wx.calls.chooseMessageFile, 0, '没登录不选聊天文件')
  assert.equal(wx.calls.modal.length, 1)
  assert.match(wx.calls.modal[0].title, /先登录再用 AI/)
  assert.match(wx.calls.modal[0].content, /登录后回到这一页继续/)
  assert.equal(wx.calls.nav.length, 0, '点「稍后」不离开')
  await flush()
  page.tapCamera()
  assert.equal(wx.calls.chooseMedia, 0, '没登录不调拍照')
  assert.equal(wx.calls.modal.length, 2)
  assert.match(wx.calls.modal[1].title, /先登录再用 AI/)
})

test('已登录才调选文件', () => {
  const wx = createWx()
  const page = makePage('pages/resume-upload/resume-upload.js', {
    wx,
    auth: createAuth('member-1'),
    api: { getDocumentConversionCapabilities: () => Promise.resolve({ wordToPdf: false }) },
  })
  page.onLoad()
  page.tapUploadFile()
  page.tapCamera()
  assert.equal(wx.calls.modal.length, 0)
  assert.equal(wx.calls.chooseMessageFile, 1)
  assert.equal(wx.calls.chooseMedia, 1)
})

test('游客文件登录后找不到：重试不再提交，主按钮改为重新选择文件', async () => {
  const wx = createWx()
  let posts = 0
  const missing = new Error('文件不存在或已被清理')
  missing.statusCode = 404
  missing.code = 'FILE_NOT_FOUND'
  const page = makePage('pages/resume-parse/resume-parse.js', {
    wx,
    auth: createAuth('member-1'),
    api: { parseResume: () => { posts += 1; return Promise.reject(missing) } },
  })
  page.onLoad({ fileId: 'guest-file', fileName: 'a.pdf', fileFormat: 'pdf' })
  await flush()
  await flush()
  assert.equal(posts, 1)
  assert.equal(page.data.phase, 'failed')
  assert.equal(page.data.fileMissing, true)
  page.retry()
  await flush()
  assert.equal(posts, 1, '重试不再原样重发同一份文件')
  const wxml = read('pages/resume-parse/resume-parse.wxml')
  assert.match(wxml, /wx:elif="\{\{fileMissing\}\}"[\s\S]*重新选择文件/)
  assert.match(wxml, /fileMissing\}\}" class="btn primary tap flex-1-5" bindtap="toUpload">重新选择文件/)

  const byText = new Error('找不到文件')
  byText.statusCode = 400
  byText.code = 'SOME_OTHER'
  let posts2 = 0
  const page2 = makePage('pages/resume-parse/resume-parse.js', {
    wx: createWx(),
    auth: createAuth('member-1'),
    api: { parseResume: () => { posts2 += 1; return Promise.reject(byText) } },
  })
  page2.onLoad({ fileId: 'guest-file-2', fileFormat: 'pdf' })
  await flush()
  await flush()
  assert.equal(page2.data.fileMissing, true)
  page2.retry()
  assert.equal(posts2, 1)
})

test('我的简历：解析进诊断，生成进生成结果', async () => {
  const wx = createWx()
  const page = makePage('pages/resumes/resumes.js', {
    wx,
    auth: createAuth('member-1'),
    api: {
      getMyResumes: () => Promise.resolve([
        { id: 'p1', taskId: 'task-parse', kind: 'parse', status: 'completed', createdAt: '2026-03-01T00:00:00+08:00', expiresAt: '2026-03-02T00:00:00+08:00' },
        { id: 'g1', taskId: 'task-gen', kind: 'generate', status: 'completed', createdAt: '2026-03-01T00:00:00+08:00', expiresAt: '2026-03-01T00:00:00+08:00' },
      ]),
    },
  })
  page.onShow()
  await flush()
  await flush()
  assert.equal(page.data.resumes[0].kind, 'parse')
  assert.equal(page.data.resumes[1].kind, 'generate')
  assert.equal(page.data.resumes[0].viewUntil, '3 月 2 日前可查看')
  assert.equal(page.data.resumes[1].viewUntil, '3 月 1 日前可查看')
  page.openResume({ currentTarget: { dataset: { taskId: 'task-parse', kind: 'parse' } } })
  page.openResume({ currentTarget: { dataset: { taskId: 'task-gen', kind: 'generate' } } })
  assert.equal(wx.calls.nav[0], '/pages/resume-diagnose/resume-diagnose?taskId=task-parse')
  assert.equal(wx.calls.nav[1], '/pages/resume-build/resume-build?taskId=task-gen')
  const wxml = read('pages/resumes/resumes.wxml')
  assert.match(wxml, /查看诊断/)
  assert.match(wxml, /查看生成结果/)
  assert.doesNotMatch(wxml, /点击简历可查看诊断报告/)
})

test('优化失败：只有事实核查码才说真实性校验；模型没配不找管理员', async () => {
  const baseApi = {
    getResumeExportPricing: () => Promise.resolve({ mode: 'free', unitCents: 0 }),
    getMyBenefits: () => Promise.resolve([]),
  }
  const wx = createWx()
  const fact = makePage('pages/resume-optimize/resume-optimize.js', {
    wx,
    auth: createAuth('member-1'),
    api: Object.assign({}, baseApi, {
      getResumeOptimize: () => Promise.resolve({
        taskId: 'opt-1',
        status: 'failed',
        failCode: 'AI_OPTIMIZE_INVALID_OUTPUT',
        failReason: '优化结果包含无法从原文确认的信息，系统已拦截，请重新生成或检查原文',
      }),
    }),
  })
  fact.onLoad({ taskId: 'opt-1' })
  await flush()
  await flush()
  assert.equal(fact.data.factBlocked, true)
  assert.match(fact.data.failMsg, /无法从原文确认/)
  assert.doesNotMatch(fact.data.failMsg, /真实性校验/)

  const other = makePage('pages/resume-optimize/resume-optimize.js', {
    wx: createWx(),
    auth: createAuth('member-1'),
    api: Object.assign({}, baseApi, {
      getResumeOptimize: () => Promise.reject(Object.assign(new Error('AI 优化服务暂时不可用，请稍后重试'), { code: 'AI_OPTIMIZE_UNAVAILABLE' })),
    }),
  })
  other.onLoad({ taskId: 'opt-2' })
  await flush()
  await flush()
  assert.equal(other.data.factBlocked, false)
  assert.match(other.data.failMsg, /暂时不可用/)
  assert.doesNotMatch(other.data.failMsg, /真实性校验/)

  const unconfigured = makePage('pages/resume-optimize/resume-optimize.js', {
    wx: createWx(),
    auth: createAuth('member-1'),
    api: Object.assign({}, baseApi, {
      getResumeOptimize: () => Promise.reject(Object.assign(new Error('AI_PROVIDER_NOT_CONFIGURED'), { code: 'AI_PROVIDER_NOT_CONFIGURED' })),
    }),
  })
  unconfigured.onLoad({ taskId: 'opt-3' })
  await flush()
  await flush()
  assert.match(unconfigured.data.failMsg, /AI 优化暂时用不了，可以先手动修改简历。/)
  assert.match(unconfigured.data.failMsg, /服务电话/)
  assert.doesNotMatch(unconfigured.data.failMsg, /管理员/)
  assert.equal(unconfigured.data.factBlocked, false)

  const wxml = read('pages/resume-optimize/resume-optimize.wxml')
  assert.match(wxml, /wx:if="\{\{factBlocked\}\}"[\s\S]{0,80}真实性校验/)
  assert.equal(/wx:if="\{\{!needReupload\}\}"[\s\S]{0,40}真实性校验/.test(wxml), false)
})

test('AI 服务记录：有到期日的逐条写，面试记录不编日期，列表说明保存多久', async () => {
  const wx = createWx()
  const page = makePage('pages/ai-records/ai-records.js', {
    wx,
    auth: createAuth('member-1'),
    api: {
      getMyAiRecords: () => Promise.resolve([
        { id: 'r1', taskId: 't1', kind: 'parse', status: 'completed', createdAt: '2026-03-01T01:00:00+08:00', expiresAt: '2026-03-02T00:00:00+08:00' },
      ]),
      getMyMockInterviews: () => Promise.resolve([
        { sessionId: 's1', position: '行政助理', hasReport: true, createdAt: '2026-03-01T02:00:00+08:00' },
      ]),
    },
  })
  page.onShow()
  await flush()
  await flush()
  const items = []
  for (const g of page.data.groups) for (const item of g.items) items.push(item)
  const ai = items.find((item) => item.kind === 'parse')
  const interview = items.find((item) => item.kind === 'mock_interview')
  assert.ok(ai, '解析记录在列表里')
  assert.equal(ai.viewUntil, '3 月 2 日前可查看')
  assert.ok(interview, '模拟面试记录在列表里')
  assert.equal(interview.viewUntil, '', '面试列表没有到期字段，不编一个日期')
  const wxml = read('pages/ai-records/ai-records.wxml')
  assert.match(wxml, /AI 做出的结果默认保存 24 小时，模拟面试记录保存 7 天，要长期留请导出或存进我的文档。/)
})

test('自我探索：次数用完说明天 0 点恢复', () => {
  const page = makePage('pages/self-explore/self-explore.js', {
    wx: createWx(),
    auth: createAuth('member-1'),
    api: {},
  })
  const view = page._toResultView({
    status: 'completed',
    interpretationAvailable: false,
    aiUnavailableReason: 'AI_QUOTA_EXHAUSTED',
    dimensions: [],
  })
  assert.equal(view.aiReasonText, '今天的 AI 次数用完了，明天 0 点恢复。')
  assert.doesNotMatch(view.aiReasonText, /购买|套餐|权益|没有开放/)
})
